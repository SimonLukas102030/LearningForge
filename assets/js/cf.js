// =============================================================
//  LearningForge - Cloudflare Workers Client Wrapper
// -------------------------------------------------------------
//  Calls the learning-forge-api Worker (deployed to
//  learning-forge-api.simonkoper27.workers.dev) which mirrors
//  the four endpoints that used to live as Firebase Cloud
//  Functions.
//
//  Why HTTP instead of httpsCallable? Workers are plain HTTP
//  endpoints; they don't speak the Firebase callable protocol.
//  We forward the firebase ID token as `Authorization: Bearer`
//  so the Worker can verify it server-side (same auth model as
//  the old onCall functions).
//
//  Response contract:
//    Worker returns the result object DIRECTLY (no `.data`
//    wrapper that httpsCallable would add). On non-2xx the
//    body is { success:false, error:"<msg>" } and we throw.
//
//  CORS is handled Worker-side (Access-Control-Allow-Origin:*
//  + OPTIONS preflight returns 204), so the browser fetches
//  cross-origin from learning-forge.simonsstudios.de without
//  extra setup.
// =============================================================

const WORKER_BASE = 'https://learning-forge-api.simonkoper27.workers.dev';

// Returns the current Firebase ID-Token (JWT). Worker verifies
// the signature against Google's public keys and trusts the
// `sub` claim as the uid. Cached by the SDK; we don't force-
// refresh - the Worker gets a fresh-ish token (<1h old).
async function _idToken() {
  const u = firebase.auth().currentUser;
  if (!u) throw new Error('Nicht eingeloggt');
  return await u.getIdToken(false);
}

// Generic POST wrapper. `auth:false` skips the bearer header
// (used by getParentShareReport - that endpoint is unauth).
async function _call(endpoint, body, { auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = `Bearer ${await _idToken()}`;

  const res = await fetch(`${WORKER_BASE}/${endpoint}`, {
    method:  'POST',
    headers,
    body:    JSON.stringify(body || {})
  });

  let data;
  try { data = await res.json(); }
  catch { throw new Error(`Worker ${endpoint}: HTTP ${res.status}, ungueltiges JSON`); }

  if (!res.ok || data?.success === false) {
    throw new Error(data?.error || `Worker ${endpoint}: HTTP ${res.status}`);
  }
  return data;
}

// -----------------------------------------------------------
//  submitTestResult - replaces client-side saveGrade +
//  updateLeaderboard + saveXP + saveAchievements + writeFeedEntry
// -----------------------------------------------------------
//  payload shape:
//    {
//      subjectId, yearId, topicId,
//      timeMinutes,            // 5/10/15/30/90
//      timeSpentSec,           // actual seconds spent
//      isPenalty,              // boolean (tab-switch)
//      answers: [
//        // For multiple_choice questions:
//        {
//          questionIndex: 0,         // index into the ORIGINAL questions.json array
//          type: 'multiple_choice',
//          selectedOriginalIndex: 2  // index into the ORIGINAL options array
//                                    // (client must de-shuffle their selection)
//        },
//        // For free_text:
//        {
//          questionIndex: 1,
//          type: 'free_text',
//          freeText: '...student answer...',
//          reportedPoints: 4,        // what the AI grader gave (server clamps)
//          reportedMaxPoints: 8
//        },
//        // For vocabulary:
//        {
//          questionIndex: 2,
//          type: 'vocabulary',
//          freeText: '...'
//        }
//      ]
//    }
//  returns: { grade, points, max, xpAwarded, achievementsGranted, leaderboardUpdated }
// -----------------------------------------------------------
export async function submitTestResult(payload) {
  return await _call('submitTestResult', payload);
}

// -----------------------------------------------------------
//  unlockCosmetic - replaces unlockTheme / setActiveTheme/
//  setActiveOutline ownership checks. The server enforces:
//    - outlines: tier.level <= calcLevel(xp)
//    - themes: drop earned (in users.themeDrops) OR default
//  returns: { unlocked: bool, reason: string }
// -----------------------------------------------------------
export async function unlockCosmetic(kind, id) {
  return await _call('unlockCosmetic', { kind, id });
}

// -----------------------------------------------------------
//  markTestAccount - replaces markAsClaude / markAsHacker.
//  Server checks the firebase ID-token email against the
//  TEST_ACCOUNT_EMAILS whitelist (hardcoded in workers/).
//  returns: { marked: bool, kind }
// -----------------------------------------------------------
export async function markTestAccount(kind) {
  return await _call('markTestAccount', { kind });  // kind: 'claude' | 'hacker'
}

// -----------------------------------------------------------
//  getParentShareReport - UNAUTH endpoint, validated via the
//  share-token in the body (not via firebase auth). Returns a
//  CURATED subset of the user-doc, never email / friendIds /
//  role / etc. (closes Cheat #17).
//  shape: { name, klasse, totalGrades, avgGradePerSubject,
//           xp, level, achievementsCount, streak, createdAt }
// -----------------------------------------------------------
export async function getParentShareReport(token) {
  return await _call('getParentShareReport', { token }, { auth: false });
}

// -----------------------------------------------------------
//  submitDailyChallenge - Mission 9 (Cheat #4 fix) + B4 fix
//  (2026-05-08, Marcus): for non-curated dates the frontend
//  passes its dynamically-generated questions[] alongside the
//  answers — the worker validates + evaluates against the
//  supplied `correct` index. Curated dates ignore `questions`
//  and use the server-held answer-key as before.
//
//  Worker writes the dailyScores doc + grants XP/streak.
//
//  payload shape:
//    {
//      date: '2026-04-22',                // ISO YYYY-MM-DD
//      answers: [
//        { questionIndex: 0, selectedOriginalIndex: 2 },
//        { questionIndex: 1, freeText: '...' }   // future
//      ],
//      // OPTIONAL: required for non-curated dates only
//      questions: [
//        { id, type: 'multiple_choice', options: [...], correct: <int>, points: <int> },
//        ...
//      ]
//    }
//
//  returns: {
//    grade, points, max, xpAwarded, achievementsGranted,
//    dailyPerfect, source: 'curated' | 'dynamic'
//  }
// -----------------------------------------------------------
export async function submitDailyChallenge(payload) {
  return await _call('submitDailyChallenge', payload);
}

// -----------------------------------------------------------
//  submitTopicForApproval - Phase 3c (Ethan, 2026-05-08)
//  Reicht ein customTopic fuer die Public-Library ein. Backend
//  flippt visibility='pending-approval' + legt pendingApprovals/
//  {autoId} Queue-Row an. Auth-Token noetig (Owner-Check Worker-
//  side).
//
//  payload: { topicId: string, message?: string }
//  returns: { ok: true, status: 'submitted' | 'already-submitted',
//             pendingApprovalId?: string }
// -----------------------------------------------------------
export async function submitTopicForApproval(topicId, message = '') {
  return await _call('submitTopicForApproval', { topicId, message });
}

// -----------------------------------------------------------
//  approveTopicForPublic - Phase 3c (Ethan, 2026-05-08)
//  Admin-only: flippt pending-approval → public (approve) oder
//  pending-approval → group + rejectionNote (reject). Backend
//  prueft Email-Whitelist gegen ID-Token.
//
//  payload:
//    { topicId, action:'approve' }
//    { topicId, action:'reject', rejectionNote: '...' }
//  returns: { ok: true, status: 'approved' | 'rejected' }
// -----------------------------------------------------------
export async function approveTopicForPublic(topicId, action, rejectionNote = '') {
  const body = { topicId, action };
  if (action === 'reject') body.rejectionNote = rejectionNote;
  return await _call('approveTopicForPublic', body);
}

// -----------------------------------------------------------
//  aiCall - Mission-12 (Ethan, 2026-05-08)
//  Worker-Proxy fuer Groq+Gemini. Frontend hat KEINE API-Keys
//  mehr — die liegen als Worker-Secrets (GROQ_API_KEY,
//  GEMINI_API_KEY). Worker macht Groq zuerst, Gemini-Fallback,
//  503 wenn beide tot.
//
//  payload:
//    { mode: 'completion', prompt: '...', maxTokens?, temperature?, model? }
//    { mode: 'chat',       messages: [...], maxTokens?, temperature?, model? }
//  returns: { text, provider: 'groq'|'gemini', model: '...' }
//  throws: auf 401 (auth-fail), 503 (kein Provider), andere HTTP-Errors
// -----------------------------------------------------------
export async function aiCall(payload) {
  return await _call('aiCall', payload);
}
