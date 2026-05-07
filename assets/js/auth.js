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
export async function markAsClaude(uid) {
  if (!uid) return;
  await _db.collection('users').doc(uid).set({
    isClaude: true,
    role: 'admin',
    name: 'Claude (Test)'
  }, { merge: true });
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

export async function setUserRole(uid, role) {
  // role: 'admin' | 'tester' | null (=remove)
  if (role === null) {
    await _db.collection('users').doc(uid).update({
      role: firebase.firestore.FieldValue.delete()
    });
  } else {
    await _db.collection('users').doc(uid).set({ role }, { merge: true });
  }
}

// ── Cosmetics: Outlines + Themes ────────────────────────
export async function unlockTheme(uid, themeId) {
  await _db.collection('users').doc(uid).set({
    themes: firebase.firestore.FieldValue.arrayUnion(themeId)
  }, { merge: true });
}

export async function setActiveTheme(uid, themeId) {
  await _db.collection('users').doc(uid).set({ activeTheme: themeId }, { merge: true });
}

export async function setActiveOutline(uid, outlineId) {
  await _db.collection('users').doc(uid).set({ activeOutline: outlineId }, { merge: true });
}

// ── Admin-Tools (für Testing-Tab) ───────────────────────
export async function adminPatchUser(uid, patch) {
  // Setzt beliebige Felder auf einem User-Doc — nur via Admin-Rolle in Rules erlaubt
  await _db.collection('users').doc(uid).set(patch, { merge: true });
}

export async function adminUnlockAllForUser(uid, allOutlines, allThemes) {
  await _db.collection('users').doc(uid).set({
    themes:   allThemes,
    outlines: allOutlines
  }, { merge: true });
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
    .filter(e => Object.keys(e.scores || {}).length > 0)
    .filter(e => !e.isClaude); // Claude-Test-Account ausblenden
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

// ── XP speichern (F-25) ───────────────────
export async function saveXP(uid, xpToAdd) {
  const key = new Date().toISOString().slice(0, 10);
  await _db.collection('users').doc(uid).update({
    xp: firebase.firestore.FieldValue.increment(xpToAdd),
    [`xpLog.${key}`]: firebase.firestore.FieldValue.increment(xpToAdd)
  }).catch(() =>
    _db.collection('users').doc(uid).set(
      { xp: xpToAdd, xpLog: { [key]: xpToAdd } }, { merge: true }
    )
  );
}

// ── Achievements speichern (F-24) ─────────
export async function saveAchievements(uid, ids) {
  if (!ids.length) return;
  await _db.collection('users').doc(uid).set(
    { achievements: firebase.firestore.FieldValue.arrayUnion(...ids) }, { merge: true }
  );
}

// ── Allgemeiner Zähler (Fragen, SRS-Reviews) ─
export async function incrementCounter(uid, field, by = 1) {
  await _db.collection('users').doc(uid).update({
    [field]: firebase.firestore.FieldValue.increment(by)
  }).catch(() =>
    _db.collection('users').doc(uid).set({ [field]: by }, { merge: true })
  );
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

export async function toggleCommentLike(topicKey, commentId, uid) {
  const ref = _db.collection('comments').doc(_safeKey(topicKey)).collection('entries').doc(commentId);
  const doc = await ref.get();
  const liked = !!(doc.data()?.likes?.[uid]);
  if (liked) {
    await ref.update({ [`likes.${uid}`]: firebase.firestore.FieldValue.delete() });
  } else {
    await ref.update({ [`likes.${uid}`]: true });
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

export async function acceptFriendRequest(uid, fromUid) {
  const batch = _db.batch();
  batch.set(_db.collection('users').doc(uid),
    { friendIds: firebase.firestore.FieldValue.arrayUnion(fromUid),
      [`friendRequests.${fromUid}`]: firebase.firestore.FieldValue.delete() },
    { merge: true });
  batch.set(_db.collection('users').doc(fromUid),
    { friendIds: firebase.firestore.FieldValue.arrayUnion(uid) }, { merge: true });
  await batch.commit();
}

export async function rejectFriendRequest(uid, fromUid) {
  await _db.collection('users').doc(uid).update({
    [`friendRequests.${fromUid}`]: firebase.firestore.FieldValue.delete()
  });
}

export async function unfriend(uid, friendUid) {
  const batch = _db.batch();
  batch.update(_db.collection('users').doc(uid),
    { friendIds: firebase.firestore.FieldValue.arrayRemove(friendUid) });
  batch.update(_db.collection('users').doc(friendUid),
    { friendIds: firebase.firestore.FieldValue.arrayRemove(uid) });
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

// ── Peer-Review (F-35) ───────────────────
export async function submitTopicForReview(topicId) {
  await _db.collection('customTopics').doc(topicId).update({ status: 'pending', votes: {} });
}

export async function voteCustomTopic(topicId, uid, vote) {
  const ref = _db.collection('customTopics').doc(topicId);
  await ref.set({ votes: { [uid]: vote } }, { merge: true });
  const doc    = await ref.get({ source: 'server' });
  const votes  = Object.values(doc.data()?.votes || {});
  if (votes.filter(v => v === 1).length >= 3) await ref.update({ status: 'public' });
  if (votes.filter(v => v === -1).length >= 3) await ref.update({ status: 'private' });
}

export async function getPendingTopics() {
  const snap = await _db.collection('customTopics')
    .where('status', '==', 'pending').get({ source: 'server' });
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Eltern-Share-Link (F-46) ──────────────
export async function createShareToken(uid) {
  const token = Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6);
  await _db.collection('shareLinks').doc(token).set({
    uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
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
