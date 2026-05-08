// =============================================================
//  LearningForge Worker - Daily Challenge catalog (SERVER-ONLY)
// -------------------------------------------------------------
//  Mirrors assets/js/daily-challenges-config.js BUT keeps the
//  `correct` indices server-side so they never ship to the
//  client. This closes Cheat #4 (correct-indices in client).
//
//  Frontend (Ethan) ships only {id, type, difficulty, question,
//  options, points} — no `correct`. The server re-evaluates each
//  submitted answer against this table.
//
//  Schluessel = YYYY-MM-DD (Europe/Berlin). Frontend computes the
//  same key in dcGetTodayKey() so client + server agree on which
//  challenge is "today".
//
//  When you add a new day's challenges, mirror the JSON here AND
//  in assets/js/daily-challenges-config.js (frontend version
//  drops the `correct` field). Long-term Mission-10+ goal: serve
//  this from KV or a dailyChallenges/{date} doc with admin-only
//  write rules.
//
//  B4 fix (2026-05-08): the curated map is no longer mandatory.
//  submitDailyChallenge falls back to a frontend-supplied
//  questions[] for non-curated dates (see endpoint comment).
// =============================================================

import { balanceDistractorLengthBatch } from './distractor-balance.js';

export const DAILY_CHALLENGES = {

  // ── 22.04. Mittwoch — Englisch: Australia (easy) ──────────────────────────
  '2026-04-22': [
    {"id":"aus1","type":"multiple_choice","difficulty":"easy","question":"What is the capital of Australia?","options":["Sydney","Melbourne","Canberra","Brisbane"],"correct":2,"points":2},
    {"id":"aus2","type":"multiple_choice","difficulty":"easy","question":"Which ocean is Australia surrounded by?","options":["Atlantic Ocean","Pacific and Indian Oceans","Arctic Ocean","Mediterranean Sea"],"correct":1,"points":2},
    {"id":"aus4","type":"multiple_choice","difficulty":"easy","question":"Which animal is NOT native to Australia?","options":["Kangaroo","Koala","Polar bear","Platypus"],"correct":2,"points":2},
    {"id":"aus7","type":"multiple_choice","difficulty":"easy","question":"What does 'arvo' mean in Australian slang?","options":["Morning","Afternoon","Evening","Night"],"correct":1,"points":2},
    {"id":"aus8","type":"multiple_choice","difficulty":"easy","question":"What are 'thongs' in Australian English?","options":["Underwear","Flip-flops","Shorts","Sunglasses"],"correct":1,"points":2},
    {"id":"aus34","type":"multiple_choice","difficulty":"easy","question":"Which is Australia's largest state by area?","options":["New South Wales","Victoria","Western Australia","Queensland"],"correct":2,"points":2}
  ],

  // ── 23.04. Donnerstag — Geschichte: Erster Weltkrieg (easy) ───────────────
  '2026-04-23': [
    {"id":"g1","type":"multiple_choice","difficulty":"easy","question":"Was war der unmittelbare Ausloeser des Ersten Weltkriegs?","options":["Der Angriff Deutschlands auf Frankreich","Die Ermordung von Thronfolger Franz Ferdinand in Sarajevo","Die russische Mobilmachung","Der Einmarsch in Belgien"],"correct":1,"points":2},
    {"id":"g2","type":"multiple_choice","difficulty":"easy","question":"Was war das Ziel des Schlieffenplans?","options":["Einen langen Stellungskrieg fuehren","Russland zuerst besiegen","Einen Zweifrontenkrieg durch schnellen Sieg gegen Frankreich vermeiden","Die britische Flotte vernichten"],"correct":2,"points":2},
    {"id":"g3","type":"multiple_choice","difficulty":"easy","question":"Wie lange dauerte die Schlacht von Verdun?","options":["2 Wochen","3 Monate","10 Monate","2 Jahre"],"correct":2,"points":2},
    {"id":"g4","type":"multiple_choice","difficulty":"easy","question":"Was versteht man unter dem Steckruebenwinter?","options":["Ein besonders kalter Winter 1916/17","Eine Hungersnot durch Seeblockade und Missernte, bei der Steckrueben als Grundnahrungsmittel dienten","Ein erfolgreicher Ernte-Winter","Ein Militaereinsatz in Russland"],"correct":1,"points":2},
    {"id":"g13","type":"multiple_choice","difficulty":"easy","question":"Was war der Dreibund vor dem Ersten Weltkrieg?","options":["Deutschland, Oesterreich-Ungarn, Russland","Deutschland, Oesterreich-Ungarn, Italien","Deutschland, Frankreich, Italien","Frankreich, Russland, Grossbritannien"],"correct":1,"points":2},
    {"id":"g15","type":"multiple_choice","difficulty":"easy","question":"In welchem Jahr begann der Erste Weltkrieg?","options":["1912","1914","1916","1918"],"correct":1,"points":2}
  ],

  // ── 24.04. Freitag — Mathematik: Potenzgleichungen (easy) ─────────────────
  '2026-04-24': [
    {"id":"p1","type":"multiple_choice","difficulty":"easy","question":"Wie viele reelle Loesungen hat x^2 = 49?","options":["Keine","Genau eine (x = 7)","Zwei (x = 7 und x = -7)","Unendlich viele"],"correct":2,"points":2},
    {"id":"p3","type":"multiple_choice","difficulty":"easy","question":"Was ist die Loesung von x^3 = -27?","options":["x = 3","x = -3","x = +/-3","Keine Loesung"],"correct":1,"points":2},
    {"id":"p4","type":"multiple_choice","difficulty":"easy","question":"Loese: 2x^2 = 18","options":["x = 9","x = +/-3","x = 3","x = +/-9"],"correct":1,"points":2},
    {"id":"p5","type":"multiple_choice","difficulty":"easy","question":"Was ist die dritte Wurzel aus 64?","options":["8","4","6","32"],"correct":1,"points":2},
    {"id":"p11","type":"multiple_choice","difficulty":"easy","question":"Was ist die vierte Wurzel aus 81?","options":["2","3","4","9"],"correct":1,"points":2},
    {"id":"p13","type":"multiple_choice","difficulty":"easy","question":"Loese: 3x^2 = 75","options":["x = +/-5","x = 5","x = +/-25","x = +/-15"],"correct":0,"points":2}
  ],

  // ── 25.04. Samstag — Physik: Superpositionsprinzip (easy) ─────────────────
  '2026-04-25': [
    {"id":"sp1","type":"multiple_choice","difficulty":"easy","question":"Was besagt das Superpositionsprinzip?","options":["Bewegungen addieren sich immer zur groessten Bewegung","Mehrere Bewegungen laufen unabhaengig voneinander ab und ueberlagern sich","Die schnellste Bewegung dominiert","Nur eine Bewegung kann gleichzeitig wirken"],"correct":1,"points":2},
    {"id":"sp2","type":"multiple_choice","difficulty":"easy","question":"Welche Beschleunigung wirkt in horizontaler Richtung beim waagerechten Wurf (ohne Reibung)?","options":["9,81 m/s^2","0 m/s^2","Die halbe Erdbeschleunigung","Haengt von der Masse ab"],"correct":1,"points":2},
    {"id":"sp3","type":"multiple_choice","difficulty":"easy","question":"Wie lautet die Formel fuer den zurueckgelegten Weg beim freien Fall?","options":["s = v * t","s = 1/2 * g * t^2","s = g * t","s = v^2 / g"],"correct":1,"points":2},
    {"id":"sp4","type":"multiple_choice","difficulty":"easy","question":"Eine Kugel wird waagerecht abgeschossen, eine andere gleichzeitig fallen gelassen. Was gilt?","options":["Die fallende Kugel trifft zuerst auf","Die abgeschossene Kugel trifft zuerst auf","Beide treffen gleichzeitig auf","Es haengt von der Horizontalgeschwindigkeit ab"],"correct":2,"points":2},
    {"id":"sp11","type":"multiple_choice","difficulty":"easy","question":"Was ist gleichfoermige Bewegung?","options":["Bewegung mit konstanter Beschleunigung","Bewegung mit konstanter Geschwindigkeit (a = 0)","Bewegung im freien Fall","Kreisbewegung"],"correct":1,"points":2},
    {"id":"sp13","type":"multiple_choice","difficulty":"easy","question":"Wie gross ist die Erdbeschleunigung g (gerundet auf zwei Nachkommastellen)?","options":["g = 8,81 m/s^2","g = 9,81 m/s^2","g = 10,81 m/s^2","g = 7,50 m/s^2"],"correct":1,"points":2}
  ],

  // ── 26.04. Sonntag — Englisch: Australia (medium) ─────────────────────────
  '2026-04-26': [
    {"id":"aus9","type":"multiple_choice","difficulty":"medium","question":"When is summer in Australia?","options":["June to August","September to November","December to February","March to May"],"correct":2,"points":2},
    {"id":"aus10","type":"multiple_choice","difficulty":"medium","question":"What is the world's largest coral reef system located off Australia's coast?","options":["The Red Sea Reef","The Great Barrier Reef","The Belize Barrier Reef","The Florida Reef"],"correct":1,"points":2},
    {"id":"aus12","type":"multiple_choice","difficulty":"medium","question":"What is Uluru?","options":["A city","A massive red sandstone rock formation","A river","A mountain range"],"correct":1,"points":2},
    {"id":"aus14","type":"multiple_choice","difficulty":"medium","question":"What does ANZAC stand for?","options":["Australia and New Zealand Allied Command","Australian and New Zealand Army Corps","Allied Nations Zealand and Canberra","Australian National Zone and Colonies"],"correct":1,"points":2},
    {"id":"aus36","type":"multiple_choice","difficulty":"easy","question":"What does 'Down Under' refer to?","options":["An underground cave system in the Outback","Australia and New Zealand, located in the Southern Hemisphere","The Australian Outback only","Tasmania"],"correct":1,"points":2},
    {"id":"aus40","type":"multiple_choice","difficulty":"medium","question":"When did Australia become a federation (an independent nation)?","options":["1788","1850","1901","1931"],"correct":2,"points":2}
  ],

  // ── 27.04. Montag — Geschichte: Erster Weltkrieg (medium) ─────────────────
  '2026-04-27': [
    {"id":"g5","type":"multiple_choice","difficulty":"medium","question":"Warum erklaerten die USA 1917 Deutschland den Krieg?","options":["Wegen der russischen Revolution","Wegen des uneingeschraenkten U-Boot-Kriegs und des Zimmermann-Telegramms","Wegen der Niederlage Frankreichs","Auf Wunsch Grossbritanniens"],"correct":1,"points":2},
    {"id":"g6","type":"multiple_choice","difficulty":"medium","question":"Was verlor Russland durch den Frieden von Brest-Litowsk?","options":["Nur Finnland","Ca. 1 Million km^2 und 26% der Bevoelkerung","Nur die Ukraine","Nichts - es war ein Siegfrieden"],"correct":1,"points":2},
    {"id":"g14","type":"multiple_choice","difficulty":"easy","question":"Die Triple Entente bestand aus welchen Laendern?","options":["Frankreich, Russland, Oesterreich-Ungarn","Frankreich, Grossbritannien, Russland","Frankreich, Grossbritannien, USA","Frankreich, Russland, Deutschland"],"correct":1,"points":2},
    {"id":"g16","type":"multiple_choice","difficulty":"easy","question":"Was bedeutet Militarismus als Ursache des Ersten Weltkriegs?","options":["Eine Friedenspolitik durch Staerke","Die Ueberbewertung militaerischer Staerke und ein Ruestungswettlauf unter den Grossmaechten","Ein politisches Buendnissystem","Eine Wirtschaftspolitik"],"correct":1,"points":2},
    {"id":"g17","type":"multiple_choice","difficulty":"easy","question":"Wo wurde Erzherzog Franz Ferdinand ermordet?","options":["Wien","Berlin","Sarajevo","Belgrad"],"correct":2,"points":2},
    {"id":"g18","type":"multiple_choice","difficulty":"medium","question":"Was war die Julikrise 1914?","options":["Ein Streik in Deutschland","Die Wochen zwischen Attentat und Kriegsausbruch, in denen Diplomatie scheiterte und Buendnisse aktiviert wurden","Eine Militaeroperation","Eine Wirtschaftskrise"],"correct":1,"points":2}
  ],

  // ── 28.04. Dienstag — Mathematik: Potenzgleichungen (medium) ──────────────
  '2026-04-28': [
    {"id":"p6","type":"multiple_choice","difficulty":"medium","question":"Loese: (x - 2)^3 = 8","options":["x = 4","x = 2","x = 0","x = +/-4"],"correct":0,"points":2},
    {"id":"p7","type":"multiple_choice","difficulty":"medium","question":"Loese: x^2 + 11 = 36","options":["x = 25","x = +/-5","x = 5","Keine Loesung"],"correct":1,"points":2},
    {"id":"p12","type":"multiple_choice","difficulty":"easy","question":"Wie viele reelle Loesungen hat x^4 = 16?","options":["Keine","Genau eine (x = 2)","Zwei (x = +/-2)","Vier"],"correct":2,"points":2},
    {"id":"p14","type":"multiple_choice","difficulty":"easy","question":"Welche Loesungsmenge hat x^4 = -16?","options":["{-2; 2}","{-2}","{2}","Leere Menge (keine reellen Loesungen)"],"correct":3,"points":2},
    {"id":"p15","type":"multiple_choice","difficulty":"easy","question":"Was ist die dritte Wurzel aus -64?","options":["4","-4","+/-4","Nicht definiert"],"correct":1,"points":2},
    {"id":"p19","type":"multiple_choice","difficulty":"medium","question":"Loese: (x + 3)^2 = 25","options":["x = 2","x = -8","x = 2 oder x = -8","x = +/-5"],"correct":2,"points":2}
  ]

};

// B5 fix: every read of a curated challenge runs through the
// distractor-length balancer. The `correct` index is preserved (only
// the trailing tail of the correct option may be trimmed), so the
// existing eval path in submitDailyChallenge keeps working unchanged.
// We don't rewrite the static map at module-load time so a future
// admin tool can compare raw vs balanced for spot-checking.
export function getDailyChallenge(dateKey) {
  const raw = DAILY_CHALLENGES[dateKey];
  if (!raw) return null;
  return balanceDistractorLengthBatch(raw);
}

// Raw access (un-balanced) — used by the submit endpoint for eval where
// the user already saw the un-balanced options on their device. Server
// re-balancing at submit time would be cosmetically pointless.
export function getDailyChallengeRaw(dateKey) {
  return DAILY_CHALLENGES[dateKey] || null;
}
