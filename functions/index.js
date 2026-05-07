// =============================================================
//  LearningForge Cloud Functions - Mission 3 (Marcus Hayes)
// -------------------------------------------------------------
//  Closes Red-Team-Cycle-1 cheats #2-#7 (server-side enforced)
//  and #17 (curated parent share).
//
//  Architecture:
//    - Firebase Cloud Functions 2nd gen (Cloud Run-based)
//    - Region: europe-west1 (close to Germany)
//    - Runtime: Node 20, ESM (type:module)
//    - Auth: onCall (auto-forwards Firebase auth token)
//    - Exception: getParentShareReport = onRequest (unauth)
//    - Admin SDK for all writes (bypasses rules - this is the
//      trusted server-side path)
//
//  Hard rules respected:
//    - set({...},{merge:true}) for partial writes (rule 4)
//    - No delete() for resets (rule 5)
//    - No raw umlauts in code (rule 3 vibe - "ue/ae/oe")
//    - GitHub raw fetches use ?t=now + cache:'no-store' (rule 6)
//    - enablePersistence() not used (admin SDK doesn't have it)
//
//  REQUIRES: Blaze plan. Adrian flagged this to Simon.
// =============================================================

import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import admin from 'firebase-admin';
import { evaluateServerSide, calcXPForTest } from './lib/evaluation.js';
import { deriveNewAchievements }              from './lib/achievements.js';
import { OUTLINE_TIERS, THEMES, ALL_THEME_IDS,
         outlineTierById, themeById }         from './lib/cosmetics.js';

admin.initializeApp();
const db        = admin.firestore();
const FieldVal  = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

setGlobalOptions({ region: 'europe-west1', maxInstances: 10 });

// =============================================================
//  Whitelist for markTestAccount (Endpoint 4)
// -------------------------------------------------------------
//  Adrian's call: hardcode. If Simon needs more emails, edit
//  here and redeploy. Documented in functions/index.js so it
//  isn't lost.
// =============================================================
const TEST_ACCOUNT_EMAILS = [
  'simonkoper27@gmail.com'
  // Add more emails here if Simon needs additional test
  // accounts. Each email may toggle either kind ('claude' or
  // 'hacker') by calling markTestAccount.
];

// =============================================================
//  Internal helpers
// =============================================================

function _levelFromXp(xp) {
  let l = 1;
  const xpForLvl = n => n <= 1 ? 0 : (n - 1) * 100 + 25 * (n - 1) * (n - 2);
  while (l < 50 && xpForLvl(l + 1) <= (xp || 0)) l++;
  return l;
}

// Mirror of scanner.js getTopicQuestions - server-side fetch with the
// same cache-busting pattern (CLAUDE.md hard rule 6).
async function fetchOfficialQuestions(subjectId, yearId, topicId) {
  // GitHub raw uses URL-encoded "Faecher" path with %C3%A4 for the umlaut.
  const owner  = 'SimonLukas102030';
  const repo   = 'LearningForge';
  const branch = 'master';
  const url    = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`
              + `/F%C3%A4cher/${encodeURIComponent(subjectId)}`
              + `/${encodeURIComponent(yearId)}`
              + `/${encodeURIComponent(topicId)}/questions.json`
              + `?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new HttpsError('not-found',
      `Topic-Fragen nicht gefunden: ${subjectId}/${yearId}/${topicId} (HTTP ${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data?.questions) ? data.questions : [];
}

// =============================================================
//  Endpoint 1 - submitTestResult
// -------------------------------------------------------------
//  Closes cheats #2 (XP), #3 (leaderboard), #6 (achievements),
//  #7 (test forging). Server re-evaluates against the canonical
//  questions JSON and writes all derived state.
// =============================================================
export const submitTestResult = onCall({ enforceAppCheck: false }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.');

  const { subjectId, yearId, topicId, answers, timeSpentSec, isPenalty, timeMinutes } = request.data || {};
  if (!subjectId || !yearId || !topicId) {
    throw new HttpsError('invalid-argument', 'subjectId/yearId/topicId fehlen.');
  }
  if (!Array.isArray(answers)) {
    throw new HttpsError('invalid-argument', 'answers muss ein Array sein.');
  }

  // Cheat #8: custom topics never count for leaderboard. They go down
  // the local-progress-only path (XP/achievements still grant, but
  // leaderboard + dailyScores + feed are skipped).
  const isCustomTopic = subjectId === '_custom'
                     || subjectId === 'meine-inhalte'
                     || (typeof topicId === 'string' && topicId.startsWith('_custom_'));

  // Read user doc - need it for achievement re-derivation + test-account
  // gating + cosmetics ownership context.
  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() : {};

  // Defense-in-depth (rules already filter via getLeaderboard read path):
  // test accounts must not pollute leaderboard / feed / dailyScores.
  const isTestAccount = !!userData.isClaude || !!userData.isHacker;

  // Server-fetch the canonical questions and re-evaluate. For custom
  // topics we cannot fetch from raw CDN (they live in Firestore), so
  // we trust the client-reported per-question shape but clamp +
  // refuse to update the leaderboard. This is intentional: custom
  // topics are local-progress-only.
  let questions = [];
  let evalResult;
  if (isCustomTopic) {
    // Build a synthetic questions array from the client's per-answer
    // metadata so evaluateServerSide can still produce a grade. The
    // client must send {questionIndex, type, points|maxPoints,
    // selectedOriginalIndex, freeText, correct (for MC), keywords (free_text)}.
    // For custom topics: we use the client's reportedPoints clamped to
    // the per-question max. No server-fetch, no CDN dependency.
    questions = (answers || []).map(a => ({
      type:      a.type || 'multiple_choice',
      points:    a.maxPointsForQ || 2,
      maxPoints: a.maxPointsForQ || 4,
      correct:   a.correctOriginal,
      keywords:  []  // empty -> evaluation falls through to "trust capped client report"
    }));
    evalResult = evaluateServerSide(questions, answers, timeMinutes, !!isPenalty);
  } else {
    questions = await fetchOfficialQuestions(subjectId, yearId, topicId);
    if (questions.length === 0) {
      throw new HttpsError('not-found', 'Keine offiziellen Fragen fuer dieses Thema.');
    }
    evalResult = evaluateServerSide(questions, answers, timeMinutes, !!isPenalty);
  }

  const total = evalResult.points;
  const max   = evalResult.maxPoints;
  const grade = evalResult.grade;
  const xpAwarded = isPenalty ? 5 : calcXPForTest(grade);

  // -----------------------------------------------------------
  //  Build the new grade entry (mirrors app.js submitTest logic)
  // -----------------------------------------------------------
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
  const gradeEntry = {
    grade:         bestGrade,
    bestPoints:    bestRun.points,
    bestMaxPoints: bestRun.maxPoints,
    history,
    date:          FieldVal.serverTimestamp()
  };

  // -----------------------------------------------------------
  //  Project the new user-doc state for achievement derivation
  //  (we recompute as if the writes had landed - that lets the
  //  achievement check.fns "see" the new totals).
  // -----------------------------------------------------------
  const projectedGrades = { ...(userData.grades || {}), [gradeKey]: gradeEntry };
  const projectedQAns   = (userData.totalQuestionsAnswered || 0) + (answers?.length || 0);
  const projectedXp     = (userData.xp || 0) + xpAwarded;
  const projectedUser   = {
    ...userData,
    grades: projectedGrades,
    totalQuestionsAnswered: projectedQAns,
    xp: projectedXp
  };

  // Achievement context (mirrors client app.js submitTest).
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
    subjectComplete: false  // server cannot cheaply verify "all topics tested"; client-only metric
  };

  const { newlyUnlocked, bonusXP } = deriveNewAchievements(projectedUser, ctx);

  // -----------------------------------------------------------
  //  Atomic batch write
  // -----------------------------------------------------------
  const batch = db.batch();

  // 1) users/{uid} - grade + xp + counter + (maybe) achievements
  const userPatch = {
    [`grades.${gradeKey}`]:        gradeEntry,
    xp:                            FieldVal.increment(xpAwarded + bonusXP),
    [`xpLog.${todayKey}`]:         FieldVal.increment(xpAwarded + bonusXP),
    totalQuestionsAnswered:        FieldVal.increment(answers?.length || 0)
  };
  if (newlyUnlocked.length > 0) {
    userPatch.achievements = FieldVal.arrayUnion(...newlyUnlocked);
  }
  batch.set(userRef, userPatch, { merge: true });

  // 2) leaderboard/{uid} - only for non-custom, non-test-account
  let leaderboardUpdated = false;
  if (!isCustomTopic && !isTestAccount) {
    const lbRef = db.collection('leaderboard').doc(uid);
    const lbSnap = await lbRef.get();
    const lbData = lbSnap.exists ? lbSnap.data() : {};
    const existingScore = lbData.scores?.[gradeKey] || 0;
    const newScore      = Math.max(existingScore, bestRun.points);

    const lbPatch = {
      displayName:   userData.name || 'Nutzer',
      photoURL:      userData.photoURL || null,
      scores:        { [gradeKey]: newScore },
      klasse:        userData.klasse != null ? String(userData.klasse) : null,
      activeOutline: userData.activeOutline || null,
      activeTheme:   userData.activeTheme   || null,
      xp:            projectedXp,
      role:          userData.role || null,
      streak:        userData.streakCount || 0,
      studyMins:     Object.values(userData.studyTime || {}).reduce((a, b) => a + b, 0),
      isClaude:      !!userData.isClaude,
      isHacker:      !!userData.isHacker,
      updatedAt:     FieldVal.serverTimestamp()
    };
    batch.set(lbRef, lbPatch, { merge: true });
    leaderboardUpdated = true;
  }

  // 3) feed entry - non-custom, non-test-account
  if (!isCustomTopic && !isTestAccount) {
    const feedRef = db.collection('feed').doc();
    batch.set(feedRef, {
      uid,
      type: 'test',
      payload: {
        name:    userData.name || 'Nutzer',
        subject: subjectId,
        topic:   topicId,
        grade:   bestGrade
      },
      createdAt: FieldVal.serverTimestamp()
    });
  }

  await batch.commit();

  return {
    grade:               grade,
    points:              total,
    max:                 max,
    xpAwarded:           xpAwarded + bonusXP,
    achievementsGranted: newlyUnlocked,
    leaderboardUpdated
  };
});

// =============================================================
//  Endpoint 2 - unlockCosmetic
// -------------------------------------------------------------
//  Closes Cheat #5. Server validates the unlock criteria
//  (outline level gate / theme drop history) before
//  arrayUnion-ing into users/{uid}.outlines or .themes.
// =============================================================
export const unlockCosmetic = onCall({ enforceAppCheck: false }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.');

  const { kind, id } = request.data || {};
  if (!kind || !id) throw new HttpsError('invalid-argument', 'kind/id fehlen.');
  if (kind !== 'theme' && kind !== 'outline') {
    throw new HttpsError('invalid-argument', 'kind muss "theme" oder "outline" sein.');
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User-Doc fehlt.');
  const userData = userSnap.data();

  if (kind === 'outline') {
    const tier = outlineTierById(id);
    if (!tier) return { unlocked: false, reason: 'Unbekannte Outline.' };
    const lvl = _levelFromXp(userData.xp || 0);
    if (lvl < tier.level) {
      return { unlocked: false, reason: `Level ${tier.level} noetig (aktuell ${lvl}).` };
    }
    if ((userData.outlines || []).includes(id)) {
      return { unlocked: true, reason: 'Bereits freigeschaltet.' };
    }
    await userRef.set({ outlines: FieldVal.arrayUnion(id) }, { merge: true });
    return { unlocked: true, reason: `Outline "${id}" freigeschaltet.` };
  }

  // kind === 'theme'
  const theme = themeById(id);
  if (!theme) return { unlocked: false, reason: 'Unbekanntes Theme.' };
  // Default theme is free for everyone.
  if (theme.default) {
    if (!(userData.themes || []).includes(id)) {
      await userRef.set({ themes: FieldVal.arrayUnion(id) }, { merge: true });
    }
    return { unlocked: true, reason: 'Standard-Theme.' };
  }
  // Other themes: must be in user's themeDrops history (rolled by the
  // client's rollThemeDrop, which is itself an honor-system path -
  // long-term Simon may want to move the drop roll server-side too).
  // For Mission 3 we accept "drop history present in users.themeDrops".
  // If the user already owns it, treat as success (idempotent).
  if ((userData.themes || []).includes(id)) {
    return { unlocked: true, reason: 'Bereits freigeschaltet.' };
  }
  const dropHistory = userData.themeDrops || [];
  if (Array.isArray(dropHistory) && dropHistory.includes(id)) {
    await userRef.set({ themes: FieldVal.arrayUnion(id) }, { merge: true });
    return { unlocked: true, reason: `Theme "${id}" freigeschaltet (Drop).` };
  }
  return { unlocked: false, reason: 'Theme nicht erspielt (Drop fehlt).' };
});

// =============================================================
//  Endpoint 3 - getParentShareReport (UNAUTH)
// -------------------------------------------------------------
//  Closes Cheat #17. Returns ONLY a curated subset, never the
//  full user-doc. Implemented as onRequest (HTTP) so parents
//  without a Firebase account can call it.
// =============================================================
export const getParentShareReport = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST erforderlich.' });
    return;
  }
  try {
    const token = req.body?.token;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'token fehlt.' });
      return;
    }
    const linkSnap = await db.collection('shareLinks').doc(token).get();
    if (!linkSnap.exists) {
      res.status(404).json({ error: 'Share-Link unbekannt oder abgelaufen.' });
      return;
    }
    const uid = linkSnap.data().uid;
    if (!uid) {
      res.status(404).json({ error: 'Share-Link unvollstaendig.' });
      return;
    }

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) {
      res.status(404).json({ error: 'Nutzer existiert nicht mehr.' });
      return;
    }
    const u = userSnap.data();

    // Curated payload - explicitly NEVER include: email, friendIds,
    // friendRequests, role, isBanned, isClaude, isHacker, lastStreakDate,
    // settings, srs, weakQuestions, themeDrops, photoURL (privacy).
    const grades = u.grades || {};
    const gradeEntries = Object.entries(grades);
    const totalGrades = gradeEntries.length;

    // Average grade per subject (subject = first segment of "subject__year__topic" key).
    const perSubject = {};
    for (const [key, g] of gradeEntries) {
      const subject = String(key).split('__')[0];
      if (!subject) continue;
      if (!perSubject[subject]) perSubject[subject] = { sum: 0, count: 0 };
      const gradeNum = Number(g.grade) || 0;
      if (gradeNum >= 1 && gradeNum <= 6) {
        perSubject[subject].sum += gradeNum;
        perSubject[subject].count += 1;
      }
    }
    const avgGradePerSubject = {};
    for (const [s, agg] of Object.entries(perSubject)) {
      avgGradePerSubject[s] = agg.count > 0
        ? Math.round((agg.sum / agg.count) * 10) / 10
        : null;
    }

    const xp = Number(u.xp) || 0;
    const level = _levelFromXp(xp);

    res.status(200).json({
      name:              u.name || 'Schueler',
      klasse:            u.klasse != null ? String(u.klasse) : null,
      totalGrades,
      avgGradePerSubject,
      xp,
      level,
      achievementsCount: (u.achievements || []).length,
      streak:            u.streakCount || 0,
      createdAt:         u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : null
    });
  } catch (err) {
    console.error('[getParentShareReport]', err);
    res.status(500).json({ error: 'Interner Fehler.' });
  }
});

// =============================================================
//  Endpoint 4 - markTestAccount
// -------------------------------------------------------------
//  Replaces the old client-side markAsClaude / markAsHacker.
//  Server validates that the caller's email is on the hardcoded
//  TEST_ACCOUNT_EMAILS whitelist before flipping isClaude/
//  isHacker + role:'admin'. Mirrors to leaderboard.
// =============================================================
export const markTestAccount = onCall({ enforceAppCheck: false }, async (request) => {
  const uid = request.auth?.uid;
  const email = request.auth?.token?.email;
  if (!uid) throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.');
  if (!email || !TEST_ACCOUNT_EMAILS.includes(email)) {
    throw new HttpsError('permission-denied', 'Diese Email ist nicht fuer Test-Accounts freigegeben.');
  }

  const { kind } = request.data || {};
  if (kind !== 'claude' && kind !== 'hacker') {
    throw new HttpsError('invalid-argument', 'kind muss "claude" oder "hacker" sein.');
  }

  const userPatch = { role: 'admin' };
  const lbPatch   = {};
  if (kind === 'claude') {
    userPatch.isClaude = true;
    userPatch.name     = 'Claude (Test)';
    lbPatch.isClaude   = true;
    lbPatch.displayName = 'Claude (Test)';
  } else {
    userPatch.isHacker = true;
    userPatch.name     = 'Hacker (Test)';
    lbPatch.isHacker   = true;
    lbPatch.displayName = 'Hacker (Test)';
  }

  await db.collection('users').doc(uid).set(userPatch, { merge: true });
  await db.collection('leaderboard').doc(uid).set(lbPatch, { merge: true }).catch(() => {});

  return { marked: true, kind };
});
