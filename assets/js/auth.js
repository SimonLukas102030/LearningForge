// ══════════════════════════════════════════
//  LearningForge — Firebase Authentication
// ══════════════════════════════════════════

import { CONFIG } from './config.js';

let _auth = null;
let _db   = null;

export function initFirebase() {
  if (!firebase.apps.length) {
    firebase.initializeApp(CONFIG.firebase);
  }
  _auth = firebase.auth();
  _db   = firebase.firestore();
}

export const auth = () => _auth;
export const db   = () => _db;

// ── Passwort-Hash (SHA-256) ─────────────
async function hashPassword(password) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Login mit E-Mail ────────────────────
export async function loginWithEmail(email, password) {
  const hashed = await hashPassword(password);
  // Firebase speichert intern — wir hashen nur für eigene Logs
  // (Firebase selbst verwendet PBKDF2 intern, SHA-256 hier als zusätzliche Schicht)
  return _auth.signInWithEmailAndPassword(email, hashed);
}

// ── Registrierung ───────────────────────
export async function registerWithEmail(email, password, displayName) {
  const hashed = await hashPassword(password);
  const cred   = await _auth.createUserWithEmailAndPassword(email, hashed);
  await cred.user.updateProfile({ displayName });
  await _db.collection('users').doc(cred.user.uid).set({
    name:      displayName,
    email,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    grades:    {}
  });
  return cred;
}

// ── Profil aktualisieren ─────────────────
export async function updateUserProfile(uid, displayName, photoURL) {
  // Firebase Auth photoURL hat ein Limit — große data-URLs (PNG) nur in Firestore speichern
  const authPhoto = photoURL && photoURL.length < 2000 ? photoURL : null;
  await _auth.currentUser.updateProfile({ displayName, photoURL: authPhoto });
  await _db.collection('users').doc(uid).set(
    { name: displayName, photoURL: photoURL || null },
    { merge: true }
  );
}

// ── Google Login ────────────────────────
export async function loginWithGoogle() {
  const provider = new firebase.auth.GoogleAuthProvider();
  const cred = await _auth.signInWithPopup(provider);
  const doc  = await _db.collection('users').doc(cred.user.uid).get();
  if (!doc.exists) {
    await _db.collection('users').doc(cred.user.uid).set({
      name:      cred.user.displayName || 'Nutzer',
      email:     cred.user.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      grades:    {}
    });
  }
  return cred;
}

// ── Abmelden ────────────────────────────
export async function logout() {
  return _auth.signOut();
}

// ── Nutzerdaten aus Firestore ───────────
export async function getUserData(uid) {
  const doc = await _db.collection('users').doc(uid).get();
  return doc.exists ? doc.data() : null;
}

// ── Rollen (admin / tester) ─────────────
// Auto-Set anhand E-Mail-Whitelist beim Login. Jeder User schreibt sein eigenes Doc — Rules erlauben das via isOwner.
const ADMIN_EMAILS  = ['simonkoper27@gmail.com'];
const TESTER_EMAILS = ['bohmrobin797@gmail.com'];

export async function syncUserRole(uid, email) {
  if (!uid || !email) return;
  const target = ADMIN_EMAILS.includes(email)  ? 'admin'
              :  TESTER_EMAILS.includes(email) ? 'tester'
              : null;
  if (!target) return;
  const doc = await _db.collection('users').doc(uid).get();
  if (doc.exists && doc.data().role === target) return; // schon gesetzt
  await _db.collection('users').doc(uid).set({ role: target }, { merge: true });
}

// ── Claude-Test-Account ─────────────────────
// Markiert das eigene User-Doc als Claude-Test-Account: bekommt Admin-Rolle,
// wird in Suche/Rangliste/Feed ausgeblendet. Login-Daten leben nur in localStorage
// auf Simons PC (key 'lf_claude_creds') — nichts davon liegt im Repo.
//
// Effective auth: BY DESIGN admin-only. The set() below writes
// `role:'admin' + isClaude:true` to users/{uid}. firestore.rules permits
// that only via the Case-B-admin branch (request.auth.token.email in
// adminEmails()), i.e. simonkoper27@gmail.com. The tester whitelist
// CANNOT call this — Case-B-tester only allows role:'tester' on the
// role field, and isClaude is not in ownerSafeFields(). A tester who
// invokes this from the console would get permission-denied on the
// users/ write (the leaderboard mirror has a silent .catch and would
// also be denied). This is intentional: marking yourself as a test
// account is an admin power, not a tester power. (V-03 cycle-2 followup.)
export async function markAsClaude(uid) {
  if (!uid) return;
  await _db.collection('users').doc(uid).set({
    isClaude: true,
    role: 'admin',
    name: 'Claude (Test)'
  }, { merge: true });
  // Spiegel auf leaderboard, damit der !e.isClaude-Filter in getLeaderboard()
  // wirklich greift (Filter las bisher ein Feld, das auf leaderboard nicht existierte).
  await _db.collection('leaderboard').doc(uid)
    .set({ isClaude: true }, { merge: true })
    .catch(() => {});
}

export async function loginAsClaude() {
  const raw = localStorage.getItem('lf_claude_creds');
  if (!raw) throw new Error('Keine Claude-Credentials im localStorage gespeichert.');
  let creds;
  try { creds = JSON.parse(raw); } catch { throw new Error('Claude-Credentials defekt.'); }
  if (!creds.email || !creds.password) throw new Error('Email oder Passwort fehlt.');
  const hashed = await hashPassword(creds.password);
  let cred;
  try {
    cred = await _auth.signInWithEmailAndPassword(creds.email, hashed);
  } catch (e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
      // Account existiert noch nicht — anlegen.
      cred = await _auth.createUserWithEmailAndPassword(creds.email, hashed);
      await cred.user.updateProfile({ displayName: 'Claude (Test)' });
      await _db.collection('users').doc(cred.user.uid).set({
        name: 'Claude (Test)',
        email: creds.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        grades: {}
      });
    } else {
      throw e;
    }
  }
  await markAsClaude(cred.user.uid);
  return cred;
}

// ── Hacker-Test-Account (Red-Team) ──────────
// Spiegel-Mechanismus zum Claude-Account, fuer Live-Exploit-Tests von Ramsey.
// Markiert das eigene User-Doc als Hacker-Test-Account: bekommt Admin-Rolle,
// damit Admin-Write-Surface getestet werden kann; wird in Suche/Rangliste/Feed
// ausgeblendet (Filter !isHacker in searchUsers + getLeaderboard).
// Credentials: localStorage-Key 'lf_hacker_creds' = { email, password } —
// existiert nur lokal auf Simons PC, wird NIEMALS ins Repo committet und
// NIEMALS geloggt.
//
// Same admin-only design as markAsClaude (see comment above): role:'admin'
// + isHacker:true requires Case-B-admin. The tester whitelist cannot
// promote itself this way — V-03 split keeps role-sensitive writes on
// the admin email tier. (V-03 cycle-2 followup.)
export async function markAsHacker(uid) {
  if (!uid) return;
  await _db.collection('users').doc(uid).set({
    isHacker: true,
    role: 'admin',
    name: 'Hacker (Test)'
  }, { merge: true });
  // Spiegel auf leaderboard, damit der !e.isHacker-Filter in getLeaderboard()
  // wirklich greift (gleiches Pattern wie isClaude).
  await _db.collection('leaderboard').doc(uid)
    .set({ isHacker: true }, { merge: true })
    .catch(() => {});
}

// Credentials-Konvention: localStorage.lf_hacker_creds = JSON { email, password }
// Liegt nur auf Simons Maschine, NIE im Repo, NIE in Logs/Telemetry.
export async function loginAsHacker() {
  const raw = localStorage.getItem('lf_hacker_creds');
  if (!raw) throw new Error('Keine Hacker-Credentials im localStorage gespeichert.');
  let creds;
  try { creds = JSON.parse(raw); } catch { throw new Error('Hacker-Credentials defekt.'); }
  if (!creds.email || !creds.password) throw new Error('Email oder Passwort fehlt.');
  const hashed = await hashPassword(creds.password);
  let cred;
  try {
    cred = await _auth.signInWithEmailAndPassword(creds.email, hashed);
  } catch (e) {
    if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
      // Account existiert noch nicht — anlegen.
      cred = await _auth.createUserWithEmailAndPassword(creds.email, hashed);
      await cred.user.updateProfile({ displayName: 'Hacker (Test)' });
      await _db.collection('users').doc(cred.user.uid).set({
        name: 'Hacker (Test)',
        email: creds.email,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        grades: {}
      });
    } else {
      throw e;
    }
  }
  await markAsHacker(cred.user.uid);
  return cred;
}

export async function setUserRole(uid, role) {
  // role: 'admin' | 'tester' | null (=remove)
  // Wave-1 hardening 2026-05-08 (Marcus, Hard rule 4 + 5): the previous
  // `update({role: FieldValue.delete()})` violated both:
  //   - Hard rule 4 (no `update()` for partial writes — throws on missing doc)
  //   - Hard rule 5 (no `delete()` for resets — race-prone)
  // Switched to `set+merge` with `null` as the reset marker. Reader code
  // already handles `role: null` gracefully (see roleBadge() and userRole()
  // in app.js — both treat null/undefined as "no role").
  await _db.collection('users').doc(uid).set({ role: role }, { merge: true });
}

// ── Cosmetics: Outlines + Themes ────────────────────────
export async function unlockTheme(uid, themeId) {
  await _db.collection('users').doc(uid).set({
    themes: firebase.firestore.FieldValue.arrayUnion(themeId)
  }, { merge: true });
}

export async function setActiveTheme(uid, themeId) {
  await _db.collection('users').doc(uid).set({ activeTheme: themeId }, { merge: true });
  // Mirror auf leaderboard, damit Theme-Wechsel ohne Test-Save sichtbar wird.
  // Silent catch — wenn Mirror scheitert, soll der User-Pick nicht broken sein.
  await _db.collection('leaderboard').doc(uid)
    .set({ activeTheme: themeId }, { merge: true })
    .catch(() => {});
}

export async function setActiveOutline(uid, outlineId) {
  await _db.collection('users').doc(uid).set({ activeOutline: outlineId }, { merge: true });
  // Mirror auf leaderboard, damit Outline-Wechsel ohne Test-Save sichtbar wird.
  // Silent catch — wenn Mirror scheitert, soll der User-Pick nicht broken sein.
  await _db.collection('leaderboard').doc(uid)
    .set({ activeOutline: outlineId }, { merge: true })
    .catch(() => {});
}

// ── Admin-Tools (für Testing-Tab) ───────────────────────
// Wave-1 hardening 2026-05-08 (Marcus, B-M05): the leaderboard mirror
// block is now SKIPPED when the caller is not an admin. Tester accounts
// (Robin) hit this path via testSetXP / testWipeAll / etc. — the
// leaderboard.update rule denies their cross-user mirror writes
// (`isOwner(uid)` fails because target uid != caller; `isAdmin()` fails
// because tester has role:'tester'). The previous silent .catch hid the
// failure; the rangliste then showed stale values until the target user
// next ran a test. Skipping the mirror avoids the silent fail entirely;
// the next test-submit by the target user re-syncs via the worker.
export async function adminPatchUser(uid, patch) {
  // Setzt beliebige Felder auf einem User-Doc — nur via Admin-Rolle in Rules erlaubt
  await _db.collection('users').doc(uid).set(patch, { merge: true });

  // Caller-admin gate: only admins may mirror to leaderboard. Testers
  // skip — the leaderboard re-syncs on the target user's next test.
  const callerEmail = _auth?.currentUser?.email || null;
  const isCallerAdmin = !!callerEmail && ADMIN_EMAILS.includes(callerEmail);
  if (!isCallerAdmin) return;

  // Mirror leaderboard-relevanter Felder, sonst zeigt Rangliste alte Werte
  // bis der Target-User selbst einen Test macht. Cross-User-Write erlaubt
  // weil isAdmin() die leaderboard-Rule deckt. Silent catch: Patch ist trotzdem
  // erfolgreich auf users/, falls Mirror scheitert.
  if (patch && typeof patch === 'object') {
    const lbMirror = {};
    if (patch.klasse        !== undefined) lbMirror.klasse        = String(patch.klasse);
    if (patch.activeOutline !== undefined) lbMirror.activeOutline = patch.activeOutline;
    if (patch.activeTheme   !== undefined) lbMirror.activeTheme   = patch.activeTheme;
    if (typeof patch.xp === 'number')      lbMirror.xp            = patch.xp;
    if (patch.role          !== undefined) lbMirror.role          = patch.role;
    if (patch.isBanned      !== undefined) lbMirror.isBanned      = patch.isBanned;
    if (patch.displayName   !== undefined) lbMirror.displayName   = patch.displayName;
    if (patch.name          !== undefined) lbMirror.displayName   = patch.name;
    if (patch.photoURL      !== undefined) lbMirror.photoURL      = patch.photoURL || null;
    if (Object.keys(lbMirror).length) {
      await _db.collection('leaderboard').doc(uid)
        .set(lbMirror, { merge: true })
        .catch(() => {});
    }
  }
}

// ── Onboarding-Helper ───────────────────────────────────
// Markiert User als Wizard-abgeschlossen. Frontend ruft das einmal am Wizard-Ende.
export async function markOnboarded(uid) {
  if (!uid) return;
  await _db.collection('users').doc(uid).set({
    onboardedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

// ── Klassen-Save (string-standardisiert) ────────────────
// Eine Quelle für klasse-Schreibe, mirror direkt auf leaderboard. Verwendet
// String — userData.klasse war historisch number-or-string, ab jetzt string.
export async function setUserKlasse(uid, klasse) {
  if (!uid) return;
  const k = String(klasse);
  await _db.collection('users').doc(uid).set({ klasse: k }, { merge: true });
  await _db.collection('leaderboard').doc(uid)
    .set({ klasse: k }, { merge: true })
    .catch(() => {});
}

// ── Banned-Live-Kick (Open Q6) ──────────────────────────
// Realtime-Listener auf users/{uid}. Wenn Admin den User bannt, feuert der
// Snapshot mit isBanned === true und das Frontend kann sofort logout() triggern.
// Returnt die unsubscribe-Function.
export function watchBannedStatus(uid, callback) {
  if (!uid || typeof callback !== 'function') return () => {};
  return _db.collection('users').doc(uid).onSnapshot(
    snap => {
      if (snap.exists && snap.data().isBanned === true) callback();
    },
    () => {} // silent catch — Listener-Fehler sollen den Login nicht crashen
  );
}

export async function adminUnlockAllForUser(uid, allOutlines, allThemes) {
  await _db.collection('users').doc(uid).set({
    themes:   allThemes,
    outlines: allOutlines
  }, { merge: true });
}

// ── Note speichern ──────────────────────
// Hard rule 4 (Wave-1 fix, Marcus, 2026-05-08, CHEAT-28): switched from
// `update()` to `set+merge`. Without this, a brand-new user's first
// grade-save against a not-yet-fully-existent users/{uid} doc would throw
// (`update()` requires the doc to exist; the doc only gets created on the
// register/login auth-handler path). set+merge auto-creates if needed
// AND covers the dot-path nested-write semantics identically.
export async function saveGrade(uid, subjectId, yearId, topicId, gradeData) {
  const key = `grades.${subjectId}__${yearId}__${topicId}`;
  await _db.collection('users').doc(uid).set({
    [key]: {
      ...gradeData,
      date: firebase.firestore.FieldValue.serverTimestamp()
    }
  }, { merge: true });
}

// ── Auth-State beobachten ───────────────
export function onAuthStateChanged(callback) {
  return _auth.onAuthStateChanged(callback);
}

// ── Rangliste ────────────────────────────
// updateLeaderboard() REMOVED (Cycle-2 / V-24 fix, Marcus 2026-05-08).
// The previous client-side `set({scores:{[k]: pts}}, {merge:true})` was
// dead code (no caller in app.js — submitTestResult Cloud Worker has
// owned the leaderboard write since Mission 6) AND the matching rule
// allowed any value for the scores entry, which Ramsey weaponised in
// Cycle-2 to claim Top-1 with forged 999999 scores. The rule has been
// tightened to allow owner-update only on display fields (activeTheme/
// activeOutline/scores-reset) — the worker is now the sole writer for
// real `scores` values via service-account credentials.

export async function resetLeaderboard(uid) {
  // merge:true beibehalten, damit displayName/photoURL/klasse/activeOutline/xp/role
  // nicht weggeloescht werden. scores: {} ueberschreibt gezielt nur das Map-Feld.
  // (Hard rule 5: kein delete() — empty-map via set+merge ist das richtige Pattern.)
  await _db.collection('leaderboard').doc(uid).set({
    scores: {},
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

// klasseFilter: null = global, string = klassenspezifisch.
// Server-side where() nutzt den Auto-Index auf single-field — kein manueller Index noetig.
export async function getLeaderboard(klasseFilter = null) {
  let query = _db.collection('leaderboard');
  if (klasseFilter !== null && klasseFilter !== undefined && klasseFilter !== '') {
    query = query.where('klasse', '==', String(klasseFilter));
  }
  const snap = await query.get({ source: 'server' });
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(e => Object.keys(e.scores || {}).length > 0)
    .filter(e => !e.isClaude)   // Claude-Test-Account ausblenden (greift jetzt dank markAsClaude-Mirror)
    .filter(e => !e.isHacker);  // Hacker-Test-Account (Red-Team) ausblenden — Mirror via markAsHacker
}

export async function getAllUsers() {
  const snap = await _db.collection('users').get({ source: 'server' });
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function setBanStatus(uid, banned) {
  await _db.collection('users').doc(uid).set({ isBanned: banned }, { merge: true });
}

// ── Gruppen ───────────────────────────────
function _genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function createGroup(uid, displayName, photoURL, groupName) {
  const code     = _genCode();
  const groupRef = _db.collection('groups').doc();
  await groupRef.set({
    name: groupName, code,
    creatorUid: uid,
    members: { [uid]: { displayName, photoURL: photoURL || null, role: 'admin' } },
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  await _db.collection('users').doc(uid).set(
    { groupIds: firebase.firestore.FieldValue.arrayUnion(groupRef.id) }, { merge: true }
  );
  return groupRef.id;
}

// Hard rule 4 (Wave-1, Marcus, 2026-05-08, B-M02): switched from
// `doc.ref.update()` to `set+merge`. The matching firestore.rule was
// also fixed in the same wave to allow the self-join carve-out
// (groups.update Case B). Without both fixes, group-join was silently
// broken — the rule denied the write because the joiner is not the
// creator, and the client used `update()` which would fail with the
// same generic permission-denied error a legacy missing-doc would.
export async function joinGroupByCode(uid, displayName, photoURL, code) {
  const snap = await _db.collection('groups').where('code', '==', code.trim().toUpperCase()).limit(1).get();
  if (snap.empty) throw new Error('Kein Gruppe mit diesem Code gefunden.');
  const doc  = snap.docs[0];
  if (doc.data().members?.[uid]) throw new Error('Du bist bereits in dieser Gruppe.');
  await doc.ref.set({
    members: { [uid]: { displayName, photoURL: photoURL || null, role: 'member' } }
  }, { merge: true });
  await _db.collection('users').doc(uid).set(
    { groupIds: firebase.firestore.FieldValue.arrayUnion(doc.id) }, { merge: true }
  );
  return doc.id;
}

// Hard rule 4 + 5 (Wave-1, Marcus, 2026-05-08): switched from
// `update()` + `FieldValue.delete()` to `set+merge` + `null` marker.
// The map-key-`null`-marker is what the firestore.rule's self-leave
// carve-out (groups.update Case C) accepts; downstream readers
// (`Object.entries(group.members).filter(([_, v]) => v != null)`) skip
// null-markers, which is the same as semantically "left the group".
// Hard rule 4: set+merge auto-creates if doc is missing.
// Hard rule 5: null-marker pattern instead of FieldValue.delete().
export async function leaveGroup(uid, groupId) {
  const ref  = _db.collection('groups').doc(groupId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data();
  if (data.creatorUid === uid) {
    // Creator deletes the group entirely — semantic delete (Hard rule 5
    // exception: the group ITSELF goes away, not a per-member reset).
    const batch    = _db.batch();
    const members  = Object.keys(data.members || {});
    members.forEach(m => batch.set(_db.collection('users').doc(m),
      { groupIds: firebase.firestore.FieldValue.arrayRemove(groupId) },
      { merge: true }));
    batch.delete(ref);
    await batch.commit();
  } else {
    await ref.set({
      members: { [uid]: null }
    }, { merge: true });
    await _db.collection('users').doc(uid).set(
      { groupIds: firebase.firestore.FieldValue.arrayRemove(groupId) },
      { merge: true }
    );
  }
}

// Hard rule 4 + 5 (Wave-1, Marcus, 2026-05-08): same null-marker pattern
// as leaveGroup. firestore.rule allows this via creator-Case-A on groups.
export async function kickFromGroup(groupId, targetUid) {
  await _db.collection('groups').doc(groupId).set({
    members: { [targetUid]: null }
  }, { merge: true });
  await _db.collection('users').doc(targetUid).set(
    { groupIds: firebase.firestore.FieldValue.arrayRemove(groupId) },
    { merge: true }
  );
}

export async function getUserGroups(groupIds) {
  if (!groupIds?.length) return [];
  const docs = await Promise.all(groupIds.map(id => _db.collection('groups').doc(id).get()));
  return docs.filter(d => d.exists).map(d => ({ id: d.id, ...d.data() }));
}

// ── Eigene Inhalte ────────────────────────
export async function saveCustomTopic(uid, data, groupId = null) {
  const ref = _db.collection('customTopics').doc();
  await ref.set({
    ownerUid:    uid,
    groupId:     groupId || null,
    fach:        data.fach        || '',
    klasse:      data.klasse      || '',
    thema:       data.thema       || '',
    description: data.description || '',
    content:     data.content     || '',
    questions:   data.questions   || [],
    createdAt:   firebase.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

export async function getMyCustomTopics(uid) {
  const snap = await _db.collection('customTopics')
    .where('ownerUid', '==', uid).where('groupId', '==', null).get({ source: 'server' });
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getGroupCustomTopics(groupId) {
  const snap = await _db.collection('customTopics')
    .where('groupId', '==', groupId).get({ source: 'server' });
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteCustomTopic(topicId) {
  await _db.collection('customTopics').doc(topicId).delete();
}

export async function getCustomTopicById(topicId) {
  const doc = await _db.collection('customTopics').doc(topicId).get({ source: 'server' });
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

// ── Lesezeichen (F-19) ─────────────────────
// Hard rule 4 (Wave-1, Marcus, 2026-05-08): set+merge instead of update().
// arrayUnion/arrayRemove are field-transforms that work identically under
// set+merge, and set+merge auto-creates the doc if it's missing.
export async function toggleBookmark(uid, key, isBookmarked) {
  const op = isBookmarked
    ? firebase.firestore.FieldValue.arrayRemove(key)
    : firebase.firestore.FieldValue.arrayUnion(key);
  await _db.collection('users').doc(uid).set({ bookmarks: op }, { merge: true });
}

// ── Notizen (F-18) ─────────────────────────
export async function saveNote(uid, key, text) {
  await _db.collection('users').doc(uid).set({ notes: { [key]: text } }, { merge: true });
}

// ── SRS speichern (F-16) ───────────────────
export async function saveSRS(uid, srsData) {
  await _db.collection('users').doc(uid).set({ srs: srsData }, { merge: true });
}

// ── Klausuren speichern (F-1, Cycle 2026-05-08) ────────────
// Schreib-Pfad fuer userData.exams. Frontend baut den ganzen Array (anlegen
// = append, loeschen = filter), wir setzen ihn komplett mit set+merge zurueck.
//
// Hard rule 4 erfuellt: set({...}, {merge:true}). Kein update() — der erste
// Eintrag eines Bestands-Users (kein `exams`-Feld auf dem User-Doc) muss
// sauber durchgehen, set+merge legt das Feld implizit an.
//
// Hard rule 5 erfuellt: kein delete(), kein FieldValue.arrayRemove(). Loeschen
// einer Klausur = clientseitig filtern und KOMPLETTES Array zurueckschreiben.
// arrayRemove waere semantisch eine Delete-Operation auf Array-Elementen und
// ist gegen race-bedingte Doppel-Loesch-Probleme genauso anfaellig wie ein
// reines delete().
//
// Defense-in-depth-Validierung: die Rules whitelisten nur den Field-NAMEN
// `exams` (siehe ownerSafeFields), aber keine Struktur. Daher hier
// clientseitig pruefen, dass kein Garbage rein kann (selbst falls jemand
// per Console manuell ruft).
export async function saveExams(uid, examsArray) {
  if (!uid) throw new Error('saveExams: uid fehlt.');
  if (!Array.isArray(examsArray)) {
    throw new Error('saveExams: examsArray muss ein Array sein.');
  }
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  examsArray.forEach((exam, i) => {
    if (!exam || typeof exam !== 'object') {
      throw new Error(`saveExams: Eintrag ${i} ist kein Objekt.`);
    }
    if (typeof exam.id !== 'string' || !exam.id) {
      throw new Error(`saveExams: Eintrag ${i}.id muss non-empty string sein.`);
    }
    if (typeof exam.subject !== 'string' || !exam.subject) {
      throw new Error(`saveExams: Eintrag ${i}.subject muss non-empty string sein.`);
    }
    if (typeof exam.klasse !== 'string'
        || !['5','6','7','8','9','10','11','12','13'].includes(exam.klasse)) {
      throw new Error(`saveExams: Eintrag ${i}.klasse muss string in 5..13 sein.`);
    }
    if (typeof exam.date !== 'string' || !dateRe.test(exam.date)) {
      throw new Error(`saveExams: Eintrag ${i}.date muss YYYY-MM-DD sein.`);
    }
    if (!Array.isArray(exam.topicIds)
        || !exam.topicIds.every(t => typeof t === 'string')) {
      throw new Error(`saveExams: Eintrag ${i}.topicIds muss Array von strings sein.`);
    }
    if (typeof exam.createdAt !== 'number') {
      throw new Error(`saveExams: Eintrag ${i}.createdAt muss number sein.`);
    }
  });
  await _db.collection('users').doc(uid).set(
    { exams: examsArray }, { merge: true }
  );
}

// ── Erklaer-mir-warum-falsch Cache (F-3, Cycle 2026-05-08) ─
// Schreib-Pfad fuer userData.errorExplanations[qId]. Map-Merge-Pattern
// analog zu saveNote(uid, key, text), nur mit nested object statt string.
//
// Hard rule 4 erfuellt: set+merge mit dot-path-aequivalentem nested object.
// Firestore-merge-Semantik: nur der eine qId-Key wird im Map ueberschrieben/
// angelegt, alle anderen bleiben unangetastet. Erstaufruf bei Bestands-User
// (kein `errorExplanations`-Feld) legt das Feld implizit an.
//
// Hard rule 5: nicht relevant — kein Reset-Pfad im V1. Falls in V2 ein
// "Cache leeren" gebraucht wird: set({errorExplanations:{}}, {merge:true})
// ueberschreibt den ganzen Map, NICHT delete().
//
// Validierung defense-in-depth (Rules whitelisten nur Feld-Namen, keine
// Struktur — Cap auf Erklaerungs-Laenge verhindert AI-Halluzinations-Bombe
// die das 1MB-User-Doc-Limit auffuellen wuerde).
export async function saveErrorExplanation(uid, qId, explanationText) {
  if (!uid) throw new Error('saveErrorExplanation: uid fehlt.');
  if (typeof qId !== 'string' || !qId) {
    throw new Error('saveErrorExplanation: qId muss non-empty string sein.');
  }
  if (typeof explanationText !== 'string') {
    throw new Error('saveErrorExplanation: explanationText muss string sein.');
  }
  const len = explanationText.length;
  if (len < 1 || len > 2000) {
    throw new Error('saveErrorExplanation: explanationText length muss 1..2000 sein.');
  }
  // Wave-1 hardening 2026-05-08 (Marcus, B-M10): generatedAt as numeric
  // ms (Date.now()), not serverTimestamp. The optimistic local update in
  // app.js writes Date.now() too — using serverTimestamp here would have
  // produced a Firestore Timestamp object on round-trip while the local
  // optimistic value stays a number. Any future TTL-comparison code
  // (e.g. "regenerate explanations older than 30 days") would have hit
  // a TypeError on the Timestamp branch. Numeric ms is also what the
  // Worker uses for topicDropCooldowns / themeDropCooldowns (same
  // nested-map-no-sentinel constraint applies for cf-write paths even
  // though this client write doesn't have that constraint).
  const entry = {
    explanation: explanationText,
    generatedAt: Date.now()
  };
  await _db.collection('users').doc(uid).set(
    { errorExplanations: { [qId]: entry } },
    { merge: true }
  );
}

// ── Lernzeit speichern (F-17) ──────────────
// Hard rule 4 (Wave-1, Marcus, 2026-05-08, CHEAT-36): collapsed the
// previous try-update-fallback-set pattern to a single set+merge call.
// FieldValue.increment is a transform that works identically under
// set+merge; the dot-path nested-write semantics are also identical.
// Set+merge auto-creates the doc + the studyTime map if missing — no
// need for the fallback branch anymore.
export async function addStudyTime(uid, minutes) {
  if (!uid || minutes <= 0) return;
  const key = new Date().toISOString().slice(0, 10);
  await _db.collection('users').doc(uid).set({
    [`studyTime.${key}`]: firebase.firestore.FieldValue.increment(minutes)
  }, { merge: true });
}

// ── Schwache Fragen tracken (F-03) ─────────
// Hard rule 4: never `update()` on a doc that may not exist. A brand-new
// user who fails their very first test would hit `update()` against a
// users/{uid} doc that exists but lacks `weakQuestions` — `update()` works
// for that, but if the doc itself is missing (race against the create
// path) it throws. set+merge is correct in both cases: the dot-path
// increment transform is supported identically by set+merge and
// auto-creates the doc if needed.
export async function saveWeakQuestions(uid, questionIds) {
  if (!questionIds.length) return;
  const inc = firebase.firestore.FieldValue.increment(1);
  const updates = {};
  questionIds.forEach(id => { updates[`weakQuestions.${id}`] = inc; });
  await _db.collection('users').doc(uid).set(updates, { merge: true }).catch(console.error);
}

// ── XP speichern (F-25) ───────────────────
// Hard rule 4 (Wave-1, Marcus, 2026-05-08, CHEAT-36): single set+merge
// instead of try-update-fallback-set. See addStudyTime for the same
// transform-under-merge rationale.
export async function saveXP(uid, xpToAdd) {
  const key = new Date().toISOString().slice(0, 10);
  await _db.collection('users').doc(uid).set({
    xp: firebase.firestore.FieldValue.increment(xpToAdd),
    [`xpLog.${key}`]: firebase.firestore.FieldValue.increment(xpToAdd)
  }, { merge: true });
}

// ── Achievements speichern (F-24) ─────────
export async function saveAchievements(uid, ids) {
  if (!ids.length) return;
  await _db.collection('users').doc(uid).set(
    { achievements: firebase.firestore.FieldValue.arrayUnion(...ids) }, { merge: true }
  );
}

// ── Allgemeiner Zähler (Fragen, SRS-Reviews) ─
// Hard rule 4 (Wave-1, Marcus, 2026-05-08, CHEAT-36): single set+merge.
export async function incrementCounter(uid, field, by = 1) {
  await _db.collection('users').doc(uid).set({
    [field]: firebase.firestore.FieldValue.increment(by)
  }, { merge: true });
}

// ── Daily Challenge Score (F-26) ──────────
// Subcollection-Pfad — passt zu firestore.rules (write nur fuer eigenen uid).
export async function saveDailyScore(uid, displayName, photoURL, dateKey, grade, points, maxPoints, role) {
  await _db.collection('dailyScores').doc(dateKey).collection('users').doc(uid).set({
    uid, displayName, photoURL: photoURL || null, grade, points, maxPoints, role: role || null
  }, { merge: true });
}

export async function getDailyScores(dateKey) {
  const snap = await _db.collection('dailyScores').doc(dateKey).collection('users').get({ source: 'server' });
  return snap.docs.map(d => d.data());
}

// ── Streak-Freeze (F-27) ──────────────────
export async function saveFreezeDays(uid, freezeDays) {
  await _db.collection('users').doc(uid).set({ freezeDays }, { merge: true });
}

// ── Kommentare (F-34) ─────────────────────
// Topic-Key kann "/" enthalten — als Pfad-Trenner ungeeignet. Sanitize zu sicherer Doc-ID.
function _safeKey(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '_'); }

export async function addComment(topicKey, uid, name, photo, text, role) {
  await _db.collection('comments').doc(_safeKey(topicKey)).collection('entries').add({
    uid, name, photo: photo || null, text,
    role: role || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    likes: {}
  });
}

export async function getComments(topicKey) {
  const snap = await _db.collection('comments').doc(_safeKey(topicKey))
    .collection('entries').orderBy('createdAt', 'asc').limit(100).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteComment(topicKey, commentId) {
  await _db.collection('comments').doc(_safeKey(topicKey)).collection('entries').doc(commentId).delete();
}

// Hard rule 4 + 5 (Wave-1, Marcus, 2026-05-08): set+merge with `false`
// marker instead of update + FieldValue.delete. Reader path checks
// `!!c.likes?.[uid]` so falsy (null/undefined/false) is uniformly
// "not liked" — the marker pattern is transparent to UI.
//
// Note the firestore.rule for comments still requires
// `likes.diff().affectedKeys().hasOnly([uid])` — set+merge with a single
// dot-path key produces exactly that diff, so the rule still permits
// the like-toggle.
export async function toggleCommentLike(topicKey, commentId, uid) {
  const ref = _db.collection('comments').doc(_safeKey(topicKey)).collection('entries').doc(commentId);
  const doc = await ref.get();
  const liked = !!(doc.data()?.likes?.[uid]);
  if (liked) {
    await ref.set({ likes: { [uid]: false } }, { merge: true });
  } else {
    await ref.set({ likes: { [uid]: true } }, { merge: true });
  }
  return !liked;
}

// ── Freunde (F-30) ────────────────────────
export async function searchUsers(query, currentUid) {
  if (!query?.trim()) return [];
  const snap = await _db.collection('users').limit(300).get();
  const q = query.toLowerCase().trim();
  return snap.docs
    .filter(d => d.id !== currentUid
              && !d.data().isClaude // Claude-Test-Account aus Friend-Suche raushalten
              && !d.data().isHacker // Hacker-Test-Account (Red-Team) aus Friend-Suche raushalten
              && (d.data().name || '').toLowerCase().includes(q))
    .slice(0, 10)
    .map(d => ({ uid: d.id, name: d.data().name, photo: d.data().photoURL || null, role: d.data().role || null }));
}

export async function sendFriendRequest(fromUid, fromName, fromPhoto, toUid, fromRole) {
  await _db.collection('users').doc(toUid).set({
    friendRequests: { [fromUid]: {
      name: fromName, photo: fromPhoto || null,
      role: fromRole || null, ts: Date.now()
    } }
  }, { merge: true });
}

// Hard rule 5 (Wave-1, Marcus, 2026-05-08): null marker instead of
// FieldValue.delete() for the friendRequests cleanup. Same rationale as
// rejectFriendRequest above — reader path filters null entries.
export async function acceptFriendRequest(uid, fromUid) {
  const batch = _db.batch();
  batch.set(_db.collection('users').doc(uid),
    { friendIds:      firebase.firestore.FieldValue.arrayUnion(fromUid),
      friendRequests: { [fromUid]: null } },
    { merge: true });
  batch.set(_db.collection('users').doc(fromUid),
    { friendIds: firebase.firestore.FieldValue.arrayUnion(uid) }, { merge: true });
  await batch.commit();
}

// Hard rule 4 + 5 (Wave-1, Marcus, 2026-05-08): set+merge with null
// marker. Reader code in app.js iterates friendRequests and skips null
// values (treats them as "no pending request"). The firestore.rule's
// Case-A (owner writing own friendRequests via ownerSafeFields) accepts
// this — friendRequests is in ownerSafeFields and the diff.affectedKeys
// check on Case-D doesn't apply because this is the owner's own write.
export async function rejectFriendRequest(uid, fromUid) {
  await _db.collection('users').doc(uid).set({
    friendRequests: { [fromUid]: null }
  }, { merge: true });
}

// Hard rule 4 (Wave-1, Marcus, 2026-05-08): batch.update -> batch.set
// with merge. arrayRemove is a transform that works under set+merge.
export async function unfriend(uid, friendUid) {
  const batch = _db.batch();
  batch.set(_db.collection('users').doc(uid),
    { friendIds: firebase.firestore.FieldValue.arrayRemove(friendUid) },
    { merge: true });
  batch.set(_db.collection('users').doc(friendUid),
    { friendIds: firebase.firestore.FieldValue.arrayRemove(uid) },
    { merge: true });
  await batch.commit();
}

export async function getFriendsData(friendIds) {
  if (!friendIds?.length) return [];
  const docs = await Promise.all(friendIds.slice(0, 30).map(id =>
    _db.collection('users').doc(id).get()
  ));
  return docs.filter(d => d.exists).map(d => ({
    uid: d.id, name: d.data().name,
    photo: d.data().photoURL || null, xp: d.data().xp || 0,
    role: d.data().role || null
  }));
}

// ── Aktivitäts-Feed (F-31) ────────────────
export async function writeFeedEntry(uid, type, payload) {
  await _db.collection('feed').add({
    uid, type, payload,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

export async function getFeedForFriends(friendIds) {
  if (!friendIds?.length) return [];
  const ids = friendIds.slice(0, 10);
  const snap = await _db.collection('feed')
    .where('uid', 'in', ids)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get({ source: 'server' });
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Peer-Review (F-35) — REMOVED Mission 2 Phase 2 ────────────
// submitTopicForReview / voteCustomTopic / getPendingTopics deleted —
// imported in app.js but never called (Ghost-Code-Cycle-1 finding).
// Ethan removes the corresponding imports + the pendingTopics rule
// block was deleted from firestore.rules in the same commit.

// ── Eltern-Share-Link (F-46) ──────────────
// Wave-1 hardening 2026-05-08 (Marcus, CHEAT-38): expiresAt added (90d).
// The matching rule now requires `expiresAt is number` at create time;
// the parent-share-report worker rejects expired tokens. createdAt is
// kept as a server timestamp for audit / display, but expiresAt is a
// numeric Date.now()-ms so the worker's `expiresAt > Date.now()` check
// is a single numeric compare (no Timestamp.toMillis dance).
const SHARE_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
export async function createShareToken(uid) {
  const token = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6);
  await _db.collection('shareLinks').doc(token).set({
    uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    expiresAt: Date.now() + SHARE_LINK_TTL_MS
  });
  return token;
}

export async function getShareData(token) {
  const doc = await _db.collection('shareLinks').doc(token).get();
  if (!doc.exists) return null;
  const uid   = doc.data().uid;
  const uSnap = await _db.collection('users').doc(uid).get();
  return uSnap.exists ? { ...uSnap.data(), uid } : null;
}

// ── Gruppen-Mitgliederdaten (F-43) ────────
export async function getMultipleUserData(uids) {
  if (!uids?.length) return [];
  const docs = await Promise.all(uids.map(id => _db.collection('users').doc(id).get()));
  return docs.filter(d => d.exists).map(d => ({ uid: d.id, ...d.data() }));
}

// ── Bug-Reports ──────────────────────────
export async function submitBugReport(uid, name, photoURL, text) {
  if (!text?.trim()) throw new Error('Text leer.');
  const ref = _db.collection('bugReports').doc();
  await ref.set({
    uid, name: name || 'Nutzer', photoURL: photoURL || null,
    text: text.trim().slice(0, 2000),
    resolved: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

// where + orderBy auf unterschiedlichen Feldern braucht einen Composite-Index in Firestore.
// Vermeiden wir, indem wir ohne orderBy queryen und clientseitig sortieren.
function _sortByCreatedDesc(arr) {
  return arr.sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });
}

export async function getOpenBugReports() {
  const snap = await _db.collection('bugReports')
    .where('resolved', '==', false)
    .limit(200)
    .get({ source: 'server' });
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _sortByCreatedDesc(arr).slice(0, 100);
}

export async function getMyBugReports(uid) {
  const snap = await _db.collection('bugReports')
    .where('uid', '==', uid)
    .limit(50)
    .get({ source: 'server' });
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return _sortByCreatedDesc(arr).slice(0, 20);
}

export async function resolveBugReport(id, note) {
  await _db.collection('bugReports').doc(id).set({
    resolved: true,
    resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
    resolvedNote: note || null
  }, { merge: true });
}

export async function deleteBugReport(id) {
  await _db.collection('bugReports').doc(id).delete();
}
