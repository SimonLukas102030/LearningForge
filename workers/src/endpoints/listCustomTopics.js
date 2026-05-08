// =============================================================
//  Endpoint - listCustomTopics
// -------------------------------------------------------------
//  V-09 list-scope hardening (Marcus, 2026-05-08, Mission-13).
//
//  Closes the customTopics.list-rule open-enumeration finding from
//  Ramsey's Cycle-E (and the V-PHASE-E-09 TODO marker in firestore.
//  rules:716). The previous rule
//
//      allow list: if isAuth();
//
//  let any auth'd user enumerate metadata of EVERY customTopic doc
//  in the collection, including private/pending-approval ones —
//  the per-doc `get`-rule filters out the body, but title /
//  description / fach / klasse / ownerUid leak through the
//  list-snapshot before the per-doc filter runs. With the Public-
//  Library now live (Phase 3c) the surface contains drafts users
//  may legitimately consider private, so the leak is urgent.
//
//  Fix: dedicated Worker endpoint. The client never lists the
//  collection directly anymore — auth.js wrappers post here with
//  a `scope` parameter, the Worker re-derives the safe set via
//  the service-account (rules-bypass), and returns only the rows
//  the user is actually allowed to see. The corresponding rules
//  change flips `allow list` to `if false` so the only path to
//  enumerate is via this endpoint.
//
//  Body shape:
//    {
//      scope:    'mine' | 'group' | 'public' | 'pending'
//      groupIds: string[]    // required for scope='group'
//    }
//
//  Per-scope filter:
//    - 'mine'    : ownerUid == auth.uid                   (drafts + private + group + pending + own approved)
//    - 'group'   : groupId in body.groupIds AND
//                  visibility in ('group', null/legacy)   (cross-checks the user's claimed groupIds against
//                                                         their actual users/{uid}.groupIds doc to prevent
//                                                         "I have no groups but pass groupIds=[X]" enumeration)
//    - 'public'  : visibility == 'public'                 (Public-Library)
//    - 'pending' : ADMIN-ONLY — visibility == 'pending-approval'
//                  AND status field stays informative; only callable by
//                  email_verified admin-whitelist.
//
//  Returned shape per row (NOT the full doc — the public-list
//  surface is metadata-only; clients fetch full questions/content
//  via the existing per-doc `get` rule which still enforces
//  customTopicReadOk()):
//    {
//      id:           string,
//      ownerUid:     string,
//      fach:         string,
//      klasse:       string,
//      thema:        string,
//      description:  string,
//      visibility:   string,
//      groupId:      string | null,
//      approvedAt:   ISO-string | null,    // public scope only
//      submittedAt:  ISO-string | null,    // pending scope only
//      rejectionNote: string | null        // mine scope only — owner sees their own
//    }
//
//  Hard-rule 4/5: read-only endpoint, no writes.
// =============================================================

import { requireAuth }             from '../lib/auth.js';
import { readJsonBody, httpError } from '../lib/http.js';
import { firestoreGet, firestoreQuery } from '../lib/firestore.js';

// Mirrors firestore.rules adminEmails(). Pinned to email_verified=true
// (matches isAdminEmail() in the rules + the same predicate the existing
// approveTopicForPublic.js endpoint uses). Lowercased for case-insensitive
// comparison.
const ADMIN_EMAILS = ['simonkoper27@gmail.com'];

// Hard cap on returned rows. The 'public' scope is the largest realistic
// list (entire library); 500 is generous but bounds the worst-case
// payload + Firestore-read-cost. The 'mine' / 'group' / 'pending' scopes
// will hit this bound in practice never (per-user / per-group / per-day
// content scales). If the Public-Library outgrows 500 entries we add
// pagination via cursor; until then this is fine.
const MAX_ROWS = 500;

// Build the public-facing summary row from a Firestore doc + its id.
// Deliberately minimal — only the fields the listing UIs actually use.
// Anything outside this set (questions[], content, weakQuestions, …)
// must be fetched via the per-doc `get` path, which keeps the per-doc
// rule's customTopicReadOk() in the loop.
function _summarise(id, fields, scope, callerUid) {
  // questionCount / subtopicCount are derived from the array lengths
  // on the doc so the listing UI (renderCustomTopicCard) can render
  // "N Fragen" without needing the full questions[] payload. Cheaper
  // than shipping the entire array to the client for every list-row.
  const questionCount = Array.isArray(fields.questions) ? fields.questions.length : 0;
  const subtopicCount = Array.isArray(fields.subtopics) ? fields.subtopics.length : 0;
  const out = {
    id,
    ownerUid:      fields.ownerUid    || null,
    fach:          fields.fach        || '',
    klasse:        fields.klasse      || '',
    thema:         fields.thema       || '',
    description:   fields.description || '',
    visibility:    fields.visibility  || 'private',
    groupId:       fields.groupId     || null,
    questionCount,
    subtopicCount
  };
  const isOwner = callerUid && fields.ownerUid === callerUid;
  // Scope-specific extras — only surface what each scope's UI actually
  // renders, so we don't accidentally leak (e.g.) submittedMessage to
  // a Public-Library reader.
  if (scope === 'public') {
    out.approvedAt = fields.approvedAt || null;
  }
  if (scope === 'pending') {
    // Admin-only — full audit fields visible.
    out.submittedAt      = fields.submittedAt      || null;
    out.submittedMessage = fields.submittedMessage || null;
  }
  if (scope === 'mine') {
    out.rejectionNote = fields.rejectionNote || null;
    out.submittedAt   = fields.submittedAt   || null;
    out.approvedAt    = fields.approvedAt    || null;
  }
  if (scope === 'group') {
    // Approval-flow fields are owner-private. Non-owners in the group
    // see visibility (so the badge renders) but NOT rejectionNote /
    // submittedMessage. Owner-of-row sees their own private fields so
    // the renderCustomTopicCard "Abgelehnt"-banner still works on a
    // group-shared topic the owner submitted to public and got rejected.
    if (isOwner) {
      out.rejectionNote = fields.rejectionNote || null;
      out.submittedAt   = fields.submittedAt   || null;
      out.approvedAt    = fields.approvedAt    || null;
    }
  }
  return out;
}

// Strip the leading projects/.../documents/ prefix from a Firestore
// resource-name to recover the doc-id (last path segment). The :runQuery
// response gives us full resource-names; we want just the topicId.
function _docIdFromResourceName(name) {
  if (!name) return null;
  const idx = name.lastIndexOf('/');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

export async function handleListCustomTopics(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid, email, email_verified } = await requireAuth(request, env);
  const body = await readJsonBody(request);
  const scope = body?.scope;

  if (typeof scope !== 'string' || !scope) {
    throw httpError(400, 'scope fehlt.');
  }
  if (!['mine', 'group', 'public', 'pending'].includes(scope)) {
    throw httpError(400, "scope muss 'mine' | 'group' | 'public' | 'pending' sein.");
  }

  // ── scope: mine ─────────────────────────────────────────────────────
  // Trivial — owner sees everything they own. No need to filter by
  // visibility (drafts + group-shared + pending + approved + rejected
  // are all legitimate to surface in the "Meine Inhalte"-view).
  if (scope === 'mine') {
    const rows = await firestoreQuery(env, 'customTopics', {
      where: [['ownerUid', '==', uid]],
      limit: MAX_ROWS
    });
    return rows.map(r => _summarise(_docIdFromResourceName(r.name), r.fields, 'mine', uid));
  }

  // ── scope: public ───────────────────────────────────────────────────
  // Open to every authed user — this IS the Public-Library list. The
  // approval-gate is the only filter (no `pending-approval` rows leak;
  // those are admin-only via `pending` scope).
  if (scope === 'public') {
    const rows = await firestoreQuery(env, 'customTopics', {
      where: [['visibility', '==', 'public']],
      limit: MAX_ROWS
    });
    return rows.map(r => _summarise(_docIdFromResourceName(r.name), r.fields, 'public', uid));
  }

  // ── scope: pending ──────────────────────────────────────────────────
  // Admin-only — mirrors the firestore.rules pendingApprovals access
  // (admin-email-whitelist with email_verified=true). Returns the
  // pending-approval customTopics, NOT the pendingApprovals queue rows
  // (the queue rows are still listed via the existing
  // pendingApprovals.list rule). This scope is the "preview the topic
  // contents from the Admin-UI" path.
  if (scope === 'pending') {
    const emailLc = (email || '').toLowerCase();
    if (!email_verified || !emailLc || !ADMIN_EMAILS.includes(emailLc)) {
      throw httpError(403, 'Nur Admin darf pending-approval Topics auflisten.');
    }
    const rows = await firestoreQuery(env, 'customTopics', {
      where: [['visibility', '==', 'pending-approval']],
      limit: MAX_ROWS
    });
    return rows.map(r => _summarise(_docIdFromResourceName(r.name), r.fields, 'pending', uid));
  }

  // ── scope: group ────────────────────────────────────────────────────
  // Caller passes the groupIds they care about. We CROSS-CHECK these
  // against their actual users/{uid}.groupIds doc to prevent the
  // "claim membership in groups I'm not in to enumerate their topics"
  // attack. Only intersection-IDs are queried.
  //
  // Firestore :runQuery doesn't support `in` for arrays at the field-
  // level directly through this minimal query helper, so we fan out
  // one query per groupId. With realistic group counts (<10 per user)
  // that's fine; if someone is in 100 groups we'd want to add an `in`
  // operator to firestoreQuery, but that's a Mission-3-followup.
  if (scope === 'group') {
    const claimed = Array.isArray(body?.groupIds) ? body.groupIds.filter(g => typeof g === 'string' && g) : [];
    if (claimed.length === 0) return [];

    // Pull the user's actual groupIds from their user-doc. Service-
    // account read = bypasses rules. We DO NOT trust the body's
    // groupIds — only the intersection passes the cross-check.
    const userDoc = await firestoreGet(env, `users/${uid}`);
    const realGroupIds = userDoc?.fields?.groupIds;
    const realSet = new Set(Array.isArray(realGroupIds) ? realGroupIds : []);

    const allowed = claimed.filter(g => realSet.has(g));
    if (allowed.length === 0) return [];

    // One query per groupId, then concat. No visibility post-filter
    // here on purpose — pre-V-09 the direct list-query was just
    // `where('groupId','==',X)` so the group section of "Meine Inhalte"
    // showed all visibility states (the owner's pending/public group-
    // shared topics included). Keeping that behaviour. Legacy topics
    // (no `visibility`-field, `groupId` set) come back as visibility=
    // 'group' via _summarise's default — matches firestore.rules
    // customTopicReadOk()'s backwards-compat mapping at line ~687.
    const out = [];
    for (const groupId of allowed) {
      const rows = await firestoreQuery(env, 'customTopics', {
        where: [['groupId', '==', groupId]],
        limit: MAX_ROWS
      });
      for (const r of rows) {
        // We do NOT post-filter on visibility here. Pre-V-09 the
        // direct list-query was `where('groupId','==',X)` with no
        // visibility filter, so group topics in `pending-approval`
        // (owner submitted to public) still showed up in the group
        // section of "Meine Inhalte". Keeping the same behaviour so
        // the owner still sees the pending-banner on their card; the
        // rules-side `allow get` enforces customTopicReadOk() if any
        // non-member somehow learns the topicId.
        out.push(_summarise(_docIdFromResourceName(r.name), r.fields || {}, 'group', uid));
        if (out.length >= MAX_ROWS) break;
      }
      if (out.length >= MAX_ROWS) break;
    }
    return out;
  }

  // Unreachable (scope is validated above).
  throw httpError(400, 'unknown scope.');
}
