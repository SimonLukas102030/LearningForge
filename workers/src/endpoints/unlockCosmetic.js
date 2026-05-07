// =============================================================
//  Endpoint - unlockCosmetic
// -------------------------------------------------------------
//  Closes Cheat #5. Server validates the unlock criteria
//  (outline level gate / theme drop history) before
//  arrayUnion-ing into users/{uid}.outlines or .themes.
// =============================================================

import { requireAuth }              from '../lib/auth.js';
import { readJsonBody, httpError }  from '../lib/http.js';
import {
  firestoreGet,
  firestoreUpdate,
  arrayUnion
} from '../lib/firestore.js';
import { outlineTierById, themeById } from '../lib/cosmetics.js';

function _levelFromXp(xp) {
  let l = 1;
  const xpForLvl = n => n <= 1 ? 0 : (n - 1) * 100 + 25 * (n - 1) * (n - 2);
  while (l < 50 && xpForLvl(l + 1) <= (xp || 0)) l++;
  return l;
}

export async function handleUnlockCosmetic(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { uid } = await requireAuth(request, env);
  const { kind, id } = await readJsonBody(request);

  if (!kind || !id) throw httpError(400, 'kind/id fehlen.');
  if (kind !== 'theme' && kind !== 'outline') {
    throw httpError(400, 'kind muss "theme" oder "outline" sein.');
  }

  const userDoc = await firestoreGet(env, `users/${uid}`);
  if (!userDoc) throw httpError(404, 'User-Doc fehlt.');
  const userData = userDoc.fields || {};

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
    await firestoreUpdate(env, `users/${uid}`, {
      outlines: arrayUnion([id])
    });
    return { unlocked: true, reason: `Outline "${id}" freigeschaltet.` };
  }

  // kind === 'theme'
  const theme = themeById(id);
  if (!theme) return { unlocked: false, reason: 'Unbekanntes Theme.' };

  if (theme.default) {
    if (!(userData.themes || []).includes(id)) {
      await firestoreUpdate(env, `users/${uid}`, { themes: arrayUnion([id]) });
    }
    return { unlocked: true, reason: 'Standard-Theme.' };
  }

  if ((userData.themes || []).includes(id)) {
    return { unlocked: true, reason: 'Bereits freigeschaltet.' };
  }

  const dropHistory = userData.themeDrops || [];
  if (Array.isArray(dropHistory) && dropHistory.includes(id)) {
    await firestoreUpdate(env, `users/${uid}`, { themes: arrayUnion([id]) });
    return { unlocked: true, reason: `Theme "${id}" freigeschaltet (Drop).` };
  }

  return { unlocked: false, reason: 'Theme nicht erspielt (Drop fehlt).' };
}
