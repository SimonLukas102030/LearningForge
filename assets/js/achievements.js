// ══════════════════════════════════════════
//  LearningForge — Phase 3: Gamification
//  Achievement-System + XP/Level-Logik
// ══════════════════════════════════════════

// ── Interne Hilfsfunktionen ─────────────────
function _totalTests(u) { return Object.keys(u.grades || {}).length; }
function _gradeCount(u, g) { return Object.values(u.grades || {}).filter(gr => (gr.grade || 9) <= g).length; }
function _studyMins(u)  { return Object.values(u.studyTime || {}).reduce((a, b) => a + b, 0); }
// B8 fix (2026-05-08, Marcus, P0 bug-cycle-3): Robinator reported "50 000 XP
// = Level 44 statt erwartet ~Level 80". Root cause: B6 raised the cap 50→200
// but the underlying _xpForLevel curve (quadratic with 25*(n-1)*(n-2) base)
// was still calibrated for an old 50-cap world — Level 75 needed ~142 450 XP,
// Level 100 needed ~247 450 XP. Effectively unreachable, so level_75 /
// level_100 NEVER triggered (Bug Report #3) and the displayed level felt
// stuck (Bug Report #1).
//
// New curve: _xpForLevel(n) = (n - 1)^2 * 8
//   L1     = 0 XP
//   L5     = 128 XP
//   L10    = 648 XP
//   L25    = 4 608 XP
//   L50    = 19 208 XP
//   L75    = 43 808 XP
//   L80    = 49 928 XP   (matches Robinator's "50 000 XP = ~L80" expectation)
//   L100   = 78 408 XP
//   L200   = 316 808 XP
// Inverse: level ≈ floor(sqrt(xp/8)) + 1.
//
// Migration: NO data migration needed. Existing users keep their `xp` value;
// the new formula re-derives a higher level automatically (no level loss —
// new curve dominates old curve at every n >= 2). Achievements that were
// "stuck" (level_25, level_50, level_75, level_100 for users with enough
// XP under the new curve) re-trigger naturally on next worker call —
// deriveNewAchievements re-runs every check() against the projected user
// state and arrayUnion-merges any newly-true ones into users/{uid}.achievements.
function _levelNum(xp)  { let l = 1; while (l < 200 && _xpForLevel(l + 1) <= xp) l++; return l; }
function _xpForLevel(n) { if (n <= 1) return 0; return (n - 1) * (n - 1) * 8; }

// ── Achievement-Definitionen ─────────────────
// code: max 3 Zeichen für Badge-Anzeige (kein Emoji wegen CLAUDE.md-Policy)
// iconName: Mission 8 — Lucide-Icon-Name (siehe assets/js/icons.js). Renderer im
//   Achievement-Modal kann lfIcon(a.iconName, { color: a.color }) aufrufen, um die
//   Tier-Farbe direkt am SVG zu mounten. code bleibt als Suffix-Badge.
// longDesc: 3–5 Sätze für das Achievement-Detail-Modal (Mission 1, Anhang A)
// progress(u, ctx): optional, returnt {current, total} für Fortschrittsbalken
export const ACHIEVEMENTS = [
  // ── Tests
  { id: 'first_test',    code: 'T1',  iconName: 'graduation-cap', color: '#6366f1', title: 'Erster Schritt',   desc: 'Ersten Test abgeschlossen',             xp: 30,  check: (u) => _totalTests(u) >= 1,
    longDesc: 'Mache deinen allerersten Test in einem beliebigen Fach. Wähle ein Thema aus, klicke auf „Test starten" und beantworte mindestens eine Frage bis zum Ende. So weißt du auch, wie das Test-System funktioniert.',
    progress: (u) => ({ current: Math.min(_totalTests(u), 1), total: 1 }) },
  { id: 'tests_10',      code: '10T', iconName: 'check-check', color: '#818cf8', title: '10 Tests',          desc: '10 Tests abgeschlossen',                xp: 50,  check: (u) => _totalTests(u) >= 10,
    longDesc: 'Schließe insgesamt 10 Tests ab — egal in welchem Fach oder welcher Note. Jeder beendete Test zählt einmal. Tests, die du abbrichst, zählen nicht.',
    progress: (u) => ({ current: Math.min(_totalTests(u), 10), total: 10 }) },
  { id: 'tests_25',      code: '25T', iconName: 'medal', color: '#4f46e5', title: '25 Tests',          desc: '25 Tests abgeschlossen',                xp: 100, check: (u) => _totalTests(u) >= 25,
    longDesc: '25 abgeschlossene Tests insgesamt. Du bist offiziell ein Stammgast. Mehrere kürzere Tests zählen genauso wie lange.',
    progress: (u) => ({ current: Math.min(_totalTests(u), 25), total: 25 }) },
  { id: 'tests_50',      code: '50T', iconName: 'medal', color: '#3730a3', title: '50 Tests',          desc: '50 Tests abgeschlossen',                xp: 200, check: (u) => _totalTests(u) >= 50,
    longDesc: 'Schließe 50 Tests ab. Damit kennst du das System wirklich gut. Wenn du jeden Schultag einen Test machst, dauert das ungefähr 2,5 Monate.',
    progress: (u) => ({ current: Math.min(_totalTests(u), 50), total: 50 }) },
  { id: 'tests_100',     code: '100', iconName: 'trophy', color: '#312e81', title: 'Hundertster',       desc: '100 Tests abgeschlossen',               xp: 500, check: (u) => _totalTests(u) >= 100,
    longDesc: 'Hundert Tests gemacht. Selten — die meisten Schüler kommen nie so weit. Geh weiter, du bist auf einem starken Level.',
    progress: (u) => ({ current: Math.min(_totalTests(u), 100), total: 100 }) },
  // ── Noten
  { id: 'first_one',     code: '1+',  iconName: 'star', color: '#f59e0b', title: 'Erste Eins',        desc: 'Test mit Note 1 abgeschlossen',         xp: 75,  check: (u) => _gradeCount(u, 1) >= 1,
    longDesc: 'Hol dir in irgendeinem Test eine 1 (Note). Dafür brauchst du je nach Test 87 % oder mehr Punkte. Lerne ein Thema gut und mach den Test in Ruhe.' },
  { id: 'three_ones',    code: '3x1', iconName: 'sparkles', color: '#d97706', title: 'Dreifach Gold',     desc: '3 Tests mit Note 1 abgeschlossen',      xp: 150, check: (u) => _gradeCount(u, 1) >= 3,
    longDesc: 'Schließe drei Tests mit Note 1 ab. Müssen nicht hintereinander sein und auch nicht im gleichen Fach. Zeigt: du kannst zuverlässig top abliefern.',
    progress: (u) => ({ current: Math.min(_gradeCount(u, 1), 3), total: 3 }) },
  { id: 'perfect_score', code: 'P!',  iconName: 'sparkles', color: '#b45309', title: 'Perfekt!',          desc: '100% Punkte in einem Test',             xp: 200, check: (u, ctx) => !!ctx?.perfect,
    longDesc: 'Schaffe 100 % der Punkte in einem Test — keine einzige falsche Antwort. Funktioniert in jedem Modus (Test, Daily Challenge, Vokabeln).' },
  // ── Streak
  { id: 'streak_3',      code: 'S3',  iconName: 'flame', color: '#ef4444', title: '3-Tage-Streak',     desc: '3 Tage in Folge gelernt',               xp: 30,  check: (u, ctx) => (ctx?.streak ?? 0) >= 3,
    longDesc: 'Lerne 3 Tage in Folge. Schon eine SRS-Karte oder eine Daily-Challenge-Frage am Tag reicht. Wenn du einen Tag aussetzt, startet der Streak neu.',
    progress: (u, ctx) => ({ current: Math.min(ctx?.streak ?? 0, 3), total: 3 }) },
  { id: 'streak_7',      code: 'S7',  iconName: 'flame', color: '#dc2626', title: '7-Tage-Streak',     desc: '7 Tage in Folge gelernt',               xp: 100, check: (u, ctx) => (ctx?.streak ?? 0) >= 7,
    longDesc: 'Eine ganze Schulwoche durchziehen — 7 Tage in Folge mindestens eine Aufgabe. Tipp: stell dir eine Erinnerung am Handy.',
    progress: (u, ctx) => ({ current: Math.min(ctx?.streak ?? 0, 7), total: 7 }) },
  { id: 'streak_14',     code: 'S14', iconName: 'flame', color: '#b91c1c', title: '14-Tage-Streak',    desc: '14 Tage in Folge gelernt',              xp: 200, check: (u, ctx) => (ctx?.streak ?? 0) >= 14,
    longDesc: 'Zwei Wochen am Stück. Hier wird Lernen langsam Gewohnheit, das fühlst du selbst. Eine Streak-Freeze (im Profil) kann einen verpassten Tag retten.',
    progress: (u, ctx) => ({ current: Math.min(ctx?.streak ?? 0, 14), total: 14 }) },
  { id: 'streak_30',     code: 'S30', iconName: 'flame', color: '#991b1b', title: 'Monat am Stück',    desc: '30 Tage in Folge gelernt',              xp: 500, check: (u, ctx) => (ctx?.streak ?? 0) >= 30,
    longDesc: 'Dreißig Tage in Folge. Auf diesem Niveau lernen sehr wenige Menschen. Wenn du das schaffst, hast du einen Skill, den dich nichts mehr nimmt.',
    progress: (u, ctx) => ({ current: Math.min(ctx?.streak ?? 0, 30), total: 30 }) },
  // ── Lernzeit
  { id: 'time_60',       code: '1h',  iconName: 'clock', color: '#14b8a6', title: 'Erste Stunde',      desc: 'Insgesamt 60 Min. gelernt',             xp: 50,  check: (u) => _studyMins(u) >= 60,
    longDesc: 'Verbringe insgesamt 60 Minuten in der App mit echtem Lernen — Tests, SRS, Daily, Bookmarks. Reines Rumklicken zählt nicht.',
    progress: (u) => ({ current: Math.min(_studyMins(u), 60), total: 60 }) },
  { id: 'time_300',      code: '5h',  iconName: 'clock-3', color: '#0d9488', title: '5 Stunden',         desc: 'Insgesamt 5 Std. gelernt',              xp: 100, check: (u) => _studyMins(u) >= 300,
    longDesc: 'Fünf Stunden Lernzeit insgesamt. Ein ganzer Schultag in Lernzeit umgerechnet.',
    progress: (u) => ({ current: Math.min(_studyMins(u), 300), total: 300 }) },
  { id: 'time_600',      code: '10h', iconName: 'hourglass', color: '#0f766e', title: '10 Stunden',        desc: 'Insgesamt 10 Std. gelernt',             xp: 200, check: (u) => _studyMins(u) >= 600,
    longDesc: 'Zehn Stunden gesamte Lernzeit. Du hast die App nicht nur installiert, du nutzt sie wirklich.',
    progress: (u) => ({ current: Math.min(_studyMins(u), 600), total: 600 }) },
  // ── Tageszeit
  { id: 'night_owl',     code: '23h', iconName: 'moon-star', color: '#7c3aed', title: 'Nachteule',         desc: 'Nach 23 Uhr einen Test gemacht',        xp: 50,  check: (u, ctx) => (ctx?.hour ?? -1) >= 23,
    longDesc: 'Mache einen Test nach 23 Uhr. Einmal reicht — aber denk an Schlaf, Lernen klappt morgens danach besser.' },
  { id: 'early_bird',    code: '7h',  iconName: 'sunrise', color: '#6d28d9', title: 'Frühaufsteher',     desc: 'Vor 7 Uhr einen Test gemacht',          xp: 50,  check: (u, ctx) => (ctx?.hour ?? 12) < 7,
    longDesc: 'Mache einen Test vor 7 Uhr. Vor der Schule eine schnelle Wiederholung — sehr effektiv.' },
  // ── Tagespensum
  { id: 'five_in_day',   code: '5/d', iconName: 'zap', color: '#f97316', title: '5 an einem Tag',    desc: '5 Tests an einem Tag gemacht',          xp: 100, check: (u, ctx) => (ctx?.testsToday ?? 0) >= 5,
    longDesc: 'Mache 5 Tests an einem einzigen Tag (zwischen 0:00 und 23:59 deiner Zeit). Vor einer Klausur ist das ein klassischer Crunch-Tag.' },
  // ── Fragen
  { id: 'questions_100', code: 'Q1',  iconName: 'circle-question-mark', color: '#22d3ee', title: '100 Fragen',        desc: '100 Fragen insgesamt beantwortet',      xp: 75,  check: (u) => (u.totalQuestionsAnswered ?? 0) >= 100,
    longDesc: 'Beantworte insgesamt 100 Fragen — egal richtig oder falsch, in jedem Modus. Daily-Challenge-Fragen zählen, SRS-Karten zählen, Test-Fragen zählen.',
    progress: (u) => ({ current: Math.min(u.totalQuestionsAnswered ?? 0, 100), total: 100 }) },
  { id: 'questions_500', code: 'Q5',  iconName: 'circle-question-mark', color: '#0891b2', title: '500 Fragen',        desc: '500 Fragen insgesamt beantwortet',      xp: 200, check: (u) => (u.totalQuestionsAnswered ?? 0) >= 500,
    longDesc: '500 beantwortete Fragen insgesamt. Auf diesem Niveau merkst du selber, wie viele Themen du im Kopf hast.',
    progress: (u) => ({ current: Math.min(u.totalQuestionsAnswered ?? 0, 500), total: 500 }) },
  // ── SRS / Wiederholen
  { id: 'srs_10',        code: 'R10', iconName: 'rotate-ccw', color: '#10b981', title: 'Erste Wiederholungen', desc: '10 SRS-Karten wiederholt',          xp: 30,  check: (u) => (u.srsReviewsTotal ?? 0) >= 10,
    longDesc: 'Wiederhole 10 SRS-Karten („Spaced Repetition"). SRS-Karten kommen automatisch ins Repertoire, wenn du Tests abschließt. Im Lernen-Hub findest du sie unter „Heute fällig".',
    progress: (u) => ({ current: Math.min(u.srsReviewsTotal ?? 0, 10), total: 10 }) },
  { id: 'srs_100',       code: 'R1C', iconName: 'repeat', color: '#059669', title: 'Wiederhol-Profi',   desc: '100 SRS-Karten wiederholt',             xp: 150, check: (u) => (u.srsReviewsTotal ?? 0) >= 100,
    longDesc: 'Wiederhole 100 SRS-Karten. SRS ist die wissenschaftlich beste Methode, Sachen langfristig im Kopf zu behalten.',
    progress: (u) => ({ current: Math.min(u.srsReviewsTotal ?? 0, 100), total: 100 }) },
  // ── Eigene Inhalte
  { id: 'custom_1',      code: 'CE',  iconName: 'pen-tool', color: '#ec4899', title: 'Eigener Inhalt',    desc: 'Eigenen Lerninhalt erstellt',           xp: 75,  check: (u, ctx) => !!ctx?.customCreated,
    longDesc: 'Erstelle deinen ersten eigenen Lerninhalt im Builder — z.B. eine Themenseite mit Fragen für ein Spezialthema, das im Lehrplan fehlt. Findest du im Avatar-Menü unter „Builder".' },
  // ── Lesezeichen
  { id: 'bookmark_5',    code: 'BK5', iconName: 'bookmark', color: '#8b5cf6', title: 'Sammler',           desc: '5 Lesezeichen gespeichert',             xp: 30,  check: (u) => (u.bookmarks?.length ?? 0) >= 5,
    longDesc: 'Speichere 5 Themen als Lesezeichen. Lesezeichen findest du auf jeder Themen-Seite oben rechts (Stern-Icon). Im Lernen-Hub gibt\'s eine Schnellliste.',
    progress: (u) => ({ current: Math.min(u.bookmarks?.length ?? 0, 5), total: 5 }) },
  // ── Fach-Meister
  { id: 'subject_done',  code: 'FM',  iconName: 'award', color: '#0ea5e9', title: 'Fach-Meister',      desc: 'Alle Themen eines Fachs getestet',      xp: 300, check: (u, ctx) => !!ctx?.subjectComplete,
    longDesc: 'Mache zu jedem einzelnen Thema eines Faches mindestens einen Test. Sobald jedes Thema in z.B. „Geschichte Klasse 9" eine Note hat, ist es freigeschaltet.' },
  // ── Daily Challenge
  { id: 'daily_first',   code: 'DC',  iconName: 'calendar-check', color: '#f59e0b', title: 'Daily Starter',     desc: 'Erste Daily Challenge abgeschlossen',   xp: 50,  check: (u) => (u.dailyChallengesCompleted ?? 0) >= 1,
    longDesc: 'Schließe deine erste Daily Challenge ab. Daily Challenges gibt es jeden Tag eine pro Klassenstufe. Im Lernen-Hub als oberste Karte.' },
  { id: 'daily_7',       code: 'D7',  iconName: 'calendar-days', color: '#d97706', title: 'Challengers',       desc: '7 Daily Challenges abgeschlossen',      xp: 150, check: (u) => (u.dailyChallengesCompleted ?? 0) >= 7,
    longDesc: 'Schließe insgesamt 7 Daily Challenges ab. Müssen nicht 7 Tage hintereinander sein.',
    progress: (u) => ({ current: Math.min(u.dailyChallengesCompleted ?? 0, 7), total: 7 }) },
  { id: 'daily_perfect', code: 'DP',  iconName: 'calendar-heart', color: '#b45309', title: 'Daily-Perfekt',     desc: 'Daily Challenge mit Note 1 bestanden',  xp: 100, check: (u, ctx) => !!ctx?.dailyPerfect,
    longDesc: 'Schließe eine Daily Challenge mit Note 1 ab. Daily Challenges sind kurz (5–10 Fragen), also gut machbar wenn du das Thema kennst.' },
  // ── Level
  { id: 'level_10',      code: 'L10', iconName: 'trending-up', color: '#84cc16', title: 'Level 10',          desc: 'Level 10 erreicht',                     xp: 100, check: (u) => _levelNum(u.xp ?? 0) >= 10,
    longDesc: 'Erreiche Stufe (Level) 10. Du sammelst XP automatisch durch Tests, SRS-Reviews und Achievements.',
    progress: (u) => ({ current: Math.min(_levelNum(u.xp ?? 0), 10), total: 10 }) },
  { id: 'level_25',      code: 'L25', iconName: 'chevrons-up', color: '#65a30d', title: 'Level 25',          desc: 'Level 25 erreicht',                     xp: 250, check: (u) => _levelNum(u.xp ?? 0) >= 25,
    longDesc: 'Erreiche Stufe 25. Hier öffnen sich neue Avatar-Outlines im Inventar.',
    progress: (u) => ({ current: Math.min(_levelNum(u.xp ?? 0), 25), total: 25 }) },
  { id: 'level_50',      code: 'L50', iconName: 'rocket', color: '#4d7c0f', title: 'Level 50',          desc: 'Level 50 erreicht',                     xp: 500, check: (u) => _levelNum(u.xp ?? 0) >= 50,
    longDesc: 'Erreiche Stufe 50. Endlevel-Bereich — hier sind viele Outlines verfügbar.',
    progress: (u) => ({ current: Math.min(_levelNum(u.xp ?? 0), 50), total: 50 }) },
  { id: 'level_75',      code: 'L75', iconName: 'rocket', color: '#3f6212', title: 'Level 75',          desc: 'Level 75 erreicht',                     xp: 750, check: (u) => _levelNum(u.xp ?? 0) >= 75,
    longDesc: 'Erreiche Stufe 75. Lebende Legende — die meisten Spieler kommen nie hierhin.',
    progress: (u) => ({ current: Math.min(_levelNum(u.xp ?? 0), 75), total: 75 }) },
  { id: 'level_100',     code: 'L100', iconName: 'rocket', color: '#365314', title: 'Level 100',         desc: 'Level 100 erreicht',                    xp: 1000, check: (u) => _levelNum(u.xp ?? 0) >= 100,
    longDesc: 'Erreiche Stufe 100. Du gehörst in die Hall of Fame. Ab hier ist Lernen reine Gewohnheit.',
    progress: (u) => ({ current: Math.min(_levelNum(u.xp ?? 0), 100), total: 100 }) },
  // ── Gruppen
  { id: 'joined_group',  code: 'GR',  iconName: 'users-round', color: '#a855f7', title: 'Teamplayer',        desc: 'Einer Gruppe beigetreten',              xp: 50,  check: (u) => (u.groupIds?.length ?? 0) >= 1,
    longDesc: 'Tritt einer Lerngruppe bei (über einen Code, den dir jemand schickt) oder erstelle selbst eine. Findest du im Avatar-Menü unter „Gruppen".' },
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
