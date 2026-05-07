// =============================================================
//  Endpoint - submitDailyChallenge
// -------------------------------------------------------------
//  Mission 9 — closes Cheat #4 (correct-indices in client).
//
//  Flow:
//    1. Verify Firebase ID token
//    2. Parse {date: 'YYYY-MM-DD', answers: [...]}
//    3. Look up the day's challenge from server-side store
//    4. Block double-submit (one submission per uid+date)
//    5. Re-evaluate every answer against server-side `correct`
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
//      dailyPerfect:        bool
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
import { getDailyChallenge } from '../lib/daily-challenges.js';
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

export async function handleSubmitDailyChallenge(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid } = await requireAuth(request, env);
  const body    = await readJsonBody(request);
  const { date, answers } = body || {};

  if (!_validDateKey(date)) {
    throw httpError(400, 'date muss YYYY-MM-DD sein.');
  }
  if (!Array.isArray(answers)) {
    throw httpError(400, 'answers muss ein Array sein.');
  }

  const challenge = getDailyChallenge(date);
  if (!challenge) {
    throw httpError(404, `Keine Daily-Challenge fuer ${date}.`);
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
    dailyPerfect:        perfect
  };
}
