// =============================================================
//  Endpoint - submitTestResult
// -------------------------------------------------------------
//  Direct port of functions/index.js submitTestResult.
//
//  Closes Red-Team Cycle-1 cheats #2 (XP), #3 (leaderboard),
//  #6 (achievements), #7 (test forging).
//
//  Mission 7 (Variant B): theme drop-roll moved server-side. The
//  endpoint rolls a drop on Note 1/2 (real test, non-test-account),
//  applies the result atomically, and returns a `themeDrop` shape
//  for Ethan's frontend to toast.
//
//  Flow:
//    1. Verify Firebase ID token (Authorization: Bearer ...)
//    2. Parse + validate body
//    3. Determine custom vs official topic
//    4. Fetch canonical questions from raw GitHub (cache-busted
//       per Hard Rule 6) OR build synthetic for custom
//    5. evaluateServerSide -> grade + per-question points
//    6. Re-derive achievements against PROJECTED user state
//    7. Mission 7: roll theme drop (only Note 1/2, real, non-tester).
//       Outcomes: trostpreis (+30 XP) | new theme (arrayUnion) |
//       double-drop (+RARITY_XP) | no-drop.
//    8. Build a single :commit payload with N writes:
//         - users/{uid}            (grades + xp + counters + theme)
//         - leaderboard/{uid}      (skipped for custom/test-account)
//         - feed/{auto}            (skipped for custom/test-account)
//    9. Return {grade, points, max, xpAwarded, themeDrop, trostpreis, ...}
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
import {
  rollThemeDrop,
  themeById,
  RARITY_XP,
  ALL_THEME_IDS
} from '../lib/cosmetics.js';

// Mission 7 (Maya's Q4): user with all 11 themes owned -> +30 XP
// per Note-1/2 test as a "trostpreis" (consolation prize).
const TROSTPREIS_XP = 30;

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

  // -----------------------------------------------------------
  //  Mission 7: Server-side drop-roll (Variant B)
  // -----------------------------------------------------------
  //  Rolls a theme drop iff grade is 1 or 2. Three outcomes:
  //    a) all 11 themes owned -> trostpreis: +30 XP, themeDrop=null
  //    b) drop rolled, theme NOT owned -> arrayUnion + unlocked:true
  //    c) drop rolled, theme already owned -> +RARITY_XP, alreadyOwned:true
  //    d) no roll (rng landed in no-drop slice) -> themeDrop=null, no XP
  //  Test-account: skip the drop entirely (no leaderboard, no themeDrops
  //  for testers — matches existing behaviour for tester accounts).
  // -----------------------------------------------------------
  let themeDropResult = null;   // shape: {themeId, rarity, alreadyOwned, xpGranted}
  let trostpreisXp    = 0;
  let themeDropXp     = 0;
  const ownedThemes   = Array.isArray(userData.themes) ? userData.themes : ['default'];
  const allThemesOwned = ALL_THEME_IDS.every(t => ownedThemes.includes(t));

  // Drop-gate: real test (not custom), not a test-account, and Note 1/2.
  // Custom-topic drops would be trivially farmable (user authors the
  // questions and answers them perfectly) - Cheat #8-class issue.
  //
  // Gate A (anti-grind, min-effort): max < 20 Punkte = trivialer Test
  // (z.B. 1-3-Fragen-Custom-Topic der nicht ueber den isCustomTopic-Flag
  // erfasst wurde, oder ein winziges offizielles Topic). Solche Tests
  // zaehlen nicht als "echtes Grinden" - kein Drop-Roll.
  //
  // Gate B (anti-grind, per-topic cooldown): dasselbe Topic darf max.
  // einmal pro 24h einen Drop-Roll ausloesen. Verhindert Stumpf-Wiederholung
  // des leichtesten Tests. Der Cooldown-Stempel wird gesetzt sobald ein
  // Drop tatsaechlich gerollt wurde (Unlock ODER Doppel-Drop) - wer in den
  // No-Drop-Slice rollt, bleibt eligible fuer den naechsten Versuch.
  const MIN_DROP_MAX_POINTS = 20;
  const TOPIC_COOLDOWN_MS   = 24 * 60 * 60 * 1000;
  const topicCooldownKey    = `${subjectId}__${yearId}__${topicId}`;
  const lastTopicDropTs     = userData.topicDropCooldowns?.[topicCooldownKey] || 0;
  const topicOnCooldown     = lastTopicDropTs > 0
                              && (Date.now() - lastTopicDropTs) < TOPIC_COOLDOWN_MS;
  const meetsMinEffort      = max >= MIN_DROP_MAX_POINTS;

  if (!isCustomTopic && !isTestAccount && (grade === 1 || grade === 2)
      && meetsMinEffort && !topicOnCooldown) {
    if (allThemesOwned) {
      // (a) Trostpreis
      trostpreisXp = TROSTPREIS_XP;
    } else {
      const rolled = rollThemeDrop(grade);
      if (rolled) {
        const t = themeById(rolled);
        const rarity = t?.rarity || 'common';
        if (ownedThemes.includes(rolled)) {
          // (c) Already owned -> XP grant
          themeDropXp = RARITY_XP[rarity] || 0;
          themeDropResult = {
            themeId:      rolled,
            rarity,
            alreadyOwned: true,
            xpGranted:    themeDropXp,
            unlocked:     false
          };
        } else {
          // (b) New drop -> arrayUnion in the batch below
          themeDropResult = {
            themeId:      rolled,
            rarity,
            alreadyOwned: false,
            xpGranted:    0,
            unlocked:     true
          };
        }
      }
      // (d) rolled === null -> no themeDropResult, nothing to do
    }
  }

  const totalXpDelta = xpAwarded + bonusXP + trostpreisXp + themeDropXp;

  // -----------------------------------------------------------
  //  Build the batched :commit payload
  // -----------------------------------------------------------
  const writes = [];

  // 1) users/{uid} - grade + xp + counter + (maybe) achievements + theme drop.
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
  if (themeDropResult && themeDropResult.unlocked) {
    // New theme drop: add to themes AND themeDrops (legacy field, still
    // useful for unlockCosmetic-fallback path on offline flush).
    userSet.themes     = arrayUnion([themeDropResult.themeId]);
    userSet.themeDrops = arrayUnion([themeDropResult.themeId]);
  }
  if (themeDropResult && themeDropResult.alreadyOwned) {
    // Cooldown timestamp so a follow-up unlockCosmetic call can't
    // double-grant (defense-in-depth even though we grant inline here).
    userSet[`themeDropCooldowns.${themeDropResult.themeId}`] = Date.now();
  }
  // Gate B (anti-grind, per-topic): wenn ueberhaupt ein Drop gerollt wurde
  // (unlock ODER already-owned doppel-drop), Topic-Cooldown setzen. No-drop
  // (rolled === null) bleibt eligible fuer den naechsten Versuch - sonst
  // koennte ein einziger schlechter Roll das Topic 24h sperren.
  // Numerischer Date.now()-ms (KEIN serverTimestamp-Transform): nested map
  // fields koennen via :commit-updateTransforms keinen Sentinel aufnehmen
  // (siehe Kommentar oben bei grades.<key>.date), und das Vergleichs-
  // arithmetic Date.now() - cooldownTs braucht eh ms. Gleiche Konvention
  // wie themeDropCooldowns.{themeId}.
  if (themeDropResult) {
    userSet[`topicDropCooldowns.${topicCooldownKey}`] = Date.now();
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
      // Use the FINAL xp after drop/trostpreis/achievements. projectedXp
      // only carried xpAwarded — totalXpDelta is the authoritative delta.
      xp:                     (userData.xp || 0) + totalXpDelta,
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
    dailyUpdated:        false,  // not currently written here; client owns dailyScores
    // Mission 7 — drop-roll moved server-side (Variant B).
    // themeDrop is null when no drop occurred (grade !=1/2, no-drop roll,
    // or test-account). When present, frontend reads .unlocked vs
    // .alreadyOwned to pick the right toast.
    themeDrop:           themeDropResult,
    // Trostpreis (Q4): all 11 themes owned -> +30 XP per Note-1/2 test.
    trostpreis:          trostpreisXp || 0
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
