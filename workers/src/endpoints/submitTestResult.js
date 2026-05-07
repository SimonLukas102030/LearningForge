// =============================================================
//  Endpoint - submitTestResult
// -------------------------------------------------------------
//  Direct port of functions/index.js submitTestResult.
//
//  Closes Red-Team Cycle-1 cheats #2 (XP), #3 (leaderboard),
//  #6 (achievements), #7 (test forging).
//
//  Flow:
//    1. Verify Firebase ID token (Authorization: Bearer ...)
//    2. Parse + validate body
//    3. Determine custom vs official topic
//    4. Fetch canonical questions from raw GitHub (cache-busted
//       per Hard Rule 6) OR build synthetic for custom
//    5. evaluateServerSide -> grade + per-question points
//    6. Re-derive achievements against PROJECTED user state
//    7. Build a single :commit payload with N writes:
//         - users/{uid}            (grades + xp + counters)
//         - leaderboard/{uid}      (skipped for custom/test-account)
//         - feed/{auto}            (skipped for custom/test-account)
//    8. Return {grade, points, max, xpAwarded, ...}
// =============================================================

import { requireAuth }                 from '../lib/auth.js';
import { readJsonBody, httpError }     from '../lib/http.js';
import {
  firestoreGet,
  firestoreCommit,
  buildWriteFor,
  serverTimestamp,
  arrayUnion,
  incrementValue
} from '../lib/firestore.js';
import { evaluateServerSide, calcXPForTest } from '../lib/evaluation.js';
import { deriveNewAchievements }             from '../lib/achievements.js';

function _levelFromXp(xp) {
  let l = 1;
  const xpForLvl = n => n <= 1 ? 0 : (n - 1) * 100 + 25 * (n - 1) * (n - 2);
  while (l < 50 && xpForLvl(l + 1) <= (xp || 0)) l++;
  return l;
}

// Mirror of scanner.js getTopicQuestions - server-side fetch with the
// same cache-busting pattern (Hard Rule 6).
async function fetchOfficialQuestions(subjectId, yearId, topicId) {
  const owner  = 'SimonLukas102030';
  const repo   = 'LearningForge';
  const branch = 'master';
  // GitHub raw uses URL-encoded "Faecher" path with %C3%A4 for the umlaut.
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`
            + `/F%C3%A4cher/${encodeURIComponent(subjectId)}`
            + `/${encodeURIComponent(yearId)}`
            + `/${encodeURIComponent(topicId)}/questions.json`
            + `?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw httpError(404,
      `Topic-Fragen nicht gefunden: ${subjectId}/${yearId}/${topicId} (HTTP ${res.status}).`);
  }
  const data = await res.json();
  return Array.isArray(data?.questions) ? data.questions : [];
}

export async function handleSubmitTestResult(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid } = await requireAuth(request, env);
  const body    = await readJsonBody(request);
  const {
    subjectId, yearId, topicId,
    answers, isPenalty, timeMinutes
    // timeSpentSec exists in the contract but is unused server-side.
  } = body || {};

  if (!subjectId || !yearId || !topicId) {
    throw httpError(400, 'subjectId/yearId/topicId fehlen.');
  }
  if (!Array.isArray(answers)) {
    throw httpError(400, 'answers muss ein Array sein.');
  }

  // Cheat #8: custom topics never count for leaderboard.
  const isCustomTopic = subjectId === '_custom'
                     || subjectId === 'meine-inhalte'
                     || (typeof topicId === 'string' && topicId.startsWith('_custom_'));

  // Read user doc - need it for achievement re-derivation +
  // test-account gating + leaderboard mirror fields.
  const userDoc  = await firestoreGet(env, `users/${uid}`);
  const userData = userDoc?.fields || {};
  const isTestAccount = !!userData.isClaude || !!userData.isHacker;

  // Server-fetch the canonical questions and re-evaluate.
  let questions, evalResult;
  if (isCustomTopic) {
    questions = (answers || []).map(a => ({
      type:      a.type || 'multiple_choice',
      points:    a.maxPointsForQ || 2,
      maxPoints: a.maxPointsForQ || 4,
      correct:   a.correctOriginal,
      keywords:  []
    }));
    evalResult = evaluateServerSide(questions, answers, timeMinutes, !!isPenalty);
  } else {
    questions = await fetchOfficialQuestions(subjectId, yearId, topicId);
    if (questions.length === 0) {
      throw httpError(404, 'Keine offiziellen Fragen fuer dieses Thema.');
    }
    evalResult = evaluateServerSide(questions, answers, timeMinutes, !!isPenalty);
  }

  const total = evalResult.points;
  const max   = evalResult.maxPoints;
  const grade = evalResult.grade;
  const xpAwarded = isPenalty ? 5 : calcXPForTest(grade);

  // Build the new grade entry (mirrors app.js submitTest logic).
  const gradeKey = `${subjectId}__${yearId}__${topicId}`;
  const existingGrade = userData.grades?.[gradeKey] || {};
  const attempt = {
    points:    total,
    maxPoints: max,
    grade:     grade,
    date:      new Date().toISOString()
  };
  const history = [...(existingGrade.history || []), attempt];
  const bestRun = history.reduce((best, h) =>
    (h.points / Math.max(1, h.maxPoints)) > (best.points / Math.max(1, best.maxPoints)) ? h : best,
    history[0]
  );
  const bestGrade = (() => {
    const pct = bestRun.maxPoints > 0 ? bestRun.points / bestRun.maxPoints : 0;
    if (pct >= 0.875) return 1;
    if (pct >= 0.750) return 2;
    if (pct >= 0.625) return 3;
    if (pct >= 0.500) return 4;
    if (pct >= 0.250) return 5;
    return 6;
  })();
  // Note: REST API doesn't allow nesting a serverTimestamp transform
  // inside a map field via :commit (transforms can only target top-level
  // field paths). So we use an ISO string here for grades.<key>.date.
  // The app.js client does the same in its existing path.
  const gradeEntry = {
    grade:         bestGrade,
    bestPoints:    bestRun.points,
    bestMaxPoints: bestRun.maxPoints,
    history,
    date:          new Date().toISOString()
  };

  // Project the new user-doc state for achievement derivation.
  const projectedGrades = { ...(userData.grades || {}), [gradeKey]: gradeEntry };
  const projectedQAns   = (userData.totalQuestionsAnswered || 0) + (answers?.length || 0);
  const projectedXp     = (userData.xp || 0) + xpAwarded;
  const projectedUser   = {
    ...userData,
    grades: projectedGrades,
    totalQuestionsAnswered: projectedQAns,
    xp: projectedXp
  };

  const todayKey = new Date().toISOString().slice(0, 10);
  const testsToday = Object.values(projectedGrades)
    .filter(g => {
      const d = (g.history || []).slice(-1)[0]?.date;
      return typeof d === 'string' && d.slice(0, 10) === todayKey;
    }).length;

  const ctx = {
    streak:          userData.streakCount || 0,
    hour:            new Date().getHours(),
    perfect:         !isPenalty && total === max && max > 0,
    testsToday,
    subjectComplete: false  // server cannot cheaply verify
  };

  const { newlyUnlocked, bonusXP } = deriveNewAchievements(projectedUser, ctx);
  const totalXpDelta = xpAwarded + bonusXP;

  // -----------------------------------------------------------
  //  Build the batched :commit payload
  // -----------------------------------------------------------
  const writes = [];

  // 1) users/{uid} - grade + xp + counter + (maybe) achievements.
  //    We use dot-paths in the updateMask so existing grades.* keys
  //    aren't wiped (Hard Rule 4 - no full-doc overwrite).
  const userSet = {
    [`grades.${gradeKey}`]:  gradeEntry,
    xp:                      incrementValue(totalXpDelta),
    [`xpLog.${todayKey}`]:   incrementValue(totalXpDelta),
    totalQuestionsAnswered:  incrementValue(answers?.length || 0)
  };
  if (newlyUnlocked.length > 0) {
    userSet.achievements = arrayUnion(newlyUnlocked);
  }
  writes.push(buildWriteFor(env, `users/${uid}`, userSet));

  // 2) leaderboard/{uid} - non-custom, non-test-account only.
  let leaderboardUpdated = false;
  if (!isCustomTopic && !isTestAccount) {
    const lbDoc  = await firestoreGet(env, `leaderboard/${uid}`);
    const lbData = lbDoc?.fields || {};
    const existingScore = lbData.scores?.[gradeKey] || 0;
    const newScore      = Math.max(existingScore, bestRun.points);
    const studyMinsTotal = Object.values(userData.studyTime || {}).reduce((a, b) => a + b, 0);

    writes.push(buildWriteFor(env, `leaderboard/${uid}`, {
      displayName:            userData.name || 'Nutzer',
      photoURL:               userData.photoURL || null,
      [`scores.${gradeKey}`]: newScore,
      klasse:                 userData.klasse != null ? String(userData.klasse) : null,
      activeOutline:          userData.activeOutline || null,
      activeTheme:            userData.activeTheme   || null,
      xp:                     projectedXp,
      role:                   userData.role || null,
      streak:                 userData.streakCount || 0,
      studyMins:              studyMinsTotal,
      isClaude:               !!userData.isClaude,
      isHacker:               !!userData.isHacker,
      updatedAt:              serverTimestamp()
    }));
    leaderboardUpdated = true;
  }

  // 3) feed/{auto} - non-custom, non-test-account only.
  if (!isCustomTopic && !isTestAccount) {
    // Auto-IDs in :commit: we generate a 20-char Firestore-compatible ID
    // here so we can include the feed write in the same batch as the
    // user/leaderboard writes (atomic from the client's perspective).
    const feedId = generateAutoId();
    writes.push(buildWriteFor(env, `feed/${feedId}`, {
      uid,
      type: 'test',
      payload: {
        name:    userData.name || 'Nutzer',
        subject: subjectId,
        topic:   topicId,
        grade:   bestGrade
      },
      createdAt: serverTimestamp()
    }));
  }

  await firestoreCommit(env, writes);

  return {
    grade,
    points:              total,
    max,
    xpAwarded:           totalXpDelta,
    achievementsGranted: newlyUnlocked,
    leaderboardUpdated,
    dailyUpdated:        false  // not currently written here; client owns dailyScores
  };
}

// Same alphabet/length as the client SDK's auto-ID for visual consistency
// in the Firestore console.
function generateAutoId() {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += ALPHA[buf[i] % ALPHA.length];
  return out;
}
