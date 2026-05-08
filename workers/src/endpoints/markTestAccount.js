// =============================================================
//  Endpoint - markTestAccount
// -------------------------------------------------------------
//  Replaces the old client-side markAsClaude / markAsHacker.
//  Server validates that the caller's email is on the hardcoded
//  TEST_ACCOUNT_EMAILS whitelist before flipping isClaude /
//  isHacker + role:'admin'. Mirrors to leaderboard.
//
//  Email comes from the verified Firebase ID token's `email`
//  claim (which carries email_verified) - we trust it because we
//  just verified the JWT signature against Google's certs.
// =============================================================

import { requireAuth }              from '../lib/auth.js';
import { readJsonBody, httpError }  from '../lib/http.js';
import { firestoreUpdate }          from '../lib/firestore.js';

// Wave-1 hardening 2026-05-08 (Marcus, B-M03): the previous hardcoded
// list contained ONLY simonkoper27@gmail.com, but the Claude- and Hacker-
// Test-Accounts have their OWN emails (stored in localStorage, never
// committed to the repo). markAsClaude/markAsHacker called from those
// accounts hit a 403 here — silent-catch upstream, so the test-account
// markers (isClaude/isHacker) were never written to users/{uid}, and
// the Test-Accounts then leaked into the leaderboard / friend-search /
// feed because the !isClaude/!isHacker filters had nothing to filter on.
//
// Fix: the Worker env carries a `TEST_ACCOUNT_EMAILS` secret = comma-
// separated list of allowed emails (set via `wrangler secret put`).
// Falls back to Simon's email only if the secret isn't set, so deploys
// in development without the secret still work.
function _getTestAccountEmails(env) {
  const raw = env.TEST_ACCOUNT_EMAILS;
  if (!raw || typeof raw !== 'string') {
    return ['simonkoper27@gmail.com'];
  }
  return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export async function handleMarkTestAccount(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid, email } = await requireAuth(request, env);
  const allowed = _getTestAccountEmails(env);
  const emailLc = (email || '').toLowerCase();
  if (!emailLc || !allowed.includes(emailLc)) {
    throw httpError(403, 'Diese Email ist nicht fuer Test-Accounts freigegeben.');
  }

  const { kind } = await readJsonBody(request);
  if (kind !== 'claude' && kind !== 'hacker') {
    throw httpError(400, 'kind muss "claude" oder "hacker" sein.');
  }

  const userPatch = { role: 'admin' };
  const lbPatch   = {};
  if (kind === 'claude') {
    userPatch.isClaude   = true;
    userPatch.name       = 'Claude (Test)';
    lbPatch.isClaude     = true;
    lbPatch.displayName  = 'Claude (Test)';
  } else {
    userPatch.isHacker   = true;
    userPatch.name       = 'Hacker (Test)';
    lbPatch.isHacker     = true;
    lbPatch.displayName  = 'Hacker (Test)';
  }

  await firestoreUpdate(env, `users/${uid}`,       userPatch);
  // Leaderboard mirror is best-effort - if the doc doesn't exist yet
  // (user has never tested), the PATCH would 404. firestoreUpdate
  // throws on non-2xx, so we swallow that here to match the original
  // behaviour (`.catch(() => {})` in functions/index.js).
  try {
    await firestoreUpdate(env, `leaderboard/${uid}`, lbPatch);
  } catch { /* ignore */ }

  return { marked: true, kind };
}
