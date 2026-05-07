// =============================================================
//  LearningForge Cloud Functions - Cosmetics catalog mirror
// -------------------------------------------------------------
//  Mirrors assets/js/cosmetics.js. Used by unlockCosmetic to
//  authoritatively decide whether a user has earned a given
//  outline (level gate) or theme (drop history / level 0 free).
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

export const THEMES = [
  { id: 'default',   default: true },
  { id: 'ocean'     },
  { id: 'forest'    },
  { id: 'sunset'    },
  { id: 'lavender'  },
  { id: 'crimson'   },
  { id: 'mint'      },
  { id: 'cherry'    },
  { id: 'carbon'    },
  { id: 'aurora'    },
  { id: 'cyberpunk' }
];

export const ALL_THEME_IDS = THEMES.map(t => t.id);

export function outlineTierById(id) {
  return OUTLINE_TIERS.find(t => t.id === id) || null;
}

export function themeById(id) {
  return THEMES.find(t => t.id === id) || null;
}
