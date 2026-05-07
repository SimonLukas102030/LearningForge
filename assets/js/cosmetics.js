// ══════════════════════════════════════════
//  LearningForge — Cosmetics
//  Outlines (durch Level) + Themes (durch 1en/2en)
// ══════════════════════════════════════════

// ── Outline-Tiers ────────────────────────────────────────
// Je höher das Level, desto auffälliger der Effekt.
// Die Liste ist nach unlock-Level sortiert (aufsteigend).
export const OUTLINE_TIERS = [
  { id: 'none',     name: 'Keine',       level:   0, css: '',                  rarity: 'common'  },
  { id: 'bronze',   name: 'Bronze',      level:   3, css: 'outline-bronze',    rarity: 'common'  },
  { id: 'silver',   name: 'Silber',      level:   8, css: 'outline-silver',    rarity: 'common'  },
  { id: 'gold',     name: 'Gold',        level:  15, css: 'outline-gold',      rarity: 'rare'    },
  { id: 'emerald',  name: 'Smaragd',     level:  22, css: 'outline-emerald',   rarity: 'rare'    },
  { id: 'sapphire', name: 'Saphir',      level:  30, css: 'outline-sapphire',  rarity: 'rare'    },
  { id: 'ruby',     name: 'Rubin',       level:  40, css: 'outline-ruby',      rarity: 'epic'    },
  { id: 'amethyst', name: 'Amethyst',    level:  52, css: 'outline-amethyst',  rarity: 'epic'    },
  { id: 'diamond',  name: 'Diamant',     level:  65, css: 'outline-diamond',   rarity: 'epic'    },
  { id: 'rainbow',  name: 'Regenbogen',  level:  80, css: 'outline-rainbow',   rarity: 'legendary' },
  { id: 'cosmic',   name: 'Kosmisch',    level: 100, css: 'outline-cosmic',    rarity: 'legendary' },
];

export function outlineForLevel(level) {
  // Höchste Tier, deren level <= aktuellem Level
  let best = OUTLINE_TIERS[0];
  for (const t of OUTLINE_TIERS) if (level >= t.level) best = t;
  return best;
}

// ── Themes ───────────────────────────────────────────────
// 13 Themes (inkl. default). Durch 1en und 2en bei Tests freigeschaltet.
// Mission 7 Phase 1: Sand + Schiefer als Common-Stubs (Maya refint die Farben in Phase 2).
export const THEMES = [
  { id: 'default',   name: 'Standard',         default: true,  rarity: 'common' },
  { id: 'ocean',     name: 'Ozean',                            rarity: 'common' },
  { id: 'forest',    name: 'Wald',                             rarity: 'common' },
  { id: 'sand',      name: 'Sand',                             rarity: 'common' },
  { id: 'schiefer',  name: 'Schiefer',                         rarity: 'common' },
  { id: 'sunset',    name: 'Sonnenuntergang',                  rarity: 'rare'   },
  { id: 'lavender',  name: 'Lavendel',                         rarity: 'rare'   },
  { id: 'crimson',   name: 'Karmesin',                         rarity: 'rare'   },
  { id: 'mint',      name: 'Minze',                            rarity: 'rare'   },
  { id: 'cherry',    name: 'Kirsche',                          rarity: 'epic'   },
  { id: 'carbon',    name: 'Carbon',                           rarity: 'epic'   },
  { id: 'aurora',    name: 'Aurora',                           rarity: 'legendary' },
  { id: 'cyberpunk', name: 'Cyberpunk',                        rarity: 'legendary' },
];

export const ALL_THEME_IDS = THEMES.map(t => t.id);

export function themeById(id) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

// ── Theme-Drop nach Test (1 oder 2) ──────────────────────
// Mission 7: Server (Marcus' submitTestResult, Variant B) wuerfelt jetzt
// den Drop und liefert ihn in der Worker-Response. Diese clientseitige
// Funktion ist NUR noch Offline-Fallback (CF-unreachable Branch in submitTest).
// Daher der underscore-prefix `_clientRollThemeDrop` — nicht der Hauptpfad.
//
// Drop-Probabilities (gestaffelt nach Rarity, Mission 7 Spec):
//   Note 1: common 60% / rare 28% / epic 10% / legendary  2%  (Total 35% Drop-Chance)
//   Note 2: common 60% / rare 32% / epic  7% / legendary  1%  (Total  8% Drop-Chance)
//   Note 3+: keine Drops.
//
// Pool umfasst Themes der gewaehlten Rarity, die der User noch NICHT besitzt.
// Falls Pool leer: Fallback auf naechst-niedrigere, dann naechst-hoehere Rarity.
const RARITY_PROBS = {
  1: { common: 0.60, rare: 0.28, epic: 0.10, legendary: 0.02 },
  2: { common: 0.60, rare: 0.32, epic: 0.07, legendary: 0.01 },
};
const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];

export function _clientRollThemeDrop(grade, alreadyOwned) {
  const probs = RARITY_PROBS[grade];
  if (!probs) return null;
  const r = Math.random();
  let acc = 0;
  let chosenTier = null;
  for (const tier of RARITY_ORDER) {
    acc += probs[tier];
    if (r < acc) { chosenTier = tier; break; }
  }
  if (!chosenTier) return null;   // Math.random() >= sum(probs) → kein Drop
  // Pool aus gewaehlter Rarity, dann Eskalation nach unten/oben.
  const tryTiers = [chosenTier];
  const idx = RARITY_ORDER.indexOf(chosenTier);
  if (idx > 0) tryTiers.push(RARITY_ORDER[idx - 1]);
  if (idx < RARITY_ORDER.length - 1) tryTiers.push(RARITY_ORDER[idx + 1]);
  for (const tier of tryTiers) {
    const pool = THEMES
      .filter(t => t.rarity === tier && !alreadyOwned.includes(t.id))
      .map(t => t.id);
    if (pool.length) return pool[Math.floor(Math.random() * pool.length)];
  }
  return null;
}

// Backwards-compat alias — nutzt noch alte 25%/5%-Logik nicht mehr,
// sondern delegiert an die Rarity-Bucket-Variante. Aufrufer ausserhalb
// dieses Moduls sollten direkt _clientRollThemeDrop nutzen.
//
// TODO(Mission 7 cleanup, Ethan, 2026-05-07): seit Variant B (Server-Roll im
// Worker) ist dieser Alias dead code. NICHT entfernen bevor Sophie's QA
// bestaetigt hat, dass cf.submitTestResult().themeDrop in Production fuer
// alle Pfade liefert (Tests, ggf. Daily, ggf. Vocab). Danach: diesen
// rollThemeDrop-Export entfernen UND alle "import { rollThemeDrop }"-Stellen
// in app.js auf _clientRollThemeDrop umstellen (Offline-Fallback fuer
// Worker-down ist akzeptabel — der Theme-Drop ist nur Cosmetic).
export function rollThemeDrop(grade, alreadyOwned) {
  return _clientRollThemeDrop(grade, alreadyOwned);
}

// ── Anwenden eines Themes auf <html> ────────────────────
export function applyTheme(themeId) {
  const id = (themeId && THEMES.find(t => t.id === themeId)) ? themeId : 'default';
  document.documentElement.setAttribute('data-app-theme', id);
  try { localStorage.setItem('lf_app_theme', id); } catch {}
}

export function getStoredTheme() {
  try { return localStorage.getItem('lf_app_theme') || 'default'; } catch { return 'default'; }
}
