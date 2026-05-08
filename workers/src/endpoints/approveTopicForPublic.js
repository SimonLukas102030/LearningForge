// =============================================================
//  Endpoint - approveTopicForPublic
// -------------------------------------------------------------
//  Phase 3c (Public-Library-Approval-Workflow, Marcus, 2026-05-08).
//
//  Admin-only flip from 'pending-approval' to 'public' (or back to
//  'group' on reject). Auth via the same admin-email whitelist used
//  by the firestore.rules adminEmails() — currently only
//  simonkoper27@gmail.com. The rules enforce read-only for
//  pendingApprovals from the client side (admin-only list); this
//  endpoint is the ONLY legitimate path to set visibility='public'.
//
//  Body shape:
//    {
//      topicId:        string                   // customTopics doc-id
//      action:         'approve' | 'reject'
//      rejectionNote?: string                   // required when action='reject'
//    }
//
//  Flow:
//    1. Verify Firebase ID token + admin-email check.
//    2. Parse + validate body.
//    3. Read customTopics/{topicId}; verify visibility='pending-approval'
//       (cannot approve a topic that wasn't submitted, cannot
//       re-approve a topic that's already public).
//    4. Read pendingApprovals/{topic.pendingApprovalId} if present —
//       used to mark the queue-row as 'resolved'.
//    5. Atomic batch:
//         - approve: customTopics flips to visibility='public',
//                    approvedAt, approvedBy='simon'
//         - reject:  customTopics flips back to visibility='group',
//                    rejectionNote, rejectedAt
//         - either:  pendingApprovals row marked status='resolved'
//                    + resolution='approved'|'rejected'
//                    + resolvedAt
//    6. Return { ok: true, status: 'approved' | 'rejected' }.
//
//  Hard-rule 4: every write goes through buildWriteFor / firestoreCommit
//  (PATCH-with-updateMask = set+merge). No update().
//
//  Hard-rule 5: pendingApprovals rows are NOT deleted — we mark them
//  resolved so the Admin-UI poll filter (status='open') hides them
//  while keeping an audit trail.
// =============================================================

import { requireAuth }             from '../lib/auth.js';
import { readJsonBody, httpError } from '../lib/http.js';
import {
  firestoreGet,
  firestoreCommit,
  buildWriteFor,
  serverTimestamp
}                                  from '../lib/firestore.js';

// Mirrors the firestore.rules adminEmails() helper. Hardcoded here on
// purpose — a Worker secret would be one more thing to forget at deploy
// time, and Simon's admin-email is public anyway (it's the contact
// point in the spec). If this grows past 1-2 emails we can move to a
// Worker secret. Lowercased for case-insensitive comparison.
const ADMIN_EMAILS = ['simonkoper27@gmail.com'];

const MAX_REJECTION_NOTE_LEN = 1000;

export async function handleApproveTopicForPublic(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  // V-PHASE-E-05 (Ramsey Cycle-E, P1, 2026-05-08): require email_verified
  // on the ID-token in addition to the whitelist match. Defense-in-depth
  // — Simon's Google account email is verified, so this never blocks the
  // legitimate caller. It DOES block the (already-thin) attack surface of
  // a freshly-signed-up account using one of the whitelisted addresses
  // before email-verification completes. firestore.rules' isAdminEmail()
  // helper enforces the same predicate symmetrically.
  const { uid, email, email_verified } = await requireAuth(request, env);
  const emailLc = (email || '').toLowerCase();
  if (!email_verified || !emailLc || !ADMIN_EMAILS.includes(emailLc)) {
    throw httpError(403, 'Nur der Admin darf Public-Library-Approvals verwalten.');
  }

  const body = await readJsonBody(request);
  const { topicId, action, rejectionNote } = body || {};

  if (typeof topicId !== 'string' || !topicId) {
    throw httpError(400, 'topicId fehlt.');
  }
  if (action !== 'approve' && action !== 'reject') {
    throw httpError(400, "action muss 'approve' oder 'reject' sein.");
  }

  let cleanRejectionNote = '';
  if (action === 'reject') {
    if (rejectionNote != null && typeof rejectionNote !== 'string') {
      throw httpError(400, 'rejectionNote muss ein String sein.');
    }
    cleanRejectionNote = (rejectionNote || '').trim();
    if (cleanRejectionNote.length === 0) {
      throw httpError(400, 'rejectionNote ist beim Reject Pflicht (Author bekommt das angezeigt).');
    }
    if (cleanRejectionNote.length > MAX_REJECTION_NOTE_LEN) {
      throw httpError(400, `rejectionNote zu lang (max ${MAX_REJECTION_NOTE_LEN} Zeichen).`);
    }
  }

  // Read the topic. Service-account credentials bypass rules.
  const topicDoc = await firestoreGet(env, `customTopics/${topicId}`);
  if (!topicDoc) {
    throw httpError(404, 'Topic existiert nicht.');
  }
  const topicData = topicDoc.fields || {};

  // State-machine guard: only `pending-approval` topics are eligible.
  // This prevents accidental "promote private to public" via the admin
  // path (would skip the User-consent step) and accidental double-action.
  const currentVisibility = topicData.visibility || 'private';
  if (currentVisibility !== 'pending-approval') {
    throw httpError(409,
      `Topic ist nicht im Pending-Approval-Status (current: ${currentVisibility}).`);
  }

  // Build customTopics patch.
  const topicPatch = {};
  if (action === 'approve') {
    topicPatch.visibility = 'public';
    topicPatch.approvedAt = serverTimestamp();
    topicPatch.approvedBy = 'simon';
    // Clear any prior rejectionNote (set+merge with `null` not delete —
    // Hard-rule 5: a doc-field reset stamps explicit null instead of
    // FieldValue.delete which races against concurrent reads).
    topicPatch.rejectionNote = null;
  } else {
    // Reject: route topic BACK to 'group' so author can revise + resubmit.
    // (CEO-decision: reject doesn't nuke the topic; user keeps editing it
    //  for their group and can re-trigger submitTopicForApproval later.)
    topicPatch.visibility    = 'group';
    topicPatch.rejectionNote = cleanRejectionNote;
    topicPatch.rejectedAt    = serverTimestamp();
    // Clear submitted-side fields so the next submission starts fresh.
    topicPatch.submittedMessage  = null;
    topicPatch.pendingApprovalId = null;
  }

  const writes = [ buildWriteFor(env, `customTopics/${topicId}`, topicPatch) ];

  // If the topic carries a queue-id, mark that pendingApprovals row as
  // resolved. Hard-rule-5 compliant: we set status='resolved' instead
  // of deleting. The Admin-UI filters status='open' to hide resolved
  // rows; the resolved rows remain for audit.
  const pendingApprovalId = topicData.pendingApprovalId;
  if (typeof pendingApprovalId === 'string' && pendingApprovalId) {
    writes.push(buildWriteFor(env, `pendingApprovals/${pendingApprovalId}`, {
      status:      'resolved',
      resolution:  action === 'approve' ? 'approved' : 'rejected',
      resolvedAt:  serverTimestamp(),
      resolvedBy:  uid,
      // For audit / future Admin-UI ("show last 10 reject reasons"):
      rejectionNote: action === 'reject' ? cleanRejectionNote : null
    }));
  }

  await firestoreCommit(env, writes);

  return {
    ok:     true,
    status: action === 'approve' ? 'approved' : 'rejected'
  };
}
