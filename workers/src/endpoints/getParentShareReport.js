// =============================================================
//  Endpoint - getParentShareReport (UNAUTH)
// -------------------------------------------------------------
//  Closes Cheat #17. Returns ONLY a curated subset, never the
//  full user-doc. UNAUTH path - parents without a Firebase
//  account can call it, only the random share token gates access.
//
//  Curation rule: NEVER include email, friendIds, friendRequests,
//  role, isBanned, isClaude, isHacker, lastStreakDate, settings,
//  srs, weakQuestions, themeDrops, photoURL.
// =============================================================

import { readJsonBody, httpError } from '../lib/http.js';
import { firestoreGet }            from '../lib/firestore.js';

// B8 fix (2026-05-08, Marcus, P0 bug-cycle-3): formula + cap synced with
// workers/src/lib/achievements.js. Parent share-report would have shown a
// drift'd level number vs the kid's actual dashboard otherwise. New curve:
// _xpForLevel(n) = (n - 1)^2 * 8 (capped at 200).
function _levelFromXp(xp) {
  let l = 1;
  const xpForLvl = n => n <= 1 ? 0 : (n - 1) * (n - 1) * 8;
  while (l < 200 && xpForLvl(l + 1) <= (xp || 0)) l++;
  return l;
}

export async function handleGetParentShareReport(request, env) {
  if (request.method !== 'POST') throw httpError(405, 'POST erforderlich.');

  const { token } = await readJsonBody(request);
  if (!token || typeof token !== 'string') {
    throw httpError(400, 'token fehlt.');
  }

  const linkDoc = await firestoreGet(env, `shareLinks/${token}`);
  if (!linkDoc) throw httpError(404, 'Share-Link unbekannt oder abgelaufen.');
  const uid = linkDoc.fields?.uid;
  if (!uid) throw httpError(404, 'Share-Link unvollstaendig.');

  const userDoc = await firestoreGet(env, `users/${uid}`);
  if (!userDoc) throw httpError(404, 'Nutzer existiert nicht mehr.');
  const u = userDoc.fields || {};

  const grades = u.grades || {};
  const gradeEntries = Object.entries(grades);
  const totalGrades = gradeEntries.length;

  // Average grade per subject (subject = first segment of "subject__year__topic" key).
  const perSubject = {};
  for (const [key, g] of gradeEntries) {
    const subject = String(key).split('__')[0];
    if (!subject) continue;
    if (!perSubject[subject]) perSubject[subject] = { sum: 0, count: 0 };
    const gradeNum = Number(g.grade) || 0;
    if (gradeNum >= 1 && gradeNum <= 6) {
      perSubject[subject].sum += gradeNum;
      perSubject[subject].count += 1;
    }
  }
  const avgGradePerSubject = {};
  for (const [s, agg] of Object.entries(perSubject)) {
    avgGradePerSubject[s] = agg.count > 0
      ? Math.round((agg.sum / agg.count) * 10) / 10
      : null;
  }

  const xp = Number(u.xp) || 0;
  const level = _levelFromXp(xp);

  // createdAt may be a Firestore Timestamp (which fromFsValue marshals
  // to an ISO-Z string) or absent. Either way we surface as ISO string
  // or null.
  const createdAt = typeof u.createdAt === 'string' ? u.createdAt : null;

  return {
    name:              u.name || 'Schueler',
    klasse:            u.klasse != null ? String(u.klasse) : null,
    totalGrades,
    avgGradePerSubject,
    xp,
    level,
    achievementsCount: (u.achievements || []).length,
    streak:            u.streakCount || 0,
    createdAt
  };
}
