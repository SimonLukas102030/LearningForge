// =============================================================
//  Endpoint - submitTopicForApproval
// -------------------------------------------------------------
//  Phase 3c (Public-Library-Approval-Workflow, Marcus, 2026-05-08).
//
//  User submits one of their own customTopics for the Public-Library.
//  We do NOT attempt SMTP from a Cloudflare Worker (no provider wired
//  up). Instead we write a row into `pendingApprovals/{autoId}` —
//  Simon's Admin-UI polls that collection and shows the queue. The
//  topic itself flips to `visibility: 'pending-approval'` so the
//  builder UI can render an "Eingereicht — wird geprueft" badge.
//
//  Flow:
//    1. Verify Firebase ID token (auth required).
//    2. Parse body { topicId, message? }.
//    3. Read customTopics/{topicId} via service-account (bypasses
//       rules so we can read any private/group doc the caller
//       claims to own).
//    4. Validate:
//         - topic must exist
//         - caller must be ownerUid
//         - current visibility != 'public' (re-submitting a
//           public topic makes no sense)
//         - current visibility != 'pending-approval' (already
//           submitted — return ok-idempotent)
//    5. Atomic batch:
//         - customTopics/{topicId}: visibility='pending-approval',
//                                   submittedAt=serverTimestamp,
//                                   submittedMessage=<message or ''>
//         - pendingApprovals/{autoId}: topicId, ownerUid,
//                                      ownerEmail (best-effort),
//                                      submittedAt, message,
//                                      topicSummary (cached),
//                                      status='open'
//    6. Return { ok: true, status: 'submitted' }.
//
//  Hard-rule 4: every write goes through buildWriteFor / firestoreCommit
//  which use PATCH-with-updateMask (== set+merge). No update().
//
//  Hard-rule 5: queue rows are created with status='open'. Approval/
//  rejection flips status to 'resolved' instead of deleting the row
//  (delete races against concurrent reads from the polling Admin-UI).
// =============================================================

import { requireAuth }             from '../lib/auth.js';
import { readJsonBody, httpError } from '../lib/http.js';
import {
  firestoreGet,
  firestoreQuery,
  firestoreCommit,
  buildWriteFor,
  serverTimestamp
}                                  from '../lib/firestore.js';

// Cap submission-message size to prevent user-doc bloat. Frontend should
// already limit input; this is the defence-in-depth bound.
const MAX_MESSAGE_LEN = 1000;

// V-PHASE-E-04 (Ramsey Cycle-E, P1, 2026-05-08): per-user pending-queue
// cap. Without this an attacker could `for(i=0;i<10000;i++)
// cf.submitTopicForApproval(realTopicId,'')` (legit caller-uid, legit
// topic) and DoS Simon's Admin-UI: thousands of resolved-rows from
// rapid approve+reject cycles, plus N pending-rows the polling UI has
// to render. Cap at 5 OPEN pending-rows per user — if you've got 5
// topics in the queue, wait for Simon. Resolved rows don't count
// (status=='open' filter). The check is server-side because the rules
// can't aggregate counts.
const MAX_OPEN_PENDING_PER_USER = 5;

// 20-char alphanumeric auto-ID (matches firestoreCreate's helper). We
// inline the generator here so we can write the autoId into the
// customTopics doc as well (e.g. for later cross-reference) without
// double-roundtripping. Same alphabet/length as the Firestore client SDK.
function _generateAutoId() {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += ALPHA[buf[i] % ALPHA.length];
  return out;
}

// Build a small "summary" object for the Admin-UI listing — enough to
// render a queue-card without needing a second roundtrip per row. We
// deliberately do NOT cache `questions[]` here: those can be large and
// the Admin-UI fetches the full topic on detail-view.
function _buildTopicSummary(topicData) {
  return {
    fach:           typeof topicData.fach        === 'string' ? topicData.fach        : '',
    klasse:         typeof topicData.klasse      === 'string' ? topicData.klasse      : '',
    thema:          typeof topicData.thema       === 'string' ? topicData.thema       : '',
    description:    typeof topicData.description === 'string' ? topicData.description : '',
    questionCount:  Array.isArray(topicData.questions) ? topicData.questions.length : 0,
    subtopicCount:  Array.isArray(topicData.subtopics) ? topicData.subtopics.length : 0
  };
}

export async function handleSubmitTopicForApproval(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid, email } = await requireAuth(request, env);
  const body = await readJsonBody(request);
  const { topicId, message } = body || {};

  if (typeof topicId !== 'string' || !topicId) {
    throw httpError(400, 'topicId fehlt.');
  }

  // Validate optional message field. We accept null/undefined/''/string;
  // anything else is a 400 (no objects, arrays, numbers etc. — those
  // would be a frontend-bug signal worth surfacing rather than silently
  // coercing).
  let cleanMessage = '';
  if (message != null) {
    if (typeof message !== 'string') {
      throw httpError(400, 'message muss ein String sein (oder weglassen).');
    }
    if (message.length > MAX_MESSAGE_LEN) {
      throw httpError(400, `message zu lang (max ${MAX_MESSAGE_LEN} Zeichen).`);
    }
    cleanMessage = message;
  }

  // Service-account read: bypasses rules, so we can read any custom-topic
  // (private/group/public) and validate ownership ourselves.
  const topicDoc = await firestoreGet(env, `customTopics/${topicId}`);
  if (!topicDoc) {
    throw httpError(404, 'Topic existiert nicht.');
  }
  const topicData = topicDoc.fields || {};

  if (topicData.ownerUid !== uid) {
    throw httpError(403, 'Du bist nicht der Owner dieses Topics.');
  }

  // Visibility state-machine guards. Public topics can't be re-submitted
  // (they're already in the library); already-pending submissions are an
  // ok-idempotent (no double-queue-row).
  const currentVisibility = topicData.visibility || 'private';
  if (currentVisibility === 'public') {
    throw httpError(409, 'Topic ist bereits in der Public-Library.');
  }
  if (currentVisibility === 'pending-approval') {
    return { ok: true, status: 'already-submitted' };
  }

  // V-PHASE-E-04: per-user pending-queue cap. Run AFTER the per-topic
  // state-machine guards (no point counting if this submit would be
  // rejected anyway) but BEFORE the writes. firestoreQuery uses
  // :runQuery via the service-account, no rules.
  //
  // Idempotency-note: we already early-return for 'pending-approval'
  // above, so the current topic NEVER counts toward its own re-submit's
  // limit. The check exists purely to bound how many DIFFERENT topics
  // a single user has in flight.
  const openPending = await firestoreQuery(env, 'pendingApprovals', {
    where: [
      ['ownerUid', '==', uid],
      ['status',   '==', 'open']
    ],
    limit: MAX_OPEN_PENDING_PER_USER + 1   // +1 so we can detect ">= cap"
  });
  if (openPending.length >= MAX_OPEN_PENDING_PER_USER) {
    throw httpError(429,
      `Du hast schon ${MAX_OPEN_PENDING_PER_USER} Topics in der Approval-Queue. Warte auf Simon's Decision.`);
  }

  // Build the batch: customTopics doc flip + pendingApprovals row.
  const queueId   = _generateAutoId();
  const summary   = _buildTopicSummary(topicData);

  const writes = [
    buildWriteFor(env, `customTopics/${topicId}`, {
      visibility:        'pending-approval',
      submittedAt:       serverTimestamp(),
      submittedMessage:  cleanMessage,
      // Stamp the queue-id on the topic too so the Admin-UI can find the
      // matching pendingApprovals doc without another query.
      pendingApprovalId: queueId,
      // V-PHASE-E-03 (re-submit-flow ownership): clear rejection audit
      // fields on (re-)submit. Previously the Frontend `clearRejectionNote`
      // wrapper did this client-side, but those fields are now Worker-only
      // at the rules layer (rejectionNote/rejectedAt are blocked in the
      // owner-update branch of customTopics). Doing it here keeps the
      // re-submit UX (no "Abgelehnt"-banner after re-submit) without
      // exposing the audit-trail to client tampering. Set+merge with null
      // marker (Hard rule 5).
      rejectionNote:     null,
      rejectedAt:        null
    }),
    buildWriteFor(env, `pendingApprovals/${queueId}`, {
      topicId:      topicId,
      ownerUid:     uid,
      ownerEmail:   email || null,
      message:      cleanMessage,
      topicSummary: summary,
      submittedAt:  serverTimestamp(),
      status:       'open'   // 'open' | 'resolved' (post-approve/reject)
    })
  ];

  await firestoreCommit(env, writes);

  return {
    ok:               true,
    status:           'submitted',
    pendingApprovalId: queueId
  };
}
