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
