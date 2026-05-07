// =============================================================
//  LearningForge Worker - Cosmetics catalog
// -------------------------------------------------------------
//  Direct port of functions/lib/cosmetics.js. Used by
//  unlockCosmetic to authoritatively decide whether a user has
//  earned a given outline (level gate) or theme (drop history /
//  level 0 free).
// =============================================================

export const OUTLINE_TIERS = [
  { id: 'none',     level:   0 },
  { id: 'bronze',   level:   3 },
  { id: 'silver',   level:   8 },
  { id: 'gold',     level:  15 },
  { id: 'emerald',  level:  22 },
  { id: 'sapphire', level:  30 },
  { id: 'ruby',     level:  40 },
  { id: 'amethyst', level:  52 },
  { id: 'diamond',  level:  65 },
  { id: 'rainbow',  level:  80 },
  { id: 'cosmic',   level: 100 }
];

// Mission 7: Each non-default theme has a rarity. Mirrors
// assets/js/cosmetics.js THEMES rarities. Used by submitTestResult's
// drop-roll and unlockCosmetic's double-drop XP grant.
//
// XP-conversion at double-drop (Maya's Spec, Q4-table):
//   common=20, rare=60, epic=150, legendary=400
//
// Adrian's Q5: +2 commons (sand, schiefer) — frontend already shipped
// them in assets/js/cosmetics.js + cosmetics.css. Mirrored here so the
// drop-roll, double-drop XP, and trostpreis "all themes owned" check
// stay in sync with the frontend (Sophie M7+M8+M9 audit fix, 2026-05-07).
export const THEMES = [
  { id: 'default',   default: true                  },
  { id: 'ocean',     rarity: 'common'               },
  { id: 'forest',    rarity: 'common'               },
  { id: 'sand',      rarity: 'common'               },
  { id: 'schiefer',  rarity: 'common'               },
  { id: 'sunset',    rarity: 'rare'                 },
  { id: 'lavender',  rarity: 'rare'                 },
  { id: 'crimson',   rarity: 'rare'                 },
  { id: 'mint',      rarity: 'rare'                 },
  { id: 'cherry',    rarity: 'epic'                 },
  { id: 'carbon',    rarity: 'epic'                 },
  { id: 'aurora',    rarity: 'legendary'            },
  { id: 'cyberpunk', rarity: 'legendary'            }
];

export const ALL_THEME_IDS = THEMES.map(t => t.id);

// Maya's Spec — XP-conversion table on double-drop.
export const RARITY_XP = {
  common:    20,
  rare:      60,
  epic:     150,
  legendary: 400
};

// Maya's Spec — Drop-roll probability table per grade.
// Note 1 sums to 1.00 (35% any-drop = 60+28+10+2 of the 35% slice; the
// remaining 65% is "no-drop"). Same for Note 2 (8% any-drop).
//
// Read as: P(drop AND rarity=R | grade=G).
// "no_drop" = 1 - sum(rarity probs).
export const DROP_TABLE = {
  1: { common: 0.21, rare: 0.098, epic: 0.035, legendary: 0.007 },  // 35% total
  2: { common: 0.048, rare: 0.0256, epic: 0.0056, legendary: 0.0008 } // 8% total
};

export function outlineTierById(id) {
  return OUTLINE_TIERS.find(t => t.id === id) || null;
}

export function themeById(id) {
  return THEMES.find(t => t.id === id) || null;
}

// Server-side drop roll. Returns themeId | null.
//
// Algorithm (mirrors Maya's Spec):
//   1. Pick a rarity bucket weighted by DROP_TABLE[grade].
//      If none picked (cumulative roll falls into the "no-drop" remainder),
//      return null.
//   2. Pick a uniform-random theme from that rarity. Fallback chain:
//      requested rarity -> next-lower -> next-higher -> null.
//
// The pool is NOT pre-filtered by alreadyOwned — Maya's Spec says the
// server is source-of-truth and double-drops are valid (they convert to
// XP via the unlockCosmetic path / submitTestResult inline logic).
export function rollThemeDrop(grade, rng) {
  const random = typeof rng === 'function' ? rng : Math.random;
  const table = DROP_TABLE[grade];
  if (!table) return null;

  const r = random();
  let acc = 0;
  let picked = null;
  for (const rarity of ['common', 'rare', 'epic', 'legendary']) {
    acc += table[rarity];
    if (r < acc) { picked = rarity; break; }
  }
  if (!picked) return null;  // landed in the no-drop remainder

  const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary'];
  const idx = RARITY_ORDER.indexOf(picked);
  // Fallback chain: requested -> lower -> higher
  const tries = [
    picked,
    ...RARITY_ORDER.slice(0, idx).reverse(),
    ...RARITY_ORDER.slice(idx + 1)
  ];

  for (const tier of tries) {
    const pool = THEMES.filter(t => t.rarity === tier);
    if (pool.length > 0) {
      return pool[Math.floor(random() * pool.length)].id;
    }
  }
  return null;
}
