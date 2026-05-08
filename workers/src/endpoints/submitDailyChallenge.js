// =============================================================
//  Endpoint - submitDailyChallenge
// -------------------------------------------------------------
//  Mission 9 — closes Cheat #4 (correct-indices in client).
//  B4 fix (2026-05-08, Marcus): adds a dynamic-trust-frontend
//  fallback for non-curated dates (the curated map only covered
//  2026-04-22 → 2026-04-28; everything after that hit a 404 on
//  every submit). Backfilling several months of curated content
//  doesn't scale, and the cheat-vector here is moot — every
//  questions.json under Fächer/** is publicly readable on
//  raw.githubusercontent.com (the frontend's dynamic generator
//  in app.js:4988 reads from the same pool), so the answer-key is
//  already public for non-curated days. The Mission-9 secrecy
//  guarantee still holds for CURATED days (server map untouched).
//
//  Path selection:
//    - If `getDailyChallengeRaw(date)` returns a curated array:
//        Mission-9 path. Server holds `correct`. Frontend-supplied
//        `correct` (if any) is ignored. Eval uses server map.
//    - Else (non-curated): trust-frontend path. Body must include
//        `questions[]` with each entry having `{type, options[],
//        correct, points}`. Schema validation is strict (max 10
//        questions, 2-6 options each, 1-3 points each, etc.). The
//        server evaluates against the supplied `correct` index.
//
//  Flow:
//    1. Verify Firebase ID token
//    2. Parse {date, answers, [questions]}
//    3. Pick curated map OR validate frontend-supplied questions
//    4. Block double-submit (one submission per uid+date)
//    5. Re-evaluate every answer (curated) / accept frontend
//       answer-key (dynamic) — XP/achievement bounding identical
//    6. Compute grade + points + xp + achievements
//    7. Atomic batch:
//         - dailyScores/{date}/users/{uid}      (create+set)
//         - users/{uid}.xp + xpLog              (increment)
//         - users/{uid}.dailyChallengesCompleted (increment)
//         - users/{uid}.achievements             (arrayUnion)
//    8. Return {grade, points, max, xpAwarded, achievementsGranted, ...}
//
//  Body shape:
//    {
//      date: 'YYYY-MM-DD',
//      answers: [
//        { questionIndex: 0, selectedOriginalIndex: 2 },
//        ...
//      ],
//      // OPTIONAL — only required for non-curated dates:
//      questions: [
//        { id, type: 'multiple_choice', options: [...], correct: <int>, points: <1..3> },
//        ...
//      ]
//    }
//
//  Response shape:
//    {
//      grade:               1..6,
//      points:              number,
//      max:                 number,
//      xpAwarded:           number,
//      achievementsGranted: string[],
//      dailyPerfect:        bool,
//      source:              'curated' | 'dynamic'    // for client debug
//    }
// =============================================================

import { requireAuth }                from '../lib/auth.js';
import { readJsonBody, httpError }    from '../lib/http.js';
import {
  firestoreGet,
  firestoreCommit,
  buildWriteFor,
  serverTimestamp,
  arrayUnion,
  incrementValue
} from '../lib/firestore.js';
// Use the RAW (un-balanced) curated map for evaluation. The user saw
// these options as-is on their device; balancing for eval would not
// help the user. The balanced version is for read-only/display
// endpoints (none today — gated for Mission 3+).
import { getDailyChallengeRaw } from '../lib/daily-challenges.js';
import { calcGrade }         from '../lib/evaluation.js';
import { deriveNewAchievements } from '../lib/achievements.js';

// XP grant per daily-challenge completion. Aligned with the existing
// frontend dcSubmit() reward (~50-90 XP depending on score). We grant
// per-question points proportional to grade — no extra padding.
function _xpForDaily(grade, perfect) {
  // Note 1 -> 80, Note 2 -> 60, Note 3 -> 40, Note 4 -> 25, Note 5+ -> 10
  const base = Math.max(10, (7 - grade) * 15);
  return base + (perfect ? 20 : 0);
}

function _validDateKey(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// B4: schema-validate frontend-supplied questions for the dynamic path.
// Throws httpError(400) on first violation. Returns a SANITIZED array
// (each entry stripped to the fields we trust + use server-side).
//
// Caps:
//   - max 10 questions per submit (matches frontend slice in app.js:5034)
//   - each MC: 2..6 options, all non-empty strings, correct in range
//   - points clamped to 1..3 (frontend default is 2; cap above 3 would
//     let a malicious client farm XP — XP grant uses _xpForDaily(grade)
//     which is grade-based, not points-based, but max(points)/sum is
//     used downstream for grade calc, so per-question caps are still
//     necessary)
//   - only `multiple_choice` accepted today; future free-text would need
//     its own validator + an accept-list of evaluation strategies
const MAX_QUESTIONS_DYNAMIC = 10;
const MAX_OPTIONS  = 6;
const MIN_OPTIONS  = 2;
const MAX_POINTS_PER_Q = 3;

function _validateAndSanitizeFrontendQuestions(arr) {
  if (!Array.isArray(arr)) {
    throw httpError(400, 'questions[] erforderlich fuer nicht-kuratierte Tage.');
  }
  if (arr.length === 0) {
    throw httpError(400, 'questions[] darf nicht leer sein.');
  }
  if (arr.length > MAX_QUESTIONS_DYNAMIC) {
    throw httpError(400, `questions[] zu lang (max ${MAX_QUESTIONS_DYNAMIC}).`);
  }
  const cleaned = [];
  for (let i = 0; i < arr.length; i++) {
    const q = arr[i];
    if (!q || typeof q !== 'object') {
      throw httpError(400, `questions[${i}] ist kein Objekt.`);
    }
    if (q.type !== 'multiple_choice') {
      throw httpError(400, `questions[${i}].type muss 'multiple_choice' sein.`);
    }
    if (!Array.isArray(q.options) || q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) {
      throw httpError(400, `questions[${i}].options muss ein Array mit ${MIN_OPTIONS}..${MAX_OPTIONS} Eintraegen sein.`);
    }
    for (let j = 0; j < q.options.length; j++) {
      if (typeof q.options[j] !== 'string' || q.options[j].length === 0) {
        throw httpError(400, `questions[${i}].options[${j}] muss ein nicht-leerer String sein.`);
      }
    }
    if (!Number.isInteger(q.correct) || q.correct < 0 || q.correct >= q.options.length) {
      throw httpError(400, `questions[${i}].correct muss ein Index 0..${q.options.length - 1} sein.`);
    }
    const pts = Number.isFinite(q.points) ? q.points : 2;
    const ptsClamped = Math.max(1, Math.min(MAX_POINTS_PER_Q, Math.round(pts)));
    cleaned.push({
      id:      typeof q.id === 'string' ? q.id : `dyn_${i}`,
      type:    'multiple_choice',
      options: q.options.map(s => String(s)),
      correct: q.correct,
      points:  ptsClamped
    });
  }
  return cleaned;
}

export async function handleSubmitDailyChallenge(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid } = await requireAuth(request, env);
  const body    = await readJsonBody(request);
  const { date, answers, questions: frontendQuestions } = body || {};

  if (!_validDateKey(date)) {
    throw httpError(400, 'date muss YYYY-MM-DD sein.');
  }
  if (!Array.isArray(answers)) {
    throw httpError(400, 'answers muss ein Array sein.');
  }

  // B4 path-selection: curated map first (server holds `correct`), else
  // accept frontend-supplied questions for non-curated dates.
  let challenge;
  let source;
  const curated = getDailyChallengeRaw(date);
  if (curated) {
    challenge = curated;
    source = 'curated';
  } else {
    challenge = _validateAndSanitizeFrontendQuestions(frontendQuestions);
    source = 'dynamic';
    // Log dynamic-path submits so unusual patterns (1000 submits/day, all
    // grade-1, payload anomalies) are visible in the Cloudflare Workers
    // dashboard. cf-logs are queryable via wrangler tail.
    console.log(`[submitDailyChallenge] dynamic-path uid=${uid} date=${date} qcount=${challenge.length}`);
  }

  // ── Double-submit check ────────────────────────────────────────────────
  // dailyScores/{date}/users/{uid} is the source of truth. If the doc
  // exists -> reject with 409 Conflict. Service-account read; no ACL issue.
  const existingDoc = await firestoreGet(env, `dailyScores/${date}/users/${uid}`);
  if (existingDoc) {
    throw httpError(409, 'Daily-Challenge bereits abgegeben fuer diesen Tag.');
  }

  // ── Server-side evaluation ─────────────────────────────────────────────
  let points = 0;
  let max    = 0;
  for (const q of challenge) {
    max += (q.points || 2);
  }

  // Build a map questionIndex -> answer for O(1) lookup.
  const answerMap = new Map();
  for (const a of answers) {
    if (Number.isInteger(a?.questionIndex)) {
      answerMap.set(a.questionIndex, a);
    }
  }

  for (let i = 0; i < challenge.length; i++) {
    const q = challenge[i];
    const a = answerMap.get(i);
    if (!a) continue;
    if (q.type === 'multiple_choice') {
      const sel = a.selectedOriginalIndex;
      if (Number.isInteger(sel) && sel === q.correct) {
        points += (q.points || 2);
      }
    }
    // (other types not used in current daily-challenges.js — extend here
    //  if Maya/Adrian add free-text or vocab daily challenges later)
  }

  const gradeInfo = calcGrade(points, max);
  const grade     = gradeInfo.grade;
  const perfect   = (points === max && max > 0);
  const xpAwarded = _xpForDaily(grade, perfect);

  // ── User-doc fetch for achievement re-derivation ───────────────────────
  const userDoc  = await firestoreGet(env, `users/${uid}`);
  const userData = userDoc?.fields || {};

  const projectedDailyDone = (userData.dailyChallengesCompleted || 0) + 1;
  const projectedXp        = (userData.xp || 0) + xpAwarded;
  const projectedUser = {
    ...userData,
    xp:                       projectedXp,
    dailyChallengesCompleted: projectedDailyDone
  };

  const ctx = {
    streak:       userData.streakCount || 0,
    hour:         new Date().getHours(),
    dailyPerfect: perfect,
    perfect:      false,        // perfect-test flag is for tests, not dailies
    testsToday:   0
  };

  const { newlyUnlocked, bonusXP } = deriveNewAchievements(projectedUser, ctx);
  const totalXpDelta = xpAwarded + bonusXP;

  // ── Build the batched :commit payload ──────────────────────────────────
  const todayKey = new Date().toISOString().slice(0, 10);
  const writes = [];

  // 1) dailyScores/{date}/users/{uid}
  writes.push(buildWriteFor(env, `dailyScores/${date}/users/${uid}`, {
    points:      points,
    maxPoints:   max,
    grade:       grade,
    perfect:     perfect,
    submittedAt: serverTimestamp(),
    displayName: userData.name || 'Nutzer',
    photoURL:    userData.photoURL || null,
    klasse:      userData.klasse != null ? String(userData.klasse) : null
  }));

  // 2) users/{uid} — xp + counter + achievements
  const userSet = {
    xp:                                     incrementValue(totalXpDelta),
    [`xpLog.${todayKey}`]:                  incrementValue(totalXpDelta),
    dailyChallengesCompleted:               incrementValue(1),
    [`dailyChallenges.${date}`]: {
      points,
      maxPoints: max,
      grade,
      perfect,
      submittedAt: new Date().toISOString()
    }
  };
  if (newlyUnlocked.length > 0) {
    userSet.achievements = arrayUnion(newlyUnlocked);
  }
  writes.push(buildWriteFor(env, `users/${uid}`, userSet));

  await firestoreCommit(env, writes);

  return {
    grade,
    points,
    max,
    xpAwarded:           totalXpDelta,
    achievementsGranted: newlyUnlocked,
    dailyPerfect:        perfect,
    source                // 'curated' | 'dynamic' — for client debug/tests
  };
}
