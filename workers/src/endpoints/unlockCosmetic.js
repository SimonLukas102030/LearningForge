// =============================================================
//  Endpoint - unlockCosmetic
// -------------------------------------------------------------
//  Closes Cheat #5. Server validates the unlock criteria
//  (outline level gate / theme drop history) before
//  arrayUnion-ing into users/{uid}.outlines or .themes.
//
//  Mission 7 (Maya's Spec): on a `theme` already-owned, grant XP
//  per RARITY_XP (common=20, rare=60, epic=150, legendary=400).
//  Cooldown 60s per (uid, themeId) prevents replay-cheats.
//
//  Response shape (Mission 7):
//    {
//      unlocked:     bool,    // true = newly added to users.themes
//      alreadyOwned: bool,    // true = doppel-drop, XP granted
//      xpGranted:    number,  // amount granted (0 if none)
//      reason:       string
//    }
//  Outline path keeps the historical fields and adds
//  alreadyOwned:false, xpGranted:0 for frontend consistency.
// =============================================================

import { requireAuth }              from '../lib/auth.js';
import { readJsonBody, httpError }  from '../lib/http.js';
import {
  firestoreGet,
  firestoreUpdate,
  firestoreCommit,
  buildWriteFor,
  arrayUnion,
  incrementValue,
  serverTimestamp
} from '../lib/firestore.js';
import {
  outlineTierById,
  themeById,
  RARITY_XP
} from '../lib/cosmetics.js';

// 60s cooldown per (uid, themeId) for double-drop XP grants. Below this
// the request is treated as a replay attempt and returns xpGranted:0.
const DOUBLE_DROP_COOLDOWN_MS = 60 * 1000;

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
    if (!tier) {
      return { unlocked: false, alreadyOwned: false, xpGranted: 0, reason: 'Unbekannte Outline.' };
    }
    const lvl = _levelFromXp(userData.xp || 0);
    if (lvl < tier.level) {
      return { unlocked: false, alreadyOwned: false, xpGranted: 0,
               reason: `Level ${tier.level} noetig (aktuell ${lvl}).` };
    }
    if ((userData.outlines || []).includes(id)) {
      return { unlocked: true, alreadyOwned: true, xpGranted: 0, reason: 'Bereits freigeschaltet.' };
    }
    await firestoreUpdate(env, `users/${uid}`, {
      outlines: arrayUnion([id])
    });
    return { unlocked: true, alreadyOwned: false, xpGranted: 0,
             reason: `Outline "${id}" freigeschaltet.` };
  }

  // kind === 'theme'
  const theme = themeById(id);
  if (!theme) {
    return { unlocked: false, alreadyOwned: false, xpGranted: 0, reason: 'Unbekanntes Theme.' };
  }

  // Default theme: always free, idempotent unlock, no XP path.
  if (theme.default) {
    if (!(userData.themes || []).includes(id)) {
      await firestoreUpdate(env, `users/${uid}`, { themes: arrayUnion([id]) });
    }
    return { unlocked: true, alreadyOwned: false, xpGranted: 0, reason: 'Standard-Theme.' };
  }

  const ownsTheme = (userData.themes || []).includes(id);

  // ── Double-drop path: theme already owned -> grant XP (with cooldown) ──
  if (ownsTheme) {
    const xp = RARITY_XP[theme.rarity] || 0;
    if (xp <= 0) {
      // Theme has no rarity (shouldn't happen post-Mission-7, but defensive)
      return { unlocked: true, alreadyOwned: true, xpGranted: 0,
               reason: 'Bereits freigeschaltet (keine XP-Konfiguration).' };
    }

    // Cooldown check: last double-drop for this themeId.
    const cooldowns = userData.themeDropCooldowns || {};
    const lastTs = Number(cooldowns[id] || 0);
    const now = Date.now();
    if (lastTs && (now - lastTs) < DOUBLE_DROP_COOLDOWN_MS) {
      return { unlocked: false, alreadyOwned: true, xpGranted: 0, reason: 'cooldown' };
    }

    // Atomic batch: bump xp + xpLog + leaderboard.xp mirror + cooldown timestamp.
    const todayKey = new Date().toISOString().slice(0, 10);
    const writes = [];

    writes.push(buildWriteFor(env, `users/${uid}`, {
      xp:                                      incrementValue(xp),
      [`xpLog.${todayKey}`]:                   incrementValue(xp),
      [`themeDropCooldowns.${id}`]:            now
    }));

    // Mirror to leaderboard if the doc exists. We can't conditionally write
    // in a single :commit so we just always include the patch — Firestore's
    // PATCH with updateMask creates the doc if absent (acceptable here since
    // a user reaching the double-drop path has played at least one test).
    // BUT: leaderboard rules require ownership + scores-shape; the field
    // we touch (xp) is not in the scores affectedKeys check, so it passes
    // the soft-cap. Service-account bypasses rules anyway.
    writes.push(buildWriteFor(env, `leaderboard/${uid}`, {
      xp:        incrementValue(xp),
      updatedAt: serverTimestamp()
    }));

    await firestoreCommit(env, writes);

    return { unlocked: false, alreadyOwned: true, xpGranted: xp,
             reason: `Doppel-Drop: +${xp} XP (Theme "${id}", ${theme.rarity}).` };
  }

  // ── Not owned: legitimacy check via drop history ──
  // Pre-Mission-7 path keeps working: client put the themeId into
  // userData.themeDrops when rollThemeDrop returned it. Mission 7's
  // server-roll path (submitTestResult / Variant B) writes themes
  // directly there, so this fallback only fires for legacy/offline-flush
  // unlock attempts.
  const dropHistory = userData.themeDrops || [];
  if (Array.isArray(dropHistory) && dropHistory.includes(id)) {
    await firestoreUpdate(env, `users/${uid}`, { themes: arrayUnion([id]) });
    return { unlocked: true, alreadyOwned: false, xpGranted: 0,
             reason: `Theme "${id}" freigeschaltet (Drop).` };
  }

  return { unlocked: false, alreadyOwned: false, xpGranted: 0,
           reason: 'Theme nicht erspielt (Drop fehlt).' };
}
