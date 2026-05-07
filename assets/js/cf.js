// =============================================================
//  LearningForge - Cloud Functions Client Wrapper
// -------------------------------------------------------------
//  Wraps firebase.functions(REGION).httpsCallable(...) for the
//  three onCall endpoints + a plain fetch() for the unauth
//  onRequest endpoint (getParentShareReport).
//
//  Region pinning matters: the server functions are deployed to
//  europe-west1 (close to Germany), and the client SDK has to
//  be told about that or it defaults to us-central1 and 404s.
//
//  Requires firebase-functions-compat to be loaded BEFORE this
//  module imports (Ethan: add the SDK script tag in index.html).
// =============================================================

const REGION     = 'europe-west1';
const PROJECT_ID = 'learningforge-e995e';

let _functions = null;
function _fns() {
  if (!_functions) _functions = firebase.functions(REGION);
  return _functions;
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
// -----------------------------------------------------------
export async function submitTestResult(payload) {
  const callable = _fns().httpsCallable('submitTestResult');
  const result = await callable(payload);
  return result.data;  // { grade, points, max, xpAwarded, achievementsGranted, leaderboardUpdated }
}

// -----------------------------------------------------------
//  unlockCosmetic - replaces unlockTheme / setActiveTheme/
//  setActiveOutline ownership checks. The server enforces:
//    - outlines: tier.level <= calcLevel(xp)
//    - themes: drop earned (in users.themeDrops) OR default
// -----------------------------------------------------------
export async function unlockCosmetic(kind, id) {
  const callable = _fns().httpsCallable('unlockCosmetic');
  const result = await callable({ kind, id });
  return result.data;  // { unlocked: bool, reason: string }
}

// -----------------------------------------------------------
//  markTestAccount - replaces markAsClaude / markAsHacker.
//  Server checks request.auth.token.email is on the
//  TEST_ACCOUNT_EMAILS whitelist (hardcoded in functions/
//  index.js).
// -----------------------------------------------------------
export async function markTestAccount(kind) {
  const callable = _fns().httpsCallable('markTestAccount');
  const result = await callable({ kind });  // kind: 'claude' | 'hacker'
  return result.data;  // { marked: bool, kind }
}

// -----------------------------------------------------------
//  getParentShareReport - onRequest endpoint, no auth.
//  Returns a CURATED subset of the user-doc, never email /
//  friendIds / role / etc. (closes Cheat #17).
// -----------------------------------------------------------
const PARENT_SHARE_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/getParentShareReport`;

export async function getParentShareReport(token) {
  const res = await fetch(PARENT_SHARE_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ token })
  });
  if (!res.ok) {
    let msg;
    try { msg = (await res.json()).error || `HTTP ${res.status}`; }
    catch { msg = `HTTP ${res.status}`; }
    throw new Error(`Share-Lookup fehlgeschlagen: ${msg}`);
  }
  return await res.json();
  // shape: { name, klasse, totalGrades, avgGradePerSubject,
  //          xp, level, achievementsCount, streak, createdAt }
}
