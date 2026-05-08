// ══════════════════════════════════════════
//  LearningForge — Firebase Authentication
// ══════════════════════════════════════════

import { CONFIG } from './config.js';
import { listCustomTopics as _cfListCustomTopics } from './cf.js';

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
    grades:    {},
    // Cycle-3 Settings-Refactor (Marcus, 2026-05-08): explicit defaults for
    // every settings-key the Tab-2/3/4 UI reads. Bestands-User read via the
    // `?? default` fallback in app.js (forward-only per CLAUDE.md hard rule 7
    // — no migration script). subjectThemesOff was already shipped pre-Cycle-
    // 3; the rest is new and matches the Maya-spec schema-section
    // (settings-page-refactor-implementation.md, "Schema-Erweiterungen").
    settings:  _defaultUserSettings()
  });
  return cred;
}

// Cycle-3 Settings-Refactor (Marcus, 2026-05-08): single source-of-truth for
// the userData.settings default-shape. Used by all four user-doc-creation
// paths (registerWithEmail, loginWithGoogle, loginAsClaude, loginAsHacker) so
// a new user always starts with a complete settings-object — no `undefined`
// reads in the Settings-Page renderer. Bestands-User keep existing settings
// thanks to set+merge; missing keys are read with `?? <default>` in app.js.
//
// Hard-rule 7 compliant: forward-only. No backfill script writes these into
// existing user-docs — Ethan's Frontend reads with `?? <default>`. The first
// time a Bestands-User toggles ANY settings switch, set+merge writes the
// modified fields only, leaving every other key still missing from the doc
// (which is fine — read-side fallback covers it indefinitely).
function _defaultUserSettings() {
  return {
    subjectThemesOff:    false,           // existing pre-Cycle-3
    dailyReminderTime:   '18:00',         // 'HH:MM' or '' (= aus)
    streakWarnThreshold: 18,              // 0..23 (24h hour)
    subjectColors:       {},              // map<subjectId, paletteSlug>
    fontSize:            'normal',        // 'normal' | 'large' | 'xlarge'
    reducedMotion:       false,           // boolean
    defaultKlasseFilter: 'auto'           // 'auto' | '5'..'13'
  };
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
      grades:    {},
      // Cycle-3 Settings-Refactor — see _defaultUserSettings above.
      settings:  _defaultUserSettings()
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
        grades: {},
        // Cycle-3 Settings-Refactor — see _defaultUserSettings above.
        settings: _defaultUserSettings()
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
        grades: {},
        // Cycle-3 Settings-Refactor — see _defaultUserSettings above.
        settings: _defaultUserSettings()
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
//
// Cycle-6 schema-erweiterung (Marcus, 2026-05-08, F-09 Konfidenz-Verlauf):
// `gradeData.history[]` entries may now carry an optional `confidence: 1..5`
// field (numeric, integer). Skipped attempts have `confidence === undefined`
// so the Profil-Selbsteinschaetzung-Tab and Result-Banner ignore them.
// Defense-in-depth-Validierung defensively scrubs the array before write —
// the rule whitelists `grades` as a name but does not validate inner shape,
// so we cap the confidence range here and reject NaN / out-of-range values
// rather than letting console-injected garbage land in the user-doc and
// crash the chart-renderer in Ethan's profile-tab. No firestore.rules
// change required: `grades` is already in ownerSafeFields().
export async function saveGrade(uid, subjectId, yearId, topicId, gradeData) {
  const key = `grades.${subjectId}__${yearId}__${topicId}`;
  // Defensive scrub of the history array. We don't reject — bad confidence
  // values just get stripped so the rest of the attempt (date, grade, ...)
  // still saves. This matches the optional-field semantics of the spec.
  let cleaned = gradeData;
  if (gradeData && Array.isArray(gradeData.history)) {
    cleaned = {
      ...gradeData,
      history: gradeData.history.map(h => {
        if (!h || typeof h !== 'object') return h;
        const c = h.confidence;
        const ok = typeof c === 'number' && Number.isFinite(c)
                && c >= 1 && c <= 5 && Math.floor(c) === c;
        if ('confidence' in h && !ok) {
          const { confidence, ...rest } = h;
          return rest;
        }
        return h;
      })
    };
  }
  await _db.collection('users').doc(uid).set({
    [key]: {
      ...cleaned,
      date: firebase.firestore.FieldValue.serverTimestamp()
    }
  }, { merge: true });
}

// ── Konfidenz-Patch (F-09 Cycle-7 P1-3) ─────────────────
// Cycle-7 P1-3 (Marcus, 2026-05-08, Sophie audit + CF-confidence race):
// Race-frei nur die `confidence` auf dem LETZTEN history-Entry eines Grade-
// Eintrags patchen. Der CF-Pfad in app.js (submitTestResult) liest nach dem
// Worker-Write `userData` neu via getUserData(), modifiziert die letzte
// history-Position um confidence zu setzen, und ruft saveGrade() mit dem
// GANZEN gradeData-Objekt auf. Problem: getUserData() liest mit dem default
// Cache-Pfad (kein `source:'server'`), kann also veraltete history liefern.
// Selbst mit server-read besteht ein Race wenn der User waehrend des CF-
// Calls in einem zweiten Tab nochmal etwas am gleichen grade-Key schreibt
// (zweiter Test, Bookmark-Loesch ueber Firestore-Listener-Ripple, etc.).
// In jedem Fall ueberschreibt die nachfolgende saveGrade()-Schreibung die
// frischen Worker-Werte mit dem stale Snapshot.
//
// Loesung: Firestore-Transaction. Liest das User-Doc innerhalb der Tx
// (immer server-fresh), patcht nur das eine confidence-Feld auf der
// letzten history-Position, und schreibt mit `set+merge` (Hard rule 4)
// zurueck. Bei concurrent write retry-t Firestore die Tx automatisch.
// Damit:
//   - kein Verlust von server-side Worker-Writes (xpDelta, achievements,
//     bestPoints) — die landen ausserhalb der confidence-Patch-Region und
//     bleiben unangetastet.
//   - kein Verlust von confidence wenn ein parallel Write stattfindet —
//     Tx-Retry liest neue history neu, patcht erneut.
//   - kein Verlust von minutes/dailyStats auf exams — separater Top-Level-
//     Key.
//
// Hard rule 4: set+merge mit dot-path nested object — nur grades.<key>
// wird ueberschrieben. Hard rule 5: kein delete()-Pfad. Validierung der
// confidence-Range (1..5 int) wie in saveGrade()'s scrub-Logik.
//
// Frontend-Kontrakt (Ethan): app.js:10670-10684 ersetzt den read+saveGrade-
// Block durch einen einzigen Aufruf `saveGradeConfidence(uid, key, val)`.
// Returnt true bei Patch, false wenn keine history existiert (z.B. Worker
// hat den Eintrag gerade erst angelegt aber Tx liest ihn nicht — sollte
// nicht passieren, aber defensive: silent skip statt throw).
//
// KEIN Worker-Endpoint, KEIN Firestore-Rules-Update — `grades` ist bereits
// in ownerSafeFields() (siehe firestore.rules:99) und confidence ist nur
// ein nested Feld innerhalb dieses Map-Werts. Tx-Read+Write geht ueber
// dieselbe Case-A-Owner-Branch.
export async function saveGradeConfidence(uid, gradeKey, confidence) {
  if (!uid) throw new Error('saveGradeConfidence: uid fehlt.');
  if (typeof gradeKey !== 'string' || !gradeKey.startsWith('grades.')) {
    throw new Error('saveGradeConfidence: gradeKey muss "grades.<subj>__<year>__<topic>" sein.');
  }
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)
      || confidence < 1 || confidence > 5 || Math.floor(confidence) !== confidence) {
    throw new Error('saveGradeConfidence: confidence muss int 1..5 sein.');
  }
  // gradeKey hat das Format "grades.<subj>__<year>__<topic>". Wir brauchen
  // den inneren Key fuer den nested-set. Firestore-set+merge mit Dot-Path
  // auf `grades.<inner>` tut das richtige (nur dieser eine Map-Eintrag wird
  // ueberschrieben, andere grade-Keys bleiben).
  const innerKey = gradeKey.slice('grades.'.length);
  const docRef = _db.collection('users').doc(uid);
  return await _db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return false;
    const data = snap.data() || {};
    const ge = data.grades && data.grades[innerKey];
    if (!ge || !Array.isArray(ge.history) || ge.history.length === 0) {
      // Kein history-Eintrag zum Patchen — Worker hat noch nicht geschrieben
      // oder Doc ist defekt. Silent-skip damit der CF-Pfad nicht throwt.
      return false;
    }
    const lastIdx = ge.history.length - 1;
    const newHistory = ge.history.map((h, i) =>
      i === lastIdx ? { ...h, confidence } : h
    );
    // set+merge mit Dot-Path: nur `grades.<innerKey>` wird ueberschrieben,
    // der GESAMTE Map-Eintrag muss aber komplett mitgegeben werden weil
    // Firestore Map-Werte als atomic überschreibt (kein Deep-Merge in
    // einer einzelnen Map). Da wir das Doc gerade frisch in der Tx gelesen
    // haben ist der Snapshot kohaerent: alle Felder von ge bleiben erhalten,
    // nur history bekommt das Confidence-Update.
    tx.set(docRef, {
      [gradeKey]: { ...ge, history: newHistory }
    }, { merge: true });
    return true;
  });
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
    .filter(e => !e.isHacker)   // Hacker-Test-Account (Red-Team) ausblenden — Mirror via markAsHacker
    // Cycle-3 Settings-Refactor (Marcus, 2026-05-08, Sophie+Ramsey P1):
    // honour the per-user "auf Ranglisten anzeigen"-Toggle. The user
    // sets `lbHidden:true` via the Settings-Tab "Konto"; the field is
    // mirrored to leaderboard/{uid} by the submitTestResult Worker so
    // ranglistenfähige users without a fresh test still get filtered
    // (the lb-doc's mirror is the source the rule allows-through).
    .filter(e => !e.lbHidden);
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
// Phase 3a (Ethan, 2026-05-08): saveCustomTopic schreibt jetzt explizit
// `visibility`. Der 4-State-Schluessel auf der Server-Seite ist:
//   'private'           — nur Owner sieht es        (default, groupId=null)
//   'group'             — Group-Members sehen es    (groupId gesetzt)
//   'pending-approval'  — wird auf Public eingereicht (Worker-only)
//   'public'            — Public-Library            (Worker-only nach Approval)
//
// Wir erlauben dem Frontend hier nur 'private' / 'group' (rules-konform —
// firestore.rules `clientWritableVisibility()` blockt alles andere am
// create-time). Der Public-Submit-Pfad geht ueber den Worker
// submitTopicForApproval.
export async function saveCustomTopic(uid, data, groupId = null, visibility = null) {
  // Visibility default leitet sich aus groupId ab (Backwards-Compat mit den
  // existierenden builderUploadPersonal/builderUploadGroup-Aufrufen).
  // Explizite visibility-Param ueberschreibt das, falls der Caller das
  // selbst setzen will.
  const finalVisibility = visibility
    || (groupId ? 'group' : 'private');
  const ref = _db.collection('customTopics').doc();
  await ref.set({
    ownerUid:    uid,
    groupId:     groupId || null,
    visibility:  finalVisibility,
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

// V-PHASE-E-03 (Ramsey Cycle-E, P1, Marcus, 2026-05-08): the previous
// `clearRejectionNote(topicId)` wrapper wrote `rejectionNote:null +
// rejectedAt:null` directly from the client. Both fields are now Worker-
// only at the rules layer (audit-trail integrity — owner cannot erase a
// rejection). The re-submit-flow's "clear the rejection-banner" UX is
// now done server-side inside submitTopicForApproval (the Worker writes
// the null markers as part of the same atomic batch that flips
// visibility to 'pending-approval'). The frontend simply calls
// cf.submitTopicForApproval(topicId, message) and the Worker handles
// both the queue-row + the field reset. clearRejectionNote was removed
// here as dead-code; app.js's resubmit-handler no longer imports it.

// V-09 list-scope hardening (Marcus, 2026-05-08, Mission-13):
// the four customTopics list-wrappers now go through the Worker
// `listCustomTopics` endpoint instead of querying Firestore directly.
// firestore.rules now has `allow list: if false` on customTopics — the
// Worker reads via service-account, applies scope-specific filters, and
// returns metadata-only summary rows. Per-doc body (questions/content)
// still flows through getCustomTopicById which hits the per-doc `get`
// rule with customTopicReadOk().
//
// Behavioural deltas vs the pre-Mission-13 versions:
//   - getMyCustomTopics(uid) previously where('groupId','==',null)
//     filtered out group-shared topics — i.e. it returned only the
//     "private" subset of an owner's topics. The new 'mine' scope
//     returns ALL of the owner's topics regardless of visibility, so
//     callers that want JUST the private ones must filter on the
//     returned `visibility`/`groupId`. The current call site
//     (renderMyContent in app.js) renders a separate group-section
//     directly afterwards — it WANTS the broader set so a topic can
//     be shown in the owner's "Persönliche" list when groupId is null
//     and in the group section otherwise. Filter applied client-side.
//   - getGroupCustomTopics signature: was `(groupId: string)` per
//     single group, is now `(groupIds: string[] | string)` to match
//     the new endpoint. We accept a single string for backwards-compat
//     with existing callers.
//   - getPendingApprovals still hits the pendingApprovals collection
//     (rules unchanged for that path — admin-only `list:isAuth() && (
//     isAdminEmail() || isAdmin())`). That endpoint stays, no Worker
//     hop needed.

export async function getPublicLibraryTopics() {
  const rows = await _cfListCustomTopics('public');
  // Worker returns metadata rows; sort by approvedAt desc client-side
  // (matches the previous orderBy('approvedAt','desc') semantic).
  rows.sort((a, b) => {
    const ta = a.approvedAt?.seconds || (typeof a.approvedAt === 'string' ? Date.parse(a.approvedAt) / 1000 : 0);
    const tb = b.approvedAt?.seconds || (typeof b.approvedAt === 'string' ? Date.parse(b.approvedAt) / 1000 : 0);
    return tb - ta;
  });
  return rows;
}

// Phase 3b Admin-Queue (Ethan, 2026-05-08): Read-only Queue-Liste fuer
// Simon's Admin-UI. Filter status='open' versteckt resolved-Eintraege
// (Hard rule 5 — die werden nicht geloescht, nur als resolved markiert).
// Rules erlauben den Read nur fuer simonkoper27@gmail.com (oder role:'admin').
//
// V-PHASE-E-04 (Ramsey Cycle-E, P1, Marcus, 2026-05-08): defense-in-depth
// .limit(50) so even if the Worker rate-limit is bypassed somehow (or a
// future change relaxes it) the Admin-UI never tries to render thousands
// of pending rows in one shot. The Worker caps OPEN pending rows at 5
// per user; with N users the practical max is bounded but unbounded in
// theory — 50 is generous enough that Simon never hits it under normal
// load and small enough that a queue-flood doesn't kill the page.
//
// V-09 (Mission-13): this still hits the `pendingApprovals` collection
// directly (NOT customTopics) — that collection's rules are already
// admin-only and small enough that no scope-filter is needed. The
// list-scope hardening only applies to customTopics.
export async function getPendingApprovals() {
  const snap = await _db.collection('pendingApprovals')
    .where('status', '==', 'open')
    .orderBy('submittedAt', 'desc')
    .limit(50)
    .get({ source: 'server' });
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Returns the caller's PERSONAL topics (groupId==null). Pre-V-09 this
// was a Firestore list-query with `where('groupId','==',null)`; we keep
// that same semantic here by post-filtering the Worker's broader
// 'mine'-scope result, so the existing call site (renderMyContent) does
// not need to change. The Worker derives ownership from the verified
// ID-token's `sub` claim (NOT from a client-supplied uid) so the legacy
// `(uid)` parameter is now unused but kept for signature-compat with
// the call sites in app.js.
export async function getMyCustomTopics(_uid) {
  const rows = await _cfListCustomTopics('mine');
  return rows.filter(t => !t.groupId);
}

// Accepts either a single groupId (legacy callers) or an array of
// groupIds (new). The Worker cross-checks the supplied IDs against the
// caller's actual users/{uid}.groupIds to prevent enumeration of
// groups the caller is not a member of.
export async function getGroupCustomTopics(groupIdOrIds) {
  const groupIds = Array.isArray(groupIdOrIds)
    ? groupIdOrIds
    : (groupIdOrIds ? [groupIdOrIds] : []);
  if (groupIds.length === 0) return [];
  return await _cfListCustomTopics('group', { groupIds });
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
//
// Cycle-6 schema-erweiterung (Marcus, 2026-05-08, F-02 Klausur-Bereitschaft):
// Pro exam-Eintrag sind jetzt drei optionale Zusatzfelder erlaubt:
//   - plan: { startDate: 'YYYY-MM-DD', minutesPerDay: number 1..600 } | null
//   - dailyStats: { 'YYYY-MM-DD': { minutes: 0..1440,
//                                   confidence: 1..5 | null,
//                                   realityScore: 0..1 | null } }
//   - actualGrade: 1..6 | null   (post-Klausur-Eintrag)
// Alte exams ohne diese Felder bleiben gueltig (forward-only schema, kein
// Migrationsskript noetig — Defensive-Reads im Frontend per `?? null`).
// Validierung defensiv weil Rules nur den Feld-NAMEN `exams` whitelisten,
// nicht die Struktur; ohne Cap koennte ein Konsolen-Aufrufer eine 9999-Min/
// Tag-Lernzeit oder einen 999-Sterne-Konfidenzwert reinschreiben.
//
// KEIN Worker-Endpoint, kein Firestore-Rules-Update — `exams` ist bereits in
// ownerSafeFields() (siehe firestore.rules:111-113). Per-Day-Aggregation
// laeuft client-side: Frontend liest existing exam, mergt heutigen Eintrag
// in dailyStats, schreibt ganzes Array via diese Funktion zurueck.
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
    // ── Cycle-6 optional fields ───────────────────────────────────────
    // plan: null erlaubt (User hat keinen Plan). Wenn gesetzt, beide
    // Sub-Felder pflicht, startDate als YYYY-MM-DD, minutesPerDay 1..600
    // (10h/Tag ist die obere realistische Grenze; alles drueber ist
    // entweder ein Tippfehler oder ein Cheat).
    if (exam.plan !== undefined && exam.plan !== null) {
      if (typeof exam.plan !== 'object') {
        throw new Error(`saveExams: Eintrag ${i}.plan muss object oder null sein.`);
      }
      if (typeof exam.plan.startDate !== 'string' || !dateRe.test(exam.plan.startDate)) {
        throw new Error(`saveExams: Eintrag ${i}.plan.startDate muss YYYY-MM-DD sein.`);
      }
      if (typeof exam.plan.minutesPerDay !== 'number'
          || !Number.isFinite(exam.plan.minutesPerDay)
          || exam.plan.minutesPerDay < 1
          || exam.plan.minutesPerDay > 600) {
        throw new Error(`saveExams: Eintrag ${i}.plan.minutesPerDay muss number 1..600 sein.`);
      }
      // Cycle-7 P1-2 (Marcus, 2026-05-08, Sophie audit): cross-check
      // startDate <= exam.date. Beide sind YYYY-MM-DD-Strings, also ist
      // String-Vergleich identisch zur chronologischen Ordnung. Ohne den
      // Check konnte der User einen Plan mit startDate NACH der Klausur
      // anlegen — `_addExamStudyMinutes` hat den Plan dann nie aktiv
      // gemacht (today < startDate), Heute-zuerst-Karte schlug stillos
      // fehl, und der Pomodoro-Aggregator hat keine Minuten gesammelt.
      // Entry-level reject statt silent-no-op damit der UI-Fehler sofort
      // sichtbar wird.
      if (exam.plan.startDate > exam.date) {
        throw new Error(`saveExams: Eintrag ${i}.plan.startDate muss <= exam.date sein.`);
      }
    }
    // dailyStats: Map { 'YYYY-MM-DD': { minutes, confidence, realityScore } }.
    // Eintrag-Cap = 365 Keys (1 Schuljahr pro Klausur-Plan). Pro-Tag-Wert-
    // Caps verhindern Heatmap-Inflation: minutes 0..1440 (24h), confidence
    // 1..5 oder null, realityScore 0..1 oder null.
    if (exam.dailyStats !== undefined && exam.dailyStats !== null) {
      if (typeof exam.dailyStats !== 'object' || Array.isArray(exam.dailyStats)) {
        throw new Error(`saveExams: Eintrag ${i}.dailyStats muss Map sein.`);
      }
      const keys = Object.keys(exam.dailyStats);
      if (keys.length > 365) {
        throw new Error(`saveExams: Eintrag ${i}.dailyStats hat mehr als 365 Keys.`);
      }
      keys.forEach(k => {
        if (!dateRe.test(k)) {
          throw new Error(`saveExams: Eintrag ${i}.dailyStats key "${k}" muss YYYY-MM-DD sein.`);
        }
        const v = exam.dailyStats[k];
        if (!v || typeof v !== 'object') {
          throw new Error(`saveExams: Eintrag ${i}.dailyStats[${k}] muss object sein.`);
        }
        if (v.minutes !== undefined && v.minutes !== null) {
          if (typeof v.minutes !== 'number' || !Number.isFinite(v.minutes)
              || v.minutes < 0 || v.minutes > 1440) {
            throw new Error(`saveExams: Eintrag ${i}.dailyStats[${k}].minutes muss 0..1440 sein.`);
          }
        }
        if (v.confidence !== undefined && v.confidence !== null) {
          if (typeof v.confidence !== 'number' || !Number.isFinite(v.confidence)
              || v.confidence < 1 || v.confidence > 5
              || Math.floor(v.confidence) !== v.confidence) {
            throw new Error(`saveExams: Eintrag ${i}.dailyStats[${k}].confidence muss 1..5 (int) sein.`);
          }
        }
        if (v.realityScore !== undefined && v.realityScore !== null) {
          if (typeof v.realityScore !== 'number' || !Number.isFinite(v.realityScore)
              || v.realityScore < 0 || v.realityScore > 1) {
            throw new Error(`saveExams: Eintrag ${i}.dailyStats[${k}].realityScore muss 0..1 sein.`);
          }
        }
      });
    }
    // actualGrade: 1..6 (Schul-Notenskala) oder null.
    if (exam.actualGrade !== undefined && exam.actualGrade !== null) {
      if (typeof exam.actualGrade !== 'number' || !Number.isFinite(exam.actualGrade)
          || exam.actualGrade < 1 || exam.actualGrade > 6) {
        throw new Error(`saveExams: Eintrag ${i}.actualGrade muss 1..6 oder null sein.`);
      }
    }
  });
  // Cycle-7 P2-B (Marcus, 2026-05-08, Ramsey audit): explicit whitelist-pick
  // bevor der set+merge ausgefuehrt wird. Die obigen Validatoren werfen bei
  // bekannten Garbage-Feldern, aber UNBEKANNTE Top-Level-Felder auf einem
  // exam-Eintrag (z.B. ein Konsolen-Aufrufer baut `{...exam, isAdmin:true,
  // xpInjected:9999}`) kommen sonst durch — die rules-Whitelist deckt nur
  // den Top-Level-Feld-Namen `exams` als Map-Wert ab, nicht die innere
  // Struktur. Pre-Whitelist-Pick stellt sicher dass KEIN nicht-erlaubtes
  // Feld jemals auf das User-Doc kommt.
  //
  // Whitelist = id, subject, klasse, date, topicIds, createdAt, plan,
  // dailyStats, actualGrade. Alles andere wird gestrippt. plan- und
  // dailyStats-Innerstrukturen werden ebenfalls auf bekannte Felder
  // reduziert (defense-in-depth gegen "ich packe noch xpBonus ins
  // dailyStats[today]"-Vektoren).
  const sanitizedExams = examsArray.map(exam => {
    const out = {
      id:        exam.id,
      subject:   exam.subject,
      klasse:    exam.klasse,
      date:      exam.date,
      topicIds:  exam.topicIds,
      createdAt: exam.createdAt
    };
    if (exam.plan !== undefined) {
      if (exam.plan === null) {
        out.plan = null;
      } else {
        out.plan = {
          startDate:     exam.plan.startDate,
          minutesPerDay: exam.plan.minutesPerDay
        };
      }
    }
    if (exam.dailyStats !== undefined) {
      if (exam.dailyStats === null) {
        out.dailyStats = null;
      } else {
        const dsClean = {};
        Object.keys(exam.dailyStats).forEach(k => {
          const v = exam.dailyStats[k] || {};
          const inner = {};
          if (v.minutes      !== undefined) inner.minutes      = v.minutes;
          if (v.confidence   !== undefined) inner.confidence   = v.confidence;
          if (v.realityScore !== undefined) inner.realityScore = v.realityScore;
          dsClean[k] = inner;
        });
        out.dailyStats = dsClean;
      }
    }
    if (exam.actualGrade !== undefined) out.actualGrade = exam.actualGrade;
    return out;
  });
  await _db.collection('users').doc(uid).set(
    { exams: sanitizedExams }, { merge: true }
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
