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
  // Offline-Persistence aktivieren (F-12)
  _db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
      console.warn('[Firestore persistence]', err);
    }
  });
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

// ── Note speichern ──────────────────────
export async function saveGrade(uid, subjectId, yearId, topicId, gradeData) {
  const key = `grades.${subjectId}__${yearId}__${topicId}`;
  await _db.collection('users').doc(uid).update({
    [key]: {
      ...gradeData,
      date: firebase.firestore.FieldValue.serverTimestamp()
    }
  });
}

// ── Auth-State beobachten ───────────────
export function onAuthStateChanged(callback) {
  return _auth.onAuthStateChanged(callback);
}

// ── Rangliste ────────────────────────────
export async function updateLeaderboard(uid, displayName, photoURL, subjectId, yearId, topicId, gradeNum, totalPoints) {
  const pts = typeof totalPoints === 'number' ? totalPoints : 0;
  await _db.collection('leaderboard').doc(uid).set({
    displayName,
    photoURL: photoURL || null,
    scores: { [`${subjectId}__${yearId}__${topicId}`]: pts },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

export async function resetLeaderboard(uid) {
  await _db.collection('leaderboard').doc(uid).set({
    scores: {},
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

export async function getLeaderboard() {
  const snap = await _db.collection('leaderboard').get({ source: 'server' });
  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(e => Object.keys(e.scores || {}).length > 0);
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

export async function joinGroupByCode(uid, displayName, photoURL, code) {
  const snap = await _db.collection('groups').where('code', '==', code.trim().toUpperCase()).limit(1).get();
  if (snap.empty) throw new Error('Kein Gruppe mit diesem Code gefunden.');
  const doc  = snap.docs[0];
  if (doc.data().members?.[uid]) throw new Error('Du bist bereits in dieser Gruppe.');
  await doc.ref.update({
    [`members.${uid}`]: { displayName, photoURL: photoURL || null, role: 'member' }
  });
  await _db.collection('users').doc(uid).set(
    { groupIds: firebase.firestore.FieldValue.arrayUnion(doc.id) }, { merge: true }
  );
  return doc.id;
}

export async function leaveGroup(uid, groupId) {
  const ref  = _db.collection('groups').doc(groupId);
  const snap = await ref.get();
  if (!snap.exists) return;
  const data = snap.data();
  if (data.creatorUid === uid) {
    const batch    = _db.batch();
    const members  = Object.keys(data.members || {});
    members.forEach(m => batch.update(_db.collection('users').doc(m),
      { groupIds: firebase.firestore.FieldValue.arrayRemove(groupId) }));
    batch.delete(ref);
    await batch.commit();
  } else {
    await ref.update({ [`members.${uid}`]: firebase.firestore.FieldValue.delete() });
    await _db.collection('users').doc(uid).update(
      { groupIds: firebase.firestore.FieldValue.arrayRemove(groupId) }
    );
  }
}

export async function kickFromGroup(groupId, targetUid) {
  await _db.collection('groups').doc(groupId).update({
    [`members.${targetUid}`]: firebase.firestore.FieldValue.delete()
  });
  await _db.collection('users').doc(targetUid).update(
    { groupIds: firebase.firestore.FieldValue.arrayRemove(groupId) }
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
export async function toggleBookmark(uid, key, isBookmarked) {
  const op = isBookmarked
    ? firebase.firestore.FieldValue.arrayRemove(key)
    : firebase.firestore.FieldValue.arrayUnion(key);
  await _db.collection('users').doc(uid).update({ bookmarks: op });
}

// ── Notizen (F-18) ─────────────────────────
export async function saveNote(uid, key, text) {
  await _db.collection('users').doc(uid).set({ notes: { [key]: text } }, { merge: true });
}

// ── SRS speichern (F-16) ───────────────────
export async function saveSRS(uid, srsData) {
  await _db.collection('users').doc(uid).set({ srs: srsData }, { merge: true });
}

// ── Lernzeit speichern (F-17) ──────────────
export async function addStudyTime(uid, minutes) {
  if (!uid || minutes <= 0) return;
  const key = new Date().toISOString().slice(0, 10);
  await _db.collection('users').doc(uid).update({
    [`studyTime.${key}`]: firebase.firestore.FieldValue.increment(minutes)
  }).catch(() =>
    _db.collection('users').doc(uid).set({ studyTime: { [key]: minutes } }, { merge: true })
  );
}

// ── Schwache Fragen tracken (F-03) ─────────
export async function saveWeakQuestions(uid, questionIds) {
  if (!questionIds.length) return;
  const inc = firebase.firestore.FieldValue.increment(1);
  const updates = {};
  questionIds.forEach(id => { updates[`weakQuestions.${id}`] = inc; });
  await _db.collection('users').doc(uid).update(updates).catch(console.error);
}
