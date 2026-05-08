// =============================================================
//  LearningForge Worker - Achievement derivation
// -------------------------------------------------------------
//  Direct port of functions/lib/achievements.js. Pure JS.
// =============================================================

function _totalTests(u) { return Object.keys(u.grades || {}).length; }
function _gradeCount(u, g) { return Object.values(u.grades || {}).filter(gr => (gr.grade || 9) <= g).length; }
function _studyMins(u)  { return Object.values(u.studyTime || {}).reduce((a, b) => a + b, 0); }
function _xpForLevel(n) { if (n <= 1) return 0; return (n - 1) * 100 + 25 * (n - 1) * (n - 2); }
// B6 fix (2026-05-08): cap raised from 50 → 200, mirrors achievements.js
// frontend. Server-side check on level achievements must agree with client
// or level_75/level_100 (added below) would never grant from the worker.
function _levelNum(xp)  { let l = 1; while (l < 200 && _xpForLevel(l + 1) <= xp) l++; return l; }

export function calcLevel(totalXP) {
  const level = _levelNum(totalXP || 0);
  return { level, totalXP: totalXP || 0 };
}

export function calcXPForTest(grade) {
  return Math.max(10, (7 - grade) * 18);
}

export const ACHIEVEMENTS = [
  { id: 'first_test',    xp: 30,  check: (u)      => _totalTests(u) >= 1 },
  { id: 'tests_10',      xp: 50,  check: (u)      => _totalTests(u) >= 10 },
  { id: 'tests_25',      xp: 100, check: (u)      => _totalTests(u) >= 25 },
  { id: 'tests_50',      xp: 200, check: (u)      => _totalTests(u) >= 50 },
  { id: 'tests_100',     xp: 500, check: (u)      => _totalTests(u) >= 100 },
  { id: 'first_one',     xp: 75,  check: (u)      => _gradeCount(u, 1) >= 1 },
  { id: 'three_ones',    xp: 150, check: (u)      => _gradeCount(u, 1) >= 3 },
  { id: 'perfect_score', xp: 200, check: (u, ctx) => !!ctx?.perfect },
  { id: 'streak_3',      xp: 30,  check: (u, ctx) => (ctx?.streak ?? 0) >= 3 },
  { id: 'streak_7',      xp: 100, check: (u, ctx) => (ctx?.streak ?? 0) >= 7 },
  { id: 'streak_14',     xp: 200, check: (u, ctx) => (ctx?.streak ?? 0) >= 14 },
  { id: 'streak_30',     xp: 500, check: (u, ctx) => (ctx?.streak ?? 0) >= 30 },
  { id: 'time_60',       xp: 50,  check: (u)      => _studyMins(u) >= 60 },
  { id: 'time_300',      xp: 100, check: (u)      => _studyMins(u) >= 300 },
  { id: 'time_600',      xp: 200, check: (u)      => _studyMins(u) >= 600 },
  { id: 'night_owl',     xp: 50,  check: (u, ctx) => (ctx?.hour ?? -1) >= 23 },
  { id: 'early_bird',    xp: 50,  check: (u, ctx) => (ctx?.hour ?? 12) < 7 },
  { id: 'five_in_day',   xp: 100, check: (u, ctx) => (ctx?.testsToday ?? 0) >= 5 },
  { id: 'questions_100', xp: 75,  check: (u)      => (u.totalQuestionsAnswered ?? 0) >= 100 },
  { id: 'questions_500', xp: 200, check: (u)      => (u.totalQuestionsAnswered ?? 0) >= 500 },
  { id: 'srs_10',        xp: 30,  check: (u)      => (u.srsReviewsTotal ?? 0) >= 10 },
  { id: 'srs_100',       xp: 150, check: (u)      => (u.srsReviewsTotal ?? 0) >= 100 },
  { id: 'custom_1',      xp: 75,  check: (u, ctx) => !!ctx?.customCreated },
  { id: 'bookmark_5',    xp: 30,  check: (u)      => (u.bookmarks?.length ?? 0) >= 5 },
  { id: 'subject_done',  xp: 300, check: (u, ctx) => !!ctx?.subjectComplete },
  { id: 'daily_first',   xp: 50,  check: (u)      => (u.dailyChallengesCompleted ?? 0) >= 1 },
  { id: 'daily_7',       xp: 150, check: (u)      => (u.dailyChallengesCompleted ?? 0) >= 7 },
  { id: 'daily_perfect', xp: 100, check: (u, ctx) => !!ctx?.dailyPerfect },
  { id: 'level_10',      xp: 100, check: (u)      => _levelNum(u.xp ?? 0) >= 10 },
  { id: 'level_25',      xp: 250, check: (u)      => _levelNum(u.xp ?? 0) >= 25 },
  { id: 'level_50',      xp: 500, check: (u)      => _levelNum(u.xp ?? 0) >= 50 },
  { id: 'level_75',      xp: 750, check: (u)      => _levelNum(u.xp ?? 0) >= 75 },
  { id: 'level_100',     xp: 1000, check: (u)     => _levelNum(u.xp ?? 0) >= 100 },
  { id: 'joined_group',  xp: 50,  check: (u)      => (u.groupIds?.length ?? 0) >= 1 }
];

export function deriveNewAchievements(userDocAfter, context) {
  const already = new Set(userDocAfter.achievements || []);
  const granted = [];
  let bonusXP = 0;
  for (const a of ACHIEVEMENTS) {
    if (already.has(a.id)) continue;
    let earned = false;
    try { earned = !!a.check(userDocAfter, context); } catch { earned = false; }
    if (earned) {
      granted.push(a.id);
      bonusXP += a.xp;
    }
  }
  return { newlyUnlocked: granted, bonusXP };
}
