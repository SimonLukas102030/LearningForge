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
// 10 Themes (inkl. default). Durch 1en und 2en bei Tests freigeschaltet.
export const THEMES = [
  { id: 'default',   name: 'Standard',         default: true,  rarity: 'common' },
  { id: 'ocean',     name: 'Ozean',                            rarity: 'common' },
  { id: 'forest',    name: 'Wald',                             rarity: 'common' },
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
// Note 1 → 25% Chance, Note 2 → 5%, sonst 0%.
// Liefert ID eines neu freigeschalteten Themes oder null.
export function rollThemeDrop(grade, alreadyOwned) {
  const chance = grade === 1 ? 0.25 : grade === 2 ? 0.05 : 0;
  if (Math.random() >= chance) return null;
  const pool = ALL_THEME_IDS.filter(id => !alreadyOwned.includes(id));
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
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
