// ══════════════════════════════════════════
//  LearningForge — Phase 3: Gamification
//  Achievement-System + XP/Level-Logik
// ══════════════════════════════════════════

// ── Interne Hilfsfunktionen ─────────────────
function _totalTests(u) { return Object.keys(u.grades || {}).length; }
function _gradeCount(u, g) { return Object.values(u.grades || {}).filter(gr => (gr.grade || 9) <= g).length; }
function _studyMins(u)  { return Object.values(u.studyTime || {}).reduce((a, b) => a + b, 0); }
function _levelNum(xp)  { let l = 1; while (l < 50 && _xpForLevel(l + 1) <= xp) l++; return l; }
function _xpForLevel(n) { if (n <= 1) return 0; return (n - 1) * 100 + 25 * (n - 1) * (n - 2); }

// ── Achievement-Definitionen ─────────────────
// code: max 3 Zeichen für Badge-Anzeige (kein Emoji wegen CLAUDE.md-Policy)
export const ACHIEVEMENTS = [
  // ── Tests
  { id: 'first_test',    code: 'T1',  color: '#6366f1', title: 'Erster Schritt',   desc: 'Ersten Test abgeschlossen',             xp: 30,  check: (u) => _totalTests(u) >= 1 },
  { id: 'tests_10',      code: '10T', color: '#818cf8', title: '10 Tests',          desc: '10 Tests abgeschlossen',                xp: 50,  check: (u) => _totalTests(u) >= 10 },
  { id: 'tests_25',      code: '25T', color: '#4f46e5', title: '25 Tests',          desc: '25 Tests abgeschlossen',                xp: 100, check: (u) => _totalTests(u) >= 25 },
  { id: 'tests_50',      code: '50T', color: '#3730a3', title: '50 Tests',          desc: '50 Tests abgeschlossen',                xp: 200, check: (u) => _totalTests(u) >= 50 },
  { id: 'tests_100',     code: '100', color: '#312e81', title: 'Hundertster',       desc: '100 Tests abgeschlossen',               xp: 500, check: (u) => _totalTests(u) >= 100 },
  // ── Noten
  { id: 'first_one',     code: '1+',  color: '#f59e0b', title: 'Erste Eins',        desc: 'Test mit Note 1 abgeschlossen',         xp: 75,  check: (u) => _gradeCount(u, 1) >= 1 },
  { id: 'three_ones',    code: '3x1', color: '#d97706', title: 'Dreifach Gold',     desc: '3 Tests mit Note 1 abgeschlossen',      xp: 150, check: (u) => _gradeCount(u, 1) >= 3 },
  { id: 'perfect_score', code: 'P!',  color: '#b45309', title: 'Perfekt!',          desc: '100% Punkte in einem Test',             xp: 200, check: (u, ctx) => !!ctx?.perfect },
  // ── Streak
  { id: 'streak_3',      code: 'S3',  color: '#ef4444', title: '3-Tage-Streak',     desc: '3 Tage in Folge gelernt',               xp: 30,  check: (u, ctx) => (ctx?.streak ?? 0) >= 3 },
  { id: 'streak_7',      code: 'S7',  color: '#dc2626', title: '7-Tage-Streak',     desc: '7 Tage in Folge gelernt',               xp: 100, check: (u, ctx) => (ctx?.streak ?? 0) >= 7 },
  { id: 'streak_14',     code: 'S14', color: '#b91c1c', title: '14-Tage-Streak',    desc: '14 Tage in Folge gelernt',              xp: 200, check: (u, ctx) => (ctx?.streak ?? 0) >= 14 },
  { id: 'streak_30',     code: 'S30', color: '#991b1b', title: 'Monat am Stück',    desc: '30 Tage in Folge gelernt',              xp: 500, check: (u, ctx) => (ctx?.streak ?? 0) >= 30 },
  // ── Lernzeit
  { id: 'time_60',       code: '1h',  color: '#14b8a6', title: 'Erste Stunde',      desc: 'Insgesamt 60 Min. gelernt',             xp: 50,  check: (u) => _studyMins(u) >= 60 },
  { id: 'time_300',      code: '5h',  color: '#0d9488', title: '5 Stunden',         desc: 'Insgesamt 5 Std. gelernt',              xp: 100, check: (u) => _studyMins(u) >= 300 },
  { id: 'time_600',      code: '10h', color: '#0f766e', title: '10 Stunden',        desc: 'Insgesamt 10 Std. gelernt',             xp: 200, check: (u) => _studyMins(u) >= 600 },
  // ── Tageszeit
  { id: 'night_owl',     code: '23h', color: '#7c3aed', title: 'Nachteule',         desc: 'Nach 23 Uhr einen Test gemacht',        xp: 50,  check: (u, ctx) => (ctx?.hour ?? -1) >= 23 },
  { id: 'early_bird',    code: '7h',  color: '#6d28d9', title: 'Frühaufsteher',     desc: 'Vor 7 Uhr einen Test gemacht',          xp: 50,  check: (u, ctx) => (ctx?.hour ?? 12) < 7 },
  // ── Tagespensum
  { id: 'five_in_day',   code: '5/d', color: '#f97316', title: '5 an einem Tag',    desc: '5 Tests an einem Tag gemacht',          xp: 100, check: (u, ctx) => (ctx?.testsToday ?? 0) >= 5 },
  // ── Fragen
  { id: 'questions_100', code: 'Q1',  color: '#22d3ee', title: '100 Fragen',        desc: '100 Fragen insgesamt beantwortet',      xp: 75,  check: (u) => (u.totalQuestionsAnswered ?? 0) >= 100 },
  { id: 'questions_500', code: 'Q5',  color: '#0891b2', title: '500 Fragen',        desc: '500 Fragen insgesamt beantwortet',      xp: 200, check: (u) => (u.totalQuestionsAnswered ?? 0) >= 500 },
  // ── SRS
  { id: 'srs_10',        code: 'R10', color: '#10b981', title: 'Wiederholer',       desc: '10 SRS-Karten wiederholt',              xp: 30,  check: (u) => (u.srsReviewsTotal ?? 0) >= 10 },
  { id: 'srs_100',       code: 'R1C', color: '#059669', title: 'SRS-Profi',         desc: '100 SRS-Karten wiederholt',             xp: 150, check: (u) => (u.srsReviewsTotal ?? 0) >= 100 },
  // ── Eigene Inhalte
  { id: 'custom_1',      code: 'CE',  color: '#ec4899', title: 'Eigener Inhalt',    desc: 'Eigenen Lerninhalt erstellt',           xp: 75,  check: (u, ctx) => !!ctx?.customCreated },
  // ── Lesezeichen
  { id: 'bookmark_5',    code: 'BK5', color: '#8b5cf6', title: 'Sammler',           desc: '5 Lesezeichen gespeichert',             xp: 30,  check: (u) => (u.bookmarks?.length ?? 0) >= 5 },
  // ── Fach-Meister
  { id: 'subject_done',  code: 'FM',  color: '#0ea5e9', title: 'Fach-Meister',      desc: 'Alle Themen eines Fachs getestet',      xp: 300, check: (u, ctx) => !!ctx?.subjectComplete },
  // ── Daily Challenge
  { id: 'daily_first',   code: 'DC',  color: '#f59e0b', title: 'Daily Starter',     desc: 'Erste Daily Challenge abgeschlossen',   xp: 50,  check: (u) => (u.dailyChallengesCompleted ?? 0) >= 1 },
  { id: 'daily_7',       code: 'D7',  color: '#d97706', title: 'Challengers',       desc: '7 Daily Challenges abgeschlossen',      xp: 150, check: (u) => (u.dailyChallengesCompleted ?? 0) >= 7 },
  { id: 'daily_perfect', code: 'DP',  color: '#b45309', title: 'Daily-Perfekt',     desc: 'Daily Challenge mit Note 1 bestanden',  xp: 100, check: (u, ctx) => !!ctx?.dailyPerfect },
  // ── Level
  { id: 'level_10',      code: 'L10', color: '#84cc16', title: 'Level 10',          desc: 'Level 10 erreicht',                     xp: 100, check: (u) => _levelNum(u.xp ?? 0) >= 10 },
  { id: 'level_25',      code: 'L25', color: '#65a30d', title: 'Level 25',          desc: 'Level 25 erreicht',                     xp: 250, check: (u) => _levelNum(u.xp ?? 0) >= 25 },
  { id: 'level_50',      code: 'L50', color: '#4d7c0f', title: 'Level 50',          desc: 'Level 50 erreicht',                     xp: 500, check: (u) => _levelNum(u.xp ?? 0) >= 50 },
  // ── Gruppen
  { id: 'joined_group',  code: 'GR',  color: '#a855f7', title: 'Teamplayer',        desc: 'Einer Gruppe beigetreten',              xp: 50,  check: (u) => (u.groupIds?.length ?? 0) >= 1 },
];

// ── XP / Level-System ────────────────────────

const LEVEL_TITLES = [
  'Anfänger','Anfänger','Anfänger','Anfänger','Anfänger',
  'Lernender','Lernender','Lernender','Lernender','Lernender',
  'Streber','Streber','Streber','Streber','Streber',
  'Wissenssucher','Wissenssucher','Wissenssucher','Wissenssucher','Wissenssucher',
  'Kenner','Kenner','Kenner','Kenner','Kenner',
  'Experte','Experte','Experte','Experte','Experte',
  'Gelehrter','Gelehrter','Gelehrter','Gelehrter','Gelehrter',
  'Weiser','Weiser','Weiser','Weiser','Weiser',
  'Meisterschüler','Meisterschüler','Meisterschüler','Meisterschüler','Meisterschüler',
  'Legende','Legende','Legende','Legende','Legende',
];

export function calcLevel(totalXP) {
  const level     = _levelNum(totalXP);
  const xpThis    = _xpForLevel(level);
  const xpNext    = _xpForLevel(level + 1);
  const xpCurrent = totalXP - xpThis;
  const xpNeeded  = xpNext - xpThis;
  const pct       = Math.min(100, xpNeeded > 0 ? Math.round((xpCurrent / xpNeeded) * 100) : 100);
  const title     = LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)];
  return { level, title, xpCurrent, xpNeeded, pct, totalXP };
}

// XP pro Test: Note 1 = 100, Note 6 = 10
export function calcXPForTest(grade) {
  return Math.max(10, (7 - grade) * 18);
}

// ── Motivations-Sätze für Wochenrückblick ──
export const MOTIVATION_SENTENCES = [
  'Weiter so — jeder Tag bringt dich deinem Ziel näher!',
  'Wissen ist Macht. Du hast diese Woche wieder Kraft gesammelt.',
  'Kleine Schritte führen zu großen Zielen.',
  'Du bist besser als gestern — das zählt.',
  'Dranbleiben ist die halbe Miete. Du machst das!',
  'Jede Frage, die du beantwortest, macht dich klüger.',
  'Heute lernen, morgen glänzen.',
  'Dein Gehirn freut sich über jede Lernsession.',
  'Regelmäßiges Lernen schlägt stundenlanges Pauken.',
  'Du investierst in deine Zukunft — das ist clever.',
  'Nicht aufhören zu lernen ist das Geheimnis des Erfolgs.',
  'Jeder Experte war einmal Anfänger.',
  'Du bist auf dem richtigen Weg!',
  'Wissen wächst, je mehr man es teilt und anwendet.',
  'Neugier ist der Motor des Lernens.',
  'Fehler sind Lernchancen — nutze sie!',
  'Dein zukünftiges Ich wird dir danken.',
  'Lernen ist eine Investition mit dem besten Zinssatz.',
  'Häppchenweise lernen — so funktioniert das Gehirn am besten.',
  'Die beste Zeit zu lernen war gestern. Die zweitbeste ist jetzt.',
];
