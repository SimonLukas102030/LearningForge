// =============================================================
//  Endpoint - deleteAccount
// -------------------------------------------------------------
//  Cycle-3 Settings-Refactor (Marcus Hayes, 2026-05-08).
//
//  User-driven account-obliteration. Triggered from the new
//  Settings-Tab "Konto" -> "Konto loeschen" modal. Front-end
//  flow (Ethan):
//
//    1. Modal step 1: type your displayName to confirm.
//    2. Modal step 2: 10-sec countdown with cancel.
//    3. POST /deleteAccount with { confirmName: <typed> }.
//    4. On 200: firebase.auth().currentUser.delete()
//                 + firebase.auth().signOut()
//                 + redirect to /login + toast "Konto geloescht."
//    5. On 403 (name mismatch): toast "Name stimmt nicht ueberein."
//
//  Server-side scope: HARD-DELETE the following Firestore docs.
//  All four collections are wiped atomically via a single
//  :commit batch (Firestore REST cap = 500 writes per commit;
//  customTopics+pendingApprovals are bounded by per-user usage
//  and stay well under that cap in practice).
//
//    Collection            | Write
//    ----------------------|----------------------------------
//    users/{uid}           | delete
//    leaderboard/{uid}     | delete
//    customTopics where    | delete (per matching doc)
//      ownerUid == uid     |
//    pendingApprovals      | delete (per matching doc)
//      where ownerUid==uid |
//
//  NOT touched here (out-of-scope for this run):
//
//    - dailyScores/{date}/users/{uid} subcollection rows.
//      Spec call: leave alone (orphaned-row pattern). Cleaning
//      these would require iterating every {date} doc, which
//      the Worker has no cheap way to enumerate. dailyScores
//      reads filter on `isHacker`/`isClaude` already; an
//      orphan-row from a deleted-account user is invisible
//      everywhere it matters (it's keyed by uid and the user-
//      doc is gone). Mission-future-cleanup: a scheduled
//      cron-job could prune dailyScores rows with no matching
//      users-doc.
//
//    - groups membership entries. The user is removed from each
//      group's `members` map (set+merge with null marker per
//      Hard-rule-5 + Hard-rule-4). Their groupIds list dies with
//      the user-doc anyway.
//
//    - feed entries. Feed posts authored by the deleted user
//      stay (audit trail / friend-feed-history). Reader code
//      already handles missing-author by displaying "Geloeschter
//      Account" via the per-uid get-on-display fallback (not
//      this Worker's lane).
//
//    - friend-backrefs in OTHER users' friendIds arrays. Same
//      reasoning as feed — friend list of someone-else who
//      friended the deleted user keeps the now-stale uid; their
//      next render either shows "Geloeschter Account" or filters
//      it out client-side. Mission-future-followup.
//
//    - shareLinks created by this user. Out of scope; expiresAt
//      enforcement (CHEAT-38) ages them out within 90 days
//      anyway, and a stale token resolves to "Konto nicht mehr
//      verfuegbar" in getParentShareReport.
//
//    - bugReports authored by this user. Out of scope; admin
//      workflow needs the audit trail.
//
//    - Firebase Auth user itself. Cycle-3 follow-up (Marcus, Ramsey
//      P0 #1, 2026-05-08): NOW handled here via Identity-Toolkit
//      accounts:delete REST call (lib/firestore.js
//      deleteFirebaseAuthUser). Closes the Auth/Firestore-Delete-
//      Sequencing-Race — previously the frontend deleted the
//      Auth-user AFTER the worker returned, and a transient failure
//      between the two left the user in Firestore-gone-Auth-stuck
//      limbo (couldn't re-register the same email; logging in
//      crashed the app on missing user-doc). The Worker now does
//      both atomically: Firestore-commit then Auth-user-delete in
//      the same request.
//
//      DEPLOY-NOTE: the Worker's service account needs the
//      `firebase` OAuth scope OR the `Firebase Authentication
//      Admin` IAM role on the project. Default Firebase-Admin
//      service-accounts (the ones generated under
//      "Service Accounts" in the Firebase Console) already have
//      this — no extra grant needed for our setup. If a deploy
//      hits 403 INSUFFICIENT_PERMISSION on accounts:delete, add
//      `roles/firebaseauth.admin` via the Cloud Console IAM page.
//
//  Body:
//    {
//      confirmName: <string>   // must equal users/{uid}.name
//                              // (case-sensitive exact match,
//                              //  matches the Maya-spec modal)
//    }
//
//  Auth: Bearer ID-token required.
//
//  Validation flow:
//    1. requireAuth -> uid.
//    2. Load users/{uid}; reject 404 if missing (account already
//       deleted on a prior call -> idempotent 200 with
//       alreadyDeleted: true).
//    3. Compare body.confirmName to userData.name. Mismatch -> 403.
//    4. Query customTopics + pendingApprovals for ownerUid==uid.
//    5. Build a single :commit batch with all delete-writes
//       PLUS a single set+merge on the user's groups membership
//       cleanup (member-null-marker per Hard-rule-5).
//    6. Commit. Return counts.
//
//  Hard-rules:
//    - HR4 (no update for partial writes): the groups-cleanup
//      uses set+merge with null markers (see leaveGroup pattern
//      in auth.js). The four delete-writes use the new
//      buildDeleteWriteFor helper.
//    - HR5 (no delete as reset): the Firestore-deletes here are
//      explicit obliterate-on-user-request, NOT reset-via-delete.
//      buildDeleteWriteFor's docstring spells out the carve-out.
//
//  Idempotency: a second call after the user-doc is already
//  gone returns 200 with `alreadyDeleted: true` so the Frontend
//  doesn't crash if the Auth-user-delete step retries.
// =============================================================

import { requireAuth }             from '../lib/auth.js';
import { readJsonBody, httpError } from '../lib/http.js';
import {
  firestoreGet,
  firestoreQuery,
  firestoreCommit,
  buildWriteFor,
  buildDeleteWriteFor,
  deleteFirebaseAuthUser
}                                  from '../lib/firestore.js';

// Strip the leading projects/.../documents/ prefix from a Firestore
// resource-name to recover the doc-id (last path segment). Same helper
// as listCustomTopics; duplicated here to avoid a tiny shared util.
function _docIdFromResourceName(name) {
  if (!name) return null;
  const idx = name.lastIndexOf('/');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

// Firestore :commit caps at 500 writes per batch. We never expect a
// realistic user to own >450 customTopics + pendingApprovals combined,
// but the cap is sharp so we slice into chunks if it ever happens.
const COMMIT_BATCH_CAP = 450;

export async function handleDeleteAccount(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid } = await requireAuth(request, env);

  const body = await readJsonBody(request);
  const confirmName = body?.confirmName;
  if (typeof confirmName !== 'string' || !confirmName) {
    throw httpError(400, 'confirmName fehlt.');
  }

  // ── Step 1: load user-doc, validate confirmName ───────────────────
  const userDoc = await firestoreGet(env, `users/${uid}`);
  if (!userDoc) {
    // Idempotent: Firestore-doc already gone. Could be a retry after a
    // race (this Worker succeeded on a prior call but the response was
    // dropped) — in that case the Auth-user might also be gone. The
    // Auth-user-delete is itself idempotent (USER_NOT_FOUND -> OK), so
    // we still call it to converge on the desired state: BOTH gone.
    // Without this, a retry of an already-Firestore-deleted account
    // would leave the Auth-user dangling forever.
    await deleteFirebaseAuthUser(env, uid);
    return { ok: true, alreadyDeleted: true };
  }
  const userData = userDoc.fields || {};
  const realName = userData.name;
  if (typeof realName !== 'string' || realName.length === 0) {
    // No display-name on doc -> cannot validate confirm. Bail rather
    // than silently letting any string through. Should never happen for
    // a real user (registerWithEmail / loginWithGoogle always set name).
    throw httpError(409, 'Konto-Name fehlt — bitte Support kontaktieren.');
  }
  if (confirmName !== realName) {
    throw httpError(403, 'Name stimmt nicht überein.');
  }

  // ── Step 2: enumerate owned content ───────────────────────────────
  // Service-account credentials bypass firestore.rules, so we can read
  // even if the rules-side `list` rule is `if false`.
  const ownedTopicRows = await firestoreQuery(env, 'customTopics', {
    where: [['ownerUid', '==', uid]],
    limit: COMMIT_BATCH_CAP
  });
  const ownedPendingRows = await firestoreQuery(env, 'pendingApprovals', {
    where: [['ownerUid', '==', uid]],
    limit: COMMIT_BATCH_CAP
  });

  // ── Step 3: groups cleanup — null-marker on each member-map ───────
  // Mirrors auth.js leaveGroup's null-marker pattern. We pull the
  // user's groupIds from their user-doc (legitimate read via service-
  // account) and set members.{uid}: null on each. Hard-rule-4 (set+
  // merge) + Hard-rule-5 (null marker, not FieldValue.delete).
  // Skipping this would leave stale member-cards in the group-page UI
  // until the next group-creator action.
  const userGroupIds = Array.isArray(userData.groupIds) ? userData.groupIds : [];
  const groupCleanupWrites = userGroupIds
    .filter(g => typeof g === 'string' && g)
    .map(groupId => buildWriteFor(env, `groups/${groupId}`, {
      [`members.${uid}`]: null
    }));

  // ── Step 4: build the delete batch ────────────────────────────────
  const deleteWrites = [
    buildDeleteWriteFor(env, `users/${uid}`),
    buildDeleteWriteFor(env, `leaderboard/${uid}`)
  ];
  for (const r of ownedTopicRows) {
    const id = _docIdFromResourceName(r.name);
    if (id) deleteWrites.push(buildDeleteWriteFor(env, `customTopics/${id}`));
  }
  for (const r of ownedPendingRows) {
    const id = _docIdFromResourceName(r.name);
    if (id) deleteWrites.push(buildDeleteWriteFor(env, `pendingApprovals/${id}`));
  }

  // groups-cleanup runs in the same atomic commit so we never half-
  // wipe (user-doc gone, group-member-card stale) on a partial-failure.
  const allWrites = [...groupCleanupWrites, ...deleteWrites];

  // Slice into commit-cap-sized chunks. In practice always 1 chunk;
  // the slicing is defensive for power-builders with hundreds of topics.
  for (let i = 0; i < allWrites.length; i += COMMIT_BATCH_CAP) {
    const slice = allWrites.slice(i, i + COMMIT_BATCH_CAP);
    if (slice.length === 0) continue;
    await firestoreCommit(env, slice);
  }

  // ── Step 5: Firebase-Auth user delete (Ramsey P0 #1) ──────────────
  // Done AFTER Firestore-commit succeeds. Order matters: if Auth-delete
  // ran first and Firestore failed, we'd have an orphaned user-doc
  // with no auth-user; the next sign-up of that email would inherit
  // stale state. Firestore-first means the worst-case partial failure
  // is "Firestore gone, Auth still there" — which the next call to
  // /deleteAccount converges by hitting the alreadyDeleted branch
  // above (which now also calls deleteFirebaseAuthUser).
  await deleteFirebaseAuthUser(env, uid);

  return {
    ok: true,
    deleted: {
      user:             1,
      leaderboard:      1,
      customTopics:     ownedTopicRows.length,
      pendingApprovals: ownedPendingRows.length,
      groupCleanups:    groupCleanupWrites.length,
      authUser:         1
    }
  };
}
