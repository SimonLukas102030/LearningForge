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

const TEST_ACCOUNT_EMAILS = [
  'simonkoper27@gmail.com'
  // Add more emails here if Simon needs additional test accounts.
];

export async function handleMarkTestAccount(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid, email } = await requireAuth(request, env);
  if (!email || !TEST_ACCOUNT_EMAILS.includes(email)) {
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
