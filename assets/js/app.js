// ══════════════════════════════════════════
//  LearningForge — App (Router + Seiten)
// ══════════════════════════════════════════

import { CONFIG } from './config.js';
import { getStructure, getTopicMeta, getTopicQuestions, getChangelog, idToName } from './scanner.js';
import { initPhysikSimulations } from './physik-sim.js';
import { auth, db, logout, getUserData, saveGrade, saveGradeConfidence, saveWeakQuestions, onAuthStateChanged, getLeaderboard, resetLeaderboard, getAllUsers, setBanStatus, createGroup, joinGroupByCode, leaveGroup, kickFromGroup, getUserGroups, saveCustomTopic, getMyCustomTopics, getGroupCustomTopics, deleteCustomTopic, getCustomTopicById, getPublicLibraryTopics, getPendingApprovals, toggleBookmark, saveNote, saveSRS, addStudyTime, saveXP, saveAchievements, incrementCounter, saveDailyScore, getDailyScores, saveFreezeDays, addComment, getComments, deleteComment, toggleCommentLike, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, unfriend, getFriendsData, writeFeedEntry, getFeedForFriends, createShareToken, getShareData, getMultipleUserData, updateUserProfile, syncUserRole, setUserRole, unlockTheme, setActiveTheme, setActiveOutline, adminPatchUser, adminUnlockAllForUser, loginAsClaude, loginAsHacker, submitBugReport, getOpenBugReports, getMyBugReports, resolveBugReport, deleteBugReport, setUserKlasse, markOnboarded, watchBannedStatus, saveExams, saveErrorExplanation } from './auth.js';
import { OUTLINE_TIERS, THEMES, ALL_THEME_IDS, outlineForLevel, themeById, rollThemeDrop, _clientRollThemeDrop, applyTheme, getStoredTheme } from './cosmetics.js';
import { ACHIEVEMENTS, calcLevel, calcXPForTest, MOTIVATION_SENTENCES } from './achievements.js';
import { DAILY_CHALLENGES } from './daily-challenges-config.js';
import {
  selectQuestions, evaluateAnswers, calcGrade,
  generateCopyText, TIME_OPTIONS, getTimeConfig,
  generateQuestionsWithGemini,
  selectVocabQuestions, evaluateVocabAnswer
} from './test-engine.js';
import * as cf from './cf.js';
import { lfIcon, lfFlag, ICONS as LUCIDE_ICONS, FLAGS as FLAG_ICONS } from './icons.js';

// ── Globaler State ───────────────────────
const ADMIN_EMAIL = 'simonkoper27@gmail.com';

// ── Rollen-Helper ─────────────────────────
function isAdmin() { return userData?.role === 'admin' || currentUser?.email === ADMIN_EMAIL; }
function isClaudeAccount() { return !!userData?.isClaude; }
function isHackerAccount() { return !!userData?.isHacker; }
// Claude-/Hacker-Test-Account duerfen lesen + privat testen, aber NICHT in
// fuer andere User sichtbare State schreiben (Comments, Friend-Requests,
// Group-Joins, Group-Topic-Uploads). Returnt true wenn der Aufruf abgebrochen
// werden soll.
// Wave-1-Ramsey B-M09: Hacker-Account analog Claude blocken (war nur fuer
// Claude — Ramsey konnte als Hacker via Comment/Friend-Req in shared-State
// schreiben).
function _blockClaudeWrite(what = 'Diese Aktion') {
  if (!isClaudeAccount() && !isHackerAccount()) return false;
  const which = isClaudeAccount() ? 'Claude-Test-Account' : 'Hacker-Test-Account';
  showToast(`${what} ist f\xfcr den ${which} deaktiviert (kein Spam in geteiltem State).`, 'info');
  return true;
}
function userRole(u) {
  // u kann ein User-Doc oder undefined sein. Bei undefined → eigener User.
  if (u !== undefined) return u?.role || null;
  if (isAdmin()) return 'admin';
  return userData?.role || null;
}
function roleBadge(role) {
  if (role === 'admin')  return '<span class="role-badge role-admin" title="Administrator">&#128081;</span>';
  if (role === 'tester') return '<span class="role-badge role-tester" title="Beta-Tester">&#129514;</span>';
  return '';
}

// ── Outline-Auflösung für jeden User ────────────────────
// Bevorzugt: Echte Rolle > User-Auswahl > Default (basierend auf Level)
function showThemeDropToast(themeId) {
  const t = themeById(themeId);
  const el = document.createElement('div');
  el.className = 'theme-drop-toast';
  el.innerHTML = `
    <div class="theme-drop-title">&#127873; Neues Theme freigeschaltet!</div>
    <div class="theme-drop-name">${escapeHtml(t.name)}</div>
    <div class="theme-drop-sub">Im Inventar w&auml;hlbar &mdash; viel Spa&szlig;!</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// Mission 7: Doppel-Drop → XP-Conversion. Theme war schon owned, Server hat
// stattdessen XP gegeben. XP groß, Theme-Name klein (umgekehrte Hierarchie zum
// normalen Drop-Toast). Akzent-Farbe statt Pink-Gradient — XP-Bonus ist
// "technischer Reward", kein Rarity-Glanz.
function showThemeDropDoubleToast(themeId, xpGranted) {
  const t = themeById(themeId);
  const el = document.createElement('div');
  el.className = 'theme-drop-toast theme-drop-toast-double';
  el.innerHTML = `
    <div class="theme-drop-title">+${xpGranted} XP</div>
    <div class="theme-drop-name">Bonus-XP statt Doppel-Drop</div>
    <div class="theme-drop-sub">Du hattest &bdquo;${escapeHtml(t.name)}&ldquo; schon &mdash; XP gibt's trotzdem.</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// Mission 7: Trostpreis bei "alle 11 Themes besessen". Server gibt +30 XP
// pro Note-1/2-Test, weil kein Drop mehr gerollt werden kann.
function showTrostpreisToast(xpGranted) {
  const el = document.createElement('div');
  el.className = 'theme-drop-toast theme-drop-toast-double';
  el.innerHTML = `
    <div class="theme-drop-title">+${xpGranted} XP</div>
    <div class="theme-drop-name">Du hast alle Themes!</div>
    <div class="theme-drop-sub">+${xpGranted} XP f&uuml;r Konsequenz.</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function outlineFor(userInfo) {
  if (!userInfo) return '';
  // 1. User-Wahl gewinnt IMMER (Bug-Fix Mission 1: Role-Glow != Outline-Pick).
  //    Role wird separat als Crown-/Beaker-Badge neben dem Namen angezeigt
  //    via roleBadge() — NICHT mehr automatisch auf den Avatar.
  // Wave-1-Ramsey CHEAT-26: Aktive Outline MUSS in owned-Liste sein
  // (defense-in-depth — Frontend-Bypass via activeOutline-Patch ohne owned).
  // Fuer Fremd-User-Daten (kein owned-Array dabei) trauen wir der Auswahl —
  // Marcus sichert das in firestore.rules + Server-Unlock-Pfad ab.
  if (userInfo.activeOutline && userInfo.activeOutline !== 'none') {
    const owned = userInfo.outlines;
    const isOwn = !Array.isArray(owned) || owned.includes(userInfo.activeOutline);
    if (isOwn) {
      const tier = OUTLINE_TIERS.find(t => t.id === userInfo.activeOutline);
      if (tier?.css) return tier.css;
    }
  }
  // 2. Default basierend auf Level
  if (typeof userInfo.xp === 'number') {
    const lvl = calcLevel(userInfo.xp).level;
    const tier = outlineForLevel(lvl);
    return tier.css;
  }
  // 3. Fallback
  return '';
}

let currentUser        = null;
let userData           = null;
let structure          = null;
let testState          = null;
// Red-Team #7 (defense in depth): Tab-Switch-State + remove() in einer
// Closure verstecken. Vorher modul-scoped lets — Hacker konnten das Modul
// importieren und via `m.removeTabSwitchDetection()` deaktivieren oder
// `m.tabSwitchPenalty = false` setzen. Jetzt unerreichbar von ausserhalb.
// Real-Defense ist server-side Test-Validation (Mission 3).
const _tabSwitch = (() => {
  let penalty = false;
  let handler = null;
  function setup() {
    penalty = false;
    teardown();
    handler = () => {
      if (!document.hidden || !testState) return;
      teardown();
      penalty = true;
      showToast('Tab-Wechsel erkannt — Test wird als Note 6 gewertet.', 'error');
      setTimeout(() => window.LF.submitTest(), 1500);
    };
    document.addEventListener('visibilitychange', handler);
  }
  function teardown() {
    if (handler) {
      document.removeEventListener('visibilitychange', handler);
      handler = null;
    }
  }
  function consumePenalty() {
    const p = penalty;
    penalty = false;
    return p;
  }
  return { setup, teardown, consumePenalty };
})();
let calcExpr           = '';
let currentSubtopics   = null;
let changelog          = [];
let vocabState         = null;
let builderState       = null;
let _visualDragIdx     = null;
let customTopicData    = null;
let loginBanError      = false;
let _navRO             = null;
let _pendingIconUrls   = {};
let _installPrompt     = null;
let flashcardState     = null;
let pomodoroState      = null;
let _notesSaveTimer    = null;
let srsState           = null;
let dailyChallengeState = null;
let _commentTopicKey   = null;
let _tutorContext      = '';
let _tutorChat         = [];
let _summaryCache      = {};

// Red-Team #9: client-side Debounce-Marker fuer Spam-anfaellige Aktionen
// (Freundschaftsanfrage, Kommentar, Bug-Report). Real-Defense liegt rules-side
// in Marcus' Mission 3 / Cloud Function — das hier ist der billige UX-Schutz
// gegen Doppelklick-Spam und Konsolen-Loops.
const _debounceLast = {}; // key -> timestamp ms
function _debounceCheck(key, windowMs = 1000) {
  const now = Date.now();
  if (_debounceLast[key] && (now - _debounceLast[key]) < windowMs) return false;
  _debounceLast[key] = now;
  return true;
}

// ── Online/Offline-Banner (F-11) ─────────
function updateOnlineStatus(isOnline) {
  const existing = document.getElementById('offlineBanner');
  if (!isOnline) {
    if (!existing) {
      const el = document.createElement('div');
      el.id = 'offlineBanner';
      el.className = 'offline-banner';
      el.innerHTML = `${lfIcon('wifi-off')} Offline — du siehst gespeicherte Inhalte`;
      document.body.appendChild(el);
    }
  } else {
    if (existing) {
      existing.remove();
      showToast('Wieder online', 'success');
    }
  }
}

// Mission 8 Q1=C: AVATAR_EMOJIS + emojiToPhotoURL entfernt — kein Emoji-Picker mehr.
// Avatare = File-Upload ODER Initial-Letter-Fallback. Bestehende userData.photoURL
// bleibt unangetastet (alte SVG-Data-URLs aus Emoji-Zeit rendern weiter als <img>).

// Gibt bestPoints/bestMaxPoints aus altem und neuem Format zurück
function _gp(g) {
  return {
    pts: g.bestPoints ?? g.totalPoints ?? g.points ?? 0,
    max: g.bestMaxPoints ?? g.totalMaxPoints ?? g.maxPoints ?? 1
  };
}

function initNavCollapse() {
  if (_navRO) { _navRO.disconnect(); _navRO = null; }
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  // B2 (Maya/Casey): Zwei-Stufen-Collapse statt All-or-Nothing.
  //   Stage 1 — `navbar--breadcrumb-collapsed`: Breadcrumb verstecken,
  //             Primärlinks + Trenner bleiben sichtbar. Greift sobald
  //             der Inhalt nicht mehr in die Navbar passt (kleiner Buffer).
  //   Stage 2 — `navbar--full-collapsed`: zusätzlich Primärlinks verstecken.
  //             Greift erst wenn auch ohne Breadcrumb noch Overflow ist.
  // Die alte `.navbar--collapsed`-Klasse versteckte sofort `.nav-center`
  // komplett, das hat den Lernen-Tab und alle anderen Routes auf Desktop-
  // Breiten zu früh kaput gemacht (User: „oben fehlt die Navigation bar").
  const check = () => {
    navbar.classList.remove('navbar--breadcrumb-collapsed', 'navbar--full-collapsed');
    const brand     = navbar.querySelector('.nav-brand');
    const center    = navbar.querySelector('.nav-center');
    const right     = navbar.querySelector('.nav-right');
    const crumb     = center?.querySelector('.nav-breadcrumb');
    const sepBar    = center?.querySelector('.nav-sep-bar');
    const navLinks  = center?.querySelector('.nav-links');
    if (!brand || !center || !right) return;

    const navbarW = navbar.offsetWidth;
    const buffer  = 40; // small safety buffer (vorher 80, war zu aggressiv)

    // Naturmass aller Center-Children (Breadcrumb + Separator + nav-links).
    const neededFull = brand.offsetWidth + center.scrollWidth + right.offsetWidth + buffer;

    if (neededFull <= navbarW) return; // alles passt

    // Stage 1: Breadcrumb wegnehmen — Primärlinks bleiben.
    navbar.classList.add('navbar--breadcrumb-collapsed');

    // Re-measure: was bleibt nach dem Hide vom Breadcrumb übrig?
    // Wir berechnen die zu erwartende Breite ohne das Breadcrumb-Element.
    const crumbW = crumb ? crumb.offsetWidth : 0;
    // Achtung: sepBar wird auch via CSS in stage-1 versteckt (pipe ohne Breadcrumb sieht doof aus).
    const sepW   = sepBar ? sepBar.offsetWidth : 0;
    const neededStage1 = neededFull - crumbW - sepW;

    if (neededStage1 > navbarW) {
      // Stage 2: auch Primärlinks weg — User hat dann nur Brand + Right + Bottom-Tab-Bar.
      navbar.classList.add('navbar--full-collapsed');
    }
  };

  _navRO = new ResizeObserver(check);
  _navRO.observe(navbar);
  check();
}

// ── Theme ────────────────────────────────
export function initTheme() {
  const saved = getCookie('lf_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  setCookie('lf_theme', next, 365);
  const btn = document.getElementById('themeBtn');
  // Mission 8: btn-icon container holds an inline-SVG; rewrite via innerHTML.
  if (btn) btn.innerHTML = next === 'dark' ? lfIcon('sun') : lfIcon('moon');
}

// ── Autoupdate (alle 5 Minuten heimlich auf neue Commits prüfen) ──
let _lastDeploySha = null;
async function checkForUpdate() {
  if (testState) return; // niemals während Test reloaden
  if (vocabState && !vocabState.done) return;
  try {
    const url = `https://api.github.com/repos/${CONFIG.github.owner}/${CONFIG.github.repo}/commits/${CONFIG.github.branch}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.sha) return;
    if (_lastDeploySha === null) {
      _lastDeploySha = data.sha;
    } else if (_lastDeploySha !== data.sha) {
      console.log('[autoupdate] new commit:', data.sha);
      location.reload();
    }
  } catch {}
}
function startAutoUpdate() {
  setTimeout(() => checkForUpdate(), 30 * 1000); // initialer Check nach 30s
  setInterval(checkForUpdate, 5 * 60 * 1000);
}

// ── App starten ──────────────────────────
let _bannedUnsub = null;
export function startApp() {
  startAutoUpdate();
  onAuthStateChanged(async user => {
    currentUser = user;
    // Vorherigen Banned-Listener abräumen, falls Re-Login
    if (_bannedUnsub) { try { _bannedUnsub(); } catch(e){} _bannedUnsub = null; }
    if (user) {
      userData = await getUserData(user.uid);
      // Wave-5b HIGH-3: Bestand-User-Migration numeric -> string klasse.
      // Marcus's klasseOk() Rule akzeptiert temporaer beide Typen — Migration
      // schreibt legacy-numeric auf String, danach kann die numerische Branch
      // der Rule weg. Idempotent + fire-and-forget.
      //
      // TODO(2026-06-08, paired with klasseOk() in firestore.rules): remove
      // this whole `typeof === 'number'` block. By 2026-06-08 every user that
      // has logged in at least once since 2026-05-08 has been migrated by
      // this code path, so the rule's numeric branch can be dropped in the
      // same commit. See firestore.rules:~170 for the full cleanup checklist.
      if (typeof userData?.klasse === 'number') {
        userData.klasse = String(userData.klasse);
        db().collection('users').doc(user.uid)
          .set({ klasse: userData.klasse }, { merge: true })
          .catch(e => console.warn('[klasse-migration]', e));
      }
      if (userData?.isBanned) {
        await logout();
        currentUser = null;
        userData    = null;
        loginBanError = true;
        route();
        return;
      }
      // Claude-Test-Account: localStorage-Email matched → idempotent markieren.
      // Mission 3: primaerer Pfad ueber CF (Email-Whitelist serverseitig).
      // Wave-1-Ramsey CHEAT-35: Direkter markAsClaude/markAsHacker-Fallback
      // wurde gestrichen — Firestore-Rules verbieten Self-Promote, der Aufruf
      // scheiterte silent ohne CF. Bei CF-Fehler: Toast + UI bleibt
      // unmarkiert (idempotent — naechster Login retried).
      try {
        const raw = localStorage.getItem('lf_claude_creds');
        if (raw) {
          const cc = JSON.parse(raw);
          if (cc?.email === user.email && !userData?.isClaude) {
            try {
              await cf.markTestAccount('claude');
              userData = { ...(userData || {}), isClaude: true, role: 'admin', name: userData?.name || 'Claude (Test)' };
            } catch (e) {
              console.warn('[claude-mark-cf]', e);
              showToast('Test-Account-Markierung fehlgeschlagen (CF nicht erreichbar).', 'error');
            }
          }
        }
      } catch(e) { console.warn('[claude-mark]', e); }
      try {
        const raw = localStorage.getItem('lf_hacker_creds');
        if (raw) {
          const cc = JSON.parse(raw);
          if (cc?.email === user.email && !userData?.isHacker) {
            try {
              await cf.markTestAccount('hacker');
              userData = { ...(userData || {}), isHacker: true, role: 'admin', name: userData?.name || 'Hacker (Test)' };
            } catch (e) {
              console.warn('[hacker-mark-cf]', e);
              showToast('Test-Account-Markierung fehlgeschlagen (CF nicht erreichbar).', 'error');
            }
          }
        }
      } catch(e) { console.warn('[hacker-mark]', e); }
      // Auto-Sync Rolle anhand Email-Whitelist (admin/tester)
      try {
        await syncUserRole(user.uid, user.email);
        if (userData) userData.role = userData.role
          || (user.email === 'simonkoper27@gmail.com'  ? 'admin'
            : user.email === 'bohmrobin797@gmail.com' ? 'tester'
            : undefined);
      } catch(e) { console.warn('[role-sync]', e); }
      // Theme anwenden (User-Doc → localStorage-Fallback).
      // Wave-1-Ramsey CHEAT-26: Active-Theme muss in owned sein (oder default),
      // sonst Fallback auf 'default' (defense-in-depth).
      try {
        const wantTheme = userData?.activeTheme || getStoredTheme() || 'default';
        const ownedT    = userData?.themes || ['default'];
        const tDef      = THEMES.find(t => t.id === wantTheme);
        const isOwnedT  = ownedT.includes(wantTheme) || tDef?.default === true;
        applyTheme(isOwnedT ? wantTheme : 'default');
      } catch(e) {}
      // Phase B1 (Maya-Spec, per-subject-design-tokens.md):
      // Settings-Toggle "Fach-Themes". Wenn userData.settings.subjectThemesOff
      // === true → body.subject-themes-off klasse setzen, Layer-2-Subject-
      // Tokens fallen via CSS auf Layer-1 (siehe subject-tokens.css). Default
      // (false / undefined) = Subject-Themes ON. Marcus initialisiert das
      // Setting parallel in auth.js.
      try {
        document.body.classList.toggle('subject-themes-off',
          userData?.settings?.subjectThemesOff === true);
      } catch(e) {}
      // Cycle-3 Settings: Apply font-size, reduced-motion, theme-mode (system).
      // Lives in renderSettings module above; safe no-op when settings missing.
      try { applySettingsOnBoot(); } catch(e) { console.warn('[applySettingsOnBoot]', e); }
      structure = await getStructure();
      getChangelog().then(entries => {
        changelog = entries;
        if (location.hash === '' || location.hash === '#/' || location.hash === '#') renderDashboard();
      });
      await loadToolsOverride();
      // F-1: alte Klausur-Eintraege aufraeumen (date < today-7 Tage). Idempotent,
      // schreibt nur wenn was zu loeschen ist. Defensiv im try/catch — Frontend
      // soll auch crashen wenn cleanupPastExams den Schreibpfad nicht erreicht.
      try { cleanupPastExams(); } catch(e) { console.warn('[cleanupPastExams]', e); }
      checkAndShowWeeklySummary();

      // Banned-Live-Kick (Mission 1 Open-Q-6, Adrian: JA): Real-Time-Listener
      // auf users/{uid}.isBanned. Wenn Admin den User bannt während Session
      // läuft → sofort logout + Toast.
      try {
        _bannedUnsub = watchBannedStatus(user.uid, async () => {
          showToast('Dein Account wurde gesperrt', 'error');
          // Mission 4 Edge-Case: Tour-Engine lauscht auf 'lf:banned' und
          // raeumt Overlay auf, sonst bleibt es ueber dem Login sichtbar.
          try { window.dispatchEvent(new CustomEvent('lf:banned')); } catch(e){}
          // B3 Sophie-Audit-Fix (2026-05-08): Force-Logout bei Ban darf
          // KEINE beforeunload/popstate-Listener leaken (sonst nervt der
          // Reload-Confirm den User auch nach Logout). KEIN Confirm-Modal
          // (Maya-Spec: ban = direkt raus).
          try { testState = null; } catch(e){}
          try { if (typeof dailyChallengeState !== 'undefined') dailyChallengeState = null; } catch(e){}
          try { _teardownMidTestGuards(); } catch(e){}
          try { _bannedUnsub?.(); } catch(e){}
          _bannedUnsub = null;
          await logout();
          location.hash = '#/';
        });
      } catch(e) { console.warn('[banned-watcher]', e); }

      // Migration fuer Bestands-User: Leaderboard-Doc-Meta-Felder backfillen
      // (klasse, activeOutline, activeTheme, xp, role, streak, studyMins, isClaude).
      // Idempotent — laeuft jeden Start, schreibt nur was fehlt. Kein Doc-create
      // wenn der User noch nie einen Test gemacht hat (scores-Filter).
      try {
        const lbRef  = db().collection('leaderboard').doc(user.uid);
        const lbSnap = await lbRef.get({ source: 'server' });
        if (lbSnap.exists && Object.keys(lbSnap.data()?.scores || {}).length > 0) {
          const lb = lbSnap.data();
          const patch = {};
          if (lb.klasse        === undefined && userData?.klasse != null)      patch.klasse        = String(userData.klasse);
          if (lb.activeOutline === undefined && userData?.activeOutline)       patch.activeOutline = userData.activeOutline;
          if (lb.activeTheme   === undefined && userData?.activeTheme)         patch.activeTheme   = userData.activeTheme;
          if (lb.xp            === undefined && userData?.xp != null)          patch.xp            = userData.xp;
          if (lb.role          === undefined && userData?.role)                patch.role          = userData.role;
          if (lb.streak        === undefined && userData?.streakCount != null) patch.streak        = userData.streakCount;
          if (lb.studyMins     === undefined && userData?.studyTime) {
            patch.studyMins = Object.values(userData.studyTime).reduce((a, b) => a + b, 0);
          }
          if (lb.isClaude      === undefined && userData?.isClaude)            patch.isClaude      = true;
          if (Object.keys(patch).length) await lbRef.set(patch, { merge: true });
        }
      } catch(e) { console.warn('[lb-migration]', e); }

      // Onboarding-Wizard triggern wenn noch nicht gemacht (oder Klasse fehlt
      // bei Bestands-User, dann nur Schritt 2+4). Claude-Test-Account skippt.
      // Skipt auch in Share-Report-Views (`#/bericht/...`) — dort ist kein User.
      if (!isClaudeAccount() && !isHackerAccount() && !userData?.onboardedAt && !location.hash.startsWith('#/bericht')) {
        // Bestands-User = hat bereits irgendwelche Daten (XP/Noten/Tests/createdAt),
        // braucht aber noch Klasse → Wizard zeigt nur Schritt 2 + 4. Brand-new Login
        // (alle Felder leer) sieht alle 4 Schritte.
        const hasPriorActivity = !!(userData?.xp
                                  || userData?.createdAt
                                  || Object.keys(userData?.grades || {}).length
                                  || (userData?.totalQuestionsAnswered || 0) > 0);
        const existingMissingKlasse = !userData?.klasse && hasPriorActivity;
        setTimeout(() => renderOnboarding({ existingMissingKlasse }), 250);
      }

      // Mission 4: Tour-Auto-Trigger fuer Bestands-User (onboardedAt gesetzt,
      // aber Tour noch nicht gesehen). Erst beim 2. Login als Toast offerieren —
      // beim 1. Mal nur tourPromptedAt schreiben, damit nicht doppelt genervt
      // wird (Wizard + Tour zusammen waere zu viel).
      else if (userData?.onboardedAt
               && !userData?.tourCompletedAt
               && !userData?.tourSkippedAt
               && !isClaudeAccount() && !isHackerAccount()
               && !location.hash.startsWith('#/bericht')) {
        if (!userData?.tourPromptedAt) {
          // Erste Begegnung post-deploy → markieren, beim naechsten Login Toast.
          try {
            await db().collection('users').doc(user.uid)
              .set({ tourPromptedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
            userData.tourPromptedAt = Date.now();
          } catch(e) { console.warn('[tour-prompt-mark]', e); }
        } else {
          // 2. (oder spaeterer) Login → Toast-Angebot.
          setTimeout(() => _showTourToast(), 1500);
        }
      }
    }
    route();
  });

  window.addEventListener('hashchange', route);
  initKeyboardShortcuts();

  // Offline-Banner (F-11)
  window.addEventListener('online',  () => updateOnlineStatus(true));
  window.addEventListener('offline', () => updateOnlineStatus(false));

  // Install-Prompt speichern (F-13)
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    _installPrompt = e;
  });
  window.addEventListener('appinstalled', () => {
    _installPrompt = null;
    document.getElementById('installCard')?.remove();
  });
  document.addEventListener('click', () => {
    document.getElementById('userChip')?.classList.remove('open');
    document.getElementById('mobileNav')?.classList.remove('open');
  });

  // Re-init nav collapse whenever the app re-renders (navbar is replaced)
  new MutationObserver(() => initNavCollapse())
    .observe(document.getElementById('app'), { childList: true });
}

// ── Hash-Param-Helper ─────────────────────
// Mission 1: `#/profil?tab=erfolge` → returnt 'erfolge'. Dahinter liegt
// die Logik der Profil-Tabs + Direktlinks.
function _hashParam(name) {
  const h = location.hash || '';
  const q = h.indexOf('?');
  if (q < 0) return null;
  const params = new URLSearchParams(h.slice(q + 1));
  return params.get(name);
}

// ── Router ───────────────────────────────
function route() {
  // B3 (2026-05-08): Mid-Test-Lockdown — wenn ein Test aktiv ist und der
  // User auf einen anderen Hash navigiert (Klick auf Lernen-Link, Browser-
  // Back, etc.), Modal zeigen und Hash zurücksetzen, BEVOR irgendein
  // anderer Renderer das Test-DOM überschreibt.
  if (isTestActive()) {
    if (!isTestRouteOk(location.hash)) {
      const wantedHash = location.hash;
      if (_testLockHash) history.replaceState(null, '', _testLockHash);
      showMidTestConfirmModal(wantedHash);
      return;
    }
    // B3 Sophie-Audit-Fix (2026-05-08): wenn Hash bereits == _testLockHash,
    // sind wir schon auf der Testseite — re-rendern wuerde testArea wipen.
    // Das passiert insb. nach popstate→replaceState→hashchange-Race (TWA-
    // Back-Button). Test bleibt am Bildschirm; nichts tun.
    return;
  }
  unmountCalculator();
  unmountTafelwerk();
  unmountPomodoro();
  unmountTutor();
  const hash  = location.hash.replace('#/', '') || '';
  const parts = hash.split('/').filter(Boolean);

  // Phase B1 (Maya-Spec, per-subject-design-tokens.md):
  // Layer-2 Subject-Token-Cascade aktivieren via body[data-subject]. Nur auf
  // Subject-/Year-/Topic-Routes setzen — Dashboard, Profil, Settings, Friends
  // etc. bleiben Theme-default. Settings-Toggle subjectThemesOff (gesetzt im
  // onAuthStateChanged-Handler als body.subject-themes-off) neutralisiert die
  // Tokens via CSS, der Router muss hier nichts extra prüfen.
  if (parts[0] === 'fach' && parts[1]) {
    document.body.dataset.subject = parts[1];
    // Cycle-3: Layer-4 User-Subject-Color-Override. Wenn der User in den
    // Settings eine Farbe gewaehlt hat, schreiben wir den Slug auf body —
    // subject-tokens.css greift via [data-user-subject-color="<slug>"].
    const slug = userData?.settings?.subjectColors?.[parts[1]];
    if (slug) document.body.dataset.userSubjectColor = slug;
    else      delete document.body.dataset.userSubjectColor;
  } else {
    delete document.body.dataset.subject;
    delete document.body.dataset.userSubjectColor;
  }

  if (parts[0] === 'bericht' && parts[1]) {
    renderShareReport(parts[1]);
    return;
  }

  if (!currentUser) {
    renderLogin();
    return;
  }

  if (parts[0] === 'fach') {
    const [, subject, year, topic] = parts;
    if (topic)    renderTopic(subject, year, topic);
    else if (year) renderYear(subject, year);
    else           renderSubject(subject);
  } else if (parts[0]?.startsWith('profil')) {
    // Profil hat ?tab=… als Query-Param am Hash. Parse hier raus, parts[0] kann
    // 'profil' oder 'profil?tab=erfolge' sein.
    renderProfile();
  } else if (parts[0]?.startsWith('einstellungen')) {
    // Cycle-3: ?tab=darstellung|lernen|anpassung|konto-Hash-Param.
    renderSettings();
  } else if (parts[0] === 'statistiken') {
    // Mission 1: Statistiken-Route bleibt für Bookmarks, redirected aber
    // ins Profil-Tab. Stat-Inhalt selbst lebt in renderProfile()'s "stats"-Tab.
    location.hash = '#/profil?tab=stats';
    return;
  } else if (parts[0] === 'rangliste') {
    renderLeaderboard();
  } else if (parts[0] === 'lernen') {
    renderLernen();
  } else if (parts[0] === 'admin') {
    if (isAdmin()) renderAdmin();
    else location.hash = '#/';
  } else if (parts[0] === 'inventar') {
    // Mission 1: Inventar-Route redirected ins Profil-Tab. Originalrender
    // bleibt aber als Tab-Inhalt verfügbar.
    location.hash = '#/profil?tab=inventar';
    return;
  } else if (parts[0] === 'testing') {
    if (isAdmin() || userData?.role === 'tester') renderTesting();
    else location.hash = '#/';
  } else if (parts[0] === 'builder') {
    renderBuilder();
  } else if (parts[0] === 'meine-inhalte') {
    if (parts[1]) renderCustomTopicPage(parts[1]);
    else renderMyContent();
  } else if (parts[0] === 'public') {
    // Phase 3 Public-Library (Ethan, 2026-05-08): von Usern eingereichte +
    // von Simon approved Topics, fuer alle sichtbar.
    if (parts[1]) renderCustomTopicPage(parts[1]);
    else renderPublicLibrary();
  } else if (parts[0] === 'gruppen') {
    if (parts[1]) renderGroupDetail(parts[1]);
    else renderGroups();
  } else if (parts[0] === 'lesezeichen') {
    renderLesezeichen();
  } else if (parts[0] === 'srs') {
    renderSRS();
  } else if (parts[0] === 'daily-challenge') {
    renderDailyChallenge();
  } else if (parts[0] === 'hilfe') {
    renderHelp();
  } else if (parts[0] === 'freunde') {
    renderFriends();
  } else if (parts[0] === 'feed') {
    renderFeed();
  } else {
    renderDashboard();
  }
}

// ── Navbar rendern ───────────────────────
// Mission 1: Nav slim-down — 4 Primärlinks (Start / Lernen / Rangliste / Hilfe) +
// Right-Cluster mit Streak-Badge, XP-Chip, Inventar-Icon, Theme-Toggle, User-Dropdown.
// Sekundär-Routen leben im User-Dropdown. Mobile bekommt eine Bottom-Tab-Bar (5 slots).
function renderNav(breadcrumbs = []) {
  const theme = document.documentElement.getAttribute('data-theme');
  const act   = (label) => breadcrumbs[0]?.label === label ? 'active' : '';
  const streak = (() => { try { return calcStreak(); } catch { return 0; } })();
  const friendReqCount = Object.keys(userData?.friendRequests || {}).length;
  const xi = userData ? calcLevel(userData.xp || 0) : null;
  const role = userRole();
  const ddItem = (href, icon, label, badge = '') =>
    `<a onclick="location.hash='${href}'"><span class="dd-icon">${icon}</span><span class="dd-label">${label}</span>${badge ? `<span class="dd-badge">${badge}</span>` : ''}</a>`;
  return `
    <nav class="navbar">
      <div class="nav-brand" onclick="location.hash='#/'">
        <span class="icon">${lfIcon('zap')}</span> LearningForge
      </div>
      <div class="nav-center">
        <div class="nav-breadcrumb">
          <span class="crumb" onclick="location.hash='#/'">Start</span>
          ${breadcrumbs.map((b, i) => `
            <span class="sep">›</span>
            <span class="crumb ${i === breadcrumbs.length-1 ? 'active' : ''}"
                  onclick="${b.href ? `location.hash='${escapeAttr(b.href)}'` : ''}"
                  style="${b.href ? 'cursor:pointer' : 'cursor:default'}">${escapeHtml(b.label || '')}</span>
          `).join('')}
        </div>
        <span class="nav-sep-bar">|</span>
        <div class="nav-links">
          <a class="nav-link ${!breadcrumbs.length ? 'active' : ''}" onclick="location.hash='#/'">Start</a>
          <a class="nav-link ${act('Lernen')}"     data-tour="nav-lernen"    onclick="location.hash='#/lernen'">Lernen</a>
          <a class="nav-link ${act('Rangliste')}"  data-tour="nav-rangliste" onclick="location.hash='#/rangliste'">Rangliste</a>
          <a class="nav-link ${act('Hilfe')}"      data-tour="nav-hilfe"     onclick="location.hash='#/hilfe'">Hilfe</a>
        </div>
      </div>
      <div class="nav-right">
        ${streak > 1 ? `
        <button class="nav-streak-chip" data-tour="streak-chip" title="${streak} Tage Streak" onclick="location.hash='#/profil'">
          ${lfIcon('flame')} <span class="nav-streak-num">${streak}</span>
        </button>` : ''}
        ${xi ? `
        <div class="nav-xp-chip" title="Stufe ${xi.level} (${xi.title}) · Noch ${xi.xpNeeded - xi.xpCurrent} XP bis Stufe ${xi.level + 1}" onclick="location.hash='#/profil'">
          <span class="nav-xp-level">Lv.${xi.level}</span>
          <div class="nav-xp-track"><div class="nav-xp-fill" id="navXPFill" style="width:${xi.pct}%"></div></div>
        </div>` : ''}
        <button class="btn-icon nav-inv-btn" title="Inventar" onclick="location.hash='#/profil?tab=inventar'">${lfIcon('backpack')}</button>
        <button class="btn-icon" id="themeBtn" onclick="window.LF.toggleTheme()" title="Theme wechseln">
          ${theme === 'dark' ? lfIcon('sun') : lfIcon('moon')}
        </button>
        <div class="user-chip" id="userChip" data-tour="user-chip" onclick="window.LF.toggleUserMenu(event)">
          <div class="avatar">${(userData?.photoURL || currentUser.photoURL)
            ? `<img src="${escapeAttr(userData?.photoURL || currentUser.photoURL)}" alt="">`
            : escapeHtml((userData?.name || currentUser.displayName || 'U')[0].toUpperCase())
          }</div>
          <span class="uname">${escapeHtml((userData?.name || currentUser.displayName)?.split(' ')[0] || 'Nutzer')}${friendReqCount ? `<span class="nav-badge">${friendReqCount}</span>` : ''}</span>
          <div class="user-dropdown user-dropdown-rich">
            <div class="dd-header">
              <div class="dd-name">${escapeHtml(userData?.name || currentUser.displayName || 'Nutzer')} ${roleBadge(role)}</div>
              <div class="dd-meta">${userData?.klasse ? `Klasse ${userData.klasse}` : 'Klasse nicht gesetzt'}${xi ? ` · Lv.${xi.level} ${xi.title}` : ''}</div>
            </div>
            <div class="divider"></div>
            ${ddItem('#/profil',                lfIcon('user'),         'Mein Profil')}
            ${ddItem('#/profil?tab=stats',      lfIcon('chart-bar'),    'Statistiken')}
            ${ddItem('#/profil?tab=erfolge',    lfIcon('medal'),        'Erfolge')}
            ${ddItem('#/profil?tab=inventar',   lfIcon('backpack'),     'Inventar')}
            <div class="divider"></div>
            ${ddItem('#/freunde',               lfIcon('users'),        'Freunde', friendReqCount ? String(friendReqCount) : '')}
            ${ddItem('#/gruppen',               lfIcon('users-round'),  'Gruppen')}
            ${ddItem('#/feed',                  lfIcon('newspaper'),    'Feed')}
            <div class="divider"></div>
            ${ddItem('#/builder',               lfIcon('hammer'),       'Builder')}
            ${ddItem('#/meine-inhalte',         lfIcon('library'),      'Meine Inhalte')}
            <div class="divider"></div>
            ${ddItem('#/einstellungen',         lfIcon('settings'),     'Einstellungen')}
            ${isAdmin() ? ddItem('#/admin',     lfIcon('crown'),        'Admin-Panel') : ''}
            ${(isAdmin() || role === 'tester') ? ddItem('#/testing', lfIcon('flask-round'), 'Testing-Bereich') : ''}
            <div class="divider"></div>
            <button class="danger" onclick="window.LF.doLogout()">${lfIcon('log-out')} Abmelden</button>
          </div>
        </div>
      </div>
    </nav>
    <div class="bottom-tab-bar">
      <a class="bottom-tab ${!breadcrumbs.length ? 'active' : ''}" data-tour="mobile-nav-start" onclick="location.hash='#/'">
        <span class="bt-icon">${lfIcon('house')}</span><span class="bt-label">Start</span>
      </a>
      <a class="bottom-tab ${act('Lernen')}" data-tour="mobile-nav-lernen" onclick="location.hash='#/lernen'">
        <span class="bt-icon">${lfIcon('book-open')}</span><span class="bt-label">Lernen</span>
      </a>
      <a class="bottom-tab ${act('Rangliste')}" data-tour="mobile-nav-rangliste" onclick="location.hash='#/rangliste'">
        <span class="bt-icon">${lfIcon('trophy')}</span><span class="bt-label">Rang</span>
      </a>
      <a class="bottom-tab ${act('Profil')}" data-tour="mobile-nav-profil" onclick="location.hash='#/profil'">
        <span class="bt-icon">${lfIcon('user')}</span><span class="bt-label">Profil</span>
      </a>
      <a class="bottom-tab" data-tour="bottom-mehr" onclick="window.LF.toggleMobileMenu(event)">
        <span class="bt-icon">${lfIcon('menu')}</span><span class="bt-label">Mehr</span>
      </a>
    </div>
    <div class="mobile-nav" id="mobileNav">
      <a class="mobile-nav-link ${act('Hilfe')}"          onclick="location.hash='#/hilfe';window.LF.closeMobileMenu()">${lfIcon('circle-question-mark')} Hilfe</a>
      <a class="mobile-nav-link ${act('Statistiken')}"    onclick="location.hash='#/profil?tab=stats';window.LF.closeMobileMenu()">${lfIcon('chart-bar')} Statistiken</a>
      <a class="mobile-nav-link ${act('Freunde')}"        onclick="location.hash='#/freunde';window.LF.closeMobileMenu()">${lfIcon('users')} Freunde${friendReqCount ? ` (${friendReqCount})` : ''}</a>
      <a class="mobile-nav-link ${act('Gruppen')}"        onclick="location.hash='#/gruppen';window.LF.closeMobileMenu()">${lfIcon('users-round')} Gruppen</a>
      <a class="mobile-nav-link ${act('Feed')}"           onclick="location.hash='#/feed';window.LF.closeMobileMenu()">${lfIcon('newspaper')} Feed</a>
      <a class="mobile-nav-link ${act('Meine Inhalte')}"  onclick="location.hash='#/meine-inhalte';window.LF.closeMobileMenu()">${lfIcon('library')} Meine Inhalte</a>
      <a class="mobile-nav-link ${act('Public-Library')}" onclick="location.hash='#/public';window.LF.closeMobileMenu()">${lfIcon('book-open')} Public-Library</a>
      <a class="mobile-nav-link ${act('Builder')}"        onclick="location.hash='#/builder';window.LF.closeMobileMenu()">${lfIcon('hammer')} Builder</a>
      <a class="mobile-nav-link ${act('Einstellungen')}"  onclick="location.hash='#/einstellungen';window.LF.closeMobileMenu()">${lfIcon('settings')} Einstellungen</a>
      ${isAdmin() ? `<a class="mobile-nav-link" style="color:var(--accent)" onclick="location.hash='#/admin';window.LF.closeMobileMenu()">${lfIcon('crown')} Admin-Panel</a>` : ''}
      ${(isAdmin() || role === 'tester') ? `<a class="mobile-nav-link" onclick="location.hash='#/testing';window.LF.closeMobileMenu()">${lfIcon('flask-round')} Testing</a>` : ''}
      <div class="mobile-nav-sep"></div>
      <a class="mobile-nav-link mobile-nav-danger" onclick="window.LF.doLogout()">${lfIcon('log-out')} Abmelden</a>
    </div>`;
}

// ── Login-Seite ──────────────────────────
function renderLogin() {
  const hasClaudeCreds = !!localStorage.getItem('lf_claude_creds');
  const hasHackerCreds = !!localStorage.getItem('lf_hacker_creds');
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div style="position:absolute;top:16px;right:16px">
          <button class="btn-icon" onclick="window.LF.toggleTheme()" title="Theme">
            ${document.documentElement.getAttribute('data-theme')==='dark' ? lfIcon('sun') : lfIcon('moon')}
          </button>
        </div>
        <div class="login-logo">
          <div class="logo-icon">${lfIcon('zap')}</div>
          <h1>LearningForge</h1>
          <p>Dein persönlicher Lernhub</p>
        </div>
        ${loginBanError ? `<div class="error-msg" style="margin-bottom:12px">Dein Konto wurde gesperrt. Frag Simon, was los ist.</div>` : ''}
        <div id="authError"></div>
        <div id="loginForm">
          <div id="nameGroup" style="display:none" class="form-group">
            <label class="form-label">Name</label>
            <input class="form-input" id="authName" type="text" placeholder="Dein Name">
          </div>
          <div class="form-group">
            <label class="form-label">E-Mail</label>
            <input class="form-input" id="authEmail" type="email" placeholder="z.B. dein-name@schule.de">
          </div>
          <div class="form-group">
            <label class="form-label">Passwort</label>
            <input class="form-input" id="authPass" type="password" placeholder="••••••••">
          </div>
          <button class="btn btn-primary btn-full btn-lg" onclick="window.LF.submitAuth()" id="authSubmitBtn">
            Anmelden
          </button>
          <div class="divider">oder</div>
          <button class="google-btn" onclick="window.LF.googleLogin()">
            <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            Mit Google anmelden
          </button>
          ${hasClaudeCreds ? `
            <button class="btn btn-secondary btn-full" style="margin-top:8px" onclick="window.LF.claudeLogin()">
              &#129302; Als Claude einloggen (Test-Account)
            </button>` : ''}
          ${hasHackerCreds ? `
            <button class="btn btn-secondary btn-full" style="margin-top:8px" onclick="window.LF.loginAsHacker()">
              &#128520; Als Hacker einloggen (Test-Account)
            </button>` : ''}
          <div class="toggle-auth">
            <span id="toggleText">Noch kein Konto?</span>
            <button onclick="window.LF.toggleAuthMode()">Registrieren</button>
          </div>
          <div style="text-align:center;margin-top:12px;font-size:11px;color:var(--text-muted)">
            <a onclick="window.LF.openClaudeSetup()" style="cursor:pointer;text-decoration:underline">
              ${hasClaudeCreds ? 'Claude-Test-Account verwalten' : 'Claude-Test-Account einrichten'}
            </a>
          </div>
          <div style="text-align:center;margin-top:6px;font-size:11px;color:var(--text-muted)">
            <a onclick="window.LF.openHackerSetup()" style="cursor:pointer;text-decoration:underline">
              ${hasHackerCreds ? 'Hacker-Test-Account verwalten' : 'Hacker-Test-Account einrichten'}
            </a>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById('authEmail').addEventListener('keydown', e => { if(e.key==='Enter') window.LF.submitAuth(); });
  document.getElementById('authPass').addEventListener('keydown',  e => { if(e.key==='Enter') window.LF.submitAuth(); });
}

// ── Claude-Setup-Modal ───────────────────
// Speichert Email+Passwort fuer den Claude-Test-Account ausschliesslich
// in localStorage des aktuellen Browsers. Geht nicht ueber GitHub/Firestore.
function renderClaudeSetupModal() {
  let creds = {};
  try { creds = JSON.parse(localStorage.getItem('lf_claude_creds') || '{}'); } catch {}
  const overlay = document.createElement('div');
  overlay.className = 'kb-overlay';
  overlay.id = 'claudeSetupOverlay';
  overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="kb-dialog" style="max-width:440px">
      <h3>&#129302; Claude-Test-Account</h3>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
        Logindaten werden <strong>nur in diesem Browser</strong> (localStorage) gespeichert &mdash;
        nichts davon liegt im Repo oder in Firestore. Der Account bekommt Admin-Rechte
        und wird in Rangliste + Freundessuche ausgeblendet.
      </p>
      <div class="form-group">
        <label class="form-label">E-Mail (frei waehlbar)</label>
        <input class="form-input" id="claudeSetupEmail" type="email"
               value="${creds.email || 'claude@learning-forge.local'}" placeholder="claude@...">
      </div>
      <div class="form-group">
        <label class="form-label">Passwort (mind. 6 Zeichen)</label>
        <input class="form-input" id="claudeSetupPass" type="text"
               value="${creds.password || ''}" placeholder="Passwort">
      </div>
      <div id="claudeSetupErr" style="color:var(--danger);font-size:12px;min-height:16px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        ${creds.email ? `<button class="btn btn-ghost btn-sm" onclick="window.LF.clearClaudeCreds()">Logindaten loeschen</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.kb-overlay').remove()">Schliessen</button>
        <button class="btn btn-primary btn-sm" onclick="window.LF.saveClaudeCreds()">Speichern</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Hacker-Setup-Modal ───────────────────
// Spiegelung von renderClaudeSetupModal fuer den Hacker-Test-Account (Red-Team).
// Speichert Email+Passwort ausschliesslich in localStorage des aktuellen Browsers.
// Nichts geht ueber GitHub/Firestore, nichts wird geloggt.
function renderHackerSetupModal() {
  let creds = {};
  try { creds = JSON.parse(localStorage.getItem('lf_hacker_creds') || '{}'); } catch {}
  const overlay = document.createElement('div');
  overlay.className = 'kb-overlay';
  overlay.id = 'hackerSetupOverlay';
  overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="kb-dialog" style="max-width:440px">
      <h3>&#128520; Hacker-Test-Account</h3>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
        Logindaten werden <strong>nur in diesem Browser</strong> (localStorage) gespeichert &mdash;
        nichts davon liegt im Repo oder in Firestore. Der Account bekommt Admin-Rechte
        und wird in Rangliste + Freundessuche ausgeblendet.
      </p>
      <div class="form-group">
        <label class="form-label">E-Mail (frei waehlbar)</label>
        <input class="form-input" id="hackerSetupEmail" type="email"
               value="${escapeHtml(creds.email || 'hacker@learning-forge.local')}" placeholder="hacker@...">
      </div>
      <div class="form-group">
        <label class="form-label">Passwort (mind. 6 Zeichen)</label>
        <input class="form-input" id="hackerSetupPass" type="text"
               value="${escapeHtml(creds.password || '')}" placeholder="Passwort">
      </div>
      <div id="hackerSetupErr" style="color:var(--danger);font-size:12px;min-height:16px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        ${creds.email ? `<button class="btn btn-ghost btn-sm" onclick="window.LF.clearHackerCreds()">Logindaten loeschen</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.kb-overlay').remove()">Schliessen</button>
        <button class="btn btn-primary btn-sm" onclick="window.LF.saveHackerCreds()">Speichern</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Keyboard Shortcuts (F-08) ────────────
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.isContentEditable) return;

    if (e.key === '?' && !e.altKey && !e.ctrlKey && !e.metaKey) {
      showShortcutsDialog();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'h': e.preventDefault(); location.hash = '#/'; break;
        case 's': e.preventDefault(); location.hash = '#/statistiken'; break;
        case 'p': e.preventDefault(); location.hash = '#/profil'; break;
        case 'e': e.preventDefault(); location.hash = '#/einstellungen'; break;
      }
    }
  });
}

function showShortcutsDialog() {
  if (document.querySelector('.kb-overlay')) return;
  const el = document.createElement('div');
  el.className = 'kb-overlay';
  el.addEventListener('click', ev => { if (ev.target === el) el.remove(); });
  el.innerHTML = `
    <div class="kb-dialog">
      <h3>Tastenkürzel</h3>
      <div class="kb-row"><span class="kb-key">?</span><span class="kb-desc">Diese Hilfe anzeigen</span></div>
      <div class="kb-row"><span class="kb-key">Alt + H</span><span class="kb-desc">Dashboard</span></div>
      <div class="kb-row"><span class="kb-key">Alt + S</span><span class="kb-desc">Statistiken</span></div>
      <div class="kb-row"><span class="kb-key">Alt + P</span><span class="kb-desc">Profil</span></div>
      <div class="kb-row"><span class="kb-key">Alt + E</span><span class="kb-desc">Einstellungen</span></div>
      <div style="margin-top:20px;text-align:right">
        <button class="btn btn-secondary" onclick="this.closest('.kb-overlay').remove()">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(el);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') el.remove(); }, { once: true });
}

// ── Skeleton-Hilfsfunktionen (F-09) ──────
function skeletonTopicBody() {
  const lines = [100, 90, 95, 75, 85, 60, 80];
  return `
    <div class="sk-tabs-row">
      <span class="skeleton sk-tab"></span>
      <span class="skeleton sk-tab"></span>
      <span class="skeleton sk-tab"></span>
    </div>
    <div class="sk-block">
      <span class="skeleton sk-title" style="width:55%"></span>
      ${lines.map(w => `<span class="skeleton sk-line" style="width:${w}%"></span>`).join('')}
    </div>
    <div class="sk-block">
      <span class="skeleton sk-title" style="width:38%"></span>
      <span class="skeleton sk-line" style="width:100%"></span>
      <span class="skeleton sk-line" style="width:80%"></span>
    </div>`;
}

function skeletonCustomCards(n = 3) {
  const cards = Array.from({ length: n }, () => `
    <div class="sk-card">
      <div>
        <span class="skeleton sk-line" style="width:70px;height:12px;margin-bottom:8px"></span>
        <span class="skeleton sk-line" style="width:150px;height:17px;margin-bottom:0"></span>
      </div>
      <div class="sk-card-r">
        <span class="skeleton sk-arr"></span>
      </div>
    </div>`).join('');
  return `
    <span class="skeleton sk-title" style="width:180px;margin-bottom:16px"></span>
    ${cards}`;
}

// ── Dashboard ────────────────────────────
function renderDashboard() {
  if (structure?._configError) {
    document.getElementById('app').innerHTML = `
      ${renderNav()}
      <div class="page">
        <div class="setup-banner">
          <div class="setup-icon">${lfIcon('settings')}</div>
          <h2>Setup erforderlich</h2>
          <p>${structure._configError}</p>
          <p>Bearbeite <code>assets/js/config.js</code> und trage deinen GitHub-Username und den Branch ein.</p>
        </div>
      </div>`;
    return;
  }

  const subjects   = Object.values(structure || {});
  const grades     = userData?.grades || {};
  const totalTests = Object.keys(grades).length;
  const gradeVals  = Object.values(grades).map(g => g.grade).filter(Boolean);
  const avgGrade   = gradeVals.length ? (gradeVals.reduce((a,b)=>a+b,0)/gradeVals.length).toFixed(1) : '–';
  const streak     = calcStreak();
  const attention      = getNeedsAttention();
  const recent         = getRecentTests();
  const recommendations = getRecommendations();

  // V-09 (Casey, streak-save): Wenn User aktive Streak hat, heutige Daily-Challenge
  // noch nicht gemacht hat, und es lokal schon 18:00 oder spaeter ist → warnen.
  // Verhindert die schmerzhafteste UX (Streak-Bruch durch Vergesslichkeit).
  // Done-Check: dieselbe Logik wie renderDailyChallengeCard()
  // — userData.dailyChallenges[today] = der Eintrag fuer den heutigen Tag.
  const _todayKey       = new Date().toISOString().slice(0, 10);
  const _dcDoneToday    = !!userData?.dailyChallenges?.[_todayKey];
  const _hourLocal      = new Date().getHours();
  const showStreakWarn  = streak > 0 && !_dcDoneToday && _hourLocal >= 18;

  // Top-3 zuletzt benutzte Fächer (Schnellstart) — Mission 1, Open-Q-5
  const recentSubjectIds = [];
  Object.entries(grades)
    .map(([k, g]) => ({ k, ts: g.date?.seconds || 0 }))
    .sort((a, b) => b.ts - a.ts)
    .forEach(e => {
      const sid = e.k.split('__')[0];
      if (sid && !recentSubjectIds.includes(sid)) recentSubjectIds.push(sid);
    });
  const top3Subjects = recentSubjectIds.slice(0, 3)
    .map(id => subjects.find(s => s.id === id))
    .filter(Boolean);

  // Subject cards mit Fortschrittsring
  const subjectCards = top3Subjects.length === 0
    ? ''
    : top3Subjects.map(s => {
        const prog   = getSubjectProgress(s.id);
        const pct    = prog.total > 0 ? prog.tested / prog.total : 0;
        const circ   = 100.48; // Umfang r=16
        const dash   = pct * circ;
        const gi     = prog.avgGrade ? calcGrade(0,1) : null; // only for color
        const avgInfo = prog.avgGrade ? calcGrade(Math.max(0,7-prog.avgGrade),6) : null;
        return `
          <div class="subject-card" data-subject="${escapeAttr(s.id)}"
               style="--subject-color:${getSubjectColor(s.id)}"
               onclick="location.hash='#/fach/${s.id}'">
            <div class="s-card-top">
              <div>
                <div class="s-icon">${getSubjectIcon(s.id)}</div>
                <div class="s-name">${escapeHtml(s.name)}</div>
                <div class="s-meta">${Object.keys(s.years||{}).length} Klassen · ${prog.total} Themen</div>
              </div>
              <svg class="progress-ring" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="16" fill="none" stroke="var(--border)" stroke-width="3"/>
                <circle cx="18" cy="18" r="16" fill="none" stroke="${getSubjectColor(s.id)}"
                  stroke-width="3" stroke-linecap="round"
                  stroke-dasharray="${dash.toFixed(1)} ${circ}"
                  transform="rotate(-90 18 18)"/>
                <text x="18" y="22" text-anchor="middle" font-size="9"
                  fill="${getSubjectColor(s.id)}" font-weight="700">${prog.total>0?Math.round(pct*100)+'%':'–'}</text>
              </svg>
            </div>
            ${prog.avgGrade ? `<div class="s-avg-grade" style="background:${calcGrade(0,1) && avgGradeColor(prog.avgGrade)}">${prog.avgGrade.toFixed(1)}</div>` : ''}
          </div>`;
      }).join('');

  // Braucht Aufmerksamkeit
  const attentionHtml = attention.length === 0 ? '' : `
    <div class="section-title" style="margin-top:32px">${lfIcon('triangle-alert')} Braucht Aufmerksamkeit</div>
    <div class="attention-list">
      ${attention.map(a => `
        <div class="attention-item" onclick="location.hash='#/fach/${a.subjectId}/${a.yearId}/${a.topicId}'"
             style="--subject-color:${getSubjectColor(a.subjectId)}">
          <span class="att-icon">${getSubjectIcon(a.subjectId)}</span>
          <div class="att-info">
            <div class="att-name">${a.topic.name}</div>
            <div class="att-sub">${a.subject.name} · ${a.subject.years[a.yearId]?.name || a.yearId}</div>
          </div>
          <div class="att-grade" style="background:${calcGrade(0,1) && gradeColor(a.g.grade)}">${a.g.grade}</div>
        </div>`).join('')}
    </div>`;

  // Letzte Tests
  const recentHtml = recent.length === 0 ? '' : `
    <div class="section-title" style="margin-top:32px">${lfIcon('clock')} Letzte Tests</div>
    <div class="recent-list">
      ${recent.map(r => `
        <div class="recent-item" onclick="location.hash='#/fach/${r.subjectId}/${r.yearId}/${r.topicId}'"
             style="--subject-color:${getSubjectColor(r.subjectId)}">
          <span class="recent-icon">${getSubjectIcon(r.subjectId)}</span>
          <div class="recent-info">
            <div class="recent-name">${r.topic.name}</div>
            <div class="recent-sub">${r.subject.name} · ${_gp(r.g).pts}/${_gp(r.g).max} Pkt</div>
          </div>
          <div class="recent-grade" style="background:${gradeColor(r.g.grade)}">${r.g.grade}</div>
        </div>`).join('')}
    </div>`;

  document.getElementById('app').innerHTML = `
    ${renderNav()}
    <div class="page">
      <div class="dash-header">
        <div>
          <h1>Willkommen zurück, ${currentUser.displayName?.split(' ')[0] || 'Lernender'}! ${lfIcon('hand', {cls:'inline-icon'})}</h1>
          <div class="sub">Wähle ein Fach und starte deine Lernsession.</div>
        </div>
        ${streak > 1 ? `<div class="streak-badge">${lfIcon('flame', {cls:'sx-streak'})} ${streak} Tage Streak</div>` : ''}
      </div>
      ${showStreakWarn ? `
        <div class="streak-warning-banner" onclick="location.hash='#/daily-challenge'">
          <span class="streak-warning-icon">${lfIcon('flame', {cls:'sx-streak'})}</span>
          <div class="streak-warning-text">
            <div class="streak-warning-title">Dein Streak von ${streak} Tag${streak !== 1 ? 'en' : ''} endet um Mitternacht</div>
            <div class="streak-warning-sub">Mach die Daily-Challenge in 5 Min und halte ihn am Leben.</div>
          </div>
          <span class="streak-warning-cta">Jetzt machen ›</span>
        </div>` : ''}
      <div class="stats-bar">
        <div class="stat-chip"><span class="stat-val">${subjects.length}</span><span class="stat-lbl">Fächer</span></div>
        <div class="stat-chip"><span class="stat-val">${totalTests}</span><span class="stat-lbl">Tests gemacht</span></div>
        <div class="stat-chip"><span class="stat-val">${avgGrade}</span><span class="stat-lbl">Ø Note</span></div>
        <div class="stat-chip" onclick="location.hash='#/profil?tab=stats'" style="cursor:pointer">
          <span class="stat-val">${lfIcon('chart-bar')}</span><span class="stat-lbl">Statistiken</span>
        </div>
        ${getSRSDueCount() > 0 ? `
        <div class="stat-chip srs-chip" onclick="location.hash='#/srs'" style="cursor:pointer">
          <span class="stat-val">${getSRSDueCount()}</span><span class="stat-lbl">Wiederholen</span>
        </div>` : ''}
        <div class="stat-chip stat-chip-bug" data-tour="bug-chip" onclick="window.LF.openBugReport()" style="cursor:pointer">
          <span class="stat-val">${lfIcon('bug')}</span><span class="stat-lbl">Problem melden</span>
        </div>
      </div>
      ${!userData?.klasse && !isClaudeAccount() && !isHackerAccount() ? `
        <div class="klasse-prompt" onclick="location.hash='#/profil'">
          <span class="klasse-prompt-icon">&#9888;&#65039;</span>
          <div class="klasse-prompt-text">
            <div class="klasse-prompt-title">Klassenstufe noch nicht gesetzt</div>
            <div class="klasse-prompt-sub">Wähle deine Klasse — wir zeigen dir dann passende Aufgaben.</div>
          </div>
          <span class="klasse-prompt-arrow">&rsaquo;</span>
        </div>` : ''}
      ${isClaudeAccount() ? `<div id="claudeBugList"></div>` : ''}
      ${renderKlausurReadinessWidgets()}
      ${renderDailyChallengeCard()}
      ${attentionHtml}
      ${recommendations.length ? `
      <div class="section-title" style="margin-top:32px">Heute empfohlen</div>
      <div class="recommendations-list">
        ${recommendations.map(r => `
          <div class="rec-item" onclick="location.hash='#/fach/${r.subjectId}/${r.yearId}/${r.topicId}'"
               style="--subject-color:${getSubjectColor(r.subjectId)}">
            <span class="rec-icon">${getSubjectIcon(r.subjectId)}</span>
            <div class="rec-info">
              <div class="rec-name">${r.topic.name}</div>
              <div class="rec-reason">${r.reason}</div>
            </div>
            <span class="rec-arrow">›</span>
          </div>`).join('')}
      </div>` : ''}
      ${_installPrompt && !localStorage.getItem('lf_install_dismissed') ? `
        <div class="install-card" id="installCard">
          <div class="install-card-icon">${lfIcon('zap')}</div>
          <div class="install-card-info">
            <div class="install-card-title">App installieren</div>
            <div class="install-card-sub">Offline nutzen &amp; schneller laden</div>
          </div>
          <div class="install-card-actions">
            <button class="btn btn-primary btn-sm" onclick="window.LF.installApp()">Installieren</button>
            <button class="btn btn-ghost btn-sm" onclick="window.LF.dismissInstall()">Nicht jetzt</button>
          </div>
        </div>` : ''}
      ${top3Subjects.length ? `
        <div class="section-title" style="margin-top:${attention.length?'32px':'0'};display:flex;align-items:center;justify-content:space-between">
          <span>${lfIcon('zap')} Schnellstart</span>
          <a class="btn btn-ghost btn-sm" onclick="location.hash='#/lernen'">Alle Fächer →</a>
        </div>
        <div class="subjects-grid">${subjectCards}</div>` : `
        <div class="empty-state" style="margin-top:24px">
          <div class="empty-icon">${lfIcon('book-open')}</div>
          ${subjects.length === 0
            ? 'Noch keine Fächer vorhanden — füge Ordner unter <code>Fächer/</code> hinzu.'
            : 'Mache deinen ersten Test, um Schnellstart-Karten hier zu sehen.'}
          <div style="margin-top:12px"><a class="btn btn-primary btn-sm" onclick="location.hash='#/lernen'">Zur Fächer-Übersicht</a></div>
        </div>`}
      ${renderChangelogSection()}
      ${recentHtml}
      <div id="bugReportSection"></div>
    </div>
    <!-- Bug-Report-FAB nur Mobile (CSS @media) — Mission 1 Open-Q-3 -->
    <button class="bug-fab" data-tour="bug-fab" onclick="window.LF.openBugReport()" title="Problem melden" aria-label="Problem melden">${lfIcon('bug')}</button>`;
  // Bug-Report-Sektion asynchron nachladen (Firestore-Reads).
  loadBugReportSection();
  if (isClaudeAccount()) loadClaudeBugList();
  // Mission 4: Tour-Engine signalisiert auf das Dashboard-Ready-Event.
  window.LF.dashboardReady = Promise.resolve();
  try { window.dispatchEvent(new CustomEvent('lf:dashboard-ready')); } catch(e) {}
}

// ── Bug-Reports auf dem Dashboard ─────────
function escapeHtml(s) {
  return (s == null ? '' : String(s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
// Wave-1-Ramsey CHEAT-24: Attribute-safe escape fuer Werte, die in
// onclick="…('${x}')"-Strings landen. Schlaegt &-und-Quote-Vektoren ab.
// Identische Outputs wie escapeHtml — separates Symbol fuer Code-Klarheit.
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// Cycle-2-Ramsey P2-1: JS-String-Escape fuer Werte, die als Argumente in
// inline `onclick="…('${x}')"` landen. escapeAttr macht NUR HTML-attr-Safety
// (Quote-Breakout aus dem Attribut), aber lässt Backslashes + Newlines roh —
// das kann den JS-String trotzdem aufbrechen sobald Werte aus User-Land kommen
// (Custom-Topics-Future). Fuer neue Patterns lieber data-* + addEventListener
// (siehe attachActionCardListeners). Helper hier als Defense-in-Depth fuer die
// Stellen wo wir noch inline-onclick haben.
function escapeJs(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}
// Cycle-2-Ramsey P2-2: HTML-Entity-Decoder fuer Stellen wo wir Content
// (entity-encoded per Hard-Rule #3) brauchen, der NICHT durch innerHTML laeuft
// — z.B. img alt-Attribut. Ohne Decode wird "&bdquo;X&ldquo;" via escapeAttr
// doppelt-encoded und Screenreader liest "ampersand b-d-quo".
function decodeHtmlEntities(s) {
  if (!s) return '';
  const ta = document.createElement('textarea');
  ta.innerHTML = String(s);
  return ta.value;
}
// Wave-3 (Maya/Bereich-2): Zentrale Empty-State-Helper. Vorher 7+ verschiedene
// Empty-State-Block-Inlines mit unterschiedlicher Padding/Sub-Styling und
// keinerlei CTA — User sah nur "leer" ohne klaren naechsten Schritt. Helper
// gibt einheitlichen HTML-String zurueck (Icon-Tile + Title + Sub + optional
// Primary-CTA-Button). Alle Felder werden defensive escaped.
function renderEmptyState({ icon, title, sub, ctaLabel, ctaAction, secondaryLabel, secondaryAction }) {
  const iconHtml = icon ? `<div class="empty-state-icon">${lfIcon(icon)}</div>` : '';
  const ctaHtml = (ctaLabel && ctaAction)
    ? `<button class="btn btn-primary empty-state-cta" onclick="${escapeAttr(ctaAction)}">${escapeHtml(ctaLabel)}</button>`
    : '';
  // F-04 (Casey): optional secondary CTA. "Bug melden" / "Anderes Thema waehlen"
  // gibt dem User mit leerem Topic eine Aktion statt nur einer Sackgasse.
  const secHtml = (secondaryLabel && secondaryAction)
    ? `<button class="btn btn-ghost empty-state-cta-secondary" onclick="${escapeAttr(secondaryAction)}">${escapeHtml(secondaryLabel)}</button>`
    : '';
  return `
    <div class="empty-state">
      ${iconHtml}
      <h3 class="empty-state-title">${escapeHtml(title || '')}</h3>
      <p class="empty-state-sub">${escapeHtml(sub || '')}</p>
      ${ctaHtml}
      ${secHtml}
    </div>`;
}

// F-04 (Casey): Helper fuer "kein Lerninhalt"-Empty-State im Topic-View.
// Wird in zwei Stellen aufgerufen (renderTopic line ~1534 + renderSubtopicGrid
// fallback) — vorher dupliziert, jetzt zentral. Primary-CTA = "Anderes Thema",
// Secondary = "Bug melden".
function _emptyTopicContent(subjectId, yearId) {
  const fallbackHash = (subjectId && yearId) ? `#/fach/${subjectId}/${yearId}` : '#/';
  return renderEmptyState({
    icon: 'book-open',
    title: 'Kein Lerninhalt verfügbar',
    sub: 'Für dieses Thema wurde noch kein Inhalt eingepflegt. Schau bald wieder vorbei.',
    ctaLabel: 'Anderes Thema wählen',
    ctaAction: `location.hash='${fallbackHash}'`,
    secondaryLabel: 'Bug melden',
    secondaryAction: 'window.LF.openBugReport()'
  });
}
// Wave-1-Ramsey CHEAT-21: Mini-Sanitizer fuer Custom-Topic-HTML-Content.
// Whitelisted Tags only; alle Attribute werden gestrippt (kein onclick,
// onerror, javascript:-style, src etc.). Nicht-whitelisted Tags werden
// unwrapped (Text bleibt, Tag faellt weg). Reicht fuer gewachsene Lerntexte
// — neue Inhalte gehen ueber serializeVisualBlocks-Pipeline (sicher by
// design). DOMPurify wurde bewusst NICHT eingefuehrt — keine neue Dep.
function sanitizeTopicContent(html) {
  const ALLOWED = ['p','br','strong','em','b','i','u','ul','ol','li',
                   'h2','h3','h4','h5','h6','code','pre','blockquote','span'];
  const div = document.createElement('div');
  div.innerHTML = String(html ?? '');
  const walk = (node) => {
    [...node.children].forEach(child => {
      if (!ALLOWED.includes(child.tagName.toLowerCase())) {
        const text = document.createTextNode(child.textContent);
        node.replaceChild(text, child);
      } else {
        [...child.attributes].forEach(a => child.removeAttribute(a.name));
        walk(child);
      }
    });
  };
  walk(div);
  return div.innerHTML;
}
async function loadBugReportSection() {
  const host = document.getElementById('bugReportSection');
  if (!host || !currentUser) return;
  let mine = [];
  try { mine = await getMyBugReports(currentUser.uid); } catch(e) { console.warn('[bugReports]', e); }
  const open  = mine.filter(b => !b.resolved);
  const closed = mine.filter(b =>  b.resolved).slice(0, 3);
  const row = (b) => `
    <div class="recent-item" style="--subject-color:${b.resolved ? 'var(--success)' : 'var(--warning)'}">
      <span class="recent-icon">${b.resolved ? '&#9989;' : '&#128027;'}</span>
      <div class="recent-info">
        <div class="recent-name" style="white-space:normal">${escapeHtml(b.text)}</div>
        <div class="recent-sub">${b.resolved ? 'Erledigt' : 'Offen'}${b.resolvedNote ? ' &mdash; ' + escapeHtml(b.resolvedNote) : ''}</div>
      </div>
      ${(b.uid === currentUser.uid || isAdmin()) ? `<button class="btn btn-ghost btn-sm" onclick="window.LF.deleteBugReport('${b.id}')">&times;</button>` : ''}
    </div>`;
  host.innerHTML = `
    <div class="section-title" style="margin-top:32px;display:flex;align-items:center;justify-content:space-between">
      <span>&#128027; Probleme melden</span>
      <button class="btn btn-primary btn-sm" onclick="window.LF.openBugReport()">Neue Meldung</button>
    </div>
    <div class="recent-list">
      ${open.length ? open.map(row).join('') : '<div class="empty-state" style="padding:16px">Keine offenen Meldungen.</div>'}
      ${closed.length ? '<div style="font-size:12px;color:var(--text-muted);margin-top:8px">Zuletzt erledigt:</div>' + closed.map(row).join('') : ''}
    </div>`;
}

async function loadClaudeBugList() {
  const host = document.getElementById('claudeBugList');
  if (!host) return;
  let open = [];
  try { open = await getOpenBugReports(); } catch(e) { console.warn('[bugReports/open]', e); }
  if (!open.length) {
    host.innerHTML = `
      <div class="install-card" style="margin-bottom:16px;border-left:3px solid var(--success)">
        <div class="install-card-icon">&#9989;</div>
        <div class="install-card-info">
          <div class="install-card-title">Keine offenen Bug-Reports</div>
          <div class="install-card-sub">Alles sauber &mdash; weiter mit normalem Testen.</div>
        </div>
      </div>`;
    return;
  }
  const fmt = (b) => `
    <div class="attention-item" style="--subject-color:var(--warning);align-items:flex-start">
      <span class="att-icon">&#128027;</span>
      <div class="att-info">
        <div class="att-name" style="white-space:normal">${escapeHtml(b.text)}</div>
        <div class="att-sub">${escapeHtml(b.name || 'Nutzer')}${b.createdAt?.toDate ? ' &middot; ' + b.createdAt.toDate().toLocaleString('de-DE') : ''}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" onclick="window.LF.resolveBugReport('${b.id}')">Erledigt</button>
        <button class="btn btn-ghost btn-sm" onclick="window.LF.deleteBugReport('${b.id}')">&times;</button>
      </div>
    </div>`;
  host.innerHTML = `
    <div class="section-title" style="margin-top:0;color:var(--warning)">
      &#128736;&#65039; ${open.length} offene${open.length === 1 ? 'r' : ''} Bug-Report${open.length === 1 ? '' : 's'} zum Pruefen
    </div>
    <div class="attention-list">${open.map(fmt).join('')}</div>`;
}

// ── Was ist neu? — Changelog-Sektion ───────
function renderChangelogSection() {
  if (!changelog || changelog.length === 0) return '';
  const TYPE_LABEL = { added: 'Neu', expanded: 'Erweitert', fixed: 'Korrigiert' };
  const items = changelog.slice(0, 5).map(e => {
    const dateStr      = formatRelativeDate(e.date);
    const hasSubject   = !!e.subject;
    const subjectColor = hasSubject ? getSubjectColor(e.subject) : 'var(--accent)';
    const subjectIcon  = hasSubject ? getSubjectIcon(e.subject) : lfIcon('settings');
    const subjectName  = hasSubject ? (structure?.[e.subject]?.name || e.subject) : 'App';
    const yearName     = e.year  ? (structure?.[e.subject]?.years?.[e.year]?.name || idToName(e.year))   : '';
    const topicName    = e.topic ? (structure?.[e.subject]?.years?.[e.year]?.topics?.[e.topic]?.name || idToName(e.topic)) : '';
    const href         = (e.subject && e.year && e.topic)
      ? `#/fach/${e.subject}/${e.year}/${e.topic}`
      : (e.subject ? `#/fach/${e.subject}` : '#/');
    const typeLabel    = TYPE_LABEL[e.type] || 'Update';
    const subParts     = [subjectName, yearName, topicName].filter(Boolean);
    return `
      <div class="changelog-item" onclick="location.hash='${href}'"
           style="--subject-color:${subjectColor}">
        <span class="cl-icon">${subjectIcon}</span>
        <div class="cl-info">
          <div class="cl-head">
            <span class="cl-type cl-type-${e.type || 'added'}">${typeLabel}</span>
            <span class="cl-date">${dateStr}</span>
          </div>
          <div class="cl-title">${e.title || topicName}</div>
          ${subParts.length ? `<div class="cl-sub">${subParts.join(' · ')}</div>` : ''}
          ${e.description ? `<div class="cl-desc">${e.description}</div>` : ''}
        </div>
        <span class="cl-arrow">›</span>
      </div>`;
  }).join('');
  return `
    <div class="section-title" style="margin-top:32px">${lfIcon('sparkles')} Was ist neu?</div>
    <div class="changelog-list">${items}</div>`;
}

function formatRelativeDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d.getTime())) return iso;
  const today = new Date(); today.setHours(0,0,0,0);
  const days = Math.round((today - d) / 86400000);
  if (days === 0) return 'heute';
  if (days === 1) return 'gestern';
  if (days < 7)  return `vor ${days} Tagen`;
  if (days < 14) return 'letzte Woche';
  if (days < 30) return `vor ${Math.floor(days/7)} Wochen`;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ── Fach-Seite (Jahresauswahl) ────────────
function renderSubject(subjectId) {
  const subject = structure?.[subjectId];
  if (!subject) { location.hash = '#/'; return; }

  const allYears = Object.values(subject.years || {});
  const grades = userData?.grades || {};

  // V-04b (Casey/Cycle-3): Klassen-Filter respektieren — nur Klasse-N + nicht-
  // klassen-spezifische Years (z.B. "Grammatik") sichtbar wenn Toggle ON.
  const userKlasse  = userData?.klasse || null;
  const filterOn    = !!userKlasse && getLernenKlasseFilter();
  const isClassYearRe = /^Klasse[-_]?\d+$/i;
  const klPattern  = filterOn ? new RegExp(`^Klasse[-_]?${userKlasse}$`, 'i') : null;
  const years = filterOn
    ? allYears.filter(y => {
        const isClassYear = isClassYearRe.test(y.id);
        if (!isClassYear) return true;
        return klPattern.test(y.id);
      })
    : allYears;

  let yearCards;
  if (allYears.length === 0) {
    yearCards = `<div class="empty-state"><div class="empty-icon">${lfIcon('calendar')}</div>Noch keine Klassen vorhanden.</div>`;
  } else if (years.length === 0) {
    // Filter aktiv, aber keine Klassen passen — Empty-State mit Toggle-Off-Link.
    yearCards = `<div class="empty-state">
      <div class="empty-icon">${lfIcon('calendar')}</div>
      Keine Themen f\xfcr Klasse ${escapeHtml(String(userKlasse))}.
      <div style="margin-top:12px"><a href="#" onclick="event.preventDefault();window.LF.toggleLernenKlassenFilter('0')">Alle Klassen anzeigen</a></div>
    </div>`;
  } else {
    yearCards = years.map(y => {
      const topicCount = Object.keys(y.topics || {}).length;
      const doneCount  = Object.keys(y.topics || {}).filter(tid => grades[`${subjectId}__${y.id}__${tid}`]).length;
      return `
        <div class="year-card" onclick="location.hash='#/fach/${subjectId}/${y.id}'">
          <div class="y-name">${y.name}</div>
          <div class="y-count">${topicCount} Themen · ${doneCount} getestet</div>
        </div>`;
    }).join('');
  }

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: subject.name }])}
    <div class="page">
      <div class="subject-color-bar" style="--subject-color:${subject.color}"></div>
      <div class="page-header">
        <h1>${getSubjectIcon(subjectId)} ${subject.name}</h1>
        <div class="sub">Wähle eine Klasse</div>
      </div>
      <div class="section-title">Schuljahre</div>
      <div class="years-grid">${yearCards}</div>
    </div>`;
}

// ── Klassen-Seite (Themenliste) ───────────
function renderYear(subjectId, yearId) {
  const subject = structure?.[subjectId];
  const year    = subject?.years?.[yearId];
  if (!year) { location.hash = `#/fach/${subjectId}`; return; }

  const topics = Object.values(year.topics || {});
  const grades = userData?.grades || {};

  const topicCards = topics.length === 0
    ? `<div class="empty-state"><div class="empty-icon">${lfIcon('pen-line')}</div>Noch keine Themen vorhanden.</div>`
    : topics.map(t => {
        const g = grades[`${subjectId}__${yearId}__${t.id}`];
        const gp = g ? _gp(g) : null;
        const gradeInfo = gp ? calcGrade(gp.pts, gp.max) : null;
        const attempts = g?.history?.length ?? (g ? 1 : 0);
        const tKey = `${subjectId}__${yearId}__${t.id}`;
        const isBm = (userData?.bookmarks || []).includes(tKey);
        return `
          <div class="topic-card" onclick="location.hash='#/fach/${subjectId}/${yearId}/${t.id}'">
            <div class="t-info">
              <div class="t-name">${t.name}</div>
              ${g ? `<div class="t-desc">Beste Note: ${g.grade} · ${gp.pts}/${gp.max} Pkt${attempts > 1 ? ` · ${attempts} Versuche` : ''}</div>` : '<div class="t-desc">Noch nicht getestet</div>'}
            </div>
            <div class="t-right">
              ${gradeInfo ? `<div class="t-grade" style="background:${gradeInfo.color}">${g.grade}</div>` : ''}
              <button class="bm-icon-btn ${isBm ? 'active' : ''}" title="Lesezeichen"
                onclick="event.stopPropagation();window.LF.toggleBookmarkTopic('${tKey}')">${lfIcon('bookmark')}</button>
              <div class="t-arrow">›</div>
            </div>
          </div>`;
      }).join('');

  document.getElementById('app').innerHTML = `
    ${renderNav([
      { label: subject.name, href: `#/fach/${subjectId}` },
      { label: year.name }
    ])}
    <div class="page">
      <div class="subject-color-bar" style="--subject-color:${subject.color}"></div>
      <div class="page-header">
        <h1>${getSubjectIcon(subjectId)} ${year.name}</h1>
        <div class="sub">${subject.name} · ${topics.length} Themen</div>
      </div>
      <div class="section-title">Themen</div>
      <div class="topics-list">${topicCards}</div>
    </div>`;
}

// ── Themen-Seite ─────────────────────────
async function renderTopic(subjectId, yearId, topicId) {
  const subject = structure?.[subjectId];
  const year    = subject?.years?.[yearId];
  const topic   = year?.topics?.[topicId];
  if (!topic) { location.hash = `#/fach/${subjectId}/${yearId}`; return; }

  const subjectTools = getSubjectTools(subjectId);
  if (subjectTools.calculator) mountCalculator();
  if (subjectTools.tafelwerk)  mountTafelwerk();
  // Sophie P2-4 (Cycle 7): topicKey threading fuer topic-aware Klausur-Aggregation.
  mountPomodoro(`${subjectId}__${yearId}__${topicId}`);

  document.getElementById('app').innerHTML = `
    ${renderNav([
      { label: subject.name, href: `#/fach/${subjectId}` },
      { label: year.name,    href: `#/fach/${subjectId}/${yearId}` },
      { label: topic.name }
    ])}
    <div class="page topic-page">
      <div class="topic-header" style="--subject-color:${subject.color}">
        <span class="badge">${getSubjectIcon(subjectId)} ${subject.name} · ${year.name}</span>
        <h1>${topic.name}</h1>
      </div>
      <div id="topicBody">${skeletonTopicBody()}</div>
    </div>`;

  const meta      = await getTopicMeta(subjectId, yearId, topicId);
  const questions = await getTopicQuestions(subjectId, yearId, topicId);
  const grades    = userData?.grades || {};
  const prevGrade = grades[`${subjectId}__${yearId}__${topicId}`];
  const color     = getSubjectColor(subjectId);

  // Phase-1 Subtopic-Schema: getSubtopics normalisiert legacy + new in das
  // gleiche Array-of-{id,name,description,blocks}. renderSubtopicGrid
  // entscheidet selbst ueber Legacy-Single-Wrap vs. Grid.
  const normalizedSubtopics = getSubtopics(meta);
  const isLegacyWrap = normalizedSubtopics.length === 1
                    && normalizedSubtopics[0].id === 'main'
                    && !normalizedSubtopics[0].name;
  // currentSubtopics nur fuer multi-subtopic-Faelle setzen — bei Legacy-Wrap
  // kein Click-Aufklapp-Verhalten, also kein State noetig.
  currentSubtopics = (normalizedSubtopics.length > 0 && !isLegacyWrap)
    ? normalizedSubtopics
    : null;

  const lernenTab = normalizedSubtopics.length > 0
    ? renderSubtopicGrid(meta, subjectId, yearId)
    : _emptyTopicContent(subjectId, yearId);

  const uebenTab = questions.length > 0
    ? renderUebenStart(questions, subjectId, yearId, topicId)
    : `<div class="empty-state" style="padding:40px">Keine Übungsaufgaben vorhanden.</div>`;

  const vocabQuestions = selectVocabQuestions(questions);
  const hasVocab = vocabQuestions.length > 0;
  if (hasVocab) vocabState = { allCards: vocabQuestions, cards: [], index: 0, correct: 0, wrong: [] };

  // F-15: Karteikarten
  const hasFlashcards = questions.length > 0;
  const topicKey = `${subjectId}__${yearId}__${topicId}`;
  _commentTopicKey = topicKey;
  _tutorContext    = meta.content || '';
  flashcardState   = null;

  // F-19: Lesezeichen
  const isBookmarked = (userData?.bookmarks || []).includes(topicKey);

  // F-23: Lernpfade / Voraussetzungen
  const prereqs = meta.prerequisites || [];
  const missedPrereqs = prereqs.filter(p =>
    !Object.keys(userData?.grades || {}).some(k => k.endsWith('__' + p))
  );

  // F-20: Wissens-Check (2–3 easy Fragen am Ende des Lerninhalts)
  const easyQ = questions.filter(q => q.difficulty === 'easy' || !q.difficulty).slice(0, 3);
  const wissensCheckHtml = (easyQ.length > 0 && meta.content && !meta.subtopics?.length)
    ? buildWissensCheck(easyQ, topicKey)
    : '';

  // Lernen-Tab mit Wissens-Check
  const lernenTabFull = `${lernenTab}${wissensCheckHtml}`;

  const prevGp   = prevGrade ? _gp(prevGrade) : null;
  const gradeInfo = prevGp ? calcGrade(prevGp.pts, prevGp.max) : null;
  const prevAttempts = prevGrade?.history?.length ?? (prevGrade ? 1 : 0);
  const testTab = questions.length > 0 ? `
    <div class="test-start" id="testArea">
      <h2>Test starten</h2>
      ${gradeInfo
        ? `<p>Beste Note: <strong>${gradeInfo.grade} – ${gradeInfo.label}</strong> (${prevGp.pts}/${prevGp.max} Pkt${prevAttempts > 1 ? `, ${prevAttempts} Versuche` : ''})</p>`
        : '<p>Noch kein Test gemacht. Wie lange möchtest du testen?</p>'}
      <div class="time-selector">
        ${TIME_OPTIONS.map(t => `<button class="time-btn ${t===selectedTime?'active':''}" onclick="window.LF.selectTime(${t})" id="timeBtn${t}">${t} min</button>`).join('')}
      </div>
      <div class="time-hint" id="timeHint">${escapeHtml(getTimeConfig(selectedTime)?.textExpectation || '')}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:8px">
        <button class="btn btn-primary btn-lg" onclick="window.LF.startTest('${subjectId}','${yearId}','${topicId}')">
          Test beginnen
        </button>
        <button class="btn btn-secondary btn-lg" onclick="window.LF.downloadTestPDF('${subjectId}','${yearId}','${topicId}')">
          Als PDF herunterladen
        </button>
      </div>
    </div>` : `<div class="empty-state" style="padding:40px">Keine Testfragen vorhanden.</div>`;

  // F-15: Flashcard-Tab
  const flashcardTab = hasFlashcards
    ? `<div class="fc-start" id="fcStart">
        <div class="fc-start-icon">${lfIcon('layers', {cls:'lf-icon-2xl'})}</div>
        <h2>Karteikarten</h2>
        <p>${questions.length} Karte${questions.length !== 1 ? 'n' : ''} verfügbar</p>
        <button class="btn btn-primary btn-lg" onclick="window.LF.startFlashcards('${subjectId}','${yearId}','${topicId}')">Lernen starten</button>
       </div>`
    : `<div class="empty-state" style="padding:40px">Keine Fragen vorhanden.</div>`;

  // F-18: Notizen
  const savedNote = userData?.notes?.[topicKey] || '';

  // Sophie P2-5 (Cycle 7): TTS-Fallback-Toast wurde frueher in toggleAudioMode
  // gefiered — der Button wird aber nur gerendert WENN _audioModeAvailable()
  // true ist, also war der Code dort tot. Hier feuern: User auf Topic mit
  // Lese-Inhalt, aber Browser-API fehlt. _audioWarnUnavailableOnce() hat
  // selbst LocalStorage-Spam-Schutz.
  if ((meta.content || meta.subtopics?.length) && !_audioModeAvailable()) {
    _audioWarnUnavailableOnce();
  }

  document.getElementById('topicBody').innerHTML = `
    ${missedPrereqs.length ? `
      <div class="prereq-banner">
        ${lfIcon('triangle-alert')} Empfohlene Voraussetzungen noch nicht abgeschlossen:
        ${missedPrereqs.map(p => `<span class="prereq-tag">${decodeURIComponent(p).replace(/-/g,' ')}</span>`).join('')}
      </div>` : ''}
    <div class="topic-toolbar">
      <button class="bookmark-btn ${isBookmarked ? 'active' : ''}" id="bookmarkBtn"
              onclick="window.LF.toggleBookmarkTopic('${topicKey}')">
        ${isBookmarked ? `${lfIcon('bookmark')} Gespeichert` : `${lfIcon('bookmark')} Lesezeichen`}
      </button>
      ${meta.content ? `<button class="btn btn-ghost btn-sm tutor-toggle-btn" onclick="window.LF.tutorToggle()">${lfIcon('bot')} KI-Tutor</button>` : ''}
      ${(_audioModeAvailable() && (meta.content || meta.subtopics?.length))
        ? `<button class="btn btn-ghost btn-sm audio-toolbar-btn" id="audioToolbarBtn" onclick="window.LF.toggleAudioMode()">${_audioHeadphonesIcon()} Vorlesen</button>`
        : ''}
    </div>
    <div class="topic-tabs" style="--subject-color:${color}">
      <button class="tab-btn active" id="tabBtnLernen"  onclick="window.LF.switchTab('Lernen')">Lernen</button>
      <button class="tab-btn"        id="tabBtnUeben"   onclick="window.LF.switchTab('Ueben')">Üben</button>
      <button class="tab-btn"        id="tabBtnTest"    onclick="window.LF.switchTab('Test')">Test</button>
      ${hasFlashcards ? `<button class="tab-btn" id="tabBtnKarten" onclick="window.LF.switchTab('Karten')">${lfIcon('layers')} Karten</button>` : ''}
      ${hasVocab ? `<button class="tab-btn" id="tabBtnVokabeln" onclick="window.LF.switchTab('Vokabeln')">Vokabeln</button>` : ''}
      <button class="tab-btn" id="tabBtnKommentare" onclick="window.LF.switchTab('Kommentare')">Kommentare</button>
    </div>
    <div id="tabLernen"  class="tab-panel">${lernenTabFull}</div>
    <div id="tabUeben"   class="tab-panel" style="display:none">${uebenTab}</div>
    <div id="tabTest"    class="tab-panel" style="display:none">${testTab}</div>
    ${hasFlashcards ? `<div id="tabKarten"  class="tab-panel" style="display:none">${flashcardTab}</div>` : ''}
    ${hasVocab ? `<div id="tabVokabeln" class="tab-panel" style="display:none">${renderVocabStart(vocabQuestions)}</div>` : ''}
    <div id="tabKommentare" class="tab-panel" style="display:none">
      <div class="comments-section">
        <div class="comment-input-area">
          <textarea class="form-input comments-textarea" id="commentInput" placeholder="Kommentar schreiben…" rows="3" maxlength="500"></textarea>
          <button class="btn btn-primary btn-sm" onclick="window.LF.submitComment()">Senden</button>
        </div>
        <div id="commentsList"><div class="comments-loading">Lade Kommentare…</div></div>
      </div>
    </div>
    <div class="notes-panel" id="notesPanel">
      <button class="notes-toggle" onclick="window.LF.toggleNotes()">
        ${lfIcon('pencil')} Notizen <span id="notesArrow" class="notes-arrow open">${lfIcon('chevron-down')}</span>
      </button>
      <div class="notes-body" id="notesBody">
        <textarea class="notes-textarea" id="notesInput" placeholder="Deine Notizen zu diesem Thema…"
          oninput="window.LF.onNoteInput('${topicKey}',this.value)">${savedNote}</textarea>
        <div class="notes-status" id="notesStatus"></div>
      </div>
    </div>`;

  // F-21: LaTeX laden wenn $$ im Content
  if ((meta.content || '').includes('$$') || (meta.content || '').includes('\\(')) {
    maybeLoadMathJax();
  }
  // F-22: Prism für Informatik
  if (subjectId === 'Informatik') maybeLoadPrism();
  // Physik: interaktive Simulationen einhängen (Single-Content-Pfad)
  if (subjectId === 'Physik' && meta.content) {
    initPhysikSimulations(document.querySelector('.content-body'));
  }
  // Sophie P1-1 (Cycle 7): Resume-Prompt wenn beim letzten Wegnavigieren
  // Audio mitten im Topic war und User innerhalb von 1h zurueckkommt.
  _audioMaybeShowResumePrompt();
}

// ── Phase-1 Subtopic-Schema (ADR 0002 / Marcus + Maya) ─────
// Backwards-compat reader. Toleriert drei Formen:
//   a) topicMeta.subtopics: [{ id, name, description, blocks: [...] }]   (new)
//   b) topicMeta.subtopics: [{ name, description, content: '<HTML>' }]   (legacy-array)
//   c) topicMeta.content:   '<HTML>'                                     (legacy-single)
// Bei (a)+(c) gleichzeitig gewinnt (a) — Migration-Phase. Bei (b) wird der
// content-String 1:1 in einen text-Block gewrappt, sodass der Block-Renderer
// uneingeschraenkt arbeiten kann.
function getSubtopics(topicMeta) {
  if (!topicMeta) return [];

  if (Array.isArray(topicMeta.subtopics) && topicMeta.subtopics.length > 0) {
    return topicMeta.subtopics.map((st, i) => {
      // Bereits new-schema (hat blocks) — durchreichen.
      if (Array.isArray(st.blocks)) {
        return {
          id:          st.id || `subtopic-${i}`,
          name:        st.name || '',
          description: st.description || '',
          blocks:      st.blocks
        };
      }
      // Legacy-Array-Subtopic: { name, description, content } → wrap content
      // als single text-Block (HTML-entity-encoded, Hard-Rule #3).
      return {
        id:          st.id || `subtopic-${i}`,
        name:        st.name || '',
        description: st.description || '',
        blocks:      st.content ? [{ type: 'text', content: st.content }] : []
      };
    });
  }

  if (typeof topicMeta.content === 'string' && topicMeta.content.length > 0) {
    return [{
      id:          'main',
      name:        '',
      description: '',
      blocks:      [{ type: 'text', content: topicMeta.content }]
    }];
  }

  return [];
}

// MVP-5 Widget-Whitelist (siehe ADR 0002 / Phase-2-Roadmap).
const _LF_WIDGET_WHITELIST = new Set([
  'predict-reveal', 'drag-sort', 'drag-match', 'number-slider', 'hot-spot', 'fill-blanks'
]);
const _LF_WIDGET_TOAST_FIRED = new Set();

// Cycle 8 — Predict-Reveal-Widget (MVP-1).
// TODO: remove with predict-reveal-Glue (Commit 11) — migrated to
//       assets/js/widgets/predict-reveal.js (Phase 0 Commit 4). Helpers
//       below remain only as a bridge for renderBlock() case at L4311
//       until Commit 11 swaps that to mountAllWidgets()/Slot-Stub.
// Map: slotId -> { config, lockedWrong: Set<number>, revealed: boolean,
//                  selectedIndex: number|null, wrapper: HTMLElement|null }
// Scoped per Wrapper-DOM-Node, kein globaler Leak (Spec-Edge "mehrere Widgets").
const _LF_PR_STATE = new Map();
let _LF_PR_SLOT_SEQ = 0;

function _lfPrNextSlotId() {
  _LF_PR_SLOT_SEQ += 1;
  return `lf-pr-${Date.now().toString(36)}-${_LF_PR_SLOT_SEQ}`;
}

// Defensiv: validiert+normalisiert config. Erste correct:true gewinnt; restliche
// correct werden auf false gesetzt. Gibt null zurueck wenn unbrauchbar (keine
// Optionen, keine Korrekt-Antwort).
function _lfPrNormalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const opts = Array.isArray(rawConfig.options) ? rawConfig.options : [];
  if (opts.length === 0) return null;
  let correctSeen = false;
  const normOpts = opts.map(o => {
    const isCorrect = !!(o && o.correct) && !correctSeen;
    if (isCorrect) correctSeen = true;
    if (o && o.correct && correctSeen && !isCorrect) {
      try { console.warn('[predict-reveal] more than one option marked correct — only the first counts.', o); } catch(e) {}
    }
    return {
      label:       (o && typeof o.label === 'string') ? o.label : '',
      correct:     isCorrect,
      explanation: (o && typeof o.explanation === 'string') ? o.explanation : ''
    };
  });
  if (!correctSeen) return null;
  return {
    setup:    typeof rawConfig.setup === 'string'    ? rawConfig.setup    : '',
    question: typeof rawConfig.question === 'string' ? rawConfig.question : '',
    options:  normOpts,
    reveal:   typeof rawConfig.reveal === 'string'   ? rawConfig.reveal   : ''
  };
}

// Render-Function fuer das Widget. Liefert vollstaendiges HTML (State 1, Predict).
// State-Updates passieren spaeter im DOM via _lfPrApplyState.
function _renderPredictReveal(config, slotId) {
  const norm = _lfPrNormalizeConfig(config);
  if (!norm) {
    return `<div class="lf-widget-predict-reveal lf-pr-empty" data-pr-slot="${escapeAttr(slotId)}">`
         + `Diese Aufgabe ist noch nicht fertig konfiguriert.</div>`;
  }
  // State im Module-Map verankern. Kein Wrapper-Ref hier — wird beim ersten
  // Click via document.getElementById nachgeholt.
  _LF_PR_STATE.set(slotId, {
    config: norm,
    lockedWrong: new Set(),
    revealed: false,
    selectedIndex: null
  });

  // Hard-Rule #3: setup/reveal/explanation/label sind HTML-entity-encoded und
  // gehen 1:1 ins innerHTML — konsistent zu text-block (Zeile ~2030). KEIN
  // doppeltes escapeHtml auf label, sonst wuerde "M&uuml;nchen" zu
  // "M&amp;uuml;nchen" und der User saehe die Entitaet roh. Custom-Topics-
  // Future = separate Sanitisier-Stufe beim Upload, nicht hier am Rendering.
  const setupHtml = norm.setup
    ? `<div class="lf-pr-setup">${norm.setup}</div>`
    : '';

  const optsHtml = norm.options.map((o, i) => {
    const explHtml = o.explanation
      ? `<div class="lf-pr-option-explanation" id="${escapeAttr(slotId)}-expl-${i}" hidden>${o.explanation}</div>`
      : '';
    return `<li class="lf-pr-option-item">`
         + `<button type="button" class="lf-pr-option" `
         +   `data-pr-action="select" `
         +   `data-pr-slot="${escapeAttr(slotId)}" `
         +   `data-pr-index="${i}">`
         +   `<span class="lf-pr-option-label">${o.label}</span>`
         + `</button>`
         + explHtml
         + `</li>`;
  }).join('');

  const revealHtml = norm.reveal
    ? `<div class="lf-pr-reveal" id="${escapeAttr(slotId)}-reveal" hidden>`
    +    `<div class="lf-pr-reveal-heading">Erkl&auml;rung</div>`
    +    `<div class="lf-pr-reveal-body">${norm.reveal}</div>`
    + `</div>`
    : '';

  const retryHtml = `<button type="button" class="lf-pr-retry" `
    + `data-pr-action="retry" `
    + `data-pr-slot="${escapeAttr(slotId)}" hidden>Nochmal versuchen</button>`;

  const hintHtml = `<div class="lf-pr-hint">Tippe deinen Tipp &mdash; falsch raten ist Teil des Lernens.</div>`;

  const questionHtml = norm.question
    ? `<h4 class="lf-pr-question">${norm.question}</h4>`
    : '';

  return `<div class="lf-widget-predict-reveal lf-pr-state-predict" `
       +   `id="${escapeAttr(slotId)}" data-pr-slot="${escapeAttr(slotId)}">`
       +   setupHtml
       +   questionHtml
       +   `<ul class="lf-pr-options" role="radiogroup">${optsHtml}</ul>`
       +   hintHtml
       +   revealHtml
       +   retryHtml
       + `</div>`;
}

// Wendet aktuellen State auf den DOM des Widget-Wrappers an. Idempotent.
function _lfPrApplyState(slotId) {
  const state = _LF_PR_STATE.get(slotId);
  if (!state) return;
  const root = document.getElementById(slotId);
  if (!root) return;

  const optionBtns = root.querySelectorAll('.lf-pr-option');
  const correctIdx = state.config.options.findIndex(o => o.correct);

  optionBtns.forEach((btn, i) => {
    // Reset modifier-classes + state
    btn.classList.remove('lf-pr-correct', 'lf-pr-wrong', 'lf-pr-wrong-locked');
    btn.removeAttribute('aria-label');
    btn.disabled = false;

    // Locked-wrong (nach Retry): bleibt visuell falsch + nicht klickbar
    if (state.lockedWrong.has(i)) {
      btn.classList.add('lf-pr-wrong-locked');
      btn.disabled = true;
      btn.setAttribute('aria-label', 'Bereits ausgeschlossen');
    }

    // Explanation-Sichtbarkeit
    const expl = root.querySelector(`#${CSS.escape(slotId)}-expl-${i}`);
    if (expl) expl.hidden = !state.revealed;

    if (state.revealed) {
      // In Revealed-State: alle disabled
      btn.disabled = true;
      if (i === correctIdx) {
        btn.classList.add('lf-pr-correct');
        btn.setAttribute('aria-label', 'Richtige Antwort');
      } else if (i === state.selectedIndex && i !== correctIdx) {
        btn.classList.add('lf-pr-wrong');
        btn.setAttribute('aria-label', 'Falsche Antwort');
      }
    }
  });

  // Wrapper-State-Class
  root.classList.toggle('lf-pr-state-predict',  !state.revealed);
  root.classList.toggle('lf-pr-state-revealed',  state.revealed);

  // Reveal-Box: nur sichtbar wenn richtig geklickt (Spec: bleibt versteckt
  // bis zur richtigen Antwort).
  const revealBox = root.querySelector(`#${CSS.escape(slotId)}-reveal`);
  if (revealBox) {
    const showReveal = state.revealed && state.selectedIndex === correctIdx;
    revealBox.hidden = !showReveal;
  }

  // Retry-Button: nur sichtbar wenn falsch geklickt
  const retryBtn = root.querySelector('.lf-pr-retry');
  if (retryBtn) {
    const showRetry = state.revealed && state.selectedIndex !== correctIdx;
    retryBtn.hidden = !showRetry;
  }
}

// Click-Handler: Option select.
function _lfPrSelect(slotId, index) {
  const state = _LF_PR_STATE.get(slotId);
  if (!state) return;
  if (state.revealed) return;             // schon ausgewertet
  if (state.lockedWrong.has(index)) return; // gesperrt nach Retry
  const opts = state.config.options;
  if (index < 0 || index >= opts.length) return;
  state.selectedIndex = index;
  state.revealed = true;
  _lfPrApplyState(slotId);
}

// Click-Handler: Retry. Sperrt die zuletzt gewaehlte falsche Option,
// resettet State auf Predict.
function _lfPrRetry(slotId) {
  const state = _LF_PR_STATE.get(slotId);
  if (!state) return;
  const correctIdx = state.config.options.findIndex(o => o.correct);
  if (state.selectedIndex !== null && state.selectedIndex !== correctIdx) {
    state.lockedWrong.add(state.selectedIndex);
  }
  state.selectedIndex = null;
  state.revealed = false;
  _lfPrApplyState(slotId);
}

// Globale Click-Delegation. Einmalig auf document — funktioniert auch wenn
// Widgets via innerHTML asynchron eingehaengt werden. Kein inline-onclick (Spec).
if (typeof document !== 'undefined' && !document.__lfPredictRevealBound) {
  document.__lfPredictRevealBound = true;
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const btn = target.closest('[data-pr-action]');
    if (!btn) return;
    const slotId = btn.getAttribute('data-pr-slot');
    if (!slotId) return;
    const action = btn.getAttribute('data-pr-action');
    if (action === 'select') {
      const idx = parseInt(btn.getAttribute('data-pr-index'), 10);
      if (!Number.isNaN(idx)) _lfPrSelect(slotId, idx);
    } else if (action === 'retry') {
      _lfPrRetry(slotId);
    }
  });
}

// ─── Mega-Update 2026-05-09 — Drag-Sort-Widget (MVP-2) ──────────────────────
// TODO: remove with drag-sort-Glue (Commit 11) — migrated to
//       assets/js/widgets/drag-sort.js (Phase 0 Commit 5). Helpers
//       below remain only as a bridge for renderBlock() case at L4318
//       until Commit 11 swaps that to mountAllWidgets()/Slot-Stub.
// Schueler bringt Items in die richtige Reihenfolge (z.B. Schlieffenplan,
// Mitose-Phasen, Argumente nach Klimax). Mobile-first: Pfeil-Buttons sind
// primaerer Interaktionspfad, Touch-Drag + HTML5-Drag sind Komfort-Layer.
//
// Hard-Rule #3: setup/question/label/reveal kommen entity-encoded aus dem JSON
// und gehen 1:1 ins innerHTML — KEIN escapeHtml darauf, das wuerde Entities
// doppelt-encoden. Daten-Attribute via escapeAttr (z.B. item-id darf user-data
// sein in Custom-Topics-Future).
//
// State: shuffled order wird einmal beim Render eingefroren (sonst rerendert
// es bei jedem Re-Render anders → DOM zappelt). Analog _LF_PR_STATE.
const _LF_DS_STATE = new Map(); // slotId -> { config, currentOrder, lockedIds, status }
let _LF_DS_SLOT_SEQ = 0;

function _lfDsNextSlotId() {
  _LF_DS_SLOT_SEQ += 1;
  return `lf-ds-${Date.now().toString(36)}-${_LF_DS_SLOT_SEQ}`;
}

// Fisher-Yates shuffle. Garantiert: result !== input-order falls items.length>=2
// (sonst waere Aufgabe trivial wenn Schema = correctOrder). Notfall-fallback:
// bei <=1 item return as-is (nichts zu sortieren).
function _lfDsShuffleIds(ids) {
  if (!Array.isArray(ids) || ids.length <= 1) return ids.slice();
  const a = ids.slice();
  // max 12 Versuche bis result !== input. Bei items=2 kann shuffle "zufaellig"
  // wieder original sein — explizit swap erzwingen.
  for (let attempt = 0; attempt < 12; attempt++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== ids[i]) { same = false; break; }
    }
    if (!same) return a;
  }
  // Last resort: swap erste zwei
  const b = ids.slice();
  if (b.length >= 2) { const t = b[0]; b[0] = b[1]; b[1] = t; }
  return b;
}

function _lfDsNormalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const items = Array.isArray(rawConfig.items) ? rawConfig.items : [];
  const correctOrder = Array.isArray(rawConfig.correctOrder) ? rawConfig.correctOrder.slice() : [];
  if (items.length < 2 || correctOrder.length !== items.length) return null;
  // De-dupe + validate: jedes id in items muss in correctOrder vorkommen, und
  // umgekehrt. Sonst koennen wir nicht prüfen.
  const itemIds = items.map(it => (it && typeof it.id === 'string') ? it.id : null);
  if (itemIds.some(id => !id)) return null;
  const idSet = new Set(itemIds);
  if (idSet.size !== itemIds.length) return null; // doppelte ids
  for (const id of correctOrder) {
    if (!idSet.has(id)) return null;
  }
  const normItems = items.map(it => ({
    id:    it.id,
    label: typeof it.label === 'string' ? it.label : ''
  }));
  return {
    setup:        typeof rawConfig.setup === 'string'    ? rawConfig.setup    : '',
    question:     typeof rawConfig.question === 'string' ? rawConfig.question : '',
    items:        normItems,
    correctOrder: correctOrder,
    reveal:       typeof rawConfig.reveal === 'string'   ? rawConfig.reveal   : ''
  };
}

function _renderDragSort(config, slotId) {
  const norm = _lfDsNormalizeConfig(config);
  if (!norm) {
    return `<div class="lf-widget-drag-sort lf-ds-empty" data-ds-slot="${escapeAttr(slotId)}">`
         + `Diese Aufgabe ist noch nicht fertig konfiguriert.</div>`;
  }
  const itemIds = norm.items.map(it => it.id);
  const shuffled = _lfDsShuffleIds(itemIds);
  const initialState = {
    config:      norm,
    currentOrder: shuffled,
    lockedIds:   new Set(),
    status:      'predict' // 'predict' | 'wrong' | 'correct'
  };
  _LF_DS_STATE.set(slotId, initialState);

  const setupHtml    = norm.setup    ? `<div class="lf-ds-setup">${norm.setup}</div>` : '';
  const questionHtml = norm.question ? `<h4 class="lf-ds-question">${norm.question}</h4>` : '';

  // Items in shuffled-order. idx + state werden mitgegeben damit Move-Buttons
  // an Listenrändern bzw. neben Locked-Items disabled gesetzt werden (Sophie-Fix-2).
  const itemsHtml = shuffled.map((id, idx) => {
    const it = norm.items.find(x => x.id === id);
    if (!it) return '';
    return _lfDsRenderItem(slotId, it, false, idx, initialState);
  }).join('');

  const revealHtml = norm.reveal
    ? `<div class="lf-ds-reveal" id="${escapeAttr(slotId)}-reveal" hidden>`
    +    `<div class="lf-ds-reveal-heading">Erkl\xe4rung</div>`
    +    `<div class="lf-ds-reveal-body">${norm.reveal}</div>`
    + `</div>`
    : '';

  return `<div class="lf-widget-drag-sort lf-ds-state-predict" `
       +   `id="${escapeAttr(slotId)}" data-ds-slot="${escapeAttr(slotId)}">`
       +   setupHtml
       +   questionHtml
       +   `<ol class="lf-ds-list" role="list">${itemsHtml}</ol>`
       +   `<div class="lf-ds-hint" id="${escapeAttr(slotId)}-hint" role="status" aria-live="polite" hidden></div>`
       +   `<div class="lf-ds-actions">`
       +     `<button type="button" class="lf-ds-check" `
       +       `data-ds-action="check" data-ds-slot="${escapeAttr(slotId)}">Pr\xfcfen</button>`
       +     `<button type="button" class="lf-ds-retry" `
       +       `data-ds-action="retry" data-ds-slot="${escapeAttr(slotId)}" hidden>Nochmal versuchen</button>`
       +   `</div>`
       +   revealHtml
       + `</div>`;
}

// Render eines Item-LI. Wird auch beim Reorder neu gebaut (anstatt DOM-move),
// damit die Reihenfolge in `currentOrder` immer truth-source ist.
// Sophie-Fix-2: idx + state werden durchgereicht damit move-up / move-down an
// Listenrändern bzw. neben Locked-Items disabled gesetzt werden können.
function _lfDsRenderItem(slotId, item, isLockedCorrect, idx, state) {
  const lockClass = isLockedCorrect ? ' lf-ds-locked-correct' : '';
  // Disabled-Logik fuer Move-Buttons. Wenn idx/state nicht uebergeben (Defensiv:
  // direkter Aufruf ohne Kontext) → nur isLockedCorrect entscheidet wie zuvor.
  let upDisabled = isLockedCorrect;
  let downDisabled = isLockedCorrect;
  if (typeof idx === 'number' && state && Array.isArray(state.currentOrder)) {
    const len = state.currentOrder.length;
    const isFirst = idx === 0;
    const isLast  = idx === len - 1;
    // Move durch Locked-Item ist in _lfDsMove ohnehin no-op; Button auch visuell
    // disabled = ehrlicher.
    const upNeighborLocked   = !isFirst && state.lockedIds && state.lockedIds.has(state.currentOrder[idx - 1]);
    const downNeighborLocked = !isLast  && state.lockedIds && state.lockedIds.has(state.currentOrder[idx + 1]);
    upDisabled   = isLockedCorrect || isFirst || !!upNeighborLocked;
    downDisabled = isLockedCorrect || isLast  || !!downNeighborLocked;
  }
  // Sophie-Fix-3: aria-label auf locked-Items, das Position + Lock kommuniziert.
  // aria-disabled zusaetzlich zum visuellen Lock — Tab-Index bleibt damit User
  // hinfokussieren + den Status hoeren kann.
  const lockedAriaAttrs = isLockedCorrect
    ? ` aria-label="Richtige Position. Item gesperrt." aria-disabled="true"`
    : '';
  // grip = unicode hamburger als Default. Hard-Rule #3 ist hier nicht relevant
  // (statisches UI-Glyph).
  return `<li class="lf-ds-item${lockClass}" `
       +   `data-ds-slot="${escapeAttr(slotId)}" `
       +   `data-ds-item-id="${escapeAttr(item.id)}" `
       +   `tabindex="0" `
       +   `draggable="${isLockedCorrect ? 'false' : 'true'}"${lockedAriaAttrs}>`
       +   `<span class="lf-ds-grip" aria-hidden="true">&#9776;</span>`
       +   `<span class="lf-ds-label">${item.label}</span>`
       +   `<span class="lf-ds-arrows">`
       +     `<button type="button" class="lf-ds-arrow lf-ds-arrow-up" `
       +       `data-ds-action="move-up" data-ds-slot="${escapeAttr(slotId)}" `
       +       `data-ds-item-id="${escapeAttr(item.id)}" `
       +       `aria-label="Nach oben verschieben"${upDisabled ? ' disabled' : ''}>&#9650;</button>`
       +     `<button type="button" class="lf-ds-arrow lf-ds-arrow-down" `
       +       `data-ds-action="move-down" data-ds-slot="${escapeAttr(slotId)}" `
       +       `data-ds-item-id="${escapeAttr(item.id)}" `
       +       `aria-label="Nach unten verschieben"${downDisabled ? ' disabled' : ''}>&#9660;</button>`
       +   `</span>`
       + `</li>`;
}

// Reorder-Helper: vertauscht item mit Nachbar in currentOrder. Locked-correct-
// items werden uebersprungen — sie bleiben fix. Wenn der Move-Versuch ein
// locked-item touchen wuerde, no-op (Schueler kann nicht ueber locked durch).
function _lfDsMove(slotId, itemId, direction) {
  const state = _LF_DS_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'correct') return; // alles fertig, kein Move mehr
  if (state.lockedIds.has(itemId)) return;
  const idx = state.currentOrder.indexOf(itemId);
  if (idx < 0) return;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= state.currentOrder.length) return;
  const neighborId = state.currentOrder[target];
  if (state.lockedIds.has(neighborId)) return; // ueberspringen wuerde Reihenfolge brechen
  // Swap
  const a = state.currentOrder.slice();
  const t = a[idx]; a[idx] = a[target]; a[target] = t;
  state.currentOrder = a;
  // Wenn wir nach einem 'wrong'-Versuch wieder bewegen, Hint + Shake clearen
  // (das Widget akzeptiert wieder neue Eingabe).
  if (state.status === 'wrong') {
    state.status = 'predict';
  }
  _lfDsRerenderList(slotId);
}

// Komplettes Re-Rendern der <ol> aus state.currentOrder. Einfacher + robuster
// als DOM-Knoten-Verschiebung (kein Stale-Listener-Problem dank Event-Delegation
// auf document).
function _lfDsRerenderList(slotId) {
  const state = _LF_DS_STATE.get(slotId);
  if (!state) return;
  const root = document.getElementById(slotId);
  if (!root) return;
  const list = root.querySelector('.lf-ds-list');
  if (!list) return;
  const items = state.config.items;
  // idx + state werden durchgereicht (Sophie-Fix-2), damit Move-Buttons an
  // Listenrändern / neben Locked-Items korrekt disabled sind.
  const itemsHtml = state.currentOrder.map((id, idx) => {
    const it = items.find(x => x.id === id);
    if (!it) return '';
    return _lfDsRenderItem(slotId, it, state.lockedIds.has(id), idx, state);
  }).join('');
  list.innerHTML = itemsHtml;

  // State-Class auf wrapper
  root.classList.toggle('lf-ds-state-predict',  state.status === 'predict');
  root.classList.toggle('lf-ds-state-wrong',    state.status === 'wrong');
  root.classList.toggle('lf-ds-state-correct',  state.status === 'correct');

  // Hint + retry + reveal sichtbarkeit
  const hint = root.querySelector(`#${CSS.escape(slotId)}-hint`);
  const retryBtn = root.querySelector('.lf-ds-retry');
  const checkBtn = root.querySelector('.lf-ds-check');
  const reveal = root.querySelector(`#${CSS.escape(slotId)}-reveal`);

  if (state.status === 'wrong') {
    const total = state.config.correctOrder.length;
    const rightCount = state.lockedIds.size;
    if (hint) {
      hint.hidden = false;
      hint.textContent = `Von ${total} richtig: ${rightCount}. Verschiebe die anderen.`;
    }
    if (retryBtn) retryBtn.hidden = false;
    if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = false; checkBtn.textContent = 'Pr\xfcfen'; }
    if (reveal)   reveal.hidden = true;
  } else if (state.status === 'correct') {
    if (hint)     hint.hidden = true;
    if (retryBtn) retryBtn.hidden = true;
    if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = true; checkBtn.textContent = 'Erledigt ✓'; }
    if (reveal)   reveal.hidden = !state.config.reveal;
  } else {
    // predict (initial oder nach move)
    if (hint)     hint.hidden = true;
    if (retryBtn) retryBtn.hidden = true;
    if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = false; checkBtn.textContent = 'Pr\xfcfen'; }
    if (reveal)   reveal.hidden = true;
  }
}

function _lfDsCheck(slotId) {
  const state = _LF_DS_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'correct') return;
  const correct = state.config.correctOrder;
  const cur = state.currentOrder;
  let allRight = true;
  // Lock alle items deren aktuelle Position == korrekte Position.
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] === correct[i]) {
      state.lockedIds.add(cur[i]);
    } else {
      allRight = false;
    }
  }
  if (allRight) {
    state.status = 'correct';
    _lfDsRerenderList(slotId);
    // Pulse-animation: Klasse fuer 600ms auf alle items, dann removen.
    const root = document.getElementById(slotId);
    if (root) {
      root.querySelectorAll('.lf-ds-item').forEach(el => el.classList.add('lf-ds-pulse'));
      setTimeout(() => {
        if (!root.isConnected) return;
        root.querySelectorAll('.lf-ds-item').forEach(el => el.classList.remove('lf-ds-pulse'));
      }, 700);
    }
  } else {
    state.status = 'wrong';
    _lfDsRerenderList(slotId);
    // Shake auf wrong items
    const root = document.getElementById(slotId);
    if (root) {
      root.querySelectorAll('.lf-ds-item').forEach(el => {
        const id = el.getAttribute('data-ds-item-id');
        if (id && !state.lockedIds.has(id)) {
          el.classList.add('lf-ds-shake');
        }
      });
      setTimeout(() => {
        if (!root.isConnected) return;
        root.querySelectorAll('.lf-ds-item').forEach(el => el.classList.remove('lf-ds-shake'));
      }, 450);
    }
  }
}

function _lfDsRetry(slotId) {
  const state = _LF_DS_STATE.get(slotId);
  if (!state) return;
  if (state.status !== 'wrong') return;
  // Locked bleiben locked, status zurueck auf predict damit Schueler wieder
  // die unfertigen items verschieben kann. Hint verschwindet ueber rerender.
  state.status = 'predict';
  _lfDsRerenderList(slotId);
}

// Globale Click + Keyboard Delegation. Einmalig auf document binden.
if (typeof document !== 'undefined' && !document.__lfDragSortBound) {
  document.__lfDragSortBound = true;

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const btn = target.closest('[data-ds-action]');
    if (!btn) return;
    const slotId = btn.getAttribute('data-ds-slot');
    if (!slotId) return;
    const action = btn.getAttribute('data-ds-action');
    if (action === 'move-up') {
      const id = btn.getAttribute('data-ds-item-id');
      if (id) _lfDsMove(slotId, id, 'up');
    } else if (action === 'move-down') {
      const id = btn.getAttribute('data-ds-item-id');
      if (id) _lfDsMove(slotId, id, 'down');
    } else if (action === 'check') {
      _lfDsCheck(slotId);
    } else if (action === 'retry') {
      _lfDsRetry(slotId);
    }
  });

  // Keyboard: Pfeil-hoch/Pfeil-runter auf einem .lf-ds-item bewegt das Item.
  // Wir hoeren auf keydown, damit Repeat-Keys auch funktionieren.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    const target = ev.target;
    if (!target || !target.classList || !target.classList.contains('lf-ds-item')) return;
    const slotId = target.getAttribute('data-ds-slot');
    const itemId = target.getAttribute('data-ds-item-id');
    if (!slotId || !itemId) return;
    ev.preventDefault();
    _lfDsMove(slotId, itemId, ev.key === 'ArrowUp' ? 'up' : 'down');
    // Refokus aufs neu gerenderte item (selber id), damit Tastatur-Workflow
    // weiter geht ohne dass Tab-Kontext verloren ist.
    setTimeout(() => {
      const root = document.getElementById(slotId);
      if (!root) return;
      const next = root.querySelector(`.lf-ds-item[data-ds-item-id="${CSS.escape(itemId)}"]`);
      if (next && typeof next.focus === 'function') next.focus();
    }, 0);
  });

  // ── HTML5-Drag (Desktop) ────────────────────────────────────
  // Bewegen via dragstart/dragover/drop. Mobile-Browser feuern dragstart
  // typischerweise NICHT (kein-touch-Drag-API), deshalb haben wir zusaetzlich
  // Touch-Handler (siehe unten). Locked-correct-items haben draggable=false →
  // dragstart feuert nicht, sind sicher unbewegbar.
  let _dsDragSrc = null; // { slotId, itemId }
  document.addEventListener('dragstart', (ev) => {
    const item = ev.target && ev.target.closest && ev.target.closest('.lf-ds-item');
    if (!item) return;
    if (item.classList.contains('lf-ds-locked-correct')) {
      ev.preventDefault();
      return;
    }
    const slotId = item.getAttribute('data-ds-slot');
    const itemId = item.getAttribute('data-ds-item-id');
    if (!slotId || !itemId) return;
    _dsDragSrc = { slotId, itemId };
    item.classList.add('lf-ds-dragging');
    try {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', itemId);
    } catch(e) {}
  });
  document.addEventListener('dragend', (ev) => {
    const item = ev.target && ev.target.closest && ev.target.closest('.lf-ds-item');
    if (item) item.classList.remove('lf-ds-dragging');
    _dsDragSrc = null;
  });
  document.addEventListener('dragover', (ev) => {
    if (!_dsDragSrc) return;
    const item = ev.target && ev.target.closest && ev.target.closest('.lf-ds-item');
    if (!item) return;
    const slotId = item.getAttribute('data-ds-slot');
    if (slotId !== _dsDragSrc.slotId) return;
    ev.preventDefault(); // erlauben drop
    try { ev.dataTransfer.dropEffect = 'move'; } catch(e) {}
  });
  document.addEventListener('drop', (ev) => {
    if (!_dsDragSrc) return;
    const item = ev.target && ev.target.closest && ev.target.closest('.lf-ds-item');
    if (!item) return;
    const slotId = item.getAttribute('data-ds-slot');
    if (slotId !== _dsDragSrc.slotId) return;
    const dstId = item.getAttribute('data-ds-item-id');
    const srcId = _dsDragSrc.itemId;
    _dsDragSrc = null;
    if (!dstId || dstId === srcId) return;
    ev.preventDefault();
    const state = _LF_DS_STATE.get(slotId);
    if (!state) return;
    if (state.status === 'correct') return;
    if (state.lockedIds.has(srcId) || state.lockedIds.has(dstId)) return;
    // Move src vor dst. (Kein swap — drag = "an diese Position einsortieren").
    const order = state.currentOrder.slice();
    const sIdx = order.indexOf(srcId);
    if (sIdx < 0) return;
    order.splice(sIdx, 1);
    const dIdx = order.indexOf(dstId);
    if (dIdx < 0) return;
    order.splice(dIdx, 0, srcId);
    state.currentOrder = order;
    if (state.status === 'wrong') state.status = 'predict';
    _lfDsRerenderList(slotId);
  });

  // ── Touch-Drag (Mobile) ─────────────────────────────────────
  // Simple Y-Tracking: beim touchstart erinnern wir source-id + initial-Y.
  // Bei touchmove bewegen wir das Item visuell mit translate3d. Bei touchend
  // pruefen wir welches Item unter dem Finger ist und reordern dort hin.
  // Bewusst minimaler scope: Pfeil-Buttons sind primaerer Pfad — Touch-Drag
  // ist nice-to-have. Falls der Browser Touch nicht meldet, Buttons bleiben
  // funktional.
  let _dsTouch = null; // { slotId, itemId, startY, currentY, el }
  document.addEventListener('touchstart', (ev) => {
    if (!ev.touches || ev.touches.length !== 1) return;
    const t = ev.touches[0];
    const grip = t.target && t.target.closest && t.target.closest('.lf-ds-grip');
    // Nur ueber Grip-Icon initiieren, sonst beisst sich's mit Buttons + Tap-
    // Scroll. Grip ist der eindeutige Drag-Affordance.
    if (!grip) return;
    const item = grip.closest('.lf-ds-item');
    if (!item) return;
    if (item.classList.contains('lf-ds-locked-correct')) return;
    const slotId = item.getAttribute('data-ds-slot');
    const itemId = item.getAttribute('data-ds-item-id');
    if (!slotId || !itemId) return;
    _dsTouch = { slotId, itemId, startY: t.clientY, currentY: t.clientY, el: item };
    item.classList.add('lf-ds-dragging');
  }, { passive: true });

  document.addEventListener('touchmove', (ev) => {
    if (!_dsTouch) return;
    if (!ev.touches || ev.touches.length !== 1) return;
    const t = ev.touches[0];
    _dsTouch.currentY = t.clientY;
    const dy = t.clientY - _dsTouch.startY;
    if (_dsTouch.el) {
      _dsTouch.el.style.transform = `translateY(${dy}px)`;
      _dsTouch.el.style.zIndex = '5';
    }
    // Wenn Finger eindeutig vertikal bewegt (>10px), Scroll unterdruecken.
    // touchmove ist hier passive:false (siehe addEventListener-Optionen unten).
    if (Math.abs(dy) > 10) {
      try { ev.preventDefault(); } catch(e) {}
    }
  }, { passive: false });

  document.addEventListener('touchend', (ev) => {
    if (!_dsTouch) return;
    const drag = _dsTouch;
    _dsTouch = null;
    if (drag.el) {
      drag.el.style.transform = '';
      drag.el.style.zIndex = '';
      drag.el.classList.remove('lf-ds-dragging');
    }
    // Find element unter Finger. ev.changedTouches hat den Endpunkt.
    const ct = ev.changedTouches && ev.changedTouches[0];
    if (!ct) return;
    const dropEl = document.elementFromPoint(ct.clientX, ct.clientY);
    if (!dropEl || !dropEl.closest) return;
    const dstItem = dropEl.closest('.lf-ds-item');
    if (!dstItem) return;
    const dstSlot = dstItem.getAttribute('data-ds-slot');
    if (dstSlot !== drag.slotId) return;
    const dstId = dstItem.getAttribute('data-ds-item-id');
    if (!dstId || dstId === drag.itemId) return;
    const state = _LF_DS_STATE.get(drag.slotId);
    if (!state) return;
    if (state.status === 'correct') return;
    if (state.lockedIds.has(drag.itemId) || state.lockedIds.has(dstId)) return;
    const order = state.currentOrder.slice();
    const sIdx = order.indexOf(drag.itemId);
    if (sIdx < 0) return;
    order.splice(sIdx, 1);
    const dIdx = order.indexOf(dstId);
    if (dIdx < 0) return;
    order.splice(dIdx, 0, drag.itemId);
    state.currentOrder = order;
    if (state.status === 'wrong') state.status = 'predict';
    _lfDsRerenderList(drag.slotId);
  });

  // Sophie-Fix-1: touchcancel räumt Zombie-State weg, wenn das OS den Touch
  // abbricht (Notification-Pull, Multi-Touch, System-Wisch-Geste). touchend
  // feuert dann nicht — ohne diesen Handler bliebe `_dsTouch` gesetzt und
  // `lf-ds-dragging`-Klasse + transform/zIndex am Item haengen.
  document.addEventListener('touchcancel', () => {
    if (!_dsTouch) return;
    const drag = _dsTouch;
    _dsTouch = null;
    if (drag.el) {
      drag.el.style.transform = '';
      drag.el.style.zIndex = '';
      drag.el.classList.remove('lf-ds-dragging');
    }
  });
}

// ─── Mega-Update 2026-05-09 — Drag-Match-Widget (MVP-2) ──────────────────────
// Schueler verbindet Begriff mit Definition (oder Person↔Werk, Stilmittel↔
// Beispiel, Symbol↔Bedeutung). Tap-Tap-Pattern statt echter Drag-Linien:
//   1. Tap left  → Item highlightet als "selected" (lf-dm-selected).
//   2. Tap right → Verbindung wird erstellt; beide Items kriegen die gleiche
//      --lf-conn-N-Farbe via inline-CSS-Var und einen farbigen Chip.
//   3. Re-Tap auf bereits verbundenes Item bricht die Verbindung wieder auf.
// "Pruefen" lockt korrekte Verbindungen (gruener Border), shaket falsche und
// gibt sie zur Re-Connection frei.
//
// Hard-Rule #3: setup/question/pair.left/pair.right/reveal sind
// HTML-entity-encoded und gehen 1:1 ins innerHTML — kein escapeHtml().
// Alle data-* Werte via escapeAttr.
//
// Color-Pool-Ansatz: 6 themed CSS-Variablen --lf-conn-1..6 in :root + dark
// (siehe main.css). Cosmetic-Themes erben sie — kein per-theme Override
// noetig, weil die Farben bewusst absolute Anker sind (wie Rarity), damit
// gepaarte Items immer dieselbe Farbe tragen. Mehr als 6 gleichzeitige
// Verbindungen (= pairs.length > 6) wird per Modulo gewrappt; Edge-Case fuer
// Topics mit <=6 pairs in der Praxis nicht relevant.
const _LF_DM_STATE = new Map(); // slotId -> { config, rightOrder, connections, selectedLeft, lockedConnections, status, lastWrongLefts }
let _LF_DM_SLOT_SEQ = 0;

function _lfDmNextSlotId() {
  _LF_DM_SLOT_SEQ += 1;
  return `lf-dm-${Date.now().toString(36)}-${_LF_DM_SLOT_SEQ}`;
}

// Fisher-Yates Shuffle der right-pair-IDs. Mirror _lfDsShuffleIds: garantiert
// result !== input (max 12 Versuche, sonst expliziter Swap [0]<->[1]).
function _lfDmShuffleIds(ids) {
  if (!Array.isArray(ids) || ids.length <= 1) return ids.slice();
  const a = ids.slice();
  for (let attempt = 0; attempt < 12; attempt++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== ids[i]) { same = false; break; }
    }
    if (!same) return a;
  }
  const b = ids.slice();
  if (b.length >= 2) { const t = b[0]; b[0] = b[1]; b[1] = t; }
  return b;
}

// Defensive Validation: pairs.length >= 2, jeder pair hat id+left+right (alle
// non-empty strings), eindeutige IDs. Sonst null → "noch nicht fertig
// konfiguriert"-Fallback im Renderer.
function _lfDmNormalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const pairs = Array.isArray(rawConfig.pairs) ? rawConfig.pairs : [];
  if (pairs.length < 2) return null;
  const seenIds = new Set();
  const normPairs = [];
  for (const p of pairs) {
    if (!p || typeof p !== 'object') return null;
    const id    = (typeof p.id    === 'string') ? p.id    : '';
    const left  = (typeof p.left  === 'string') ? p.left  : '';
    const right = (typeof p.right === 'string') ? p.right : '';
    if (!id || !left || !right) return null;
    if (seenIds.has(id)) return null; // doppelte ids
    seenIds.add(id);
    normPairs.push({ id, left, right });
  }
  return {
    setup:    typeof rawConfig.setup    === 'string' ? rawConfig.setup    : '',
    question: typeof rawConfig.question === 'string' ? rawConfig.question : '',
    pairs:    normPairs,
    reveal:   typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : ''
  };
}

// Connection-Color-Slot: ID -> 1..6. Stabil pro Verbindung, damit beide Seiten
// dieselbe Farbe tragen. Wird beim Connect berechnet aus dem ersten freien
// Slot (1..6, modulo 6 wenn >6 pairs).
function _lfDmAssignColorSlot(state, leftPairId) {
  const used = new Set();
  for (const [_lid, info] of state.connections) {
    if (info && typeof info.colorSlot === 'number') used.add(info.colorSlot);
  }
  for (let i = 1; i <= 6; i++) {
    if (!used.has(i)) return i;
  }
  // >6 gleichzeitige Verbindungen: hash auf leftPairId fuer deterministischen
  // Wrap. (In der Praxis kommen maximal 4-5 pairs vor.)
  let h = 0;
  for (let i = 0; i < leftPairId.length; i++) h = (h * 31 + leftPairId.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 6) + 1);
}

function _renderDragMatch(config, slotId) {
  const norm = _lfDmNormalizeConfig(config);
  if (!norm) {
    return `<div class="lf-widget-drag-match lf-dm-empty" data-dm-slot="${escapeAttr(slotId)}">`
         + `Diese Aufgabe ist noch nicht fertig konfiguriert.</div>`;
  }
  const pairIds = norm.pairs.map(p => p.id);
  const rightOrder = _lfDmShuffleIds(pairIds);
  const initialState = {
    config:            norm,
    rightOrder:        rightOrder,
    connections:       new Map(),  // leftPairId -> { rightPairId, colorSlot }
    selectedLeft:      null,
    lockedConnections: new Set(),  // Set<leftPairId> — locked-correct after Pruefen
    status:            'predict',  // 'predict' | 'wrong' | 'correct'
    lastWrongLefts:    new Set()   // markiert für visual "wrong"-state bis next user action
  };
  _LF_DM_STATE.set(slotId, initialState);

  const setupHtml    = norm.setup    ? `<div class="lf-dm-setup">${norm.setup}</div>` : '';
  const questionHtml = norm.question ? `<h4 class="lf-dm-question">${norm.question}</h4>` : '';

  const leftItemsHtml = norm.pairs.map(p => _lfDmRenderItem(slotId, p, 'left', initialState)).join('');
  const rightItemsHtml = rightOrder.map(id => {
    const p = norm.pairs.find(x => x.id === id);
    if (!p) return '';
    return _lfDmRenderItem(slotId, p, 'right', initialState);
  }).join('');

  const revealHtml = norm.reveal
    ? `<div class="lf-dm-reveal" id="${escapeAttr(slotId)}-reveal" hidden>`
    +    `<div class="lf-dm-reveal-heading">Erkl\xe4rung</div>`
    +    `<div class="lf-dm-reveal-body">${norm.reveal}</div>`
    + `</div>`
    : '';

  return `<div class="lf-widget-drag-match lf-dm-state-predict" `
       +   `id="${escapeAttr(slotId)}" data-dm-slot="${escapeAttr(slotId)}">`
       +   setupHtml
       +   questionHtml
       +   `<div class="lf-dm-columns">`
       +     `<div class="lf-dm-column lf-dm-column-left">`
       +       `<div class="lf-dm-column-header">Begriff</div>`
       +       `<ul class="lf-dm-list" role="list">${leftItemsHtml}</ul>`
       +     `</div>`
       +     `<div class="lf-dm-column lf-dm-column-right">`
       +       `<div class="lf-dm-column-header">Definition</div>`
       +       `<ul class="lf-dm-list" role="list">${rightItemsHtml}</ul>`
       +     `</div>`
       +   `</div>`
       +   `<div class="lf-dm-hint" id="${escapeAttr(slotId)}-hint" role="status" aria-live="polite" hidden></div>`
       +   `<div class="lf-dm-actions">`
       +     `<button type="button" class="lf-dm-check" `
       +       `data-dm-action="check" data-dm-slot="${escapeAttr(slotId)}">Pr\xfcfen</button>`
       +     `<button type="button" class="lf-dm-retry" `
       +       `data-dm-action="retry" data-dm-slot="${escapeAttr(slotId)}" hidden>Nochmal versuchen</button>`
       +   `</div>`
       +   revealHtml
       + `</div>`;
}

// Render eines einzelnen Items (left oder right). Ermittelt Selection-State,
// Connection-Info, Lock-State + setzt --lf-dm-conn inline auf eine der
// --lf-conn-N CSS-Variablen.
function _lfDmRenderItem(slotId, pair, side, state) {
  // Bestimme connection-info: links direkt aus state.connections.get(pair.id).
  // Rechts: finde leftId fuer den dieser pair.id der right-target ist.
  let connInfo = null;
  let leftIdForLock = null;
  if (side === 'left') {
    if (state.connections.has(pair.id)) {
      connInfo = state.connections.get(pair.id);
      leftIdForLock = pair.id;
    }
  } else {
    for (const [lid, info] of state.connections) {
      if (info && info.rightPairId === pair.id) {
        connInfo = info;
        leftIdForLock = lid;
        break;
      }
    }
  }

  const isSelected      = side === 'left' && state.selectedLeft === pair.id;
  const isConnected     = !!connInfo;
  const isLockedCorrect = !!leftIdForLock && state.lockedConnections.has(leftIdForLock);
  const isWrong         = !!leftIdForLock && state.lastWrongLefts.has(leftIdForLock);

  const classes = ['lf-dm-item'];
  if (isSelected)      classes.push('lf-dm-selected');
  if (isConnected)     classes.push('lf-dm-connected');
  if (isLockedCorrect) classes.push('lf-dm-locked-correct');
  if (isWrong)         classes.push('lf-dm-wrong');

  // Inline --lf-dm-conn auf eine der --lf-conn-N Variablen mappen.
  let styleAttr = '';
  if (connInfo && typeof connInfo.colorSlot === 'number') {
    styleAttr = ` style="--lf-dm-conn: var(--lf-conn-${connInfo.colorSlot});"`;
  }

  // a11y: locked-Items kommunizieren Status + sind aria-disabled.
  // Sophie-fix-3 (drag-sort lessons learned): aria-label + aria-disabled.
  const lockedAriaAttrs = isLockedCorrect
    ? ` aria-label="Richtige Verbindung. Gesperrt." aria-disabled="true"`
    : '';

  const action = side === 'left' ? 'select-left' : 'select-right';
  const labelHtml = side === 'left' ? pair.left : pair.right;

  // tabindex=0 auch auf locked, damit Screenreader-User Status hoeren koennen
  // (analog drag-sort).
  // disabled-Attribut auf locked-Items damit click-Handler im delegated-listener
  // sie ueberspringt — defensiv zusaetzlich zum lockedConnections-Check in JS.
  return `<li class="${classes.join(' ')}"`
       + `${styleAttr}`
       + ` data-dm-slot="${escapeAttr(slotId)}"`
       + ` data-dm-action="${action}"`
       + ` data-dm-pair-id="${escapeAttr(pair.id)}"`
       + ` data-dm-side="${side}"`
       + ` tabindex="0"`
       + ` role="button"`
       + `${lockedAriaAttrs}>`
       +   `<span class="lf-dm-label">${labelHtml}</span>`
       +   `<span class="lf-dm-chip" aria-hidden="true"></span>`
       + `</li>`;
}

// Re-Render der beiden <ul>s aus state. Wie drag-sort: voller Re-Build statt
// DOM-Manipulation, damit state truth-source bleibt.
function _lfDmRerender(slotId) {
  const state = _LF_DM_STATE.get(slotId);
  if (!state) return;
  const root = document.getElementById(slotId);
  if (!root) return;
  const leftList  = root.querySelector('.lf-dm-column-left  .lf-dm-list');
  const rightList = root.querySelector('.lf-dm-column-right .lf-dm-list');
  if (!leftList || !rightList) return;

  leftList.innerHTML = state.config.pairs.map(p => _lfDmRenderItem(slotId, p, 'left', state)).join('');
  rightList.innerHTML = state.rightOrder.map(id => {
    const p = state.config.pairs.find(x => x.id === id);
    if (!p) return '';
    return _lfDmRenderItem(slotId, p, 'right', state);
  }).join('');

  root.classList.toggle('lf-dm-state-predict', state.status === 'predict');
  root.classList.toggle('lf-dm-state-wrong',   state.status === 'wrong');
  root.classList.toggle('lf-dm-state-correct', state.status === 'correct');

  const hint     = root.querySelector(`#${CSS.escape(slotId)}-hint`);
  const retryBtn = root.querySelector('.lf-dm-retry');
  const checkBtn = root.querySelector('.lf-dm-check');
  const reveal   = root.querySelector(`#${CSS.escape(slotId)}-reveal`);

  if (state.status === 'wrong') {
    const total = state.config.pairs.length;
    const rightCount = state.lockedConnections.size;
    if (hint) {
      hint.hidden = false;
      hint.textContent = `Von ${total} richtig: ${rightCount}. Verbinde die anderen neu.`;
    }
    if (retryBtn) retryBtn.hidden = false;
    if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = false; checkBtn.textContent = 'Pr\xfcfen'; }
    if (reveal)   reveal.hidden = true;
  } else if (state.status === 'correct') {
    if (hint)     hint.hidden = true;
    if (retryBtn) retryBtn.hidden = true;
    if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = true; checkBtn.textContent = 'Erledigt ✓'; }
    if (reveal)   reveal.hidden = !state.config.reveal;
  } else {
    if (hint)     hint.hidden = true;
    if (retryBtn) retryBtn.hidden = true;
    if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = false; checkBtn.textContent = 'Pr\xfcfen'; }
    if (reveal)   reveal.hidden = true;
  }
}

// Entferne Verbindung wo immer leftId oder rightId beteiligt ist. Locked-
// correct-Verbindungen werden NIE entfernt (Hard-rule: locked = locked).
function _lfDmDisconnect(state, leftId) {
  if (!leftId) return;
  if (state.lockedConnections.has(leftId)) return;
  state.connections.delete(leftId);
  state.lastWrongLefts.delete(leftId);
}
function _lfDmFindLeftByRight(state, rightId) {
  for (const [lid, info] of state.connections) {
    if (info && info.rightPairId === rightId) return lid;
  }
  return null;
}

// Click-Handler: tap on left-item, tap on right-item.
function _lfDmTapLeft(slotId, leftId) {
  const state = _LF_DM_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'correct') return;
  if (state.lockedConnections.has(leftId)) return; // locked = no retap

  // Wenn das schon das selectedLeft ist → deselect.
  if (state.selectedLeft === leftId) {
    state.selectedLeft = null;
    _lfDmRerender(slotId);
    return;
  }
  // Wenn dieses left bereits eine (nicht-locked) Verbindung hat → trenne sie.
  // Dann wird es das neu-selektierte left.
  if (state.connections.has(leftId)) {
    _lfDmDisconnect(state, leftId);
  }
  state.selectedLeft = leftId;
  // Wrong-Marker auf irgendeinem Wechsel räumen (User hat verstanden).
  state.lastWrongLefts.clear();
  if (state.status === 'wrong') state.status = 'predict';
  _lfDmRerender(slotId);
  // Refokus aufs (neu gerenderte) item — analog drag-sort, fuer Keyboard-Workflow.
  _lfDmFocusItem(slotId, leftId, 'left');
}

function _lfDmTapRight(slotId, rightId) {
  const state = _LF_DM_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'correct') return;

  // Locked-correct rechts? Right-Lock = wenn pair in lockedConnections-leftId
  // den rightId als target hat.
  const lockedLeftForThisRight = (() => {
    for (const lid of state.lockedConnections) {
      const info = state.connections.get(lid);
      if (info && info.rightPairId === rightId) return lid;
    }
    return null;
  })();
  if (lockedLeftForThisRight) return; // locked rechts: no retap

  // Wenn dieses right bereits eine Verbindung hat (nicht-locked) und kein
  // selectedLeft existiert → trenne die Verbindung (User-Fix-Path).
  const existingLeftForThisRight = _lfDmFindLeftByRight(state, rightId);
  if (existingLeftForThisRight && !state.selectedLeft) {
    _lfDmDisconnect(state, existingLeftForThisRight);
    state.lastWrongLefts.clear();
    if (state.status === 'wrong') state.status = 'predict';
    _lfDmRerender(slotId);
    return;
  }

  // Kein selectedLeft → no-op. (User soll links erst tappen.)
  if (!state.selectedLeft) return;

  const leftId = state.selectedLeft;
  // Falls dieses right schon mit einem ANDEREN left verbunden ist → das alte
  // left frei machen (Verbindung neu zuweisen).
  if (existingLeftForThisRight && existingLeftForThisRight !== leftId) {
    _lfDmDisconnect(state, existingLeftForThisRight);
  }
  // Falls das selectedLeft schon eine Verbindung hat (Edge-Case: User tappt
  // ein left mit Verbindung, dann ein right) → alte Verbindung loesen.
  // (Greift nicht im Normalfall, weil _lfDmTapLeft bereits trennt.)
  if (state.connections.has(leftId)) {
    _lfDmDisconnect(state, leftId);
  }
  // Verbindung erstellen mit Color-Slot.
  const colorSlot = _lfDmAssignColorSlot(state, leftId);
  state.connections.set(leftId, { rightPairId: rightId, colorSlot: colorSlot });
  state.selectedLeft = null;
  state.lastWrongLefts.clear();
  if (state.status === 'wrong') state.status = 'predict';
  _lfDmRerender(slotId);
  _lfDmFocusItem(slotId, rightId, 'right');
}

// Refokus-Helper nach rerender (DOM wird ersetzt → focus geht verloren).
function _lfDmFocusItem(slotId, pairId, side) {
  setTimeout(() => {
    const root = document.getElementById(slotId);
    if (!root) return;
    const sel = `.lf-dm-item[data-dm-pair-id="${CSS.escape(pairId)}"][data-dm-side="${side}"]`;
    const el = root.querySelector(sel);
    if (el && typeof el.focus === 'function') el.focus();
  }, 0);
}

function _lfDmCheck(slotId) {
  const state = _LF_DM_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'correct') return;

  // Korrekt = leftId === rightPairId (id ist der Match-Anker).
  const wrongLefts = new Set();
  let total = state.config.pairs.length;
  let correctCount = 0;
  // Iteriere ueber alle pair.ids um auch unverbundene zu sehen.
  for (const p of state.config.pairs) {
    const conn = state.connections.get(p.id);
    if (conn && conn.rightPairId === p.id) {
      state.lockedConnections.add(p.id);
      correctCount++;
    } else if (conn) {
      // Verbindung existiert, ist aber falsch → entkoppeln nach shake.
      wrongLefts.add(p.id);
    }
    // Kein conn → Item bleibt unverbunden, kein wrong-Marker.
  }

  state.lastWrongLefts = wrongLefts;

  if (correctCount === total) {
    state.status = 'correct';
    state.selectedLeft = null;
    _lfDmRerender(slotId);
    // Pulse alle items
    const root = document.getElementById(slotId);
    if (root) {
      root.querySelectorAll('.lf-dm-item').forEach(el => el.classList.add('lf-dm-pulse'));
      setTimeout(() => {
        if (!root.isConnected) return;
        root.querySelectorAll('.lf-dm-item').forEach(el => el.classList.remove('lf-dm-pulse'));
      }, 700);
    }
  } else {
    state.status = 'wrong';
    state.selectedLeft = null;
    // Falsche Verbindungen jetzt aufloesen (sie wurden registriert in
    // wrongLefts; Items bleiben durch lf-dm-wrong-Klasse markiert bis zur
    // naechsten User-Aktion). Snapshot in Array, weil _lfDmDisconnect
    // state.lastWrongLefts (= alias auf wrongLefts) mutiert.
    const wrongList = Array.from(wrongLefts);
    for (const lid of wrongList) {
      _lfDmDisconnect(state, lid);
      // Re-add to lastWrongLefts weil _lfDmDisconnect das wegputzt.
      state.lastWrongLefts.add(lid);
    }
    _lfDmRerender(slotId);
    // Shake auf wrong items (left + right).
    const root = document.getElementById(slotId);
    if (root) {
      root.querySelectorAll('.lf-dm-item.lf-dm-wrong').forEach(el => {
        el.classList.add('lf-dm-shake');
      });
      setTimeout(() => {
        if (!root.isConnected) return;
        root.querySelectorAll('.lf-dm-item').forEach(el => el.classList.remove('lf-dm-shake'));
      }, 450);
    }
  }
}

function _lfDmRetry(slotId) {
  const state = _LF_DM_STATE.get(slotId);
  if (!state) return;
  if (state.status !== 'wrong') return;
  // locked-correct bleibt, alles andere zurueck auf predict. wrong-Marker weg.
  state.status = 'predict';
  state.selectedLeft = null;
  state.lastWrongLefts.clear();
  _lfDmRerender(slotId);
}

// Globale Click + Keyboard Delegation. Einmalig auf document binden.
if (typeof document !== 'undefined' && !document.__lfDragMatchBound) {
  document.__lfDragMatchBound = true;

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const el = target.closest('[data-dm-action]');
    if (!el) return;
    const slotId = el.getAttribute('data-dm-slot');
    if (!slotId) return;
    const action = el.getAttribute('data-dm-action');
    if (action === 'check') {
      _lfDmCheck(slotId);
    } else if (action === 'retry') {
      _lfDmRetry(slotId);
    } else if (action === 'select-left' || action === 'select-right') {
      // aria-disabled (locked) Items ignorieren.
      if (el.getAttribute('aria-disabled') === 'true') return;
      const pairId = el.getAttribute('data-dm-pair-id');
      if (!pairId) return;
      if (action === 'select-left') _lfDmTapLeft(slotId, pairId);
      else _lfDmTapRight(slotId, pairId);
    }
  });

  // Keyboard: Enter / Space auf einem .lf-dm-item triggert Tap. Tab navigiert
  // nativ (tabindex=0). Buttons bekommen native Enter/Space-Behandlung.
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    const target = ev.target;
    if (!target || !target.classList || !target.classList.contains('lf-dm-item')) return;
    if (target.getAttribute('aria-disabled') === 'true') return;
    const slotId = target.getAttribute('data-dm-slot');
    const pairId = target.getAttribute('data-dm-pair-id');
    const side = target.getAttribute('data-dm-side');
    if (!slotId || !pairId || !side) return;
    ev.preventDefault();
    if (side === 'left')  _lfDmTapLeft(slotId, pairId);
    else                  _lfDmTapRight(slotId, pairId);
  });
}

// ─── Mega-Update 2026-05-09 — Number-Slider-Widget (MVP-3) ───────────────────
// Schueler schaetzt einen Zahlenwert per <input type="range">, kriegt Range-
// Reveal mit Toleranz. Use-Cases: "Wie viele Tote forderte Verdun?", "CO2-
// Anstieg seit 1850?", "Schallgeschwindigkeit in Luft?". Pure Predict-Then-
// Reveal-UX, aber mit kontinuierlichem Wert + Toleranz statt MC.
//
// Hard-Rule #3: setup, question, reveal, unit sind HTML-entity-encoded vom
// Author und gehen 1:1 ins innerHTML — kein escapeHtml(). Datenattribute
// via escapeAttr.
//
// State pro slot: { config (normalized), currentValue, attempts (int),
// lastGuess (number|null) — fuer Marker nach reveal, status }.
// Status: 'predict' | 'wrong' | 'correct' | 'revealed'.
//   'revealed' = nach 3x falsch erzwungener Reveal (Slider lockt, Marker
//   zeigen letzten Tipp + correct).
//
// Custom-Slider-CSS deckt Webkit (-webkit-slider-runnable-track + -thumb)
// und Firefox (::-moz-range-track + -thumb) komplett ab. Touch-Target via
// ueber-grosser Thumb (24px Visible) + min-height auf <input>-Wrapper.
const _LF_NS_STATE = new Map(); // slotId -> { config, currentValue, attempts, lastGuess, status }
let _LF_NS_SLOT_SEQ = 0;

function _lfNsNextSlotId() {
  _LF_NS_SLOT_SEQ += 1;
  return `lf-ns-${Date.now().toString(36)}-${_LF_NS_SLOT_SEQ}`;
}

// Snap value auf step-Raster relativ zu min. Bsp.: min=0,step=50000,v=510000 → 500000.
// Float-Drift via Math.round ausgleichen. Clamp auf [min,max].
function _lfNsSnap(value, min, max, step) {
  if (!isFinite(value)) value = min;
  if (value < min) value = min;
  if (value > max) value = max;
  if (step > 0) {
    const k = Math.round((value - min) / step);
    value = min + k * step;
    // IEEE-754 Residue eliminieren: auf step's decimal precision runden.
    // Sonst gibt z.B. _lfNsSnap(0.3, 0, 1, 0.1) => 0.30000000000000004.
    // Display zeigt Schrott + slider.value-Re-Assign triggert Mid-Drag-Jitter.
    const stepStr = String(step);
    const dot = stepStr.indexOf('.');
    if (dot >= 0) {
      const decimals = stepStr.length - dot - 1;
      value = Number(value.toFixed(decimals));
    }
    // Clamp nach Snap fuer Floats (kann gerade ueber max landen).
    if (value > max) value = max - ((value - min) % step);
    if (value < min) value = min;
  }
  return value;
}

// Defensive Validation: min<max, step>0, correct in [min,max], tolerance>=0,
// tolerance<=(max-min)/2. default optional → fallback (min+max)/2 auf step
// gerundet. Sonst null → "noch nicht fertig konfiguriert".
function _lfNsNormalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const min  = Number(rawConfig.min);
  const max  = Number(rawConfig.max);
  const step = Number(rawConfig.step);
  const correct = Number(rawConfig.correct);
  const tolerance = Number(rawConfig.tolerance);
  if (!isFinite(min) || !isFinite(max) || min >= max) return null;
  if (!isFinite(step) || step <= 0) return null;
  if (!isFinite(correct) || correct < min || correct > max) return null;
  if (!isFinite(tolerance) || tolerance < 0) return null;
  if (tolerance > (max - min) / 2) return null;
  // default: optional. Fallback = mitte, snap auf step.
  let def;
  if (typeof rawConfig.default === 'number' && isFinite(rawConfig.default)) {
    def = _lfNsSnap(rawConfig.default, min, max, step);
  } else {
    def = _lfNsSnap((min + max) / 2, min, max, step);
  }
  const unit = typeof rawConfig.unit === 'string' ? rawConfig.unit : '';
  return {
    setup:     typeof rawConfig.setup    === 'string' ? rawConfig.setup    : '',
    question:  typeof rawConfig.question === 'string' ? rawConfig.question : '',
    min, max, step, correct, tolerance,
    default:   def,
    unit:      unit,
    // Decoded unit fuer aria — einmal parsen statt pro input-tick (~60 Hz waehrend Drag,
    // sonst hunderte Orphan-<textarea>-Nodes/sec via decodeHtmlEntities).
    unitAria:  decodeHtmlEntities(unit),
    format:    typeof rawConfig.format   === 'string' ? rawConfig.format   : 'de-DE',
    reveal:    typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : ''
  };
}

// Wert formatieren: Number.toLocaleString(format) + Unit mit &nbsp; falls vorhanden.
// Unit ist HTML-entity-encoded vom Author → 1:1 in innerHTML. Wert-Teil aus
// toLocaleString ist schon plaintext-safe (nur Ziffern + Locale-Separatoren).
function _lfNsFormatValue(value, norm) {
  let text;
  try {
    text = Number(value).toLocaleString(norm.format || 'de-DE');
  } catch (e) {
    text = String(value);
  }
  if (norm.unit) return `${text}&nbsp;${norm.unit}`;
  return text;
}

// Marker-Position auf Slider-Track als Prozent von [min,max]. Clamp auf [0,100]
// damit visuell nichts ueber den Track ueberhaengt (z.B. wenn correct === max).
function _lfNsPosPct(value, norm) {
  const range = norm.max - norm.min;
  if (range <= 0) return 0;
  const pct = ((value - norm.min) / range) * 100;
  return Math.max(0, Math.min(100, pct));
}

// Plaintext-Format ohne &nbsp; (fuer aria-valuetext, das geht in den
// Accessibility-Tree als Text — Entities wuerden dort angesagt).
function _lfNsFormatValueAria(value, norm) {
  let text;
  try {
    text = Number(value).toLocaleString(norm.format || 'de-DE');
  } catch (e) {
    text = String(value);
  }
  if (norm.unit) {
    // unit kann HTML-entities haben — pre-decoded in _lfNsNormalizeConfig (norm.unitAria).
    return `${text} ${norm.unitAria || ''}`;
  }
  return text;
}

function _renderNumberSlider(config, slotId) {
  const norm = _lfNsNormalizeConfig(config);
  if (!norm) {
    return `<div class="lf-widget-number-slider lf-ns-empty" data-ns-slot="${escapeAttr(slotId)}">`
         + `Diese Aufgabe ist noch nicht fertig konfiguriert.</div>`;
  }
  const initialState = {
    config:       norm,
    currentValue: norm.default,
    attempts:     0,
    lastGuess:    null,
    status:       'predict' // 'predict' | 'wrong' | 'correct' | 'revealed'
  };
  _LF_NS_STATE.set(slotId, initialState);

  const setupHtml    = norm.setup    ? `<div class="lf-ns-setup">${norm.setup}</div>` : '';
  const questionHtml = norm.question ? `<h4 class="lf-ns-question">${norm.question}</h4>` : '';

  const guessPct = _lfNsPosPct(norm.default, norm);
  const correctPct = _lfNsPosPct(norm.correct, norm);

  const revealHtml = norm.reveal
    ? `<div class="lf-ns-reveal" id="${escapeAttr(slotId)}-reveal" hidden>`
    +    `<div class="lf-ns-reveal-heading">Erkl\xe4rung</div>`
    +    `<div class="lf-ns-reveal-body">${norm.reveal}</div>`
    + `</div>`
    : '';

  // Slider mit aria-valuetext fuer Screenreader (sagt "500.000 Menschen" statt "500000").
  // Marker-Container hat zwei spans: guess (immer sichtbar) + correct (hidden bis reveal).
  return `<div class="lf-widget-number-slider lf-ns-state-predict" `
       +   `id="${escapeAttr(slotId)}" data-ns-slot="${escapeAttr(slotId)}">`
       +   setupHtml
       +   questionHtml
       +   `<div class="lf-ns-display" id="${escapeAttr(slotId)}-display" `
       +     `role="status" aria-live="polite">${_lfNsFormatValue(norm.default, norm)}</div>`
       +   `<div class="lf-ns-slider-wrap">`
       +     `<div class="lf-ns-markers" aria-hidden="true">`
       +       `<span class="lf-ns-marker lf-ns-marker-guess" `
       +         `id="${escapeAttr(slotId)}-marker-guess" `
       +         `style="left: ${guessPct}%;" hidden></span>`
       +       `<span class="lf-ns-marker lf-ns-marker-correct" `
       +         `id="${escapeAttr(slotId)}-marker-correct" `
       +         `style="left: ${correctPct}%;" hidden></span>`
       +     `</div>`
       +     `<input type="range" class="lf-ns-input" `
       +       `data-ns-slot="${escapeAttr(slotId)}" `
       +       `min="${escapeAttr(String(norm.min))}" `
       +       `max="${escapeAttr(String(norm.max))}" `
       +       `step="${escapeAttr(String(norm.step))}" `
       +       `value="${escapeAttr(String(norm.default))}" `
       +       `aria-valuetext="${escapeAttr(_lfNsFormatValueAria(norm.default, norm))}">`
       +   `</div>`
       +   `<div class="lf-ns-hint" id="${escapeAttr(slotId)}-hint" role="status" aria-live="polite" hidden></div>`
       +   `<div class="lf-ns-actions">`
       +     `<button type="button" class="lf-ns-confirm" `
       +       `data-ns-action="confirm" data-ns-slot="${escapeAttr(slotId)}">Best\xe4tigen</button>`
       +     `<button type="button" class="lf-ns-reset" `
       +       `data-ns-action="reset" data-ns-slot="${escapeAttr(slotId)}" hidden>Nochmal versuchen</button>`
       +   `</div>`
       +   revealHtml
       + `</div>`;
}

// Wenn der User den Slider zieht: state.currentValue updaten + display refreshen.
// Snap auf step (HTML5-range macht das schon, aber doppelt-snappen ist gratis).
// Wenn vorher 'wrong' war → zurueck auf 'predict' (User darf wieder bestaetigen).
function _lfNsUpdate(slotId, rawValue) {
  const state = _LF_NS_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'correct' || state.status === 'revealed') return;
  const norm = state.config;
  const v = _lfNsSnap(Number(rawValue), norm.min, norm.max, norm.step);
  state.currentValue = v;
  if (state.status === 'wrong') {
    // Hint clearen + zurueck auf predict (User hat etwas geaendert → frischer Versuch).
    state.status = 'predict';
  }
  _lfNsRefresh(slotId);
}

// Refresh: Display + Hint + Marker + State-Klassen + Buttons + Reveal-Sichtbarkeit.
// Kein Re-Render des Slider-Inputs (sonst geht Drag-Fokus / Active-Touch verloren).
function _lfNsRefresh(slotId) {
  const state = _LF_NS_STATE.get(slotId);
  if (!state) return;
  const root = document.getElementById(slotId);
  if (!root) return;
  const norm = state.config;

  const display     = root.querySelector(`#${CSS.escape(slotId)}-display`);
  const hint        = root.querySelector(`#${CSS.escape(slotId)}-hint`);
  const reveal      = root.querySelector(`#${CSS.escape(slotId)}-reveal`);
  const confirmBtn  = root.querySelector('.lf-ns-confirm');
  const resetBtn    = root.querySelector('.lf-ns-reset');
  const slider      = root.querySelector('.lf-ns-input');
  const markerGuess = root.querySelector(`#${CSS.escape(slotId)}-marker-guess`);
  const markerCorrect = root.querySelector(`#${CSS.escape(slotId)}-marker-correct`);

  // Display zeigt aktuellen Wert (live waehrend predict, frozen letzter-Tipp ab correct/revealed).
  const showValue = (state.status === 'correct' || state.status === 'revealed')
    ? (state.lastGuess != null ? state.lastGuess : state.currentValue)
    : state.currentValue;
  if (display) display.innerHTML = _lfNsFormatValue(showValue, norm);

  // State-Klassen
  root.classList.toggle('lf-ns-state-predict',  state.status === 'predict');
  root.classList.toggle('lf-ns-state-wrong',    state.status === 'wrong');
  root.classList.toggle('lf-ns-state-correct',  state.status === 'correct');
  root.classList.toggle('lf-ns-state-revealed', state.status === 'revealed');

  // Slider-Lock + aria-valuetext aktuell halten.
  if (slider) {
    const lock = (state.status === 'correct' || state.status === 'revealed');
    slider.disabled = lock;
    if (lock) slider.setAttribute('aria-disabled', 'true');
    else slider.removeAttribute('aria-disabled');
    // Slider-Wert nur setzen wenn er abweicht (sonst springt das Thumb mid-drag).
    const sv = String(state.currentValue);
    if (slider.value !== sv) slider.value = sv;
    slider.setAttribute('aria-valuetext', _lfNsFormatValueAria(state.currentValue, norm));
  }

  // Marker. Guess sichtbar nur nach erstem confirm. Correct nur nach correct/revealed.
  if (markerGuess) {
    if (state.lastGuess != null) {
      markerGuess.hidden = false;
      markerGuess.style.left = _lfNsPosPct(state.lastGuess, norm) + '%';
    } else {
      markerGuess.hidden = true;
    }
  }
  if (markerCorrect) {
    if (state.status === 'correct' || state.status === 'revealed') {
      markerCorrect.hidden = false;
      markerCorrect.style.left = _lfNsPosPct(norm.correct, norm) + '%';
    } else {
      markerCorrect.hidden = true;
    }
  }

  // Hint + Buttons + Reveal je nach Status.
  if (state.status === 'wrong') {
    if (hint) {
      hint.hidden = false;
      const direction = (state.lastGuess != null && state.lastGuess < norm.correct)
        ? 'Zu niedrig — versuche h\xf6her.'
        : 'Zu hoch — versuche niedriger.';
      const remaining = Math.max(0, 3 - state.attempts);
      hint.textContent = remaining > 0
        ? `${direction} (Noch ${remaining} ${remaining === 1 ? 'Versuch' : 'Versuche'})`
        : direction;
    }
    if (confirmBtn) { confirmBtn.hidden = false; confirmBtn.disabled = false; confirmBtn.textContent = 'Best\xe4tigen'; }
    if (resetBtn)   resetBtn.hidden = true;
    if (reveal)     reveal.hidden = true;
  } else if (state.status === 'correct') {
    if (hint) {
      hint.hidden = false;
      hint.textContent = 'Treffer! Im Toleranz-Bereich.';
    }
    if (confirmBtn) {
      confirmBtn.hidden = false;
      confirmBtn.disabled = true;
      confirmBtn.setAttribute('aria-disabled', 'true');
      confirmBtn.textContent = 'Erledigt ✓';
    }
    if (resetBtn) resetBtn.hidden = true;
    if (reveal)   reveal.hidden = !norm.reveal;
  } else if (state.status === 'revealed') {
    if (hint) {
      hint.hidden = false;
      hint.innerHTML = `Der korrekte Wert war ${_lfNsFormatValue(norm.correct, norm)}.`;
    }
    if (confirmBtn) {
      confirmBtn.hidden = false;
      confirmBtn.disabled = true;
      confirmBtn.setAttribute('aria-disabled', 'true');
      confirmBtn.textContent = 'Aufgel\xf6st';
    }
    if (resetBtn) resetBtn.hidden = true;
    if (reveal)   reveal.hidden = !norm.reveal;
  } else {
    // predict (initial)
    if (hint)       hint.hidden = true;
    if (confirmBtn) {
      confirmBtn.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.removeAttribute('aria-disabled');
      confirmBtn.textContent = 'Best\xe4tigen';
    }
    if (resetBtn)   resetBtn.hidden = true;
    if (reveal)     reveal.hidden = true;
  }
}

function _lfNsConfirm(slotId) {
  const state = _LF_NS_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'correct' || state.status === 'revealed') return;
  const norm = state.config;
  state.attempts += 1;
  state.lastGuess = state.currentValue;
  const diff = Math.abs(state.currentValue - norm.correct);
  if (diff <= norm.tolerance) {
    state.status = 'correct';
    _lfNsRefresh(slotId);
    // Pulse-Animation auf Display.
    const root = document.getElementById(slotId);
    if (root) {
      const display = root.querySelector(`#${CSS.escape(slotId)}-display`);
      if (display) {
        display.classList.add('lf-ns-pulse');
        setTimeout(() => {
          if (!root.isConnected) return;
          display.classList.remove('lf-ns-pulse');
        }, 700);
      }
    }
  } else {
    if (state.attempts >= 3) {
      // Forced Reveal.
      state.status = 'revealed';
      _lfNsRefresh(slotId);
    } else {
      state.status = 'wrong';
      _lfNsRefresh(slotId);
      // Flash auf Display + Shake.
      const root = document.getElementById(slotId);
      if (root) {
        const display = root.querySelector(`#${CSS.escape(slotId)}-display`);
        if (display) {
          display.classList.add('lf-ns-flash-wrong');
          setTimeout(() => {
            if (!root.isConnected) return;
            display.classList.remove('lf-ns-flash-wrong');
          }, 450);
        }
      }
    }
  }
}

// Globale Event-Delegation. Click + input einmalig auf document binden.
if (typeof document !== 'undefined' && !document.__lfNumberSliderBound) {
  document.__lfNumberSliderBound = true;

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const btn = target.closest('[data-ns-action]');
    if (!btn) return;
    if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) return;
    const slotId = btn.getAttribute('data-ns-slot');
    if (!slotId) return;
    const action = btn.getAttribute('data-ns-action');
    if (action === 'confirm') {
      _lfNsConfirm(slotId);
    }
    // 'reset' wird heute nicht angeboten (Spec sagt: Slider lockt bei correct/
    // revealed. Reset-Button ist hidden. Hook bleibt fuer Future.)
  });

  // Input-Event auf alle Slider mit data-ns-slot. Feuert kontinuierlich
  // waehrend Drag — wir snappen + updaten state.currentValue + Display.
  document.addEventListener('input', (ev) => {
    const target = ev.target;
    if (!target || target.tagName !== 'INPUT') return;
    if (target.type !== 'range') return;
    const slotId = target.getAttribute('data-ns-slot');
    if (!slotId) return;
    _lfNsUpdate(slotId, target.value);
  });
}

// ─── Mega-Update 2026-05-09 — Hot-Spot-Widget (MVP-4) ────────────────────────
// Schueler klickt Punkte auf einem Bild (Plakat, Karte, Diagramm).
// Use-Cases: "Klicke auf alle Schuetzengraeben", "Erdkern-Schichten",
// "Stilmittel im Text", "Mitose-Phasen". Coords sind normalisiert (0..1)
// damit responsive — egal wie gross das Bild gerendert wird.
//
// Hard-Rule #3: setup, question, alt, label, explanation, reveal sind alle
// HTML-entity-encoded vom Author. setup/question/explanation/reveal gehen
// 1:1 in innerHTML. ABER: alt-Attribut auf <img> ist plain-text — daher
// decodeHtmlEntities(alt) wie bei aria-valuetext im number-slider.
//
// State pro slot: { config, foundSpotIds: Set<spotIndex>, status }.
// Status: 'predict' | 'complete'.
//   'complete' = alle Spots gefunden, reveal blendet ein.
//
// A11y: Image hat alt-text (Fallback question). Buttons-Fallback unter dem
// Bild als sichtbare/keyboard-fokussierbare Liste — Spots werden generisch
// nummeriert ("Spot 1", "Spot 2"), nicht beim Namen, damit Aufgabe nicht
// trivialisiert wird. Status + Hint mit role=status aria-live=polite.
const _LF_HS_STATE = new Map(); // slotId -> { config, foundSpotIds: Set<int>, status, gaveUp: bool }
let _LF_HS_SLOT_SEQ = 0;

function _lfHsNextSlotId() {
  _LF_HS_SLOT_SEQ += 1;
  return `lf-hs-${Date.now().toString(36)}-${_LF_HS_SLOT_SEQ}`;
}

// Defensive Validation: image non-empty string, spots-Array mit min. 1
// Eintrag, jeder Spot mit valider x∈[0,1], y∈[0,1], r∈(0,1] (default→tolerance),
// label string. tolerance default 0.04. Invalide Spots werden uebersprungen;
// wenn am Ende < 1 valid → Config invalid (null returned).
function _lfHsNormalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const image = typeof rawConfig.image === 'string' ? rawConfig.image.trim() : '';
  if (!image) return null;

  let tolerance = Number(rawConfig.tolerance);
  if (!isFinite(tolerance) || tolerance <= 0 || tolerance > 0.5) tolerance = 0.04;

  const rawSpots = Array.isArray(rawConfig.spots) ? rawConfig.spots : [];
  const spots = [];
  for (let i = 0; i < rawSpots.length; i++) {
    const s = rawSpots[i];
    if (!s || typeof s !== 'object') continue;
    const x = Number(s.x);
    const y = Number(s.y);
    if (!isFinite(x) || x < 0 || x > 1) continue;
    if (!isFinite(y) || y < 0 || y > 1) continue;
    let r = Number(s.r);
    if (!isFinite(r) || r <= 0 || r > 1) r = tolerance;
    const label = typeof s.label === 'string' ? s.label : `Spot ${i + 1}`;
    const explanation = typeof s.explanation === 'string' ? s.explanation : '';
    spots.push({ x, y, r, label, explanation });
  }
  if (spots.length < 1) return null;

  const setup    = typeof rawConfig.setup    === 'string' ? rawConfig.setup    : '';
  const question = typeof rawConfig.question === 'string' ? rawConfig.question : '';
  const alt      = typeof rawConfig.alt      === 'string' ? rawConfig.alt      : '';
  const reveal   = typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : '';

  // alt-Fallback wenn leer: question (decoded) oder generisch.
  let altPlain;
  if (alt) {
    altPlain = decodeHtmlEntities(alt);
  } else if (question) {
    altPlain = decodeHtmlEntities(question);
    try { console.warn('[LF/hot-spot] config.alt missing — falling back to question for alt-text. Author should provide explicit alt.'); } catch(e) {}
  } else {
    altPlain = 'Aufgabenbild';
    try { console.warn('[LF/hot-spot] config.alt + config.question both missing — using generic alt. Please supply alt for accessibility.'); } catch(e) {}
  }

  return {
    setup, question, image,
    alt:      altPlain,
    spots,
    tolerance,
    reveal
  };
}

function _renderHotSpot(config, slotId) {
  const norm = _lfHsNormalizeConfig(config);
  if (!norm) {
    return `<div class="lf-widget-hot-spot lf-hs-empty" data-hs-slot="${escapeAttr(slotId)}">`
         + `Diese Aufgabe ist noch nicht fertig konfiguriert.</div>`;
  }
  const initialState = {
    config:       norm,
    foundSpotIds: new Set(),
    status:       'predict', // 'predict' | 'complete'
    gaveUp:       false
  };
  _LF_HS_STATE.set(slotId, initialState);

  const setupHtml    = norm.setup    ? `<div class="lf-hs-setup">${norm.setup}</div>` : '';
  const questionHtml = norm.question ? `<h4 class="lf-hs-question">${norm.question}</h4>` : '';

  // Buttons-Fallback unter dem Bild: jeder Spot bekommt einen Button "Spot N",
  // generisch nummeriert (kein Label-Spoiler).
  const spotButtonsHtml = norm.spots.map((_s, i) =>
    `<button type="button" class="lf-hs-spot-btn" `
    + `data-hs-action="click-spot-button" data-hs-slot="${escapeAttr(slotId)}" `
    + `data-hs-spot-index="${i}" `
    + `aria-label="Spot ${i + 1} ausw\xe4hlen">Spot ${i + 1}</button>`
  ).join('');

  const revealHtml = norm.reveal
    ? `<div class="lf-hs-reveal" id="${escapeAttr(slotId)}-reveal" hidden>`
    +    `<div class="lf-hs-reveal-heading">Erkl\xe4rung</div>`
    +    `<div class="lf-hs-reveal-body">${norm.reveal}</div>`
    + `</div>`
    : '';

  return `<div class="lf-widget-hot-spot lf-hs-state-predict" `
       +   `id="${escapeAttr(slotId)}" data-hs-slot="${escapeAttr(slotId)}">`
       +   setupHtml
       +   questionHtml
       +   `<figure class="lf-hs-figure">`
       +     `<img class="lf-hs-image" `
       +       `src="${escapeAttr(norm.image)}" `
       +       `alt="${escapeAttr(norm.alt)}" `
       +       `loading="lazy" `
       +       `data-hs-action="click-image" data-hs-slot="${escapeAttr(slotId)}" `
       +       `draggable="false">`
       +     `<div class="lf-hs-overlay" id="${escapeAttr(slotId)}-overlay" aria-hidden="true"></div>`
       +   `</figure>`
       +   `<div class="lf-hs-status" id="${escapeAttr(slotId)}-status" role="status" aria-live="polite">`
       +     `0 von ${norm.spots.length} gefunden`
       +   `</div>`
       +   `<div class="lf-hs-hint" id="${escapeAttr(slotId)}-hint" role="status" aria-live="polite" hidden></div>`
       +   `<div class="lf-hs-spot-buttons" aria-label="Spot-Auswahl per Tastatur">${spotButtonsHtml}</div>`
       +   `<div class="lf-hs-actions">`
       +     `<button type="button" class="lf-hs-give-up" `
       +       `data-hs-action="give-up" data-hs-slot="${escapeAttr(slotId)}">L\xf6sung anzeigen</button>`
       +   `</div>`
       +   revealHtml
       + `</div>`;
}

// Re-Render der Overlay-Marker + Status + Buttons + Reveal.
// Bild selbst wird NICHT neu gerendert (sonst lade-Flicker / Layout-Shift).
function _lfHsRefresh(slotId) {
  const state = _LF_HS_STATE.get(slotId);
  if (!state) return;
  const root = document.getElementById(slotId);
  if (!root) return;
  const norm = state.config;

  const overlay  = root.querySelector(`#${CSS.escape(slotId)}-overlay`);
  const statusEl = root.querySelector(`#${CSS.escape(slotId)}-status`);
  const hint     = root.querySelector(`#${CSS.escape(slotId)}-hint`);
  const reveal   = root.querySelector(`#${CSS.escape(slotId)}-reveal`);
  const giveUp   = root.querySelector('.lf-hs-give-up');

  // State-Klassen
  root.classList.toggle('lf-hs-state-predict',  state.status === 'predict');
  root.classList.toggle('lf-hs-state-complete', state.status === 'complete');
  // Dataset-Flag für CSS (z.B. cursor nach Give-Up zurücksetzen).
  root.dataset.hsGaveup = state.gaveUp ? 'true' : 'false';

  // Overlay-Marker neu aufbauen. Hit-Marker fuer found, faded-Marker fuer
  // not-found wenn gaveUp.
  if (overlay) {
    let markersHtml = '';
    for (let i = 0; i < norm.spots.length; i++) {
      const s = norm.spots[i];
      const found = state.foundSpotIds.has(i);
      if (found) {
        // Treffer-Marker mit Tooltip (label + optional explanation).
        // label/explanation sind HTML-entity-encoded → 1:1 in innerHTML (Hard-Rule #3).
        const tooltipBody = s.explanation
          ? `<span class="lf-hs-tooltip-label">${s.label}</span><span class="lf-hs-tooltip-explanation">${s.explanation}</span>`
          : `<span class="lf-hs-tooltip-label">${s.label}</span>`;
        markersHtml += `<span class="lf-hs-marker" `
          + `style="left: ${(s.x * 100).toFixed(2)}%; top: ${(s.y * 100).toFixed(2)}%;">`
          + `<span class="lf-hs-marker-check" aria-hidden="true">✓</span>`
          + `<span class="lf-hs-tooltip">${tooltipBody}</span>`
          + `</span>`;
      } else if (state.gaveUp) {
        // Faded marker (Lösung-anzeigen-Modus): zeigt verbleibende Spots.
        markersHtml += `<span class="lf-hs-marker lf-hs-marker-faded" `
          + `style="left: ${(s.x * 100).toFixed(2)}%; top: ${(s.y * 100).toFixed(2)}%;">`
          + `<span class="lf-hs-marker-dot" aria-hidden="true"></span>`
          + `<span class="lf-hs-tooltip"><span class="lf-hs-tooltip-label">${s.label}</span></span>`
          + `</span>`;
      }
    }
    overlay.innerHTML = markersHtml;
  }

  // Status-Zeile
  if (statusEl) {
    const found = state.foundSpotIds.size;
    const total = norm.spots.length;
    if (state.status === 'complete') {
      statusEl.textContent = `Alle ${total} Spots gefunden ✓`;
    } else if (state.gaveUp) {
      statusEl.textContent = `${found} von ${total} gefunden — restliche Spots werden angezeigt.`;
    } else {
      statusEl.textContent = `${found} von ${total} gefunden`;
    }
  }

  // Spot-Buttons: aria-disabled wenn schon found oder complete oder gaveUp.
  const spotButtons = root.querySelectorAll('.lf-hs-spot-btn');
  spotButtons.forEach(btn => {
    const idx = parseInt(btn.getAttribute('data-hs-spot-index'), 10);
    const isFound = state.foundSpotIds.has(idx);
    const lock = isFound || state.status === 'complete' || state.gaveUp;
    btn.disabled = lock;
    if (lock) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
    btn.classList.toggle('lf-hs-spot-btn-found', isFound);
    // aria-label spiegelt den State (found / gaveUp / predict) für Screen-Reader.
    btn.setAttribute('aria-label',
      isFound       ? `Spot ${idx + 1}, gefunden`
      : state.gaveUp ? `Spot ${idx + 1}, L\xf6sung wurde angezeigt`
      :                `Spot ${idx + 1} ausw\xe4hlen`);
  });

  // Give-up-Button: ausblenden wenn complete oder bereits gaveUp.
  if (giveUp) {
    if (state.status === 'complete' || state.gaveUp) {
      giveUp.hidden = true;
    } else {
      giveUp.hidden = false;
    }
  }

  // Hint + Reveal je nach Status.
  if (state.status === 'complete') {
    if (hint) hint.hidden = true;
    if (reveal) reveal.hidden = !norm.reveal;
  } else {
    // hint wird transient gesetzt von Click-Handler (z.B. bei Falsch-Klick),
    // aber bei state-changes ohne hint-event clearen.
    if (reveal) reveal.hidden = true;
  }
}

// Click-Image: x/y in normalized coords, finde naechsten Spot, vergleich r.
// Wenn Treffer → addToFoundSpots; sonst Falsch-Klick-Ripple.
function _lfHsHandleImageClick(slotId, img, clientX, clientY) {
  const state = _LF_HS_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'complete') return;
  if (state.gaveUp) return;
  const norm = state.config;

  const rect = img.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return; // Image not yet rendered.
  const nx = (clientX - rect.left) / rect.width;
  const ny = (clientY - rect.top) / rect.height;
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

  // Find best (closest) matching spot within its r.
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = 0; i < norm.spots.length; i++) {
    if (state.foundSpotIds.has(i)) continue; // schon found → ignorieren
    const s = norm.spots[i];
    const dx = s.x - nx;
    const dy = s.y - ny;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const r = (typeof s.r === 'number' && s.r > 0) ? s.r : norm.tolerance;
    if (dist <= r && dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    _lfHsHit(slotId, bestIdx);
  } else {
    _lfHsMiss(slotId, nx, ny);
  }
}

function _lfHsHit(slotId, spotIdx) {
  const state = _LF_HS_STATE.get(slotId);
  if (!state) return;
  state.foundSpotIds.add(spotIdx);
  const total = state.config.spots.length;
  if (state.foundSpotIds.size >= total) {
    state.status = 'complete';
  }
  // Hint clearen — User hat gerade Treffer gemacht.
  const root = document.getElementById(slotId);
  if (root) {
    const hint = root.querySelector(`#${CSS.escape(slotId)}-hint`);
    if (hint) { hint.hidden = true; hint.textContent = ''; }
  }
  _lfHsRefresh(slotId);
  // Pulse-Animation auf allen Markern bei complete.
  if (state.status === 'complete' && root) {
    root.querySelectorAll('.lf-hs-marker').forEach(el => el.classList.add('lf-hs-pulse'));
    setTimeout(() => {
      if (!root.isConnected) return;
      root.querySelectorAll('.lf-hs-marker').forEach(el => el.classList.remove('lf-hs-pulse'));
    }, 700);
  }
}

function _lfHsMiss(slotId, nx, ny) {
  const state = _LF_HS_STATE.get(slotId);
  if (!state) return;
  const root = document.getElementById(slotId);
  if (!root) return;
  // Ripple-Effekt am Klick-Point. Position relativ zum overlay.
  const overlay = root.querySelector(`#${CSS.escape(slotId)}-overlay`);
  if (overlay) {
    const ripple = document.createElement('span');
    ripple.className = 'lf-hs-ripple';
    ripple.style.left = (nx * 100).toFixed(2) + '%';
    ripple.style.top  = (ny * 100).toFixed(2) + '%';
    overlay.appendChild(ripple);
    setTimeout(() => {
      if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
    }, 600);
  }
  // Hint
  const hint = root.querySelector(`#${CSS.escape(slotId)}-hint`);
  if (hint) {
    hint.hidden = false;
    hint.textContent = 'Versuche es nochmal — das war daneben.';
  }
}

// Spot-Button-Click (a11y-Fallback): toggles found-state des Spots direkt
// (kein Treffer-Test, weil der Button generisch nummeriert ist und der
// User per Tastatur "diesen Spot meine ich" sagt). Generisch nummerierte
// Buttons sind nicht spoiler-frei vom Index aber das Label haben sie
// nicht — User muesste an der Position raten. Pragmatisch: das ist der
// a11y-Pfad fuer Keyboard-/Screenreader-User; sie waeren sonst ganz
// ausgeschlossen vom Bild-Click. Akzeptabel.
function _lfHsClickSpotButton(slotId, spotIdx) {
  const state = _LF_HS_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'complete' || state.gaveUp) return;
  if (state.foundSpotIds.has(spotIdx)) return;
  if (spotIdx < 0 || spotIdx >= state.config.spots.length) return;
  _lfHsHit(slotId, spotIdx);
}

// Give-up: alle nicht-gefundenen Spots als faded marker einblenden, reveal
// einblenden, Status auf "X von Y gefunden — restliche werden angezeigt".
// Status bleibt 'predict' (nicht 'complete', weil User nicht alle selbst
// gefunden hat) — gaveUp-flag steuert UI.
function _lfHsGiveUp(slotId) {
  const state = _LF_HS_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'complete' || state.gaveUp) return;
  state.gaveUp = true;
  // Hint clearen.
  const root = document.getElementById(slotId);
  if (root) {
    const hint = root.querySelector(`#${CSS.escape(slotId)}-hint`);
    if (hint) { hint.hidden = true; hint.textContent = ''; }
  }
  _lfHsRefresh(slotId);
  // Reveal nach gaveUp einblenden (manuell, weil _lfHsRefresh nur bei
  // status==='complete' reveal sichtbar macht).
  if (root) {
    const reveal = root.querySelector(`#${CSS.escape(slotId)}-reveal`);
    if (reveal && state.config.reveal) reveal.hidden = false;
  }
}

// Globale Click-Delegation. Einmalig auf document binden.
if (typeof document !== 'undefined' && !document.__lfHotSpotBound) {
  document.__lfHotSpotBound = true;

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const el = target.closest('[data-hs-action]');
    if (!el) return;
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return;
    const slotId = el.getAttribute('data-hs-slot');
    if (!slotId) return;
    const action = el.getAttribute('data-hs-action');
    if (action === 'click-image') {
      // el ist das <img>. clientX/Y kommen von ev.
      _lfHsHandleImageClick(slotId, el, ev.clientX, ev.clientY);
    } else if (action === 'click-spot-button') {
      const idxStr = el.getAttribute('data-hs-spot-index');
      const idx = parseInt(idxStr, 10);
      if (isFinite(idx)) _lfHsClickSpotButton(slotId, idx);
    } else if (action === 'give-up') {
      _lfHsGiveUp(slotId);
    }
  });
}

// ─── Mega-Update 2026-05-09 — Fill-Blanks-Widget ────────────────────────────
// Cloze-Text mit Inputs an Stelle der {{key}}-Placeholder. User tippt, druckt
// "Pruefen", jeder Blank wird grun (correct, locked) oder rot (shake, mit
// optionalem Hint-?-Icon). Wenn alles korrekt → reveal.
//
// State-Lifecycle:
//   'predict'  = User tippt, noch nicht geprueft.
//   'wrong'    = mind. ein Blank hat falsche/leere Antwort, "Nochmal" Button da.
//   'correct'  = alle Blanks korrekt, Pulse + Reveal blendet ein, Button locked.
//
// Text-Parsing-Strategie: Split text bei /\{\{([a-zA-Z0-9_]+)\}\}/g, alterniere
// Text-Spans (innerHTML mit entity-decoded content) + <input>-Elemente. Das
// vermeidet HTML-Tag-Zerschneiden, weil split die Tags niemals teilt — ein
// vom Author korrekt geschriebener {{key}} faellt immer ausserhalb von Tag-
// Grenzen (Author-Konvention; anders koennte text != HTML sein).
const _LF_FB_STATE = new Map(); // slotId -> { config, status, lockedBlanks: Set<`${key}#${blankIdx}`> }
let _LF_FB_SLOT_SEQ = 0;

function _lfFbNextSlotId() {
  _LF_FB_SLOT_SEQ += 1;
  return `lf-fb-${Date.now().toString(36)}-${_LF_FB_SLOT_SEQ}`;
}

// Defensive Validation:
//   text non-empty, blanks ist object mit ≥1 keys.
//   Jeder blank hat answers Array mit ≥1 nicht-leerem string.
//   Jeder Placeholder im text muss in blanks definiert sein (sonst rendert er
//   als leerer Slot — wir warnen + skippen den Slot).
//   Jeder blank-key muss im text vorkommen (Warnung; harmlos, Blank wird nie
//   gerendert).
function _lfFbNormalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const text = typeof rawConfig.text === 'string' ? rawConfig.text : '';
  if (!text.trim()) return null;
  const rawBlanks = (rawConfig.blanks && typeof rawConfig.blanks === 'object' && !Array.isArray(rawConfig.blanks))
    ? rawConfig.blanks
    : null;
  if (!rawBlanks) return null;
  const keys = Object.keys(rawBlanks);
  if (keys.length < 1) return null;

  // Welche Placeholder erscheinen im text?
  const placeholderRe = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  const placeholdersInText = new Set();
  let m;
  while ((m = placeholderRe.exec(text)) !== null) {
    placeholdersInText.add(m[1]);
  }

  // Blanks-Object normalisieren — pro Key: answers (≥1 non-leer string), case,
  // trim, width, hint.
  const blanks = {};
  for (const key of keys) {
    const b = rawBlanks[key];
    if (!b || typeof b !== 'object') continue;
    const ansRaw = Array.isArray(b.answers) ? b.answers : [];
    const answers = [];
    for (const a of ansRaw) {
      if (typeof a === 'string' && a.length > 0) answers.push(a);
    }
    if (answers.length < 1) continue; // skip — kann nicht validieren
    if (!placeholdersInText.has(key)) {
      try { console.warn(`[LF/fill-blanks] blank key "${key}" not found in text — will never render.`); } catch(e) {}
    }
    blanks[key] = {
      answers,
      caseSensitive: !!b.caseSensitive,
      trim:          b.trim !== false, // default true
      width:         (typeof b.width === 'number' && isFinite(b.width) && b.width > 0) ? Math.floor(b.width) : null,
      hint:          typeof b.hint === 'string' ? b.hint : ''
    };
  }
  if (Object.keys(blanks).length < 1) return null;

  // Warne fuer text-Placeholder ohne blank-Definition (wird als leerer Slot
  // geskippt beim Render).
  for (const ph of placeholdersInText) {
    if (!blanks[ph]) {
      try { console.warn(`[LF/fill-blanks] placeholder "{{${ph}}}" in text without blank-definition — will be skipped.`); } catch(e) {}
    }
  }

  const setup    = typeof rawConfig.setup    === 'string' ? rawConfig.setup    : '';
  const question = typeof rawConfig.question === 'string' ? rawConfig.question : '';
  const reveal   = typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : '';

  return { setup, question, text, blanks, reveal };
}

// User-Input vs answers vergleichen. Beide werden je nach trim/case
// normalisiert; Match wenn ANY answer identisch.
function _lfFbAnswerMatches(userInput, blank) {
  if (typeof userInput !== 'string') return false;
  let u = userInput;
  if (blank.trim) u = u.trim();
  if (!blank.caseSensitive) u = u.toLowerCase();
  if (u.length === 0) return false;
  for (const a of blank.answers) {
    let cmp = a;
    if (blank.trim) cmp = cmp.trim();
    if (!blank.caseSensitive) cmp = cmp.toLowerCase();
    if (u === cmp) return true;
  }
  return false;
}

function _renderFillBlanks(config, slotId) {
  const norm = _lfFbNormalizeConfig(config);
  if (!norm) {
    return `<div class="lf-widget-fill-blanks lf-fb-empty" data-fb-slot="${escapeAttr(slotId)}">`
         + `Diese Aufgabe ist noch nicht fertig konfiguriert.</div>`;
  }
  const initialState = {
    config:        norm,
    status:        'predict', // 'predict' | 'wrong' | 'correct'
    lockedBlanks:  new Set()
  };
  _LF_FB_STATE.set(slotId, initialState);

  const setupHtml    = norm.setup    ? `<div class="lf-fb-setup">${norm.setup}</div>` : '';
  const questionHtml = norm.question ? `<h4 class="lf-fb-question">${norm.question}</h4>` : '';

  // Text-Parser: split bei {{key}}, alterniere text-fragments (innerHTML mit
  // entities) + inputs.
  const re = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  let lastIdx = 0;
  let blankIdx = 0;
  let textHtml = '';
  let m;
  while ((m = re.exec(norm.text)) !== null) {
    const before = norm.text.slice(lastIdx, m.index);
    if (before) {
      // HTML-entity-encoded Text-Fragment → 1:1 in innerHTML (Hard-Rule #3).
      textHtml += `<span class="lf-fb-text-frag">${before}</span>`;
    }
    const key = m[1];
    const blank = norm.blanks[key];
    if (blank) {
      blankIdx += 1;
      const widthAttr = blank.width ? ` size="${escapeAttr(String(blank.width))}"` : '';
      const ariaLabel = `L\xfccke ${blankIdx} (${key})`;
      const hintBtn = blank.hint
        ? `<button type="button" class="lf-fb-hint-trigger" `
          + `data-fb-action="toggle-hint" data-fb-slot="${escapeAttr(slotId)}" `
          + `data-fb-blank="${escapeAttr(key)}" `
          + `data-fb-blank-idx="${blankIdx}" `
          + `aria-label="Hinweis f\xfcr L\xfccke ${blankIdx}" hidden>?</button>`
        : '';
      const hintTooltip = blank.hint
        ? `<span class="lf-fb-hint-tooltip" id="${escapeAttr(slotId)}-hint-${escapeAttr(key)}-${blankIdx}" role="status" aria-live="polite" hidden>${blank.hint}</span>`
        : '';
      textHtml += `<span class="lf-fb-blank-wrap">`
        + `<input type="text" class="lf-fb-blank" `
        + `data-fb-blank="${escapeAttr(key)}" data-fb-slot="${escapeAttr(slotId)}" `
        + `data-fb-blank-idx="${blankIdx}" `
        + `aria-label="${escapeAttr(ariaLabel)}" `
        + `autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"`
        + `${widthAttr}>`
        + hintBtn
        + hintTooltip
        + `</span>`;
    } else {
      // Placeholder ohne blank-Def → skip (Warnung schon in Normalize).
    }
    lastIdx = re.lastIndex;
  }
  const tail = norm.text.slice(lastIdx);
  if (tail) {
    textHtml += `<span class="lf-fb-text-frag">${tail}</span>`;
  }

  const revealHtml = norm.reveal
    ? `<div class="lf-fb-reveal" id="${escapeAttr(slotId)}-reveal" hidden>`
    +    `<div class="lf-fb-reveal-heading">Erkl\xe4rung</div>`
    +    `<div class="lf-fb-reveal-body">${norm.reveal}</div>`
    + `</div>`
    : '';

  return `<div class="lf-widget-fill-blanks lf-fb-state-predict" `
       +   `id="${escapeAttr(slotId)}" data-fb-slot="${escapeAttr(slotId)}">`
       +   setupHtml
       +   questionHtml
       +   `<div class="lf-fb-text">${textHtml}</div>`
       +   `<div class="lf-fb-status" id="${escapeAttr(slotId)}-status" role="status" aria-live="polite"></div>`
       +   `<div class="lf-fb-actions">`
       +     `<button type="button" class="lf-fb-check" `
       +       `data-fb-action="check" data-fb-slot="${escapeAttr(slotId)}">Pr\xfcfen</button>`
       +     `<button type="button" class="lf-fb-retry" `
       +       `data-fb-action="retry" data-fb-slot="${escapeAttr(slotId)}" hidden>Nochmal versuchen</button>`
       +   `</div>`
       +   revealHtml
       + `</div>`;
}

// Refresh: aria-label + classes + locked + hint-trigger sichtbarkeit + status +
// reveal + buttons. Inputs werden NICHT neu gerendert (sonst verliert User
// Cursor-Position waehrend des Tippens).
function _lfFbRefresh(slotId) {
  const state = _LF_FB_STATE.get(slotId);
  if (!state) return;
  const root = document.getElementById(slotId);
  if (!root) return;
  const norm = state.config;

  root.classList.toggle('lf-fb-state-predict', state.status === 'predict');
  root.classList.toggle('lf-fb-state-wrong',   state.status === 'wrong');
  root.classList.toggle('lf-fb-state-correct', state.status === 'correct');

  const checkBtn  = root.querySelector('.lf-fb-check');
  const retryBtn  = root.querySelector('.lf-fb-retry');
  const statusEl  = root.querySelector(`#${CSS.escape(slotId)}-status`);
  const revealEl  = root.querySelector(`#${CSS.escape(slotId)}-reveal`);

  // Inputs durchgehen.
  const inputs = root.querySelectorAll('input.lf-fb-blank');
  let totalBlanks = 0;
  let correctCount = 0;
  inputs.forEach(inp => {
    const key = inp.getAttribute('data-fb-blank');
    if (!key || !norm.blanks[key]) return;
    totalBlanks += 1;
    const blankIdx = inp.getAttribute('data-fb-blank-idx') || '';
    const isLocked = state.lockedBlanks.has(`${key}#${blankIdx}`);
    if (isLocked) {
      correctCount += 1;
      inp.classList.add('lf-fb-correct');
      inp.classList.remove('lf-fb-wrong');
      inp.readOnly = true;
      inp.setAttribute('aria-invalid', 'false');
      const ariaIdx = parseInt(blankIdx, 10) || '?';
      inp.setAttribute('aria-label', `L\xfccke ${ariaIdx} (${key}), korrekt`);
    } else {
      inp.readOnly = false;
      // wrong-class wird vom Check-Handler gesetzt; bei retry hier zurueckgesetzt.
      // status==='predict' = nichts overlay; 'wrong' lassen wir wrong-class aus
      // dem Check-Aufruf stehen.
    }
  });

  // Hint-Trigger: nur sichtbar wenn der zugehoerige Blank (per blankIdx,
  // da {{key}} mehrfach im Text vorkommen darf — pro occurrence eigener
  // Status) wrong-Klasse hat. Der Input liegt im selben .lf-fb-blank-wrap
  // wie der Trigger — robuster als data-attr-Lookup.
  const hintTriggers = root.querySelectorAll('.lf-fb-hint-trigger');
  hintTriggers.forEach(btn => {
    const key = btn.getAttribute('data-fb-blank');
    const blankIdxAttr = btn.getAttribute('data-fb-blank-idx') || '';
    const wrap = btn.closest('.lf-fb-blank-wrap');
    const inp = wrap ? wrap.querySelector('input.lf-fb-blank') : null;
    if (inp && inp.classList.contains('lf-fb-wrong')) {
      btn.hidden = false;
    } else {
      btn.hidden = true;
      // Tooltip auch zu klappen — id enthaelt jetzt blankIdx-Suffix.
      const tip = root.querySelector(`#${CSS.escape(slotId)}-hint-${CSS.escape(key || '')}-${CSS.escape(blankIdxAttr)}`);
      if (tip) tip.hidden = true;
    }
  });

  // Status-Zeile.
  if (statusEl) {
    if (state.status === 'correct') {
      statusEl.textContent = `Alle ${totalBlanks} L\xfccken richtig ✓`;
    } else if (state.status === 'wrong') {
      const wrong = totalBlanks - correctCount;
      statusEl.textContent = `${correctCount} von ${totalBlanks} richtig — ${wrong} ${wrong === 1 ? 'L\xfccke' : 'L\xfccken'} noch falsch.`;
    } else {
      statusEl.textContent = '';
    }
  }

  // Buttons.
  if (checkBtn) {
    if (state.status === 'correct') {
      checkBtn.disabled = true;
      checkBtn.textContent = 'Erledigt ✓';
    } else {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Pr\xfcfen';
    }
  }
  if (retryBtn) {
    retryBtn.hidden = state.status !== 'wrong';
  }

  // Reveal.
  if (revealEl) {
    revealEl.hidden = !(state.status === 'correct' && norm.reveal);
  }
}

// Pruefen aller Blanks. Pro blank: read input value, vergleiche, mark
// correct/wrong. Wenn alle correct → status='correct' + pulse.
function _lfFbCheck(slotId) {
  const state = _LF_FB_STATE.get(slotId);
  if (!state) return;
  if (state.status === 'correct') return;
  const root = document.getElementById(slotId);
  if (!root) return;
  const norm = state.config;

  const inputs = root.querySelectorAll('input.lf-fb-blank');
  let total = 0;
  let correct = 0;
  inputs.forEach(inp => {
    const key = inp.getAttribute('data-fb-blank');
    if (!key || !norm.blanks[key]) return;
    total += 1;
    const blankIdx = inp.getAttribute('data-fb-blank-idx') || '';
    const lockKey = `${key}#${blankIdx}`;
    if (state.lockedBlanks.has(lockKey)) {
      correct += 1;
      return;
    }
    const blank = norm.blanks[key];
    const userVal = inp.value;
    if (_lfFbAnswerMatches(userVal, blank)) {
      // Korrekt — locken (per occurrence, nicht per key).
      state.lockedBlanks.add(lockKey);
      correct += 1;
      inp.classList.remove('lf-fb-wrong');
      inp.classList.add('lf-fb-correct');
      inp.setAttribute('aria-invalid', 'false');
    } else {
      // Falsch — wrong-class + shake.
      inp.classList.remove('lf-fb-correct');
      inp.classList.add('lf-fb-wrong');
      inp.setAttribute('aria-invalid', 'true');
      // Shake — restart-fix: animation toggle.
      inp.classList.remove('lf-fb-shake');
      // reflow erzwingen (offsetWidth-Read), damit re-add die Animation neu startet.
      void inp.offsetWidth;
      inp.classList.add('lf-fb-shake');
      setTimeout(() => {
        if (inp.isConnected) inp.classList.remove('lf-fb-shake');
      }, 500);
    }
  });

  if (correct >= total) {
    state.status = 'correct';
  } else {
    state.status = 'wrong';
  }
  _lfFbRefresh(slotId);

  // Pulse on complete.
  if (state.status === 'correct' && root) {
    root.querySelectorAll('input.lf-fb-blank.lf-fb-correct').forEach(el => el.classList.add('lf-fb-pulse'));
    setTimeout(() => {
      if (!root.isConnected) return;
      root.querySelectorAll('input.lf-fb-blank').forEach(el => el.classList.remove('lf-fb-pulse'));
    }, 700);
  }
}

// Retry: status zurueck auf 'predict'. Wrong-classes von allen NICHT-locked
// inputs entfernen — User-Werte bleiben drin (er soll korrigieren). Locked
// (correct) bleiben locked.
function _lfFbRetry(slotId) {
  const state = _LF_FB_STATE.get(slotId);
  if (!state) return;
  if (state.status !== 'wrong') return;
  const root = document.getElementById(slotId);
  if (!root) return;

  state.status = 'predict';
  const inputs = root.querySelectorAll('input.lf-fb-blank');
  inputs.forEach(inp => {
    const key = inp.getAttribute('data-fb-blank');
    if (!key) return;
    const blankIdx = inp.getAttribute('data-fb-blank-idx') || '';
    if (state.lockedBlanks.has(`${key}#${blankIdx}`)) return;
    inp.classList.remove('lf-fb-wrong');
    inp.classList.remove('lf-fb-shake');
    inp.removeAttribute('aria-invalid');
  });
  _lfFbRefresh(slotId);
  // Focus auf ersten falschen blank.
  const firstWrong = root.querySelector('input.lf-fb-blank:not(.lf-fb-correct):not([readonly])');
  if (firstWrong) {
    try { firstWrong.focus(); } catch(e) {}
  }
}

function _lfFbToggleHint(slotId, key, blankIdx) {
  const state = _LF_FB_STATE.get(slotId);
  if (!state) return;
  const root = document.getElementById(slotId);
  if (!root) return;
  // blankIdx-Suffix damit {{key}} mehrfach im Text eindeutige Tooltip-IDs hat.
  const idxStr = String(blankIdx == null ? '' : blankIdx);
  const tip = root.querySelector(`#${CSS.escape(slotId)}-hint-${CSS.escape(key)}-${CSS.escape(idxStr)}`);
  if (!tip) return;
  tip.hidden = !tip.hidden;
}

// Globale Click-Delegation. Einmalig auf document binden.
if (typeof document !== 'undefined' && !document.__lfFillBlanksBound) {
  document.__lfFillBlanksBound = true;

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!target || !target.closest) return;
    const el = target.closest('[data-fb-action]');
    if (!el) return;
    if (el.disabled) return;
    const slotId = el.getAttribute('data-fb-slot');
    if (!slotId) return;
    const action = el.getAttribute('data-fb-action');
    if (action === 'check') {
      _lfFbCheck(slotId);
    } else if (action === 'retry') {
      _lfFbRetry(slotId);
    } else if (action === 'toggle-hint') {
      const key = el.getAttribute('data-fb-blank');
      const blankIdx = el.getAttribute('data-fb-blank-idx');
      if (key) _lfFbToggleHint(slotId, key, blankIdx);
    }
  });

  // Enter im Input → check ausloesen (wie wenn der Pruefen-Button geklickt wuerde).
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    const target = ev.target;
    if (!target || !target.classList || !target.classList.contains('lf-fb-blank')) return;
    const slotId = target.getAttribute('data-fb-slot');
    if (!slotId) return;
    ev.preventDefault();
    _lfFbCheck(slotId);
  });
}

// Block-Renderer. Switch auf block.type. Phase-1: text + formula-pending +
// image + code (kein Highlight) + widget-pending. Hard-Rule #3: text/code-
// content ist HTML-entity-encoded und geht 1:1 ins innerHTML — kein
// escapeHtml() darauf, das wuerde Entities doppelt-encoden.
//   Ausnahme: code-content wird *doch* escaped, weil dort meist Roh-Quelltext
//   mit `<` / `>` steht (kein Entity-encoded-Lesetext). Same call rendert
//   `<` als `&lt;` korrekt im <pre><code>.
function renderBlock(block) {
  if (!block || typeof block !== 'object') return '';
  const type = block.type;

  if (type === 'text') {
    // HTML-entity-encoded content direkt in innerHTML (Hard-Rule #3).
    return `<div class="lf-block lf-block-text">${block.content || ''}</div>`;
  }

  if (type === 'formula') {
    // Phase-2: KaTeX-Integration. Phase-1 zeigt LaTeX-Source als Code-Tag.
    return `<code class="lf-formula-pending">${escapeHtml(block.latex || '')}</code>`;
  }

  if (type === 'image') {
    const src = escapeAttr(block.src || '');
    // F-07 (Casey): Wenn alt leer, aber caption vorhanden → caption als alt
    // verwenden. Dezenter Authoring-Hinweis in der Console wenn beides fehlt.
    // Cycle-2-Ramsey P2-2: caption ist per Hard-Rule #3 HTML-entity-encoded
    // ("&bdquo;X&ldquo;"). Als figcaption-innerHTML ist das korrekt, aber als
    // alt-Attribut wuerde escapeAttr die Entities doppelt-encoden und
    // Screenreader laesen "ampersand b-d-quo". Daher: caption-Fallback
    // einmal entity-decoden (alt darf umlauts/Smart-Quotes natively halten).
    let altText = block.alt || '';
    if (!altText && block.caption) {
      altText = decodeHtmlEntities(block.caption);
    }
    if (!block.alt && !block.caption) {
      try { console.warn('[LF/image-block] image without alt+caption — please supply at least one for accessibility.', block); } catch(e) {}
    }
    const alt = escapeAttr(altText);
    const caption = block.caption
      ? `<figcaption>${escapeHtml(block.caption)}</figcaption>`
      : '';
    return `<figure class="lf-image-block"><img src="${src}" alt="${alt}">${caption}</figure>`;
  }

  if (type === 'code') {
    // Phase-2: Syntax-Highlighting (z.B. Prism). Phase-1 = plain <pre><code>.
    // Code-Content ist Roh-Quelltext, daher escapeHtml (vs. text-block).
    const lang = escapeAttr(block.lang || '');
    return `<pre class="lf-code-block" data-lang="${lang}"><code>${escapeHtml(block.content || '')}</code></pre>`;
  }

  if (type === 'widget') {
    const wt = block.widgetType || 'unknown';
    // Cycle 8: predict-reveal ist jetzt echt implementiert — kein Pending mehr.
    if (wt === 'predict-reveal') {
      return _renderPredictReveal(block.config || {}, _lfPrNextSlotId());
    }
    // Mega-Update 2026-05-09: drag-sort live.
    if (wt === 'drag-sort') {
      return _renderDragSort(block.config || {}, _lfDsNextSlotId());
    }
    // Mega-Update 2026-05-09: drag-match live.
    if (wt === 'drag-match') {
      return _renderDragMatch(block.config || {}, _lfDmNextSlotId());
    }
    // Mega-Update 2026-05-09: number-slider live.
    if (wt === 'number-slider') {
      return _renderNumberSlider(block.config || {}, _lfNsNextSlotId());
    }
    // Mega-Update 2026-05-09: hot-spot live.
    if (wt === 'hot-spot') {
      return _renderHotSpot(block.config || {}, _lfHsNextSlotId());
    }
    // Mega-Update 2026-05-09: fill-blanks live.
    if (wt === 'fill-blanks') {
      return _renderFillBlanks(block.config || {}, _lfFbNextSlotId());
    }
    if (_LF_WIDGET_WHITELIST.has(wt) && !_LF_WIDGET_TOAST_FIRED.has(wt)) {
      _LF_WIDGET_TOAST_FIRED.add(wt);
      // showToast existiert ist erst spaeter im File definiert — defer auf
      // naechsten Tick, sonst feuert das vor App-Bootstrap.
      try { setTimeout(() => showToast(`Coming soon: ${wt}`, 'info'), 0); } catch(e) {}
    }
    // F-05 (Casey): Vorher technisch ("Widget-Slot: predict-reveal (Phase 2)")
    // — User-unfreundlich. Jetzt sprechende Copy. wt bleibt als data-Attribut
    // fuer evtl. Debugging/QA, aber nicht im Sichtbaren.
    return `<div class="lf-widget-pending" data-widget="${escapeAttr(wt)}">Diese interaktive Aufgabe folgt im n\xe4chsten Update — schau bald wieder vorbei!</div>`;
  }

  console.warn('[renderBlock] Unknown block type — skipped:', type, block);
  return '';
}

// Hilfsfunktion fuer openSubtopic/closeSubtopic + renderSubtopicGrid:
// rendert alle Bloecke eines Subtopics. Falls keine Bloecke da sind, leerer
// String.
function renderBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  return blocks.map(renderBlock).join('');
}

// renderSubtopicGrid akzeptiert nun das gesamte topicMeta-Objekt (oder, fuer
// Backwards-Compat mit Aufrufern die noch Arrays uebergeben, ein Array). Die
// Aufgabe: bei einem einzelnen Legacy-Wrap-Subtopic (id 'main') gleich expanded
// rendern (Grid-Wrap waere visuell unsinnig fuer 1 Card). Bei einem Subtopics-
// Array > 1 das gewohnte Index-Card-Grid.
//   Cycle-2-Ramsey P2-3: subjectId/yearId werden optional durchgereicht, damit
//   der Empty-State-Fallback (kein Lerninhalt) die korrekte CTA-Hash auf die
//   Year-Liste setzt statt '#/'. Heute Dead-Path (Caller in renderTopic prueft
//   .length > 0 selbst und ruft _emptyTopicContent direkt), aber Future-Proof
//   fuer Custom-Topics + isolierte Aufrufer.
function renderSubtopicGrid(input, subjectId, yearId) {
  // Tolerant: alter Aufrufer hat raw-array uebergeben.
  const subtopics = Array.isArray(input)
    ? getSubtopics({ subtopics: input })
    : getSubtopics(input);

  // Falls subjectId/yearId nicht uebergeben wurden, aber im meta-Objekt liegen
  // (Custom-Topics setzen die Felder direkt am meta), von dort lesen.
  const sid = subjectId || (input && !Array.isArray(input) ? input.subjectId : undefined);
  const yid = yearId    || (input && !Array.isArray(input) ? input.yearId    : undefined);

  if (subtopics.length === 0) {
    // F-04 (Casey): Empty-State Helper — selber Look wie der Caller in
    // renderTopic. CTA-Hash zur Year-Liste falls subjectId/yearId vorhanden,
    // sonst Fallback auf '#/' (siehe _emptyTopicContent).
    return _emptyTopicContent(sid, yid);
  }

  // Legacy-Wrap (single subtopic, id='main', kein name): direkt expanded —
  // kein Grid drum, kein Klick-Aufklapp-Verhalten.
  const isLegacyWrap = subtopics.length === 1 && subtopics[0].id === 'main' && !subtopics[0].name;
  if (isLegacyWrap) {
    return `
      <div class="subtopic-grid" id="subtopicGrid">
        <div class="content-block"><div class="content-body">${renderBlocks(subtopics[0].blocks)}</div></div>
      </div>
      <div class="ai-summary-area" id="aiSummaryArea">
        <button class="btn btn-ghost btn-sm ai-summary-btn" onclick="window.LF.generateSummary()">KI-Zusammenfassung erstellen</button>
        <div class="ai-summary-box" id="aiSummaryBox" style="display:none"></div>
      </div>`;
  }

  const cards = subtopics.map((st, i) => `
    <div class="subtopic-card" onclick="window.LF.openSubtopic(${i})">
      <div class="subtopic-index">${i + 1}</div>
      <div class="subtopic-info">
        <div class="subtopic-name">${escapeHtml(st.name || '')}</div>
        ${st.description ? `<div class="subtopic-desc">${escapeHtml(st.description)}</div>` : ''}
      </div>
      <div class="subtopic-arrow">›</div>
    </div>`).join('');
  return `<div class="subtopic-grid" id="subtopicGrid">${cards}</div>`;
}

// ── Vokabeltrainer ───────────────────────
function renderVocabStart(cards) {
  const directions = [...new Set(cards.map(c => c.direction).filter(Boolean))];
  return `
    <div class="vocab-start" id="vocabArea">
      <div class="vocab-start-icon">${lfIcon('book-open', {cls:'lf-icon-2xl'})}</div>
      <h2>Vokabeltrainer</h2>
      <p>${cards.length} Karte${cards.length !== 1 ? 'n' : ''} in dieser Einheit</p>
      ${directions.length ? `<p class="vocab-direction-info">${directions.join(' · ')}</p>` : ''}
      <button class="btn btn-primary btn-lg" onclick="window.LF.startVocab()">Lernen starten</button>
    </div>`;
}

function renderVocabCard() {
  const { cards, index } = vocabState;
  const card = cards[index];
  const progress = Math.round((index / cards.length) * 100);
  return `
    <div class="vocab-card-wrap" id="vocabArea">
      <div class="vocab-progress-bar"><div class="vocab-progress-fill" style="width:${progress}%"></div></div>
      <div class="vocab-counter">${index + 1} / ${cards.length}</div>
      <div class="vocab-card">
        ${card.direction ? `<div class="vocab-direction">${card.direction}</div>` : ''}
        <div class="vocab-word">${card.word}</div>
        ${card.hint ? `<button class="btn btn-ghost btn-sm vocab-hint-btn" onclick="window.LF.showVocabHint()" id="vocabHintBtn">Tipp anzeigen</button>
        <div class="vocab-hint" id="vocabHint" style="display:none">${card.hint}</div>` : ''}
      </div>
      <div class="vocab-input-row">
        <input type="text" class="form-input vocab-input" id="vocabInput"
               placeholder="Antwort eingeben…"
               onkeydown="if(event.key==='Enter')window.LF.submitVocabAnswer()">
        <button class="btn btn-primary" onclick="window.LF.submitVocabAnswer()">Prüfen</button>
      </div>
    </div>`;
}

function renderVocabFeedback(result, card) {
  const { cards, index, correct, wrong } = vocabState;
  const isLast = index + 1 >= cards.length;
  const cls = result.correct ? (result.almost ? 'almost' : 'correct') : 'wrong';
  const icon = result.correct
    ? (result.almost ? '~' : lfIcon('check', {cls:'sx-correct'}))
    : lfIcon('x', {cls:'sx-wrong'});
  const msg  = result.correct
    ? (result.almost ? 'Fast! Kleiner Tippfehler.' : 'Richtig!')
    : `Falsch. Richtig: <strong>${card.answers[0]}</strong>`;
  return `
    <div class="vocab-card-wrap" id="vocabArea">
      <div class="vocab-progress-bar"><div class="vocab-progress-fill" style="width:${Math.round(((index+1)/cards.length)*100)}%"></div></div>
      <div class="vocab-counter">${index + 1} / ${cards.length}</div>
      <div class="vocab-card vocab-card--${cls}">
        ${card.direction ? `<div class="vocab-direction">${card.direction}</div>` : ''}
        <div class="vocab-word">${card.word}</div>
        <div class="vocab-feedback-icon">${icon}</div>
        <div class="vocab-feedback-msg">${msg}</div>
      </div>
      <button class="btn btn-primary btn-lg" onclick="window.LF.nextVocabCard()">
        ${isLast ? 'Ergebnis anzeigen' : 'Weiter'}
      </button>
    </div>`;
}

function renderVocabResults() {
  const { cards, correct, wrong } = vocabState;
  const pct = Math.round((correct / cards.length) * 100);
  const wrongList = wrong.map(w => `
    <div class="vocab-wrong-item">
      <span class="vocab-wrong-word">${w.card.word}</span>
      <span class="vocab-wrong-sep">→</span>
      <span class="vocab-wrong-answer">${w.card.answers[0]}</span>
      ${w.given ? `<span class="vocab-wrong-given">(du: ${w.given})</span>` : ''}
    </div>`).join('');
  return `
    <div class="vocab-results" id="vocabArea">
      <div class="vocab-result-score ${pct >= 80 ? 'good' : pct >= 50 ? 'ok' : 'bad'}">
        ${correct} / ${cards.length}
      </div>
      <div class="vocab-result-pct">${pct}% richtig</div>
      <div style="display:flex;gap:12px;justify-content:center;margin:24px 0">
        <button class="btn btn-primary" onclick="window.LF.startVocab()">Nochmal (alle)</button>
        ${wrong.length > 0 ? `<button class="btn btn-secondary" onclick="window.LF.retryVocabWrong()">Falsche wiederholen (${wrong.length})</button>` : ''}
      </div>
      ${wrong.length > 0 ? `
        <div class="section-title" style="margin-top:8px">Falsch beantwortet</div>
        <div class="vocab-wrong-list">${wrongList}</div>` : `
        <p style="color:var(--grade-1);font-weight:600;text-align:center">Perfekt! Alle richtig.</p>`}
    </div>`;
}

function renderUebenStart(questions, subjectId, yearId, topicId) {
  return `
    <div class="ueben-start" id="uebenArea">
      <h2>Üben</h2>
      <p>Beantworte die Fragen in deinem eigenen Tempo. Keine Zeitbegrenzung, keine Note — nur Lernen.</p>
      <p style="color:var(--text-muted);font-size:14px">${questions.length} Aufgaben verfügbar</p>
      <button class="btn btn-primary btn-lg" onclick="window.LF.startUeben('${subjectId}','${yearId}','${topicId}')">
        Üben starten
      </button>
    </div>`;
}

// ── Hilfsfunktionen für Stats & Dashboard ─

function calcStreak() {
  const grades = userData?.grades || {};
  const datestrs = [...new Set([
    ...Object.values(grades)
      .filter(g => g.date?.seconds)
      .map(g => new Date(g.date.seconds * 1000).toDateString()),
    ...Object.values(grades)
      .flatMap(g => (g.history || []).map(h => new Date(h.date).toDateString()))
  ])].sort((a, b) => new Date(b) - new Date(a));

  if (!datestrs.length) return 0;
  const today     = new Date().toDateString();
  const yesterday = new Date(Date.now() - 864e5).toDateString();
  if (!datestrs.includes(today) && !datestrs.includes(yesterday)) return 0;

  let streak = 0;
  let check  = datestrs.includes(today) ? new Date() : new Date(Date.now() - 864e5);
  while (datestrs.includes(check.toDateString())) {
    streak++;
    check = new Date(check - 864e5);
  }
  return streak;
}

function getNeedsAttention() {
  const grades = userData?.grades || {};
  return Object.entries(grades)
    .filter(([, g]) => g.grade >= 4)
    .map(([key, g]) => {
      const [subjectId, yearId, topicId] = key.split('__');
      const subject = structure?.[subjectId];
      const topic   = subject?.years?.[yearId]?.topics?.[topicId];
      return subject && topic ? { subjectId, yearId, topicId, subject, topic, g } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.g.grade - a.g.grade)
    .slice(0, 5);
}

function getRecentTests() {
  const grades = userData?.grades || {};
  const attempts = Object.entries(grades).flatMap(([key, g]) => {
    const [subjectId, yearId, topicId] = key.split('__');
    const subject = structure?.[subjectId];
    const topic   = subject?.years?.[yearId]?.topics?.[topicId];
    if (!subject || !topic) return [];
    if (g.history?.length) {
      return g.history.map(h => ({ subjectId, yearId, topicId, subject, topic,
        g: { grade: h.grade, bestPoints: h.points, bestMaxPoints: h.maxPoints, date: h.date }
      }));
    }
    if (g.date?.seconds) {
      return [{ subjectId, yearId, topicId, subject, topic, g }];
    }
    return [];
  });
  return attempts
    .sort((a, b) => new Date(b.g.date) - new Date(a.g.date))
    .slice(0, 5);
}

// ── F-36: KI-Empfehlungen (lokal) ────────
// opts: { subjectFilter?: string, excludeKey?: string }
//   subjectFilter — nur Topics dieses Fachs (Casey/Cycle-3: Action-Card-2
//     soll fach-aware sein, sonst zeigt ein Mathe-Test-Result Englisch-Topics)
//   excludeKey    — `${subjectId}__${yearId}__${topicId}` der NICHT erscheinen
//     soll (typisch: das gerade absolvierte Topic)
// Backward-compat: ohne args = global wie vorher.
function getRecommendations(opts) {
  const { subjectFilter = null, excludeKey = null } = opts || {};
  const grades = userData?.grades || {};
  // V2 (Casey/Wave-2): Topics aus getNeedsAttention() ausschliessen — die
  // erscheinen schon als eigene "Brauchen Aufmerksamkeit"-Karte. Sonst kommen
  // dieselben Note-4+-Topics doppelt auf dem Dashboard vor.
  let attentionKeys;
  try {
    attentionKeys = new Set(
      getNeedsAttention().map(t => `${t.subjectId}__${t.yearId}__${t.topicId}`)
    );
  } catch { attentionKeys = new Set(); }
  const all = [];
  Object.values(structure || {}).forEach(subject => {
    if (subjectFilter && subject.id !== subjectFilter) return;
    Object.values(subject.years || {}).forEach(year => {
      Object.values(year.topics || {}).forEach(topic => {
        const key = `${subject.id}__${year.id}__${topic.id}`;
        if (attentionKeys.has(key)) return;
        if (excludeKey && key === excludeKey) return;
        const g   = grades[key];
        if (!g) {
          all.push({ subjectId: subject.id, yearId: year.id, topicId: topic.id,
            topic, priority: 1, reason: 'Noch nicht gelernt' });
        } else if (g.grade >= 4) {
          all.push({ subjectId: subject.id, yearId: year.id, topicId: topic.id,
            topic, priority: 3, reason: `Note ${g.grade} — wiederholen` });
        } else if (g.grade === 3) {
          const lastDate = g.date?.seconds ? new Date(g.date.seconds * 1000) : null;
          const daysAgo  = lastDate ? (Date.now() - lastDate.getTime()) / 86400000 : 999;
          if (daysAgo > 14) {
            all.push({ subjectId: subject.id, yearId: year.id, topicId: topic.id,
              topic, priority: 2, reason: 'L\xe4nger nicht ge\xfcbt' });
          }
        }
      });
    });
  });
  return all.sort((a, b) => b.priority - a.priority).slice(0, 5);
}

// ── V-02 (Casey/Cycle-3): Naechstes Topic im selben Fach+Jahr ────
// Reihenfolge = alphabetisch ueber Object.keys(year.topics) (gleicher
// Sort wie renderYear's Topic-Liste). Wenn am Ende der Liste → erstes
// Topic der naechsten Klassenstufe (Klasse-N+1) im selben Fach. Wenn
// auch das fehlt → null.
function getNextTopic(subjectId, yearId, topicId) {
  const subject = structure?.[subjectId];
  if (!subject) return null;
  const year = subject.years?.[yearId];
  if (!year) return null;
  const topicIds = Object.keys(year.topics || {}).sort();
  const idx = topicIds.indexOf(topicId);
  if (idx >= 0 && idx + 1 < topicIds.length) {
    const nextId = topicIds[idx + 1];
    return {
      subjectId, yearId,
      topicId: nextId,
      topic: year.topics[nextId],
      year, subject,
      sameYear: true
    };
  }
  // Fallback: erstes Topic der naechsten Klassenstufe.
  const classMatch = /^Klasse[-_]?(\d+)$/i.exec(yearId);
  if (classMatch) {
    const nextClassNum = parseInt(classMatch[1], 10) + 1;
    const candidates = Object.keys(subject.years || {})
      .filter(yid => /^Klasse[-_]?\d+$/i.test(yid))
      .map(yid => ({ yid, n: parseInt((/^Klasse[-_]?(\d+)$/i.exec(yid) || [])[1] || '0', 10) }))
      .filter(o => o.n >= nextClassNum)
      .sort((a, b) => a.n - b.n);
    for (const c of candidates) {
      const y = subject.years[c.yid];
      const tids = Object.keys(y.topics || {}).sort();
      if (tids.length) {
        return {
          subjectId,
          yearId: c.yid,
          topicId: tids[0],
          topic: y.topics[tids[0]],
          year: y, subject,
          sameYear: false
        };
      }
    }
  }
  return null;
}

// ── F-37/38: KI-Zusammenfassung & Tutor ──
// Mission-12 (Ethan, 2026-05-08): direkte Groq+Gemini-Aufrufe raus,
// jetzt durch Cloudflare Worker /aiCall (cf.js). Worker haelt die
// Keys als Secrets — Frontend hat keine mehr. Same throw-contract
// wie vorher, damit alle Caller (KI-Tutor, AI-Erklaer-Falsch, KI-
// Zusammenfassung, Test-Korrektur) ihre existing try/catch-Faelle
// unveraendert behalten.
async function callAI(prompt, maxTokens = 600) {
  try {
    const result = await cf.aiCall({
      mode:        'completion',
      prompt,
      maxTokens,
      temperature: 0.7
    });
    const text = result?.text?.trim();
    if (!text) throw new Error('Leere AI-Antwort');
    return text;
  } catch (e) {
    // Auth-Fail (nicht eingeloggt): silent re-throw — Caller-Catch
    // zeigt seinen eigenen Fallback.
    if (/Nicht eingeloggt/i.test(e.message || '')) throw e;
    // 503 = beide Provider tot. Toast plus re-throw.
    if (/503|kein.*provider|provider.*verf/i.test(e.message || '')) {
      try { showToast('KI gerade nicht verf\xfcgbar — versuch es sp\xe4ter.', 'error'); } catch {}
    }
    throw e;
  }
}

async function callAIChat(messages, maxTokens = 400) {
  try {
    const result = await cf.aiCall({
      mode:        'chat',
      messages,
      maxTokens,
      temperature: 0.7
    });
    const text = result?.text?.trim();
    if (!text) throw new Error('Leere AI-Antwort');
    return text;
  } catch (e) {
    if (/Nicht eingeloggt/i.test(e.message || '')) throw e;
    if (/503|kein.*provider|provider.*verf/i.test(e.message || '')) {
      try { showToast('KI gerade nicht verf\xfcgbar — versuch es sp\xe4ter.', 'error'); } catch {}
    }
    throw e;
  }
}

function unmountTutor() {
  _tutorChat = [];
  document.getElementById('tutorWidget')?.remove();
}

function mountTutor() {
  if (document.getElementById('tutorWidget')) return;
  const widget = document.createElement('div');
  widget.id        = 'tutorWidget';
  widget.className = 'tutor-widget';
  widget.innerHTML = `
    <div class="tutor-header">
      <span>${lfIcon('bot')} KI-Tutor</span>
      <button class="tutor-close-btn" onclick="window.LF.tutorToggle()">&#x2715;</button>
    </div>
    <div class="tutor-messages" id="tutorMessages">
      <div class="tutor-msg tutor-msg-ai">Hallo! Ich bin dein KI-Tutor f\xfcr dieses Thema. Stelle mir eine Frage!</div>
    </div>
    <div class="tutor-input-row">
      <input class="tutor-input" id="tutorInput" placeholder="Frage stellen…"
             onkeydown="if(event.key==='Enter')window.LF.tutorSend()">
      <button class="btn btn-primary btn-sm" onclick="window.LF.tutorSend()">Senden</button>
    </div>`;
  document.body.appendChild(widget);
}

function renderTutorMessages() {
  const el = document.getElementById('tutorMessages');
  if (!el) return;
  const msgs = _tutorChat.filter(m => m.role !== 'system');
  el.innerHTML = msgs.length
    ? msgs.map(m => `<div class="tutor-msg ${m.role === 'user' ? 'tutor-msg-user' : 'tutor-msg-ai'}">${m.content}</div>`).join('')
    : '<div class="tutor-msg tutor-msg-ai">Hallo! Stelle mir eine Frage zum Thema!</div>';
  el.scrollTop = el.scrollHeight;
}

// V-04 (Casey/Cycle-3): optional klasse-filter. Bei `klasse` truthy zaehlen
// nur Topics aus passender Klasse + nicht-klassen-spezifische (z.B.
// Latein/Grammatik). Pattern wie Daily-Challenge (`app.js` ~5125).
// Default-Verhalten unveraendert (klasse=null = alle Klassen).
function getSubjectProgress(subjectId, opts = {}) {
  const subject    = structure?.[subjectId];
  const grades     = userData?.grades || {};
  const klasse     = opts.klasse || null;
  const klPattern  = klasse ? new RegExp(`^Klasse[-_]?${klasse}$`, 'i') : null;
  const isClassYearRe = /^Klasse[-_]?\d+$/i;
  const allTopics  = Object.values(subject?.years || {})
    .filter(y => {
      if (!klPattern) return true;
      const isClassYear = isClassYearRe.test(y.id);
      if (!isClassYear) return true; // z.B. "Grammatik" → fuer alle
      return klPattern.test(y.id);
    })
    .flatMap(y => Object.keys(y.topics || {}).map(tid => `${subjectId}__${y.id}__${tid}`));
  const tested     = allTopics.filter(k => grades[k]);
  const gradeVals  = tested.map(k => grades[k].grade).filter(Boolean);
  const avgGrade   = gradeVals.length ? gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length : null;
  return { total: allTopics.length, tested: tested.length, avgGrade };
}

// V-04 (Casey/Cycle-3): Lernen-Tab-Filter "Meine Klasse" — localStorage-State.
// Default ON wenn key fehlt. Wird von renderLernen + renderSubject gelesen.
function getLernenKlasseFilter() {
  try {
    const v = localStorage.getItem('lf:lernenFilterMyClassOnly');
    if (v === '0') return false;
    return true; // default ON
  } catch { return true; }
}

// ── SRS: Fällige Karten zählen (F-16) ──────
function getSRSDueCount() {
  const srs = userData?.srs || {};
  const today = new Date().toISOString().slice(0, 10);
  return Object.values(srs).filter(c => !c.nextReview || c.nextReview <= today).length;
}

function getSRSDueCards() {
  const srs = userData?.srs || {};
  const today = new Date().toISOString().slice(0, 10);
  return Object.entries(srs)
    .filter(([, c]) => !c.nextReview || c.nextReview <= today)
    .map(([id, c]) => ({ id, ...c }));
}

function sm2Update(card, q) {
  let { interval = 1, repetitions = 0, ef = 2.5 } = card;
  if (q < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0)      interval = 1;
    else if (repetitions === 1) interval = 6;
    else                        interval = Math.round(interval * ef);
    repetitions++;
  }
  ef = Math.max(1.3, ef + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  const d = new Date();
  d.setDate(d.getDate() + interval);
  return { interval, repetitions, ef, nextReview: d.toISOString().slice(0, 10) };
}

async function updateSRSCard(q, rating) {
  if (!currentUser || !q.id) return;
  const existing = userData?.srs?.[q.id] || {};
  const updated = sm2Update(existing, rating);
  const correctAnswer = q.type === 'multiple_choice'
    ? (q.options?.[q.correct] || q.shuffledOptions?.[q.shuffledCorrectIndex] || '')
    : (q.answer || q.sampleAnswer || '');
  const srsEntry = { ...updated, question: q.question, answer: correctAnswer, topicKey: flashcardState?.topicKey };
  userData = userData || {};
  if (!userData.srs) userData.srs = {};
  userData.srs[q.id] = srsEntry;
  await saveSRS(currentUser.uid, userData.srs).catch(console.error);
}

// ── Wissens-Check (F-20) ────────────────────
function buildWissensCheck(questions, topicKey) {
  if (!questions.length) return '';
  const items = questions.map((q, i) => {
    if (q.type === 'multiple_choice') {
      const opts = (q.options || []).map((o, j) =>
        `<button class="wc-opt" onclick="window.LF.wissensCheckMC('${topicKey}',${i},${j},${q.correct})" id="wcOpt_${topicKey}_${i}_${j}">${escapeHtml(o || '')}</button>`
      ).join('');
      return `<div class="wc-item" id="wcItem_${topicKey}_${i}">
        <div class="wc-q">${i+1}. ${escapeHtml(q.question || '')}</div>
        <div class="wc-opts">${opts}</div>
        <div class="wc-fb" id="wcFb_${topicKey}_${i}" style="display:none"></div>
      </div>`;
    }
    return `<div class="wc-item" id="wcItem_${topicKey}_${i}">
      <div class="wc-q">${i+1}. ${escapeHtml(q.question || '')}</div>
      <button class="btn btn-ghost btn-sm" onclick="window.LF.wissensCheckReveal('${topicKey}',${i})" id="wcRevealBtn_${topicKey}_${i}">Antwort anzeigen</button>
      <div class="wc-fb" id="wcFb_${topicKey}_${i}" style="display:none"><strong>${lfIcon('check', {cls:'sx-correct'})} ${escapeHtml(q.answer || '')}</strong></div>
    </div>`;
  }).join('');
  return `
    <div class="wissens-check">
      <div class="wissens-check-title">${lfIcon('flask-round')} Schnell-Check</div>
      <div class="wc-items">${items}</div>
    </div>`;
}

// ── LaTeX / MathJax laden (F-21) ───────────
function maybeLoadMathJax() {
  if (window.MathJax) { MathJax.typesetPromise?.(); return; }
  if (document.getElementById('mathjax-script')) return;
  window.MathJax = { tex: { inlineMath: [['$','$'],['\\(','\\)']] }, startup: { ready() { MathJax.startup.defaultReady(); MathJax.typesetPromise(); } } };
  const s = document.createElement('script');
  s.id = 'mathjax-script';
  s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js';
  s.async = true;
  document.head.appendChild(s);
}

// ── Prism.js laden (F-22) ──────────────────
function maybeLoadPrism() {
  if (window.Prism) { Prism.highlightAll(); return; }
  if (document.getElementById('prism-css')) return;
  const link = document.createElement('link');
  link.id = 'prism-css';
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-tomorrow.min.css';
  document.head.appendChild(link);
  const s = document.createElement('script');
  s.id = 'prism-script';
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js';
  s.onload = () => Prism.highlightAll();
  document.head.appendChild(s);
}

// ── Fachfarbe abrufen (Nutzer > Standard) ─
export function getSubjectColor(subjectId) {
  const custom = userData?.settings?.subjectColors?.[subjectId];
  return custom || structure?.[subjectId]?.color || '#6366f1';
}

// ── Fach-Icon abrufen (Nutzer > Standard) ─
// Mission 8: subjects-config.json ships Lucide-Icon-Names (with iconType:'lucide').
// User-overrides via Settings stay emoji-based (per Adrian Q4: don't break working UX).
// Resolution-order: customIconUrl (img) > customIcon (emoji string) > config-driven Lucide
// or emoji > book-open Lucide-fallback.
function getSubjectIcon(subjectId) {
  const url = userData?.settings?.customIconUrls?.[subjectId];
  if (url) return `<img class="subject-icon-img" src="${url}" alt="">`;
  const custom = userData?.settings?.customIcons?.[subjectId];
  if (custom) return custom;                                         // user-set emoji wins
  const cfg = structure?.[subjectId];
  if (cfg?.iconType === 'lucide' && cfg.icon) {
    return lfIcon(cfg.icon, { cls: 'subject-icon' });
  }
  // Mission 8 Q2: country-flag for Sprachfaecher (Englisch=gb).
  if (cfg?.iconType === 'flag' && cfg.icon) {
    return lfFlag(cfg.icon, { cls: 'subject-icon subject-icon--flag' });
  }
  // Fallback to emoji if config has no iconType marker (legacy / custom subjects)
  // OR if the icon name happens to be a known Lucide one (defensive auto-detect).
  const ico = cfg?.icon;
  if (ico && LUCIDE_ICONS[ico]) return lfIcon(ico, { cls: 'subject-icon' });
  if (ico && FLAG_ICONS[ico]) return lfFlag(ico, { cls: 'subject-icon subject-icon--flag' });
  return ico || lfIcon('book-open', { cls: 'subject-icon' });
}

function _resizeToDataUrl(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      c.getContext('2d').drawImage(img, 0, 0, 64, 64);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function _resizeProfileImage(file, maxPx = 512) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth > maxPx || img.naturalHeight > maxPx) {
        reject(new Error(`Bild muss kleiner als ${maxPx}×${maxPx} px sein (hochgeladen: ${img.naturalWidth}×${img.naturalHeight}).`));
        return;
      }
      const c = document.createElement('canvas');
      c.width  = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden.')); };
    img.src = url;
  });
}

// ── Einstellungen-Seite (Cycle-3 Refactor — 4 Tabs) ──────
// Maya-Spec: .claude/company/specs/settings-page-refactor-implementation.md
// 4 Tabs: darstellung · lernen · anpassung · konto. URL-Hash-Param ?tab=...
// Defaults via `?? <default>` — Bestand-User-Migration nicht noetig.

// Whitelist 12 Subject-Color-Slugs (Maya v2 Color-Palette).
// Layer-4 in subject-tokens.css setzt --user-subject-accent / -soft daraus.
// Slug-Wertebereich + DE-Label + Display-Hex (nur fuer das Picker-Swatch
// im Settings-UI — die echten Token-Werte stehen in subject-tokens.css als
// oklch). Hex hier = visueller Anker; UI-Komponente, nicht Theme-Tokens.
const USER_SUBJECT_COLOR_PALETTE = [
  { slug: 'royal-blue',         name: 'Königsblau',    hex: '#3b58c4' },
  { slug: 'electric-cyan',      name: 'Strom-Cyan',         hex: '#1e7fb8' },
  { slug: 'terminal-green',     name: 'Terminal-Grün', hex: '#1f8f5a' },
  { slug: 'emerald-leaf',       name: 'Smaragd',            hex: '#1f9b58' },
  { slug: 'teal-globe',         name: 'Türkis',        hex: '#15868c' },
  { slug: 'sepia-bronze',       name: 'Sepia-Bronze',       hex: '#998534' },
  { slug: 'crimson-classical',  name: 'Klassik-Rot',        hex: '#bd3a2a' },
  { slug: 'coral-pop',          name: 'Koralle',            hex: '#e06846' },
  { slug: 'amber-warm',         name: 'Bernstein',          hex: '#d8902c' },
  { slug: 'violet-chem',        name: 'Violett',            hex: '#8a3fbd' },
  { slug: 'mauve-soft',         name: 'Mauve',              hex: '#aa6b94' },
  { slug: 'slate-pro',          name: 'Schiefer',           hex: '#5a6376' }
];
const USER_SUBJECT_COLOR_SLUGS = USER_SUBJECT_COLOR_PALETTE.map(p => p.slug);

const _SETTINGS_TABS = [
  { slug: 'darstellung', label: 'Darstellung', icon: 'palette' },
  { slug: 'lernen',      label: 'Lernen',      icon: 'graduation-cap' },
  { slug: 'anpassung',   label: 'Anpassung',   icon: 'user' },
  { slug: 'konto',       label: 'Konto',       icon: 'lock' }
];

// Defaults-Bag fuer settings.* — Bestand-User lesen mit `?? default`.
function _settingsRead() {
  const s = userData?.settings || {};
  return {
    themeMode:           s.themeMode           ?? (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'),
    cosmeticTheme:       s.cosmeticTheme       ?? userData?.activeTheme ?? 'default',
    fontSize:            s.fontSize            ?? 'normal',
    reducedMotion:       s.reducedMotion       ?? false,
    dailyReminderTime:   s.dailyReminderTime   ?? '',
    streakWarnThreshold: s.streakWarnThreshold ?? 18,
    defaultKlasseFilter: s.defaultKlasseFilter ?? 'auto',
    subjectThemesOff:    s.subjectThemesOff    ?? false,
    subjectColors:       s.subjectColors       ?? {},
    customIcons:         s.customIcons         ?? {},
    customIconUrls:      s.customIconUrls      ?? {},
    defaultOutline:      s.defaultOutline      ?? '',
    lbHidden:            userData?.lbHidden    ?? false
  };
}

function renderSettings() {
  const tab = _hashParam('tab') || 'darstellung';
  const valid = _SETTINGS_TABS.find(t => t.slug === tab) ? tab : 'darstellung';

  const tabBar = `
    <div class="settings-tabs" id="settingsTabs">
      ${_SETTINGS_TABS.map(t => `
        <button class="settings-tab-pill ${t.slug === valid ? 'active' : ''}"
                onclick="window.LF.switchSettingsTab('${t.slug}')">
          ${lfIcon(t.icon, { cls: 'settings-tab-icon' })}
          <span>${t.label}</span>
        </button>`).join('')}
    </div>`;

  let content = '';
  if      (valid === 'darstellung') content = _renderSettingsDarstellungTab();
  else if (valid === 'lernen')      content = _renderSettingsLernenTab();
  else if (valid === 'anpassung')   content = _renderSettingsAnpassungTab();
  else if (valid === 'konto')       content = _renderSettingsKontoTab();

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Einstellungen' }])}
    <div class="page">
      <div class="page-header">
        <h1>${lfIcon('settings')} Einstellungen</h1>
        <div class="sub">Dein Konto, dein Stil, deine App.</div>
      </div>
      ${tabBar}
      <div class="settings-tab-content" id="settingsTabContent">${content}</div>
    </div>`;
}

// ── Tab 1 — Darstellung ─────────────────────────────────
function _renderSettingsDarstellungTab() {
  const s = _settingsRead();
  const themeRadios = [
    ['light',  'Hell',                                 'sun'],
    ['dark',   'Dunkel',                               'moon'],
    ['system', 'System (folgt deinem Gerät)',     'globe']
  ].map(([val, label, icon]) => `
    <label class="settings-radio-row ${s.themeMode === val ? 'is-selected' : ''}">
      <input type="radio" name="settingsThemeMode" value="${val}"
             ${s.themeMode === val ? 'checked' : ''}
             onchange="window.LF.settingsSaveThemeMode('${val}')">
      ${lfIcon(icon, { cls: 'settings-radio-icon' })}
      <span>${label}</span>
    </label>`).join('');

  const cosmeticOptions = THEMES.map(t => `
    <option value="${t.id}" ${s.cosmeticTheme === t.id ? 'selected' : ''}>${escapeHtml(t.name)}</option>
  `).join('');

  const fontSizeBtns = [
    ['normal', 'Normal'],
    ['large',  'Groß'],
    ['xlarge', 'Sehr groß']
  ].map(([val, label]) => `
    <button class="settings-segment-btn ${s.fontSize === val ? 'active' : ''}"
            onclick="window.LF.settingsSaveFontSize('${val}')">${label}</button>
  `).join('');

  return `
    <div class="settings-card">
      <div class="settings-section-title">Modus</div>
      <p class="settings-hint">Wähle, wie LearningForge aussieht.</p>
      <div class="settings-radio-group">${themeRadios}</div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Cosmetic-Theme</div>
      <p class="settings-hint">Vorschau wird sofort angewendet.</p>
      <div class="settings-cosmetic-row">
        <select class="form-input settings-cosmetic-select" id="settingsCosmeticSelect"
                onchange="window.LF.settingsSaveCosmeticTheme(this.value)">
          ${cosmeticOptions}
        </select>
        <div class="settings-cosmetic-preview" data-app-theme="${escapeAttr(s.cosmeticTheme)}" id="settingsCosmeticPreview">
          <div class="settings-cosmetic-preview-card">
            <div class="settings-cosmetic-preview-bar"></div>
            <div class="settings-cosmetic-preview-text">Aa</div>
          </div>
        </div>
      </div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Schriftgröße</div>
      <p class="settings-hint">Skaliert die gesamte App.</p>
      <div class="settings-segment-row">${fontSizeBtns}</div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Bewegung reduzieren</div>
      <div class="settings-toggle-row">
        <div class="settings-toggle-label">
          <div class="settings-name">Animationen werden ausgeschaltet.</div>
          <div class="settings-hint" style="margin:2px 0 0">Hilft bei Reizempfindlichkeit oder schwachen Geräten.</div>
        </div>
        <label class="settings-toggle">
          <input type="checkbox" id="settingsReducedMotion"
                 ${s.reducedMotion ? 'checked' : ''}
                 onchange="window.LF.settingsSaveReducedMotion(this.checked)">
          <span class="settings-toggle-slider"></span>
        </label>
      </div>
    </div>`;
}

// ── Tab 2 — Lernen ──────────────────────────────────────
function _renderSettingsLernenTab() {
  const s = _settingsRead();
  const subjects = Object.values(structure || {});
  const userKlasse = userData?.klasse ? `Klasse ${escapeHtml(String(userData.klasse))}` : 'Klasse';

  const klasseOpts = [
    `<option value="auto" ${s.defaultKlasseFilter === 'auto' ? 'selected' : ''}>Automatisch (${userKlasse})</option>`,
    ...[5,6,7,8,9,10,11,12,13].map(k =>
      `<option value="${k}" ${String(s.defaultKlasseFilter) === String(k) ? 'selected' : ''}>Klasse ${k}</option>`
    )
  ].join('');

  const subjectsOff = s.subjectThemesOff;
  const subjectColorRows = subjects.length === 0
    ? `<div class="empty-state"><div class="empty-icon">${lfIcon('folder-open')}</div>Noch keine Fächer vorhanden.</div>`
    : subjects.map(sub => {
        const current = s.subjectColors?.[sub.id] || '';
        const swatches = USER_SUBJECT_COLOR_PALETTE.map(p => `
          <button class="settings-color-swatch ${current === p.slug ? 'is-selected' : ''}"
                  data-slug="${p.slug}"
                  style="background:${p.hex}"
                  title="${escapeAttr(p.name)}"
                  aria-label="${escapeAttr(p.name)} für ${escapeAttr(sub.name)}"
                  onclick="window.LF.settingsSaveSubjectColor('${escapeAttr(sub.id)}','${p.slug}')">
            ${current === p.slug ? lfIcon('check', { cls: 'settings-swatch-check' }) : ''}
          </button>`).join('');
        const currentLabel = current
          ? (USER_SUBJECT_COLOR_PALETTE.find(p => p.slug === current)?.name || 'Eigene')
          : 'Standard';
        return `
          <div class="settings-subject-color-row" id="subjColorRow_${escapeAttr(sub.id)}">
            <div class="settings-subject-color-header">
              <div class="settings-subject-info">
                <span class="settings-icon">${getSubjectIcon(sub.id)}</span>
                <span class="settings-name">${escapeHtml(sub.name)}</span>
              </div>
              <div class="settings-subject-color-meta">
                <span class="settings-subject-color-current">${escapeHtml(currentLabel)}</span>
                ${current ? `
                  <button class="btn btn-ghost btn-sm"
                          onclick="window.LF.settingsResetSubjectColor('${escapeAttr(sub.id)}')">Standard</button>` : ''}
              </div>
            </div>
            <div class="settings-color-grid">${swatches}</div>
          </div>`;
      }).join('');

  return `
    <div class="settings-card">
      <div class="settings-section-title">Tägliche Lern-Erinnerung</div>
      <p class="settings-hint">Zeit, ab der wir dich erinnern, wenn du noch nichts gelernt hast.</p>
      <div class="settings-time-row">
        <input type="time" class="form-input settings-time-picker" id="settingsDailyReminder"
               value="${escapeAttr(s.dailyReminderTime || '')}"
               onchange="window.LF.settingsSaveDailyReminder(this.value)">
        <button class="btn btn-ghost btn-sm" onclick="window.LF.settingsSaveDailyReminder('')">Aus</button>
      </div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Streak-Schutz</div>
      <p class="settings-hint">Hinweis-Banner ab dieser Uhrzeit.</p>
      <select class="form-input" id="settingsStreakWarn"
              onchange="window.LF.settingsSaveStreakWarn(this.value)">
        ${Array.from({length: 24}, (_, h) => `
          <option value="${h}" ${Number(s.streakWarnThreshold) === h ? 'selected' : ''}>${String(h).padStart(2,'0')}:00</option>
        `).join('')}
      </select>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Standard-Klasse beim Lernen-Tab</div>
      <p class="settings-hint">Bestimmt den initial-aktiven Filter im Lernen-Tab.</p>
      <select class="form-input" id="settingsDefaultKlasse"
              onchange="window.LF.settingsSaveDefaultKlasse(this.value)">
        ${klasseOpts}
      </select>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Fach-Themes</div>
      <div class="settings-toggle-row">
        <div class="settings-toggle-label">
          <div class="settings-name">Jedes Fach in eigener Optik.</div>
          <div class="settings-hint" style="margin:2px 0 0">Mathe blau, Deutsch navy, Bio grün …</div>
        </div>
        <label class="settings-toggle">
          <input type="checkbox" id="settingsSubjectThemes"
                 ${!subjectsOff ? 'checked' : ''}
                 onchange="window.LF.settingsSaveSubjectThemesOn(this.checked)">
          <span class="settings-toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Fach-Farben</div>
      <p class="settings-hint">Hier kannst du die Standardfarbe pro Fach überschreiben.</p>
      ${subjectsOff ? `
        <div class="settings-disabled-hint">
          ${lfIcon('info')} Aktiviere Fach-Themes oben, um Farben anzupassen.
        </div>` : `
        <div class="settings-subject-color-list">
          ${subjectColorRows}
        </div>
        ${subjects.length > 0 ? `
          <div class="settings-actions">
            <button class="btn btn-secondary" onclick="window.LF.settingsResetAllSubjectColors()">
              Alle auf Standard zurücksetzen
            </button>
          </div>` : ''}
      `}
    </div>`;
}

// ── Tab 3 — Anpassung ───────────────────────────────────
function _renderSettingsAnpassungTab() {
  const s = _settingsRead();
  const subjects = Object.values(structure || {});
  const initial = (userData?.name || currentUser?.displayName || 'U')[0].toUpperCase();
  const photoURL = userData?.photoURL || currentUser?.photoURL || null;
  const lvl = calcLevel(userData?.xp || 0).level;
  const currentOutline = userData?.activeOutline || s.defaultOutline || '';

  const outlineOpts = OUTLINE_TIERS.map(t => {
    const lockedByLevel = lvl < t.level;
    const owned = (userData?.outlines || []).includes(t.id);
    const accessible = !lockedByLevel || owned || isAdmin();
    return `<option value="${t.id}" ${currentOutline === t.id ? 'selected' : ''} ${!accessible ? 'disabled' : ''}>
      ${escapeHtml(t.name)}${!accessible ? ` — ab Lv.${t.level}` : ''}
    </option>`;
  }).join('');

  const iconRows = subjects.length === 0
    ? `<div class="empty-state"><div class="empty-icon">${lfIcon('folder-open')}</div>Noch keine Fächer vorhanden.</div>`
    : subjects.map(sub => {
        const hasUrl     = !!s.customIconUrls?.[sub.id];
        const emojiVal   = s.customIcons?.[sub.id] || '';
        const previewHtml = hasUrl
          ? `<img class="subject-icon-img" src="${escapeAttr(s.customIconUrls[sub.id])}" alt="" style="width:36px;height:36px">`
          : (emojiVal || getSubjectIcon(sub.id));
        return `
          <div class="settings-color-row">
            <div class="settings-subject-info">
              <span class="settings-icon" id="iconPreview_${escapeAttr(sub.id)}">${previewHtml}</span>
              <span class="settings-name">${escapeHtml(sub.name)}</span>
            </div>
            <div class="settings-color-right">
              <input type="text" class="form-input" id="icon_${escapeAttr(sub.id)}"
                     value="${escapeAttr(emojiVal)}" maxlength="2"
                     style="width:54px;text-align:center;font-size:20px"
                     oninput="window.LF.onEmojiInput('${escapeAttr(sub.id)}',this.value)">
              <label class="btn btn-ghost btn-sm icon-upload-label" title="PNG hochladen (64×64)">
                ${lfIcon('folder')}
                <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none"
                       onchange="window.LF.handleIconFile('${escapeAttr(sub.id)}',this)">
              </label>
              <button class="btn btn-ghost btn-sm" onclick="window.LF.resetIcon('${escapeAttr(sub.id)}','')">
                ${lfIcon('rotate-ccw')}
              </button>
            </div>
          </div>`;
      }).join('');

  return `
    <div class="settings-card">
      <div class="settings-section-title">Avatar</div>
      <div class="settings-avatar-block">
        <div class="profile-avatar-large" id="settingsAvatarPreview" style="margin:0 auto 12px">${
          photoURL
            ? `<img src="${escapeAttr(photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
            : escapeHtml(initial)
        }</div>
        <div class="settings-avatar-actions">
          <label class="btn btn-secondary btn-sm">
            ${lfIcon('folder')} ${photoURL ? 'Bild ändern' : 'Bild hochladen'}
            <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none"
                   onchange="window.LF.settingsAvatarFile(this)">
          </label>
          ${photoURL ? `
            <button class="btn btn-ghost btn-sm" onclick="window.LF.settingsRemoveAvatar()">
              ${lfIcon('x')} Bild entfernen
            </button>` : ''}
        </div>
        <div class="settings-hint" style="text-align:center;margin-top:8px">Quadratisch, max 1 MB.</div>
      </div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Anzeige-Name</div>
      <div class="settings-inline-row">
        <input type="text" class="form-input" id="settingsDisplayName"
               value="${escapeAttr(userData?.name || currentUser?.displayName || '')}"
               placeholder="Anzeigename" maxlength="24"
               onkeydown="if(event.key==='Enter'){event.preventDefault();window.LF.settingsSaveDisplayName();}"
               onblur="window.LF.settingsSaveDisplayNameIfChanged()">
        <button class="btn btn-primary btn-sm" id="settingsDisplayNameSaveBtn"
                onclick="window.LF.settingsSaveDisplayName()">Speichern</button>
      </div>
      <div class="settings-hint" style="margin-top:6px">2 bis 24 Zeichen.</div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Standard-Outline</div>
      <p class="settings-hint">Wird als Avatar-Rand angezeigt. Gesperrte Tier-Stufen werden in deinem Inventar freigeschaltet.</p>
      <select class="form-input" id="settingsDefaultOutline"
              onchange="window.LF.settingsSaveDefaultOutline(this.value)">
        ${outlineOpts}
      </select>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Fach-Icons</div>
      <p class="settings-hint">Emoji eingeben oder PNG hochladen (wird auf 64×64 px skaliert).</p>
      <div class="settings-color-list">${iconRows}</div>
      ${subjects.length > 0 ? `
        <div class="settings-actions">
          <button class="btn btn-primary" onclick="window.LF.saveIcons()">Icons speichern</button>
        </div>` : ''}
    </div>`;
}

// ── Tab 4 — Konto + Daten ───────────────────────────────
function _renderSettingsKontoTab() {
  const s = _settingsRead();
  const email = currentUser?.email || '';
  return `
    <div class="settings-card">
      <div class="settings-section-title">E-Mail</div>
      <div class="settings-email-display">${escapeHtml(email)}</div>
      <div class="settings-hint" style="margin-top:6px">Login-E-Mail kann nicht geändert werden.</div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Passwort</div>
      <p class="settings-hint">Erhalte einen Reset-Link an deine E-Mail.</p>
      <button class="btn btn-secondary" onclick="window.LF.settingsRequestPasswordReset()">
        ${lfIcon('pen-line')} Reset-Link an meine E-Mail senden
      </button>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Meine Daten</div>
      <p class="settings-hint">Lade alle deine Daten als JSON-Datei herunter.</p>
      <button class="btn btn-secondary" onclick="window.LF.settingsExportData()">
        ${lfIcon('download')} Daten herunterladen
      </button>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <div class="settings-section-title">Sichtbarkeit auf Ranglisten</div>
      <div class="settings-toggle-row">
        <div class="settings-toggle-label">
          <div class="settings-name">Auf Ranglisten sichtbar</div>
          <div class="settings-hint" style="margin:2px 0 0">Mit Aus erscheinst du nirgends — auch deine Freunde sehen dich nicht im Ranking.</div>
        </div>
        <label class="settings-toggle">
          <input type="checkbox" id="settingsLbVisible"
                 ${!s.lbHidden ? 'checked' : ''}
                 onchange="window.LF.settingsSaveLbHidden(!this.checked)">
          <span class="settings-toggle-slider"></span>
        </label>
      </div>
    </div>

    <div class="settings-card" style="margin-top:16px">
      <button class="btn btn-secondary" onclick="window.LF.settingsLogout()">
        ${lfIcon('log-out')} Abmelden
      </button>
    </div>

    <div class="settings-danger-zone" style="margin-top:24px">
      <div class="settings-danger-zone-title">${lfIcon('triangle-alert')} Gefahrenzone</div>
      <div class="settings-danger-zone-card">
        <div class="settings-section-title" style="margin-bottom:4px">Konto löschen</div>
        <p class="settings-hint">Setzt dein gesamtes Konto unwiderruflich zurück. Kein Undo.</p>
        <button class="btn btn-danger" onclick="window.LF.settingsOpenDeleteModal()">
          ${lfIcon('trash-2')} Konto löschen
        </button>
      </div>
    </div>`;
}

// ── Konto-Loeschen-Modal (State-Machine: warning → countdown → execute) ──
let _settingsDeleteState = null;

function _openSettingsDeleteModal() {
  if (document.getElementById('settingsDeleteOverlay')) return;
  _settingsDeleteState = {
    phase: 'warning',     // 'warning' | 'countdown'
    timer: null,
    countdown: 30,        // wird in settingsStartDeleteCountdown ueberschrieben
    interval: null
  };
  const overlay = document.createElement('div');
  overlay.id = 'settingsDeleteOverlay';
  overlay.className = 'lf-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) _closeSettingsDeleteModal(); });
  document.body.appendChild(overlay);
  _renderSettingsDeleteModalContent();
}

function _closeSettingsDeleteModal() {
  if (_settingsDeleteState?.timer)    clearTimeout(_settingsDeleteState.timer);
  if (_settingsDeleteState?.interval) clearInterval(_settingsDeleteState.interval);
  _settingsDeleteState = null;
  document.getElementById('settingsDeleteOverlay')?.remove();
}

function _renderSettingsDeleteModalContent() {
  const overlay = document.getElementById('settingsDeleteOverlay');
  if (!overlay || !_settingsDeleteState) return;
  const userName = userData?.name || currentUser?.displayName || 'Nutzer';

  if (_settingsDeleteState.phase === 'warning') {
    overlay.innerHTML = `
      <div class="lf-modal-card">
        <div class="lf-modal-header">
          <h3>${lfIcon('triangle-alert')} Konto löschen</h3>
          <button class="btn-icon" onclick="window.LF.settingsCancelDelete()" aria-label="Schließen">${lfIcon('x')}</button>
        </div>
        <div class="lf-modal-body">
          <p>Dein gesamtes Konto wird permanent gelöscht. Das kann nicht rückgängig gemacht werden.</p>
          <div class="settings-delete-bullets">
            <div class="settings-section-title" style="margin-bottom:6px">Was wird gelöscht:</div>
            <ul>
              <li>Alle Noten und Test-Historie</li>
              <li>XP, Streak, Achievements</li>
              <li>Eigene Themen aus dem Builder</li>
              <li>Freundschaften und Gruppen-Mitgliedschaften</li>
              <li>Dein Profil und Avatar</li>
            </ul>
          </div>
          <label class="form-label" style="margin-top:12px;display:block">
            Tippe deinen Anzeige-Namen, um zu bestätigen:
          </label>
          <input type="text" class="form-input" id="settingsDeleteConfirmInput"
                 placeholder="${escapeAttr(userName)}"
                 oninput="window.LF.settingsDeleteOnConfirmInput(this.value)">
        </div>
        <div class="lf-modal-footer" style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" onclick="window.LF.settingsCancelDelete()">Abbrechen</button>
          <button class="btn btn-danger" id="settingsDeleteConfirmBtn" disabled
                  onclick="window.LF.settingsStartDeleteCountdown()">Endgültig löschen</button>
        </div>
      </div>`;
    setTimeout(() => document.getElementById('settingsDeleteConfirmInput')?.focus(), 30);
  } else {
    const c = _settingsDeleteState.countdown;
    // 30s Countdown (siehe settingsStartDeleteCountdown). Initial-Wert kennen
    // wir nicht zur Render-Zeit, also clampen wir auf 30 als Anker.
    const pct = Math.max(0, Math.min(100, ((30 - c) / 30) * 100));
    overlay.innerHTML = `
      <div class="lf-modal-card">
        <div class="lf-modal-header">
          <h3>${lfIcon('triangle-alert')} Konto wird gelöscht</h3>
        </div>
        <div class="lf-modal-body">
          <p style="text-align:center;font-size:18px;font-weight:600">
            Konto wird in ${c} Sekunden gelöscht…
          </p>
          <div class="settings-delete-progress">
            <div class="settings-delete-progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="lf-modal-footer" style="display:flex;gap:8px;justify-content:center">
          <button class="btn btn-secondary" onclick="window.LF.settingsCancelDelete()">Abbrechen</button>
        </div>
      </div>`;
  }
}

// ── Daten-Export-Helper (Frontend-only Blob) ─────────────
function _buildUserExport() {
  const u = userData || {};
  const stats = {
    xp:            u.xp || 0,
    level:         calcLevel(u.xp || 0).level,
    streak:        (() => { try { return calcStreak(); } catch { return 0; } })(),
    longestStreak: u.longestStreak || 0
  };
  return {
    exportedAt:    new Date().toISOString(),
    exportVersion: 1,
    user: {
      uid:       currentUser?.uid || null,
      email:     currentUser?.email || null,
      name:      u.name || null,
      klasse:    u.klasse || null,
      createdAt: u.createdAt?.toMillis ? u.createdAt.toMillis() : (u.createdAt || null),
      photoURL:  u.photoURL || null
    },
    stats,
    grades:        u.grades || {},
    customTopics:  u.customTopics || [],
    srs:           u.srs || {},
    settings:      u.settings || {},
    achievements:  u.achievements || [],
    exams:         u.exams || [],
    friendIds:     u.friendIds || []
  };
}

// ── Apply-Helpers (DOM-Effekte) ─────────────────────────
function _applyFontSizeScale(scale) {
  const map = { normal: 1, large: 1.125, xlarge: 1.25 };
  const v = map[scale] ?? 1;
  document.documentElement.style.setProperty('--font-size-scale', String(v));
}

function _applyReducedMotion(on) {
  if (on) document.documentElement.style.setProperty('--motion-duration', '0.01ms');
  else    document.documentElement.style.removeProperty('--motion-duration');
}

let _systemThemeMql = null;
function _applyThemeMode(mode) {
  if (_systemThemeMql) {
    try { _systemThemeMql.removeEventListener('change', _onSystemThemeChange); } catch {}
    _systemThemeMql = null;
  }
  if (mode === 'system') {
    _systemThemeMql = window.matchMedia('(prefers-color-scheme: dark)');
    const sysDark = _systemThemeMql.matches;
    document.documentElement.setAttribute('data-theme', sysDark ? 'dark' : 'light');
    try { _systemThemeMql.addEventListener('change', _onSystemThemeChange); } catch {}
  } else {
    document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
    setCookie('lf_theme', mode === 'dark' ? 'dark' : 'light', 365);
  }
}

function _onSystemThemeChange(e) {
  if ((userData?.settings?.themeMode ?? 'light') !== 'system') return;
  document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
}

// Init-Hook (called from startApp after userData loads).
export function applySettingsOnBoot() {
  const s = _settingsRead();
  _applyFontSizeScale(s.fontSize);
  _applyReducedMotion(s.reducedMotion);
  if (s.themeMode === 'system') _applyThemeMode('system');
}

// ── F-1: Klausur-Countdown ───────────────────────────────────
// Casey-M-Variante: Anlegen/Anzeigen/Loeschen, KEIN Edit. Daily-Boost +
// SRS-Boost in den letzten 3 Tagen. Datenmodell siehe Maya-Spec §4.
//
// Defensive Reads: userData.exams kann undefined / leer / corrupted sein
// (Bestands-User vor Migration, Manual-Console-Edit). Alle Helper geben in
// dem Fall Empty-Default zurueck — kein Crash propagiert in Daily/SRS.

const _KLAUSUR_TODAY = () => new Date().toISOString().slice(0, 10);

// Hilfs-Counter fuer Tage-Diff zwischen YYYY-MM-DD-Strings, lokal-zeitfest.
// Nutzt Date-Konstruktor mit Y-M-D-Komponenten (ignoriert TZ-Offset, was
// genau das ist was wir wollen — der Tag rolled bei Mitternacht lokal).
function _diffDaysFromToday(dateStr) {
  if (typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

// Pure: gibt Array von exam-Objekten zurueck mit (date - today) ∈ [0, 3].
// Defense-in-depth: filtert auch defekte Eintraege (kein topicIds-Array,
// kein subject-string, kaputtes date) raus, damit Boost-Code clean lebt.
function getActiveExamBoost() {
  const exams = userData?.exams;
  if (!Array.isArray(exams)) return [];
  return exams.filter(ex => {
    if (!ex || typeof ex !== 'object') return false;
    if (typeof ex.subject !== 'string' || !ex.subject) return false;
    if (!Array.isArray(ex.topicIds)) return false;
    const days = _diffDaysFromToday(ex.date);
    return days !== null && days >= 0 && days <= 3;
  });
}

function getExamCountdown(dateStr) {
  const days = _diffDaysFromToday(dateStr);
  if (days === null)     return { days: NaN, label: 'unbekannt', urgency: 'past' };
  if (days < 0)          return { days, label: 'vorbei',    urgency: 'past' };
  if (days === 0)        return { days, label: 'heute',     urgency: 'today' };
  if (days === 1)        return { days, label: 'morgen',    urgency: 'urgent' };
  if (days <= 3)         return { days, label: `in ${days} Tagen`, urgency: 'urgent' };
  return                       { days, label: `in ${days} Tagen`, urgency: 'normal' };
}

// Cleanup beim App-Start: Eintraege mit date < today-7 Tage rauswerfen.
// Async, fire-and-forget — User wartet nicht auf den Schreibpfad.
async function cleanupPastExams() {
  if (!currentUser) return;
  const exams = userData?.exams;
  if (!Array.isArray(exams) || !exams.length) return;
  const fresh = exams.filter(ex => {
    const days = _diffDaysFromToday(ex?.date);
    return days === null ? true : days >= -7;
  });
  if (fresh.length === exams.length) return;        // nix zu tun
  userData.exams = fresh;
  try {
    await saveExams(currentUser.uid, fresh);
  } catch (e) {
    console.warn('[cleanupPastExams]', e);
  }
}

// Topic-Loader fuer Modal: Subject + Klassenstufe → Liste {key, name, yearId, topicId}.
// Klassen-neutrale Years (kein "Klasse-N"-Pattern, z.B. "Grammatik") werden mit
// gerendert — gleiche Logik wie getDailyChallengeQuestions-Filter.
function _loadKlausurTopics(subjectId, klasse) {
  const subject = structure?.[subjectId];
  if (!subject) return [];
  const klPattern = klasse ? new RegExp(`^Klasse[-_]?${klasse}$`, 'i') : null;
  const isClassYearRe = /^Klasse[-_]?\d+$/i;
  const topics = [];
  Object.values(subject.years || {}).forEach(year => {
    const isClassYear = isClassYearRe.test(year.id);
    if (klPattern && isClassYear && !klPattern.test(year.id)) return;
    Object.values(year.topics || {}).forEach(t => {
      const key = `${subject.id}__${year.id}__${t.id}`;
      topics.push({ key, name: t.name || t.id, yearId: year.id, topicId: t.id });
    });
  });
  topics.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return topics;
}

// Modal-State (in-modul, nicht auf window).
let _klausurModalState = null;

function openKlausurModal() {
  if (_blockClaudeWrite('Klausur eintragen')) return;
  if (document.getElementById('klausurModalOverlay')) return;
  const today = _KLAUSUR_TODAY();
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 7);
  // F-02 Cycle-6: Default-Plan = 5 Tage vor Klausur, 30 Min/Tag.
  // Plan-Felder sind optional — initial leer, User kann eintragen oder
  // weglassen. Wenn beide leer bleiben: kein plan im Exam-Objekt.
  const defaultPlanStart = new Date(defaultDate);
  defaultPlanStart.setDate(defaultPlanStart.getDate() - 5);
  _klausurModalState = {
    date: defaultDate.toISOString().slice(0, 10),
    subject: '',
    klasse: userData?.klasse ? String(userData.klasse) : '',
    topicIds: [],
    // Plan-Felder leer initialisiert — User entscheidet aktiv ob er sie nutzt.
    planStartDate: '',
    planMinutesPerDay: '',
    planStartDefault: defaultPlanStart.toISOString().slice(0, 10),
    errors: {},
    minDate: today
  };
  const overlay = document.createElement('div');
  overlay.className = 'lf-modal-overlay';
  overlay.id = 'klausurModalOverlay';
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeKlausurModal();
  });
  document.body.appendChild(overlay);
  _renderKlausurModalContent();
}

function closeKlausurModal() {
  document.getElementById('klausurModalOverlay')?.remove();
  _klausurModalState = null;
}

function _renderKlausurModalContent() {
  const overlay = document.getElementById('klausurModalOverlay');
  if (!overlay || !_klausurModalState) return;
  const s = _klausurModalState;
  const subjects = Object.values(structure || {});
  const showTopicSection = !!(s.subject && s.klasse);
  const topics = showTopicSection ? _loadKlausurTopics(s.subject, s.klasse) : [];
  const err = (k) => s.errors[k]
    ? `<div class="error-msg" style="margin-top:6px">${escapeHtml(s.errors[k])}</div>`
    : '';
  const topicListHtml = !showTopicSection
    ? `<div class="form-hint">Waehle erst Fach und Klassenstufe.</div>`
    : (topics.length === 0
        ? `<div class="form-hint">Keine Themen f\xfcr Klasse ${escapeHtml(s.klasse)} in ${escapeHtml(structure?.[s.subject]?.name || s.subject)} gefunden. Wechsle die Klassenstufe oder lege erst Themen an.</div>`
        : `<div class="klausur-topic-checklist">${topics.map(t => {
            const checked = s.topicIds.includes(t.key) ? 'checked' : '';
            return `
              <label class="klausur-topic-checkbox">
                <input type="checkbox" ${checked} onchange="window.LF.toggleKlausurTopic('${escapeHtml(t.key).replace(/'/g, '&#39;')}')">
                <span>${escapeHtml(t.name)}</span>
              </label>`;
          }).join('')}</div>`);
  overlay.innerHTML = `
    <div class="lf-modal-card klausur-modal">
      <div class="lf-modal-header">
        <h3>Klausur eintragen</h3>
        <button class="btn-icon" onclick="window.LF.closeKlausurModal()" aria-label="Schlie\xdfen">${lfIcon('x')}</button>
      </div>
      <div class="lf-modal-body">
        <div class="klausur-form-row">
          <label class="form-label">Wann ist die Klausur?</label>
          <input type="date" class="form-input" id="klausurDate"
                 min="${escapeHtml(s.minDate)}"
                 value="${escapeHtml(s.date)}"
                 oninput="window.LF.onKlausurDateChange(this.value)">
          ${err('date')}
        </div>
        <div class="klausur-form-row">
          <label class="form-label">Welches Fach?</label>
          <select class="form-input" onchange="window.LF.onKlausurSubjectChange(this.value)">
            <option value="">— Fach w\xe4hlen —</option>
            ${subjects.map(sub => `<option value="${escapeHtml(sub.id)}" ${s.subject === sub.id ? 'selected' : ''}>${escapeHtml(sub.name)}</option>`).join('')}
          </select>
          ${err('subject')}
        </div>
        <div class="klausur-form-row">
          <label class="form-label">Klassenstufe</label>
          <select class="form-input" onchange="window.LF.onKlausurKlasseChange(this.value)">
            <option value="">— Klasse w\xe4hlen —</option>
            ${[5,6,7,8,9,10,11,12,13].map(k => `<option value="${k}" ${String(s.klasse) === String(k) ? 'selected' : ''}>Klasse ${k}</option>`).join('')}
          </select>
          ${err('klasse')}
        </div>
        <div class="klausur-form-row">
          <label class="form-label">Welche Themen kommen dran?</label>
          ${topicListHtml}
          ${err('topicIds')}
        </div>
        <div class="form-hint" style="margin-top:12px">Die letzten 3 Tage vor der Klausur boosten wir deine Daily Challenge und die Wiederholungs-Kiste auf diese Themen.</div>

        <!-- F-02 Cycle-6: Plan-Sektion (optional). Wenn Felder gefuellt werden,
             erscheint das Bereitschafts-Widget auf dem Dashboard ab startDate. -->
        <div class="klausur-form-section-title">Lern-Plan (optional)</div>
        <div class="klausur-form-row">
          <label class="form-label">Ab wann lernen?</label>
          <input type="date" class="form-input" id="klausurPlanStart"
                 value="${escapeHtml(s.planStartDate || '')}"
                 placeholder="${escapeHtml(s.planStartDefault || '')}"
                 oninput="window.LF.onKlausurPlanStartChange(this.value)">
          <div class="form-hint">Default: 5 Tage vor der Klausur (${escapeHtml(s.planStartDefault || '')}).</div>
          ${err('planStart')}
        </div>
        <div class="klausur-form-row">
          <label class="form-label">Wie viele Minuten pro Tag?</label>
          <input type="number" class="form-input" id="klausurPlanMin"
                 min="5" max="600" step="5"
                 value="${escapeHtml(String(s.planMinutesPerDay || ''))}"
                 placeholder="30"
                 oninput="window.LF.onKlausurPlanMinChange(this.value)">
          <div class="form-hint">30 Min ist ein guter Richtwert.</div>
          ${err('planMin')}
        </div>
      </div>
      <div class="lf-modal-actions">
        <button class="btn btn-ghost" onclick="window.LF.closeKlausurModal()">Abbrechen</button>
        <button class="btn btn-primary" onclick="window.LF.submitKlausur()">Speichern</button>
      </div>
    </div>`;
}

async function submitKlausur() {
  if (!_klausurModalState) return;
  if (_blockClaudeWrite('Klausur eintragen')) return;
  const s = _klausurModalState;
  s.errors = {};
  // Validation
  if (!s.date) {
    s.errors.date = 'Bitte ein Datum heute oder sp\xe4ter w\xe4hlen.';
  } else {
    const days = _diffDaysFromToday(s.date);
    if (days === null || days < 0) {
      s.errors.date = 'Bitte ein Datum heute oder sp\xe4ter w\xe4hlen.';
    }
  }
  if (!s.subject) s.errors.subject = 'Bitte ein Fach w\xe4hlen.';
  if (!s.klasse)  s.errors.klasse  = 'Bitte eine Klassenstufe w\xe4hlen.';
  if (!s.topicIds || s.topicIds.length === 0) {
    s.errors.topicIds = 'W\xe4hle mindestens ein Thema aus.';
  }

  // F-02 Cycle-6: Plan-Validierung. Plan ist optional — beide Felder muessen
  // entweder beide leer (= kein Plan) oder beide gesetzt sein. Min-Cap = 1
  // (Marcus' Schema akzeptiert 1..600), aber UX-Hinweis ist 5+.
  let planObj = null;
  const planStartRaw = (s.planStartDate || '').trim();
  const planMinRaw   = String(s.planMinutesPerDay || '').trim();
  if (planStartRaw || planMinRaw) {
    if (!planStartRaw)  s.errors.planStart = 'Datum fehlt — oder beide Felder leer lassen.';
    if (!planMinRaw)    s.errors.planMin   = 'Minuten fehlen — oder beide Felder leer lassen.';
    if (planStartRaw && !/^\d{4}-\d{2}-\d{2}$/.test(planStartRaw)) {
      s.errors.planStart = 'Datum-Format ung\xfcltig.';
    }
    const minNum = parseInt(planMinRaw, 10);
    if (planMinRaw && (!Number.isFinite(minNum) || minNum < 1 || minNum > 600)) {
      s.errors.planMin = 'Bitte 1 bis 600 Minuten pro Tag.';
    }
    if (planStartRaw && s.date && planStartRaw > s.date) {
      s.errors.planStart = 'Lern-Start darf nicht nach der Klausur sein.';
    }
    if (!s.errors.planStart && !s.errors.planMin) {
      planObj = { startDate: planStartRaw, minutesPerDay: minNum };
    }
  }

  if (Object.keys(s.errors).length) {
    _renderKlausurModalContent();
    return;
  }
  if (!currentUser) {
    showToast('Nicht eingeloggt.', 'error');
    return;
  }
  const newExam = {
    id: (crypto?.randomUUID?.() || ('exam-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10))),
    subject: s.subject,
    klasse: String(s.klasse),
    date: s.date,
    topicIds: [...s.topicIds],
    createdAt: Date.now()
  };
  // F-02: Plan + dailyStats nur setzen wenn User Plan-Felder ausgefuellt hat.
  if (planObj) {
    newExam.plan = planObj;
    newExam.dailyStats = {};
  }
  const oldExams = Array.isArray(userData?.exams) ? userData.exams : [];
  const newArr   = [...oldExams, newExam];
  try {
    await saveExams(currentUser.uid, newArr);
  } catch (e) {
    console.error('[saveExams]', e);
    showToast('Speichern fehlgeschlagen — versuch es nochmal.', 'error');
    return;
  }
  userData = userData || {};
  userData.exams = newArr;
  closeKlausurModal();
  showToast('Klausur gespeichert.', 'success');
  if (location.hash === '#/lernen') renderLernen();
  // F1 (Casey/Wave-2): zur frisch eingetragenen Klausur scrollen + 2s Pulse,
  // damit der User sieht WO seine Eingabe gelandet ist (vorher: Modal zu, Toast,
  // Karte irgendwo unten in der Liste).
  setTimeout(() => {
    const card = document.querySelector(`.klausur-card[data-exam-id="${newExam.id}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('card-just-created');
    setTimeout(() => card.classList.remove('card-just-created'), 2200);
  }, 60);
}

async function deleteKlausur(examId) {
  if (_blockClaudeWrite('Klausur l\xf6schen')) return;
  if (!confirm('Klausur wirklich l\xf6schen?')) return;
  const oldExams = Array.isArray(userData?.exams) ? userData.exams : [];
  const newArr = oldExams.filter(e => e?.id !== examId);
  if (newArr.length === oldExams.length) return;        // nichts geaendert
  if (!currentUser) return;
  try {
    await saveExams(currentUser.uid, newArr);
  } catch (e) {
    console.error('[saveExams]', e);
    showToast('L\xf6schen fehlgeschlagen — versuch es nochmal.', 'error');
    return;
  }
  userData.exams = newArr;
  showToast('Klausur entfernt.', 'success');
  if (location.hash === '#/lernen') renderLernen();
}

function renderKlausurCard(exam) {
  if (!exam || typeof exam !== 'object') return '';
  const cd = getExamCountdown(exam.date);
  const subj = structure?.[exam.subject];
  const subjName = subj?.name || exam.subject;
  // Datum schoen formatieren ("Di · 14. Mai 2026")
  let formattedDate = '';
  try {
    const [y, m, d] = exam.date.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    const wd  = dateObj.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '');
    const mon = dateObj.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
    formattedDate = `${wd} \xb7 ${mon}`;
  } catch { formattedDate = exam.date; }
  const cdClass = cd.urgency === 'today'  ? 'klausur-countdown-today'
                : cd.urgency === 'urgent' ? 'klausur-countdown-urgent'
                : cd.urgency === 'past'   ? 'klausur-countdown-past'
                : '';
  // Topic-Pills (max 4 visible + Sammler)
  const topicIds = Array.isArray(exam.topicIds) ? exam.topicIds : [];
  const pills = topicIds.slice(0, 4).map(key => {
    const [sid, yid, tid] = key.split('__');
    const topic = structure?.[sid]?.years?.[yid]?.topics?.[tid];
    const tname = topic?.name || tid || key;
    return `<button class="klausur-pill" onclick="location.hash='#/fach/${escapeHtml(sid)}/${escapeHtml(yid)}/${escapeHtml(tid)}'">${escapeHtml(tname)}</button>`;
  }).join('');
  const moreCount = topicIds.length - 4;
  const morePill = moreCount > 0 ? `<span class="klausur-pill klausur-pill-more">+${moreCount}</span>` : '';
  const isPast = cd.urgency === 'past';
  const isUrgent = cd.urgency === 'urgent' || cd.urgency === 'today';
  const boostPill = isUrgent
    ? `<span class="klausur-boost-pill">${lfIcon('zap', { cls: 'lf-icon-sm' })} Daily-Boost aktiv</span>`
    : '';
  return `
    <div class="klausur-card${isPast ? ' klausur-card-past' : ''}" data-exam-id="${escapeAttr(exam.id || '')}">
      <div class="klausur-card-header">
        <div class="klausur-card-title-row">
          <span class="klausur-card-icon" style="--subject-color:${getSubjectColor(exam.subject)}">${getSubjectIcon(exam.subject)}</span>
          <div>
            <div class="klausur-card-title">${escapeHtml(subjName)}</div>
            <div class="klausur-card-date">${escapeHtml(formattedDate)}</div>
          </div>
        </div>
        <div class="klausur-countdown ${cdClass}">${escapeHtml(cd.label)}</div>
      </div>
      ${(pills || morePill) ? `<div class="klausur-topic-pills">${pills}${morePill}</div>` : ''}
      <div class="klausur-card-footer">
        ${boostPill}
        <button class="btn-icon klausur-delete-btn" aria-label="Klausur l\xf6schen"
                onclick="window.LF.deleteKlausur('${escapeHtml(exam.id).replace(/'/g, '&#39;')}')">${lfIcon('trash-2')}</button>
      </div>
    </div>`;
}

function renderKlausurSection() {
  const exams = Array.isArray(userData?.exams) ? userData.exams : [];
  if (exams.length === 0) {
    return `
      <div class="klausur-section">
        <div class="klausur-empty-state" onclick="window.LF.openKlausurModal()">
          <div class="klausur-empty-icon">${lfIcon('calendar')}</div>
          <div class="klausur-empty-body">
            <div class="klausur-empty-title">Klausur eintragen</div>
            <div class="klausur-empty-sub">Trag deinen n\xe4chsten Termin ein — App boostet die letzten 3 Tage Daily und Wiederholung.</div>
          </div>
          <button class="btn btn-primary" onclick="event.stopPropagation();window.LF.openKlausurModal()">Klausur eintragen</button>
        </div>
      </div>`;
  }
  // Sortiert nach Datum (aufsteigend), defekte Eintraege ans Ende.
  const sorted = [...exams].sort((a, b) => {
    const da = _diffDaysFromToday(a?.date);
    const db = _diffDaysFromToday(b?.date);
    if (da === null && db === null) return 0;
    if (da === null) return  1;
    if (db === null) return -1;
    return da - db;
  });
  return `
    <div class="klausur-section">
      <div class="section-title" style="margin-top:0">${lfIcon('calendar')} Deine Klausuren</div>
      <div class="klausur-list">
        ${sorted.map(renderKlausurCard).join('')}
      </div>
      <button class="btn btn-secondary klausur-add-btn" onclick="window.LF.openKlausurModal()">+ Klausur eintragen</button>
    </div>`;
}

// ── F-4: Heute-Zuerst-Card ────────────────────────────────────
// Pure Komposition aus existierenden Helpers. Priority-Stack siehe Maya-Spec
// §1. Jeder Step ist defensiv — fehlende Daten = Step ueberspringen, kein
// Crash propagiert. Step 6 (Fallback) ist immer erreichbar.

function _decideStep1Klausur() {
  const exams = Array.isArray(userData?.exams) ? userData.exams : [];
  if (!exams.length) return null;
  // Klausuren in [0, 7] Tagen, sortiert nach Naehe.
  const candidates = exams
    .map(ex => ({ ex, days: _diffDaysFromToday(ex?.date) }))
    .filter(o => o.days !== null && o.days >= 0 && o.days <= 7
                 && Array.isArray(o.ex.topicIds) && o.ex.topicIds.length > 0)
    .sort((a, b) => a.days - b.days);
  for (const { ex, days } of candidates) {
    // Topic mit hoechster Note (>=4) zuerst, sonst Note 3, sonst nie getestet, sonst erstes.
    const grades = userData?.grades || {};
    const validTopics = ex.topicIds.filter(key => {
      const [sid, yid, tid] = key.split('__');
      return !!structure?.[sid]?.years?.[yid]?.topics?.[tid];
    });
    if (!validTopics.length) continue;
    const ranked = validTopics.map(key => {
      const g = grades[key];
      const grade = g?.grade ?? null;
      // "Schwaeche-Score": je groesser, desto schwaecher. nie-getestet = 5.
      const score = grade === null ? 5 : grade;
      return { key, score, grade };
    }).sort((a, b) => b.score - a.score);
    const pick = ranked[0];
    const [sid, yid, tid] = pick.key.split('__');
    const subj = structure?.[sid];
    const topic = subj?.years?.[yid]?.topics?.[tid];
    const subjName = subj?.name || sid;
    const topicName = topic?.name || tid;
    const allUntested = ranked.every(r => r.grade === null);
    let sub;
    if (days === 0) sub = `${subjName}-Klausur ist heute — letzter Schliff?`;
    else if (allUntested) sub = `${subjName}-Klausur ${days === 1 ? 'morgen' : `in ${days} Tagen`} — fang mit ${topicName} an.`;
    else sub = `${subjName}-Klausur ${days === 1 ? 'morgen' : `in ${days} Tagen`} — \xfcb das schw\xe4chste Thema.`;
    return {
      kind: 'klausur',
      payload: { ex, days, urgent: days <= 3 },
      icon: days <= 3 ? 'triangle-alert' : 'calendar',
      iconUrgent: days <= 3,
      sub,
      cta: 'Jetzt \xfcben',
      hash: `#/fach/${sid}/${yid}/${tid}`
    };
  }
  return null;
}

function _decideStep2Daily() {
  const today = _KLAUSUR_TODAY();
  if (userData?.dailyChallenges?.[today]) return null;
  return {
    kind: 'daily',
    icon: 'zap',
    sub: 'Deine Daily Challenge wartet — 5 Min, 6 Fragen, Bonus-XP.',
    cta: 'Daily starten',
    hash: '#/daily-challenge'
  };
}

function _decideStep3SRS() {
  const due = getSRSDueCount();
  if (due < 5) return null;
  return {
    kind: 'srs',
    icon: 'layers',
    sub: `${due} Karten sind heute f\xe4llig — kurz wiederholen, langfristig behalten.`,
    cta: 'Wiederholen',
    hash: '#/srs'
  };
}

function _decideStep4Recommend() {
  const recs = (typeof getRecommendations === 'function') ? (getRecommendations() || []) : [];
  if (!recs.length) return null;
  const r = recs[0];
  const subj = structure?.[r.subjectId];
  const subjName = subj?.name || r.subjectId;
  const topicName = r.topic?.name || r.topicId;
  return {
    kind: 'recommend',
    icon: 'target',
    sub: `${r.reason} — ${subjName} \xb7 ${topicName}`,
    cta: 'Schwachstelle \xfcben',
    hash: `#/fach/${r.subjectId}/${r.yearId}/${r.topicId}`
  };
}

function _decideStep5NewTopic() {
  const klasse = userData?.klasse;
  if (!klasse) return null;
  const grades = userData?.grades || {};
  const klRe = new RegExp(`^Klasse[-_]?${klasse}$`, 'i');
  for (const subject of Object.values(structure || {})) {
    for (const year of Object.values(subject.years || {})) {
      if (!klRe.test(year.id)) continue;
      const topicIds = Object.keys(year.topics || {}).sort();
      for (const tid of topicIds) {
        const key = `${subject.id}__${year.id}__${tid}`;
        if (!grades[key]) {
          const topic = year.topics[tid];
          const subjName  = subject.name || subject.id;
          const topicName = topic?.name || tid;
          return {
            kind: 'newTopic',
            icon: 'map',
            // H3 (Casey/Wave-2): konkretes Topic statt generischer "Lust auf was Neues?"-Frage.
            sub: `Du hast deine Pflicht f\xfcr heute. Probier mal ${subjName} \xb7 ${topicName}.`,
            cta: 'Neues Thema entdecken',
            hash: `#/fach/${subject.id}/${year.id}/${tid}`,
            payload: { subjectName: subjName, topicName }
          };
        }
      }
    }
  }
  return null;
}

function _decideStep6Fallback() {
  return {
    kind: 'fallback',
    icon: 'book-open',
    sub: 'W\xe4hle dein erstes Fach unten und leg los.',
    cta: 'Zu den F\xe4chern',
    hash: '#/lernen'
  };
}

function decideHeuteZuerstStep() {
  return _decideStep1Klausur()
      || _decideStep2Daily()
      || _decideStep3SRS()
      || _decideStep4Recommend()
      || _decideStep5NewTopic()
      || _decideStep6Fallback();
}

// ── F-02 Klausur-Bereitschafts-Widget (Cycle 6, Maya-Spec) ─────────────
// Auf dem Dashboard zwischen Hero und Daily-Challenge. Erscheint pro Klausur,
// wenn (a) plan vorhanden, (b) heute >= plan.startDate, (c) days_left <= 5
// (Maya: "5 Tage vorher t\xe4glicher Bereitschaftscheck"). Stack max 3 sichtbar.
//
// Datenpfad: userData.exams[].plan + .dailyStats. Tages-Konfidenz in
// dailyStats[YYYY-MM-DD].confidence (1..5). Tages-Lernzeit in .minutes.
// Beide writes via saveExams (set+merge auf das ganze exams-Array).
function renderKlausurReadinessWidgets() {
  const exams = Array.isArray(userData?.exams) ? userData.exams : [];
  if (exams.length === 0) return '';
  const today = _KLAUSUR_TODAY();
  const candidates = exams
    .map(ex => {
      if (!ex || !ex.plan || !ex.plan.startDate || !ex.plan.minutesPerDay) return null;
      const days = _diffDaysFromToday(ex.date);
      if (days === null || days < 0 || days > 5) return null;
      if (today < ex.plan.startDate) return null;       // Plan-Start noch nicht erreicht
      return { ex, days };
    })
    .filter(Boolean)
    .slice(0, 3);                                       // Max 3 sichtbar (Maya-Spec)
  if (candidates.length === 0) return '';
  return candidates.map(({ ex, days }) => _renderKlausurReadinessWidget(ex, days, today)).join('');
}

function _renderKlausurReadinessWidget(exam, days, todayStr) {
  const subj = structure?.[exam.subject];
  const subjName = subj?.name || exam.subject;
  const stats = exam.dailyStats || {};
  const todayStats = stats[todayStr] || {};
  const todayMin = typeof todayStats.minutes === 'number' ? todayStats.minutes : 0;
  const planMin = exam.plan.minutesPerDay;
  const pct = Math.min(100, Math.round((todayMin / Math.max(1, planMin)) * 100));
  const examDayMode = days === 0;
  const todayConf = (typeof todayStats.confidence === 'number'
                  && todayStats.confidence >= 1 && todayStats.confidence <= 5)
    ? todayStats.confidence : null;

  // Title nach Spec
  let title;
  if (examDayMode)    title = `Heute ist ${escapeHtml(subjName)}-Klausur. Viel Erfolg.`;
  else if (days === 1) title = `${escapeHtml(subjName)} morgen`;
  else                 title = `${escapeHtml(subjName)} in ${days} Tagen`;

  // Konfidenz-Slider (Reuse F-09-Pattern via _renderConfidenceStars).
  // Picker-ID pro Exam, damit mehrere Widgets nebeneinander funktionieren.
  const pid = `examConf_${exam.id}`;
  // Wenn der User heute schon was eingetragen hat, picker-default = der Wert.
  if (typeof _confidencePickers[pid] !== 'number') {
    _confidencePickers[pid] = todayConf || 0;
  }
  const stars = _renderConfidenceStars(pid, _confidencePickers[pid] || todayConf || 0);
  const confLabel = todayConf
    ? `Heute: ${todayConf}/5 — \xe4ndern?`
    : (examDayMode ? 'Wie sicher f\xfchlst du dich jetzt?' : 'Wie sicher heute?');

  // Mini-Verlauf der letzten 5 Tage (Konfidenz + reality from boosted-Tests).
  const sortedDates = Object.keys(stats).sort();
  const last5 = sortedDates
    .filter(d => d <= todayStr)
    .slice(-6)                                          // bis zu 6 Tage = inkl. heute
    .map(d => {
      const v = stats[d] || {};
      return {
        date: d,
        confidence: typeof v.confidence === 'number' ? v.confidence : null,
        reality: typeof v.realityScore === 'number' ? Math.round(v.realityScore * 5) : null
      };
    });
  const hasHistory = last5.some(p => p.confidence !== null || p.reality !== null);
  const historyHtml = hasHistory ? (() => {
    const W = 280, H = 70, padX = 8, padY = 8;
    const innerW = W - 2 * padX;
    const innerH = H - 2 * padY;
    const n = last5.length;
    const xFor = (i) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = (v) => padY + (1 - (v / 5)) * innerH;
    const linePath = (key) => {
      const points = last5
        .map((p, i) => p[key] !== null ? `${xFor(i).toFixed(1)},${yFor(p[key]).toFixed(1)}` : null)
        .filter(Boolean);
      if (points.length === 0) return '';
      return 'M' + points.join(' L');
    };
    const dots = (key, color) => last5
      .map((p, i) => p[key] !== null
        ? `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p[key]).toFixed(1)}" r="3" fill="${color}"/>`
        : '')
      .join('');
    return `
      <div class="klausur-readiness-history">
        <div class="klausur-readiness-history-title">Verlauf (letzte Tage)</div>
        <svg class="confidence-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
          <path d="${linePath('confidence')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="${linePath('reality')}" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          ${dots('confidence', 'var(--accent)')}
          ${dots('reality', 'var(--success)')}
        </svg>
        <div class="confidence-chart-legend">
          <span><span class="confidence-chart-legend-dot" style="background:var(--accent)"></span>Konfidenz</span>
          <span><span class="confidence-chart-legend-dot" style="background:var(--success)"></span>Realit\xe4t</span>
        </div>
      </div>`;
  })() : '';

  // Klausurtag-Rueckblick: erste vs aktuelle Konfidenz vergleichen.
  let examDayMsg = '';
  if (examDayMode) {
    const confValues = sortedDates
      .map(d => stats[d]?.confidence)
      .filter(c => typeof c === 'number');
    if (confValues.length >= 2) {
      const first = confValues[0];
      const current = todayConf || confValues[confValues.length - 1];
      // Sophie cycle-7-fix: actual days-elapsed since the first entry, not
      // count-of-entries. Bug: User der nur 3 von 5 Tagen geloggt hat sah
      // "Vor 2 Tagen" statt "Vor 5 Tagen". sortedDates[0] ist YYYY-MM-DD →
      // _diffDaysFromToday liefert negative Differenz fuer Vergangenheit.
      const dd = _diffDaysFromToday(sortedDates[0]);
      const diffDays = (typeof dd === 'number') ? Math.abs(dd) : (sortedDates.length - 1);
      if (current - first > 1) {
        examDayMsg = `Vor ${diffDays} Tagen warst du bei ${first}/5 — spitze!`;
      } else if (Math.abs(current - first) <= 1) {
        examDayMsg = 'Konfidenz stabil \xfcber die Tage. Du wei\xdft was du kannst.';
      } else {
        examDayMsg = 'Konfidenz ist gesunken — kennst du den Stoff besser als gedacht?';
      }
    }
  }

  return `
    <div class="klausur-readiness-widget${examDayMode ? ' is-exam-day' : ''}" data-exam-id="${escapeAttr(exam.id || '')}">
      <div class="klausur-readiness-title">${title}</div>
      ${examDayMode ? '' : `
        <div class="klausur-readiness-progress">
          <span class="klausur-readiness-progress-label">Heute: ${todayMin} / ${planMin} Min</span>
          <div class="klausur-readiness-progress-bar"><div class="klausur-readiness-progress-fill" style="width:${pct}%"></div></div>
        </div>`}
      <div class="klausur-readiness-confidence-row">
        <div class="confidence-stars-q">${escapeHtml(confLabel)}</div>
        <div class="confidence-stars" id="confidenceStars_${pid}">${stars}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
          <button class="btn btn-primary btn-sm" onclick="window.LF.saveExamDailyConfidence('${escapeAttr(exam.id || '')}')">Speichern</button>
        </div>
      </div>
      ${historyHtml}
      ${examDayMsg ? `<div class="klausur-readiness-msg">${escapeHtml(examDayMsg)}</div>` : ''}
    </div>`;
}

// F-02 Cycle-6: Lernzeit pro Klausur-Plan aggregieren. Wird vom Pomodoro-
// Timer aufgerufen — addiert `minutes` zu dailyStats[today].minutes fuer
// alle Klausuren mit aktivem Plan-Fenster (heute >= startDate, heute <= date).
// Fire-and-forget, nicht await'en weil Pomodoro-Tick nicht blockieren darf.
//
// Sophie P2-4 (Cycle 7): topic-aware. Wenn `topicKey` gesetzt ist, werden
// die Minuten NUR auf Klausuren deren topicIds den Key enthalten gebucht.
// Ohne topicKey (Pomodoro lief nicht auf einer Topic-Seite) faellt es auf
// Alt-Verhalten zurueck (alle aktiven Plaene) — sonst gehen Minuten verloren.
async function _addExamStudyMinutes(minutes, topicKey) {
  if (!currentUser || !minutes || minutes <= 0) return;
  const exams = Array.isArray(userData?.exams) ? userData.exams : [];
  if (exams.length === 0) return;
  const today = _KLAUSUR_TODAY();
  let changed = false;
  const newExams = exams.map(ex => {
    if (!ex?.plan?.startDate || !ex.plan.minutesPerDay) return ex;
    if (today < ex.plan.startDate) return ex;
    const days = _diffDaysFromToday(ex.date);
    if (days === null || days < 0) return ex;
    // Topic-Filter: nur Klausuren mit overlapping topicIds bekommen die
    // Minuten gutgeschrieben. Fallback ohne topicKey = alle aktiven Plaene.
    if (topicKey) {
      const topicIds = Array.isArray(ex.topicIds) ? ex.topicIds : [];
      if (!topicIds.includes(topicKey)) return ex;
    }
    const ds = { ...(ex.dailyStats || {}) };
    const cur = ds[today] || {};
    const prevMin = typeof cur.minutes === 'number' ? cur.minutes : 0;
    ds[today] = { ...cur, minutes: prevMin + minutes };
    changed = true;
    return { ...ex, dailyStats: ds };
  });
  if (!changed) return;
  // Cycle-7 P2-A (Marcus, 2026-05-08, Ramsey audit): assign userData.exams
  // ONLY AFTER successful saveExams — vorher war die Reihenfolge mutate-
  // first-then-await, was bei einer rule-rejection oder defense-in-depth-
  // Validierung in saveExams (z.B. dailyStats[today].minutes ueber dem
  // 1440-Min-Cap nach mehreren Pomodoro-Sessions) zu in-memory/server-
  // Drift fuehrt. Frontend zeigt dann die mutierte Lokalkopie waehrend der
  // Server den alten Wert haelt — naechster Reload "rollt" den Eintrag
  // zurueck und der User glaubt der Pomodoro-Tick wurde verloren. Mit der
  // korrigierten Reihenfolge bleibt userData.exams bei einem Save-Fail
  // unangetastet und der Drift kann nicht entstehen.
  try {
    await saveExams(currentUser.uid, newExams);
    userData.exams = newExams;
  } catch (e) {
    console.warn('[_addExamStudyMinutes]', e);
  }
}

// Save handler: schreibt confidence in exam.dailyStats[today], persistiert
// das ganze exams-Array via saveExams (Hard rule 4: set+merge).
window.LF.saveExamDailyConfidence = async (examId) => {
  if (!currentUser) return;
  const exams = Array.isArray(userData?.exams) ? userData.exams : [];
  const idx = exams.findIndex(e => e?.id === examId);
  if (idx < 0) return;
  const pid = `examConf_${examId}`;
  const val = _confidencePickers[pid];
  if (typeof val !== 'number' || val < 1 || val > 5) {
    showToast('Bitte erst Sterne ausw\xe4hlen.', 'info');
    return;
  }
  const today = _KLAUSUR_TODAY();
  const newExams = exams.map((e, i) => {
    if (i !== idx) return e;
    const ds = { ...(e.dailyStats || {}) };
    const todayEntry = { ...(ds[today] || {}), confidence: val };
    ds[today] = todayEntry;
    return { ...e, dailyStats: ds };
  });
  try {
    await saveExams(currentUser.uid, newExams);
    userData.exams = newExams;
    delete _confidencePickers[pid];
    showToast('Konfidenz gespeichert.', 'success');
    if (location.hash === '#/' || location.hash === '') renderDashboard();
  } catch (e) {
    console.error('[saveExamDailyConfidence]', e);
    showToast('Speichern fehlgeschlagen.', 'error');
  }
};

function renderHeuteZuerstCard() {
  let step;
  try { step = decideHeuteZuerstStep(); } catch (e) {
    console.warn('[heuteZuerst]', e);
    step = _decideStep6Fallback();
  }
  const iconCls = step.iconUrgent ? 'heute-zuerst-icon heute-zuerst-icon-urgent' : 'heute-zuerst-icon';
  return `
    <div class="heute-zuerst-card${step.iconUrgent ? ' heute-zuerst-card-urgent' : ''}"
         onclick="location.hash='${escapeHtml(step.hash)}'">
      <div class="${iconCls}">${lfIcon(step.icon, { cls: 'lf-icon-lg' })}</div>
      <div class="heute-zuerst-body">
        <div class="heute-zuerst-eyebrow">Heute zuerst</div>
        <div class="heute-zuerst-sub">${escapeHtml(step.sub)}</div>
      </div>
      <button class="btn btn-primary heute-zuerst-cta" onclick="event.stopPropagation();location.hash='${escapeHtml(step.hash)}'">${escapeHtml(step.cta)}</button>
    </div>`;
}

// ── Lernen-Hub (Mission 1, neu) ──────────
// Daily Challenge + SRS + Lesezeichen + Suche + komplettes Fächer-Grid.
// Ersetzt das Fächer-Grid auf Dashboard (das nur noch Top-3-Schnellstart hat).
function renderLernen() {
  const subjects = Object.values(structure || {});
  const grades   = userData?.grades || {};
  const bookmarks = userData?.bookmarks || [];
  const srsDue   = getSRSDueCount();

  // V-04 (Casey/Cycle-3): Klassen-Filter — Toggle nur sichtbar wenn
  // userData.klasse gesetzt. Bestand ohne Klasse → kein Toggle, voller Status quo
  // (Maya-Spec: "KEIN Filter forcieren — sonst sieht User leeres Grid").
  const userKlasse  = userData?.klasse || null;
  const filterOn    = !!userKlasse && getLernenKlasseFilter();
  const activeKlasse = filterOn ? userKlasse : null;

  const subjectCards = subjects.length === 0
    ? `<div class="empty-state"><div class="empty-icon">${lfIcon('folder-open')}</div>Noch keine Fächer vorhanden — füge Ordner unter <code>Fächer/</code> hinzu.</div>`
    : subjects.map(s => {
        const prog = getSubjectProgress(s.id, { klasse: activeKlasse });
        const pct  = prog.total > 0 ? prog.tested / prog.total : 0;
        const circ = 100.48;
        const dash = pct * circ;
        const metaLine = activeKlasse
          ? (prog.total > 0
              ? `Klasse ${escapeHtml(String(activeKlasse))} · ${prog.total} Themen`
              : `Keine Themen f\xfcr Klasse ${escapeHtml(String(activeKlasse))}`)
          : `${Object.keys(s.years||{}).length} Klassen · ${prog.total} Themen`;
        return `
          <div class="subject-card" data-class-match="1" data-search-match="1"
               data-subject="${escapeAttr(s.id)}"
               style="--subject-color:${getSubjectColor(s.id)}"
               onclick="location.hash='#/fach/${s.id}'">
            <div class="s-card-top">
              <div>
                <div class="s-icon">${getSubjectIcon(s.id)}</div>
                <div class="s-name">${escapeHtml(s.name)}</div>
                <div class="s-meta">${metaLine}</div>
              </div>
              <svg class="progress-ring" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="16" fill="none" stroke="var(--border)" stroke-width="3"/>
                <circle cx="18" cy="18" r="16" fill="none" stroke="${getSubjectColor(s.id)}"
                  stroke-width="3" stroke-linecap="round"
                  stroke-dasharray="${dash.toFixed(1)} ${circ}"
                  transform="rotate(-90 18 18)"/>
                <text x="18" y="22" text-anchor="middle" font-size="9"
                  fill="${getSubjectColor(s.id)}" font-weight="700">${prog.total>0?Math.round(pct*100)+'%':'–'}</text>
              </svg>
            </div>
            ${prog.avgGrade ? `<div class="s-avg-grade" style="background:${avgGradeColor(prog.avgGrade)}">${prog.avgGrade.toFixed(1)}</div>` : ''}
          </div>`;
      }).join('');

  // V-04 Toggle-Pill — nur wenn Klasse gesetzt (Maya-Spec).
  const klasseToggle = userKlasse
    ? `<div class="lernen-class-toggle" role="group" aria-label="Klassen-Filter" title="Filtert Themen nach deiner Klassenstufe.">
         <button class="lernen-class-toggle-btn ${filterOn ? 'active' : ''}"
                 aria-pressed="${filterOn ? 'true' : 'false'}"
                 onclick="window.LF.toggleLernenKlassenFilter('1')">Nur Klasse ${escapeHtml(String(userKlasse))}</button>
         <button class="lernen-class-toggle-btn ${filterOn ? '' : 'active'}"
                 aria-pressed="${filterOn ? 'false' : 'true'}"
                 onclick="window.LF.toggleLernenKlassenFilter('0')">Alle Klassen</button>
       </div>`
    : '';

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Lernen' }])}
    <div class="page">
      <div class="page-header">
        <h1>${lfIcon('book-open')} Lernen</h1>
        <div class="sub">Deine Lern-Aktionen auf einen Blick.</div>
      </div>

      ${renderKlausurSection()}
      ${renderHeuteZuerstCard()}

      <div class="lernen-quick-grid">
        <div class="lernen-quick-card lernen-quick-daily" onclick="location.hash='#/daily-challenge'">
          <div class="lernen-quick-icon">${lfIcon('zap')}</div>
          <div class="lernen-quick-info">
            <div class="lernen-quick-title">Daily Challenge</div>
            <div class="lernen-quick-sub">Heute starten</div>
          </div>
        </div>
        <div class="lernen-quick-card lernen-quick-srs" onclick="location.hash='#/srs'">
          <div class="lernen-quick-icon">${lfIcon('layers')}</div>
          <div class="lernen-quick-info">
            <div class="lernen-quick-title">Wiederholen</div>
            <div class="lernen-quick-sub">${srsDue > 0 ? `${srsDue} fällig` : 'Keine Karten fällig'}</div>
          </div>
        </div>
        <div class="lernen-quick-card lernen-quick-bm" onclick="location.hash='#/lesezeichen'">
          <div class="lernen-quick-icon">${lfIcon('star')}</div>
          <div class="lernen-quick-info">
            <div class="lernen-quick-title">Lesezeichen</div>
            <div class="lernen-quick-sub">${bookmarks.length} gespeichert</div>
          </div>
        </div>
      </div>

      <div class="lernen-search-row">
        <input class="form-input" id="lernenSearch" placeholder="Fach suchen…" oninput="window.LF.filterLernenGrid(this.value)">
      </div>

      ${klasseToggle}

      <div class="section-title" style="margin-top:24px">${lfIcon('book-open')} Alle Fächer</div>
      <div class="subjects-grid" id="lernenSubjectsGrid">${subjectCards}</div>
    </div>`;
}

// ── Onboarding-Wizard (Mission 1, neu) ────
// 4 Schritte (Hallo / Klasse+Name / Avatar / Fertig). Trigger in onAuthStateChanged.
// Bestände ohne Klasse sehen nur Schritt 2+4 (Adrians Open-Q-2-Antwort).
let _onboardingState = null;
function renderOnboarding(opts = {}) {
  // existierende Overlay killen
  document.getElementById('onboardingOverlay')?.remove();
  // Bestands-User-Modus: hat onboardedAt aber keine Klasse (Bug E / Casey #3).
  const isExistingNoKlasse = !!opts.existingMissingKlasse;
  // Bestands-User ohne Klasse: nur Schritt 2 + 4. Sonst alle 4.
  _onboardingState = {
    step: opts.fromStep ?? (isExistingNoKlasse ? 2 : 1),
    name: userData?.name || currentUser?.displayName || '',
    klasse: userData?.klasse ? String(userData.klasse) : '',
    photoURL: userData?.photoURL || currentUser?.photoURL || null,
    skipSteps: isExistingNoKlasse ? [1, 3] : []
  };
  _renderOnboardingStep();
}

function _renderOnboardingStep() {
  const s = _onboardingState;
  if (!s) return;
  const overlay = document.createElement('div');
  overlay.id = 'onboardingOverlay';
  overlay.className = 'wizard-overlay';

  // Wave-4 (Maya/Bereich-5): Progress-Dots-Differenzierung. Drei States:
  //   wp-completed = vergangener Schritt (filled, kleiner)
  //   wp-current   = jetziger Schritt (filled, leicht groesser, mit Ring)
  //   wp-future    = kommender Schritt (border-only)
  // Bestand-User-Modus (skipSteps.length > 0): nur die wirklich gemachten
  // Schritte zaehlen — User sieht z.B. 2 Dots fuer 2 Schritte, nicht 4.
  // active-Param ist der absolute Step (1-4); wir mappen ihn auf den 0-basierten
  // Index der NICHT-geskippten Steps.
  const dots = (active) => {
    const skipSet = new Set(_onboardingState?.skipSteps || []);
    const visibleSteps = [1,2,3,4].filter(n => !skipSet.has(n));
    const total = visibleSteps.length || 4;
    const currentIdx = visibleSteps.indexOf(active);
    return `<div class="wizard-progress-dots">${
      Array.from({length: total}, (_, i) => {
        const cls = i < currentIdx ? 'wp-completed'
                  : i === currentIdx ? 'wp-current'
                  : 'wp-future';
        return `<span class="wp-dot ${cls}"></span>`;
      }).join('')
    }</div>`;
  };

  let body = '';
  if (s.step === 1) {
    // Wave-4 (Maya/Bereich-5): klares Wert-Versprechen + Brand-Logo statt
    // generischem zap-Icon. Logo lebt in assets/icons/icon.svg (PWA-Icon).
    body = `
      <div class="wizard-step">
        <div class="wizard-logo">
          <img src="assets/icons/icon.svg" alt="LearningForge" class="wizard-logo-img">
        </div>
        <h2>Willkommen bei LearningForge!</h2>
        <p>Tests schreiben, Schw\xe4chen erkennen, Streak halten. Schauen wir mal in 4 Schritten.</p>
        ${dots(1)}
        <div class="wizard-actions">
          <button class="btn btn-ghost" onclick="window.LF.onboardingSkipAll()">\xdcberspringen</button>
          <button class="btn btn-primary btn-lg" onclick="window.LF.onboardingNext()">Los geht's</button>
        </div>
      </div>`;
  } else if (s.step === 2) {
    // Wave-4 (Maya/Bereich-5): Bestand-User-Modus erkennen — User hat bereits
    // einen Namen, nur die Klassenstufe fehlt. Heading + Sub-Text sind klarer
    // ueber den Anlass des Wizards; Name-Input wird per Conditional-Render
    // ausgeblendet (defensiv noch ein hidden-Field falls _collectOnboardingState
    // ihn erwartet — Lesen mit "?.value" failt graceful).
    const isReturning = s.skipSteps.includes(1);
    // Wave-5b LOW-2: escapeHtml erledigt bereits " -> &quot;. Doppel-Replace
    // war redundant + haette &amp;quot; produziert wenn der Name selbst ein "
    // enthielte (escapeHtml: " -> &quot;, dann replace: " gibts nicht mehr —
    // aber bei tatsaechlichem & im Namen wuerde &quot; erneut greifen?
    // Tatsaechlich harmlos in dem Fall, aber unnoetig — escapeHtml allein.
    const safeName = escapeHtml(s.name || '');
    const heading = isReturning && s.name
      ? `Hi ${escapeHtml(s.name)}, wir brauchen noch deine Klassenstufe.`
      : 'Wer bist du?';
    const sub = isReturning
      ? '<div class="form-hint" style="margin-bottom:12px">Wir zeigen dir dann nur passende Aufgaben.</div>'
      : '';
    const nameField = isReturning
      ? `<input type="hidden" id="onbName" value="${safeName}">`
      : `
        <div class="form-group">
          <label class="form-label">Wie hei\xdft du?</label>
          <input class="form-input" id="onbName" value="${safeName}" maxlength="40" placeholder="Dein Name">
          <div class="form-hint">So sehen dich Mitsch\xfcler in der Rangliste.</div>
        </div>`;
    body = `
      <div class="wizard-step">
        <div class="wizard-step-num">Schritt ${isReturning ? '1 von 2' : '2 von 4'}</div>
        <h2>${heading}</h2>
        ${sub}
        ${nameField}
        <div class="form-group">
          <label class="form-label">In welcher Klasse bist du?</label>
          <div class="onb-klasse-grid">
            ${[5,6,7,8,9,10,11,12,13].map(k =>
              `<button class="onb-klasse-btn ${String(s.klasse)===String(k) ? 'active' : ''}" onclick="window.LF.onboardingPickKlasse('${k}')">${k}</button>`
            ).join('')}
          </div>
          <div class="form-hint">Wir schicken dir Aufgaben passend zur Klassenstufe.</div>
        </div>
        <div id="onbStep2Err" class="error-msg" style="display:none;margin:8px 0"></div>
        ${dots(2)}
        <div class="wizard-actions">
          ${isReturning ? '' : '<button class="btn btn-ghost" onclick="window.LF.onboardingBack()">Zur\xfcck</button>'}
          <button class="btn btn-ghost" onclick="window.LF.onboardingSkipAll()">\xdcberspringen</button>
          <button class="btn btn-primary" onclick="window.LF.onboardingNext()">Weiter</button>
        </div>
      </div>`;
  } else if (s.step === 3) {
    // Mission 8 Q1=C: Avatar-Picker = nur File-Upload, kein Emoji-Grid mehr.
    // Wave-4 (Maya/Bereich-5): Default-Avatar = Hash-basierte Color-Tile mit
    // Initial. User der ueberspringt sieht einen unique-aber-stabilen Default
    // statt eines neutralen Standard-Kreises.
    const initial = escapeHtml((s.name || 'U')[0].toUpperCase());
    const uidForHash = currentUser?.uid || s.name || 'lf';
    const defaultBg  = _generateDefaultAvatarHsl(uidForHash);
    const previewHtml = s.photoURL
      ? `<img src="${escapeAttr(s.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
      : `<div class="avatar-default avatar-default-large" style="background:${defaultBg}">${initial}</div>`;
    body = `
      <div class="wizard-step">
        <div class="wizard-step-num">Schritt 3 von 4</div>
        <h2>Profilbild w\xe4hlen</h2>
        <div style="margin:16px 0">
          <div class="profile-avatar-large" style="margin:12px auto 0">${previewHtml}</div>
        </div>
        <div class="form-hint">Lade ein Bild hoch oder bleib beim Standard-Avatar — beides geht.</div>
        <div class="onb-avatar-actions">
          <label class="btn btn-secondary btn-sm" style="cursor:pointer">
            ${lfIcon('folder')} Bild hochladen
            <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="window.LF.onboardingHandleFile(this)">
          </label>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.onboardingUseDefaultAvatar()">Standard-Avatar nutzen</button>
        </div>
        ${dots(3)}
        <div class="wizard-actions">
          <button class="btn btn-ghost" onclick="window.LF.onboardingBack()">Zur\xfcck</button>
          <button class="btn btn-ghost" onclick="window.LF.onboardingSkip()">\xdcberspringen</button>
          <button class="btn btn-primary" onclick="window.LF.onboardingNext()">Weiter</button>
        </div>
      </div>`;
  } else {
    // Mission 4: Step 4 wird zum Tour-Einstieg (Maya Architecture A).
    // Wave-4 (Maya/Bereich-5): Hierarchie umkehren — Tour starten ist Primary
    // (gross, btn-lg), "Spaeter" ist Secondary (btn-ghost btn-sm, rechts unten).
    // Default-Fokus auf Tour-CTA, damit Enter den User direkt in die Tour
    // schickt. Eine 8-Step-Tour, einmal uebersprungen = 95% verloren.
    body = `
      <div class="wizard-step">
        <div class="wizard-step-num">Schritt 4 von 4</div>
        <div class="wizard-icon-large">${lfIcon('party-popper', {cls:'lf-icon-2xl'})}</div>
        <h2>Alles klar, ${escapeHtml(s.name || 'Lernender')}!</h2>
        <p>Soll ich dir die wichtigsten Funktionen in 8 kurzen Schritten zeigen?</p>
        ${dots(4)}
        <div class="wizard-actions wizard-actions-final">
          <button class="btn btn-primary btn-lg wizard-tour-cta" onclick="window.LF.onboardingFinish('tour')">Tour starten</button>
          <button class="btn btn-ghost btn-sm wizard-skip-link" onclick="window.LF.onboardingFinish('app')">Sp\xe4ter, zur App</button>
        </div>
      </div>`;
    // Default-Fokus erst nach Mount setzen.
    setTimeout(() => document.querySelector('.wizard-tour-cta')?.focus(), 50);
  }

  // Wizard-Bug B: X-Close-Button am Overlay-Rand (auf jedem Step sichtbar).
  overlay.innerHTML = `<div class="wizard-card">
    <button class="wizard-close" aria-label="Schließen" onclick="window.LF.onboardingSkipAll()">&times;</button>
    ${body}
  </div>`;
  document.body.appendChild(overlay);
}

// ════════════════════════════════════════════════════════════════
//  Mission 4 — App-Tour (Spotlight + Tooltip + Pfeil)
// ════════════════════════════════════════════════════════════════
// Targets werden ueber data-tour="<id>"-Attribute aufgespuert (Refactor-robust).
// Step 0 = Welcome (center, kein Target), Step 8 = Final (center).
// Mobile (window.innerWidth < 768) skipt Step 5 (User-Chip im Dropdown nicht sichtbar).
const TOUR_STEPS = [
  {
    id: 'welcome', target: null, position: 'center',
    title: 'Willkommen!',
    body: 'Lass mich dir die App in 8 kurzen Schritten zeigen. Du kannst jederzeit überspringen.'
  },
  {
    id: 'lernen', target: 'nav-lernen', mobileTarget: 'mobile-nav-lernen',
    position: 'below',
    title: 'Lernen',
    body: 'Hier wählst du Fächer und machst Tests. Alles, was du für die Schule brauchst.'
  },
  {
    id: 'streak', target: 'streak-chip', mobileTarget: null,
    position: 'below',
    title: 'Streak',
    body: 'Lerne täglich für deinen Streak — er gibt Bonus-XP. Schon eine Daily Challenge zählt.'
  },
  {
    id: 'daily', target: 'daily-card', mobileTarget: 'daily-card',
    position: 'above',
    title: 'Daily Challenge',
    body: 'Jeden Tag eine neue Mini-Challenge — 5 bis 10 Fragen, in 5 Minuten durch.'
  },
  {
    id: 'rangliste', target: 'nav-rangliste', mobileTarget: 'mobile-nav-rangliste',
    position: 'below',
    title: 'Rangliste',
    body: 'Vergleich dich mit deiner Klasse. Die Klassen-Rangliste ist Default — Global ist optional.'
  },
  {
    id: 'profil', target: 'user-chip', mobileTarget: null,
    position: 'below-left',
    title: 'Dein Profil',
    body: 'Hier findest du Profil, Erfolge, Inventar und Einstellungen.'
  },
  {
    id: 'bug', target: 'bug-chip', mobileTarget: 'bug-fab',
    position: 'above',
    title: 'Was kaputt? Sag\'s.',
    body: 'Wenn ein Fach fehlt, eine Frage falsch ist oder was anderes nicht stimmt — hier melden.'
  },
  {
    id: 'hilfe', target: 'nav-hilfe', mobileTarget: 'bottom-mehr',
    position: 'below',
    title: 'Hilfe',
    body: 'Alle Funktionen erklärt — und du kannst diese Tour hier jederzeit erneut starten.'
  },
  {
    id: 'final', target: null, position: 'center',
    title: 'Das war\'s!',
    body: 'Viel Spaß beim Lernen. Wenn du was vermisst, sag\'s über das Bug-Icon (Käfer-Symbol unten rechts).'
  }
];

let _tourState = null;

function _tourIsMobile() { return window.innerWidth < 768; }

function _tourFindTarget(step) {
  if (!step || !step.target) return null;
  const isMobile = _tourIsMobile();
  const targetId = isMobile ? (step.mobileTarget ?? step.target) : step.target;
  if (targetId == null) return null;  // explizit auf Mobile uebersprungen
  const el = document.querySelector(`[data-tour="${CSS.escape(targetId)}"]`);
  return el || null;
}

function _renderTourStep(index) {
  if (!_tourState) return;
  // Bound check
  if (index < 0) index = 0;
  if (index >= TOUR_STEPS.length) { _endTour('completed'); return; }

  const step = TOUR_STEPS[index];

  // Skip-Logic: Mobile + mobileTarget=null → skippen.
  if (step.target && _tourIsMobile() && step.mobileTarget === null) {
    _tourState._visSkipChain = (_tourState._visSkipChain || 0) + 1;
    if (_tourState._visSkipChain >= 3) {
      // B1 (a): Anti-Recursion — bei 3+ Skips in Folge bricht ab und zeigt
      // den aktuellen Schritt ohne Spotlight (wie Welcome-Step).
      console.warn('[tour] visibility-skip chain at step', index, '— rendering tooltip without spotlight');
      _tourState._visSkipChain = 0;
      // Fall through, render OHNE Target — siehe unten.
    } else {
      return _renderTourStep(index + (index >= _tourState.index ? 1 : -1));
    }
  }

  // Target nicht im DOM (z.B. streak-chip wenn streak <= 1) ODER unsichtbar
  // (z.B. bug-fab auf Desktop, bug-chip auf Mobile) → skip — aber maximal
  // 2 mal in Folge, dann brechen wir die Recursion ab und zeigen den
  // Schritt-Inhalt ohne Spotlight (B1 (a) Defense).
  let forceNoTarget = false;
  if (step.target) {
    const el = _tourFindTarget(step);
    const visible = el && el.getClientRects().length > 0
                       && el.offsetWidth > 0 && el.offsetHeight > 0;
    if (!el || !visible) {
      _tourState._visSkipChain = (_tourState._visSkipChain || 0) + 1;
      if (_tourState._visSkipChain >= 3) {
        console.warn('[tour] visibility-skip chain at step', index, '— rendering tooltip without spotlight (target', step.target, 'not visible)');
        _tourState._visSkipChain = 0;
        forceNoTarget = true;
      } else {
        const dir = (index >= _tourState.index) ? 1 : -1;
        return _renderTourStep(index + dir);
      }
    } else {
      _tourState._visSkipChain = 0;
    }
  } else {
    _tourState._visSkipChain = 0;
  }

  _tourState.index = index;

  // Overlay aufbauen / re-use.
  let overlay = document.getElementById('lfTourOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lfTourOverlay';
    overlay.className = 'lf-tour-overlay';
    overlay.innerHTML = `
      <div class="lf-tour-backdrop"></div>
      <div class="lf-tour-spotlight" id="lfTourSpotlight"></div>
      <div class="lf-tour-arrow" id="lfTourArrow"></div>
      <div class="lf-tour-tooltip" id="lfTourTooltip"></div>
    `;
    document.body.appendChild(overlay);
    // Backdrop-Tap auf Mobile schliesst Tour (analog Modal-Behavior).
    overlay.querySelector('.lf-tour-backdrop')?.addEventListener('click', () => _endTour('skipped'));
  }

  const spotlight = overlay.querySelector('#lfTourSpotlight');
  const tooltip   = overlay.querySelector('#lfTourTooltip');
  const arrow     = overlay.querySelector('#lfTourArrow');

  const isFirst = index === 0;
  const isLast  = index === TOUR_STEPS.length - 1;
  const counter = (isFirst || isLast) ? '' : `<div class="lf-tour-tooltip-head">Schritt ${index} von ${TOUR_STEPS.length - 1}</div>`;

  let backBtn = '';
  if (!isFirst) backBtn = `<button class="btn btn-ghost btn-sm" onclick="window.LF.tourBack()">Zurück</button>`;
  let skipBtn = `<button class="btn btn-ghost btn-sm" onclick="window.LF.tourSkip()">Überspringen</button>`;
  let nextBtnLabel = isLast ? 'Los geht\'s!' : (isFirst ? 'Tour starten' : 'Weiter');
  let nextBtn = `<button class="btn btn-primary btn-sm" onclick="window.LF.tourNext()">${nextBtnLabel}</button>`;
  if (isLast) skipBtn = '';  // letzter Schritt: keine Skip-Variante mehr

  tooltip.innerHTML = `
    <button class="lf-tour-close" aria-label="Tour beenden" onclick="window.LF.tourSkip()">&times;</button>
    ${counter}
    <h3 class="lf-tour-tooltip-title">${escapeHtml(step.title)}</h3>
    <p class="lf-tour-tooltip-body">${escapeHtml(step.body)}</p>
    <div class="lf-tour-tooltip-actions">
      <div>${backBtn}</div>
      <div style="display:flex;gap:8px">${skipBtn}${nextBtn}</div>
    </div>
  `;

  // Auto-Scroll-to-Target falls noetig, dann positionieren.
  // B1 (a): forceNoTarget unterdrueckt das Spotlight wenn die Visibility-
  // Skip-Chain 3+ erreicht hat — sonst wuerden wir einen toten Pfad rendern.
  const target = forceNoTarget ? null : _tourFindTarget(step);
  if (target) {
    try {
      const r = target.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => _positionTour(step, target, spotlight, tooltip, arrow), 320);
        return;
      }
    } catch(e) {}
    _positionTour(step, target, spotlight, tooltip, arrow);
  } else {
    // Kein Target → Spotlight + Arrow ausblenden, Tooltip zentrieren.
    spotlight.style.display = 'none';
    arrow.style.display = 'none';
    tooltip.style.position = 'fixed';
    tooltip.style.left = '50%';
    tooltip.style.top  = '50%';
    tooltip.style.transform = 'translate(-50%, -50%)';
  }
}

function _positionTour(step, target, spotlight, tooltip, arrow) {
  const r = target.getBoundingClientRect();
  const pad = 6;
  spotlight.style.display = 'block';
  spotlight.style.top    = (r.top - pad) + 'px';
  spotlight.style.left   = (r.left - pad) + 'px';
  spotlight.style.width  = (r.width + pad * 2) + 'px';
  spotlight.style.height = (r.height + pad * 2) + 'px';

  // Tooltip-Groesse messen
  tooltip.style.position = 'fixed';
  tooltip.style.transform = '';
  tooltip.style.left = '0px';
  tooltip.style.top  = '0px';
  // Erst sichtbar machen, dann messen
  tooltip.style.visibility = 'hidden';
  tooltip.style.display = 'block';
  const tt = tooltip.getBoundingClientRect();

  const margin = 16;
  const edge   = 12;
  const mobileBottomBarH = _tourIsMobile() ? 56 : 0;
  let pos = step.position || 'below';
  if (_tourIsMobile() && (pos === 'left' || pos === 'right' || pos === 'below-left' || pos === 'below-right')) {
    pos = (r.top > window.innerHeight / 2) ? 'above' : 'below';
  }

  let ttLeft, ttTop, arrowDir;
  switch (pos) {
    case 'above':
      ttTop  = r.top - tt.height - margin;
      ttLeft = r.left + r.width / 2 - tt.width / 2;
      arrowDir = 'down';
      if (ttTop < edge) { // fallback below
        ttTop = r.bottom + margin; arrowDir = 'up';
      }
      break;
    case 'left':
      ttLeft = r.left - tt.width - margin;
      ttTop  = r.top + r.height / 2 - tt.height / 2;
      arrowDir = 'right';
      if (ttLeft < edge) { ttLeft = r.right + margin; arrowDir = 'left'; }
      break;
    case 'right':
      ttLeft = r.right + margin;
      ttTop  = r.top + r.height / 2 - tt.height / 2;
      arrowDir = 'left';
      if (ttLeft + tt.width > window.innerWidth - edge) { ttLeft = r.left - tt.width - margin; arrowDir = 'right'; }
      break;
    case 'below-left':
      ttTop  = r.bottom + margin;
      ttLeft = r.right - tt.width;
      arrowDir = 'up';
      break;
    case 'below':
    default:
      ttTop  = r.bottom + margin;
      ttLeft = r.left + r.width / 2 - tt.width / 2;
      arrowDir = 'up';
      if (ttTop + tt.height > window.innerHeight - edge - mobileBottomBarH) {
        ttTop = r.top - tt.height - margin; arrowDir = 'down';
      }
      break;
  }
  // Clamp to viewport
  ttLeft = Math.max(edge, Math.min(ttLeft, window.innerWidth - tt.width - edge));
  ttTop  = Math.max(edge, Math.min(ttTop,  window.innerHeight - tt.height - edge - mobileBottomBarH));
  tooltip.style.left = ttLeft + 'px';
  tooltip.style.top  = ttTop + 'px';
  tooltip.style.visibility = '';

  // Pfeil positionieren — auf Target-Mitte zwischen Tooltip und Target.
  arrow.style.display = 'block';
  arrow.className = 'lf-tour-arrow lf-tour-arrow-' + arrowDir;
  const tx = r.left + r.width / 2;
  if (arrowDir === 'up') {
    arrow.style.left = (tx - 7) + 'px';
    arrow.style.top  = (r.bottom + 4) + 'px';
  } else if (arrowDir === 'down') {
    arrow.style.left = (tx - 7) + 'px';
    arrow.style.top  = (r.top - 14) + 'px';
  } else if (arrowDir === 'left') {
    arrow.style.left = (r.right + 4) + 'px';
    arrow.style.top  = (r.top + r.height / 2 - 7) + 'px';
  } else if (arrowDir === 'right') {
    arrow.style.left = (r.left - 14) + 'px';
    arrow.style.top  = (r.top + r.height / 2 - 7) + 'px';
  }
}

function _repositionTour() {
  if (!_tourState) return;
  const step = TOUR_STEPS[_tourState.index];
  if (!step || !step.target) return;
  const target = _tourFindTarget(step);
  const overlay = document.getElementById('lfTourOverlay');
  if (!target || !overlay) return;
  _positionTour(step, target,
    overlay.querySelector('#lfTourSpotlight'),
    overlay.querySelector('#lfTourTooltip'),
    overlay.querySelector('#lfTourArrow'));
}

async function _endTour(reason) {
  if (!_tourState) return;
  // B1 (b): Wenn 'completed' OHNE dass der User wirklich progressed ist
  // (z.B. Tour bricht in step <3 ab durch Visibility-Recursion oder
  // hashchange), das ist KEIN Erfolgs-Ende — Toast zeigen statt Erfolgs-
  // Markierung schreiben.
  const _earlyAbort = (reason === 'completed' && (_tourState.index || 0) < 3);
  if (_earlyAbort) {
    showToast('Tour konnte nicht starten — bitte erneut versuchen über Hilfe-Tab.', 'error');
    reason = 'aborted';
  }
  // Cleanup
  window.removeEventListener('scroll', _repositionTour, { passive: true });
  window.removeEventListener('resize', _repositionTour);
  document.removeEventListener('keydown', _tourKeydown);
  window.removeEventListener('lf:banned', _tourBanCleanup);
  if (_tourState.driftInterval) clearInterval(_tourState.driftInterval);
  if (_tourState.hashHandler) window.removeEventListener('hashchange', _tourState.hashHandler);
  _tourState = null;
  const overlay = document.getElementById('lfTourOverlay');
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 200);
  }

  // Persist tour-state on user-doc. Felder sind allow-listed in Mission-2-Rules
  // (tourCompletedAt / tourSkippedAt / tourPromptedAt). Permission-denied →
  // schreiben einfach nicht — Tour funktioniert in-Session weiter.
  if (currentUser?.uid && (reason === 'completed' || reason === 'skipped')) {
    try {
      const field = reason === 'completed' ? 'tourCompletedAt' : 'tourSkippedAt';
      await db().collection('users').doc(currentUser.uid).set({
        [field]: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      if (userData) userData[field] = Date.now();
    } catch(e) {
      console.warn('[tour-persist]', e, '- field may not be in ownerSafeFields, ask Marcus to add tourCompletedAt/tourSkippedAt/tourPromptedAt to firestore.rules');
    }
  }
}

function _tourKeydown(e) {
  if (e.key === 'Escape') { _endTour('skipped'); }
  else if (e.key === 'ArrowRight') { window.LF.tourNext(); }
  else if (e.key === 'ArrowLeft') { window.LF.tourBack(); }
}

function _tourBanCleanup() { _endTour('banned'); }

// Toast fuer Bestands-User: bietet Tour an, ohne sie zu erzwingen.
// iPad-Bug-Fix (2026-05-08): inline onclick="" String wurde auf iOS-Safari
// nicht zuverlassig getriggert (Hover-State zeigte sich, click feuerte aber
// kein JS aus). Workaround: echte addEventListener-Bindings + Auto-Dismiss
// pause-on-touch + interaction (touchstart/click) statt nur click.
function _showTourToast() {
  if (!currentUser || _tourState) return;
  if (document.getElementById('lfTourToast')) return;
  const t = document.createElement('div');
  t.id = 'lfTourToast';
  t.className = 'lf-tour-toast';
  t.innerHTML = `
    <div class="lf-tour-toast-body">
      Neue App-Tour verfügbar — willst du sehen, was sich geändert hat?
    </div>
    <div class="lf-tour-toast-actions">
      <button class="btn btn-ghost btn-sm" data-action="dismiss" type="button">Nicht jetzt</button>
      <button class="btn btn-primary btn-sm" data-action="accept" type="button">Tour starten</button>
    </div>
  `;
  document.body.appendChild(t);

  let dismissTimer = setTimeout(() => {
    if (document.getElementById('lfTourToast')) window.LF.tourToastDismiss();
  }, 15000);
  const cancelTimer = () => { if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; } };
  t.addEventListener('mouseenter', cancelTimer);
  t.addEventListener('touchstart', cancelTimer, { passive: true });

  const dismissBtn = t.querySelector('button[data-action="dismiss"]');
  const acceptBtn  = t.querySelector('button[data-action="accept"]');
  dismissBtn?.addEventListener('click', () => { cancelTimer(); window.LF.tourToastDismiss(); });
  acceptBtn?.addEventListener('click',  () => { cancelTimer(); window.LF.tourToastAccept(); });
}

window.LF.tourToastDismiss = () => {
  document.getElementById('lfTourToast')?.remove();
  // Nicht permanent skippen — User soll's vielleicht spaeter machen.
  // tourPromptedAt steht bereits → Toast kommt beim naechsten Login wieder.
};

window.LF.tourToastAccept = () => {
  document.getElementById('lfTourToast')?.remove();
  window.LF.startTour();
};

// ── Tour Public API ───────────────────────
window.LF.startTour = async () => {
  if (_tourState) return;  // bereits aktiv
  // Defense: Wizard muss zu sein.
  if (document.getElementById('onboardingOverlay')) {
    console.warn('[startTour] wizard still open');
    return;
  }
  // Auf Dashboard navigieren falls woanders (Targets leben dort).
  if (location.hash !== '#/' && location.hash !== '#' && location.hash !== '') {
    location.hash = '#/';
    // route() wird via hashchange ausgeloest
    await new Promise(r => setTimeout(r, 250));
  }
  // Auf dashboard-ready warten (mit Timeout 3s).
  try {
    const ready = window.LF.dashboardReady || Promise.resolve();
    await Promise.race([ready, new Promise(r => setTimeout(r, 3000))]);
  } catch(e) {}

  _tourState = {
    index: 0,
    driftInterval: null,
    hashHandler: null
  };
  // Hash-Change → Tour pausieren mit Toast.
  _tourState.hashHandler = () => {
    if (!_tourState) return;
    showToast('Tour pausiert — du kannst sie in Hilfe neu starten.', 'info');
    _endTour('navigated');
  };
  window.addEventListener('hashchange', _tourState.hashHandler);
  window.addEventListener('scroll', _repositionTour, { passive: true });
  window.addEventListener('resize', _repositionTour);
  document.addEventListener('keydown', _tourKeydown);
  window.addEventListener('lf:banned', _tourBanCleanup);

  requestAnimationFrame(() => _renderTourStep(0));
};

window.LF.tourNext = () => {
  if (!_tourState) { console.debug('[tour] tourNext called but _tourState is null'); return; }
  console.debug('[tour] tourNext from index', _tourState.index, 'visSkipChain=', _tourState._visSkipChain || 0);
  _renderTourStep(_tourState.index + 1);
};
window.LF.tourBack = () => {
  if (!_tourState) { console.debug('[tour] tourBack called but _tourState is null'); return; }
  console.debug('[tour] tourBack from index', _tourState.index, 'visSkipChain=', _tourState._visSkipChain || 0);
  _renderTourStep(_tourState.index - 1);
};
window.LF.tourSkip = () => {
  console.debug('[tour] tourSkip called, _tourState=', _tourState ? `index=${_tourState.index}` : 'null');
  _endTour('skipped');
};

// ── Admin-User-Editor (Mission 1, neu) ────
let adminEditState = null;
async function renderAdminUserEdit(uid) {
  // Lade User-Doc frisch
  const all = await getAllUsers();
  const u = all.find(x => x.uid === uid);
  if (!u) { showToast('User nicht gefunden.', 'error'); return; }
  adminEditState = { uid, original: u, draft: { ...u } };
  document.getElementById('adminEditOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'adminEditOverlay';
  overlay.className = 'lf-modal-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const grades = u.grades || {};
  const gradeRows = Object.entries(grades).map(([key, g]) => {
    const [subjectId, yearId, topicId] = key.split('__');
    const subject = structure?.[subjectId];
    const year    = subject?.years?.[yearId];
    const topic   = year?.topics?.[topicId];
    const label = `${subject?.name || subjectId} · ${year?.name || yearId} · ${topic?.name || topicId} · Note ${g.grade}`;
    return `<div class="adm-grade-row">
      <span>${escapeHtml(label)}</span>
      <button class="btn btn-ghost btn-sm" onclick="window.LF.adminEditUserDeleteGrade('${escapeHtml(key)}')">${lfIcon('x')}</button>
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:8px">Keine Noten</div>';

  overlay.innerHTML = `
    <div class="lf-modal-card lf-modal-large">
      <div class="lf-modal-header">
        <h3>User bearbeiten — ${escapeHtml(u.name || 'Unbekannt')}</h3>
        <button class="btn-icon" onclick="document.getElementById('adminEditOverlay').remove()">${lfIcon('x')}</button>
      </div>
      <div class="lf-modal-body">
        <div class="adm-section-title">Identität</div>
        <div class="form-group">
          <label class="form-label">Name</label>
          <input class="form-input" id="admEditName" value="${escapeHtml(u.name || '').replace(/"/g,'&quot;')}">
        </div>
        <div class="form-group">
          <label class="form-label">Klasse</label>
          <select class="form-input" id="admEditKlasse">
            <option value="">— nicht gesetzt —</option>
            ${[5,6,7,8,9,10,11,12,13].map(k => `<option value="${k}" ${String(u.klasse)===String(k)?'selected':''}>Klasse ${k}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">E-Mail (read-only)</label>
          <input class="form-input" value="${escapeHtml(u.email || '')}" readonly>
        </div>

        <div class="adm-section-title">Rolle &amp; Status</div>
        <div class="form-group">
          <label class="form-label">Rolle</label>
          <select class="form-input" id="admEditRole">
            <option value="" ${!u.role?'selected':''}>Schüler</option>
            <option value="tester" ${u.role==='tester'?'selected':''}>Tester</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
            <option value="claude" ${u.role==='claude'?'selected':''}>Claude (Test)</option>
          </select>
        </div>
        <label class="adm-check-row">
          <input type="checkbox" id="admEditBanned" ${u.isBanned?'checked':''}>
          Account gesperrt
        </label>
        <label class="adm-check-row">
          <input type="checkbox" id="admEditClaude" ${u.isClaude?'checked':''}>
          isClaude (Test-Account)
        </label>

        <div class="adm-section-title">Cosmetics</div>
        <div class="form-group">
          <label class="form-label">Aktive Outline</label>
          <select class="form-input" id="admEditOutline">
            <option value="">— Default (Level) —</option>
            ${OUTLINE_TIERS.map(t => `<option value="${t.id}" ${u.activeOutline===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Aktives Theme</label>
          <select class="form-input" id="admEditTheme">
            ${THEMES.map(t => `<option value="${t.id}" ${u.activeTheme===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="window.LF.adminEditUserUnlockOutlines()">Alle Outlines freischalten</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.adminEditUserUnlockThemes()">Alle Themes freischalten</button>
        </div>

        <div class="adm-section-title">Stats</div>
        <div class="form-group">
          <label class="form-label">XP</label>
          <input class="form-input" id="admEditXp" type="number" value="${u.xp || 0}">
        </div>
        <div class="form-group">
          <label class="form-label">Streak (Tage)</label>
          <input class="form-input" id="admEditStreak" type="number" value="${u.streakCount || 0}">
        </div>
        <div class="form-group">
          <label class="form-label">Tests heute</label>
          <input class="form-input" id="admEditTestsToday" type="number" value="${u.testsToday || 0}">
        </div>

        <div class="adm-section-title">Noten (${Object.keys(grades).length})</div>
        <div class="adm-grade-list">${gradeRows}</div>
        <button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="window.LF.adminEditUserDeleteAllGrades()">Alle Noten löschen</button>

        <div class="adm-section-title">Gefährliche Aktionen</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-danger btn-sm" onclick="window.LF.adminEditUserResetDoc()">Account-Doc zurücksetzen</button>
        </div>
      </div>
      <div class="lf-modal-actions">
        <button class="btn btn-ghost" onclick="document.getElementById('adminEditOverlay').remove()">Abbrechen</button>
        <button class="btn btn-primary" onclick="window.LF.adminEditUserSave()">Änderungen speichern</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

// ── Lesezeichen-Seite (F-19) ─────────────
function renderLesezeichen() {
  const bookmarks = userData?.bookmarks || [];
  const cards = bookmarks.map(key => {
    const [subjectId, yearId, topicId] = key.split('__');
    const subject = structure?.[subjectId];
    const topic   = subject?.years?.[yearId]?.topics?.[topicId];
    if (!subject || !topic) return '';
    const g  = userData?.grades?.[key];
    const gp = g ? _gp(g) : null;
    return `
      <div class="topic-card" onclick="location.hash='#/fach/${subjectId}/${yearId}/${topicId}'">
        <div class="t-info">
          <div class="t-name">${getSubjectIcon(subjectId)} ${topic.name}</div>
          <div class="t-desc">${subject.name} · ${subject.years[yearId]?.name || yearId}</div>
        </div>
        <div class="t-right">
          ${g ? `<div class="t-grade" style="background:${gradeColor(g.grade)}">${g.grade}</div>` : ''}
          <button class="bm-icon-btn active" title="Entfernen"
            onclick="event.stopPropagation();window.LF.toggleBookmarkTopic('${key}')">${lfIcon('bookmark')}</button>
          <div class="t-arrow">›</div>
        </div>
      </div>`;
  }).filter(Boolean).join('');

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Lesezeichen' }])}
    <div class="page">
      <div class="page-header">
        <h1>${lfIcon('bookmark')} Lesezeichen</h1>
        <div class="sub">Gespeicherte Themen</div>
      </div>
      ${cards
        ? `<div class="topic-list">${cards}</div>`
        : `<div class="empty-state"><div class="empty-icon">${lfIcon('bookmark')}</div>Noch keine Lesezeichen.<br>Öffne ein Thema und klicke auf das Lesezeichen-Symbol.</div>`}
    </div>`;
}

// ── SRS-Seite (F-16) ─────────────────────
function renderSRS() {
  const due = getSRSDueCards();

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'SRS — Wiederholung' }])}
    <div class="page">
      <div class="page-header">
        <h1>${lfIcon('brain')} Wiederholen</h1>
        <div class="sub">Spaced Repetition — die Karten kommen wieder, wenn dein Gehirn sie vergessen würde. ${due.length} Karte${due.length !== 1 ? 'n' : ''} heute fällig.</div>
      </div>
      <div id="srsArea">
        ${due.length === 0
          ? `<div class="empty-state"><div class="empty-icon">${lfIcon('brain')}</div>Alle Karten für heute erledigt!<br>Mach weiter beim <a href="#/" onclick="location.hash='#/'">Dashboard</a>.</div>`
          : renderSRSCard(due, 0)}
      </div>
    </div>`;

  if (due.length > 0) srsState = { cards: due, current: 0, done: 0 };
}

function renderSRSCard(cards, idx) {
  if (idx >= cards.length) {
    return `<div class="srs-done"><div class="srs-done-icon">${lfIcon('party-popper', {cls:'lf-icon-2xl'})}</div><h2>Session abgeschlossen!</h2>
      <p>${cards.length} Karte${cards.length!==1?'n':''} wiederholt.</p>
      <button class="btn btn-primary" onclick="location.hash='#/'">Zurück</button></div>`;
  }
  const card = cards[idx];
  return `
    <div class="srs-progress-bar"><div class="srs-progress-fill" style="width:${Math.round(idx/cards.length*100)}%"></div></div>
    <div class="srs-counter">${idx+1} / ${cards.length}</div>
    <div class="srs-card" id="srsCard">
      <div class="srs-card-front" id="srsFront">
        <div class="srs-q">${card.question}</div>
        <button class="btn btn-primary" onclick="window.LF.srsReveal()">Antwort anzeigen</button>
      </div>
      <div class="srs-card-back" id="srsBack" style="display:none">
        <div class="srs-q">${card.question}</div>
        <div class="srs-answer">${card.answer}</div>
        <div class="srs-rate-row">
          <button class="srs-rate-btn rate-bad"   onclick="window.LF.rateSRS(1)">${lfIcon('x', {cls:'sx-wrong'})} Nicht gewusst</button>
          <button class="srs-rate-btn rate-ok"    onclick="window.LF.rateSRS(3)">~ Schwer</button>
          <button class="srs-rate-btn rate-good"  onclick="window.LF.rateSRS(4)">${lfIcon('check', {cls:'sx-correct'})} Gut</button>
          <button class="srs-rate-btn rate-great" onclick="window.LF.rateSRS(5)">${lfIcon('zap')} Leicht</button>
        </div>
      </div>
    </div>`;
}

// ── Flashcard-Rendering (F-15) ────────────
function renderFlashcardSession(questions, subjectId, yearId, topicId) {
  const topicKey = `${subjectId}__${yearId}__${topicId}`;
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  flashcardState = { cards: shuffled, current: 0, flipped: false, knew: 0, didntKnow: 0, topicKey };
  document.getElementById('tabKarten').innerHTML = renderFlashcard();
}

function renderFlashcard() {
  const { cards, current, knew, didntKnow } = flashcardState;
  if (current >= cards.length) {
    const total = knew + didntKnow;
    return `
      <div class="fc-done">
        <div class="fc-done-icon">${lfIcon('party-popper', {cls:'lf-icon-2xl'})}</div>
        <h2>Fertig!</h2>
        <div class="fc-score">
          <span class="fc-score-knew">${knew} ${lfIcon('check', {cls:'sx-correct'})} gewusst</span>
          <span class="fc-score-didnt">${didntKnow} ${lfIcon('x', {cls:'sx-wrong'})} nicht gewusst</span>
        </div>
        <div style="margin-top:20px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="window.LF.startFlashcards(flashcardState?.topicKey?.split('__')[0]??'','',flashcardState?.topicKey?.split('__')[2]??'')">Nochmal</button>
          ${getSRSDueCount() > 0 ? `<button class="btn btn-secondary" onclick="location.hash='#/srs'">SRS wiederholen (${getSRSDueCount()})</button>` : ''}
        </div>
      </div>`;
  }

  const q = cards[current];
  const correctAnswer = q.type === 'multiple_choice'
    ? (q.options?.[q.correct] || '')
    : (q.answer || q.sampleAnswer || '(siehe Inhalt)');

  return `
    <div class="fc-progress-bar"><div class="fc-progress-fill" style="width:${Math.round(current/cards.length*100)}%"></div></div>
    <div class="fc-counter">${current+1} / ${cards.length} &nbsp;·&nbsp; ${lfIcon('check', {cls:'sx-correct'})} ${knew} &nbsp; ${lfIcon('x', {cls:'sx-wrong'})} ${didntKnow}</div>
    <div class="fc-card-scene" onclick="window.LF.flipCard()">
      <div class="fc-card-inner" id="fcCardInner">
        <div class="fc-face fc-front">
          <div class="fc-label">Frage</div>
          <div class="fc-text">${escapeHtml(q.question || '')}</div>
          <div class="fc-hint">Klicken zum Umdrehen</div>
        </div>
        <div class="fc-face fc-back">
          <div class="fc-label">Antwort</div>
          <div class="fc-text">${escapeHtml(correctAnswer || '')}</div>
        </div>
      </div>
    </div>
    <div class="fc-actions" id="fcActions" style="display:none">
      <button class="fc-btn fc-btn-no" onclick="window.LF.fcDidntKnow()">${lfIcon('x', {cls:'sx-wrong'})} Nicht gewusst</button>
      <button class="fc-btn fc-btn-yes" onclick="window.LF.fcKnew()">${lfIcon('check', {cls:'sx-correct'})} Gewusst</button>
    </div>
    <div class="fc-actions-hint" id="fcActionsHint">Drehe die Karte um, um die Antwort zu sehen.</div>`;
}

// ── Pomodoro mounten/unmounten (F-17) ─────
// Sophie P2-4 (Cycle 7): topicKey wird beim Mount durchgereicht und am
// pomodoroState gehalten — der unmount/tick-Hook nutzt ihn als Filter fuer
// _addExamStudyMinutes (nur Klausuren mit overlapping topicIds).
function mountPomodoro(topicKey) {
  if (document.getElementById('pomodoroWidget')) return;
  pomodoroState = { mode: 'work', seconds: 25*60, workMins: 25, breakMins: 5, timer: null, sessions: 0, topicKey: topicKey || null };
  const el = document.createElement('div');
  el.id = 'pomodoroWidget';
  el.className = 'pomo-widget';
  el.innerHTML = pomodoroHTML();
  document.body.appendChild(el);
}

function pomodoroHTML() {
  if (!pomodoroState) return '';
  const { mode, seconds, sessions, workMins, breakMins } = pomodoroState;
  const running = !!pomodoroState.timer;
  const m = String(Math.floor(seconds/60)).padStart(2,'0');
  const s = String(seconds%60).padStart(2,'0');
  return `
    <button class="pomo-toggle-btn" onclick="window.LF.pomodoroOpen()">
      ${lfIcon('timer')} ${m}:${s} <span class="pomo-mode-pill ${mode}">${mode==='work'?'Fokus':'Pause'}</span>
    </button>
    <div class="pomo-panel" id="pomoPanel" style="display:none">
      <div class="pomo-display">
        <div class="pomo-time" id="pomoTime">${m}:${s}</div>
        <div class="pomo-label">${mode==='work'?`${lfIcon('target')} Fokuszeit`:`${lfIcon('coffee')} Pause`} · ${sessions} Session${sessions!==1?'s':''}</div>
      </div>
      <div class="pomo-controls">
        <button class="btn btn-primary btn-sm" onclick="window.LF.pomodoroToggle()">${running?`${lfIcon('pause')} Pause`:`${lfIcon('play')} Start`}</button>
        <button class="btn btn-ghost btn-sm" onclick="window.LF.pomodoroReset()">${lfIcon('rotate-ccw')}</button>
      </div>
      <div class="pomo-config">
        <label>Fokus: <input type="number" id="pomoWork" value="${workMins}" min="1" max="90" style="width:48px"
          onchange="window.LF.pomodoroSetWork(+this.value)"> min</label>
        <label>Pause: <input type="number" id="pomoBreak" value="${breakMins}" min="1" max="30" style="width:48px"
          onchange="window.LF.pomodoroSetBreak(+this.value)"> min</label>
      </div>
    </div>`;
}

function unmountPomodoro() {
  if (pomodoroState?.timer) {
    clearInterval(pomodoroState.timer);
    const elapsed = Math.floor((pomodoroState.workMins * 60 - pomodoroState.seconds) / 60);
    if (pomodoroState.mode === 'work' && elapsed >= 1 && currentUser) {
      addStudyTime(currentUser.uid, elapsed).catch(console.error);
      // F-02 Cycle-6: Lernzeit auch in aktive Klausur-Plaene aggregieren.
      // Sophie P2-4 (Cycle 7): topicKey aus pomodoroState durchreichen.
      _addExamStudyMinutes(elapsed, pomodoroState.topicKey).catch(console.error);
    }
  }
  pomodoroState = null;
  document.getElementById('pomodoroWidget')?.remove();
}

function pomodoroTick() {
  if (!pomodoroState) return;
  pomodoroState.seconds--;
  if (pomodoroState.seconds <= 0) {
    if (pomodoroState.mode === 'work') {
      pomodoroState.sessions++;
      if (currentUser) {
        addStudyTime(currentUser.uid, pomodoroState.workMins).catch(console.error);
        // F-02 Cycle-6: Klausur-Plan-dailyStats mit denselben Minuten fuettern.
        // Sophie P2-4 (Cycle 7): topicKey aus pomodoroState durchreichen.
        _addExamStudyMinutes(pomodoroState.workMins, pomodoroState.topicKey).catch(console.error);
      }
      pomodoroState.mode = 'break';
      pomodoroState.seconds = pomodoroState.breakMins * 60;
      showToast('Fokuszeit vorbei! Pause genießen.', 'info');
    } else {
      pomodoroState.mode = 'work';
      pomodoroState.seconds = pomodoroState.workMins * 60;
      showToast('Pause vorbei! Weiter geht\'s.', 'info');
    }
  }
  _updatePomodoroDisplay();
}

function _updatePomodoroDisplay() {
  if (!pomodoroState) return;
  const { seconds } = pomodoroState;
  const m = String(Math.floor(seconds/60)).padStart(2,'0');
  const s = String(seconds%60).padStart(2,'0');
  const t = document.getElementById('pomoTime');
  const b = document.querySelector('.pomo-toggle-btn');
  if (t) t.textContent = `${m}:${s}`;
  if (b) b.innerHTML = `${lfIcon('timer')} ${m}:${s} <span class="pomo-mode-pill ${pomodoroState.mode}">${pomodoroState.mode==='work'?'Fokus':'Pause'}</span>`;
}

// ── Profil-Seite ─────────────────────────
// Mission 1: Profil als Heimat — 4 Tabs (Übersicht, Statistiken, Erfolge, Inventar).
// Hash-Param `?tab=` springt direkt rein. Achievement-Tile-Click öffnet Modal.
function renderProfile() {
  const tab = _hashParam('tab') || 'uebersicht';
  const initial   = (currentUser.displayName || 'U')[0].toUpperCase();
  const xpInfo    = calcLevel(userData?.xp || 0);
  const role      = userRole();
  const streak    = (() => { try { return calcStreak(); } catch { return 0; } })();

  const tabBar = `
    <div class="profile-tabs" id="profileTabs">
      <button class="profile-tab ${tab === 'uebersicht' ? 'active' : ''}" onclick="window.LF.switchProfileTab('uebersicht')">Übersicht</button>
      <button class="profile-tab ${tab === 'stats' ? 'active' : ''}"      onclick="window.LF.switchProfileTab('stats')">Statistiken</button>
      <button class="profile-tab ${tab === 'selbsteinschaetzung' ? 'active' : ''}" onclick="window.LF.switchProfileTab('selbsteinschaetzung')">Selbsteinschätzung</button>
      <button class="profile-tab ${tab === 'erfolge' ? 'active' : ''}"    onclick="window.LF.switchProfileTab('erfolge')">Erfolge</button>
      <button class="profile-tab ${tab === 'inventar' ? 'active' : ''}"   onclick="window.LF.switchProfileTab('inventar')">Inventar</button>
    </div>`;

  const header = `
    <div class="profile-header-card">
      <div class="profile-avatar-large ${outlineFor({activeOutline:userData?.activeOutline,xp:userData?.xp})}">${
        (userData?.photoURL || currentUser.photoURL)
          ? `<img src="${escapeAttr(userData?.photoURL || currentUser.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
          : escapeHtml(initial)
      }</div>
      <div class="profile-header-info">
        <div class="profile-name">${escapeHtml(userData?.name || currentUser.displayName || 'Nutzer')} ${roleBadge(role)}</div>
        <div class="profile-meta">
          ${userData?.klasse
            ? `Klasse ${userData.klasse}`
            : `<span class="profile-warn-pill" onclick="window.LF.openProfileEditOnKlasse?.()">Klasse nicht gesetzt</span>`}
          · Lv.${xpInfo.level} ${xpInfo.title}
          ${streak >= 1 ? ` · ${lfIcon('flame', {cls:'sx-streak'})} ${
            streak === 1 ? 'Tag 1 — heute angefangen' : `${streak} Tage Streak`
          }` : ''}
        </div>
        <div class="profile-email">${escapeHtml(currentUser.email || '')}</div>
        <div class="profile-actions">
          <button class="btn btn-secondary btn-sm" onclick="window.LF.profileEditOpen()">Bearbeiten</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.doLogout()">Abmelden</button>
        </div>
      </div>
    </div>`;

  let content = '';
  if (tab === 'stats') {
    content = _renderProfileStatsTab();
  } else if (tab === 'erfolge') {
    content = _renderProfileErfolgeTab();
  } else if (tab === 'inventar') {
    content = _renderProfileInventarTab();
  } else if (tab === 'selbsteinschaetzung') {
    content = _renderProfileConfidenceTab();
  } else {
    content = _renderProfileUebersichtTab();
  }

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Profil' }])}
    <div class="page">
      ${header}
      ${tabBar}
      <div class="profile-tab-content">${content}</div>

      <!-- Bearbeitungs-Sheet (initial versteckt; profileEditOpen() schiebt rein) -->
      <div id="profileEditForm" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-top:16px">
        <div class="profile-avatar-large" id="profileAvatarPreview" style="margin:0 auto 12px">${
          (userData?.photoURL || currentUser.photoURL)
            ? `<img src="${escapeAttr(userData?.photoURL || currentUser.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
            : escapeHtml(initial)
        }</div>
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:6px 0">
          <label class="btn btn-secondary btn-sm" style="cursor:pointer">
            ${lfIcon('folder')} Bild hochladen
            <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none"
                   onchange="window.LF.handleProfileFile(this)">
          </label>
          ${(userData?.photoURL || currentUser.photoURL) ? `
            <button class="btn btn-ghost btn-sm" onclick="window.LF.removeProfilePhoto()">${lfIcon('x')} Bild entfernen</button>
          ` : ''}
        </div>
        <div style="text-align:center;font-size:12px;color:var(--text-muted);margin-bottom:8px">Quadratisch, max 1 MB.</div>
        <div class="profile-edit-row">
          <input class="form-input" id="profileNameInput"
                 value="${(userData?.name || currentUser.displayName || '').replace(/"/g,'&quot;')}"
                 placeholder="Anzeigename" maxlength="40">
        </div>
        <div class="profile-edit-row" style="margin-top:8px">
          <label class="form-label" style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px">Klassenstufe</label>
          <select class="form-input" id="profileKlasseInput">
            ${[5,6,7,8,9,10,11,12,13].map(k =>
              `<option value="${k}" ${userData?.klasse == k ? 'selected' : ''}>Klasse ${k}</option>`
            ).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-primary btn-sm" id="profileSaveBtn" onclick="window.LF.saveProfile()">Speichern</button>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.profileEditClose()">Abbrechen</button>
        </div>
      </div>
    </div>`;

  // Theme-Previews im Inventar-Tab nachzeichnen
  if (tab === 'inventar') _drawThemePreviews();
}

// ── Profil-Tab: Übersicht ─────────────────
function _renderProfileUebersichtTab() {
  const grades   = userData?.grades || {};
  const subjects = Object.values(structure || {});
  const xpInfo   = calcLevel(userData?.xp || 0);
  const gradeRows = subjects.map(s => {
    const sGrades = Object.entries(grades).filter(([k]) => k.startsWith(s.id));
    if (!sGrades.length) return '';
    const avg = sGrades.reduce((sum, [,g]) => sum + (g.grade||0), 0) / sGrades.length;
    const gi  = calcGrade(Math.max(0, 7 - avg), 6);
    return `
      <div class="grade-row">
        <span>${getSubjectIcon(s.id)} ${escapeHtml(s.name)}</span>
        <div class="grade-badge" style="background:${gi.color}">${avg.toFixed(1)}</div>
      </div>`;
  }).filter(Boolean).join('') || renderEmptyState({
    icon: 'pencil',
    title: 'Noch keine Noten',
    sub: 'Mach deinen ersten Test — die Übersicht füllt sich automatisch.',
    ctaLabel: 'Erstes Fach öffnen',
    ctaAction: "location.hash='#/lernen'",
  });

  return `
    <div class="profile-grid">
      <div class="grades-overview">
        <h3>Ø Noten nach Fach</h3>
        ${gradeRows}
      </div>
      <div class="xp-card" style="margin:0">
        <div class="xp-card-left">
          <div class="xp-level-badge">Lv.${xpInfo.level}</div>
          <div class="xp-card-info">
            <div class="xp-title">${xpInfo.title}</div>
            <div class="xp-sub">Noch ${xpInfo.xpNeeded - xpInfo.xpCurrent} XP bis Stufe ${xpInfo.level + 1}</div>
          </div>
        </div>
        <div class="xp-card-right">
          <div class="xp-bar-wrap">
            <div class="xp-bar"><div class="xp-fill" style="width:${xpInfo.pct}%"></div></div>
            <div class="xp-pct">${xpInfo.pct}%</div>
          </div>
          <div class="xp-total">Gesamt: ${xpInfo.totalXP} XP</div>
        </div>
      </div>
    </div>

    <div class="section-title" style="margin-top:32px;margin-bottom:12px">Lern-Aktivität</div>
    ${renderStreakCalendar()}

    <div class="section-title" style="margin-top:32px;margin-bottom:12px">Lernbericht für Eltern teilen</div>
    <div class="share-link-card">
      <div class="share-link-info">
        <div class="share-link-title">Lernbericht für Eltern</div>
        <div class="share-link-sub">Eltern sehen: deinen Namen, Klasse, Anzahl Tests, durchschnittliche Note, Streak. Keine E-Mail, keine Freunde, keine privaten Daten.</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="share-link-input" id="shareLinkInput" readonly placeholder="Link wird gleich erstellt…">
        <button class="btn btn-primary btn-sm" onclick="window.LF.createShareLink()">Link erstellen</button>
        <button class="btn btn-ghost btn-sm" id="copyShareBtn" style="display:none" onclick="window.LF.copyShareLink()">Kopieren</button>
      </div>
    </div>

    <div class="danger-zone-card">
      <h3>${lfIcon('triangle-alert')} Gefahrenzone</h3>
      <p>Setzt alle Noten zurück. XP, Streak, Achievements und Tests bleiben erhalten.</p>
      <button class="btn btn-danger btn-sm" onclick="window.LF.resetAllGrades()">Alle meine Noten löschen</button>
    </div>`;
}

// ── Profil-Tab: Statistiken ───────────────
function _renderProfileStatsTab() {
  const grades   = userData?.grades || {};
  const subjects = Object.values(structure || {});
  const allGrades = Object.values(grades).filter(g => g.grade);
  const totalTests = allGrades.length;
  if (totalTests === 0) {
    return renderEmptyState({
      icon: 'chart-bar',
      title: 'Noch keine Daten',
      sub: 'Sobald du Tests schreibst, siehst du hier deine Trends.',
      ctaLabel: 'Daily Challenge starten',
      ctaAction: "location.hash='#/daily-challenge'",
    });
  }
  const avgGrade   = (allGrades.reduce((s,g)=>s+g.grade,0)/totalTests).toFixed(2);
  const bestGrade  = Math.min(...allGrades.map(g=>g.grade));
  const streak     = calcStreak();

  const studyTimeMap = userData?.studyTime || {};
  const today = new Date();
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    return { label: d.toLocaleDateString('de-DE', { weekday: 'short' }), key, mins: studyTimeMap[key] || 0 };
  });
  const maxMins = Math.max(...last7.map(d => d.mins), 1);

  const subjectBars = subjects.map(s => {
    const prog = getSubjectProgress(s.id);
    if (prog.total === 0) return '';
    const color = getSubjectColor(s.id);
    const pct   = Math.round(prog.tested / prog.total * 100);
    const avgInfo = prog.avgGrade ? ` · Ø Note ${prog.avgGrade.toFixed(1)}` : '';
    return `
      <div class="subj-bar-row">
        <div class="subj-bar-label">
          <span>${getSubjectIcon(s.id)} ${escapeHtml(s.name)}</span>
          <span class="subj-bar-meta">${prog.tested}/${prog.total} Themen${avgInfo}</span>
        </div>
        <div class="subj-bar-track"><div class="subj-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="subj-bar-pct" style="color:${color}">${pct}%</div>
      </div>`;
  }).join('');

  const allAttempts = Object.entries(grades).flatMap(([key, g]) => {
    const [subjectId, yearId, topicId] = key.split('__');
    const subject = structure?.[subjectId];
    const topic   = subject?.years?.[yearId]?.topics?.[topicId];
    if (!subject || !topic) return [];
    if (g.history?.length) {
      return g.history.map(h => ({ subjectId, yearId, topicId, subject, topic, h }));
    }
    if (g.date?.seconds) {
      const gp = _gp(g);
      return [{ subjectId, yearId, topicId, subject, topic,
        h: { points: gp.pts, maxPoints: gp.max, grade: g.grade,
             date: new Date(g.date.seconds * 1000).toISOString() } }];
    }
    return [];
  }).sort((a, b) => new Date(b.h.date) - new Date(a.h.date)).slice(0, 15);

  const testRows = allAttempts.map(({ subjectId, yearId, topicId, subject, topic, h }) => `
    <tr onclick="location.hash='#/fach/${subjectId}/${yearId}/${topicId}'" style="cursor:pointer">
      <td>${getSubjectIcon(subjectId)} ${escapeHtml(subject.name)}</td>
      <td>${escapeHtml(topic.name)}</td>
      <td><span class="grade-pill" style="background:${gradeColor(h.grade)}">${h.grade}</span></td>
      <td>${h.points}/${h.maxPoints}</td>
      <td>${new Date(h.date).toLocaleDateString('de-DE')}</td>
    </tr>`).join('');

  const gradeCounts = [1,2,3,4,5,6].map(n => ({ grade: n, count: allGrades.filter(g => g.grade === n).length }));
  const maxCount = Math.max(...gradeCounts.map(g=>g.count), 1);
  const gradeDistribution = gradeCounts.map(({grade, count}) => `
    <div class="grade-dist-col">
      <div class="grade-dist-bar-wrap">
        <div class="grade-dist-count">${count || ''}</div>
        <div class="grade-dist-bar" style="height:${Math.round(count/maxCount*80)+8}px;background:${gradeColor(grade)}"></div>
      </div>
      <div class="grade-dist-label">${grade}</div>
    </div>`).join('');

  return `
    <div class="stats-overview-grid">
      <div class="stat-overview-card"><div class="soc-val">${totalTests}</div><div class="soc-lbl">Tests insgesamt</div></div>
      <div class="stat-overview-card"><div class="soc-val" style="color:${gradeColor(Math.round(parseFloat(avgGrade)))}">${avgGrade}</div><div class="soc-lbl">Ø Note gesamt</div></div>
      <div class="stat-overview-card"><div class="soc-val" style="color:${gradeColor(bestGrade)}">${bestGrade}</div><div class="soc-lbl">Beste Note</div></div>
      <div class="stat-overview-card"><div class="soc-val">${streak}</div><div class="soc-lbl">${lfIcon('flame', {cls:'sx-streak'})} Tage Streak</div></div>
    </div>

    <div class="stats-section-grid">
      <div class="stats-card">
        <div class="stats-card-title">${lfIcon('trending-up')} Fortschritt nach Fach</div>
        <div class="subj-bars">${subjectBars || '<div class="empty-state" style="padding:16px">Keine Daten</div>'}</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-title">${lfIcon('chart-bar')} Notenverteilung</div>
        <div class="grade-distribution">${gradeDistribution}</div>
        <div class="grade-dist-legend">Note 1 (sehr gut) → Note 6 (ungenügend)</div>
      </div>
    </div>

    <div class="stats-card" style="margin-top:16px">
      <div class="stats-card-title">${lfIcon('clock')} Letzte Versuche</div>
      ${testRows ? `
        <div class="table-wrap">
          <table class="stats-table">
            <thead><tr><th>Fach</th><th>Thema</th><th>Note</th><th>Punkte</th><th>Datum</th></tr></thead>
            <tbody>${testRows}</tbody>
          </table>
        </div>` : '<div class="empty-state" style="padding:16px">Keine Tests</div>'}
    </div>

    <div class="stats-card" style="margin-top:16px">
      <div class="stats-card-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>${lfIcon('timer')} Lernzeit (letzte 7 Tage)</span>
        <button class="btn btn-ghost btn-sm" onclick="window.LF.exportGradesCSV()">${lfIcon('download')} CSV exportieren</button>
      </div>
      <div class="study-time-chart">
        ${last7.map(d => `
          <div class="stc-col">
            <div class="stc-mins">${d.mins > 0 ? d.mins + ' min' : ''}</div>
            <div class="stc-bar-wrap"><div class="stc-bar" style="height:${Math.round(d.mins/maxMins*80)+4}px"></div></div>
            <div class="stc-label">${d.label}</div>
          </div>`).join('')}
      </div>
    </div>`;
}

// ── Profil-Tab: Erfolge ───────────────────
function _renderProfileErfolgeTab() {
  const achieved = new Set(userData?.achievements || []);
  const filter   = window.LF._achFilter || 'all';

  let list = ACHIEVEMENTS.slice();
  if (filter === 'unlocked') list = list.filter(a => achieved.has(a.id));
  else if (filter === 'locked') list = list.filter(a => !achieved.has(a.id));

  const tiles = list.map(a => {
    const unlocked = achieved.has(a.id);
    return `
      <div class="ach-tile ${unlocked ? 'ach-unlocked' : 'ach-locked'}"
           onclick="window.LF.openAchievement('${a.id}')"
           title="${escapeHtml(a.title)} (${escapeHtml(a.code)})">
        <div class="ach-code" style="${unlocked ? `background:${a.color};color:#fff` : ''}">${a.iconName ? lfIcon(a.iconName) : escapeHtml(a.code)}</div>
        <div class="ach-title">${escapeHtml(a.title)}</div>
        ${unlocked ? `<div class="ach-xp">+${a.xp} XP</div>` : `<div class="ach-xp ach-xp-locked">${a.xp} XP</div>`}
      </div>`;
  }).join('') || '<div class="empty-state" style="padding:32px">Keine Erfolge in dieser Kategorie.</div>';

  const fBtn = (k, label) => `<button class="ach-filter-chip ${filter===k?'active':''}" onclick="window.LF.setAchFilter('${k}')">${label}</button>`;

  return `
    <div class="ach-header-row">
      <span class="ach-count-badge">Geschafft: ${achieved.size} von ${ACHIEVEMENTS.length}</span>
      <div class="ach-filter-chips">
        ${fBtn('all', 'Alle')}
        ${fBtn('unlocked', 'Geschafft')}
        ${fBtn('locked', 'Offen')}
      </div>
    </div>
    <div class="achievement-grid">${tiles}</div>`;
}

// ── Profil-Tab: Inventar ──────────────────
// Behält die Logik aus renderInventory(); wird hier als Tab-Inhalt gerendert.
//
// Mission 7 — Locked-Cards-V2:
// Statt opacity:0.5 + Klartext "Erfordert Lv. 80" → mysterioeses Schloss-Layout
// mit "???"-Name, Rarity-Stripe, Hint-Zeile + Tap-Tooltip. Bei Epic/Legendary
// laeuft die Animation im Hintergrund weiter (gedimmt). Old `.locked` bleibt
// fuer Backwards-Compat, neuer Code nutzt `.inv-locked-v2`.
//
// Hint-Mapping verbatim aus Maya's Spec (Mission 7 Copy-Tabelle):
function _lockedHintCompact(kind, tier) {
  if (kind === 'outline') return `Erfordert Lv. ${tier.level}`;
  // theme — by rarity:
  if (tier.rarity === 'common')    return 'Drop in Tests';
  if (tier.rarity === 'rare')      return 'Drop in Tests';
  if (tier.rarity === 'epic')      return 'Seltener Drop';
  if (tier.rarity === 'legendary') return 'Sehr seltener Drop';
  return '';
}
function _lockedHintLong(kind, tier) {
  if (kind === 'outline') {
    return `Lerne weiter, um Level ${tier.level} zu erreichen — dann ist „${tier.name}“ deins.`;
  }
  if (tier.rarity === 'common') {
    return `„${tier.name}“ dropt zu 60% bei Note 1 oder Note 2. Schreib gute Tests, der Drop kommt von alleine.`;
  }
  if (tier.rarity === 'rare') {
    return `„${tier.name}“ dropt mit ca. 28% bei Note 1, 32% bei Note 2. Etwas Geduld zahlt sich aus.`;
  }
  if (tier.rarity === 'epic') {
    return `„${tier.name}“ dropt zu 10% bei Note 1, 7% bei Note 2 — wenn der Drop kommt. Sammle Tests, das gibt mehr Würfe.`;
  }
  if (tier.rarity === 'legendary') {
    return `„${tier.name}“ dropt nur in 1–2% der Fälle — und das nur bei Note 1 oder 2. Ein echtes Trophy-Item.`;
  }
  return '';
}

function _renderProfileInventarTab() {
  const xp           = userData?.xp || 0;
  const lvl          = calcLevel(xp).level;
  const ownedThemes  = userData?.themes || ['default'];
  const activeTheme  = userData?.activeTheme || 'default';
  const activeOL     = userData?.activeOutline || null;
  const isAdminTester = isAdmin() || userData?.role === 'tester';
  const initial   = (userData?.name || currentUser.displayName || 'U')[0].toUpperCase();
  const activeOlTier = OUTLINE_TIERS.find(t => t.id === activeOL) || outlineForLevel(lvl);
  const activeThemeName = (THEMES.find(t => t.id === activeTheme) || {}).name || activeTheme;

  const outlineCards = OUTLINE_TIERS.map(tier => {
    const unlocked = lvl >= tier.level || isAdminTester || (userData?.outlines || []).includes(tier.id);
    const active   = activeOL === tier.id || (!activeOL && tier.id === outlineForLevel(lvl).id);
    const previewClass = unlocked ? tier.css : '';
    if (unlocked) {
      return `
        <div class="inv-card ${active ? 'active' : ''}"
             onclick="window.LF.selectOutline('${tier.id}')">
          ${active ? '<span class="inv-active-tag">Aktiv</span>' : ''}
          <div class="inv-preview ${previewClass}">${tier.id === 'none' ? '—' : '◉'}</div>
          <div class="inv-name">${escapeHtml(tier.name)}</div>
          <div class="inv-meta">Level ${tier.level}</div>
          ${tier.rarity !== 'common' ? `<span class="inv-rarity inv-rarity-${tier.rarity}">${tier.rarity}</span>` : ''}
        </div>`;
    }
    // Locked-V2 — Outline (Animation im Preview gedimmt fuer epic/legendary).
    const hintShort = _lockedHintCompact('outline', tier);
    const hintLong  = _lockedHintLong('outline', tier);
    const ariaLabel = `${tier.name}, gesperrt — ${hintShort}`;
    return `
      <div class="inv-card inv-locked-v2 inv-rarity-bg-${tier.rarity} locked"
           role="button" aria-disabled="true" aria-label="${escapeHtml(ariaLabel)}"
           tabindex="0"
           data-hint="${escapeHtml(hintLong)}"
           data-rarity="${tier.rarity}"
           onclick="window.LF.showLockedHint(this)"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.LF.showLockedHint(this);}"
           onfocus="window.LF.showLockedHint(this)">
        <span class="inv-rarity-stripe"></span>
        <div class="inv-preview ${tier.css || ''}">
          <span class="inv-lock-overlay">${lfIcon('lock')}</span>
        </div>
        <div class="inv-name">???</div>
        <div class="inv-meta">${escapeHtml(hintShort)}</div>
        ${tier.rarity !== 'common' ? `<span class="inv-rarity inv-rarity-${tier.rarity}">${tier.rarity}</span>` : ''}
      </div>`;
  }).join('');

  const themeCards = THEMES.map(t => {
    const unlocked = ownedThemes.includes(t.id) || isAdminTester;
    const active   = activeTheme === t.id;
    if (unlocked) {
      return `
        <div class="inv-card ${active ? 'active' : ''}"
             onclick="window.LF.selectTheme('${t.id}')">
          ${active ? '<span class="inv-active-tag">Aktiv</span>' : ''}
          <div class="inv-theme-preview" data-theme-preview="${t.id}"></div>
          <div class="inv-name">${escapeHtml(t.name)}</div>
          <div class="inv-meta">${lfIcon('check', {cls:'sx-correct'})} Freigeschaltet</div>
          ${t.rarity !== 'common' ? `<span class="inv-rarity inv-rarity-${t.rarity}">${t.rarity}</span>` : ''}
        </div>`;
    }
    // Locked-V2 — Theme.
    const hintShort = _lockedHintCompact('theme', t);
    const hintLong  = _lockedHintLong('theme', t);
    const ariaLabel = `${t.name}, gesperrt — ${hintShort}`;
    return `
      <div class="inv-card inv-locked-v2 inv-rarity-bg-${t.rarity} locked"
           role="button" aria-disabled="true" aria-label="${escapeHtml(ariaLabel)}"
           tabindex="0"
           data-hint="${escapeHtml(hintLong)}"
           data-rarity="${t.rarity}"
           onclick="window.LF.showLockedHint(this)"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();window.LF.showLockedHint(this);}"
           onfocus="window.LF.showLockedHint(this)">
        <span class="inv-rarity-stripe"></span>
        <div class="inv-theme-preview" data-theme-preview="${t.id}">
          <span class="inv-lock-overlay">${lfIcon('lock')}</span>
        </div>
        <div class="inv-name">???</div>
        <div class="inv-meta">${escapeHtml(hintShort)}</div>
        ${t.rarity !== 'common' ? `<span class="inv-rarity inv-rarity-${t.rarity}">${t.rarity}</span>` : ''}
      </div>`;
  }).join('');

  return `
    <div class="inv-active-banner">
      <div class="inv-active-avatar ${activeOlTier.css || ''}">${
        (userData?.photoURL || currentUser.photoURL)
          ? `<img src="${escapeAttr(userData.photoURL || currentUser.photoURL)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : escapeHtml(initial)
      }</div>
      <div class="inv-active-info">
        <div class="inv-active-title">Aktiv</div>
        <div class="inv-active-meta">${escapeHtml(userData?.name || currentUser.displayName || 'Du')} · Theme: ${escapeHtml(activeThemeName)}</div>
        <div class="inv-active-hint">Tippe unten auf eine andere Karte zum Wechseln.</div>
      </div>
    </div>

    <div class="section-title" style="margin-top:24px">Avatar-Umrandungen — schalte sie frei beim Hochleveln</div>
    <div class="inv-grid">${outlineCards}</div>

    <div class="section-title" style="margin-top:32px">Farbpaletten — schalte sie frei mit guten Noten</div>
    <div class="inv-grid">${themeCards}</div>`;
}

// ── Profil-Tab: Selbsteinschaetzung (F-09 Cycle 6) ──────────
// Pro Topic eine Mini-Verlaufslinie: Konfidenz-Sterne vs Note (umgerechnet
// auf 1-5-Skala, wobei Note 1 → 5, Note 6 → 0). Topics ohne Konfidenz-Daten
// werden ausgelassen. Empty-State wenn nichts vorhanden.
//
// Maya-Spec-Mapping (F-09): reality = max(0, 6 - grade).
// Kein Heatmap, kein Cross-Topic-Aggregat (out-of-scope V1, siehe Spec).
function _renderProfileConfidenceTab() {
  const grades = userData?.grades || {};
  // Sammeln: pro Topic-Key alle Versuche mit confidence
  const topics = [];
  Object.entries(grades).forEach(([key, entry]) => {
    if (!entry || !Array.isArray(entry.history)) return;
    const series = entry.history
      .filter(h => typeof h?.confidence === 'number'
                && h.confidence >= 1 && h.confidence <= 5
                && typeof h.grade === 'number')
      .map(h => ({
        confidence: h.confidence,
        reality: Math.max(0, 6 - h.grade)
      }));
    if (series.length === 0) return;
    const [sid, yid, tid] = key.split('__');
    const subject = structure?.[sid];
    const topic   = subject?.years?.[yid]?.topics?.[tid];
    const subjectName = subject?.name || sid || '';
    const topicName   = topic?.name || tid || '';
    topics.push({ key, subjectName, topicName, series });
  });

  if (topics.length === 0) {
    return renderEmptyState({
      icon: 'target',
      title: 'Noch keine Konfidenz-Daten',
      sub: 'Vor dem n\xe4chsten Test einsch\xe4tzen — dann siehst du hier deinen Verlauf.',
      ctaLabel: 'Zur F\xe4cher-\xdcbersicht',
      ctaAction: "location.hash='#/lernen'",
    });
  }

  // Mini-Chart als Inline-SVG: 2 Linien (Konfidenz + Realitaet), Stufen 0-5.
  // Kein externer Chart-Lib — das hier sind 4-12 Punkte pro Topic, ein
  // hand-gezeichnetes path="M..." reicht und vermeidet einen weiteren Import.
  const chartFor = (series) => {
    const W = 280, H = 90, padX = 8, padY = 8;
    const innerW = W - 2 * padX;
    const innerH = H - 2 * padY;
    const n = series.length;
    const xFor = (i) => padX + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = (v) => padY + (1 - (v / 5)) * innerH;
    const linePath = (key) => series
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i).toFixed(1)},${yFor(p[key]).toFixed(1)}`)
      .join(' ');
    const dots = (key, color) => series
      .map((p, i) => `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p[key]).toFixed(1)}" r="3" fill="${color}"/>`)
      .join('');
    return `
      <svg class="confidence-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path d="${linePath('confidence')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${linePath('reality')}" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots('confidence', 'var(--accent)')}
        ${dots('reality', 'var(--success)')}
      </svg>`;
  };

  const cards = topics.map(t => `
    <div class="confidence-history-card">
      <div class="confidence-history-title">${escapeHtml(t.subjectName)} \xb7 ${escapeHtml(t.topicName)}</div>
      <div class="confidence-history-sub">${t.series.length} Versuch${t.series.length !== 1 ? 'e' : ''} mit Selbsteinsch\xe4tzung</div>
      ${chartFor(t.series)}
      <div class="confidence-chart-legend">
        <span><span class="confidence-chart-legend-dot" style="background:var(--accent)"></span>Konfidenz</span>
        <span><span class="confidence-chart-legend-dot" style="background:var(--success)"></span>Note (umgerechnet)</span>
      </div>
    </div>`).join('');

  return `<div class="confidence-history-list">${cards}</div>`;
}

// Theme-Previews als Hintergrund auf data-theme-preview-Karten zeichnen
function _drawThemePreviews() {
  setTimeout(() => {
    document.querySelectorAll('[data-theme-preview]').forEach(el => {
      const t = el.dataset.themePreview;
      const map = {
        'default':   'linear-gradient(135deg,#6366f1,#a855f7)',
        'ocean':     'linear-gradient(135deg,#0891b2,#22d3ee)',
        'forest':    'linear-gradient(135deg,#16a34a,#4ade80)',
        'sand':      'linear-gradient(135deg,#fde68a,#b45309)',
        'schiefer':  'linear-gradient(135deg,#cbd5e1,#475569)',
        'sunset':    'linear-gradient(135deg,#ea580c,#fbbf24)',
        'lavender':  'linear-gradient(135deg,#a855f7,#c4b5fd)',
        'crimson':   'linear-gradient(135deg,#dc2626,#f87171)',
        'mint':      'linear-gradient(135deg,#14b8a6,#5eead4)',
        'cherry':    'linear-gradient(135deg,#ec4899,#f9a8d4)',
        'carbon':    'linear-gradient(135deg,#171717,#525252)',
        'aurora':    'linear-gradient(135deg,#6366f1,#a855f7,#ec4899,#06b6d4)',
        'cyberpunk': 'linear-gradient(135deg,#0a0014,#ec4899,#8b5cf6)',
      };
      el.style.background = map[t] || map.default;
    });
  }, 0);
}

// ── Rangliste ────────────────────────────
// Mission 1: 3 Tabs — Meine Klasse / Global / Fach. Default = Klasse, fällt
// zurück auf Global wenn keine Klasse gesetzt. Solo-Empty-State per Open-Q-8.
async function renderLeaderboard() {
  const lbTab = window.LF._lbTab || 'klasse';
  const myKlasse = userData?.klasse ? String(userData.klasse) : null;

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Rangliste' }])}
    <div class="page">
      <div class="page-header">
        <h1>${lfIcon('trophy')} Rangliste</h1>
        <div class="sub">Wer ist vorn?</div>
      </div>
      <div class="lb-tabs" id="lbTabs">
        <button class="lb-tab ${lbTab==='klasse'?'active':''}" onclick="window.LF.switchLbTab('klasse')">Meine Klasse${myKlasse ? ` (${myKlasse})` : ''}</button>
        <button class="lb-tab ${lbTab==='global'?'active':''}" onclick="window.LF.switchLbTab('global')">Global</button>
        <button class="lb-tab ${lbTab==='fach'?'active':''}"   onclick="window.LF.switchLbTab('fach')">Nach Fach</button>
      </div>
      <div id="lbContent"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  let data = [];
  let permError = false;
  try {
    // Wenn der User in seiner Klasse-Tab ist und Klasse gesetzt: Server-side Filter.
    // Sonst alle Docs holen, client-seitig im Fach-Tab gruppieren.
    if (lbTab === 'klasse' && myKlasse) {
      data = await getLeaderboard(myKlasse);
    } else {
      data = await getLeaderboard();
    }
  }
  catch(e) { if (e.code === 'permission-denied') permError = true; }

  if (permError) {
    document.getElementById('lbContent').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${lfIcon('lock')}</div>
        Firestore-Regel fehlt.<br>
        <small style="color:var(--text-light);font-size:13px;display:block;margin-top:8px">
          Füge in der Firebase Console unter Firestore → Regeln hinzu:<br>
          <code style="font-size:11px">match /leaderboard/{uid} { allow read: if request.auth != null; allow write: if request.auth.uid == uid; }</code>
        </small>
      </div>`;
    return;
  }

  // Helper: gemeinsamer Row-Renderer
  const renderRow = (rank, u, score, count, isMe, scoreLabel = 'Pkt') => {
    const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32']; // Maya-Mapping: gold/silber/bronze
    const medal = rank <= 3
      ? lfIcon('medal', { cls: 'lb-medal', color: medalColors[rank-1] })
      : `<span style="font-size:13px;font-weight:700;color:var(--text-muted)">${rank}</span>`;
    // Wave-1-Ramsey CHEAT-24: photoURL als Attribut escapen.
    const av = u.photoURL
      ? `<img src="${escapeAttr(u.photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : escapeHtml((u.displayName || '?')[0].toUpperCase());
    return `
      <div class="lb-row${isMe?' lb-me':''}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-avatar ${outlineFor(u)}">${av}</div>
        <div class="lb-name">${escapeHtml(u.displayName||'Unbekannt')} ${roleBadge(u.role)}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
        <div class="lb-meta">${count} ${count===1?scoreLabel.slice(0,4):scoreLabel}</div>
        <div class="lb-score" style="color:var(--accent)">${score}</div>
      </div>`;
  };

  // Empty-State je nach Tab
  if (lbTab === 'klasse') {
    if (!myKlasse) {
      document.getElementById('lbContent').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">${lfIcon('school')}</div>
          Wähle deine Klasse im Profil, um eine klassenspezifische Rangliste zu sehen.
          <div style="margin-top:16px">
            <button class="btn btn-primary btn-sm" onclick="location.hash='#/profil'">Klasse setzen</button>
            <button class="btn btn-ghost btn-sm" onclick="window.LF.switchLbTab('global')">Zur Globalen Rangliste</button>
          </div>
        </div>`;
      return;
    }
    if (!data.length || (data.length === 1 && data[0].uid === currentUser?.uid)) {
      // solo-Klasse oder keine Einträge
      const me = data.find(u => u.uid === currentUser?.uid);
      const meRow = me ? `<div class="lb-main"><div class="lb-main-title">Du in Klasse ${escapeHtml(myKlasse)}</div>${renderRow(1, me, Object.values(me.scores||{}).reduce((a,b)=>a+b,0), Object.keys(me.scores||{}).length, true)}</div>` : '';
      document.getElementById('lbContent').innerHTML = `
        ${meRow}
        <div class="empty-state" style="margin-top:16px">
          <div class="empty-icon">${lfIcon('hand')}</div>
          Bisher bist du der Einzige in Klasse ${escapeHtml(myKlasse)} — frag deine Mitschüler!
          <div style="margin-top:16px">
            <button class="btn btn-ghost btn-sm" onclick="window.LF.switchLbTab('global')">Zur Globalen Rangliste</button>
          </div>
        </div>`;
      return;
    }
  } else if (!data.length) {
    document.getElementById('lbContent').innerHTML = renderEmptyState({
      icon: 'trophy',
      title: 'Rangliste ist leer',
      sub: 'Sei der Erste — schreib einen Test, dein Score erscheint sofort.',
      ctaLabel: 'Zur Fächer-Übersicht',
      ctaAction: "location.hash='#/lernen'",
    });
    return;
  }

  const subjects = Object.values(structure || {});
  const users = data.map(u => {
    const sc = u.scores || {};
    const subjectTotals = {};
    subjects.forEach(s => {
      const vals = Object.entries(sc).filter(([k]) => k.startsWith(s.id + '__')).map(([,v]) => v);
      if (vals.length) subjectTotals[s.id] = { total: vals.reduce((a,b)=>a+b,0), count: vals.length };
    });
    const all = Object.values(sc);
    return { ...u, subjectTotals, overall: all.reduce((a,b)=>a+b,0), testCount: all.length };
  }).filter(u => u.testCount > 0);

  if (lbTab === 'fach') {
    // Tab "Nach Fach": pro-Fach-Top-5 + zusätzlich XP-Liste am Ende
    const subjectGridHtml = subjects.map(s => {
      const ranked = users.filter(u=>u.subjectTotals[s.id]).sort((a,b)=>b.subjectTotals[s.id].total-a.subjectTotals[s.id].total).slice(0,5);
      if (!ranked.length) return '';
      const color = getSubjectColor(s.id);
      return `
        <div class="lb-card">
          <div class="lb-card-head" style="border-top:3px solid ${color}">${getSubjectIcon(s.id)} ${escapeHtml(s.name)}</div>
          ${ranked.map((u,i)=>renderRow(i+1,u,u.subjectTotals[s.id].total,u.subjectTotals[s.id].count,u.uid===currentUser?.uid,'Tests')).join('')}
        </div>`;
    }).filter(Boolean).join('');

    document.getElementById('lbContent').innerHTML = subjectGridHtml
      ? `<div class="lb-grid">${subjectGridHtml}</div>`
      : `<div class="empty-state"><div class="empty-icon">${lfIcon('book-open')}</div>Noch keine Fach-Daten vorhanden.</div>`;
    return;
  }

  // Tabs "klasse" + "global": gleiche Darstellung — Top 10 Punkte + Top 10 XP
  const top10 = [...users].sort((a,b)=>b.overall-a.overall).slice(0,10);
  const top10Html = top10.map((u,i)=>renderRow(i+1,u,u.overall,u.testCount,u.uid===currentUser?.uid,'Tests')).join('');

  const xpSorted = [...users].filter(u => u.xp > 0).sort((a,b) => (b.xp||0)-(a.xp||0)).slice(0,10);
  const xpHtml = xpSorted.length ? xpSorted.map((u,i) => {
    const xi = calcLevel(u.xp || 0);
    const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
    const medal = i < 3
      ? lfIcon('medal', { cls: 'lb-medal', color: medalColors[i] })
      : `<span style="font-size:13px;font-weight:700;color:var(--text-muted)">${i+1}</span>`;
    // Wave-1-Ramsey CHEAT-24: photoURL als Attribut escapen.
    const av = u.photoURL
      ? `<img src="${escapeAttr(u.photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : escapeHtml((u.displayName||'?')[0].toUpperCase());
    const isMe = u.uid === currentUser?.uid;
    return `
      <div class="lb-row${isMe?' lb-me':''}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-avatar ${outlineFor(u)}">${av}</div>
        <div class="lb-name">${escapeHtml(u.displayName||'Unbekannt')} ${roleBadge(u.role)}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
        <div class="lb-meta">Lv.${xi.level} ${escapeHtml(xi.title)}</div>
        <div class="lb-score" style="color:var(--warning)">${u.xp} XP</div>
      </div>`;
  }).join('') : renderEmptyState({
    icon: 'zap',
    title: 'Noch keine XP-Daten',
    sub: 'Dein erstes Lernen bringt XP — dann erscheinst du hier.',
    ctaLabel: 'Zur Fächer-Übersicht',
    ctaAction: "location.hash='#/lernen'",
  });

  const scopeLabel = lbTab === 'klasse' ? `Klasse ${escapeHtml(myKlasse)}` : 'Global';
  document.getElementById('lbContent').innerHTML = `
    <div class="lb-main">
      <div class="lb-main-title">Testpunkte — ${scopeLabel} Top 10</div>
      <div class="lb-header-row">
        <span class="lb-rank">Pl.</span><span class="lb-avatar"></span>
        <span class="lb-name">Name</span><span class="lb-meta">Tests</span><span class="lb-score">Pkt</span>
      </div>
      ${top10Html}
    </div>
    <div class="lb-main" style="margin-top:24px">
      <div class="lb-main-title">XP-Rangliste — ${scopeLabel} Top 10</div>
      <div class="lb-header-row">
        <span class="lb-rank">Pl.</span><span class="lb-avatar"></span>
        <span class="lb-name">Name</span><span class="lb-meta">Stufe</span><span class="lb-score">XP</span>
      </div>
      ${xpHtml}
    </div>`;
}

// ── Meine Inhalte ────────────────────────
async function renderMyContent() {
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Meine Inhalte' }])}
    <div class="page">
      <div class="page-header">
        <h1>Meine Inhalte</h1>
        <div class="sub">Selbst erstellte und Gruppen-Themen</div>
      </div>
      <div id="myContentBody">${skeletonCustomCards(4)}</div>
    </div>`;

  const uid = currentUser.uid;
  let html = '';

  try {
    const personal = await getMyCustomTopics(uid);
    html += `<h2 style="font-size:18px;font-weight:700;margin-bottom:12px">Persönliche Themen</h2>`;
    if (personal.length) {
      html += `<div class="custom-topic-grid">${personal.map(t => renderCustomTopicCard(t, true)).join('')}</div>`;
    } else {
      html += renderEmptyState({
        icon: 'pen-line',
        title: 'Du hast noch keine eigenen Themen',
        sub: 'Im Builder erstellst du eigene Lerninhalte für dich oder deine Gruppe.',
        ctaLabel: 'Builder öffnen',
        ctaAction: "location.hash='#/builder'",
      });
    }

    const groupIds = userData?.groupIds || [];
    if (groupIds.length) {
      const groups = await getUserGroups(groupIds);
      for (const group of groups) {
        const topics = await getGroupCustomTopics(group.id);
        html += `<h2 style="font-size:18px;font-weight:700;margin:28px 0 12px">Gruppe: ${escapeHtml(group.name || '')}</h2>`;
        if (topics.length) {
          html += `<div class="custom-topic-grid">${topics.map(t => renderCustomTopicCard(t, t.ownerUid === uid)).join('')}</div>`;
        } else {
          html += `<div class="empty-state" style="margin-bottom:16px">Noch keine Gruppenthemen.</div>`;
        }
      }
    }
  } catch(e) {
    html = `<div class="error-msg">Fehler beim Laden: ${e.message}</div>`;
  }

  document.getElementById('myContentBody').innerHTML = html || '<div class="empty-state">Keine Inhalte gefunden.</div>';
}

function renderCustomTopicCard(topic, canDelete) {
  // V-09 (Marcus, 2026-05-08, Mission-13): listCustomTopics returns
  // metadata-only summary rows with `questionCount` rather than the
  // full questions[]. Fallback to the array-length for callers that
  // still pass the full doc (e.g. detail page → list re-use).
  const qCount = typeof topic.questionCount === 'number'
    ? topic.questionCount
    : (topic.questions || []).length;
  const safeId = topic.id;
  // Wave-1-Ramsey CHEAT-21: ALLE User-controlled Felder escapen.
  // Phase 3a (Ethan, 2026-05-08): Visibility-Status-Badge.
  // Legacy-Compat: Topics ohne `visibility`-Field bekommen das aus groupId
  // abgeleitet — siehe firestore.rules customTopicReadOk() Backwards-Compat-
  // Mapping. Owner-Badge zeigen wir nur in den eigenen Topics (canDelete=true).
  const vis = topic.visibility
    || (topic.groupId ? 'group' : 'private');
  const badgeHtml = canDelete ? _renderVisibilityBadge(vis, topic) : '';
  // Re-Submit-Button ausschliesslich bei rejected (visibility wieder 'group',
  // aber rejectionNote vorhanden — Worker setzt das). Owner-only.
  // visibility-Check ist wichtig: nach Re-Submit ist visibility='pending-
  // approval' und der Worker submitTopicForApproval clearet rejectionNote
  // server-side im selben atomaren Batch (V-PHASE-E-03 — die Felder sind
  // jetzt rules-mäßig nur Worker-writable). Bei replication-lag koennte
  // die UI kurzzeitig den alten rejectionNote-String sehen, der visibility-
  // Filter (== 'group') verhindert aber dass der Reject-Banner nach Re-
  // Submit wieder erscheint.
  const isRejected = canDelete && !!topic.rejectionNote && vis === 'group';
  const isPending  = canDelete && vis === 'pending-approval';
  return `
    <div class="custom-topic-card">
      <div class="custom-topic-meta">${escapeHtml(topic.fach || '?')} · ${escapeHtml(topic.klasse || '?')}</div>
      <div class="custom-topic-name">${escapeHtml(topic.thema || 'Unbenannt')}</div>
      ${topic.description ? `<div class="custom-topic-desc">${escapeHtml(topic.description)}</div>` : ''}
      ${badgeHtml}
      ${isRejected ? `
        <div class="custom-topic-reject">
          <strong>Abgelehnt:</strong> ${escapeHtml(topic.rejectionNote)}
        </div>` : ''}
      <div class="custom-topic-footer">
        <span class="custom-topic-qcount">${qCount} Frage${qCount !== 1 ? 'n' : ''}</span>
        <div class="custom-topic-actions">
          <button class="btn btn-primary btn-sm" onclick="location.hash='#/meine-inhalte/${escapeAttr(safeId)}'">Ansehen</button>
          ${isRejected ? `<button class="btn btn-secondary btn-sm" onclick="window.LF.resubmitForPublic('${escapeAttr(safeId)}')">Erneut einreichen</button>` : ''}
          ${canDelete && !isPending ? `<button class="btn btn-ghost btn-sm" onclick="window.LF.deleteCustomTopicUI('${escapeAttr(safeId)}')">Löschen</button>` : ''}
        </div>
      </div>
    </div>`;
}

// Phase 3a (Ethan, 2026-05-08): Visibility-Status-Badge fuer Owner-Karten.
// Vier visuelle States — Farbe via CSS-Variablen (Theme-Regel: keine
// hardcoded Hex-Codes, alle vier Badges nutzen die existierenden semantic
// tokens --accent / --text-muted / --warn / --danger / --success).
function _renderVisibilityBadge(visibility, topic) {
  const items = {
    'private':          { icon: 'lock',              label: 'Privat',                                cls: 'is-private' },
    'group':            { icon: 'users-round',       label: 'Gruppe',                                cls: 'is-group' },
    'pending-approval': { icon: 'clock',             label: 'Eingereicht — wartet auf Approval',    cls: 'is-pending' },
    'public':           { icon: 'globe',             label: 'Public-Library',                        cls: 'is-public' }
  };
  // Wenn rejectionNote vorhanden → optisch als 'rejected' anzeigen, auch
  // wenn der Worker visibility zurueck auf 'group' gesetzt hat.
  if (topic?.rejectionNote && visibility === 'group') {
    return `<div class="custom-topic-vis-badge is-rejected">
      ${lfIcon('circle-x')} <span>Abgelehnt</span>
    </div>`;
  }
  const it = items[visibility] || items.private;
  return `<div class="custom-topic-vis-badge ${it.cls}">
    ${lfIcon(it.icon)} <span>${it.label}</span>
    ${visibility === 'pending-approval' ? '<span class="spinner-inline" style="margin-left:6px"></span>' : ''}
  </div>`;
}

async function renderCustomTopicPage(topicId) {
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Meine Inhalte', href: '#/meine-inhalte' }])}
    <div class="page">
      <div id="customTopicBody"><div class="spinner" style="margin:60px auto"></div></div>
    </div>`;

  try {
    customTopicData = await getCustomTopicById(topicId);
    if (!customTopicData) { location.hash = '#/meine-inhalte'; return; }
    const t = customTopicData;
    const qCount = (t.questions || []).length;

    // Wave-1-Ramsey CHEAT-21: Felder + Content harden.
    // t.content darf legitimes HTML enthalten — sanitizeTopicContent whitelistet
    // nur Text-Tags; script/img/iframe/onclick/onerror sind weg. Neue Inhalte
    // sollten ueber serializedBlocks (visual-builder) reinkommen.
    const safeContent = t.content
      ? sanitizeTopicContent(t.content)
      : '<p style="color:var(--text-muted)">Kein Inhalt vorhanden.</p>';
    // Sophie P2-5 (Cycle 7): Custom-Topic mit Lese-Inhalt aber ohne Browser-
    // TTS-API → Fallback-Toast hier feuern (Spam-Schutz via LocalStorage).
    if (t.content && !_audioModeAvailable()) {
      _audioWarnUnavailableOnce();
    }
    document.getElementById('customTopicBody').innerHTML = `
      <div class="page-header">
        <div class="breadcrumb-sub">${escapeHtml(t.fach || '')} · ${escapeHtml(t.klasse || '')}</div>
        <h1>${escapeHtml(t.thema || '')}</h1>
        ${t.description ? `<div class="sub">${escapeHtml(t.description)}</div>` : ''}
      </div>
      <div class="topic-tab-bar">
        <button class="tab-btn active" id="ctTabBtnLernen" onclick="window.LF.ctSwitchTab('Lernen')">Lernen</button>
        ${qCount > 0 ? `<button class="tab-btn" id="ctTabBtnTest" onclick="window.LF.ctSwitchTab('Test')">Test</button>` : ''}
      </div>
      ${(_audioModeAvailable() && t.content)
        ? `<div class="topic-toolbar"><button class="btn btn-ghost btn-sm audio-toolbar-btn" id="audioToolbarBtn" onclick="window.LF.toggleAudioMode()">${_audioHeadphonesIcon()} Vorlesen</button></div>`
        : ''}
      <div id="ctTabLernen">
        <div class="content-body">${safeContent}</div>
      </div>
      ${qCount > 0 ? `
      <div id="ctTabTest" style="display:none">
        <div class="test-setup-card">
          <h2>Test starten</h2>
          <p class="sub">${qCount} Frage${qCount !== 1 ? 'n' : ''} verfügbar</p>
          <div id="ctTestArea">
            <button class="btn btn-primary btn-lg" onclick="window.LF.startCustomTest()">Test starten</button>
          </div>
        </div>
      </div>` : ''}`;
    // Sophie P1-1 (Cycle 7): Resume-Prompt auch fuer Custom-Topic-Pages.
    _audioMaybeShowResumePrompt();
  } catch(e) {
    document.getElementById('customTopicBody').innerHTML = `<div class="error-msg">Fehler: ${e.message}</div>`;
  }
}

// ── Gruppen ──────────────────────────────
async function renderGroups() {
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Gruppen' }])}
    <div class="page">
      <div class="page-header">
        <h1>Lerngruppen</h1>
        <div class="sub">Lerne gemeinsam — max. 2 Gruppen pro Konto.</div>
      </div>
      <div id="groupsContent"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  const groupIds = userData?.groupIds || [];
  const groups   = await getUserGroups(groupIds);

  const myCount  = groups.length;
  const canJoin  = myCount < 2;

  // Wave-1-Ramsey CHEAT-24: Group-Name escapen (User-controlled beim Erstellen).
  const groupCards = groups.map(g => {
    const memberCount = Object.keys(g.members || {}).length;
    const isCreator   = g.creatorUid === currentUser.uid;
    return `
      <div class="group-card" onclick="location.hash='#/gruppen/${escapeAttr(g.id)}'">
        <div class="group-card-info">
          <div class="group-card-name">${escapeHtml(g.name || '')}</div>
          <div class="group-card-meta">${memberCount} Mitglied${memberCount !== 1 ? 'er' : ''} · ${isCreator ? 'Admin' : 'Mitglied'}</div>
        </div>
        <div class="group-card-arrow">›</div>
      </div>`;
  }).join('');

  document.getElementById('groupsContent').innerHTML = `
    ${groups.length > 0 ? `<div class="group-list">${groupCards}</div>` : ''}
    ${groups.length === 0 ? renderEmptyState({
      icon: 'users',
      title: 'Du bist in keiner Gruppe',
      sub: 'Erstelle eine eigene oder tritt einer per Code bei.',
      ctaLabel: 'Gruppe erstellen',
      ctaAction: "document.getElementById('newGroupName')?.focus()",
    }) : ''}

    <div class="group-actions-grid">
      <div class="card" style="padding:20px">
        <div class="section-title" style="margin-bottom:12px">Gruppe erstellen</div>
        ${canJoin
          ? `<div class="form-group">
               <input class="form-input" id="newGroupName" placeholder="Gruppenname" maxlength="40">
             </div>
             <button class="btn btn-primary" onclick="window.LF.groupCreate()">Erstellen</button>`
          : `<p style="color:var(--text-muted);font-size:14px">Du bist bereits in 2 Gruppen (Maximum erreicht).</p>`
        }
      </div>
      <div class="card" style="padding:20px">
        <div class="section-title" style="margin-bottom:12px">Gruppe beitreten</div>
        ${canJoin
          ? `<div class="form-group">
               <input class="form-input" id="joinCode" placeholder="Einladungscode (6 Zeichen)" maxlength="6"
                      style="text-transform:uppercase" oninput="this.value=this.value.toUpperCase()">
             </div>
             <button class="btn btn-secondary" onclick="window.LF.groupJoin()">Beitreten</button>`
          : `<p style="color:var(--text-muted);font-size:14px">Du bist bereits in 2 Gruppen (Maximum erreicht).</p>`
        }
      </div>
    </div>`;
}

async function renderGroupDetail(groupId) {
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Gruppen', href: '#/gruppen' }, { label: '…' }])}
    <div class="page">
      <div id="groupDetailContent"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  let groupSnap;
  try {
    groupSnap = await db().collection('groups').doc(groupId).get();
  } catch(e) {
    document.getElementById('groupDetailContent').innerHTML = `<div class="error-msg">Fehler: ${e.message}</div>`;
    return;
  }
  if (!groupSnap.exists) { location.hash = '#/gruppen'; return; }

  const group     = { id: groupSnap.id, ...groupSnap.data() };
  const isCreator = group.creatorUid === currentUser.uid;
  const members   = Object.entries(group.members || {});
  const memberUids = members.map(([uid]) => uid);

  // Wave-1-Ramsey CHEAT-24: Group-Name + Member-Display-Name escapen,
  // onclick-Args via escapeAttr.
  // Re-render nav with group name
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Gruppen', href: '#/gruppen' }, { label: group.name }])}
    <div class="page">
      <div class="page-header">
        <h1>${escapeHtml(group.name || '')}</h1>
        <div class="sub">${members.length} Mitglied${members.length !== 1 ? 'er' : ''}</div>
      </div>
      <div id="groupDetailContent"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  // Mitgliederliste
  const memberRows = members.map(([uid, m]) => `
    <div class="group-member-row">
      <div class="group-member-avatar">${escapeHtml((m.displayName||'?')[0].toUpperCase())}</div>
      <div class="group-member-info">
        <div class="group-member-name">${escapeHtml(m.displayName || 'Unbekannt')} ${m.role === 'admin' ? '<span class="group-admin-badge">Gruppen-Admin</span>' : ''} ${roleBadge(m.userRole)}</div>
      </div>
      ${isCreator && uid !== currentUser.uid
        ? `<button class="btn btn-ghost btn-sm" onclick="window.LF.groupKick('${escapeAttr(groupId)}','${escapeAttr(uid)}','${escapeAttr(m.displayName || '')}')">Entfernen</button>`
        : ''}
    </div>`).join('');

  // Gruppen-Rangliste (Leaderboard gefiltert auf Mitglieder)
  let lbHtml = '<div class="spinner" style="margin:16px auto"></div>';

  document.getElementById('groupDetailContent').innerHTML = `
    <div class="group-detail-grid">
      <div>
        <div class="section-title">Mitglieder</div>
        <div class="group-member-list">${memberRows}</div>

        ${isCreator
          ? `<div class="group-invite-box">
               <span class="group-invite-label">Einladungscode:</span>
               <code class="group-invite-code">${escapeHtml(group.code || '')}</code>
               <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${escapeAttr(group.code || '')}');window.LF.showToast('Code kopiert!','success')">Kopieren</button>
             </div>`
          : ''}

        <div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap">
          ${isCreator
            ? `<button class="btn btn-danger btn-sm" onclick="window.LF.groupDelete('${escapeAttr(groupId)}','${escapeAttr(group.name || '')}')">Gruppe löschen</button>`
            : `<button class="btn btn-secondary btn-sm" onclick="window.LF.groupLeave('${escapeAttr(groupId)}','${escapeAttr(group.name || '')}')">Gruppe verlassen</button>`
          }
        </div>
      </div>

      <div>
        <div class="section-title">Gruppen-Rangliste</div>
        <div id="groupLbContent">${lbHtml}</div>
        ${isCreator ? `
          <div class="section-title" style="margin-top:24px">Mitglieder-Statistiken</div>
          <div id="groupMemberStats"><div class="spinner" style="margin:16px auto"></div></div>` : ''}
      </div>
    </div>`;

  // Rangliste laden
  try {
    const allLb = await getLeaderboard();
    const groupLb = allLb
      .filter(u => memberUids.includes(u.uid))
      .map(u => {
        const sc  = Object.values(u.scores || {});
        const total = sc.reduce((a, b) => a + b, 0);
        return { ...u, total, testCount: sc.length };
      })
      .filter(u => u.testCount > 0)
      .sort((a, b) => b.total - a.total);

    const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
    // Wave-1-Ramsey CHEAT-24: Photo-URL als Attribut + Display-Name als HTML escapen.
    const lbRows = groupLb.map((u, i) => {
      const av = u.photoURL
        ? `<img src="${escapeAttr(u.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
        : escapeHtml((u.displayName||'?')[0].toUpperCase());
      const isMe = u.uid === currentUser.uid;
      const medalCell = i < 3
        ? lfIcon('medal', { cls: 'lb-medal', color: medalColors[i] })
        : `<span style="font-size:13px;font-weight:700;color:var(--text-muted)">${i+1}</span>`;
      return `
        <div class="lb-row${isMe ? ' lb-me' : ''}">
          <div class="lb-rank">${medalCell}</div>
          <div class="lb-avatar ${outlineFor(u)}">${av}</div>
          <div class="lb-name">${escapeHtml(u.displayName||'Unbekannt')} ${roleBadge(u.role)}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
          <div class="lb-meta">${u.testCount} Test${u.testCount!==1?'s':''}</div>
          <div class="lb-score" style="color:var(--accent)">${u.total}</div>
        </div>`;
    }).join('');

    document.getElementById('groupLbContent').innerHTML = groupLb.length
      ? lbRows
      : '<div class="empty-state" style="padding:16px;font-size:14px">Noch keine Tests gemacht.</div>';
  } catch(e) {
    document.getElementById('groupLbContent').innerHTML = `<div class="empty-state" style="padding:16px;font-size:14px">Rangliste nicht verf\xfcgbar.</div>`;
  }

  // F-43: Admin-Mitglieder-Statistiken laden
  if (isCreator) {
    try {
      const memberData = await getMultipleUserData(memberUids);
      const statsRows  = memberData.map(u => {
        const g      = u.grades || {};
        const vals   = Object.values(g).map(x => x.grade).filter(Boolean);
        const avg    = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '–';
        const streak = u.streak || 0;
        const totalTime = Object.values(u.studyTime || {}).reduce((a,b)=>a+b, 0);
        // Wave-1-Ramsey CHEAT-24: Photo-URL als Attribut + Name als HTML escapen.
        const av   = u.photoURL
          ? `<img src="${escapeAttr(u.photoURL)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
          : escapeHtml((u.name||'?')[0].toUpperCase());
        return `
          <tr>
            <td><div style="display:flex;align-items:center;gap:8px">
              <div class="lb-avatar" style="width:28px;height:28px;font-size:12px">${av}</div>
              ${escapeHtml(u.name || '–')}
            </div></td>
            <td>${vals.length}</td>
            <td><span class="grade-pill" style="background:${avg!=='–'?gradeColor(Math.round(parseFloat(avg))):'var(--border)'}">
              ${avg}
            </span></td>
            <td>${streak} ${lfIcon('flame', {cls:'sx-streak'})}</td>
            <td>${totalTime} min</td>
          </tr>`;
      }).join('');
      const statsEl = document.getElementById('groupMemberStats');
      if (statsEl) statsEl.innerHTML = memberData.length ? `
        <div class="table-wrap">
          <table class="stats-table">
            <thead><tr><th>Mitglied</th><th>Tests</th><th>Ø Note</th><th>Streak</th><th>Lernzeit</th></tr></thead>
            <tbody>${statsRows}</tbody>
          </table>
        </div>` : '<div class="empty-state" style="padding:16px;font-size:14px">Keine Daten.</div>';
    } catch {
      document.getElementById('groupMemberStats')?.remove();
    }
  }
}

// ── Admin-Panel ──────────────────────────
async function renderAdmin() {
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Admin' }])}
    <div class="page">
      <div class="page-header">
        <h1>Admin-Panel</h1>
        <div class="sub">Nur f&uuml;r Administratoren</div>
      </div>
      <div id="adminContent"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  let users = [];
  try { users = await getAllUsers(); } catch(e) {
    document.getElementById('adminContent').innerHTML = `<div class="error-msg">Fehler beim Laden der Nutzer: ${e.message}</div>`;
    return;
  }

  const rows = users
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    .map(u => {
      const testCount = Object.keys(u.grades || {}).length;
      const joined = u.createdAt?.seconds
        ? new Date(u.createdAt.seconds * 1000).toLocaleDateString('de-DE') : '–';
      // Wave-1-Ramsey CHEAT-24: Admin-Panel zeigt User-controlled Name +
      // Email — auch im Admin-Kontext escapen (Stored-XSS gegen Admin sonst
      // moeglich, Account-Takeover-Risiko).
      return `
        <div class="admin-user-row ${u.isBanned ? 'admin-user-banned' : ''}">
          <div class="admin-user-avatar">${escapeHtml((u.name || '?')[0].toUpperCase())}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${escapeHtml(u.name || 'Unbekannt')} ${u.isBanned ? '<span class="admin-ban-badge">GESPERRT</span>' : ''}</div>
            <div class="admin-user-meta">${escapeHtml(u.email || '–')} · ${testCount} Tests · beigetreten ${joined}</div>
          </div>
          <div class="admin-user-actions">
            <button class="btn btn-primary btn-sm" onclick="window.LF.adminEditUser('${escapeAttr(u.uid)}')">Bearbeiten</button>
            ${u.isBanned
              ? `<button class="btn btn-secondary btn-sm" onclick="window.LF.adminUnban('${escapeAttr(u.uid)}','${escapeAttr(u.name || '')}')">Entsperren</button>`
              : `<button class="btn btn-danger btn-sm" onclick="window.LF.adminBan('${escapeAttr(u.uid)}','${escapeAttr(u.name || '')}')">Sperren</button>`
            }
            <button class="btn btn-ghost btn-sm" onclick="window.LF.adminResetLb('${escapeAttr(u.uid)}','${escapeAttr(u.name || '')}')">Rangliste reset</button>
          </div>
        </div>`;
    }).join('');

  const toolsOverride = await loadToolsOverride();
  const allSubjects   = structure ? Object.values(structure) : [];
  const toolRows = allSubjects.map(s => {
    const t = { ...(s.tools || {}), ...((toolsOverride[s.id]) || {}) };
    return `
      <div class="admin-tool-row">
        <span class="admin-tool-fach">${getSubjectIcon(s.id)} ${s.name}</span>
        <label class="admin-tool-check">
          <input type="checkbox" data-subject="${s.id}" data-tool="calculator" ${t.calculator ? 'checked' : ''}
            onchange="window.LF.adminToggleTool('${s.id}','calculator',this.checked)">
          Taschenrechner
        </label>
        <label class="admin-tool-check">
          <input type="checkbox" data-subject="${s.id}" data-tool="tafelwerk" ${t.tafelwerk ? 'checked' : ''}
            onchange="window.LF.adminToggleTool('${s.id}','tafelwerk',this.checked)">
          Tafelwerk
        </label>
      </div>`;
  }).join('');

  document.getElementById('adminContent').innerHTML = `
    <div class="admin-stats-bar">
      <span>${users.length} Nutzer gesamt</span>
      <span>${users.filter(u=>u.isBanned).length} gesperrt</span>
      <span>${users.reduce((s,u)=>s+Object.keys(u.grades||{}).length,0)} Tests gesamt</span>
    </div>

    <div class="admin-section-title">Public-Library Approval-Queue</div>
    <div id="adminApprovalQueue"><div class="spinner" style="margin:24px auto"></div></div>

    <div class="admin-section-title">Hilfsmittel pro Fach</div>
    <div class="admin-tool-list">${toolRows || '<div class="empty-state">Keine F&auml;cher geladen.</div>'}</div>
    <button class="btn btn-primary" style="margin-bottom:24px" onclick="window.LF.adminSaveTools()">Hilfsmittel speichern</button>
    <div class="admin-section-title">Nutzerverwaltung</div>
    <div class="admin-user-list">${rows || '<div class="empty-state">Keine Nutzer gefunden.</div>'}</div>`;

  // Phase 3b (Ethan, 2026-05-08): Approval-Queue separat laden — die Read-
  // Rule fuer pendingApprovals ist admin-only (firestore.rules), und falls
  // ein Nicht-Admin (z.B. tester) das Admin-Panel via testing-Route oeffnet,
  // soll ein PERM_DENIED nicht das ganze Admin-Panel zerschiessen. Eigener
  // try/catch + isolierter Render.
  _renderAdminApprovalQueue();
}

async function _renderAdminApprovalQueue() {
  const target = document.getElementById('adminApprovalQueue');
  if (!target) return;
  // Phase 3b: nur fuer Admin-Email sichtbar (firestore.rules erlaubt nur
  // diese Whitelist + role:'admin'). Andere Admins sehen die Section nicht
  // (auch wenn sie das Admin-Panel betreten).
  if (currentUser?.email !== ADMIN_EMAIL) {
    target.innerHTML = '<div class="empty-state">Nur fuer simonkoper27@gmail.com.</div>';
    return;
  }
  let queue;
  try { queue = await getPendingApprovals(); }
  catch(e) {
    target.innerHTML = `<div class="error-msg">Fehler beim Laden der Queue: ${escapeHtml(e.message)}</div>`;
    return;
  }
  if (!queue.length) {
    target.innerHTML = '<div class="empty-state">Keine offenen Einreichungen.</div>';
    return;
  }
  target.innerHTML = queue.map(q => {
    const sum = q.topicSummary || {};
    const submittedDate = q.submittedAt?.seconds
      ? new Date(q.submittedAt.seconds * 1000).toLocaleString('de-DE') : '–';
    const ownerSuffix = q.ownerUid ? q.ownerUid.slice(0, 8) : '–';
    return `
      <div class="admin-approval-card">
        <div class="admin-approval-head">
          <div class="admin-approval-meta">${escapeHtml(sum.fach || '?')} · ${escapeHtml(sum.klasse || '?')}</div>
          <div class="admin-approval-title">${escapeHtml(sum.thema || 'Unbenannt')}</div>
          ${sum.description ? `<div class="admin-approval-desc">${escapeHtml(sum.description)}</div>` : ''}
          <div class="admin-approval-stats">
            <span>${sum.questionCount || 0} Frage${sum.questionCount === 1 ? '' : 'n'}</span>
            ${sum.subtopicCount ? `<span>· ${sum.subtopicCount} Untertopics</span>` : ''}
            <span>· eingereicht ${escapeHtml(submittedDate)}</span>
          </div>
          <div class="admin-approval-author">
            ${escapeHtml(q.ownerEmail || 'Unbekannt')} · uid:${escapeHtml(ownerSuffix)}
          </div>
          ${q.message ? `
            <div class="admin-approval-message">
              <strong>Nachricht des Authors:</strong>
              <div>${escapeHtml(q.message)}</div>
            </div>` : ''}
        </div>
        <div class="admin-approval-actions">
          <button class="btn btn-secondary btn-sm" onclick="window.LF.adminPreviewTopic('${escapeAttr(q.topicId)}')">
            Vorschau
          </button>
          <button class="btn btn-primary btn-sm" onclick="window.LF.adminApprove('${escapeAttr(q.topicId)}','${escapeAttr(sum.thema || '')}')">
            Approve
          </button>
          <button class="btn btn-danger btn-sm" onclick="window.LF.adminOpenRejectModal('${escapeAttr(q.topicId)}','${escapeAttr(sum.thema || '')}')">
            Reject
          </button>
        </div>
      </div>`;
  }).join('');
}

// ── Content-Builder ───────────────────────
const BUILDER_SNIPPETS = {
  p:       '<p>Text hier schreiben.</p>',
  h3:      '<h3>Überschrift</h3>',
  // Mission 8: BUILDER_SNIPPETS sind Roh-HTML, die in die User-meta.json wandern.
  // Beim Insert-Time durch lfIcon()-Markup ersetzen, damit sie themed im Frontend
  // rendern. (Inhalt liegt dann auch als Lucide-SVG im JSON — bewusst, kein Emoji
  // mehr im Roh-Build.) Helper unten ersetzt erst beim Insert.
  info:    `<div class="lf-box lf-info">${lfIcon('info')} Hinweis hier</div>`,
  tip:     `<div class="lf-box lf-tip">${lfIcon('circle-check-big')} Tipp hier</div>`,
  warn:    `<div class="lf-box lf-warn">${lfIcon('triangle-alert')} Warnung hier</div>`,
  danger:  `<div class="lf-box lf-danger">${lfIcon('octagon-alert')} Denkfehler hier</div>`,
  formula: '<div class="lf-box lf-formula">Formel hier</div>',
  key:     '<div class="lf-key"><div class="lf-key-title">Kernaussage</div><div class="lf-key-body">Inhalt hier — nutze <span class="lf-hl">Hervorhebungen</span> für wichtige Begriffe.</div></div>',
  steps:   '<ol class="lf-steps"><li>Schritt 1</li><li>Schritt 2</li><li>Schritt 3</li></ol>',
  twocol:  '<div class="lf-two-col"><div><strong>Links</strong><p>Text links</p></div><div><strong>Rechts</strong><p>Text rechts</p></div></div>',
  def:     '<dl class="lf-def"><dt>Begriff</dt><dd>Definition des Begriffs.</dd></dl>',
  table:   '<table class="lf-table"><thead><tr><th>Spalte A</th><th>Spalte B</th></tr></thead><tbody><tr><td>Wert 1</td><td>Wert 2</td></tr></tbody></table>',
};

function renderBuilder() {
  if (!builderState) {
    builderState = { step: 1, mode: null, fach: '', klasse: '', thema: '', description: '', content: '', blocks: [], questions: [], visibility: 'private' };
  }
  const { step } = builderState;

  const steps = ['Info', 'Modus', 'Inhalt', 'Fragen', 'Export'];
  const stepBar = steps.map((s, i) => `
    <div class="builder-step ${i + 1 === step ? 'active' : i + 1 < step ? 'done' : ''}">
      <div class="builder-step-num">${i + 1 < step ? lfIcon('check', {cls:'sx-correct'}) : i + 1}</div>
      <div class="builder-step-label">${s}</div>
    </div>`).join('<div class="builder-step-connector"></div>');

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Builder' }])}
    <div class="page builder-page">
      <div class="page-header">
        <h1>Thema erstellen</h1>
        <div class="sub">Erstelle eigene Lernmaterialien und reiche sie ein.</div>
      </div>
      <div class="builder-steps">${stepBar}</div>
      <div class="builder-body" id="builderBody">
        ${renderBuilderStep(step)}
      </div>
    </div>`;
  if (step === 5) setTimeout(() => window.LF?.initBuilderExport(), 0);
}

function renderBuilderStep(step) {
  const s = builderState;
  if (step === 1) return `
    <div class="builder-card">
      <h2>Thema-Informationen</h2>
      <div class="form-group">
        <label class="form-label">Fach</label>
        <input class="form-input" id="bFach" placeholder="z.B. Geschichte" value="${escapeAttr(s.fach || '')}"
               list="bFachList">
        <datalist id="bFachList">${Object.values(structure||{}).map(s=>`<option value="${escapeAttr(s.name || '')}">`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label">Klasse</label>
        <input class="form-input" id="bKlasse" placeholder="z.B. Klasse-9" value="${escapeAttr(s.klasse || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Thema-Name</label>
        <input class="form-input" id="bThema" placeholder="z.B. Erster Weltkrieg" value="${escapeAttr(s.thema || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">Kurzbeschreibung (optional)</label>
        <input class="form-input" id="bDesc" placeholder="Was lernst du hier?" value="${escapeAttr(s.description || '')}">
      </div>
      <div class="builder-nav">
        <span></span>
        <button class="btn btn-primary" onclick="window.LF.builderNext()">Weiter: Modus wählen</button>
      </div>
    </div>`;

  if (step === 2) return `
    <div class="builder-card">
      <h2>Wie möchtest du den Inhalt erstellen?</h2>
      <p class="sub" style="margin-bottom:28px">Wähle eine Methode — du kannst später zurückgehen und wechseln.</p>
      <div class="builder-mode-grid">
        <div class="builder-mode-card" onclick="window.LF.builderChooseMode('visual')">
          <div class="mode-icon">${lfIcon('blocks', {cls:'lf-icon-2xl'})}</div>
          <h3>Visueller Builder</h3>
          <span class="mode-badge">Empfohlen</span>
          <p class="mode-desc">Bausteine per Klick hinzufügen und per Drag &amp; Drop sortieren. Kein Code nötig — so einfach wie eine Website aufbauen.</p>
          <button class="btn btn-primary" style="margin-top:20px;width:100%">Visuellen Builder wählen</button>
        </div>
        <div class="builder-mode-card" onclick="window.LF.builderChooseMode('html')">
          <div class="mode-icon">${lfIcon('code', {cls:'lf-icon-2xl'})}</div>
          <h3>HTML-Builder</h3>
          <span class="mode-badge mode-badge-gray">Fortgeschritten</span>
          <p class="mode-desc">Schreibe direkt HTML-Code mit vorgefertigten Bausteinen. Volle Kontrolle über das Layout. Für erfahrene Nutzer.</p>
          <button class="btn btn-secondary" style="margin-top:20px;width:100%">HTML-Builder wählen</button>
        </div>
      </div>
      <div class="builder-nav" style="margin-top:24px">
        <button class="btn btn-secondary" onclick="window.LF.builderPrev()">Zurück</button>
        <span></span>
      </div>
    </div>`;

  if (step === 3) {
    if (s.mode === 'visual') return `
      <div class="builder-card builder-card-wide">
        <h2>Visueller Inhalt-Builder</h2>
        <div class="vbuilder-palette">
          ${Object.entries(VISUAL_BLOCK_TYPES).map(([type, def]) =>
            `<button class="vbuilder-palette-btn" onclick="window.LF.visualAddBlock('${type}')">${def.icon} ${def.label}</button>`
          ).join('')}
        </div>
        <div class="vbuilder-canvas" id="vbuilderCanvas">
          ${renderVisualBlocks()}
        </div>
        <div class="builder-nav">
          <button class="btn btn-secondary" onclick="window.LF.builderPrev()">Zurück</button>
          <button class="btn btn-primary"   onclick="window.LF.builderNext()">Weiter: Fragen</button>
        </div>
      </div>`;

    return `
      <div class="builder-card builder-card-wide">
        <h2>Lerninhalt erstellen</h2>
        <div class="builder-snippet-bar">
          ${Object.entries({p:'Absatz',h3:'Überschrift',info:'Info-Box',tip:'Tipp-Box',warn:'Warnung',danger:'Denkfehler',formula:'Formel',key:'Kernkonzept',steps:'Schritte',twocol:'2 Spalten',def:'Definition',table:'Tabelle'})
            .map(([k,l])=>`<button class="builder-snippet-btn" onclick="window.LF.builderInsert('${k}')">${l}</button>`).join('')}
        </div>
        <div class="builder-split">
          <div class="builder-split-left">
            <label class="form-label">HTML-Inhalt</label>
            <textarea class="form-input builder-textarea" id="builderContentInput"
                      oninput="builderState.content=this.value;window.LF.builderPreview()"
                      placeholder="Klicke auf einen Baustein oben oder tippe HTML...">${s.content}</textarea>
          </div>
          <div class="builder-split-right">
            <label class="form-label">Vorschau</label>
            <div class="builder-preview content-body" id="builderPreviewDiv">${s.content || '<span style="color:var(--text-muted)">Vorschau erscheint hier…</span>'}</div>
          </div>
        </div>
        <div class="builder-nav">
          <button class="btn btn-secondary" onclick="window.LF.builderPrev()">Zurück</button>
          <button class="btn btn-primary"   onclick="window.LF.builderNext()">Weiter: Fragen</button>
        </div>
      </div>`;
  }

  if (step === 4) return `
    <div class="builder-card builder-card-wide">
      <h2>Fragen hinzufügen</h2>
      <div class="builder-qform">
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Fragentyp</label>
          <select class="form-input" id="bQType" onchange="window.LF.builderQTypeChange()" style="max-width:220px">
            <option value="multiple_choice">Multiple Choice</option>
            <option value="free_text">Freitext</option>
            <option value="vocabulary">Vokabel</option>
          </select>
        </div>
        <div id="bQFields">${renderBuilderQFields('multiple_choice')}</div>
        <button class="btn btn-secondary" onclick="window.LF.builderAddQuestion()">Frage hinzufügen</button>
      </div>
      <div class="builder-qlist" id="builderQList">
        ${renderBuilderQList()}
      </div>
      <div class="builder-nav">
        <button class="btn btn-secondary" onclick="window.LF.builderPrev()">Zurück</button>
        <button class="btn btn-primary"   onclick="window.LF.builderNext()">Weiter: Export</button>
      </div>
    </div>`;

  if (step === 5) {
    // Phase 3a (Ethan, 2026-05-08): Visibility-Picker als Single-Source-of-
    // Truth fuer den Veroeffentlichungs-Modus. builderState.visibility steuert
    // welcher Submit-Pfad beim Klick laeuft (privat / group / public). Default
    // = 'private', siehe builderState-Init oben + builderSetVisibility().
    if (!builderState.visibility) builderState.visibility = 'private';
    const v = builderState.visibility;
    return `
      <div class="builder-card">
        <h2>Fertig! Veröffentlichen</h2>
        <div class="builder-export-info">
          <div class="builder-export-row"><span class="builder-export-lbl">Fach:</span> <strong>${escapeHtml(builderState.fach)}</strong></div>
          <div class="builder-export-row"><span class="builder-export-lbl">Klasse:</span> <strong>${escapeHtml(builderState.klasse)}</strong></div>
          <div class="builder-export-row"><span class="builder-export-lbl">Thema:</span> <strong>${escapeHtml(builderState.thema)}</strong></div>
          <div class="builder-export-row"><span class="builder-export-lbl">Fragen:</span> <strong>${builderState.questions.length}</strong></div>
        </div>

        <div class="builder-publish-section">
          <h3>Sichtbarkeit</h3>
          <p class="sub">Wer soll dein Thema sehen können?</p>
          <div class="builder-vis-picker" id="builderVisPicker">
            <!-- option-buttons werden via initBuilderExport() gefuellt
                 (group-disabled-Status haengt von userData.groupIds ab,
                 das ist async-load). Static fallback hier ist 'privat':
                 picker-buttons werden bei step-mount durch JS ersetzt. -->
            <div class="spinner" style="margin:8px auto;width:20px;height:20px"></div>
          </div>

          <div class="builder-vis-action">
            <button class="btn btn-primary btn-lg" id="builderVisPublishBtn"
                    onclick="window.LF.builderPublish()">
              ${v === 'public' ? 'Für Public-Library einreichen' :
                v === 'group'  ? 'Für Gruppe veröffentlichen'    :
                                 'Privat speichern'}
            </button>
          </div>
          <div id="builderUploadMsg" style="margin-top:12px"></div>
        </div>

        <div class="builder-export-divider"><span>oder ZIP exportieren</span></div>

        <div>
          <p class="sub" style="margin-bottom:12px">Lokal als ZIP herunterladen — z.B. fuer Backup oder zum Teilen per Mail.</p>
          <button class="btn btn-secondary" onclick="window.LF.builderExport()" style="margin-top:6px">ZIP herunterladen</button>
          <div id="builderExportMsg" style="margin-top:12px"></div>
        </div>

        <div class="builder-nav" style="margin-top:24px">
          <button class="btn btn-secondary" onclick="window.LF.builderPrev()">Zurück</button>
          <span></span>
        </div>
      </div>`;
  }
}

// Phase 3a (Ethan, 2026-05-08): Visibility-Picker-Markup als separater
// Builder, damit initBuilderExport() es nach group-Load reinrendern kann
// (group-disabled-state braucht userData.groupIds — async). builderSetVisibility
// im handler-Block ruft das hier nach jedem Click neu, damit die active-class
// + Button-Label updated.
function renderBuilderVisPicker() {
  const v = builderState?.visibility || 'private';
  const hasGroup = (userData?.groupIds?.length || 0) > 0;
  const opt = (id, icon, label, sub, disabled = false, hint = '') => `
    <button class="builder-vis-opt ${v === id ? 'active' : ''} ${disabled ? 'disabled' : ''}"
            ${disabled ? 'disabled aria-disabled="true"' : `onclick="window.LF.builderSetVisibility('${id}')"`}>
      <div class="builder-vis-opt-icon">${lfIcon(icon)}</div>
      <div class="builder-vis-opt-body">
        <div class="builder-vis-opt-label">${label}</div>
        <div class="builder-vis-opt-sub">${sub}</div>
        ${disabled && hint ? `<div class="builder-vis-opt-hint">${hint}</div>` : ''}
      </div>
    </button>`;
  return `
    ${opt('private', 'lock', 'Privat (nur ich)', 'Nur du siehst das Thema in „Meine Inhalte&ldquo;.')}
    ${opt('group',   'users-round', 'Meine Gruppe', 'Alle Mitglieder deiner Gruppe können es sehen und üben.',
          !hasGroup, 'Erst einer Gruppe beitreten oder eine erstellen.')}
    ${opt('public',  'globe', 'Public-Library', 'Einreichen — Simon prüft und schaltet es für alle frei.')}
  `;
}

function renderBuilderQFields(type) {
  if (type === 'multiple_choice') return `
    <div class="form-group"><label class="form-label">Frage</label>
      <input class="form-input" id="bQQuestion" placeholder="Fragetext?"></div>
    <div class="builder-mc-options">
      ${[0,1,2,3].map(i=>`
        <div class="builder-mc-row">
          <input type="radio" name="bCorrect" value="${i}" id="bCorrect${i}" ${i===0?'checked':''}>
          <label for="bCorrect${i}">Option ${String.fromCharCode(65+i)}</label>
          <input class="form-input" id="bOpt${i}" placeholder="Option ${String.fromCharCode(65+i)}">
        </div>`).join('')}
    </div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:120px"><label class="form-label">Schwierigkeit</label>
        <select class="form-input" id="bQDiff"><option value="easy">Leicht</option><option value="medium" selected>Mittel</option><option value="hard">Schwer</option></select></div>
      <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">Punkte</label>
        <input class="form-input" id="bQPoints" type="number" value="2" min="1" max="10"></div>
    </div>`;

  if (type === 'free_text') return `
    <div class="form-group"><label class="form-label">Frage</label>
      <input class="form-input" id="bQQuestion" placeholder="Erkläre..."></div>
    <div class="form-group"><label class="form-label">Musterantwort (für KI-Auswertung)</label>
      <textarea class="form-input" id="bQSample" rows="2" placeholder="Vollständige Musterantwort"></textarea></div>
    <div class="form-group"><label class="form-label">Schlüsselwörter (kommagetrennt, Fallback)</label>
      <input class="form-input" id="bQKeywords" placeholder="Begriff1, Begriff2, Begriff3"></div>
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="form-group" style="flex:1;min-width:120px"><label class="form-label">Schwierigkeit</label>
        <select class="form-input" id="bQDiff"><option value="easy">Leicht</option><option value="medium" selected>Mittel</option><option value="hard">Schwer</option></select></div>
      <div class="form-group" style="flex:1;min-width:100px"><label class="form-label">Max. Punkte</label>
        <input class="form-input" id="bQPoints" type="number" value="4" min="1" max="20"></div>
    </div>`;

  if (type === 'vocabulary') return `
    <div class="form-group"><label class="form-label">Wort / Ausdruck</label>
      <input class="form-input" id="bQWord" placeholder="z.B. der Hund"></div>
    <div class="form-group"><label class="form-label">Akzeptierte Antworten (kommagetrennt)</label>
      <input class="form-input" id="bQAnswers" placeholder="dog, the dog"></div>
    <div class="form-group"><label class="form-label">Richtung (optional)</label>
      <input class="form-input" id="bQDirection" placeholder="DE → EN"></div>
    <div class="form-group"><label class="form-label">Tipp (optional)</label>
      <input class="form-input" id="bQHint" placeholder="Tier, bellt"></div>`;
}

// ── Visual Builder ─────────────────────────
const VISUAL_BLOCK_TYPES = {
  heading:    { icon: 'H2',                          label: 'Überschrift',  make: () => ({ text: 'Neue Überschrift' }) },
  paragraph:  { icon: '¶',                           label: 'Absatz',        make: () => ({ text: '' }) },
  infobox:    { icon: lfIcon('lightbulb'),           label: 'Info-Box',       make: () => ({ variant: 'info', text: 'Hinweis hier eintragen' }) },
  keypoint:   { icon: lfIcon('star'),                label: 'Kernaussage',   make: () => ({ title: 'Kernaussage', text: 'Inhalt hier' }) },
  list:       { icon: '≡',                           label: 'Liste',          make: () => ({ ordered: false, items: ['Punkt 1', 'Punkt 2', 'Punkt 3'] }) },
  definition: { icon: lfIcon('book-open'),           label: 'Definition',    make: () => ({ term: 'Begriff', text: 'Die Definition des Begriffs.' }) },
  divider:    { icon: '—',                           label: 'Trennlinie',    make: () => ({}) },
};

function vEsc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function collectVisualBlocks() {
  builderState.blocks = builderState.blocks.map((block, i) => {
    const d = { ...block.data };
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        d.text = document.getElementById(`vb_${i}_text`)?.value ?? d.text;
        break;
      case 'infobox':
        d.variant = document.getElementById(`vb_${i}_variant`)?.value ?? d.variant;
        d.text    = document.getElementById(`vb_${i}_text`)?.value    ?? d.text;
        break;
      case 'keypoint':
        d.title = document.getElementById(`vb_${i}_title`)?.value ?? d.title;
        d.text  = document.getElementById(`vb_${i}_text`)?.value  ?? d.text;
        break;
      case 'list': {
        const raw = document.getElementById(`vb_${i}_items`)?.value ?? '';
        d.items   = raw.split('\n').filter(s => s.trim());
        d.ordered = document.getElementById(`vb_${i}_ordered`)?.checked ?? d.ordered;
        break;
      }
      case 'definition':
        d.term = document.getElementById(`vb_${i}_term`)?.value ?? d.term;
        d.text = document.getElementById(`vb_${i}_text`)?.value ?? d.text;
        break;
    }
    return { ...block, data: d };
  });
}

function serializeVisualBlocks() {
  return builderState.blocks.map(block => {
    const d = block.data;
    switch (block.type) {
      case 'heading':   return `<h3>${vEsc(d.text)}</h3>`;
      case 'paragraph': return `<p>${vEsc(d.text).replace(/\n/g,'<br>')}</p>`;
      case 'infobox': {
        // Mission 8: Lucide-Icons in den serialized HTML — bewusst, damit
        // exportierte meta.json themed rendert (im Frontend laeuft sie durch innerHTML).
        const icons = {
          info:    `${lfIcon('lightbulb')} `,
          tip:     `${lfIcon('circle-check-big')} `,
          warn:    `${lfIcon('triangle-alert')} `,
          danger:  `${lfIcon('octagon-alert')} `,
          formula: ''
        };
        return `<div class="lf-box lf-${d.variant}">${icons[d.variant]||''}${vEsc(d.text)}</div>`;
      }
      case 'keypoint':
        return `<div class="lf-key"><div class="lf-key-title">${vEsc(d.title)}</div><div class="lf-key-body">${vEsc(d.text)}</div></div>`;
      case 'list': {
        const tag   = d.ordered ? 'ol' : 'ul';
        const items = (d.items||[]).map(item => `<li>${vEsc(item)}</li>`).join('');
        return `<${tag} class="lf-steps">${items}</${tag}>`;
      }
      case 'definition':
        return `<dl class="lf-def"><dt>${vEsc(d.term)}</dt><dd>${vEsc(d.text)}</dd></dl>`;
      case 'divider':   return '<hr>';
      default:          return '';
    }
  }).join('\n');
}

function renderVisualBlock(block, i) {
  const handle = `<div class="vblock-handle" draggable="true"
    ondragstart="window.LF.visualDragStart(event,${i})"
    ondragend="window.LF.visualDragEnd()">⠿</div>`;
  const del = `<button class="vblock-delete" onclick="window.LF.visualDeleteBlock(${i})" title="Entfernen">${lfIcon('trash-2')}</button>`;
  const d = block.data;
  let body = '';
  switch (block.type) {
    case 'heading':
      body = `<div class="vblock-type-label">Überschrift</div>
        <input class="form-input" id="vb_${i}_text" value="${vEsc(d.text)}" placeholder="Überschrift...">`;
      break;
    case 'paragraph':
      body = `<div class="vblock-type-label">Absatz</div>
        <textarea class="form-input vb-ta" id="vb_${i}_text" rows="3" placeholder="Text...">${vEsc(d.text)}</textarea>`;
      break;
    case 'infobox': {
      // <option>-Inhalte sind plaintext (kein SVG-Render) — daher Wortlabels statt Icons.
      const variants = { info:'Hinweis', tip:'Tipp', warn:'Warnung', danger:'Fehler', formula:'Formel' };
      body = `<div class="vblock-type-label">Info-Box</div>
        <div class="vb-row">
          <select class="form-input" id="vb_${i}_variant" style="max-width:140px">
            ${Object.entries(variants).map(([v,l]) =>
              `<option value="${v}"${d.variant===v?' selected':''}>${l}</option>`).join('')}
          </select>
          <input class="form-input" id="vb_${i}_text" value="${vEsc(d.text)}" placeholder="Text...">
        </div>`;
      break;
    }
    case 'keypoint':
      body = `<div class="vblock-type-label">Kernaussage</div>
        <input class="form-input" id="vb_${i}_title" value="${vEsc(d.title)}" placeholder="Titel..." style="margin-bottom:6px">
        <textarea class="form-input vb-ta" id="vb_${i}_text" rows="2" placeholder="Inhalt...">${vEsc(d.text)}</textarea>`;
      break;
    case 'list':
      body = `<div class="vblock-type-label">Liste</div>
        <label style="font-size:13px;display:flex;align-items:center;gap:6px;margin-bottom:6px">
          <input type="checkbox" id="vb_${i}_ordered"${d.ordered?' checked':''}> Nummeriert
        </label>
        <textarea class="form-input vb-ta" id="vb_${i}_items" rows="4"
          placeholder="Punkt 1&#10;Punkt 2&#10;...">${(d.items||[]).map(vEsc).join('\n')}</textarea>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Ein Eintrag pro Zeile</div>`;
      break;
    case 'definition':
      body = `<div class="vblock-type-label">Definition</div>
        <input class="form-input" id="vb_${i}_term" value="${vEsc(d.term)}" placeholder="Begriff..." style="margin-bottom:6px">
        <textarea class="form-input vb-ta" id="vb_${i}_text" rows="2" placeholder="Definition...">${vEsc(d.text)}</textarea>`;
      break;
    case 'divider':
      body = `<div class="vblock-type-label">Trennlinie</div>
        <hr style="border:none;border-top:2px solid var(--border);margin:4px 0">`;
      break;
  }
  return `
    <div class="vblock" data-idx="${i}"
      ondragover="window.LF.visualDragOver(event,${i})"
      ondragleave="window.LF.visualDragLeave(event)"
      ondrop="window.LF.visualDrop(event,${i})">
      ${handle}
      <div class="vblock-body">${body}</div>
      ${del}
    </div>`;
}

function renderVisualBlocks() {
  if (!builderState.blocks.length) {
    return `<div class="vblock-empty">Noch keine Bausteine. Klicke oben auf einen Baustein-Typ, um zu beginnen.</div>`;
  }
  return builderState.blocks.map((b, i) => renderVisualBlock(b, i)).join('');
}

function renderVisualCanvas() {
  const canvas = document.getElementById('vbuilderCanvas');
  if (canvas) canvas.innerHTML = renderVisualBlocks();
}

function renderBuilderQList() {
  if (!builderState.questions.length) return '<div class="empty-state" style="padding:16px;font-size:14px">Noch keine Fragen hinzugefügt.</div>';
  return builderState.questions.map((q, i) => {
    const label = q.type === 'multiple_choice' ? `MC: ${escapeHtml(q.question || '')}`
                : q.type === 'free_text'       ? `Freitext: ${escapeHtml(q.question || '')}`
                : `Vokabel: ${escapeHtml(q.word || '')} → ${(q.answers || []).map(a => escapeHtml(a || '')).join(', ')}`;
    return `
      <div class="builder-q-item">
        <span class="builder-q-num">${i+1}</span>
        <span class="builder-q-label">${label}</span>
        <button class="btn btn-ghost btn-sm" onclick="window.LF.builderDeleteQ(${i})">Entfernen</button>
      </div>`;
  }).join('');
}

// ── Üben-Ablauf ───────────────────────────
let uebenState = null;

function renderUebenQuestion() {
  const { questions, current } = uebenState;
  const q   = questions[current];
  const pct = Math.round((current / questions.length) * 100);

  const answerHtml = q.type === 'multiple_choice'
    ? `<div class="ueben-mc-options">
        ${q.shuffledOptions.map((opt, i) => `
          <button class="ueben-mc-option" onclick="window.LF.checkUebenMC(${i})">${escapeHtml(opt || '')}</button>
        `).join('')}
       </div>`
    : `<textarea class="form-input form-textarea" id="uebenTextarea" placeholder="Deine Antwort..."></textarea>
       <button class="btn btn-secondary" id="uebenCheckBtn" onclick="window.LF.checkUebenText()" style="margin-top:10px">
         Antwort prüfen
       </button>`;

  document.getElementById('uebenArea').innerHTML = `
    <div class="ueben-active">
      <div class="ueben-header">
        <span class="ueben-progress-txt">Aufgabe ${current+1} von ${questions.length}</span>
        <div class="progress-bar" style="width:200px"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="question-card">
        <div class="question-num">${q.type === 'multiple_choice' ? 'Multiple Choice' : 'Freitext'}</div>
        <div class="question-text">${escapeHtml(q.question || '')}</div>
        ${answerHtml}
      </div>
      <div id="uebenFeedback"></div>
      <button class="btn btn-primary" id="uebenNext" style="display:none;margin-top:12px" onclick="window.LF.nextUeben()">
        Nächste Aufgabe
      </button>
    </div>`;
}

// ── Tab-Wechsel-Erkennung ─────────────────
// State + Listener leben jetzt in _tabSwitch (Closure am Datei-Anfang).
// Diese Helpers bleiben fuer call-site-Lesbarkeit — koennen direkt _tabSwitch
// nutzen, aber kein State leakt mehr nach aussen.
function setupTabSwitchDetection() { _tabSwitch.setup(); }

// ── Test-Ablauf ───────────────────────────
let selectedTime = 15;

// ── Hilfe-Seite ───────────────────────────
function renderHelp() {
  const S = (icon, title, body) => `
    <div class="help-section">
      <div class="help-section-head">
        <span class="help-section-icon">${icon}</span>
        <h2 class="help-section-title">${title}</h2>
      </div>
      <div class="help-section-body">${body}</div>
    </div>`;

  const row = (term, desc) =>
    `<div class="help-row"><div class="help-term">${term}</div><div class="help-desc">${desc}</div></div>`;

  const kbRow = (keys, desc) =>
    `<div class="help-row"><div class="help-term"><span class="help-key">${keys}</span></div><div class="help-desc">${desc}</div></div>`;

  const gradeRow = (note, pts, label, color) =>
    `<div class="help-row"><div class="help-term"><span class="grade-badge" style="background:${color}">${note}</span></div><div class="help-desc">${pts}% · ${label}</div></div>`;

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Hilfe' }])}
    <div class="page help-page">
      <div class="page-header">
        <h1>Hilfe &amp; Dokumentation</h1>
        <div class="sub">Vollständige Übersicht aller Funktionen von LearningForge</div>
      </div>

      <div class="help-section" style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
        <h2 class="help-section-title" style="margin-bottom:8px">${lfIcon('rocket')} Erste Schritte (nochmal)</h2>
        <p style="color:var(--text-muted);margin-bottom:12px">Setup oder Feature-Tour erneut durchgehen.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" onclick="window.LF.openOnboarding(1)">Setup-Wizard nochmal</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.startTour()">App-Tour nochmal</button>
        </div>
      </div>

      <div class="help-toc">
        <div class="help-toc-title">Inhalt</div>
        ${[
          ['dashboard','Dashboard'],['faecher','Fächer &amp; Themen'],['tests','Tests'],
          ['karten','Karteikarten'],['srs','SRS — Spaced Repetition'],
          ['wissenscheck','Wissens-Check'],['pomodoro','Pomodoro-Timer'],
          ['notizen','Notizen'],['lesezeichen','Lesezeichen'],
          ['daily','Daily Challenge'],['statistiken','Statistiken'],
          ['rangliste','Rangliste'],['profil','Profil &amp; XP'],
          ['achievements','Achievements'],['streak','Streak-Kalender'],
          ['gruppen','Gruppen'],['builder','Builder'],['meine-inhalte','Meine Inhalte'],
          ['einstellungen','Einstellungen'],['tools','Werkzeuge (Rechner &amp; Tafelwerk)'],
          ['offline','Offline &amp; PWA'],['shortcuts','Tastenkürzel'],
        ].map(([id, label]) => `<a class="help-toc-item" href="#help-${id}">${label}</a>`).join('')}
      </div>

      ${S(lfIcon('house'), '<span id="help-dashboard">Dashboard</span>', `
        ${row('Fach-Karten', 'Zeigen Fortschritt (% getestete Themen), Anzahl Klassen und Durchschnittsnote. Klick öffnet das Fach.')}
        ${row('Statistik-Bar', 'Schnellübersicht: Fächeranzahl, absolvierte Tests, Durchschnittsnote, SRS-fällige Karten.')}
        ${row('Daily-Challenge-Karte', 'Zeigt ob die heutige Challenge erledigt ist. Klick führt zur Challenge-Seite.')}
        ${row('Braucht Aufmerksamkeit', 'Themen mit Note 4 oder schlechter — priorisiert zum Wiederholen.')}
        ${row('Letzte Tests', 'Die 5 zuletzt absolvierten Tests mit Note und Punktzahl.')}
        ${row('Streak-Badge', 'Erscheint oben rechts wenn du mindestens 2 Tage in Folge gelernt hast.')}
        ${row('App installieren', 'Erscheint einmalig wenn der Browser eine PWA-Installation anbietet.')}
      `)}

      ${S(lfIcon('book-open'), '<span id="help-faecher">Fächer &amp; Themen</span>', `
        ${row('Fach', 'Oberste Ebene. Jedes Fach hat eine Farbe, ein Icon und beliebig viele Klassen.')}
        ${row('Klasse / Jahr', 'Mittlere Ebene (z.B. Klasse 9, Klasse 10). Zeigt alle Themen dieser Klasse.')}
        ${row('Thema', 'Kleinste Einheit mit Lerninhalt, Test, Karteikarten und Wissens-Check.')}
        ${row('Fortschrittsring', 'SVG-Ring auf der Fach-Karte: ausgefüllter Anteil = % getestete Themen.')}
        ${row('Themen-Seite — Tabs', '"Lernen" zeigt den Inhalt mit Wissens-Check. "Test" startet einen echten Test. "Karten" startet eine Karteikarten-Session.')}
        ${row('Voraussetzungen', 'Gelbes Banner wenn ein Thema Vorgänger-Themen empfiehlt. Tags sind klickbar.')}
        ${row('Lesezeichen-Button', 'Kleines Bookmark-Symbol auf jeder Themenkarte — speichert das Thema in Lesezeichen.')}
      `)}

      ${S(lfIcon('pencil'), '<span id="help-tests">Tests</span>', `
        <div class="help-sub-title">Testzeiten &amp; Schwierigkeit</div>
        ${row('5 Min', 'Nur Vokabeln (type: vocabulary). Nicht für MC / Freitext.')}
        ${row('10 Min', 'Fragen mit difficulty: easy.')}
        ${row('15 Min', 'Fragen mit easy.')}
        ${row('30 Min', 'Fragen mit easy + medium.')}
        ${row('90 Min', 'Alle Schwierigkeiten inkl. hard. Gemini wertet Freitext-Antworten ausführlicher.')}
        <div class="help-sub-title" style="margin-top:16px">Bewertung</div>
        ${gradeRow(1,'≥ 87','Sehr gut','#10b981')}
        ${gradeRow(2,'≥ 73','Gut','#22d3ee')}
        ${gradeRow(3,'≥ 60','Befriedigend','#f59e0b')}
        ${gradeRow(4,'≥ 45','Ausreichend','#f97316')}
        ${gradeRow(5,'≥ 20','Mangelhaft','#ef4444')}
        ${gradeRow(6,'< 20','Ungenügend','#7f1d1d')}
        <div class="help-sub-title" style="margin-top:16px">Ablauf</div>
        ${row('Punkte', 'MC-Fragen: 2 Punkte. Freitext: bis zu 4 Punkte (KI-Auswertung via Gemini, Fallback: Keyword-Matching).')}
        ${row('Tab-Wechsel', 'Wird erkannt — sofort Note 6 und Leaderboard-Eintrag. Nicht aus dem Test-Tab wechseln!')}
        ${row('Beste Note zählt', 'Beim mehrfachen Wiederholen zählt immer die beste Prozentzahl. Alle Versuche erscheinen in den Statistiken.')}
        ${row('Wiederholung', 'Nach dem Test können alle falsch beantworteten Fragen direkt geübt werden.')}
        ${row('PDF-Download', '"Testbogen herunterladen" öffnet einen druckbaren A4-Bogen mit Feldern für Name, Datum und Klasse.')}
        ${row('Kopieren für KI', '"In Zwischenablage" erzeugt formatierten Text zum Einfügen in ChatGPT / Gemini für detaillierteres Feedback.')}
      `)}

      ${S(lfIcon('layers'), '<span id="help-karten">Karteikarten</span>', `
        ${row('Starten', 'Tab "Karten" auf der Themen-Seite → "Session starten".')}
        ${row('Flip', 'Karte anklicken oder "Antwort zeigen" um die Karte umzudrehen (3D-Animation).')}
        ${row('Gewusst / Nicht gewusst', 'Zwei Buttons nach dem Flip. Ergebnis wird am Ende als Score angezeigt.')}
        ${row('Fortschrittsbalken', 'Zeigt wie viele Karten bereits bewertet wurden.')}
        ${row('Abschluss', 'Nach der letzten Karte erscheinen "Gewusst" und "Nicht gewusst" als Zahlen.')}
      `)}

      ${S(lfIcon('repeat'), '<span id="help-srs">SRS — Spaced Repetition</span>', `
        ${row('Algorithmus', 'SM-2: berechnet aus Bewertung (0–5) wann eine Karte das nächste Mal erscheint.')}
        ${row('Fällige Karten', 'Orange Chip im Dashboard zeigt Anzahl heute fälliger Karten.')}
        ${row('Bewertungen', '0 = vergessen · 1 = fast vergessen · 2 = schwer · 3 = gut · 4 = leicht · 5 = sofort')}
        ${row('Route', '#/srs öffnet die SRS-Review-Session.')}
        ${row('Speicherung', 'Alle SRS-Daten liegen in users/{uid}.srs — keine extra Collection.')}
        ${row('XP', 'Jede bewertete Karte gibt 3 XP.')}
      `)}

      ${S(lfIcon('circle-check-big'), '<span id="help-wissenscheck">Wissens-Check</span>', `
        ${row('Position', 'Unterhalb des Lerninhalts im Tab "Lernen".')}
        ${row('Multiple Choice', 'Klick auf eine Option — sofortiges farbiges Feedback (grün / rot).')}
        ${row('Freitext', 'Eingabe + Enter oder "Prüfen" — Keyword-basiert ausgewertet.')}
        ${row('Antwort anzeigen', 'Button unterhalb der Freitext-Frage zeigt Musterantwort ohne Bewertung.')}
        ${row('Kein Einfluss', 'Wissens-Check zählt nicht als Test und beeinflusst keine Note.')}
      `)}

      ${S(lfIcon('timer'), '<span id="help-pomodoro">Pomodoro-Timer</span>', `
        ${row('Widget', 'Floating Button unten rechts auf allen Themen-Seiten (lila Kreis).')}
        ${row('Arbeitsmodus', 'Standard 25 Minuten. Konfigurierbar über die Eingabefelder im Widget.')}
        ${row('Pause', 'Standard 5 Minuten. Nach jeder Arbeitsphase folgt automatisch Pause.')}
        ${row('Lernzeit', 'Am Ende jeder Arbeitsphase werden die Minuten in Firestore gespeichert (für Streak-Kalender und Statistiken).')}
        ${row('Start / Stop', 'Button im aufgeklappten Panel. Timer läuft im Hintergrund weiter wenn du navigierst.')}
        ${row('Reset', 'Setzt den Timer zurück ohne Lernzeit zu speichern.')}
      `)}

      ${S(lfIcon('pencil'), '<span id="help-notizen">Notizen</span>', `
        ${row('Position', 'Ausklappbares Panel am Ende jeder Themen-Seite.')}
        ${row('Autosave', 'Wird 1 Sekunde nach dem letzten Tastendruck automatisch gespeichert.')}
        ${row('Speicherung', 'users/{uid}.notes.{subjectId}__{yearId}__{topicId}')}
        ${row('Geräteübergreifend', 'Notes sind in Firestore gespeichert — auf allen Geräten verfügbar.')}
      `)}

      ${S(lfIcon('bookmark'), '<span id="help-lesezeichen">Lesezeichen</span>', `
        ${row('Hinzufügen', 'Bookmark-Symbol auf einer Themenkarte oder Bookmark-Button auf der Themen-Seite.')}
        ${row('Seite', '#/lesezeichen zeigt alle gespeicherten Themen.')}
        ${row('Entfernen', 'Nochmals auf das Bookmark-Symbol klicken.')}
        ${row('Speicherung', 'users/{uid}.bookmarks als Array von Topic-Keys.')}
      `)}

      ${S(lfIcon('calendar'), '<span id="help-daily">Daily Challenge</span>', `
        ${row('Ablauf', '6 Multiple-Choice-Fragen aus zufällig gewählten Themen, 5 Minuten Zeit.')}
        ${row('Seed', 'Die Fragen-Auswahl basiert auf dem aktuellen Datum — alle Nutzer sehen heute dieselben Fragen.')}
        ${row('Rangliste', 'Nach Abgabe erscheint eine Tages-Rangliste aller Teilnehmer (nach Note sortiert).')}
        ${row('XP', 'Note 1 = +80 XP · Note 2 = +50 XP · Note 3–6 = +30 XP · plus mögliche Achievements.')}
        ${row('Einmal täglich', 'Pro Kalender-Tag kann die Challenge einmal absolviert werden. Die Karte im Dashboard zeigt den Status.')}
        ${row('Route', '#/daily-challenge')}
      `)}

      ${S(lfIcon('chart-bar'), '<span id="help-statistiken">Statistiken</span>', `
        ${row('Lernzeit', 'Balkendiagramm der täglichen Lernminuten der letzten Tage (Pomodoro-Daten).')}
        ${row('Schwache Fragen', 'Fragen die du am häufigsten falsch beantwortest — mit Häufigkeitszähler.')}
        ${row('Alle Tests', 'Vollständige Liste aller Tests mit Datum, Punkte und Note.')}
        ${row('Nach Fach', 'Durchschnittsnote und Testanzahl pro Fach.')}
        ${row('Route', '#/statistiken')}
      `)}

      ${S(lfIcon('trophy'), '<span id="help-rangliste">Rangliste</span>', `
        ${row('Testpunkte-Tab', 'Gesamt-Rangliste der Testpunkte (Summe aller besten Runs). Plus Karten nach Fach.')}
        ${row('XP-Tab', 'Rangliste nach Gesamt-XP mit Level und Titel. Nur Nutzer mit XP > 0 erscheinen.')}
        ${row('Fach-Karten', 'Zeigen die Top-5 pro Fach.')}
        ${row('Du-Markierung', 'Dein Eintrag ist farblich hervorgehoben.')}
        ${row('Firestore-Regeln', 'Die leaderboard-Collection benötigt eigene Lese-/Schreibregeln (siehe CLAUDE.md).')}
        ${row('Route', '#/rangliste')}
      `)}

      ${S(lfIcon('user'), '<span id="help-profil">Profil &amp; XP</span>', `
        ${row('Noten-Übersicht', 'Durchschnittsnote pro Fach mit Farb-Coding.')}
        ${row('XP-Karte', 'Aktuelles Level, Titel, XP-Fortschrittsbalken und Gesamt-XP.')}
        ${row('Level-Formel', 'XP für Level n = (n−1)·100 + 25·(n−1)·(n−2). Level 50 = Legende (max).')}
        <div class="help-sub-title" style="margin-top:12px">XP-Quellen</div>
        ${row('Test', 'Note 1 → 100 XP, Note 2 → 82, Note 3 → 64, Note 4 → 46, Note 5 → 28, Note 6 → 10')}
        ${row('SRS-Review', '3 XP pro bewerteter Karte')}
        ${row('Builder-Upload', '50 XP pro hochgeladenem Thema')}
        ${row('Achievement', 'Bonus-XP je nach Achievement (30–500 XP)')}
        ${row('Daily Challenge', 'Note 1 → 80, Note ≤2 → 50, sonst → 30 XP')}
        ${row('Route', '#/profil')}
      `)}

      ${S(lfIcon('medal'), '<span id="help-achievements">Achievements (F-24)</span>', `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px;margin-top:8px">
          ${ACHIEVEMENTS.map(a => `
            <div style="display:flex;align-items:center;gap:10px;background:var(--bg-input);border-radius:8px;padding:8px 10px">
              <div style="width:34px;height:34px;border-radius:8px;background:${a.color};display:flex;align-items:center;justify-content:center;font-size:18px;color:#fff;flex-shrink:0">${a.iconName ? lfIcon(a.iconName) : escapeHtml(a.code)}</div>
              <div>
                <div style="font-size:13px;font-weight:700">${a.title}</div>
                <div style="font-size:11px;color:var(--text-muted)">${a.desc} · +${a.xp} XP</div>
              </div>
            </div>`).join('')}
        </div>
      `)}

      ${S(lfIcon('flame', {cls:'sx-streak'}), '<span id="help-streak">Streak-Kalender (F-27)</span>', `
        ${row('Darstellung', 'GitHub-Contribution-Graph-Stil: 53 Wochen × 7 Tage. Farbe = Lernintensität.')}
        ${row('Intensitäts-Level', '0 = kein Lerntag · 1 = &lt;15 Min · 2 = 15–30 Min · 3 = 30–60 Min · 4 = &gt;60 Min')}
        ${row('Streak-Quellen', 'Pomodoro-Lernzeit + Testabschlüsse (jeweils Datum aus Firestore).')}
        ${row('Aktueller Streak', 'Aufeinander folgende Tage mit mindestens einem Lernereignis.')}
        ${row('Längster Streak', 'Höchste je erreichte aufeinander folgende Sequenz.')}
        ${row('Streak-Freeze', 'Ab 14 Tagen Streak steht 1 Freeze pro 7 Streaktage zur Verfügung. Wird verwendet um einen verpassten gestrigen Tag als Lerntag einzutragen.')}
        ${row('Freeze-Anzeige', 'Banner erscheint automatisch wenn gestern fehlt und ein Freeze verfügbar ist.')}
      `)}

      ${S(lfIcon('users'), '<span id="help-gruppen">Gruppen</span>', `
        ${row('Gruppe erstellen', 'Profilseite oder #/gruppen — Name eingeben, 6-stelliger Code wird generiert.')}
        ${row('Beitreten', '6-stelligen Code eines anderen Nutzers eingeben.')}
        ${row('Mitglieder', 'Admin (Ersteller) kann Mitglieder rauswerfen. Admin verlässt → Gruppe wird gelöscht.')}
        ${row('Gruppen-Inhalte', 'Im Builder kannst du Themen für eine Gruppe hochladen. Alle Gruppenmitglieder sehen sie unter Meine Inhalte.')}
        ${row('Route', '#/gruppen · #/gruppen/{groupId}')}
      `)}

      ${S(lfIcon('hammer'), '<span id="help-builder">Builder</span>', `
        ${row('Zweck', 'Eigene Lernthemen mit Inhalt und Fragen erstellen.')}
        ${row('Schritt 1', 'Modus wählen: Visuell (Drag &amp; Drop Blöcke) oder Roh (direktes HTML/JSON).')}
        ${row('Schritt 2', 'Fach, Klasse, Thema und Beschreibung eintragen.')}
        ${row('Schritt 3', 'Lerninhalt erstellen. Visuell: Blöcke (Text, Formel, Bild, Tabelle, Schritt, Callout). Roh: freier HTML-String.')}
        ${row('Schritt 4', 'Fragen hinzufügen (MC oder Freitext) und hochladen — entweder persönlich oder für eine Gruppe.')}
        ${row('ZIP-Export', 'Exportiert alles als ZIP mit meta.json und questions.json — bereit für GitHub-Upload.')}
        ${row('Route', '#/builder')}
      `)}

      ${S(lfIcon('library'), '<span id="help-meine-inhalte">Meine Inhalte</span>', `
        ${row('Persönliche Themen', 'Alle eigenen, nicht-Gruppen-Inhalte.')}
        ${row('Gruppen-Themen', 'Pro Gruppe ein Abschnitt mit allen Themen dieser Gruppe.')}
        ${row('Löschen', 'Nur Eigentümer können ein Thema löschen.')}
        ${row('Lernen / Testen', 'Jedes Custom-Thema hat eigene Lernen- und Test-Tabs (analog zu regulären Themen).')}
        ${row('Route', '#/meine-inhalte · #/meine-inhalte/{topicId}')}
      `)}

      ${S(lfIcon('settings'), '<span id="help-einstellungen">Einstellungen</span>', `
        ${row('Fächerfarben', 'Pro Fach ein Farbwähler. "Standard" setzt auf die Farbe aus subjects-config.json zurück.')}
        ${row('Theme', 'Hell / Dunkel — wird in Cookie lf_theme gespeichert. Kein Flackern beim Laden.')}
        ${row('Fach-Icons', 'PNG-Upload (64×64 px) als individuelles Icon. Wird als Base64 in Firestore gespeichert.')}
        ${row('Route', '#/einstellungen')}
      `)}

      ${S(lfIcon('calculator'), '<span id="help-tools">Werkzeuge</span>', `
        <div class="help-sub-title">Taschenrechner (Mathematik)</div>
        ${row('Erscheint', 'Automatisch auf allen Mathematik-Themen-Seiten (unten rechts, lila Widget).')}
        ${row('Operatoren', '+  −  ×  ÷  ^  sqrt()  π  Klammern  Dezimalzahlen')}
        ${row('Kein Gleichungslöser', 'Nur numerische Berechnung. Gleichungssysteme nicht unterstützt.')}
        <div class="help-sub-title" style="margin-top:16px">Tafelwerk (Chemie / Physik)</div>
        ${row('Erscheint', 'Auf Chemie- und Physik-Themen-Seiten (unten links, teal Widget).')}
        ${row('Tabs', 'Konstanten · Einheiten · Formeln · Periodensystem')}
        ${row('Suche', 'Echtzeit-Filter über alle Einträge des aktuellen Tabs.')}
      `)}

      ${S(lfIcon('wifi-off'), '<span id="help-offline">Offline &amp; PWA</span>', `
        ${row('Service Worker', 'Cacht die App-Shell (HTML, CSS, JS) mit Cache-First-Strategie.')}
        ${row('GitHub-Inhalte', 'Network-First: zuerst aktuell von GitHub laden, bei Offline aus Cache liefern.')}
        ${row('Firestore Offline', 'Firestore-Persistence aktiviert — Noten und Nutzerdata auch offline lesbar.')}
        ${row('Offline-Banner', 'Roter Banner erscheint unten wenn kein Netz — verschwindet automatisch bei Reconnect.')}
        ${row('Installieren', 'Unterstützende Browser bieten einen "Installieren"-Banner an. Auch über Browser-Menü → "Zum Startbildschirm".')}
        ${row('Android-App', 'APK via GitHub Releases herunterladen. TWA (Trusted Web Activity) — zeigt dieselbe Web-App nativ.')}
      `)}

      ${S(lfIcon('keyboard'), '<span id="help-shortcuts">Tastenkürzel</span>', `
        ${kbRow('?', 'Tastenkürzel-Dialog anzeigen')}
        ${kbRow('Alt + H', 'Dashboard öffnen')}
        ${kbRow('Alt + S', 'Statistiken öffnen')}
        ${kbRow('Alt + P', 'Profil öffnen')}
        ${kbRow('Alt + E', 'Einstellungen öffnen')}
        ${kbRow('Escape', 'Dialoge / Overlays schließen')}
        ${kbRow('Enter', 'Login-Formular absenden')}
      `)}

    </div>`;
}

// ══════════════════════════════════════════
//  Phase 3 — Gamification 3.0 Helpers
// ══════════════════════════════════════════

// ── F-24/25: XP + Achievement-Grant ────────
async function grantXPAndAchievements(ctx = {}) {
  if (!currentUser || !userData) return;
  const uid     = currentUser.uid;
  const already = new Set(userData.achievements || []);
  const newOnes = ACHIEVEMENTS.filter(a => !already.has(a.id) && a.check(userData, ctx));

  let xpGained = ctx.xp || 0;
  newOnes.forEach(a => { xpGained += a.xp; });

  const prevLevel = calcLevel(userData.xp || 0).level;
  userData.xp = (userData.xp || 0) + xpGained;
  userData.achievements = [...already, ...newOnes.map(a => a.id)];

  // Wave-5b MED-1: lb-mirror MUSS nach saveXP committen, sonst liest die
  // lb-rule (xp == users/uid.xp) den alten Wert -> silent denial.
  // Also nicht mehr Promise.all, sondern saveXP zuerst await, dann mirror.
  // Wave-5b MED-4: displayName/photoURL aus userData (Marcus's Cross-Check),
  // mit Auth-Fallback fuer Bestand-User die kein userData.name haben.
  if (xpGained > 0) {
    await saveXP(uid, xpGained).catch(console.error);
    // Mirror XP + Rolle zum leaderboard-Doc, damit Banner in Ranglisten auftaucht.
    // Claude- und Hacker-Test-Accounts NICHT mirroren — sonst tauchen sie im XP-Tab auf.
    if (!isClaudeAccount() && !isHackerAccount()) {
      await db().collection('leaderboard').doc(uid).set({
        xp: userData.xp,
        displayName: userData?.name || currentUser.displayName || 'Nutzer',
        photoURL: userData?.photoURL || currentUser.photoURL || null,
        role: userRole() || null
      }, { merge: true }).catch(console.error);
    }
  }
  if (newOnes.length) await saveAchievements(uid, newOnes.map(a => a.id)).catch(console.error);

  newOnes.forEach((a, i) => {
    setTimeout(() => showToast(`Achievement freigeschaltet: ${a.title} (+${a.xp} XP)`, 'success'), i * 1800);
  });

  const newLevel = calcLevel(userData.xp).level;
  if (newLevel > prevLevel) {
    const info = calcLevel(userData.xp);
    setTimeout(() => showToast(`Level ${newLevel} erreicht — ${info.title}!`, 'success'), newOnes.length * 1800 + 600);
  }

  // Update XP bar in nav without full re-render
  const fill = document.getElementById('navXPFill');
  if (fill) fill.style.width = calcLevel(userData.xp).pct + '%';
}

function countTestsToday() {
  const today = new Date().toISOString().slice(0, 10);
  return Object.values(userData?.grades || {})
    .flatMap(g => g.history || [])
    .filter(h => h.date?.startsWith(today)).length;
}

function checkSubjectComplete(subjectId) {
  const subject = structure?.[subjectId];
  if (!subject) return false;
  const grades   = userData?.grades || {};
  const allKeys  = Object.values(subject.years || {})
    .flatMap(y => Object.keys(y.topics || {}).map(tid => `${subjectId}__${y.id}__${tid}`));
  return allKeys.length > 0 && allKeys.every(k => grades[k]);
}

// ── F-27: Streak-Kalender ──────────────────
function calcStreakExtended() {
  const studyMap   = userData?.studyTime || {};
  const freezeSet  = new Set(userData?.freezeDays || []);
  const active     = new Set();

  // Study days from pomodoro tracking
  Object.entries(studyMap).forEach(([d, m]) => { if (m > 0) active.add(d); });
  // Grade history dates
  Object.values(userData?.grades || {}).forEach(g =>
    (g.history || []).forEach(h => { if (h.date) active.add(h.date.slice(0, 10)); })
  );
  // Freeze days
  freezeSet.forEach(d => active.add(d));

  if (!active.size) return { streak: 0, longest: 0, active, freezeSet };

  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  let streak = 0;
  if (active.has(today) || active.has(yesterday)) {
    let d = active.has(today) ? new Date() : new Date(Date.now() - 864e5);
    while (active.has(d.toISOString().slice(0, 10))) {
      streak++;
      d = new Date(d - 864e5);
    }
  }

  const sorted = [...active].sort();
  let longest = 0, cur = 0, prev = null;
  for (const date of sorted) {
    if (prev) {
      const diff = Math.round((new Date(date) - new Date(prev)) / 864e5);
      cur = diff === 1 ? cur + 1 : 1;
    } else cur = 1;
    longest = Math.max(longest, cur);
    prev = date;
  }
  longest = Math.max(longest, streak);

  return { streak, longest, active, freezeSet };
}

function renderStreakCalendar() {
  const { streak, longest, active, freezeSet } = calcStreakExtended();
  const studyMap = userData?.studyTime || {};

  // Build 53 weeks starting on Monday
  const today       = new Date();
  const dayOfWeek   = (today.getDay() + 6) % 7; // Mon=0
  const startMs     = today.getTime() - (dayOfWeek + 52 * 7) * 864e5;
  const weeks       = [];
  let   week        = [];

  for (let i = 0; i < 371; i++) {
    const d       = new Date(startMs + i * 864e5);
    const dateStr = d.toISOString().slice(0, 10);
    const mins    = studyMap[dateStr] || 0;
    const frozen  = freezeSet.has(dateStr);
    const lvl     = frozen ? 'f' : mins === 0 ? '0' : mins < 15 ? '1' : mins < 30 ? '2' : mins < 60 ? '3' : '4';
    week.push(`<div class="scal-cell scl-${lvl}" title="${dateStr}${mins > 0 ? ': ' + mins + ' Min' : ''}${frozen ? ' (Freeze)' : ''}"></div>`);
    if (week.length === 7 || i === 370) { weeks.push(`<div class="scal-week">${week.join('')}</div>`); week = []; }
  }

  // Freeze UI: available if streak ≥ 14 and user missed yesterday
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const missedYesterday = !active.has(yesterday);
  const freezesAvailable = Math.floor(streak / 7);
  const usedFreezes = (userData?.freezeDays || []).length;
  const canFreeze = missedYesterday && streak >= 14 && usedFreezes < freezesAvailable;

  return `
    <div class="streak-stats-row">
      <div class="streak-stat">
        <div class="streak-stat-val">${streak}</div>
        <div class="streak-stat-lbl">Aktueller Streak</div>
      </div>
      <div class="streak-stat">
        <div class="streak-stat-val">${longest}</div>
        <div class="streak-stat-lbl">Längster Streak</div>
      </div>
      ${streak >= 14 ? `
      <div class="streak-stat">
        <div class="streak-stat-val">${freezesAvailable - usedFreezes}</div>
        <div class="streak-stat-lbl">Streak-Freezes</div>
      </div>` : ''}
    </div>
    <div class="streak-cal">
      <div class="scal-grid">${weeks.join('')}</div>
      <div class="scal-legend">
        <span>Weniger</span>
        <div class="scl-box scl-0"></div>
        <div class="scl-box scl-1"></div>
        <div class="scl-box scl-2"></div>
        <div class="scl-box scl-3"></div>
        <div class="scl-box scl-4"></div>
        <span>Mehr</span>
      </div>
    </div>
    ${canFreeze ? `
    <div class="freeze-banner">
      Streak-Freeze verfügbar — gestern als Lerntag einreichen?
      <button class="btn btn-sm btn-primary" style="margin-left:12px" onclick="window.LF.useStreakFreeze()">Freeze verwenden</button>
    </div>` : ''}`;
}

// ── F-26: Daily Challenge ──────────────────
function _seededRand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

async function getDailyChallengeQuestions() {
  const dateKey = new Date().toISOString().slice(0, 10);
  if (DAILY_CHALLENGES[dateKey]) return DAILY_CHALLENGES[dateKey];
  const seed    = dateKey.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const rand    = _seededRand(seed);

  const allTopicsUnfiltered = Object.values(structure || {})
    .flatMap(s => Object.values(s.years || {})
      .flatMap(y => Object.values(y.topics || {})
        .map(t => ({ subjectId: s.id, yearId: y.id, topicId: t.id }))));

  // ── F-1: Klausur-Boost (≤3 Tage) ─────────
  // Topics aus aktiven Klausuren werden zum Pool. Spec §2.4: exam.klasse hat
  // Vorrang vor userData.klasse — also Klausur-Topics direkt aus exam.topicIds
  // ziehen, nicht ueber den klasse-gefilterten Pool.
  // Try/catch: falls Boost-Pfad crasht (corrupted exams), faellt's auf den
  // Standard-Pool zurueck — User sieht eine normale Daily statt Crash.
  let klausurTopics = [];
  try {
    const activeExams = getActiveExamBoost();
    if (activeExams.length) {
      const klausurKeys = new Set();
      activeExams.forEach(ex => {
        (ex.topicIds || []).forEach(k => klausurKeys.add(k));
      });
      klausurTopics = allTopicsUnfiltered.filter(t =>
        klausurKeys.has(`${t.subjectId}__${t.yearId}__${t.topicId}`)
      );
    }
  } catch (e) {
    console.warn('[daily-klausur-boost]', e);
    klausurTopics = [];
  }

  // Klassen-Filter (#7): Topics aus passender Klasse, plus solche ohne Klassenzuordnung (z.B. "Grammatik").
  // Auffuell-Pool fuer Klausur-Boost = klasse-gefilterter Standard-Pool.
  let allTopics = allTopicsUnfiltered;
  const userKlasse = userData?.klasse;
  if (userKlasse) {
    const klPattern = new RegExp(`^Klasse[-_]?${userKlasse}$`, 'i');
    allTopics = allTopics.filter(t => {
      // Topics deren yearId mit "Klasse-X" matcht ODER nicht klassen-spezifisch ist
      const isClassYear = /^Klasse[-_]?\d+$/i.test(t.yearId);
      if (!isClassYear) return true; // z.B. "Grammatik" → für alle
      return klPattern.test(t.yearId);
    });
  }

  if (!allTopics.length && !klausurTopics.length) return [];

  // Deterministisch shuffeln (Fisher-Yates mit Seed) — nicht mit rand()-0.5
  const shuffled = [...allTopics];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Wenn Klausur-Boost: zuerst Klausur-Topics, dann Auffuell-Pool.
  // Cap = 8 (gibt Auffuell-Spielraum fuer den ≥6-MC-Garantor).
  const picked = klausurTopics.length > 0
    ? [...klausurTopics, ...shuffled.filter(t =>
        !klausurTopics.some(k => k.subjectId === t.subjectId && k.yearId === t.yearId && k.topicId === t.topicId)
      )].slice(0, 8)
    : shuffled.slice(0, Math.min(5, shuffled.length));

  // getTopicQuestions returnt ein ARRAY — nicht {questions: [...]}
  const sets = await Promise.all(
    picked.map(t => getTopicQuestions(t.subjectId, t.yearId, t.topicId).catch(() => []))
  );

  const mc = sets.flatMap(arr => (arr || []).filter(q => q.type === 'multiple_choice'));
  // Auch hier deterministisch shuffeln
  const shuffledQ = [...mc];
  for (let i = shuffledQ.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffledQ[i], shuffledQ[j]] = [shuffledQ[j], shuffledQ[i]];
  }
  return shuffledQ.slice(0, 6);
}

function renderDailyChallengeCard() {
  const today    = new Date().toISOString().slice(0, 10);
  const done     = userData?.dailyChallenges?.[today];
  if (done) {
    const gi = calcGrade(done.points, done.maxPoints);
    return `
      <div class="daily-card daily-card-done" data-tour="daily-card" onclick="location.hash='#/daily-challenge'">
        <div class="daily-card-label">Daily Challenge</div>
        <div class="daily-card-status">Heute erledigt</div>
        <div class="daily-card-grade" style="background:${gi.color}">${done.grade}</div>
      </div>`;
  }
  // F-1: Klausur-Boost-Indikator (≤3 Tage). Defensiv im try — wenn was
  // schief geht, faellt der Sub-Text auf den Standard-Status zurueck.
  let boostActive = false;
  try { boostActive = getActiveExamBoost().length > 0; } catch(e) {}
  const subText = boostActive
    ? '5 Min \xb7 6 Fragen \xb7 Klausur-Boost aktiv'
    : '5 Min \xb7 6 Fragen \xb7 Bonus-XP';
  return `
    <div class="daily-card${boostActive ? ' daily-card-boost' : ''}" data-tour="daily-card" onclick="location.hash='#/daily-challenge'">
      <div class="daily-card-label">Daily Challenge</div>
      <div class="daily-card-status">${subText}</div>
      <div class="daily-card-cta">Jetzt starten</div>
    </div>`;
}

async function renderDailyChallenge() {
  const today = new Date().toISOString().slice(0, 10);
  const done  = userData?.dailyChallenges?.[today];

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Daily Challenge' }])}
    <div class="page">
      <div class="page-header">
        <h1>Daily Challenge</h1>
        <div class="sub">${today} · 6 Fragen aus allen Fächern · 5 Minuten</div>
      </div>
      <div id="dcArea"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  if (done) {
    const gi      = calcGrade(done.points, done.maxPoints);
    let scores    = [];
    try { scores = await getDailyScores(today); } catch(e) {}
    // H9 (Casey/Wave-2): direkt nach dcSubmit hat der Server den eigenen Score
    // u.U. noch nicht in den Sammler geschrieben (race window). Eigenen Eintrag
    // lokal injizieren wenn er fehlt — der Server-Mirror beim naechsten Laden
    // ueberschreibt das ohnehin.
    const myUid = currentUser?.uid;
    if (myUid && !scores.some(s => s.uid === myUid)) {
      scores = [
        ...scores,
        {
          uid: myUid,
          displayName: userData?.name || currentUser?.displayName || 'Du',
          photoURL: userData?.photoURL || currentUser?.photoURL || null,
          role: userRole() || null,
          activeOutline: userData?.activeOutline || null,
          xp: userData?.xp || 0,
          grade: done.grade,
          points: done.points,
          maxPoints: done.maxPoints
        }
      ];
    }
    const ranked  = [...scores].sort((a,b)=>(a.grade||9)-(b.grade||9));
    const lbHtml  = ranked.map((u,i) => {
      const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
      const m = i < 3
        ? lfIcon('medal', { cls: 'lb-medal', color: medalColors[i] })
        : (i+1);
      const isMe = u.uid === currentUser?.uid;
      // V-23 (Ramsey, P1): displayName ist self-write erlaubt → escapeHtml() um
      // Cross-User-XSS via <img onerror=...> auf alle Klassenkameraden im
      // Leaderboard-Render zu blockieren. Numbers werden defensiv mit-escaped.
      const safeName    = escapeHtml(u.displayName || '?');
      const safeInitial = escapeHtml((u.displayName?.[0] || '?').toUpperCase());
      const safePoints  = escapeHtml(String(u.points ?? 0));
      const safeMaxPts  = escapeHtml(String(u.maxPoints ?? 0));
      const safeGrade   = escapeHtml(String(u.grade ?? ''));
      return `
        <div class="lb-row${isMe?' lb-me':''}">
          <div class="lb-rank">${m}</div>
          <div class="lb-avatar ${outlineFor(u)}">${safeInitial}</div>
          <div class="lb-name">${safeName} ${roleBadge(u.role)}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
          <div class="lb-meta">${safePoints}/${safeMaxPts} Pkt</div>
          <div class="lb-score" style="color:${gradeColor(u.grade)}">${safeGrade}</div>
        </div>`;
    }).join('') || '<div class="empty-state" style="padding:16px">Noch keine weiteren Einträge.</div>';

    document.getElementById('dcArea').innerHTML = `
      <div class="dc-done">
        <div class="dc-done-grade" style="background:${gi.color}">${done.grade}</div>
        <div class="dc-done-pts">${done.points} / ${done.maxPoints} Punkte</div>
        <div class="dc-done-sub">Morgen gibt es eine neue Challenge!</div>
      </div>
      <div class="section-title" style="margin-top:28px;margin-bottom:12px">Heutige Rangliste</div>
      <div class="lb-main">${lbHtml}</div>`;
    return;
  }

  // Not done yet — load questions
  let questions = [];
  try { questions = await getDailyChallengeQuestions(); } catch(e) {}

  if (!questions.length) {
    document.getElementById('dcArea').innerHTML = `<div class="empty-state">Keine Fragen verfügbar. Füge zuerst Themen mit Fragen hinzu.</div>`;
    return;
  }

  // Shuffle options for MC.
  // Mission 9: client no longer knows q.correct (Cheat #4 — answer-key moved
  // server-side). We still need to remember each shuffled option's ORIGINAL
  // index so dcSubmit can tell the Worker which option the user picked
  // (originalIndex), letting the Worker do the matching.
  questions = questions.map(q => {
    if (q.type === 'multiple_choice' && q.options) {
      const indexed = q.options.map((opt, i) => ({ opt, originalIndex: i }));
      indexed.sort(() => Math.random() - 0.5);
      return {
        ...q,
        shuffledOptions: indexed.map(x => x.opt),
        shuffledOriginalIndices: indexed.map(x => x.originalIndex),
      };
    }
    return q;
  });

  dailyChallengeState = { questions, answers: new Array(questions.length).fill(null), current: 0, startTime: Date.now(), timer: null, timeLeft: 300, dateKey: today };
  // B3: Daily-Challenge zählt auch als „aktiver Test" — gleiche Mid-Test-Guards.
  _setupMidTestGuards('#/daily-challenge');

  _renderDCQuestion();
}

function _renderDCQuestion() {
  if (!dailyChallengeState) return;
  const { questions, answers, current, timeLeft } = dailyChallengeState;
  const q   = questions[current];
  const pct = ((current) / questions.length) * 100;

  const opts = q.shuffledOptions || q.options || [];
  // V-04 (Ramsey, defensive XSS): aktuell ist q.question/q.options Simon-authored
  // (sicher), aber sobald custom-topics fuer DC eligible werden, koennte ein
  // user-supplied String hier landen. escapeHtml() jetzt einziehen, damit der
  // Layer da ist bevor er gebraucht wird.
  const optHtml = opts.map((o, i) => `
    <button class="dc-opt ${answers[current] === String(i) ? 'dc-opt-selected' : ''}"
            onclick="window.LF.dcSelectOpt(${i})">${String.fromCharCode(65+i)}. ${escapeHtml(o)}</button>`).join('');

  document.getElementById('dcArea').innerHTML = `
    <div class="dc-header">
      <div class="dc-timer" id="dcTimer">${Math.floor(timeLeft/60)}:${String(timeLeft%60).padStart(2,'0')}</div>
      <div class="dc-counter">${current+1} / ${questions.length}</div>
    </div>
    <div class="dc-progress"><div class="dc-progress-fill" style="width:${pct}%"></div></div>
    <div class="dc-question">${escapeHtml(q.question)}</div>
    <div class="dc-opts">${optHtml}</div>
    <div class="dc-nav">
      ${current > 0 ? `<button class="btn btn-ghost btn-sm" onclick="window.LF.dcNav(-1)">Zurück</button>` : '<div></div>'}
      ${current < questions.length-1
        ? `<button class="btn btn-primary btn-sm" onclick="window.LF.dcNav(1)">Weiter</button>`
        : `<button class="btn btn-primary" onclick="window.LF.dcSubmit()">Abgeben</button>`}
    </div>`;

  if (!dailyChallengeState.timer) {
    dailyChallengeState.timer = setInterval(() => {
      dailyChallengeState.timeLeft--;
      const el = document.getElementById('dcTimer');
      if (el) {
        const tl = dailyChallengeState.timeLeft;
        el.textContent = `${Math.floor(tl/60)}:${String(tl%60).padStart(2,'0')}`;
        if (tl <= 30) el.classList.add('dc-timer-warn');
      }
      if (dailyChallengeState.timeLeft <= 0) {
        clearInterval(dailyChallengeState.timer);
        window.LF.dcSubmit();
      }
    }, 1000);
  }
}

// ── F-29: Wöchentliche Zusammenfassung ─────
function checkAndShowWeeklySummary() {
  if (!userData) return;
  // B1 (c): Während Tour aktiv NIE den Wochenrückblick popup-en —
  // weekly-overlay hat z-index 10000 und würde die Tour begraben.
  // Casey hat den Stack-Bug aufgespürt; defensiv hier blocken.
  if (_tourState) return;
  // B3 Sophie-QA-Fix (2026-05-08): mid-test = NEVER weekly. Würde sonst
  // mitten in einer Test-Frage als blocking-Modal aufploppen.
  if (typeof isTestActive === 'function' && isTestActive()) return;
  // Casey-UX-Audit (2026-05-08): auch nicht wenn Tour-Toast gleich kommt
  // (Bestands-User mit pending tour-prompt). Tour-Toast hat Vortritt vor dem
  // Wochenrückblick — Tour ist actionable + zeitkritisch, Wochenrückblick
  // kommt bei nächstem Login derselben KW automatisch wieder.
  if (userData?.onboardedAt && userData?.tourPromptedAt
      && !userData?.tourCompletedAt && !userData?.tourSkippedAt
      && !isClaudeAccount() && !isHackerAccount()) return;
  const now  = new Date();
  const d    = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yr   = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wnum = Math.ceil(((d - yr) / 86400000 + 1) / 7);
  const wKey = `${now.getFullYear()}-W${wnum.toString().padStart(2,'0')}`;
  if (localStorage.getItem('lf_weekly_summary') === wKey) return;

  // Collect last 7 days
  const days = Array.from({ length: 7 }, (_, i) =>
    new Date(Date.now() - (i+1) * 864e5).toISOString().slice(0, 10)
  );
  const totalMins  = days.reduce((s, d) => s + (userData.studyTime?.[d] || 0), 0);
  const totalXP    = days.reduce((s, d) => s + (userData.xpLog?.[d] || 0), 0);
  const totalTests = Object.values(userData.grades || {})
    .flatMap(g => g.history || [])
    .filter(h => days.some(d => h.date?.startsWith(d))).length;

  if (totalMins === 0 && totalTests === 0 && totalXP === 0) return;

  localStorage.setItem('lf_weekly_summary', wKey);

  const streak = calcStreak();
  const newAch  = (userData.achievements || []).length;
  const msg     = MOTIVATION_SENTENCES[Math.floor(Math.random() * MOTIVATION_SENTENCES.length)];

  const modal = document.createElement('div');
  modal.id    = 'weeklySummaryModal';
  modal.innerHTML = `
    <div class="weekly-overlay" onclick="window.LF.dismissWeeklySummary()"></div>
    <div class="weekly-modal">
      <div class="weekly-modal-top">
        <h2>Wochenrückblick</h2>
        <div class="weekly-modal-sub">Letzte 7 Tage</div>
      </div>
      <div class="weekly-stats">
        <div class="wm-stat"><div class="wm-val">${totalMins}</div><div class="wm-lbl">Minuten gelernt</div></div>
        <div class="wm-stat"><div class="wm-val">${totalTests}</div><div class="wm-lbl">Tests gemacht</div></div>
        <div class="wm-stat"><div class="wm-val">${totalXP}</div><div class="wm-lbl">XP verdient</div></div>
        <div class="wm-stat"><div class="wm-val">${streak}</div><div class="wm-lbl">Streak</div></div>
      </div>
      <div class="weekly-motivation">${msg}</div>
      <button class="btn btn-primary" onclick="window.LF.dismissWeeklySummary()">Weiter lernen</button>
    </div>`;
  document.body.appendChild(modal);
  requestAnimationFrame(() => modal.classList.add('weekly-visible'));
}

// ── Admin: Topic-Preview-Modal (Phase 3b, Ethan, 2026-05-08) ──
// Laedt das volle customTopics-doc via getCustomTopicById (nutzt service-
// account-bypass nicht — getCustomTopicById ist client-side, aber der Admin
// hat per firestore.rules `isAdmin()` / adminEmails-Branch volle read-rechte
// auf customTopics. Server-source erzwingt frische Read-Daten.
async function _openAdminTopicPreview(topicId) {
  document.getElementById('adminPreviewModalOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'lf-modal-overlay';
  overlay.id = 'adminPreviewModalOverlay';
  overlay.addEventListener('click', e => {
    if (e.target === overlay) window.LF.closeAdminTopicPreview();
  });
  overlay.innerHTML = `
    <div class="lf-modal-card lf-modal-large">
      <div class="lf-modal-header">
        <h3>Topic-Vorschau</h3>
        <button class="btn-icon" onclick="window.LF.closeAdminTopicPreview()" aria-label="Schließen">${lfIcon('x')}</button>
      </div>
      <div class="lf-modal-body" id="adminPreviewBody">
        <div class="spinner" style="margin:40px auto"></div>
      </div>
      <div class="lf-modal-actions">
        <button class="btn btn-ghost" onclick="window.LF.closeAdminTopicPreview()">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  let topic;
  try { topic = await getCustomTopicById(topicId); }
  catch(e) {
    document.getElementById('adminPreviewBody').innerHTML = `<div class="error-msg">Fehler: ${escapeHtml(e.message)}</div>`;
    return;
  }
  if (!topic) {
    document.getElementById('adminPreviewBody').innerHTML = `<div class="error-msg">Topic nicht gefunden.</div>`;
    return;
  }
  // Inhalt sanitizen — gleiche Pipeline wie renderCustomTopicPage benutzt.
  const safeContent = topic.content
    ? sanitizeTopicContent(topic.content)
    : '<p style="color:var(--text-muted)">Kein Inhalt vorhanden.</p>';
  const qs = topic.questions || [];
  document.getElementById('adminPreviewBody').innerHTML = `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">
        ${escapeHtml(topic.fach || '?')} · ${escapeHtml(topic.klasse || '?')}
      </div>
      <h2 style="font-size:22px;margin:6px 0 4px">${escapeHtml(topic.thema || 'Unbenannt')}</h2>
      ${topic.description ? `<div class="sub">${escapeHtml(topic.description)}</div>` : ''}
    </div>
    <div class="content-body" style="max-height:340px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px">
      ${safeContent}
    </div>
    <div class="admin-preview-qheader">${qs.length} Frage${qs.length === 1 ? '' : 'n'}</div>
    <div class="admin-preview-qlist">
      ${qs.map((q, i) => `
        <div class="admin-preview-q">
          <div class="admin-preview-q-num">${i + 1}.</div>
          <div class="admin-preview-q-body">
            <div>${escapeHtml(q.question || q.word || 'Frage')}</div>
            ${q.type === 'multiple_choice' && Array.isArray(q.options) ? `
              <ul class="admin-preview-q-opts">
                ${q.options.map((opt, oi) => `
                  <li class="${oi === q.correct ? 'is-correct' : ''}">${escapeHtml(opt || '')}</li>`).join('')}
              </ul>` : ''}
            ${q.type === 'free_text' && q.sampleAnswer ? `
              <div class="admin-preview-q-sample"><strong>Sample:</strong> ${escapeHtml(q.sampleAnswer)}</div>` : ''}
            ${q.type === 'vocabulary' && Array.isArray(q.answers) ? `
              <div class="admin-preview-q-sample"><strong>Antworten:</strong> ${q.answers.map(a => escapeHtml(a)).join(', ')}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
}

// ── Admin: Reject-Modal mit Begruendungs-Pflicht (Phase 3b) ──
function _openAdminRejectModal(topicId, themaName) {
  document.getElementById('adminRejectModalOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'lf-modal-overlay';
  overlay.id = 'adminRejectModalOverlay';
  overlay.addEventListener('click', e => {
    if (e.target === overlay) window.LF.closeAdminRejectModal();
  });
  overlay.innerHTML = `
    <div class="lf-modal-card">
      <div class="lf-modal-header">
        <h3>Ablehnen: ${escapeHtml(themaName || 'Thema')}</h3>
        <button class="btn-icon" onclick="window.LF.closeAdminRejectModal()" aria-label="Schließen">${lfIcon('x')}</button>
      </div>
      <div class="lf-modal-body">
        <p style="margin-bottom:12px;line-height:1.5">
          Schreib eine kurze Begründung — der Author sieht sie und kann den Inhalt überarbeiten.
        </p>
        <label class="form-label" for="adminRejectNote">Warum ablehnen? <span style="color:var(--danger)">*</span></label>
        <textarea class="form-input" id="adminRejectNote" rows="4" maxlength="1000"
                  placeholder="z.B. Faktisch fehlerhaft im Abschnitt …, Rechtschreibfehler in Frage 3, fehlt Quellenangabe."></textarea>
        <div id="adminRejectModalMsg" style="margin-top:12px"></div>
      </div>
      <div class="lf-modal-actions">
        <button class="btn btn-ghost" onclick="window.LF.closeAdminRejectModal()">Abbrechen</button>
        <button class="btn btn-danger" id="adminRejectConfirmBtn" onclick="window.LF.adminConfirmReject('${escapeAttr(topicId)}')">
          Ablehnen &amp; Begründung senden
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('adminRejectNote')?.focus(), 50);
}

// ── Public-Library-View (Phase 3c, Ethan, 2026-05-08) ──
// Neue Route #/public listet alle Topics mit visibility='public' (= von
// Simon approved). Filter nach Fach + Volltextsuche im Titel/Description.
// Per-Card-Klick navigiert zu #/public/<topicId> — der bestehende
// renderCustomTopicPage-Renderer kann das laden, weil die firestore.rules
// public-Topics fuer alle authed user lesbar machen.
let _publicLibraryCache = null;     // { topics: [...], loadedAt: ms }
let _publicLibraryFilters = { fach: '', q: '' };

async function renderPublicLibrary() {
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Public-Library' }])}
    <div class="page">
      <div class="page-header">
        <h1>Public-Library</h1>
        <div class="sub">Themen, die von der Community erstellt und freigegeben wurden.</div>
      </div>
      <div class="public-lib-toolbar">
        <div class="public-lib-search">
          <span class="public-lib-search-icon">${lfIcon('search')}</span>
          <input class="form-input" id="publicLibSearch" placeholder="Titel oder Beschreibung suchen…"
                 oninput="window.LF.publicLibFilter()" value="${escapeAttr(_publicLibraryFilters.q || '')}">
        </div>
        <select class="form-input public-lib-fach-select" id="publicLibFach"
                onchange="window.LF.publicLibFilter()">
          <option value="">Alle Fächer</option>
        </select>
      </div>
      <div id="publicLibBody">${skeletonCustomCards(6)}</div>
    </div>`;
  // Cache fuer 60s — Public-Library aendert sich selten + spart Firestore-Reads.
  const now = Date.now();
  if (!_publicLibraryCache || (now - _publicLibraryCache.loadedAt) > 60_000) {
    try {
      const topics = await getPublicLibraryTopics();
      _publicLibraryCache = { topics, loadedAt: now };
    } catch(e) {
      document.getElementById('publicLibBody').innerHTML =
        `<div class="error-msg">Fehler beim Laden: ${escapeHtml(e.message)}</div>`;
      return;
    }
  }
  // Fach-Dropdown anhand der vorkommenden Faecher fuellen.
  const select = document.getElementById('publicLibFach');
  if (select) {
    const faecher = Array.from(new Set(_publicLibraryCache.topics
      .map(t => t.fach).filter(Boolean))).sort();
    select.innerHTML = `<option value="">Alle Fächer</option>` +
      faecher.map(f => `<option value="${escapeAttr(f)}" ${_publicLibraryFilters.fach === f ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('');
  }
  _renderPublicLibraryList();
}

function _renderPublicLibraryList() {
  const body = document.getElementById('publicLibBody');
  if (!body || !_publicLibraryCache) return;
  const q = (_publicLibraryFilters.q || '').toLowerCase().trim();
  const fach = _publicLibraryFilters.fach || '';
  const filtered = _publicLibraryCache.topics.filter(t => {
    if (fach && t.fach !== fach) return false;
    if (q) {
      const hay = `${t.thema || ''} ${t.description || ''} ${t.fach || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    body.innerHTML = renderEmptyState({
      icon: 'book-open',
      title: _publicLibraryCache.topics.length === 0
        ? 'Noch keine Public-Library-Themen'
        : 'Keine Treffer für deine Filter',
      sub: _publicLibraryCache.topics.length === 0
        ? 'Du kannst der erste sein! Im Builder erstellen + einreichen.'
        : 'Probier andere Filter oder lösche den Suchbegriff.',
      ctaLabel: _publicLibraryCache.topics.length === 0 ? 'Builder öffnen' : null,
      ctaAction: _publicLibraryCache.topics.length === 0 ? "location.hash='#/builder'" : null
    });
    return;
  }
  body.innerHTML = `<div class="custom-topic-grid">
    ${filtered.map(t => _renderPublicCard(t)).join('')}
  </div>`;
}

function _renderPublicCard(topic) {
  // V-09 (Marcus, 2026-05-08, Mission-13): see renderCustomTopicCard
  // for why questionCount is preferred over questions[].length.
  const qCount = typeof topic.questionCount === 'number'
    ? topic.questionCount
    : (topic.questions || []).length;
  // Subject-Token-Adoption (Maya-Spec): data-subject Attribut auf der Card,
  // damit per-subject-color/font Tokens auf die Subject-Identity reagieren.
  // Wir mappen anhand t.fach auf den subjectId — wenn structure den Fach-
  // Namen kennt. Sonst kein data-subject (Card faellt auf default tokens).
  let subjectId = '';
  if (topic.fach && structure) {
    const match = Object.values(structure).find(s =>
      (s.name || '').toLowerCase() === topic.fach.toLowerCase()
      || s.id === topic.fach);
    if (match) subjectId = match.id;
  }
  const subjAttr = subjectId ? ` data-subject="${escapeAttr(subjectId)}"` : '';
  return `
    <div class="custom-topic-card public-lib-card"${subjAttr}>
      <div class="custom-topic-meta">${escapeHtml(topic.fach || '?')} · ${escapeHtml(topic.klasse || '?')}</div>
      <div class="custom-topic-name">${escapeHtml(topic.thema || 'Unbenannt')}</div>
      ${topic.description ? `<div class="custom-topic-desc">${escapeHtml(topic.description)}</div>` : ''}
      <div class="custom-topic-vis-badge is-public">
        ${lfIcon('globe')} <span>Public</span>
      </div>
      <div class="custom-topic-footer">
        <span class="custom-topic-qcount">${qCount} Frage${qCount !== 1 ? 'n' : ''}</span>
        <div class="custom-topic-actions">
          <button class="btn btn-primary btn-sm" onclick="location.hash='#/public/${escapeAttr(topic.id)}'">Topic öffnen</button>
        </div>
      </div>
    </div>`;
}

// ── Public-Library-Submit-Modal (Phase 3a, Ethan, 2026-05-08) ──
// Wird sowohl beim First-Submit (vom Builder Step-5, kein topicId noch) als
// auch beim Re-Submit nach Reject (mit topicId) genutzt.
// opts:
//   { topicId?: string, isResubmit?: boolean }
// Bei isResubmit=true ruft der Confirm-Click builderConfirmResubmit(topicId);
// sonst builderConfirmPublic() (das save+submit zusammen macht).
function _openPublicSubmitModal(opts = {}) {
  const { topicId = null, isResubmit = false } = opts;
  // Doppelt-oeffnen verhindern
  document.getElementById('publicSubmitModalOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'lf-modal-overlay';
  overlay.id = 'publicSubmitModalOverlay';
  overlay.addEventListener('click', e => {
    if (e.target === overlay) window.LF.closePublicSubmitModal();
  });
  const confirmAttr = isResubmit
    ? `onclick="window.LF.builderConfirmResubmit('${escapeAttr(topicId)}')"`
    : `onclick="window.LF.builderConfirmPublic()"`;
  overlay.innerHTML = `
    <div class="lf-modal-card">
      <div class="lf-modal-header">
        <h3>${isResubmit ? 'Erneut einreichen' : 'In die Public-Library einreichen'}</h3>
        <button class="btn-icon" onclick="window.LF.closePublicSubmitModal()" aria-label="Schließen">${lfIcon('x')}</button>
      </div>
      <div class="lf-modal-body">
        <p style="margin-bottom:14px;line-height:1.5">
          Wenn dein Thema in die <strong>Public-Library</strong> kommt, sehen es <strong>alle</strong> Nutzer
          von LearningForge. Simon prüft jede Einreichung manuell — meistens innerhalb von ein paar Tagen.
        </p>
        <ul style="margin:0 0 14px 18px;padding:0;color:var(--text-muted);font-size:14px;line-height:1.7">
          <li>Inhalte sollten lehrplankonform und für andere nützlich sein.</li>
          <li>Korrekte Rechtschreibung &amp; saubere Quellen helfen.</li>
          <li>Bei Ablehnung erhältst du eine Begründung und kannst überarbeiten.</li>
        </ul>
        <label class="form-label" for="publicSubmitMessage">Warum sollte das in die Public-Library? (optional)</label>
        <textarea class="form-input" id="publicSubmitMessage" rows="4"
                  maxlength="1000"
                  placeholder="z.B. Lehrplanbezug, Zielgruppe, was es besonders macht…"></textarea>
        <div id="publicSubmitModalMsg" style="margin-top:12px"></div>
      </div>
      <div class="lf-modal-actions">
        <button class="btn btn-ghost" onclick="window.LF.closePublicSubmitModal()">Abbrechen</button>
        <button class="btn btn-primary" id="publicSubmitConfirmBtn" ${confirmAttr}>Einreichen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('publicSubmitMessage')?.focus(), 50);
}

// HARD RULE: window.LF ist global namespace und wird in mehreren Stellen
// vor diesem Block bereits gesetzt (z.B. tourToastDismiss/Accept ~Z.3650).
// Object.assign() statt Re-Assign — sonst loescht das die vorherigen Properties.
Object.assign(window.LF, {
  toggleTheme,
  toggleUserMenu: (e) => {
    e.stopPropagation();
    document.getElementById('userChip')?.classList.toggle('open');
  },
  toggleMobileMenu: (e) => {
    e.stopPropagation();
    document.getElementById('mobileNav')?.classList.toggle('open');
  },
  closeMobileMenu: () => {
    document.getElementById('mobileNav')?.classList.remove('open');
  },
  doLogout: async () => {
    // B3: Wenn der User sich mitten im Test ausloggt, müssen wir die
    // Mid-Test-Guards trotzdem abräumen — sonst zeigt beforeunload dem
    // nächsten Login auf der Seite einen Confirm-Dialog beim Reload.
    if (isTestActive()) _abortActiveTest();
    _teardownMidTestGuards();
    await logout();
    location.hash = '#/';
  },
  toggleAuthMode: () => {
    const nameGroup = document.getElementById('nameGroup');
    const isReg = nameGroup.style.display === 'none';
    nameGroup.style.display    = isReg ? 'block' : 'none';
    document.getElementById('authSubmitBtn').textContent = isReg ? 'Registrieren' : 'Anmelden';
    document.getElementById('toggleText').textContent    = isReg ? 'Schon ein Konto?' : 'Noch kein Konto?';
  },
  submitAuth: async () => {
    const { loginWithEmail, registerWithEmail } = await import('./auth.js');
    const email  = document.getElementById('authEmail')?.value?.trim();
    const pass   = document.getElementById('authPass')?.value;
    const name   = document.getElementById('authName')?.value?.trim();
    const isReg  = document.getElementById('nameGroup').style.display !== 'none';
    const errEl  = document.getElementById('authError');
    errEl.innerHTML = '';
    try {
      if (isReg) await registerWithEmail(email, pass, name || 'Nutzer');
      else        await loginWithEmail(email, pass);
    } catch(e) {
      errEl.innerHTML = `<div class="error-msg">${translateFirebaseError(e.code)}</div>`;
    }
  },
  googleLogin: async () => {
    const { loginWithGoogle } = await import('./auth.js');
    try { await loginWithGoogle(); }
    catch(e) { console.error(e); }
  },
  openClaudeSetup: () => {
    if (document.getElementById('claudeSetupOverlay')) return;
    renderClaudeSetupModal();
  },
  saveClaudeCreds: () => {
    const email = document.getElementById('claudeSetupEmail')?.value.trim();
    const pass  = document.getElementById('claudeSetupPass')?.value;
    const err   = document.getElementById('claudeSetupErr');
    if (!email || !pass) { err.textContent = 'Email und Passwort noetig.'; return; }
    if (pass.length < 6) { err.textContent = 'Passwort braucht mind. 6 Zeichen.'; return; }
    localStorage.setItem('lf_claude_creds', JSON.stringify({ email, password: pass }));
    document.getElementById('claudeSetupOverlay')?.remove();
    showToast('Claude-Login lokal gespeichert.', 'success');
    renderLogin();
  },
  clearClaudeCreds: () => {
    if (!confirm('Claude-Login aus diesem Browser loeschen?')) return;
    localStorage.removeItem('lf_claude_creds');
    document.getElementById('claudeSetupOverlay')?.remove();
    showToast('Claude-Login geloescht.', 'info');
    renderLogin();
  },
  claudeLogin: async () => {
    const errEl = document.getElementById('authError');
    if (errEl) errEl.innerHTML = '';
    try { await loginAsClaude(); }
    catch(e) {
      const msg = e.code ? translateFirebaseError(e.code) : e.message;
      if (errEl) errEl.innerHTML = `<div class="error-msg">${msg}</div>`;
      else showToast(msg, 'error');
    }
  },
  // ── Hacker-Test-Account Handlers (Mirror der Claude-Handler) ──
  // Credentials liegen ausschliesslich in localStorage.lf_hacker_creds, NIE
  // in Firestore/Repo, NIE in Logs. log-Statements erwaehnen nur das Vorhandensein.
  openHackerSetup: () => {
    if (document.getElementById('hackerSetupOverlay')) return;
    renderHackerSetupModal();
  },
  saveHackerCreds: () => {
    const email = document.getElementById('hackerSetupEmail')?.value.trim();
    const pass  = document.getElementById('hackerSetupPass')?.value;
    const err   = document.getElementById('hackerSetupErr');
    if (!email || !pass) { err.textContent = 'Email und Passwort noetig.'; return; }
    if (pass.length < 6) { err.textContent = 'Passwort braucht mind. 6 Zeichen.'; return; }
    localStorage.setItem('lf_hacker_creds', JSON.stringify({ email, password: pass }));
    document.getElementById('hackerSetupOverlay')?.remove();
    showToast('Hacker-Login lokal gespeichert.', 'success');
    renderLogin();
  },
  clearHackerCreds: () => {
    if (!confirm('Hacker-Login aus diesem Browser loeschen?')) return;
    localStorage.removeItem('lf_hacker_creds');
    document.getElementById('hackerSetupOverlay')?.remove();
    showToast('Hacker-Login geloescht.', 'info');
    renderLogin();
  },
  loginAsHacker: async () => {
    const errEl = document.getElementById('authError');
    if (errEl) errEl.innerHTML = '';
    try { await loginAsHacker(); }
    catch(e) {
      const msg = e.code ? translateFirebaseError(e.code) : e.message;
      if (errEl) errEl.innerHTML = `<div class="error-msg">${msg}</div>`;
      else showToast(msg, 'error');
    }
  },
  saveColors: async () => {
    const subjects = Object.values(structure || {});
    const colors = {};
    subjects.forEach(s => {
      const input = document.getElementById(`color_${s.id}`);
      if (input) colors[s.id] = input.value;
    });
    userData = userData || {};
    userData.settings = userData.settings || {};
    userData.settings.subjectColors = colors;
    // In Firestore speichern
    // Hard Rule 4: set+merge statt update() fuer Partial-Writes
    await db().collection('users').doc(currentUser.uid).set({
      settings: { subjectColors: colors }
    }, { merge: true }).catch(console.error);
    showToast('Farben gespeichert!', 'success');
  },
  resetColor: (subjectId, defaultColor) => {
    const input   = document.getElementById(`color_${subjectId}`);
    const preview = document.getElementById(`preview_${subjectId}`);
    if (input)   input.value             = defaultColor;
    if (preview) preview.style.background = defaultColor;
  },
  resetAllColors: async () => {
    const subjects = Object.values(structure || {});
    subjects.forEach(s => window.LF.resetColor(s.id, s.color));
    if (userData?.settings?.subjectColors) {
      userData.settings.subjectColors = {};
      await db().collection('users').doc(currentUser.uid).set({
        settings: { subjectColors: {} }
      }, { merge: true }).catch(console.error);
    }
    showToast('Alle Farben zurückgesetzt.', 'info');
  },
  saveIcons: async () => {
    const subjects = Object.values(structure || {});
    const icons = {};
    subjects.forEach(s => {
      const input = document.getElementById(`icon_${s.id}`);
      if (input && input.value.trim()) icons[s.id] = input.value.trim();
    });
    userData = userData || {};
    userData.settings = userData.settings || {};
    userData.settings.customIcons = icons;

    const existingUrls = userData.settings.customIconUrls || {};
    const mergedUrls   = { ...existingUrls, ..._pendingIconUrls };
    userData.settings.customIconUrls = mergedUrls;
    _pendingIconUrls = {};

    await db().collection('users').doc(currentUser.uid).set({
      settings: { customIcons: icons, customIconUrls: mergedUrls }
    }, { merge: true }).catch(console.error);
    showToast('Icons gespeichert!', 'success');
  },

  resetIcon: (subjectId, defaultIcon) => {
    delete _pendingIconUrls[subjectId];
    if (userData?.settings?.customIconUrls) delete userData.settings.customIconUrls[subjectId];
    const input   = document.getElementById(`icon_${subjectId}`);
    const preview = document.getElementById(`iconPreview_${subjectId}`);
    if (input)   input.value      = defaultIcon;
    if (preview) preview.innerHTML = defaultIcon;
  },

  onEmojiInput: (subjectId, val) => {
    delete _pendingIconUrls[subjectId];
    const preview = document.getElementById(`iconPreview_${subjectId}`);
    if (preview) preview.innerHTML = val || structure?.[subjectId]?.icon || '📚';
  },

  handleIconFile: async (subjectId, input) => {
    const file = input.files?.[0];
    if (!file) return;
    const dataUrl = await _resizeToDataUrl(file);
    if (!dataUrl) { showToast('Bild konnte nicht geladen werden.', 'error'); return; }
    _pendingIconUrls[subjectId] = dataUrl;
    const preview = document.getElementById(`iconPreview_${subjectId}`);
    if (preview) preview.innerHTML = `<img class="subject-icon-img" src="${dataUrl}" alt="" style="width:36px;height:36px">`;
    const emojiInput = document.getElementById(`icon_${subjectId}`);
    if (emojiInput) emojiInput.value = '';
    input.value = '';
  },

  startVocab: () => {
    const allCards = [...(vocabState?.allCards || [])];
    for (let i = allCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allCards[i], allCards[j]] = [allCards[j], allCards[i]];
    }
    vocabState = { allCards: vocabState?.allCards || [], cards: allCards, index: 0, correct: 0, wrong: [] };
    document.getElementById('tabVokabeln').innerHTML = renderVocabCard();
    document.getElementById('vocabInput')?.focus();
  },

  showVocabHint: () => {
    document.getElementById('vocabHint').style.display = 'block';
    document.getElementById('vocabHintBtn').style.display = 'none';
  },

  submitVocabAnswer: () => {
    const input = document.getElementById('vocabInput');
    if (!input) return;
    const answer = input.value;
    const card   = vocabState.cards[vocabState.index];
    const result = evaluateVocabAnswer(card, answer);
    if (result.correct) {
      vocabState.correct++;
    } else {
      vocabState.wrong.push({ card, given: answer.trim() });
    }
    document.getElementById('tabVokabeln').innerHTML = renderVocabFeedback(result, card);
  },

  nextVocabCard: () => {
    vocabState.index++;
    if (vocabState.index >= vocabState.cards.length) {
      document.getElementById('tabVokabeln').innerHTML = renderVocabResults();
    } else {
      document.getElementById('tabVokabeln').innerHTML = renderVocabCard();
      document.getElementById('vocabInput')?.focus();
    }
  },

  // ── Gruppen ──────────────────────────────
  groupCreate: async () => {
    if (_blockClaudeWrite('Gruppen erstellen')) return;
    const name = document.getElementById('newGroupName')?.value.trim();
    if (!name) { showToast('Bitte einen Gruppennamen eingeben.', 'error'); return; }
    const groupIds = userData?.groupIds || [];
    if (groupIds.length >= 2) { showToast('Maximum: 2 Gruppen pro Konto.', 'error'); return; }
    try {
      const gid = await createGroup(currentUser.uid, currentUser.displayName||'Nutzer', currentUser.photoURL, name);
      if (!userData) userData = {};
      userData.groupIds = [...groupIds, gid];
      showToast('Gruppe erstellt!', 'success');
      location.hash = `#/gruppen/${gid}`;
    } catch(e) { showToast(e.message, 'error'); }
  },

  groupJoin: async () => {
    if (_blockClaudeWrite('Gruppen beitreten')) return;
    const code = document.getElementById('joinCode')?.value.trim();
    if (!code || code.length !== 6) { showToast('Bitte gültigen 6-stelligen Code eingeben.', 'error'); return; }
    const groupIds = userData?.groupIds || [];
    if (groupIds.length >= 2) { showToast('Maximum: 2 Gruppen pro Konto.', 'error'); return; }
    try {
      const gid = await joinGroupByCode(currentUser.uid, currentUser.displayName||'Nutzer', currentUser.photoURL, code);
      if (!userData) userData = {};
      userData.groupIds = [...groupIds, gid];
      showToast('Gruppe beigetreten!', 'success');
      location.hash = `#/gruppen/${gid}`;
    } catch(e) { showToast(e.message, 'error'); }
  },

  groupLeave: async (groupId, name) => {
    if (!confirm(`Gruppe „${name}" wirklich verlassen?`)) return;
    try {
      await leaveGroup(currentUser.uid, groupId);
      if (userData?.groupIds) userData.groupIds = userData.groupIds.filter(id => id !== groupId);
      showToast('Gruppe verlassen.', 'info');
      location.hash = '#/gruppen';
    } catch(e) { showToast(e.message, 'error'); }
  },

  groupDelete: async (groupId, name) => {
    if (!confirm(`Gruppe „${name}" wirklich löschen? Alle Mitglieder werden entfernt.`)) return;
    try {
      await leaveGroup(currentUser.uid, groupId);
      if (userData?.groupIds) userData.groupIds = userData.groupIds.filter(id => id !== groupId);
      showToast('Gruppe gelöscht.', 'success');
      location.hash = '#/gruppen';
    } catch(e) { showToast(e.message, 'error'); }
  },

  groupKick: async (groupId, targetUid, targetName) => {
    if (!confirm(`${targetName} aus der Gruppe entfernen?`)) return;
    try {
      await kickFromGroup(groupId, targetUid);
      showToast(`${targetName} entfernt.`, 'success');
      renderGroupDetail(groupId);
    } catch(e) { showToast(e.message, 'error'); }
  },

  showToast: (msg, type) => showToast(msg, type),

  // ── Phase 3: Gamification (F-24 – F-29) ──

  // Leaderboard-Tab wechseln (F-25/F-28)
  switchLbTab: (tab, btn) => {
    document.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('lbPunkte').style.display = tab === 'punkte' ? 'block' : 'none';
    document.getElementById('lbXP').style.display     = tab === 'xp'     ? 'block' : 'none';
  },

  // Streak-Freeze verwenden (F-27)
  useStreakFreeze: async () => {
    if (!currentUser) return;
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const existing  = userData?.freezeDays || [];
    if (existing.includes(yesterday)) { showToast('Freeze für gestern bereits verwendet.', 'info'); return; }
    const updated = [...existing, yesterday];
    userData = userData || {};
    userData.freezeDays = updated;
    await saveFreezeDays(currentUser.uid, updated).catch(console.error);
    showToast('Streak-Freeze angewendet — gestern zählt als Lerntag!', 'success');
    renderProfile();
  },

  // Daily Challenge Optionsauswahl (F-26)
  dcSelectOpt: (idx) => {
    if (!dailyChallengeState) return;
    dailyChallengeState.answers[dailyChallengeState.current] = String(idx);
    _renderDCQuestion();
  },

  dcNav: (dir) => {
    if (!dailyChallengeState) return;
    const next = dailyChallengeState.current + dir;
    if (next < 0 || next >= dailyChallengeState.questions.length) return;
    dailyChallengeState.current = next;
    _renderDCQuestion();
  },

  dcSubmit: async () => {
    if (!dailyChallengeState) return;
    if (dailyChallengeState.timer) { clearInterval(dailyChallengeState.timer); dailyChallengeState.timer = null; }
    const { questions, answers, dateKey } = dailyChallengeState;

    // Mission 9: send the user's answers to the Worker. The Worker holds the
    // (server-side) answer-key, re-evaluates, writes the dailyScores doc,
    // grants XP/achievements, and returns the verdict. No local-evaluate path.
    const payloadAnswers = questions.map((q, i) => {
      const ans = answers[i];
      if (q.type === 'multiple_choice') {
        const shuffledIdx = (ans == null || ans === '') ? -1 : parseInt(ans);
        // De-shuffle: shuffledOriginalIndices maps display-index -> original-index.
        // -1 (not answered) stays -1 so the Worker can count it as wrong/empty.
        const originalIdx = (shuffledIdx >= 0 && q.shuffledOriginalIndices)
          ? (q.shuffledOriginalIndices[shuffledIdx] ?? -1)
          : -1;
        return { questionIndex: i, selectedOriginalIndex: originalIdx };
      }
      // Future: free-text questions in dailies would land here.
      return { questionIndex: i, freeText: String(ans ?? '') };
    });

    // B4 fix (2026-05-08): for NON-curated dates the worker has no
    // server-side answer-key (the curated map only covers Apr 22-28).
    // Frontend's getDailyChallengeQuestions() in that case pulls from
    // getTopicQuestions(), which keeps the `correct` field. We pass
    // questions[] alongside so the worker can validate + evaluate.
    // Curated dates: questions[].correct is undefined (Mission 9
    // stripped it from daily-challenges-config.js). Detect curated by
    // checking whether ALL MC questions have a numeric `correct`. If
    // any is missing, we're on the curated path and don't send
    // `questions` at all (worker will use its server map).
    const allMcHaveCorrect = questions.every(q =>
      q.type !== 'multiple_choice' || Number.isInteger(q.correct)
    );
    const dynamicQuestions = allMcHaveCorrect
      ? questions.map(q => ({
          id:      q.id || null,
          type:    q.type,
          options: Array.isArray(q.options) ? q.options : [],
          correct: q.correct,
          points:  q.points || 2
        }))
      : null;

    let result;
    try {
      const payload = { date: dateKey, answers: payloadAnswers };
      if (dynamicQuestions) payload.questions = dynamicQuestions;
      result = await cf.submitDailyChallenge(payload);
    } catch (e) {
      console.error('[dcSubmit] Worker call failed:', e);
      showToast('Daily-Challenge konnte nicht abgegeben werden: ' + (e?.message || 'Netzwerkfehler'), 'error');
      // Keep state intact so user can retry.
      return;
    }

    // Worker returns { grade, points, max, xpAwarded, achievementsGranted, perfect, ... }.
    // Mirror to local userData so the UI updates instantly without a refetch.
    const grade = result?.grade ?? 6;
    const pts   = result?.points ?? 0;
    const max   = result?.max ?? 0;
    userData = userData || {};
    userData.dailyChallenges = userData.dailyChallenges || {};
    userData.dailyChallenges[dateKey] = { grade, points: pts, maxPoints: max };
    userData.dailyChallengesCompleted = (userData.dailyChallengesCompleted || 0) + 1;
    if (typeof result?.xpAwarded === 'number') {
      userData.xp = (userData.xp || 0) + result.xpAwarded;
    }
    if (Array.isArray(result?.achievementsGranted) && result.achievementsGranted.length) {
      userData.achievements = Array.from(new Set([...(userData.achievements || []), ...result.achievementsGranted]));
    }

    // B3: Daily-Challenge fertig — Mid-Test-Guards abräumen, dann State leeren.
    if (dailyChallengeState) dailyChallengeState.submitted = true;
    _teardownMidTestGuards();
    dailyChallengeState = null;
    renderDailyChallenge();
  },

  // Wöchentlicher Rückblick schließen (F-29)
  dismissWeeklySummary: () => {
    const el = document.getElementById('weeklySummaryModal');
    if (el) { el.classList.remove('weekly-visible'); setTimeout(() => el.remove(), 300); }
  },

  // ── PWA Install (F-13) ───────────────────
  installApp: async () => {
    if (!_installPrompt) return;
    _installPrompt.prompt();
    const { outcome } = await _installPrompt.userChoice;
    if (outcome === 'accepted') {
      _installPrompt = null;
      document.getElementById('installCard')?.remove();
    }
  },
  dismissInstall: () => {
    localStorage.setItem('lf_install_dismissed', '1');
    document.getElementById('installCard')?.remove();
  },

  // ── Lesezeichen (F-19) ───────────────────
  toggleBookmarkTopic: async (key) => {
    const bm = userData?.bookmarks || [];
    const isBm = bm.includes(key);
    await toggleBookmark(currentUser.uid, key, isBm);
    userData = userData || {};
    if (isBm) {
      userData.bookmarks = bm.filter(k => k !== key);
      // V11 (Casey/Wave-2): Trash war "sofort weg, Toast als Trostpflaster".
      // Jetzt 5s Undo-Window mit Button — re-add re-uses dieselbe toggleBookmark-API.
      showUndoToast('Lesezeichen entfernt', async () => {
        try {
          await toggleBookmark(currentUser.uid, key, false);
          userData.bookmarks = [...(userData.bookmarks || []), key];
          if (location.hash === '#/lesezeichen') renderLesezeichen();
          // bm-icon-btn-State zuruecksetzen, falls die Topic-Card noch sichtbar ist
          document.querySelectorAll(`.bm-icon-btn`).forEach(b => {
            if (b.getAttribute('onclick')?.includes(key)) b.classList.add('active');
          });
          showToast('Wiederhergestellt.', 'success');
        } catch (e) {
          console.warn('[bookmark-undo]', e);
          showToast('Wiederherstellen fehlgeschlagen.', 'error');
        }
      });
      // Auf der Lesezeichen-Page die entfernte Karte direkt aus dem DOM nehmen,
      // damit die UI synchron mit dem Datenmodell ist.
      if (location.hash === '#/lesezeichen') renderLesezeichen();
    } else {
      userData.bookmarks = [...bm, key];
      showToast('Lesezeichen gespeichert!', 'success');
    }
    // Update UI immediately. innerHTML statt textContent damit lfIcon-SVG rendert.
    const btn = document.getElementById('bookmarkBtn');
    if (btn) {
      btn.className = `bookmark-btn${isBm ? '' : ' active'}`;
      btn.innerHTML = isBm ? `${lfIcon('bookmark')} Lesezeichen` : `${lfIcon('bookmark')} Gespeichert`;
    }
    // Update any bm-icon-btn for this key
    document.querySelectorAll(`.bm-icon-btn`).forEach(b => {
      if (b.getAttribute('onclick')?.includes(key)) {
        b.classList.toggle('active', !isBm);
      }
    });
  },

  // ── Notizen (F-18) ───────────────────────
  toggleNotes: () => {
    const body   = document.getElementById('notesBody');
    const arrow  = document.getElementById('notesArrow');
    const toggle = document.querySelector('.notes-toggle');
    if (!body) return;
    const willOpen = !body.classList.contains('open');
    body.classList.toggle('open', willOpen);
    body.style.removeProperty('display'); // alten inline-display entfernen
    if (toggle) toggle.classList.toggle('open', willOpen);
    // Mission 8: arrow.lucide-chevron-down ist im default-state (Panel geschlossen)
    // mit class 'open' rotiert (180deg = Pfeil zeigt nach oben). Beim Aufklappen
    // wird 'open' entfernt → Chevron zeigt nach unten (offen).
    if (arrow) arrow.classList.toggle('open', !willOpen);
    if (willOpen) document.getElementById('notesInput')?.focus();
  },

  onNoteInput: (key, value) => {
    clearTimeout(_notesSaveTimer);
    // V-13 (Casey, anxiety): sichtbares Auto-Save-Feedback. "Tippen..." waehrend
    // Debounce, "Gespeichert"-Pill nach erfolgreichem saveNote, fade-out 2s
    // spaeter via .notes-saved-pill-fade.
    const status = document.getElementById('notesStatus');
    if (status) status.innerHTML = '<span class="notes-saved-pill notes-saved-pill-typing">Tippen&hellip;</span>';
    _notesSaveTimer = setTimeout(async () => {
      if (!currentUser) return;
      userData = userData || {};
      if (!userData.notes) userData.notes = {};
      userData.notes[key] = value;
      await saveNote(currentUser.uid, key, value).catch(console.error);
      const s = document.getElementById('notesStatus');
      if (!s) return;
      s.innerHTML = '<span class="notes-saved-pill">&check; Gespeichert</span>';
      setTimeout(() => {
        if (!s) return;
        const pill = s.querySelector('.notes-saved-pill');
        if (pill) pill.classList.add('notes-saved-pill-fade');
        setTimeout(() => { if (s) s.innerHTML = ''; }, 350);
      }, 2000);
    }, 1500);
  },

  // ── Karteikarten / Flashcards (F-15) ─────
  startFlashcards: (subjectId, yearId, topicId) => {
    const parts = topicId ? [subjectId, yearId, topicId]
      : (flashcardState?.topicKey || '').split('__');
    const [sid, yid, tid] = parts;
    const questions = sid && structure?.[sid]?.years?.[yid]?.topics?.[tid]
      ? null : null; // will be re-fetched
    // Use already-loaded questions from current topic context
    if (flashcardState !== null || !sid) return;
    // Actually: topic questions are already in scope via closure... need different approach
    // We'll trigger re-render with stored questions
    showToast('Karten laden…', 'info');
    getTopicQuestions(sid, yid, tid).then(qs => {
      if (!qs.length) { showToast('Keine Fragen vorhanden.', 'error'); return; }
      renderFlashcardSession(qs, sid, yid, tid);
    });
  },

  flipCard: () => {
    const inner = document.getElementById('fcCardInner');
    const actions = document.getElementById('fcActions');
    const hint = document.getElementById('fcActionsHint');
    if (!inner || !flashcardState) return;
    flashcardState.flipped = !flashcardState.flipped;
    inner.classList.toggle('flipped', flashcardState.flipped);
    if (actions) actions.style.display = flashcardState.flipped ? 'flex' : 'none';
    if (hint)    hint.style.display    = flashcardState.flipped ? 'none' : 'block';
  },

  fcKnew: async () => {
    if (!flashcardState) return;
    const q = flashcardState.cards[flashcardState.current];
    await updateSRSCard(q, 5);
    flashcardState.knew++;
    flashcardState.current++;
    flashcardState.flipped = false;
    const tab = document.getElementById('tabKarten');
    if (tab) tab.innerHTML = renderFlashcard();
  },

  fcDidntKnow: async () => {
    if (!flashcardState) return;
    const q = flashcardState.cards[flashcardState.current];
    await updateSRSCard(q, 1);
    flashcardState.didntKnow++;
    flashcardState.current++;
    flashcardState.flipped = false;
    const tab = document.getElementById('tabKarten');
    if (tab) tab.innerHTML = renderFlashcard();
  },

  // ── SRS-Session (F-16) ───────────────────
  srsReveal: () => {
    document.getElementById('srsFront')?.style.setProperty('display', 'none');
    document.getElementById('srsBack')?.style.setProperty('display', 'block');
  },

  rateSRS: async (rating) => {
    if (!srsState) return;
    const card = srsState.cards[srsState.current];
    // Update SM-2
    const existing = userData?.srs?.[card.id] || card;
    const updated = sm2Update(existing, rating);
    userData = userData || {};
    if (!userData.srs) userData.srs = {};
    userData.srs[card.id] = { ...existing, ...updated };
    await saveSRS(currentUser.uid, userData.srs).catch(console.error);
    userData.srsReviewsTotal = (userData.srsReviewsTotal || 0) + 1;
    await incrementCounter(currentUser.uid, 'srsReviewsTotal').catch(console.error);
    grantXPAndAchievements({ xp: 3 }).catch(console.error);
    srsState.current++;
    srsState.done++;
    const area = document.getElementById('srsArea');
    if (area) area.innerHTML = renderSRSCard(srsState.cards, srsState.current);
  },

  // ── Pomodoro (F-17) ──────────────────────
  pomodoroOpen: () => {
    const panel = document.getElementById('pomoPanel');
    if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  },

  pomodoroToggle: () => {
    if (!pomodoroState) return;
    if (pomodoroState.timer) {
      clearInterval(pomodoroState.timer);
      pomodoroState.timer = null;
    } else {
      pomodoroState.timer = setInterval(pomodoroTick, 1000);
    }
    const btn = document.querySelector('#pomoPanel .btn-primary');
    if (btn) btn.innerHTML = pomodoroState.timer ? `${lfIcon('pause')} Pause` : `${lfIcon('play')} Start`;
  },

  pomodoroReset: () => {
    if (!pomodoroState) return;
    clearInterval(pomodoroState.timer);
    pomodoroState.timer = null;
    pomodoroState.mode = 'work';
    pomodoroState.seconds = pomodoroState.workMins * 60;
    _updatePomodoroDisplay();
    const btn = document.querySelector('#pomoPanel .btn-primary');
    if (btn) btn.innerHTML = `${lfIcon('play')} Start`;
  },

  pomodoroSetWork: (mins) => {
    if (!pomodoroState || isNaN(mins) || mins < 1) return;
    pomodoroState.workMins = mins;
    if (pomodoroState.mode === 'work') {
      pomodoroState.seconds = mins * 60;
      _updatePomodoroDisplay();
    }
  },

  pomodoroSetBreak: (mins) => {
    if (!pomodoroState || isNaN(mins) || mins < 1) return;
    pomodoroState.breakMins = mins;
    if (pomodoroState.mode === 'break') {
      pomodoroState.seconds = mins * 60;
      _updatePomodoroDisplay();
    }
  },

  // ── Wissens-Check (F-20) ─────────────────
  wissensCheckMC: (topicKey, qIdx, chosenIdx, correctIdx) => {
    const opts = document.querySelectorAll(`[id^="wcOpt_${topicKey}_${qIdx}_"]`);
    opts.forEach(b => b.disabled = true);
    const chosen = document.getElementById(`wcOpt_${topicKey}_${qIdx}_${chosenIdx}`);
    const correct = document.getElementById(`wcOpt_${topicKey}_${qIdx}_${correctIdx}`);
    if (chosen)  chosen.classList.add(chosenIdx === correctIdx ? 'wc-correct' : 'wc-wrong');
    if (correct && chosenIdx !== correctIdx) correct.classList.add('wc-correct');
    const fb = document.getElementById(`wcFb_${topicKey}_${qIdx}`);
    if (fb) {
      fb.style.display = 'block';
      // innerHTML statt textContent damit lfIcon-SVG rendert.
      fb.innerHTML = chosenIdx === correctIdx
        ? `${lfIcon('check', {cls:'sx-correct'})} Richtig!`
        : `${lfIcon('x', {cls:'sx-wrong'})} Falsch`;
      fb.className = `wc-fb ${chosenIdx===correctIdx?'correct':'wrong'}`;
    }
  },

  wissensCheckReveal: (topicKey, qIdx) => {
    const btn = document.getElementById(`wcRevealBtn_${topicKey}_${qIdx}`);
    const fb  = document.getElementById(`wcFb_${topicKey}_${qIdx}`);
    if (btn) btn.style.display = 'none';
    if (fb)  fb.style.display = 'block';
  },

  // ── Admin ────────────────────────────────
  adminBan: async (uid, name) => {
    if (!confirm(`${name} wirklich sperren?`)) return;
    await setBanStatus(uid, true);
    await resetLeaderboard(uid);
    showToast(`${name} gesperrt.`, 'success');
    renderAdmin();
  },
  adminUnban: async (uid, name) => {
    await setBanStatus(uid, false);
    showToast(`${name} entsperrt.`, 'success');
    renderAdmin();
  },
  adminResetLb: async (uid, name) => {
    if (!confirm(`Rangliste von ${name} wirklich zurücksetzen?`)) return;
    await resetLeaderboard(uid);
    showToast(`Rangliste von ${name} zurückgesetzt.`, 'success');
  },

  adminToggleTool: (subjectId, tool, value) => {
    if (!_toolsOverride) _toolsOverride = {};
    if (!_toolsOverride[subjectId]) _toolsOverride[subjectId] = {};
    _toolsOverride[subjectId][tool] = value;
  },

  adminSaveTools: async () => {
    try {
      await db().collection('appConfig').doc('subjectTools').set(
        { tools: _toolsOverride || {} }, { merge: false }
      );
      showToast('Hilfsmittel gespeichert.', 'success');
    } catch (e) {
      showToast('Fehler beim Speichern: ' + e.message, 'error');
    }
  },

  // ── Admin: Public-Library Approval (Phase 3b, Ethan, 2026-05-08) ──
  adminPreviewTopic: (topicId) => {
    if (!topicId) return;
    _openAdminTopicPreview(topicId);
  },

  closeAdminTopicPreview: () => {
    document.getElementById('adminPreviewModalOverlay')?.remove();
  },

  adminApprove: async (topicId, themaName) => {
    if (!topicId) return;
    if (!confirm(`„${themaName || 'Thema'}" wirklich freigeben? Es wird dann in der Public-Library für ALLE sichtbar.`)) return;
    try {
      await cf.approveTopicForPublic(topicId, 'approve');
      showToast('Freigegeben — Topic ist jetzt public.', 'success');
      _renderAdminApprovalQueue();
    } catch(e) {
      showToast('Fehler: ' + e.message, 'error');
    }
  },

  adminOpenRejectModal: (topicId, themaName) => {
    if (!topicId) return;
    _openAdminRejectModal(topicId, themaName || '');
  },

  closeAdminRejectModal: () => {
    document.getElementById('adminRejectModalOverlay')?.remove();
  },

  // Public-Library-Filter (Phase 3c, Ethan)
  publicLibFilter: () => {
    _publicLibraryFilters.q    = document.getElementById('publicLibSearch')?.value || '';
    _publicLibraryFilters.fach = document.getElementById('publicLibFach')?.value   || '';
    _renderPublicLibraryList();
  },

  adminConfirmReject: async (topicId) => {
    const ta = document.getElementById('adminRejectNote');
    const note = (ta?.value || '').trim();
    const msgArea = document.getElementById('adminRejectModalMsg');
    if (note.length < 5) {
      if (msgArea) msgArea.innerHTML = `<div class="error-msg">Begründung mit mindestens 5 Zeichen ist Pflicht.</div>`;
      return;
    }
    const btn = document.getElementById('adminRejectConfirmBtn');
    if (btn) btn.disabled = true;
    if (msgArea) msgArea.innerHTML = '<div class="spinner" style="margin:8px auto;width:20px;height:20px"></div>';
    try {
      await cf.approveTopicForPublic(topicId, 'reject', note);
      window.LF.closeAdminRejectModal();
      showToast('Abgelehnt — Author wird die Begründung sehen.', 'info');
      _renderAdminApprovalQueue();
    } catch(e) {
      if (msgArea) msgArea.innerHTML = `<div class="error-msg">Fehler: ${escapeHtml(e.message)}</div>`;
      if (btn) btn.disabled = false;
    }
  },

  // ── Builder ──────────────────────────────
  builderNext: () => {
    if (builderState.step === 1) {
      builderState.fach        = document.getElementById('bFach')?.value.trim()   || '';
      builderState.klasse      = document.getElementById('bKlasse')?.value.trim() || '';
      builderState.thema       = document.getElementById('bThema')?.value.trim()  || '';
      builderState.description = document.getElementById('bDesc')?.value.trim()   || '';
      if (!builderState.fach || !builderState.klasse || !builderState.thema) {
        showToast('Bitte Fach, Klasse und Thema ausfüllen.', 'error'); return;
      }
    }
    if (builderState.step === 3) {
      if (builderState.mode === 'html') {
        builderState.content = document.getElementById('builderContentInput')?.value || '';
      } else {
        collectVisualBlocks();
        builderState.content = serializeVisualBlocks();
      }
    }
    builderState.step++;
    renderBuilder();
  },
  builderPrev: () => {
    if (builderState.step === 3) {
      if (builderState.mode === 'html') {
        builderState.content = document.getElementById('builderContentInput')?.value || '';
      } else {
        collectVisualBlocks();
      }
    }
    builderState.step--;
    renderBuilder();
  },

  builderInsert: (type) => {
    const ta = document.getElementById('builderContentInput');
    if (!ta) return;
    const snippet = '\n' + BUILDER_SNIPPETS[type] + '\n';
    const pos = ta.selectionStart;
    ta.value = ta.value.slice(0, pos) + snippet + ta.value.slice(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = pos + snippet.length;
    builderState.content = ta.value;
    ta.focus();
    window.LF.builderPreview();
  },
  builderPreview: () => {
    const div = document.getElementById('builderPreviewDiv');
    if (div) div.innerHTML = builderState.content || '<span style="color:var(--text-muted)">Vorschau erscheint hier…</span>';
  },

  builderQTypeChange: () => {
    const type = document.getElementById('bQType')?.value;
    const container = document.getElementById('bQFields');
    if (container && type) container.innerHTML = renderBuilderQFields(type);
  },
  builderAddQuestion: () => {
    const type = document.getElementById('bQType')?.value;
    let q = null;
    const id = `q${Date.now()}`;
    if (type === 'multiple_choice') {
      const question = document.getElementById('bQQuestion')?.value.trim();
      if (!question) { showToast('Bitte Frage eingeben.', 'error'); return; }
      const options  = [0,1,2,3].map(i => document.getElementById(`bOpt${i}`)?.value.trim() || `Option ${i+1}`);
      const correct  = parseInt(document.querySelector('input[name="bCorrect"]:checked')?.value ?? 0);
      const diff     = document.getElementById('bQDiff')?.value || 'medium';
      const points   = parseInt(document.getElementById('bQPoints')?.value) || 2;
      q = { id, type, question, options, correct, difficulty: diff, points };
    } else if (type === 'free_text') {
      const question = document.getElementById('bQQuestion')?.value.trim();
      if (!question) { showToast('Bitte Frage eingeben.', 'error'); return; }
      const sample   = document.getElementById('bQSample')?.value.trim();
      const kwRaw    = document.getElementById('bQKeywords')?.value.trim();
      const keywords = kwRaw ? kwRaw.split(',').map(k=>k.trim()).filter(Boolean) : [];
      const diff     = document.getElementById('bQDiff')?.value || 'medium';
      const maxPoints = parseInt(document.getElementById('bQPoints')?.value) || 4;
      q = { id, type, question, sampleAnswer: sample, keywords, difficulty: diff, maxPoints };
    } else if (type === 'vocabulary') {
      const word = document.getElementById('bQWord')?.value.trim();
      const answersRaw = document.getElementById('bQAnswers')?.value.trim();
      if (!word || !answersRaw) { showToast('Bitte Wort und Antworten eingeben.', 'error'); return; }
      const answers   = answersRaw.split(',').map(a=>a.trim()).filter(Boolean);
      const direction = document.getElementById('bQDirection')?.value.trim();
      const hint      = document.getElementById('bQHint')?.value.trim();
      q = { id, type: 'vocabulary', word, answers, ...(direction && {direction}), ...(hint && {hint}), points: 1 };
    }
    if (q) {
      builderState.questions.push(q);
      document.getElementById('builderQList').innerHTML = renderBuilderQList();
      // Reset fields
      ['bQQuestion','bQSample','bQKeywords','bOpt0','bOpt1','bOpt2','bOpt3','bQWord','bQAnswers','bQDirection','bQHint']
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      showToast('Frage hinzugefügt.', 'success');
    }
  },
  builderDeleteQ: (i) => {
    builderState.questions.splice(i, 1);
    document.getElementById('builderQList').innerHTML = renderBuilderQList();
  },

  builderChooseMode: (mode) => {
    builderState.mode = mode;
    builderState.step = 3;
    renderBuilder();
  },

  visualAddBlock: (type) => {
    collectVisualBlocks();
    const def = VISUAL_BLOCK_TYPES[type];
    if (!def) return;
    builderState.blocks.push({ type, data: def.make() });
    renderVisualCanvas();
  },
  visualDeleteBlock: (i) => {
    collectVisualBlocks();
    builderState.blocks.splice(i, 1);
    renderVisualCanvas();
  },
  visualDragStart: (e, i) => {
    _visualDragIdx = i;
    e.dataTransfer.effectAllowed = 'move';
  },
  visualDragOver: (e, i) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.vblock').forEach(b => b.classList.remove('drag-over'));
    document.querySelectorAll('.vblock')[i]?.classList.add('drag-over');
  },
  visualDragLeave: (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drag-over');
    }
  },
  visualDragEnd: () => {
    document.querySelectorAll('.vblock').forEach(b => b.classList.remove('drag-over'));
    _visualDragIdx = null;
  },
  visualDrop: (e, toIdx) => {
    e.preventDefault();
    document.querySelectorAll('.vblock').forEach(b => b.classList.remove('drag-over'));
    if (_visualDragIdx === null || _visualDragIdx === toIdx) { _visualDragIdx = null; return; }
    collectVisualBlocks();
    const blocks = [...builderState.blocks];
    const [moved] = blocks.splice(_visualDragIdx, 1);
    blocks.splice(toIdx, 0, moved);
    builderState.blocks = blocks;
    _visualDragIdx = null;
    renderVisualCanvas();
  },

  builderExport: async () => {
    const s = builderState;
    const fach   = s.fach.replace(/\s+/g, '-');
    const klasse = s.klasse.replace(/\s+/g, '-');
    const thema  = s.thema.replace(/\s+/g, '-');
    const folder = `Fächer/${fach}/${klasse}/${thema}/`;

    const meta = { name: s.thema, description: s.description, content: s.content };
    const questions = { questions: s.questions };

    const msg = document.getElementById('builderExportMsg');
    if (msg) msg.innerHTML = '<div class="spinner" style="margin:0 auto"></div>';

    try {
      const zip = new JSZip();
      zip.file(folder + 'meta.json', JSON.stringify(meta, null, 2));
      zip.file(folder + 'questions.json', JSON.stringify(questions, null, 2));
      zip.file('ANLEITUNG.txt',
        `LearningForge — Thema-Einreichung\n` +
        `=====================================\n\n` +
        `Thema:  ${s.thema}\n` +
        `Fach:   ${s.fach}\n` +
        `Klasse: ${s.klasse}\n\n` +
        `Bitte diese ZIP-Datei per E-Mail an:\n` +
        `  simonkoper27@gmail.com\n\n` +
        `Betreff: ${s.fach} / ${s.klasse} / ${s.thema}\n\n` +
        `Der Ordnerpfad im Repository wird sein:\n` +
        `  ${folder}\n`
      );
      const blob = await zip.generateAsync({ type: 'blob' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${fach}_${klasse}_${thema}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      if (msg) msg.innerHTML = `<div class="success-msg">ZIP heruntergeladen! Bitte per Mail an <strong>simonkoper27@gmail.com</strong> schicken.</div>`;
    } catch(e) {
      if (msg) msg.innerHTML = `<div class="error-msg">Fehler: ${e.message}</div>`;
    }
  },

  // ── Builder Upload (Phase 3a, Ethan, 2026-05-08) ─────────
  // Visibility-Picker: alle drei Optionen leben in einem Block,
  // initBuilderExport rendert den Picker async (sobald userData.groupIds
  // bekannt ist, weil die "Meine Gruppe"-Option davon abhaengt).
  initBuilderExport: async () => {
    const picker = document.getElementById('builderVisPicker');
    if (!picker) return;
    picker.innerHTML = renderBuilderVisPicker();
  },

  // Picker-Click → builderState.visibility setzen + UI re-rendern (active-class
  // + Publish-Button-Label updaten). Wir re-rendern den Picker und das Label
  // gezielt, NICHT die ganze Seite (sonst gehen Step-5-Inputs verloren — gibt
  // hier zwar keine, aber konsistent mit dem Rest des Builders).
  builderSetVisibility: (vis) => {
    if (!['private', 'group', 'public'].includes(vis)) return;
    // Group nur wenn der User mindestens 1 Gruppe hat (Defense-in-depth —
    // der Disabled-State im Markup verhindert den Click bereits, aber falls
    // jemand das via Console aufruft).
    if (vis === 'group' && !(userData?.groupIds?.length)) {
      showToast('Du bist in keiner Gruppe.', 'error');
      return;
    }
    builderState.visibility = vis;
    const picker = document.getElementById('builderVisPicker');
    if (picker) picker.innerHTML = renderBuilderVisPicker();
    const btn = document.getElementById('builderVisPublishBtn');
    if (btn) {
      btn.textContent =
        vis === 'public' ? 'Für Public-Library einreichen' :
        vis === 'group'  ? 'Für Gruppe veröffentlichen'    :
                           'Privat speichern';
    }
  },

  // Master-Submit-Handler. Branch nach builderState.visibility:
  //   private → saveCustomTopic(uid, state, null, 'private')
  //   group   → Gruppe waehlen (wenn >1) + saveCustomTopic(..., groupId, 'group')
  //   public  → Modal mit Begruendungs-Textarea + Worker-Submit beim Bestaetigen.
  builderPublish: async () => {
    const v = builderState.visibility || 'private';
    if (v === 'public') {
      // Public-Pfad: erst Modal mit Erklaerung + Begruendung, dann
      // 2-Schritt-Submit (1. saveCustomTopic mit visibility='group' damit
      // der Worker einen Owner-Check bestehen kann; 2. submitTopicForApproval
      // flippt auf 'pending-approval' + queue-row).
      _openPublicSubmitModal();
      return;
    }
    if (v === 'group') {
      // Wenn der User in mehreren Gruppen ist, muessen wir auswaehlen lassen.
      // Bei genau 1 Gruppe -> direkt diese benutzen.
      const groupIds = userData?.groupIds || [];
      if (!groupIds.length) {
        showToast('Du bist in keiner Gruppe.', 'error');
        return;
      }
      if (_blockClaudeWrite('Gruppen-Uploads')) return;
      let groups;
      try { groups = await getUserGroups(groupIds); }
      catch(e) { showToast('Gruppen konnten nicht geladen werden: ' + e.message, 'error'); return; }
      if (!groups.length) {
        showToast('Du bist in keiner Gruppe.', 'error'); return;
      }
      if (groups.length === 1) {
        await window.LF._builderDoUpload(groups[0].id, groups[0].name || 'Gruppe', 'group');
        return;
      }
      // Multi-Group: kleines Inline-Picker-UI als success-msg-Replacement
      const msg = document.getElementById('builderUploadMsg');
      if (msg) {
        msg.innerHTML = `
          <div class="builder-group-picker">
            <div class="builder-group-picker-label">Welche Gruppe?</div>
            ${groups.map(g => `
              <button class="btn btn-secondary"
                      onclick="window.LF._builderDoUpload('${escapeAttr(g.id)}', '${escapeAttr(g.name || 'Gruppe')}', 'group')">
                ${escapeHtml(g.name || 'Gruppe')}
              </button>`).join('')}
          </div>`;
      }
      return;
    }
    // private
    await window.LF._builderDoUpload(null, '', 'private');
  },

  // Interner Helper — kapselt den eigentlichen saveCustomTopic-Call +
  // Toast/Spinner/Routing. Wird sowohl vom private-Pfad als auch vom
  // group-Pfad (single-group ODER nach group-pick) genutzt.
  _builderDoUpload: async (groupId, groupName, visibility) => {
    if (visibility === 'group' && _blockClaudeWrite('Gruppen-Uploads')) return;
    const msg = document.getElementById('builderUploadMsg');
    if (msg) msg.innerHTML = '<div class="spinner" style="margin:8px auto;width:20px;height:20px"></div>';
    try {
      const id = await saveCustomTopic(currentUser.uid, builderState, groupId, visibility);
      // XP nur fuer den ersten privaten Build vergeben (group + public sind
      // Folge-Aktionen). Achievement-Check macht der Worker spaeter ohnehin
      // anhand customTopicCreated-Counters.
      grantXPAndAchievements({ xp: 50, customCreated: true }).catch(console.error);
      if (msg) {
        const where = visibility === 'group'
          ? `Für Gruppe „${escapeHtml(groupName)}&ldquo; hochgeladen!`
          : 'Privat gespeichert!';
        msg.innerHTML = `<div class="success-msg">${where}
          <a onclick="location.hash='#/meine-inhalte'" style="color:var(--accent);cursor:pointer;text-decoration:underline">Jetzt in Meine Inhalte ansehen →</a></div>`;
      }
    } catch(e) {
      if (msg) msg.innerHTML = `<div class="error-msg">Fehler: ${e.message}</div>`;
    }
  },

  // Public-Submit-Modal-Aktionen ─────────────────────────────
  closePublicSubmitModal: () => {
    document.getElementById('publicSubmitModalOverlay')?.remove();
  },

  // Bestaetigungs-Click im Modal: zuerst saveCustomTopic mit visibility=
  // 'group' falls Topic noch nicht existiert (neuer-Topic-Pfad — das ist
  // der haeufige Fall: User klickt durch den Builder-Wizard und reicht
  // direkt ein), DANN submitTopicForApproval-Worker. Wir brauchen die
  // saveCustomTopic-Round-Trip damit der Worker einen Owner-Check
  // ausfuehren kann (er liest customTopics/{id}.ownerUid). Visibility
  // kommt nach dem Worker-Call auf 'pending-approval' (Worker setzt das).
  builderConfirmPublic: async () => {
    const msgArea = document.getElementById('publicSubmitModalMsg');
    const messageInput = document.getElementById('publicSubmitMessage');
    const message = messageInput?.value.trim() || '';
    const submitBtn = document.getElementById('publicSubmitConfirmBtn');
    if (submitBtn) submitBtn.disabled = true;
    if (msgArea) msgArea.innerHTML = '<div class="spinner" style="margin:8px auto;width:20px;height:20px"></div>';
    try {
      // 1. Topic anlegen — initial visibility='group' (mit groupId=null wird
      //    daraus 'private' im saveCustomTopic-Default; wir wollen aber dass
      //    der Owner es sieht, also passt 'private' gut). Owner-Check fuer
      //    den Worker funktioniert mit jedem visibility-State, der Worker
      //    flippt das selbst auf 'pending-approval'.
      const topicId = await saveCustomTopic(currentUser.uid, builderState, null, 'private');
      // 2. Worker-Submit
      await cf.submitTopicForApproval(topicId, message);
      grantXPAndAchievements({ xp: 50, customCreated: true }).catch(console.error);
      window.LF.closePublicSubmitModal();
      const msg = document.getElementById('builderUploadMsg');
      if (msg) {
        msg.innerHTML = `<div class="success-msg">Eingereicht — Simon prüft das. Du siehst den Status in
          <a onclick="location.hash='#/meine-inhalte'" style="color:var(--accent);cursor:pointer;text-decoration:underline">Meine Inhalte</a>.</div>`;
      }
      showToast('Eingereicht — Simon prüft das.', 'success');
    } catch(e) {
      if (msgArea) msgArea.innerHTML = `<div class="error-msg">Fehler: ${escapeHtml(e.message)}</div>`;
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  // Re-Submit nach Reject (von renderCustomTopicCard's "Erneut einreichen"-Button).
  // Topic existiert bereits; wir clearen die rejectionNote (damit die UI nicht
  // mehr "Abgelehnt" anzeigt) und oeffnen das Public-Submit-Modal mit
  // Topic-Re-Submit-Mode aktiv.
  resubmitForPublic: async (topicId) => {
    if (!topicId) return;
    _openPublicSubmitModal({ topicId, isResubmit: true });
  },

  // Worker-Submit fuer den Re-Submit-Pfad (Topic existiert bereits). Wird vom
  // Modal aufgerufen wenn isResubmit=true gesetzt ist.
  //
  // V-PHASE-E-03 (Marcus, 2026-05-08): die rejectionNote/rejectedAt-Felder
  // werden jetzt server-side im Worker submitTopicForApproval als Teil
  // des atomaren Batches geclearet (set+merge mit null). Der frontend-side
  // clearRejectionNote-Wrapper wurde entfernt — die Audit-Trail-Felder
  // sind jetzt rules-mäßig nur fuer den Worker schreibbar.
  builderConfirmResubmit: async (topicId) => {
    const msgArea = document.getElementById('publicSubmitModalMsg');
    const messageInput = document.getElementById('publicSubmitMessage');
    const message = messageInput?.value.trim() || '';
    const submitBtn = document.getElementById('publicSubmitConfirmBtn');
    if (submitBtn) submitBtn.disabled = true;
    if (msgArea) msgArea.innerHTML = '<div class="spinner" style="margin:8px auto;width:20px;height:20px"></div>';
    try {
      await cf.submitTopicForApproval(topicId, message);
      window.LF.closePublicSubmitModal();
      showToast('Erneut eingereicht — Simon prüft das.', 'success');
      renderMyContent();
    } catch(e) {
      if (msgArea) msgArea.innerHTML = `<div class="error-msg">Fehler: ${escapeHtml(e.message)}</div>`;
      if (submitBtn) submitBtn.disabled = false;
    }
  },

  // ── Custom Topic ────────────────────────
  ctSwitchTab: (name) => {
    ['Lernen','Test'].forEach(t => {
      document.getElementById(`ctTab${t}`)?.style.setProperty('display', t === name ? 'block' : 'none');
      document.getElementById(`ctTabBtn${t}`)?.classList.toggle('active', t === name);
    });
  },

  startCustomTest: () => {
    if (!customTopicData) return;
    const raw = customTopicData.questions || [];
    if (!raw.length) { showToast('Keine Fragen in diesem Thema.', 'error'); return; }
    // F-09: Pre-Test-Konfidenz-Step (custom-Test). Container = ctTestArea.
    // Fallback-Container = testArea (wenn renderActiveTest erst spaeter mountet).
    _pendingConfidence = null;
    const _ctArea = document.getElementById('ctTestArea') || document.getElementById('testArea');
    _renderConfidencePreTest(_ctArea, (confidence) => {
      _pendingConfidence = confidence;
      // MC-Optionen mischen + shuffledCorrectIndex setzen, sonst marked evaluateAnswers
      // alle MC-Antworten als falsch (parseInt(answer) === undefined → false).
      const questions = raw.map(q => {
        if (q.type === 'multiple_choice' && Array.isArray(q.options)) {
          const indexed = q.options.map((opt, i) => ({ opt, correct: i === q.correct }));
          for (let i = indexed.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
          }
          return {
            ...q,
            shuffledOptions:      indexed.map(x => x.opt),
            shuffledCorrectIndex: indexed.findIndex(x => x.correct),
            points: q.points || 2
          };
        }
        return { ...q, maxPoints: q.maxPoints || 4 };
      });
      const fakeSubject = { name: customTopicData.fach || 'Eigene Inhalte' };
      const fakeTopic   = { name: customTopicData.thema || 'Unbenannt' };
      renderActiveTest(questions, 30, '_custom', '_custom', customTopicData.id, fakeSubject, fakeTopic);
    });
  },

  deleteCustomTopicUI: async (topicId) => {
    if (!confirm('Thema wirklich löschen?')) return;
    try {
      await deleteCustomTopic(topicId);
      showToast('Thema gelöscht.', 'success');
      renderMyContent();
    } catch(e) {
      showToast('Fehler: ' + e.message, 'error');
    }
  },

  retryVocabWrong: () => {
    const wrongCards = vocabState.wrong.map(w => w.card);
    for (let i = wrongCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wrongCards[i], wrongCards[j]] = [wrongCards[j], wrongCards[i]];
    }
    vocabState = { allCards: vocabState.allCards, cards: wrongCards, index: 0, correct: 0, wrong: [] };
    document.getElementById('tabVokabeln').innerHTML = renderVocabCard();
    document.getElementById('vocabInput')?.focus();
  },

  selectTime: (t) => {
    selectedTime = t;
    TIME_OPTIONS.forEach(opt => {
      document.getElementById(`timeBtn${opt}`)?.classList.toggle('active', opt === t);
    });
    const hint = document.getElementById('timeHint');
    if (hint) hint.textContent = getTimeConfig(t).textExpectation;
  },
  startTest: async (subjectId, yearId, topicId) => {
    if (subjectId === '_custom') {
      if (!customTopicData || customTopicData.id !== topicId) {
        customTopicData = await getCustomTopicById(topicId);
      }
      window.LF.startCustomTest();
      return;
    }
    // F-09 Cycle-6: Konfidenz-Pre-Test-Step. Zwischen "Test beginnen" und
    // dem Spinner zeigen wir die Sterne-Karte. Skip → confidence=null.
    // Nach Pick: wir rendern den Spinner und laufen den existing Pfad weiter.
    _pendingConfidence = null;           // Sauber: Reset vor jedem neuen Pre-Test
    const _testAreaForConf = document.getElementById('testArea');
    _renderConfidencePreTest(_testAreaForConf, async (confidence) => {
      _pendingConfidence = confidence;   // 1..5 oder null
      const subject = structure[subjectId];
      const topic   = subject.years[yearId].topics[topicId];

      const testAreaEl = document.getElementById('testArea');
      if (testAreaEl) testAreaEl.innerHTML = `
        <div style="text-align:center;padding:60px">
          <div class="spinner" style="margin:0 auto 20px"></div>
          <p>Fragen werden generiert…</p>
        </div>`;

      let questions = null;
      const meta = await getTopicMeta(subjectId, yearId, topicId);
      const contentForGemini = meta.subtopics?.length > 0
        ? meta.subtopics.map(st => st.content).join(' ')
        : meta.content;
      if (contentForGemini) {
        questions = await generateQuestionsWithGemini(contentForGemini, selectedTime);
      }
      if (!questions || questions.length === 0) {
        const allQ = await getTopicQuestions(subjectId, yearId, topicId);
        questions  = selectQuestions(allQ, selectedTime);
      }

      renderActiveTest(questions, selectedTime, subjectId, yearId, topicId, subject, topic);
    });
  },

  switchTab: (name) => {
    ['Lernen','Ueben','Test','Karten','Vokabeln','Kommentare'].forEach(t => {
      document.getElementById(`tab${t}`)?.style.setProperty('display', t === name ? 'block' : 'none');
      document.getElementById(`tabBtn${t}`)?.classList.toggle('active', t === name);
    });
    if (name === 'Kommentare') window.LF.loadComments();
  },

  startUeben: async (subjectId, yearId, topicId) => {
    const all = await getTopicQuestions(subjectId, yearId, topicId);
    const questions = [...all].sort(() => Math.random() - 0.5).map(q => {
      if (q.type === 'multiple_choice' && q.options) {
        const indexed = q.options.map((opt,i) => ({ opt, correct: i === q.correct }));
        indexed.sort(() => Math.random() - 0.5);
        return { ...q, shuffledOptions: indexed.map(x=>x.opt), shuffledCorrectIndex: indexed.findIndex(x=>x.correct) };
      }
      return q;
    });
    uebenState = { questions, current: 0, correct: 0 };
    renderUebenQuestion();
  },

  checkUebenMC: (selectedIdx) => {
    const q    = uebenState.questions[uebenState.current];
    const ok   = selectedIdx === q.shuffledCorrectIndex;
    if (ok) uebenState.correct++;
    document.querySelectorAll('.ueben-mc-option').forEach((el, i) => {
      el.style.pointerEvents = 'none';
      if (i === q.shuffledCorrectIndex) el.classList.add('ueben-correct');
      else if (i === selectedIdx && !ok) el.classList.add('ueben-wrong');
    });
    document.getElementById('uebenFeedback').innerHTML =
      `<div class="ueben-feedback-box ${ok?'ok':'fail'}">${ok ? 'Richtig!' : `Falsch. Richtige Antwort: <strong>${escapeHtml(q.shuffledOptions[q.shuffledCorrectIndex] || '')}</strong>`}</div>`;
    document.getElementById('uebenNext').style.display = 'block';
  },

  checkUebenText: () => {
    const q      = uebenState.questions[uebenState.current];
    const answer = document.getElementById('uebenTextarea')?.value?.trim() || '';
    document.getElementById('uebenFeedback').innerHTML =
      `<div class="ueben-feedback-box info">
        ${q.sampleAnswer ? `<strong>Musterantwort:</strong><br>${escapeHtml(q.sampleAnswer)}` : 'Vergleiche deine Antwort mit dem Lerninhalt.'}
      </div>`;
    document.getElementById('uebenNext').style.display = 'block';
    document.getElementById('uebenCheckBtn').style.display = 'none';
  },

  nextUeben: () => {
    uebenState.current++;
    if (uebenState.current >= uebenState.questions.length) {
      const total = uebenState.questions.length;
      const mcQ   = uebenState.questions.filter(q=>q.type==='multiple_choice').length;
      document.getElementById('uebenArea').innerHTML = `
        <div style="text-align:center;padding:32px">
          <div style="font-size:48px;margin-bottom:16px">Fertig!</div>
          <p style="font-size:18px;font-weight:700">${uebenState.correct} von ${mcQ} Multiple-Choice-Fragen richtig</p>
          <p style="color:var(--text-muted);margin-top:8px">Mache den Test, wenn du dich bereit fühlst.</p>
          <div style="display:flex;gap:12px;justify-content:center;margin-top:24px">
            <button class="btn btn-primary" onclick="window.LF.switchTab('Test')">Zum Test</button>
            <button class="btn btn-secondary" onclick="window.LF.startUeben('${uebenState.questions[0]?.__subjectId||''}','','')">Nochmal üben</button>
          </div>
        </div>`;
      return;
    }
    renderUebenQuestion();
  },

  resetAllGrades: async () => {
    if (!confirm('Alle Statistiken und Noten wirklich löschen?')) return;
    if (userData) userData.grades = {};
    try {
      await db().collection('users').doc(currentUser.uid).set({ grades: {} }, { merge: true });
      await resetLeaderboard(currentUser.uid);
      showToast('Statistiken und Rangliste zurückgesetzt.', 'success');
    } catch (e) {
      console.error('Reset-Fehler:', e);
      showToast('Fehler: ' + (e.message || e.code || 'Unbekannt'), 'error');
    }
    renderProfile();
  },

  downloadPDF: () => window.print(),

  openSubtopic: (idx) => {
    const st = currentSubtopics?.[idx];
    if (!st) return;
    const grid = document.getElementById('subtopicGrid');
    if (!grid) return;
    // Phase-1: Subtopics haben jetzt blocks[]. Block-Renderer entscheidet pro
    // Block-Type (text/formula/image/code/widget). Backwards-Compat ueber
    // getSubtopics() — wenn Legacy-Subtopic-Array reinkam, wurde content
    // bereits in einen text-Block gewrappt.
    grid.innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="window.LF.closeSubtopic()" style="margin-bottom:16px">
        ← Zurück zur Übersicht
      </button>
      <div class="subtopic-detail">
        <h2 class="subtopic-detail-title">${escapeHtml(st.name || '')}</h2>
        <div class="content-body">${renderBlocks(st.blocks)}</div>
      </div>`;
    // Physik-Simulationen ggf. initialisieren
    initPhysikSimulations(grid.querySelector('.content-body'));
    grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  closeSubtopic: () => {
    if (!currentSubtopics) return;
    const grid = document.getElementById('subtopicGrid');
    if (!grid) return;
    grid.innerHTML = currentSubtopics.map((st, i) => `
      <div class="subtopic-card" onclick="window.LF.openSubtopic(${i})">
        <div class="subtopic-index">${i + 1}</div>
        <div class="subtopic-info">
          <div class="subtopic-name">${escapeHtml(st.name || '')}</div>
          ${st.description ? `<div class="subtopic-desc">${escapeHtml(st.description)}</div>` : ''}
        </div>
        <div class="subtopic-arrow">›</div>
      </div>`).join('');
  }
});

// ── Mission 1 — Neue window.LF-Handler ────────────────────

// Profil-Tab-Switch
window.LF.switchProfileTab = (tab) => {
  // Update Hash mit ?tab=xy. route() greift dann renderProfile() → liest tab.
  const allowed = ['uebersicht','stats','selbsteinschaetzung','erfolge','inventar'];
  const safe = allowed.includes(tab) ? tab : 'uebersicht';
  location.hash = `#/profil?tab=${safe}`;
};

// ── Cycle-3 Settings-Page Handlers ────────────────────────
// Maya-Spec: settings-page-refactor-implementation.md
// Persistenz-Pattern: alle settings-Writes via set+merge auf userData.settings
// (Hard-Rule 4 — kein update()). Optimistic-UI: in-memory userData zuerst,
// dann Worker/Firestore async. Toast nach erfolgreicher Mutation.

async function _persistSettings(partial) {
  if (!currentUser) return;
  userData = userData || {};
  userData.settings = { ...(userData.settings || {}), ...partial };
  try {
    await db().collection('users').doc(currentUser.uid).set({
      settings: partial
    }, { merge: true });
  } catch (e) {
    console.warn('[settings] persist failed', e);
    showToast('Offline — wird später gespeichert.', 'warn');
  }
}

async function _persistTopLevel(partial) {
  if (!currentUser) return;
  userData = userData || {};
  Object.assign(userData, partial);
  try {
    await db().collection('users').doc(currentUser.uid).set(partial, { merge: true });
  } catch (e) {
    console.warn('[settings] persist top-level failed', e);
    showToast('Offline — wird später gespeichert.', 'warn');
  }
}

window.LF.switchSettingsTab = (tab) => {
  const allowed = ['darstellung','lernen','anpassung','konto'];
  const safe = allowed.includes(tab) ? tab : 'darstellung';
  location.hash = `#/einstellungen?tab=${safe}`;
};

// Tab 1 — Darstellung
window.LF.settingsSaveThemeMode = (mode) => {
  const allowed = ['light','dark','system'];
  if (!allowed.includes(mode)) return;
  _applyThemeMode(mode);
  _persistSettings({ themeMode: mode });
  showToast('Gespeichert.', 'success');
  // Re-render so the radios reflect the new selection.
  if (location.hash.startsWith('#/einstellungen')) renderSettings();
};

window.LF.settingsSaveCosmeticTheme = (themeId) => {
  const valid = THEMES.find(t => t.id === themeId);
  if (!valid) return;
  applyTheme(themeId);
  _persistSettings({ cosmeticTheme: themeId });
  // Live-Preview-Kachel synchron halten (data-app-theme).
  const preview = document.getElementById('settingsCosmeticPreview');
  if (preview) preview.setAttribute('data-app-theme', themeId);
  showToast('Theme angewendet.', 'success');
};

window.LF.settingsSaveFontSize = (size) => {
  const allowed = ['normal','large','xlarge'];
  if (!allowed.includes(size)) return;
  _applyFontSizeScale(size);
  _persistSettings({ fontSize: size });
  showToast('Schriftgröße aktualisiert.', 'success');
  if (location.hash.startsWith('#/einstellungen')) renderSettings();
};

window.LF.settingsSaveReducedMotion = (on) => {
  const v = !!on;
  _applyReducedMotion(v);
  _persistSettings({ reducedMotion: v });
  showToast('Gespeichert.', 'success');
};

// Tab 2 — Lernen
window.LF.settingsSaveDailyReminder = (val) => {
  // Erlaubt: leer (= aus) oder HH:MM 24h.
  const isEmpty = !val || val === '';
  const reMatch = /^([0-1]\d|2[0-3]):[0-5]\d$/.test(val || '');
  if (!isEmpty && !reMatch) { showToast('Ungültige Uhrzeit.', 'error'); return; }
  _persistSettings({ dailyReminderTime: isEmpty ? '' : val });
  showToast(isEmpty ? 'Erinnerung aus.' : 'Erinnerung gespeichert.', 'success');
  if (location.hash.startsWith('#/einstellungen')) renderSettings();
};

window.LF.settingsSaveStreakWarn = (val) => {
  const h = parseInt(val, 10);
  if (!Number.isFinite(h) || h < 0 || h > 23) return;
  _persistSettings({ streakWarnThreshold: h });
  showToast('Gespeichert.', 'success');
};

window.LF.settingsSaveDefaultKlasse = (val) => {
  const allowed = ['auto','5','6','7','8','9','10','11','12','13'];
  if (!allowed.includes(String(val))) return;
  _persistSettings({ defaultKlasseFilter: String(val) });
  showToast('Gespeichert.', 'success');
};

// Toggle-Semantik in der UI ist "Fach-Themes AN" (Default=AN).
// Gespeichertes Feld ist subjectThemesOff (legacy, invertiert).
window.LF.settingsSaveSubjectThemesOn = (on) => {
  const off = !on;
  if (off) document.body.classList.add('subject-themes-off');
  else     document.body.classList.remove('subject-themes-off');
  _persistSettings({ subjectThemesOff: off });
  showToast(on ? 'Fach-Themes aktiviert.' : 'Fach-Themes aus.', 'success');
  if (location.hash.startsWith('#/einstellungen')) renderSettings();
};

window.LF.settingsSaveSubjectColor = (subjectId, slug) => {
  if (!USER_SUBJECT_COLOR_SLUGS.includes(slug)) return;
  const map = { ...(userData?.settings?.subjectColors || {}) };
  map[subjectId] = slug;
  // Live-Override im DOM (Layer 4): root-Subject-Card muss data-user-subject-color
  // bekommen — Re-Render der Page deckt das ab. Plus: Layer-2 Subject-Tokens-Cascade
  // greift erst auf Subject-/Year-Routes; hier in Settings reicht Re-Render.
  _persistSettings({ subjectColors: map });
  showToast('Fach-Farbe gespeichert.', 'success');
  // Nur die Row neu rendern wuerde State-Drift erzeugen — voller Page-Render ist sauberer.
  if (location.hash.startsWith('#/einstellungen')) renderSettings();
};

window.LF.settingsResetSubjectColor = async (subjectId) => {
  // Sophie-Cycle-3-fix: set+merge merges nested map keys leaf-by-leaf — der
  // alte `delete map[id]; set+merge({subjectColors: map})`-Pfad hatte keinen
  // Loesch-Effekt auf Firestore (lokale userData wirkte korrekt, aber Reload
  // brachte den Slug zurueck). FieldValue.delete() entfernt die Key explizit.
  if (!currentUser) return;
  userData = userData || {};
  userData.settings = userData.settings || {};
  userData.settings.subjectColors = { ...(userData.settings.subjectColors || {}) };
  delete userData.settings.subjectColors[subjectId];
  try {
    await db().collection('users').doc(currentUser.uid).set({
      settings: { subjectColors: { [subjectId]: firebase.firestore.FieldValue.delete() } }
    }, { merge: true });
  } catch (e) {
    console.warn('[settingsResetSubjectColor]', e);
    showToast('Offline — wird später gespeichert.', 'warn');
  }
  showToast('Auf Standard zurückgesetzt.', 'info');
  if (location.hash.startsWith('#/einstellungen')) renderSettings();
};

window.LF.settingsResetAllSubjectColors = async () => {
  if (!confirm('Alle Fach-Farben auf Standard zurücksetzen?')) return;
  // Sophie-Cycle-3-fix: set+merge mit `{}` ist ein No-Op (merge erhaelt
  // bestehende Keys). Pro-Key FieldValue.delete-Sentinel zwingt Firestore,
  // jeden Key zu entfernen.
  if (!currentUser) return;
  const existing = userData?.settings?.subjectColors || {};
  const deletes = {};
  for (const k of Object.keys(existing)) deletes[k] = firebase.firestore.FieldValue.delete();
  userData = userData || {};
  userData.settings = userData.settings || {};
  userData.settings.subjectColors = {};
  try {
    await db().collection('users').doc(currentUser.uid).set({
      settings: { subjectColors: deletes }
    }, { merge: true });
  } catch (e) {
    console.warn('[settingsResetAllSubjectColors]', e);
    showToast('Offline — wird später gespeichert.', 'warn');
  }
  showToast('Alle Fach-Farben zurückgesetzt.', 'info');
  if (location.hash.startsWith('#/einstellungen')) renderSettings();
};

// Tab 3 — Anpassung
window.LF.settingsAvatarFile = async (input) => {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 1024 * 1024) {
    showToast('Bild zu groß — max 1 MB.', 'error');
    input.value = '';
    return;
  }
  try {
    const dataUrl = await _resizeProfileImage(file, 512);
    await updateUserProfile(currentUser.uid,
      userData?.name || currentUser.displayName || 'Nutzer',
      dataUrl
    );
    userData.photoURL = dataUrl;
    showToast('Avatar aktualisiert.', 'success');
    renderSettings();
  } catch (e) {
    showToast(e.message || 'Bild konnte nicht geladen werden.', 'error');
  }
  input.value = '';
};

window.LF.settingsRemoveAvatar = async () => {
  if (!currentUser) return;
  if (!confirm('Profilbild entfernen?')) return;
  try {
    await updateUserProfile(currentUser.uid,
      userData?.name || currentUser.displayName || 'Nutzer',
      null
    );
    userData.photoURL = null;
    showToast('Profilbild entfernt.', 'success');
    renderSettings();
  } catch (e) {
    console.error('[settingsRemoveAvatar]', e);
    showToast('Fehler beim Entfernen.', 'error');
  }
};

window.LF.settingsSaveDisplayName = async () => {
  const input = document.getElementById('settingsDisplayName');
  const btn   = document.getElementById('settingsDisplayNameSaveBtn');
  if (!input) return;
  const name = (input.value || '').trim();
  if (name.length < 2 || name.length > 24) {
    showToast('Name muss zwischen 2 und 24 Zeichen haben.', 'error');
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Speichern…'; }
  try {
    await updateUserProfile(currentUser.uid, name, userData?.photoURL || null);
    userData.name = name;
    showToast('Name aktualisiert.', 'success');
  } catch (e) {
    console.error('[settingsSaveDisplayName]', e);
    showToast('Fehler beim Speichern.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Speichern'; }
  }
};

// Auto-Save-on-blur: nur wenn Wert sich tatsaechlich geaendert hat UND valide
// ist. Sonst still — kein Toast-Spam, wenn der User nur draufklickt und wieder
// raus.
window.LF.settingsSaveDisplayNameIfChanged = () => {
  const input = document.getElementById('settingsDisplayName');
  if (!input) return;
  const name = (input.value || '').trim();
  const current = (userData?.name || currentUser?.displayName || '').trim();
  if (name === current) return;
  if (name.length < 2 || name.length > 24) return;
  window.LF.settingsSaveDisplayName();
};

window.LF.settingsSaveDefaultOutline = (val) => {
  // Speichert nur die Praeferenz. Aktiv-Outline-Switch laeuft via
  // window.LF.selectOutline (Server-Unlock-Path). Hier nur Default-Hint.
  _persistSettings({ defaultOutline: val || '' });
  showToast('Standard-Outline gespeichert.', 'success');
};

// Tab 4 — Konto
window.LF.settingsRequestPasswordReset = async () => {
  const email = currentUser?.email;
  if (!email) { showToast('Keine E-Mail-Adresse.', 'error'); return; }
  try {
    await firebase.auth().sendPasswordResetEmail(email);
    showToast('E-Mail mit Reset-Link gesendet.', 'success');
  } catch (e) {
    console.error('[settingsRequestPasswordReset]', e);
    showToast('Konnte E-Mail nicht senden — versuche es später nochmal.', 'error');
  }
};

window.LF.settingsExportData = () => {
  try {
    const payload = _buildUserExport();
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const date = new Date().toISOString().slice(0, 10);
    a.download = `learningforge-export-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast('Datei wird heruntergeladen…', 'success');
  } catch (e) {
    console.error('[settingsExportData]', e);
    showToast('Export fehlgeschlagen.', 'error');
  }
};

// Inverted-Toggle (Casey F-9): UI zeigt Visibility-State ("auf Rangliste sichtbar"),
// Schema speichert Hidden-State (`lbHidden: true` = nicht sichtbar).
// Im Markup: `checked` wenn !lbHidden (sichtbar), onchange ruft mit !this.checked
// (= hidden) auf. Hier dann einfach 1:1 schreiben.
window.LF.settingsSaveLbHidden = (hidden) => {
  _persistTopLevel({ lbHidden: !!hidden });
  showToast(hidden ? 'Du bist nicht mehr auf Ranglisten sichtbar.' : 'Du erscheinst wieder auf Ranglisten.', 'info');
};

window.LF.settingsLogout = async () => {
  if (isTestActive()) _abortActiveTest();
  _teardownMidTestGuards();
  await logout();
  location.hash = '#/';
};

window.LF.settingsOpenDeleteModal = () => {
  if (_blockClaudeWrite('Konto löschen')) return;
  _openSettingsDeleteModal();
};

window.LF.settingsDeleteOnConfirmInput = (val) => {
  const expected = userData?.name || currentUser?.displayName || 'Nutzer';
  const btn = document.getElementById('settingsDeleteConfirmBtn');
  if (!btn) return;
  btn.disabled = (val !== expected);
};

window.LF.settingsCancelDelete = () => {
  _closeSettingsDeleteModal();
};

window.LF.settingsStartDeleteCountdown = () => {
  if (!_settingsDeleteState) return;
  _settingsDeleteState.phase = 'countdown';
  // GDPR-Soft-Win: 30s Countdown statt 10s — Soft-Delete (7-Tage-Recovery)
  // ist Mission-13-Maya-Spec-Kandidat, hier nur die Wartezeit erhoeht.
  _settingsDeleteState.countdown = 30;
  _renderSettingsDeleteModalContent();
  _settingsDeleteState.interval = setInterval(() => {
    if (!_settingsDeleteState) return;
    _settingsDeleteState.countdown -= 1;
    if (_settingsDeleteState.countdown <= 0) {
      clearInterval(_settingsDeleteState.interval);
      _settingsDeleteState.interval = null;
      window.LF.settingsConfirmDelete();
    } else {
      _renderSettingsDeleteModalContent();
    }
  }, 1000);
};

window.LF.settingsConfirmDelete = async () => {
  if (!_settingsDeleteState) return;
  // Race-Frei: Cancel-Knopf wird im Countdown-State noch angezeigt — wenn der
  // User in der letzten Sekunde cancelt, schliesst _closeSettingsDeleteModal()
  // den Interval und _settingsDeleteState wird null, dann no-op.
  const overlay = document.getElementById('settingsDeleteOverlay');
  if (overlay) {
    overlay.innerHTML = `
      <div class="lf-modal-card">
        <div class="lf-modal-body" style="text-align:center;padding:24px">
          <div class="spinner" style="margin:0 auto 12px"></div>
          <p>Konto wird gelöscht…</p>
        </div>
      </div>`;
  }
  try {
    // Worker-only-Plan (Marcus, 2026-05-08): cf.deleteAccount() macht jetzt
    // Firestore-Wipe + Auth-User-Delete atomar serverseitig (Identity-Toolkit
    // via Service-Account). Frontend macht KEIN currentUser.delete() mehr —
    // das wuerde das Token vorher invalidieren und cf.deleteAccount() in 401
    // laufen lassen, sodass der Firestore-Wipe nie passiert.
    await cf.deleteAccount(userData?.name || currentUser?.displayName || '');
    // Lokales Token clearen — Auth-User ist serverseitig schon weg.
    try { await logout(); } catch (_) { /* token already invalid is fine */ }
    _closeSettingsDeleteModal();
    showToast('Konto gelöscht.', 'success');
    location.hash = '#/';
  } catch (e) {
    console.error('[settingsConfirmDelete]', e);
    showToast('Löschen fehlgeschlagen — bitte erneut versuchen.', 'error');
    _closeSettingsDeleteModal();
  }
};

// Achievement-Modal öffnen
window.LF.openAchievement = (id) => {
  const a = ACHIEVEMENTS.find(x => x.id === id);
  if (!a) return;
  const achieved = new Set(userData?.achievements || []);
  const unlocked = achieved.has(a.id);

  // Progress berechnen, falls progress() definiert
  let progressHtml = '';
  if (typeof a.progress === 'function') {
    try {
      const ctx = { streak: calcStreak() };
      const p = a.progress(userData || {}, ctx);
      if (p && p.total > 0) {
        const pct = Math.min(100, Math.round((p.current / p.total) * 100));
        progressHtml = `
          <div class="ach-modal-progress">
            <div class="ach-modal-progress-label">Fortschritt: ${p.current} / ${p.total}</div>
            <div class="ach-modal-progress-bar">
              <div class="ach-modal-progress-fill" style="width:${pct}%;background:${a.color}"></div>
            </div>
            <div class="ach-modal-progress-pct">${pct}%</div>
          </div>`;
      }
    } catch(e) { /* silent */ }
  }

  const overlay = document.createElement('div');
  overlay.className = 'lf-modal-overlay';
  overlay.id = 'achievementModalOverlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="lf-modal-card">
      <div class="lf-modal-header">
        <h3>${escapeHtml(a.title)}</h3>
        <button class="btn-icon" onclick="window.LF.closeAchievement()">${lfIcon('x')}</button>
      </div>
      <div class="lf-modal-body" style="text-align:center">
        <div class="ach-modal-code" style="${unlocked ? `background:${a.color};color:#fff` : ''}">${a.iconName ? lfIcon(a.iconName) : escapeHtml(a.code)}</div>
        <div class="ach-modal-xp" style="color:${unlocked ? a.color : 'var(--text-muted)'}">+${a.xp} XP</div>
        <div class="ach-modal-desc">${escapeHtml(a.longDesc || a.desc)}</div>
        ${progressHtml}
        <div class="ach-modal-status">
          Status: ${unlocked ? `${lfIcon('check', {cls:'sx-correct'})} Freigeschaltet` : `${lfIcon('lock')} Noch nicht freigeschaltet`}
        </div>
      </div>
      <div class="lf-modal-actions">
        <button class="btn btn-primary" onclick="window.LF.closeAchievement()">Schließen</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
};
window.LF.closeAchievement = () => {
  document.getElementById('achievementModalOverlay')?.remove();
};

// Achievement-Filter (Erfolge-Tab)
window.LF.setAchFilter = (f) => {
  window.LF._achFilter = f;
  // Tab neu rendern
  if ((_hashParam('tab') || 'uebersicht') === 'erfolge') renderProfile();
};

// Leaderboard-Tab-Switch (Mission 1: klasse / global / fach)
window.LF.switchLbTab = (tab) => {
  window.LF._lbTab = tab;
  renderLeaderboard();
};

// Lernen-Hub: Live-Filter-Suche.
// V-04 (Casey/Cycle-3): kombiniert mit Klassen-Filter via data-search-match
// + data-class-match. CSS hidet Karten wenn EINER der beiden Filter "0" ist.
window.LF.filterLernenGrid = (q) => {
  const ql = String(q || '').toLowerCase().trim();
  const grid = document.getElementById('lernenSubjectsGrid');
  if (!grid) return;
  grid.querySelectorAll('.subject-card').forEach(card => {
    const name = card.querySelector('.s-name')?.textContent?.toLowerCase() || '';
    const match = !ql || name.includes(ql);
    card.setAttribute('data-search-match', match ? '1' : '0');
  });
};

// V-04 (Casey/Cycle-3): Toggle "Nur meine Klasse" / "Alle Klassen".
// Persistiert in localStorage (key 'lf:lernenFilterMyClassOnly'), kein
// Firestore-Sync (Casey: ergonomic preference). Re-rendert die aktuelle Seite
// via route() (gleicher Hash → Subject-Year-Grid bleibt, neu gefiltert).
window.LF.toggleLernenKlassenFilter = (value) => {
  try { localStorage.setItem('lf:lernenFilterMyClassOnly', value === '1' ? '1' : '0'); }
  catch {}
  route();
};

// ── Onboarding-Wizard-Handler ─────────────
// Bug E (Casey #3): existingMissingKlasse korrekt durchreichen.
// Wenn Bestands-User mit onboardedAt aber ohne Klasse den Wizard via Hilfe
// re-triggert, soll die Bestands-Logik (skipSteps:[1,3]) greifen.
window.LF.openOnboarding = (fromStep) => renderOnboarding({
  fromStep,
  existingMissingKlasse: !!userData?.onboardedAt && !userData?.klasse
});

// Hilfsfunktion: Name aus DOM einsammeln, bevor ein Re-Render den Input
// clobbed. Bug C (Casey #1) — name verschwindet beim Klassen-Klick.
function _collectOnboardingState() {
  if (!_onboardingState) return;
  const nameEl = document.getElementById('onbName');
  if (nameEl && typeof nameEl.value === 'string' && nameEl.value.trim()) {
    _onboardingState.name = nameEl.value.trim();
  }
}

window.LF.onboardingNext = async () => {
  const s = _onboardingState;
  if (!s) return;
  if (s.step === 2) {
    const nameEl = document.getElementById('onbName');
    const name = nameEl?.value?.trim() || '';
    const errEl = document.getElementById('onbStep2Err');
    if (name.length < 2) {
      if (errEl) { errEl.textContent = 'Bitte gib einen Namen ein (mindestens 2 Buchstaben).'; errEl.style.display = 'block'; }
      return;
    }
    if (!s.klasse) {
      if (errEl) { errEl.textContent = 'Bitte wähle deine Klasse.'; errEl.style.display = 'block'; }
      return;
    }
    s.name = name;
  }
  // Nächster Schritt — skip skippable
  let next = s.step + 1;
  while (s.skipSteps.includes(next) && next < 4) next++;
  s.step = Math.min(next, 4);
  _renderOnboardingStep();
};
window.LF.onboardingBack = () => {
  const s = _onboardingState;
  if (!s) return;
  _collectOnboardingState();
  let prev = s.step - 1;
  while (s.skipSteps.includes(prev) && prev > 1) prev--;
  s.step = Math.max(prev, 1);
  _renderOnboardingStep();
};
// Red-Team #10: Defense-in-depth Klassen-Validator. Onboarding-Wizard rendert
// nur 5..13 als Buttons, aber window.LF.onboardingPickKlasse ist ein globaler
// Handler — Hacker koennten window.LF.onboardingPickKlasse('GOAT') von der
// Konsole aufrufen. Realer Fix in firestore.rules (Marcus).
const _ALLOWED_KLASSEN = ['5','6','7','8','9','10','11','12','13'];
window.LF.onboardingPickKlasse = (k) => {
  if (!_onboardingState) return;
  const v = String(k);
  if (!_ALLOWED_KLASSEN.includes(v)) {
    showToast('Ungueltige Klasse — erlaubt sind 5 bis 13.', 'error');
    return;
  }
  // Bug C: Name aus DOM einsammeln BEVOR der Re-Render den Input clobbed.
  _collectOnboardingState();
  _onboardingState.klasse = v;
  _renderOnboardingStep();
};
// Mission 8 Q1=C: window.LF.onboardingPickEmoji entfernt (Emoji-Picker abgeschafft).
window.LF.onboardingHandleFile = async (input) => {
  if (!_onboardingState) return;
  const file = input.files?.[0];
  if (!file) return;
  _collectOnboardingState();
  const dataUrl = await _resizeToDataUrl(file);
  if (dataUrl) {
    _onboardingState.photoURL = dataUrl;
    _renderOnboardingStep();
  } else {
    showToast('Bild konnte nicht geladen werden.', 'error');
  }
};
// Skip-step-3 (Avatar) — alter Behavior: nur den Avatar-Schritt überspringen,
// Wizard läuft auf Step 4 weiter. Wird vom „Überspringen"-Button auf Step 3 verwendet.
window.LF.onboardingSkip = () => {
  if (_onboardingState) {
    _onboardingState.photoURL = null;
    _onboardingState.step = 4;
  }
  _renderOnboardingStep();
};
// Wave-4 (Maya/Bereich-5): explizit "Standard-Avatar nutzen"-Variante.
// Effektiv identisch zum Skip (kein photoURL persistiert), aber Wizard
// laeuft als Folgeschritt-Step weiter — User sieht den naechsten Step,
// nicht "fertig".
window.LF.onboardingUseDefaultAvatar = () => {
  if (_onboardingState) {
    _onboardingState.photoURL = null;
  }
  window.LF.onboardingNext();
};
// Bug D: SkipAll — kompletter Wizard-Abbruch. Persistiert tourSkippedAt
// (blockt Tour-Auto-Trigger dauerhaft) + markOnboarded. Wird vom X-Button und
// Step-1/2-Skip verwendet.
window.LF.onboardingSkipAll = async () => {
  try {
    if (currentUser?.uid) {
      try {
        await db().collection('users').doc(currentUser.uid).set({
          tourSkippedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        if (userData) userData.tourSkippedAt = Date.now();
      } catch(e) { console.warn('[wizard-skip-tourField]', e); }
      await markOnboarded(currentUser.uid).catch(e => console.warn('[wizard-skip-onboard]', e));
      if (userData) userData.onboardedAt = Date.now();
    }
  } catch(e) { console.warn('[wizard-skipAll]', e); }
  document.getElementById('onboardingOverlay')?.remove();
  _onboardingState = null;
  if (location.hash !== '#/' && location.hash !== '#') {
    location.hash = '#/';
  } else {
    route();
  }
};
window.LF.onboardingFinish = async (target) => {
  const s = _onboardingState;
  if (!s) return;
  // Speichern: name, klasse, photoURL, onboardedAt
  try {
    if (currentUser?.uid) {
      await setUserKlasse(currentUser.uid, s.klasse);
      const patch = {};
      if (s.name && s.name !== userData?.name) patch.name = s.name;
      if (s.photoURL && s.photoURL !== userData?.photoURL) patch.photoURL = s.photoURL;
      if (Object.keys(patch).length) {
        try { await updateUserProfile(currentUser.uid, s.name, s.photoURL); } catch(e) { console.warn('[onboarding-profile]', e); }
      }
      await markOnboarded(currentUser.uid);
      // Locale State syncen
      userData = { ...(userData || {}), name: s.name, klasse: s.klasse, photoURL: s.photoURL, onboardedAt: Date.now() };
    }
  } catch(e) {
    console.error('[onboarding-save]', e);
    showToast('Konnte nicht speichern, versuch\'s später nochmal.', 'error');
  }
  document.getElementById('onboardingOverlay')?.remove();
  _onboardingState = null;
  if (target === 'tour') {
    // Mission 4: Wizard-Schritt 4 → Tour-Einstieg.
    location.hash = '#/'; route();
    setTimeout(() => { try { window.LF.startTour(); } catch(e) { console.warn('[onb-tour-start]', e); } }, 500);
  } else if (target === 'profil') {
    location.hash = '#/profil';
  } else {
    location.hash = '#/'; route();
  }
};

// ── Admin-User-Editor-Handler ─────────────
window.LF.adminEditUser = (uid) => renderAdminUserEdit(uid);

window.LF.adminEditUserSave = async () => {
  const s = adminEditState;
  if (!s) return;
  const name    = document.getElementById('admEditName')?.value.trim() || '';
  const klasse  = document.getElementById('admEditKlasse')?.value || '';
  const role    = document.getElementById('admEditRole')?.value || '';
  const banned  = document.getElementById('admEditBanned')?.checked || false;
  const isClaude = document.getElementById('admEditClaude')?.checked || false;
  const outline = document.getElementById('admEditOutline')?.value || '';
  const theme   = document.getElementById('admEditTheme')?.value || '';
  const xp      = parseInt(document.getElementById('admEditXp')?.value) || 0;
  const streak  = parseInt(document.getElementById('admEditStreak')?.value) || 0;
  const testsToday = parseInt(document.getElementById('admEditTestsToday')?.value) || 0;
  const patch = {
    name, isBanned: banned, isClaude,
    activeOutline: outline || null, activeTheme: theme || 'default',
    xp, streakCount: streak, testsToday
  };
  if (klasse) patch.klasse = String(klasse);
  if (role) patch.role = role; else patch.role = null;
  try {
    await adminPatchUser(s.uid, patch);
    showToast('Änderungen gespeichert.', 'success');
    document.getElementById('adminEditOverlay')?.remove();
    adminEditState = null;
    // Liste neu laden
    if (location.hash.startsWith('#/admin')) renderAdmin();
  } catch(e) {
    console.error('[adminEditSave]', e);
    showToast('Konnte nicht speichern: ' + (e.message || 'Unbekannt'), 'error');
  }
};

window.LF.adminEditUserUnlockOutlines = async () => {
  const s = adminEditState;
  if (!s) return;
  const allOutlines = OUTLINE_TIERS.map(t => t.id);
  await adminUnlockAllForUser(s.uid, allOutlines, s.original.themes || []);
  showToast('Alle Outlines freigeschaltet.', 'success');
};

window.LF.adminEditUserUnlockThemes = async () => {
  const s = adminEditState;
  if (!s) return;
  await adminUnlockAllForUser(s.uid, s.original.outlines || [], ALL_THEME_IDS);
  showToast('Alle Themes freigeschaltet.', 'success');
};

window.LF.adminEditUserDeleteGrade = async (key) => {
  const s = adminEditState;
  if (!s) return;
  if (!confirm('Diese Note wirklich löschen?')) return;
  try {
    // Hard Rule 4: kein update() für Partial-Writes auf evtl. fehlende Docs.
    // set+merge mit FieldValue.delete() entfernt den Map-Key sauber.
    await db().collection('users').doc(s.uid).set({
      grades: { [key]: firebase.firestore.FieldValue.delete() }
    }, { merge: true });
    showToast('Note gelöscht.', 'success');
    renderAdminUserEdit(s.uid);
  } catch(e) {
    showToast('Konnte nicht löschen: ' + e.message, 'error');
  }
};

window.LF.adminEditUserDeleteAllGrades = async () => {
  const s = adminEditState;
  if (!s) return;
  if (!confirm('WIRKLICH alle Noten dieses Users löschen?')) return;
  try {
    await adminPatchUser(s.uid, { grades: {} });
    showToast('Alle Noten gelöscht.', 'success');
    renderAdminUserEdit(s.uid);
  } catch(e) {
    showToast('Fehler: ' + e.message, 'error');
  }
};

window.LF.adminEditUserResetDoc = async () => {
  const s = adminEditState;
  if (!s) return;
  if (!confirm(`Wirklich ${s.original.name || 'diesen User'}'s Account-Doc zurücksetzen? Alle Noten, XP und Streak gehen verloren.`)) return;
  if (!confirm('Sicher? Diese Aktion kann nicht rückgängig gemacht werden.')) return;
  try {
    await adminPatchUser(s.uid, {
      grades: {}, xp: 0, streakCount: 0, achievements: [],
      bookmarks: [], notes: {}, srs: {}, studyTime: {},
      totalQuestionsAnswered: 0, srsReviewsTotal: 0, dailyChallengesCompleted: 0
    });
    showToast('Account zurückgesetzt.', 'success');
    document.getElementById('adminEditOverlay')?.remove();
    adminEditState = null;
    if (location.hash.startsWith('#/admin')) renderAdmin();
  } catch(e) {
    showToast('Fehler: ' + e.message, 'error');
  }
};

// ── B3 — Mid-Test-Lockdown (2026-05-08) ───────────────────────────────
// Casey/Maya/Ramsey: Während eines aktiven Tests darf der User nicht
// einfach auf eine andere Hash-Route klicken — Test wird sonst stillschweigend
// verworfen + Anti-Cheat-Loophole (Antwort nachschlagen + zurück).
// Lösung: Confirm-Modal mit „Hier bleiben" / „Test abbrechen" + popstate-Guard
// + beforeunload-Native-Dialog für Reload/Close. Tab-Switch bleibt unverändert
// (Note 6 via _tabSwitch). In-App-Nav-Abbruch = NICHT als Note 6, weil aktiv
// gewählter Abbruch ≠ Cheat-Versuch (Maya's Spec).
function isTestActive() {
  if (testState && !testState.results && !testState._submitting) return true;
  if (typeof dailyChallengeState !== 'undefined' && dailyChallengeState
      && !dailyChallengeState.submitted) return true;
  return false;
}

// Hash, von dem aus der Test gestartet wurde — Set in renderActiveTest und
// renderDailyChallenge. Nur dieser Hash zählt als „im Test", alles andere
// triggert das Confirm-Modal.
let _testLockHash = null;

function isTestRouteOk(targetHash) {
  if (!_testLockHash) return true;
  // Erlaubt: exakter Test-Hash. Auch Hash mit Query-Suffix.
  const stripped = (targetHash || '').split('?')[0];
  const lock     = (_testLockHash || '').split('?')[0];
  return stripped === lock;
}

function _midTestPopstateGuard() {
  if (!isTestActive()) return;
  if (isTestRouteOk(location.hash)) return;
  const wantedHash = location.hash;
  if (_testLockHash) history.replaceState(null, '', _testLockHash);
  showMidTestConfirmModal(wantedHash);
}

function _midTestBeforeUnload(e) {
  if (!isTestActive()) return;
  // Native Browser-Dialog. Moderne Browser zeigen den String nicht mehr,
  // aber returnValue muss gesetzt sein damit der Dialog erscheint.
  const msg = 'Du bist mitten in einem Test. Beim Verlassen gehen deine Antworten verloren.';
  e.preventDefault();
  e.returnValue = msg;
  return msg;
}

function _setupMidTestGuards(testHash) {
  _testLockHash = testHash;
  window.addEventListener('popstate',     _midTestPopstateGuard);
  window.addEventListener('beforeunload', _midTestBeforeUnload);
}

function _teardownMidTestGuards() {
  _testLockHash = null;
  window.removeEventListener('popstate',     _midTestPopstateGuard);
  window.removeEventListener('beforeunload', _midTestBeforeUnload);
}

function showMidTestConfirmModal(targetHash) {
  if (document.getElementById('midTestConfirmOverlay')) return;
  const overlay = document.createElement('div');
  overlay.id = 'midTestConfirmOverlay';
  overlay.className = 'lf-modal-overlay';
  overlay.addEventListener('click', e => {
    // Klick auf Backdrop = „Hier bleiben" (Default = sicher).
    if (e.target === overlay) overlay.remove();
  });
  // Maya's Copy ist verbindlich (uxspec 2026-05-08).
  overlay.innerHTML = `
    <div class="lf-modal-card" style="max-width:420px">
      <div class="lf-modal-header">
        <h3>${lfIcon('triangle-alert')} Test l&auml;uft noch</h3>
      </div>
      <div class="lf-modal-body">
        <p style="margin:0;line-height:1.5;color:var(--text)">
          Du bist mitten in einem Test. Wenn du jetzt weggehst, gehen deine bisherigen Antworten verloren &mdash; ohne Note, ohne XP.
        </p>
      </div>
      <div class="lf-modal-actions">
        <button class="btn btn-ghost btn-danger" id="midTestAbortBtn">Test abbrechen</button>
        <button class="btn btn-primary" id="midTestStayBtn">Hier bleiben</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('midTestStayBtn')?.addEventListener('click', () => {
    overlay.remove();
  });
  document.getElementById('midTestAbortBtn')?.addEventListener('click', () => {
    overlay.remove();
    _abortActiveTest();
    if (targetHash && targetHash !== location.hash) {
      location.hash = targetHash;
    } else {
      location.hash = '#/';
    }
  });
  setTimeout(() => document.getElementById('midTestStayBtn')?.focus(), 50);
}

function _abortActiveTest() {
  // Test-State wegräumen ohne submitTest aufzurufen — KEIN Note-6, KEIN XP.
  if (typeof timerInterval !== 'undefined' && timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  try { _tabSwitch.teardown(); } catch(e) {}
  testState = null;
  if (typeof dailyChallengeState !== 'undefined' && dailyChallengeState) {
    if (dailyChallengeState.timer) clearInterval(dailyChallengeState.timer);
    dailyChallengeState = null;
  }
  _teardownMidTestGuards();
  showToast('Test verworfen.', 'info');
}

window.LF.midTestStay  = () => document.getElementById('midTestConfirmOverlay')?.remove();
window.LF.midTestAbort = () => {
  document.getElementById('midTestConfirmOverlay')?.remove();
  _abortActiveTest();
};

// ── F-03 Audio-Modus (Cycle 6, Maya-Spec) ────────────────────────────────
// Komplett client-side. SpeechSynthesis-API (browser-native).
// State: _audioState haelt Absatz-Liste, aktuellen Index, Speed, Auto-Advance,
// Voice-Pick, "is-playing"-Flag. Hash-Change → cancel().
//
// Persistenz nur in localStorage (lfAudioSpeed, lfAudioAutoAdvance,
// lfAudioUnavailableNotified). Kein Firestore, kein Worker.
let _audioState = null;

function _audioModeAvailable() {
  return typeof window !== 'undefined'
      && typeof window.speechSynthesis !== 'undefined'
      && typeof window.SpeechSynthesisUtterance !== 'undefined';
}

// Inline-SVG (Lucide-Headphones) — nicht in icons.js weil das auto-generiert
// ist und ich kein Build-Script-Roundtrip ziehen will. stroke=currentColor →
// passt sich an Theme an, wie alle anderen Icons.
function _audioHeadphonesIcon() {
  return '<svg xmlns="http://www.w3.org/2000/svg" class="lf-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H4a1 1 0 0 1-1-1zm18 0h-3a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h2a1 1 0 0 0 1-1zM3 14a9 9 0 0 1 18 0"/></svg>';
}

function _audioReadSpeedPref() {
  try {
    const raw = parseFloat(localStorage.getItem('lfAudioSpeed') || '1');
    if ([0.75, 1, 1.25, 1.5].includes(raw)) return raw;
  } catch {}
  return 1;
}
function _audioReadAutoAdvancePref() {
  try { return localStorage.getItem('lfAudioAutoAdvance') === '1'; } catch { return false; }
}

// Fallback-Toast bei fehlender API. LocalStorage-Flag verhindert Spam.
function _audioWarnUnavailableOnce() {
  try {
    if (localStorage.getItem('lfAudioUnavailableNotified') === '1') return;
    localStorage.setItem('lfAudioUnavailableNotified', '1');
  } catch {}
  showToast('Vorlesen geht in deinem Browser leider nicht.', 'info');
}

// Voice-Pick: deutsche Stimme bevorzugen, sonst voices[0]. SpeechSynthesis
// laedt voices async — getVoices() kann initial leer sein. Wir holen sie
// einmalig via voiceschanged-Event (oder direkt wenn schon da).
function _audioPickVoice() {
  if (!_audioModeAvailable()) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (voices.length === 0) return null;
  const de = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('de'));
  return de || voices[0];
}

// Absaetze aus dem aktuellen Content extrahieren. Wir sammeln <p>, <li>, <h2>,
// <h3>, <h4> in DOM-Reihenfolge und vergeben jedem ein data-audio-idx.
// Subtopic-Auto-Weiter ist in v1 nur ein Marker fuer den naechsten Subtopic-
// Inhalt — die Bar bleibt offen.
function _audioCollectParagraphs() {
  // Kandidaten-Container in Praeferenz-Reihenfolge:
  //   1. .content-body (regulaeres Topic / custom topic)
  //   2. #subtopicGrid expanded subtopic
  const containers = [
    document.querySelector('.content-body'),
    document.querySelector('#subtopicGrid')
  ].filter(Boolean);
  if (containers.length === 0) return [];
  const root = containers[0];
  const nodes = Array.from(root.querySelectorAll('p, li, h1, h2, h3, h4'));
  // Filter: leere Absaetze (nur whitespace) raus.
  const out = [];
  nodes.forEach((n, i) => {
    const txt = (n.textContent || '').trim();
    if (!txt) return;
    n.dataset.audioIdx = String(out.length);
    out.push({ el: n, text: txt });
  });
  return out;
}

window.LF.toggleAudioMode = () => {
  // Defensive: Button wird nur gerendert wenn _audioModeAvailable() — der
  // sichtbare Fallback-Toast feuert beim Topic-Render (Sophie P2-5,
  // Cycle 7). Hier nur stiller Bail.
  if (!_audioModeAvailable()) return;
  if (_audioState && _audioState.isOpen) {
    _audioStopFully();
    return;
  }
  const paragraphs = _audioCollectParagraphs();
  if (paragraphs.length === 0) {
    showToast('Dieses Topic hat noch keinen Lese-Inhalt.', 'info');
    return;
  }
  _audioState = {
    paragraphs, currentIdx: 0,
    speed: _audioReadSpeedPref(),
    autoAdvance: _audioReadAutoAdvancePref(),
    isOpen: true, isPlaying: false, voice: null,
    // Sophie P1-1 (Cycle 7): topicHash fuer Resume-Persistenz.
    topicHash: location.hash
  };
  // Voice asynchron picken — manche Browser brauchen voiceschanged.
  const tryPickVoice = () => {
    _audioState.voice = _audioPickVoice();
    if (!_audioState.voice) {
      // Voices noch nicht geladen — beim Start-Speak nochmal versuchen.
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        if (_audioState) _audioState.voice = _audioPickVoice();
      }, { once: true });
    } else if (!_audioState.voice.lang?.toLowerCase().startsWith('de')) {
      showToast('Keine deutsche Stimme installiert — nutze die Standard-Stimme.', 'info');
    }
  };
  tryPickVoice();
  _audioRenderBar();
  _audioPlayCurrent();
};

function _audioPlayCurrent() {
  if (!_audioState || !_audioModeAvailable()) return;
  const p = _audioState.paragraphs[_audioState.currentIdx];
  if (!p) {
    _audioStopFully();
    return;
  }
  // Vorherige Highlights weg, neuer setzen.
  document.querySelectorAll('[data-audio-idx].audio-active').forEach(el => el.classList.remove('audio-active'));
  p.el.classList.add('audio-active');
  // Ins Viewport scrollen wenn out-of-view (nur bei laufender Wiedergabe).
  const r = p.el.getBoundingClientRect();
  if (r.top < 60 || r.bottom > window.innerHeight - 100) {
    p.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  // SpeechSynthesisUtterance fuer den Absatz-Text. Sehr lange Absaetze
  // splittet die Engine selbst — fuer v1 belassen.
  window.speechSynthesis.cancel();   // Race-Schutz: vorherige Utterance abwerfen.
  const u = new SpeechSynthesisUtterance(p.text);
  if (_audioState.voice) u.voice = _audioState.voice;
  u.lang = _audioState.voice?.lang || 'de-DE';
  u.rate = _audioState.speed;
  u.onend = () => {
    if (!_audioState) return;
    if (_audioState.currentIdx + 1 < _audioState.paragraphs.length) {
      _audioState.currentIdx++;
      _audioPlayCurrent();
    } else {
      _audioState.isPlaying = false;
      document.querySelectorAll('[data-audio-idx].audio-active').forEach(el => el.classList.remove('audio-active'));
      _audioRenderBar();
    }
  };
  u.onerror = () => {
    _audioState.isPlaying = false;
    _audioRenderBar();
  };
  _audioState.isPlaying = true;
  window.speechSynthesis.speak(u);
  _audioRenderBar();
}

function _audioRenderBar() {
  if (!_audioState) return;
  let bar = document.getElementById('audioBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'audio-bar';
    bar.id = 'audioBar';
    document.body.appendChild(bar);
  }
  const speeds = [0.75, 1, 1.25, 1.5];
  const playPauseIcon = _audioState.isPlaying
    ? lfIcon('pause')
    : lfIcon('play');
  const speedChips = speeds.map(s => `
    <button class="audio-bar-speed-chip ${s === _audioState.speed ? 'active' : ''}"
            onclick="window.LF.audioSetSpeed(${s})">${s}x</button>`).join('');
  bar.innerHTML = `
    <button class="audio-bar-btn audio-play-btn" aria-label="${_audioState.isPlaying ? 'Pause' : 'Abspielen'}"
            onclick="window.LF.audioTogglePlay()">${playPauseIcon}</button>
    <button class="audio-bar-btn" aria-label="Stoppen"
            onclick="window.LF.audioStop()">${lfIcon('x')}</button>
    <div class="audio-bar-pos">${_audioState.currentIdx + 1}/${_audioState.paragraphs.length}</div>
    <div class="audio-bar-speed">${speedChips}</div>
    <button class="audio-bar-close audio-bar-btn" aria-label="Audio-Player schlie\xdfen"
            onclick="window.LF.audioClose()">×</button>
  `;
  // Toolbar-Button-State.
  const tb = document.getElementById('audioToolbarBtn');
  if (tb) tb.classList.toggle('is-playing', !!_audioState.isPlaying);
}

window.LF.audioTogglePlay = () => {
  if (!_audioState || !_audioModeAvailable()) return;
  if (_audioState.isPlaying) {
    window.speechSynthesis.pause();
    _audioState.isPlaying = false;
  } else {
    // Wenn Speech bereits in Pause-State haengt, resume(); sonst neu starten.
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      _audioState.isPlaying = true;
    } else {
      _audioPlayCurrent();
      return;
    }
  }
  _audioRenderBar();
};

window.LF.audioStop = () => {
  if (!_audioState) return;
  if (_audioModeAvailable()) window.speechSynthesis.cancel();
  _audioState.currentIdx = 0;
  _audioState.isPlaying = false;
  document.querySelectorAll('[data-audio-idx].audio-active').forEach(el => el.classList.remove('audio-active'));
  _audioRenderBar();
};

window.LF.audioClose = () => {
  // Sophie P1-1 (Cycle 7): Explizites Close = "fertig", Resume-State weg.
  _audioClearResume();
  _audioStopFully();
};

window.LF.audioSetSpeed = (rate) => {
  if (!_audioState || !_audioModeAvailable()) return;
  if (![0.75, 1, 1.25, 1.5].includes(rate)) return;
  _audioState.speed = rate;
  try { localStorage.setItem('lfAudioSpeed', String(rate)); } catch {}
  // Bei laufender Wiedergabe: aktuellen Absatz mit neuer Rate neu starten
  // (SpeechSynthesisUtterance ist immutable — `u.rate` aendern bringt nichts).
  if (_audioState.isPlaying) _audioPlayCurrent();
  _audioRenderBar();
};

function _audioStopFully() {
  if (_audioModeAvailable()) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
  document.querySelectorAll('[data-audio-idx].audio-active').forEach(el => el.classList.remove('audio-active'));
  document.getElementById('audioBar')?.remove();
  const tb = document.getElementById('audioToolbarBtn');
  if (tb) tb.classList.remove('is-playing');
  _audioState = null;
}

// Sophie P1-1 (Cycle 7): Audio-Resume-Persistenz.
// Beim Hash-Change wird der aktuelle State (topicHash, idx, speed, autoAdvance,
// isPlaying, ts) in localStorage geschrieben — wenn der User innerhalb des
// Resume-Fensters auf dieselbe Topic-Seite zurueckkehrt, bietet ein Toast
// "Fortsetzen?" das Wiederaufnehmen ab dem gespeicherten Absatz.
//
// Persistiert wird nur, wenn der User wirklich konsumiert hat (currentIdx > 0
// ODER isPlaying) — sonst Spam.
const _LF_AUDIO_RESUME_KEY = 'lfAudioResume';
const _LF_AUDIO_RESUME_TTL_MS = 60 * 60 * 1000;   // 1 Stunde

function _audioPersistResume() {
  if (!_audioState || !_audioState.topicHash) return;
  const idx = _audioState.currentIdx | 0;
  const wasPlaying = !!_audioState.isPlaying;
  // Skip wenn Nutzer noch nichts konsumiert hat (Bar geoeffnet, sofort weg).
  if (idx === 0 && !wasPlaying) {
    try { localStorage.removeItem(_LF_AUDIO_RESUME_KEY); } catch {}
    return;
  }
  const payload = {
    topicHash: _audioState.topicHash,
    currentIdx: idx,
    paragraphCount: (_audioState.paragraphs || []).length,
    speed: _audioState.speed,
    autoAdvance: _audioState.autoAdvance,
    wasPlaying,
    ts: Date.now()
  };
  try { localStorage.setItem(_LF_AUDIO_RESUME_KEY, JSON.stringify(payload)); } catch {}
}

function _audioReadResume() {
  try {
    const raw = localStorage.getItem(_LF_AUDIO_RESUME_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (typeof data.ts !== 'number' || (Date.now() - data.ts) > _LF_AUDIO_RESUME_TTL_MS) {
      localStorage.removeItem(_LF_AUDIO_RESUME_KEY);
      return null;
    }
    return data;
  } catch { return null; }
}

function _audioClearResume() {
  try { localStorage.removeItem(_LF_AUDIO_RESUME_KEY); } catch {}
}

// Resume-Ausfuehrung: Audio-Modus ab gespeichertem Absatz starten. Wird nur
// nach User-Klick auf den Toast-Button gerufen (Browser-Autoplay-Gate ok).
function _audioResumeFromSaved(saved) {
  if (!_audioModeAvailable()) {
    _audioWarnUnavailableOnce();
    return;
  }
  const paragraphs = _audioCollectParagraphs();
  if (paragraphs.length === 0) {
    showToast('Kein Lese-Inhalt gefunden.', 'info');
    return;
  }
  // Falls Inhalt sich geaendert hat (anderer paragraphCount), trotzdem versuchen
  // — aber idx clampen, damit wir nicht out-of-bounds laufen.
  const idx = Math.min(Math.max(saved.currentIdx | 0, 0), paragraphs.length - 1);
  const speed = [0.75, 1, 1.25, 1.5].includes(saved.speed) ? saved.speed : _audioReadSpeedPref();
  _audioState = {
    paragraphs, currentIdx: idx,
    speed,
    autoAdvance: !!saved.autoAdvance,
    isOpen: true, isPlaying: false, voice: null,
    topicHash: location.hash
  };
  // Voice asynchron picken — gleicher Pfad wie toggleAudioMode.
  _audioState.voice = _audioPickVoice();
  if (!_audioState.voice && _audioModeAvailable()) {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      if (_audioState) _audioState.voice = _audioPickVoice();
    }, { once: true });
  }
  _audioRenderBar();
  _audioPlayCurrent();
  _audioClearResume();
}

window.LF.audioResume = () => {
  const saved = _audioReadResume();
  if (!saved) return;
  _audioResumeFromSaved(saved);
};

window.LF.audioResumeDismiss = () => {
  _audioClearResume();
  document.getElementById('audioResumeToast')?.remove();
};

// Beim Topic-Mount aufrufen: wenn ein gespeicherter Resume-State existiert
// und auf die aktuelle Topic-Seite passt, Toast mit "Fortsetzen"-Button zeigen.
function _audioMaybeShowResumePrompt() {
  if (!_audioModeAvailable()) return;
  const saved = _audioReadResume();
  if (!saved) return;
  if (saved.topicHash !== location.hash) return;
  // Wenn Audio gerade laeuft (z.B. Hash hat sich gar nicht aendernd-aber-gleich
  // refresh'ed) → keinen Resume-Toast aufstapeln.
  if (_audioState && _audioState.isOpen) return;
  // Toast bauen — eigene DOM-Struktur, damit der "Fortsetzen"-Button sichtbar
  // mit Tap-Target ist (showToast ist nur Text). Auto-dismiss nach 8s.
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  document.getElementById('audioResumeToast')?.remove();
  const toast = document.createElement('div');
  toast.id = 'audioResumeToast';
  toast.className = 'toast info toast-undo';
  const msg = document.createElement('span');
  msg.className = 'toast-undo-msg';
  msg.textContent = `Audio fortsetzen? (Absatz ${saved.currentIdx + 1})`;
  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'toast-undo-btn';
  resumeBtn.type = 'button';
  resumeBtn.textContent = 'Fortsetzen';
  resumeBtn.addEventListener('click', () => {
    toast.remove();
    window.LF.audioResume();
  });
  toast.appendChild(msg);
  toast.appendChild(resumeBtn);
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 8000);
}

// Hash-Change → State persistieren, dann komplett aufraeumen. Spec: Auto-Pause
// beim Wegnavigieren; Resume-Prompt beim Zurueckkehren.
window.addEventListener('hashchange', () => {
  if (_audioState) {
    _audioPersistResume();
    _audioStopFully();
  }
});

// ── F-09 Konfidenz-Verlauf (Cycle 6, Maya-Spec) ───────────────────────────
// _pendingConfidence: 1..5 (User hat Sterne gewaehlt) | null (skipped).
// Lebt zwischen Pre-Test-Step und submitTest. Nach Persistenz (in
// grades[key].history[].confidence) wieder genullt. Skip-Pfad → kein
// Banner, kein Profil-Tab-Eintrag fuer diesen Versuch.
let _pendingConfidence = null;

// Star-Renderer fuer Konfidenz-Slider 1-5. Wird in 3 Kontexten genutzt:
// 1. Pre-Test-Step (renderConfidencePreTest)
// 2. Klausur-Tag-Reflection-Modal (Klausurtag-Konfidenz)
// 3. Klausur-Bereitschafts-Widget (Tages-Konfidenz)
// Maya-Spec: Tap-Target 44px (CSS .confidence-star-btn min-width/height).
// `value` 1..5 oder null. `onPick` ist ein Funktionsname-Pfad (window.LF.X).
// Wir passen auf, dass arg-quoting safe ist — `pickerId` ist controlled
// (Aufrufer-konstant), `value` int.
function _renderConfidenceStars(pickerId, currentValue) {
  const v = (typeof currentValue === 'number' && currentValue >= 1 && currentValue <= 5)
    ? currentValue : 0;
  return [1,2,3,4,5].map(i => `
    <button type="button"
            class="confidence-star-btn ${i <= v ? 'active' : ''}"
            aria-label="${i} von 5 Sternen"
            onclick="window.LF.pickConfidence('${pickerId}',${i})">
      ${lfIcon(i <= v ? 'star' : 'star', { cls: 'lf-icon-md' })}
    </button>`).join('');
}

// Pre-Test-Step. Rendert in den uebergebenen Container und ruft `onProceed`
// mit der gewaehlten Konfidenz (1..5 | null bei Skip) auf.
// Maya-Spec-Copy: "Wie sicher bist du im Stoff?" / Default 3 / Skip moeglich.
function _renderConfidencePreTest(targetEl, onProceed) {
  if (!targetEl) { onProceed(null); return; }
  // Pro Render-Call eindeutige Picker-ID, weil mehrere Slider nebeneinander
  // existieren koennen (Pre-Test + Klausur-Widget gleichzeitig sichtbar).
  const pid = '_preTest';
  _confidencePickers[pid] = 3;   // Default 3 — "geht so"
  const html = `
    <div class="confidence-card" id="confidencePreTestCard">
      <h2>Wie sicher bist du im Stoff?</h2>
      <div class="confidence-sub">1 = unsicher · 5 = voll sicher</div>
      <div class="confidence-stars" id="confidenceStars_${pid}">
        ${_renderConfidenceStars(pid, 3)}
      </div>
      <div class="confidence-actions">
        <button class="btn btn-ghost btn-lg" id="confSkipBtn">\xdcberspringen</button>
        <button class="btn btn-primary btn-lg" id="confStartBtn">Los geht's</button>
      </div>
    </div>`;
  targetEl.innerHTML = html;
  document.getElementById('confSkipBtn')?.addEventListener('click', () => {
    delete _confidencePickers[pid];
    onProceed(null);
  });
  document.getElementById('confStartBtn')?.addEventListener('click', () => {
    const val = _confidencePickers[pid];
    delete _confidencePickers[pid];
    onProceed(typeof val === 'number' ? val : null);
  });
}

// Picker-State-Map: { pickerId → 1..5 }. window.LF.pickConfidence updated
// den Wert + re-rendert NUR die Sterne (kein voller Re-Render damit
// Buttons-Listener intakt bleiben).
const _confidencePickers = {};

window.LF.pickConfidence = (pickerId, value) => {
  if (typeof value !== 'number' || !isFinite(value) || value < 1 || value > 5) return;
  // Ramsey P2-C (Cycle 7): Picker-Integer-UX. 2.5 → 2 (Math.floor), nicht
  // Server-Reject. Schuetzt vor floats die durch JSON-Roundtrip / fremde
  // Aufrufer reinkommen koennten.
  const intVal = Math.floor(value);
  _confidencePickers[pickerId] = intVal;
  const starsEl = document.getElementById(`confidenceStars_${pickerId}`);
  if (starsEl) starsEl.innerHTML = _renderConfidenceStars(pickerId, intVal);
};

function renderActiveTest(questions, timeMinutes, subjectId, yearId, topicId, subject, topic) {
  setupTabSwitchDetection();
  // B3 Sophie-QA-Fix (2026-05-08): Test-Hash = die ACTUAL location.hash, nicht
  // ein konstruierter '#/fach/...'-Pfad. Custom-Topic-Tests laufen unter
  // '#/meine-inhalte/<id>' (subjectId == '_custom' wäre falscher Lockhash =
  // 404-Route nach replaceState bei Backdrop-Klick).
  _setupMidTestGuards(location.hash || `#/fach/${subjectId}/${yearId}/${topicId}`);
  testState = {
    questions, timeMinutes, subjectId, yearId, topicId,
    subjectName: subject.name, topicName: topic.name,
    answers:  new Array(questions.length).fill(null),
    startTime: Date.now(),
    remaining: timeMinutes * 60
  };

  document.getElementById('testArea').innerHTML = `
    <div class="test-active">
      <div class="test-topbar">
        <div class="test-progress">
          <strong id="qProgress">0</strong> von <strong>${questions.length}</strong> beantwortet
        </div>
        <div class="timer" id="timer">${formatTime(testState.remaining)}</div>
        <button class="btn btn-secondary btn-sm" onclick="window.LF.submitTest()">Abgeben</button>
      </div>
      <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
      <div id="questionsContainer" style="margin-top:20px"></div>
      <!-- V2-01 (Casey): Sticky-Bottom-Submit nur Mobile (CSS @media). Spart
           den 5x-hoch-scrollen-Schmerz. Triggert denselben submitTest-Handler. -->
      <button class="btn btn-primary test-submit-sticky" onclick="window.LF.submitTest()">Test abgeben</button>
    </div>`;

  renderAllQuestions(questions);
  startTimer();
}

function renderAllQuestions(questions) {
  const container = document.getElementById('questionsContainer');
  container.innerHTML = questions.map((q, i) => `
    <div class="question-card" id="qcard${i}">
      <div class="question-num">Aufgabe ${i+1} von ${questions.length}</div>
      <div class="question-points">${q.type==='multiple_choice' ? (q.points||2) : q.maxPoints} Punkte</div>
      <div class="question-text">${escapeHtml(q.question || '')}</div>
      ${q.type === 'multiple_choice'
        ? `<div class="mc-options">
            ${q.shuffledOptions.map((opt, j) => `
              <label class="mc-option" id="opt${i}_${j}">
                <input type="radio" name="q${i}" value="${j}"
                  onchange="window.LF.setAnswer(${i}, ${j}); document.querySelectorAll('#qcard${i} .mc-option').forEach(el=>el.classList.remove('selected')); document.getElementById('opt${i}_${j}').classList.add('selected')">
                ${escapeHtml(opt || '')}
              </label>`).join('')}
           </div>`
        : `<textarea class="form-input form-textarea" placeholder="Deine Antwort hier..."
              oninput="window.LF.setAnswer(${i}, this.value)"></textarea>`}
    </div>`).join('');

  // F2 (Casey/Wave-2): Initial-Wert "0 beantwortet" (vorher fix '1' — irrefuehrend
  // wenn der User noch nichts angeklickt hat). updateProgress() rechnet eh sauber.
  updateProgress();
}

let timerInterval = null;

function startTimer() {
  timerInterval = setInterval(() => {
    testState.remaining--;
    const el = document.getElementById('timer');
    if (el) {
      el.textContent = formatTime(testState.remaining);
      el.className = 'timer' + (testState.remaining < 60 ? ' danger' : testState.remaining < 180 ? ' warning' : '');
    }
    if (testState.remaining <= 0) {
      clearInterval(timerInterval);
      window.LF.submitTest();
    }
  }, 1000);
}

window.LF.setAnswer = (idx, val) => {
  if (!testState) return;
  testState.answers[idx] = val;
  updateProgress();
};

window.LF.submitTest = async () => {
  // Casey #2: Re-Entry-Guard gegen Doppel-Submission auf Mobile-Doppeltap.
  if (!testState || testState._submitting) return;
  testState._submitting = true;
  try {
  clearInterval(timerInterval);
  _tabSwitch.teardown();
  const penalty = _tabSwitch.consumePenalty();

  const { questions, answers, timeMinutes, subjectId, yearId, topicId, subjectName, topicName, startTime } = testState;
  const timeUsed        = Math.round((Date.now() - startTime) / 1000);
  const effectiveAns    = penalty ? new Array(questions.length).fill(null) : answers;
  // V-22: Outer-scope-Slot fuer prevAttempt — wird im if(currentUser)-Branch
  // gesetzt VOR dem saveGrade-Call und dann an renderResults durchgereicht.
  let _prevAttemptForResults = null;

  document.getElementById('testArea').innerHTML = `
    <div style="text-align:center;padding:40px">
      <div class="spinner" style="margin:0 auto 16px"></div>
      <p id="evalStatus">${penalty ? 'Tab-Wechsel erkannt. Wird als Note 6 gewertet…' : 'Antworten werden ausgewertet… (kann bei KI-Fragen bis zu 15 Sek. dauern)'}</p>
    </div>`;

  const results = await evaluateAnswers(questions, effectiveAns, timeMinutes);
  const rawTotal = results.reduce((s,r) => s+(r.points||0), 0);
  const max      = results.reduce((s,r) => s+(r.maxPoints||0), 0);
  const total    = penalty ? 0 : rawTotal;
  const grade    = penalty
    ? { grade: 6, label: 'Ungenügend (Tab-Wechsel)', color: '#7f1d1d' }
    : calcGrade(total, max);

  // Custom-Topic-Check: kein CF-Call, lokal-only XP + Achievements (Cheat-#8 frontend half).
  const isCustomTopic = subjectId === '_custom'
                        || subjectId === 'meine-inhalte'
                        || (typeof topicId === 'string' && topicId.startsWith('_custom_'));
  // Claude/Hacker-Test-Accounts: kein CF-Call (Server-Whitelist haette uns sowieso geblockt).
  const isTestAccount = isClaudeAccount() || isHackerAccount();

  if (currentUser) {
    userData = userData || {};
    userData.grades = userData.grades || {};
    const key      = `${subjectId}__${yearId}__${topicId}`;
    const existing = userData.grades[key] || {};
    // V-22 (Casey, motivation): Note des letzten abgeschlossenen Versuchs
    // — VOR dem Save-Step erfassen, damit renderResults die Vorher/Nachher-
    // Vergleichsbasis hat. existing.history ist das alte Array, der letzte
    // Eintrag = letzter Versuch.
    if (existing.history && existing.history.length > 0) {
      _prevAttemptForResults = existing.history[existing.history.length - 1];
    }

    if (isTestAccount || isCustomTopic) {
      // Lokal-Pfad: Test-Accounts und Custom-Topics gehen NIE in die Cloud-Function.
      // Verhalten wie vor Mission 3 — saveGrade/XP/Achievements lokal.
      const attempt = {
        points: total, maxPoints: max,
        grade: penalty ? 6 : grade.grade,
        date: new Date().toISOString()
      };
      // F-09 Cycle-6: Konfidenz nur bei normaler Wertung, nicht bei Penalty
      // (Penalty = Tab-Wechsel-Cheat-Versuch, Selbsteinschaetzung ungueltig).
      if (!penalty && typeof _pendingConfidence === 'number'
          && _pendingConfidence >= 1 && _pendingConfidence <= 5) {
        attempt.confidence = _pendingConfidence;
      }
      const history = [...(existing.history || []), attempt];
      const bestRun = history.reduce((best, h) =>
        (h.points / h.maxPoints) > (best.points / best.maxPoints) ? h : best,
        history[0]
      );
      const bestInfo = calcGrade(bestRun.points, bestRun.maxPoints);
      const gradeEntry = {
        grade:         bestInfo.grade,
        bestPoints:    bestRun.points,
        bestMaxPoints: bestRun.maxPoints,
        history
      };
      userData.grades[key] = gradeEntry;
      await saveGrade(currentUser.uid, subjectId, yearId, topicId, gradeEntry).catch(console.error);
      // Mission 7: Test-Accounts/Custom-Topics gehen NIE durch CF — kein Server-Roll,
      // kein Doppel-Drop-XP. Daher hier weiter clientseitig wuerfeln (offline-Pfad)
      // und mit dem alten arrayUnion lokal speichern. Akzeptiert: Test-Accs sind eh
      // nicht im Leaderboard, kein Cheat-Risiko (siehe Maya's Edge-Cases).
      try {
        const owned = userData.themes || ['default'];
        const drop = _clientRollThemeDrop(bestInfo.grade, owned);
        if (drop && !owned.includes(drop)) {
          userData.themes = [...owned, drop];
          await unlockTheme(currentUser.uid, drop).catch(console.error);
          showThemeDropToast(drop);
        }
      } catch(e) { console.warn('[theme-drop-local]', e); }
      // F-25: XP + F-24: Achievements lokal
      const qCount = questions.length;
      userData.totalQuestionsAnswered = (userData.totalQuestionsAnswered || 0) + qCount;
      await incrementCounter(currentUser.uid, 'totalQuestionsAnswered', qCount).catch(console.error);
      const ctx = {
        xp:            penalty ? 5 : calcXPForTest(bestInfo.grade),
        streak:        calcStreak(),
        hour:          new Date().getHours(),
        perfect:       !penalty && total === max && max > 0,
        testsToday:    countTestsToday(),
        subjectComplete: checkSubjectComplete(subjectId),
      };
      grantXPAndAchievements(ctx).catch(console.error);
    } else {
      // Mission 3 Hauptpfad: Cloud-Function macht alle Server-Writes
      // (saveGrade + Leaderboard + XP + Achievements + Feed + DailyScore).
      // De-shuffle MC-Antworten: server erwartet selectedOriginalIndex
      // (Index in q.options, nicht in q.shuffledOptions).
      const cfAnswers = questions.map((q, i) => {
        const a = effectiveAns[i];
        if (q.type === 'multiple_choice') {
          let selectedOriginalIndex = null;
          if (a != null && a !== '' && q.shuffledOptions) {
            const sIdx = parseInt(a, 10);
            const chosenLabel = q.shuffledOptions[sIdx];
            if (chosenLabel != null && Array.isArray(q.options)) {
              const origIdx = q.options.indexOf(chosenLabel);
              if (origIdx >= 0) selectedOriginalIndex = origIdx;
            }
          }
          return { questionIndex: i, type: 'multiple_choice', selectedOriginalIndex };
        }
        if (q.type === 'vocabulary') {
          return { questionIndex: i, type: 'vocabulary', freeText: typeof a === 'string' ? a : '' };
        }
        // free_text — auch unbekannte Typen werden als free_text behandelt
        // (server-side maxPoint clamp). reportedPoints ist die clientseitige
        // AI-Bewertung fuer Cross-Check (server clamps gegen den Q-eigenen max).
        const r = results[i] || {};
        return {
          questionIndex: i,
          type: 'free_text',
          freeText: typeof a === 'string' ? a : '',
          reportedPoints:    typeof r.points    === 'number' ? r.points    : null,
          reportedMaxPoints: typeof r.maxPoints === 'number' ? r.maxPoints : null
        };
      });

      try {
        const cfResp = await cf.submitTestResult({
          subjectId, yearId, topicId,
          timeMinutes, timeSpentSec: timeUsed,
          isPenalty: !!penalty,
          answers: cfAnswers
        });
        // Server-Response ist Source-of-Truth: lokales userData von Firestore neu laden.
        try {
          const fresh = await getUserData(currentUser.uid);
          if (fresh) userData = fresh;
        } catch(e) { console.warn('[cf-userdata-refresh]', e); }
        // F-09 Cycle-6: Konfidenz nach dem CF-Refresh in den letzten history-
        // Eintrag schreiben. CF kennt confidence nicht (kein Server-Wert) →
        // wir mergen client-side via saveGrade. Nur bei !penalty und
        // gueltigem Wert. set+merge schreibt nur das eine Feld nach.
        if (!penalty && typeof _pendingConfidence === 'number'
            && _pendingConfidence >= 1 && _pendingConfidence <= 5) {
          try {
            const ge = userData?.grades?.[key];
            if (ge && Array.isArray(ge.history) && ge.history.length > 0) {
              const newHistory = ge.history.map((h, i) =>
                i === ge.history.length - 1 ? { ...h, confidence: _pendingConfidence } : h
              );
              const updated = { ...ge, history: newHistory };
              userData.grades[key] = updated;
              await saveGrade(currentUser.uid, subjectId, yearId, topicId, updated)
                .catch(err => console.warn('[confidence-save]', err));
            }
          } catch (e) { console.warn('[confidence-merge]', e); }
        }
        // Mission 7 — Drop-Roll-Refactor (Variant B):
        // Server (Marcus' submitTestResult) wuerfelt den Drop und liefert
        // ihn in der Response. Frontend STOPPT eigenes Wuerfeln, liest nur.
        // Mögliche Response-Shapes:
        //   { themeDrop: { themeId, unlocked: true } }              → Neuer Drop
        //   { themeDrop: { themeId, alreadyOwned: true, xpGranted } } → Doppel-Drop
        //   { themeDrop: null, trostpreis: 30 }                      → Alle 11 owned
        //   { themeDrop: null }                                      → Kein Drop
        try {
          const td = cfResp?.themeDrop;
          if (td && td.unlocked) {
            // Neuer Drop — userData wurde via getUserData(...) bereits refresht.
            showThemeDropToast(td.themeId);
          } else if (td && td.alreadyOwned) {
            // Doppel-Drop — Server hat XP gegeben, userData ist refresht.
            showThemeDropDoubleToast(td.themeId, td.xpGranted || 0);
          } else if (cfResp?.trostpreis) {
            // Alle 11 Themes owned — Server gibt +30 XP Trostpreis.
            showTrostpreisToast(cfResp.trostpreis);
          }
        } catch(e) { console.warn('[theme-drop-resp]', e); }
        // CF-resp may include xpAwarded / achievementsGranted — Toasts triggern.
        if (cfResp && Array.isArray(cfResp.achievementsGranted) && cfResp.achievementsGranted.length) {
          try {
            const granted = cfResp.achievementsGranted
              .map(id => ACHIEVEMENTS.find(a => a.id === id))
              .filter(Boolean);
            for (const ach of granted) {
              showToast(`Erfolg freigeschaltet: ${ach.title || ach.id}`, 'success');
            }
          } catch(e) { console.warn('[ach-toast]', e); }
        }
      } catch (e) {
        // CF unreachable / permission-denied → fallback auf alten Lokal-Pfad,
        // damit der User nicht im Limbo steht. Akzeptiert: User-side AI-Bewertung
        // fuer das eine Mal; CF-Server vergibt es beim naechsten Online-Submit.
        console.error('[submitTest-cf]', e);
        showToast('Server konnte Test nicht direkt verarbeiten — lokal gespeichert.', 'warn');
        const attempt = {
          points: total, maxPoints: max,
          grade: penalty ? 6 : grade.grade,
          date: new Date().toISOString()
        };
        // F-09: Konfidenz auch im Offline-Fallback persistieren.
        if (!penalty && typeof _pendingConfidence === 'number'
            && _pendingConfidence >= 1 && _pendingConfidence <= 5) {
          attempt.confidence = _pendingConfidence;
        }
        const history = [...(existing.history || []), attempt];
        const bestRun = history.reduce((best, h) =>
          (h.points / h.maxPoints) > (best.points / best.maxPoints) ? h : best,
          history[0]
        );
        const bestInfo = calcGrade(bestRun.points, bestRun.maxPoints);
        const gradeEntry = {
          grade:         bestInfo.grade,
          bestPoints:    bestRun.points,
          bestMaxPoints: bestRun.maxPoints,
          history
        };
        userData.grades[key] = gradeEntry;
        await saveGrade(currentUser.uid, subjectId, yearId, topicId, gradeEntry).catch(console.error);
        const qCount = questions.length;
        userData.totalQuestionsAnswered = (userData.totalQuestionsAnswered || 0) + qCount;
        await incrementCounter(currentUser.uid, 'totalQuestionsAnswered', qCount).catch(console.error);
        const ctx = {
          xp:            penalty ? 5 : calcXPForTest(bestInfo.grade),
          streak:        calcStreak(),
          hour:          new Date().getHours(),
          perfect:       !penalty && total === max && max > 0,
          testsToday:    countTestsToday(),
          subjectComplete: checkSubjectComplete(subjectId),
        };
        grantXPAndAchievements(ctx).catch(console.error);
        // Mission 7 — Offline-Drop-Fallback: CF nicht erreichbar, also clientseitig
        // wuerfeln. Kein Doppel-Drop-XP-Pfad (kein Server, kein Trust). Bereits
        // owned → silent skip, kein Toast (entspricht Maya's Edge-Case-Spec).
        try {
          const owned = userData?.themes || ['default'];
          const drop = _clientRollThemeDrop(bestInfo.grade, owned);
          if (drop && !owned.includes(drop)) {
            userData.themes = [...owned, drop];
            await unlockTheme(currentUser.uid, drop).catch(console.error);
            showThemeDropToast(drop);
            showToast('Drop offline notiert. XP-Bonus wird beim n\xe4chsten Sync nachgereicht.', 'warn');
          }
        } catch(e) { console.warn('[theme-drop-offline]', e); }
      }
    }
  }

  // B3: Test fertig — Mid-Test-Guards abräumen, results-Flag setzen, damit
  // isTestActive() false zurückgibt und der User die Result-View frei
  // verlassen kann.
  if (testState) testState.results = true;
  _teardownMidTestGuards();
  // F5 (Casey/Wave-2): XP-Pop-In auf Result-Page. Wert spiegelt die clientseitige
  // Berechnung (penalty=5 sonst calcXPForTest) — Achievements oben drauf laufen
  // separat ueber grantXPAndAchievements(). Wenn der Server final +/- berechnet,
  // ist die Differenz minimal; ein motivationaler Pop ist hier wichtiger als
  // server-pixel-genau. Anti-Penalty: bei Tab-Wechsel zeigt der Pop trotzdem +5.
  const _xpAwardedDisplay = penalty ? 5 : calcXPForTest(grade.grade);
  // F-09 Cycle-6: confidence im meta durchreichen, dann State zuruecksetzen
  // (sonst wuerde der naechste Test ohne Skip-Flow den alten Wert sehen).
  const _confForResults = _pendingConfidence;
  _pendingConfidence = null;
  renderResults(questions, effectiveAns, results, grade, total, max, timeUsed, { subjectName, topicName, timeMinutes, penalty, prevAttempt: _prevAttemptForResults, xpAwarded: _xpAwardedDisplay, confidence: _confForResults });
  } finally {
    if (testState) testState._submitting = false;
    // B3 Sophie-Audit-Fix (2026-05-08): wenn evaluateAnswers/CF wirft, hat
    // die happy-path-teardown weiter oben nicht gefeuert — beforeunload
    // würde den User auch nach Logout/Reload nerven. Defensiv im finally.
    if (!testState || !testState.results) _teardownMidTestGuards();
  }
};

// ── F-3: Erklaer-mir-warum-falsch ────────────────────────────
// AI-Erklaerung pro falscher Frage. Cache in userData.errorExplanations[qId]
// (Firestore set+merge via saveErrorExplanation). Cost-Cap: 20 KI-Calls/Tag/User
// im localStorage. Bei API-Fehler: Toast + Button-State zurueck, KEIN Counter-
// Increment (sonst kann ein lokaler API-Block den User aussperren).
//
// AI-Output IMMER durch escapeHtml vor innerHTML-Injection (Hard-Rule 4 Geist).
// Counter-Read mit try/catch (Inkognito-Mode kann localStorage werfen).

const _EXPLAIN_DAILY_CAP = 20;
const _EXPLAIN_MAX_LEN   = 800;

// Per-Render snapshot der Frage-Lookups: requestErrorExplanation muss
// userAnswer + correctAnswer + Frage-Text haben — die holt der Render-Pfad
// in den Snapshot, der window.LF-Handler liest dann aus diesem Map.
let _explainContext = {};   // qId → { question, userAnswer, correctAnswer, subjectName, topicName, statusEl }

function _getExplainCountToday() {
  try {
    const k = 'lf_explain_count_' + _KLAUSUR_TODAY();
    return parseInt(localStorage.getItem(k) || '0', 10) || 0;
  } catch { return 0; }
}

function _incrementExplainCountToday() {
  try {
    const k = 'lf_explain_count_' + _KLAUSUR_TODAY();
    const cur = parseInt(localStorage.getItem(k) || '0', 10) || 0;
    localStorage.setItem(k, String(cur + 1));
  } catch {}
}

function _buildExplainPrompt({ question, userAnswer, correctAnswer, subjectName, topicName }) {
  return `Du bist ein freundlicher Lehrer. Erkl\xe4re einem Sch\xfcler in 2-3 kurzen S\xe4tzen auf Deutsch, warum seine Antwort falsch ist und warum die richtige Antwort richtig ist. Keine Einleitung, keine Anrede, direkt zur Erkl\xe4rung. Fach: ${subjectName || '—'}. Thema: ${topicName || '—'}.

Frage: ${question}
Antwort des Sch\xfclers: ${userAnswer}
Richtige Antwort: ${correctAnswer}`;
}

function _renderExplainRow(qId, q, userAnswer, correctAnswer, subjectName, topicName) {
  if (!qId) return '';
  // Snapshot fuer den Handler, weil testState.questions schon shuffelt und
  // shuffledOptions mutiert ist — wir wollen die Render-Werte bewahren.
  _explainContext[qId] = { question: q.question, userAnswer, correctAnswer, subjectName, topicName };
  const cached = userData?.errorExplanations?.[qId];
  const cap = _getExplainCountToday();
  const limitReached = !cached && cap >= _EXPLAIN_DAILY_CAP;
  const safeQid = escapeHtml(qId).replace(/'/g, '&#39;');
  if (cached?.explanation) {
    return `
      <div class="explain-row" data-explain-qid="${escapeHtml(qId)}">
        <button class="explain-btn explain-btn-toggle" onclick="window.LF.toggleErrorExplanation('${safeQid}')">
          <span class="explain-btn-label">Erkl\xe4rung anzeigen</span>
          <span class="explain-btn-caret">▼</span>
        </button>
        <div class="explain-body explain-body--collapsed">
          ${escapeHtml(cached.explanation)}
          <div class="explain-disclaimer">KI-Erkl\xe4rung — kann Fehler enthalten.</div>
        </div>
      </div>`;
  }
  if (limitReached) {
    return `
      <div class="explain-row" data-explain-qid="${escapeHtml(qId)}">
        <button class="explain-btn explain-btn--limit" disabled
                title="Du hast heute schon ${_EXPLAIN_DAILY_CAP} Erkl\xe4rungen abgerufen. Morgen geht's weiter.">
          \u{1F916} Tageslimit erreicht
        </button>
      </div>`;
  }
  return `
    <div class="explain-row" data-explain-qid="${escapeHtml(qId)}">
      <button class="explain-btn explain-btn-ready"
              title="Lass dir von der KI erkl\xe4ren, warum diese Antwort falsch war."
              onclick="window.LF.requestErrorExplanation('${safeQid}')">
        \u{1F916} Erkl\xe4r mir warum
      </button>
    </div>`;
}

async function requestErrorExplanation(qId) {
  if (!qId) return;
  const ctx = _explainContext[qId];
  const row = document.querySelector(`.explain-row[data-explain-qid="${CSS.escape(qId)}"]`);
  if (!ctx || !row) return;

  // Cap-Check (kann race-en, aber +1-Drift ist akzeptabel — Maya-Spec).
  const cap = _getExplainCountToday();
  if (cap >= _EXPLAIN_DAILY_CAP) {
    showToast('Tageslimit erreicht — morgen geht\'s weiter.', 'error');
    row.innerHTML = `<button class="explain-btn explain-btn--limit" disabled
        title="Du hast heute schon ${_EXPLAIN_DAILY_CAP} Erkl\xe4rungen abgerufen. Morgen geht\'s weiter.">
        \u{1F916} Tageslimit erreicht
      </button>`;
    return;
  }

  // Loading-State.
  const btn = row.querySelector('.explain-btn');
  if (btn) {
    btn.disabled = true;
    btn.classList.add('explain-btn--loading');
    btn.innerHTML = `<span class="spinner-inline"></span> KI denkt nach …`;
  }

  let aiText = '';
  try {
    const prompt = _buildExplainPrompt(ctx);
    aiText = await callAI(prompt, 250);
    if (typeof aiText !== 'string' || !aiText.trim()) {
      throw new Error('Leere AI-Antwort');
    }
    aiText = aiText.trim();
    if (aiText.length > _EXPLAIN_MAX_LEN) {
      aiText = aiText.slice(0, _EXPLAIN_MAX_LEN - 1) + '…';
    }
  } catch (e) {
    console.warn('[explainErr]', e);
    showToast('KI gerade nicht verf\xfcgbar — versuch es sp\xe4ter.', 'error');
    // Button zurueck auf ready (KEIN Counter-Increment).
    row.innerHTML = `
      <button class="explain-btn explain-btn-ready"
              title="Lass dir von der KI erkl\xe4ren, warum diese Antwort falsch war."
              onclick="window.LF.requestErrorExplanation('${escapeHtml(qId).replace(/'/g, '&#39;')}')">
        \u{1F916} Erkl\xe4r mir warum
      </button>`;
    return;
  }

  // Success: Counter +1, lokales userData mutieren, Cache schreiben (best-effort).
  _incrementExplainCountToday();
  userData = userData || {};
  if (!userData.errorExplanations) userData.errorExplanations = {};
  userData.errorExplanations[qId] = { explanation: aiText, generatedAt: Date.now() };
  if (currentUser && !isClaudeAccount() && !isHackerAccount()) {
    saveErrorExplanation(currentUser.uid, qId, aiText).catch(e => console.warn('[saveExplain]', e));
  }
  // Re-render der Row (state: cached, expanded).
  const safeQid = escapeHtml(qId).replace(/'/g, '&#39;');
  row.innerHTML = `
    <button class="explain-btn explain-btn-toggle" onclick="window.LF.toggleErrorExplanation('${safeQid}')">
      <span class="explain-btn-label">Erkl\xe4rung ausblenden</span>
      <span class="explain-btn-caret">▲</span>
    </button>
    <div class="explain-body">
      ${escapeHtml(aiText)}
      <div class="explain-disclaimer">KI-Erkl\xe4rung — kann Fehler enthalten.</div>
    </div>`;
}

function toggleErrorExplanation(qId) {
  if (!qId) return;
  const row = document.querySelector(`.explain-row[data-explain-qid="${CSS.escape(qId)}"]`);
  if (!row) return;
  const body  = row.querySelector('.explain-body');
  const label = row.querySelector('.explain-btn-label');
  const caret = row.querySelector('.explain-btn-caret');
  if (!body) return;
  const wasCollapsed = body.classList.contains('explain-body--collapsed');
  body.classList.toggle('explain-body--collapsed');
  if (label) label.textContent = wasCollapsed ? 'Erkl\xe4rung ausblenden' : 'Erkl\xe4rung anzeigen';
  if (caret) caret.textContent = wasCollapsed ? '▲' : '▼';
}

// Wave-4 (Maya/Bereich-3): Celebration-Block fuer Note 1-2, Empathie-Banner fuer 4-6.
// Note 3 bleibt ohne Celebration — improvementBanner deckt das ab.
// Confetti-Punkte nutzen 4 verschiedene Status-Variable, sodass jedes Theme
// eigene Konfetti-Farben hat (keine hardcoded green/yellow).
function _renderCelebrationBlock(grade, xpEarned, isNewBest) {
  if (grade >= 4) {
    return `<div class="empathy-banner">Das war z\xe4h — aber genau daf\xfcr sind die Action-Cards unten.</div>`;
  }
  if (grade > 2) return '';
  const headline = grade === 1 ? '\u{1F389} Sehr gut!' : 'Gut gemacht!';
  const xpPill = xpEarned > 0
    ? `<span class="cb-xp-pill">+${escapeHtml(String(xpEarned))} XP</span>`
    : '';
  const confetti = grade === 1 ? '<div class="cb-confetti" aria-hidden="true"></div>' : '';
  const bestPill = isNewBest
    ? `<span class="cb-best-pill" title="Neue Bestleistung in diesem Thema">\u{1F3C6} Bestleistung</span>`
    : '';
  return `
    <div class="celebration-block celebration-block-grade${grade}">
      ${confetti}
      <div class="cb-header">
        <span class="cb-headline">${headline}</span>
        ${xpPill}
        ${bestPill}
      </div>
      <div class="cb-sub">Note ${escapeHtml(String(grade))}</div>
    </div>`;
}

function renderResults(questions, answers, results, grade, total, max, timeUsed, meta) {
  const mins = Math.floor(timeUsed/60);
  const secs = timeUsed % 60;
  const date = new Date().toLocaleDateString('de-DE');
  const pct  = Math.round(total/max*100);

  // V-22 (Casey, motivation): Vorher/Nachher-Vergleich anzeigen.
  // Note: kleinere Zahl = bessere Note (1 = beste, 6 = schlechteste).
  // Penalty (Tab-Wechsel = automatisch Note 6) blendet Banner aus —
  // der User sieht eh schon die rote Penalty-Bar.
  // Wave-4 (Maya/Bereich-3): zusätzlich "Neue Bestnote!"-Variante, wenn
  // newG strikt besser ist als jede Note in der Topic-History (history
  // schliesst den aktuellen Run NICHT mit ein, da grades[key].history erst
  // nach renderResults aktualisiert wird — der eben gespielte Run ist
  // hier prevAttempt). Maya: emotional staerkste Message in der App.
  let improvementBanner = '';
  let isNewBest = false;
  const subjectIdForKey = testState?.subjectId;
  const yearIdForKey    = testState?.yearId;
  const topicIdForKey   = testState?.topicId;
  const _gradeKey  = (subjectIdForKey && yearIdForKey && topicIdForKey)
    ? `${subjectIdForKey}__${yearIdForKey}__${topicIdForKey}`
    : null;
  const _gradeEntry = (_gradeKey && userData?.grades) ? userData.grades[_gradeKey] : null;
  const _topicNameForBanner = escapeHtml(meta.topicName || '');
  if (meta.prevAttempt && !meta.penalty) {
    const prevG = meta.prevAttempt.grade;
    const newG  = grade.grade;
    // V-27 (Ramsey, drive-by self-XSS sweep): prevG/newG kommen aus
    // grades.history[].grade (User-self-write erlaubt). Self-only,
    // aber escapeHtml gehört zum V-23-Sweep dazu.
    const safePrev = escapeHtml(String(prevG));
    const safeNew  = escapeHtml(String(newG));
    const history  = _gradeEntry?.history || [];
    const minHistoryGrade = history.length
      ? Math.min(...history.map(h => h.grade).filter(g => typeof g === 'number'))
      : Infinity;
    if (history.length > 0 && newG < minHistoryGrade) {
      isNewBest = true;
      // Wave-5b MED-2: Wenn newG <= 2 zeigt der celebration-block oben schon
      // den Trophy ("cb-best-pill"). Doppel-Trophy waere visuell redundant.
      // Trophy nur im Banner zeigen, wenn newG > 2 (= kein celebration-block).
      const trophyPrefix = newG > 2 ? '\u{1F3C6} ' : '';
      improvementBanner = `<div class="result-improvement-banner improvement-best">${trophyPrefix}Neue Bestnote in ${_topicNameForBanner}! Letztes Mal: Note ${safePrev}, jetzt: Note ${safeNew}.</div>`;
    } else if (newG < prevG) {
      improvementBanner = `<div class="result-improvement-banner">Verbesserung! Letztes Mal hattest du Note ${safePrev}, jetzt Note ${safeNew}.</div>`;
    } else if (newG === prevG) {
      improvementBanner = `<div class="result-constant-banner">Konstant — wieder Note ${safeNew}.</div>`;
    }
    // newG > prevG → kein Banner (demotiviert; Note ist schon sichtbar).
  }
  const celebrationBlock = _renderCelebrationBlock(grade.grade, meta.xpAwarded || 0, isNewBest);

  // F-09 Cycle-6: Konfidenz-vs-Realitaet-Banner. Maya-Spec-Mapping:
  //   Note 1 → Realitaet 5,  Note 2 → 4,  Note 3 → 3,
  //   Note 4 → 2,  Note 5 → 1,  Note 6 → 0
  // diff = confidence - reality (positiv = ueberschaetzt).
  let confidenceBanner = '';
  if (typeof meta.confidence === 'number'
      && meta.confidence >= 1 && meta.confidence <= 5
      && !meta.penalty) {
    const reality = Math.max(0, 6 - grade.grade);   // 6→0, 5→1, 4→2, 3→3, 2→4, 1→5
    const diff = meta.confidence - reality;
    let msg, extraClass = '';
    if (Math.abs(diff) <= 0.5) {
      msg = 'Genau richtig eingesch\xe4tzt — gutes Bauchgef\xfchl.';
    } else if (diff > 1.5) {
      msg = 'Konfidenz war deutlich zu hoch — lohnt sich, das Topic nochmal anzugucken.';
      extraClass = 'confidence-overestimate';
    } else if (diff > 0.5) {
      msg = 'Du hast dich leicht \xfcbersch\xe4tzt — n\xe4chstes Mal vorsichtiger.';
    } else { // diff < -0.5
      msg = 'Du kannst mehr als du denkst — trau dir was zu.';
    }
    confidenceBanner = `
      <div class="confidence-result-banner ${extraClass}">
        <div class="confidence-banner-title">Selbsteinsch\xe4tzung vs Realit\xe4t</div>
        <div class="confidence-banner-row"><span>Selbsteinsch\xe4tzung</span><strong>${meta.confidence} / 5</strong></div>
        <div class="confidence-banner-row"><span>Tats\xe4chlich</span><strong>Note ${grade.grade} (= ${reality}/5)</strong></div>
        <div class="confidence-banner-msg">${msg}</div>
      </div>`;
  }

  const resultItems = questions.map((q, i) => {
    const r   = results[i];
    const pts = r.points || 0;
    const cls = pts === r.maxPoints ? 'full' : pts > 0 ? 'partial' : 'zero';
    const answerText = q.type === 'multiple_choice'
      ? (q.shuffledOptions?.[parseInt(answers[i])] || '(keine Wahl)')
      : (answers[i] || '(keine Antwort)');
    return `
      <div class="result-item">
        <div class="r-header">
          <div class="r-question">${escapeHtml(q.question || '')}</div>
          <div class="r-pts ${cls}">${pts}/${r.maxPoints}</div>
        </div>
        <div class="r-answer">Antwort: ${escapeHtml(String(answerText || ''))}</div>
        <div class="r-feedback">${r.feedback}</div>
      </div>`;
  }).join('');

  // ── F-03 Fehler-Analyse ─────────────────
  const wrongQuestions = questions.filter((q, i) => (results[i].points || 0) < results[i].maxPoints);
  const wrongQIds      = wrongQuestions.map(q => q.id).filter(Boolean);

  if (wrongQIds.length > 0 && currentUser) {
    saveWeakQuestions(currentUser.uid, wrongQIds).catch(console.error);
  }

  // ── V-01 (Casey/Cycle-3): Falsche Fragen automatisch in SRS einreihen ──
  // Schliesst den groessten ungenutzten Lern-Asset-Loop. saveWeakQuestions
  // (Statistik-Counter) bleibt parallel — beide Pfade nebeneinander.
  // Schreib-Pfad: saveSRS nutzt set+merge (Hard Rule 4 ✔). Lokales Update
  // ist synchron, Firestore-Write async im Hintergrund — Banner-Count
  // basiert auf der lokalen Mutation.
  let srsAutoCount = 0;
  if (wrongQIds.length > 0 && currentUser) {
    userData = userData || {};
    if (!userData.srs) userData.srs = {};
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const todayStr    = today.toISOString().slice(0, 10);
    const topicKey    = `${testState?.subjectId || ''}__${testState?.yearId || ''}__${testState?.topicId || ''}`;

    // F-1 SRS-Boost: wenn das aktuelle Topic in einer ≤3-Tage-Klausur liegt,
    // werden neu/gepushte Karten heute statt morgen faellig.
    let isExamBoosted = false;
    try {
      const active = getActiveExamBoost();
      isExamBoosted = active.some(ex => (ex.topicIds || []).includes(topicKey));
    } catch (e) { isExamBoosted = false; }
    const dueDateStr = isExamBoosted ? todayStr : tomorrowStr;

    wrongQuestions.forEach(q => {
      if (!q.id) return; // skip ID-lose Fragen (existing wrongQIds.filter(Boolean)-Logik)
      const correctAnswer = q.type === 'multiple_choice'
        ? (q.options?.[q.correct] ?? '')                 // unshuffelte korrekte Option (SRS lebt laenger als Test)
        : (q.sampleAnswer || q.answer || '');
      const existing = userData.srs[q.id];
      if (existing) {
        // Edge-Case (Maya-Spec): bestehende SRS-Karte. Falls schon faellig
        // (nextReview <= today) → nichts tun (Banner zaehlt sie aber). Falls
        // nextReview > today → SM-2-Reset: gerade falsch beantwortet =
        // Vergessens-Beweis, also auf morgen vorziehen (q < 3-Pfad).
        // F-1: bei aktivem Klausur-Boost auf heute statt morgen.
        if (existing.nextReview && existing.nextReview > todayStr) {
          userData.srs[q.id] = {
            ...existing,
            question: q.question,
            answer: correctAnswer || existing.answer || '',
            topicKey: existing.topicKey || topicKey,
            interval: 1,
            repetitions: 0,
            ef: existing.ef ?? 2.5,
            nextReview: dueDateStr
          };
        }
        srsAutoCount++;
      } else {
        userData.srs[q.id] = {
          question: q.question,
          answer:   correctAnswer,
          topicKey,
          interval: 1,
          repetitions: 0,
          ef: 2.5,
          nextReview: dueDateStr
        };
        srsAutoCount++;
      }
    });

    if (srsAutoCount > 0) {
      saveSRS(currentUser.uid, userData.srs).catch(console.error);
    }
  }
  const srsAutoBanner = srsAutoCount > 0
    ? `<div class="srs-auto-banner">
         <div class="srs-auto-banner-icon">${lfIcon('brain')}</div>
         <div class="srs-auto-banner-text">
           <div class="srs-auto-banner-title">${srsAutoCount === 1 ? '1 Karte in deiner Wiederholungs-Kiste' : `${srsAutoCount} Karten in deiner Wiederholungs-Kiste`}</div>
           <div class="srs-auto-banner-sub">Wir sehen uns morgen.</div>
         </div>
         <button class="btn btn-secondary" onclick="location.hash='#/srs'">Jetzt \xfcben</button>
       </div>`
    : '';

  // F-3: per-render snapshot leeren — vorherige Result-Page-Render hat
  // moeglicherweise andere Fragen drin, die shuffled-Indices waeren stale.
  _explainContext = {};
  const wrongItems = questions.map((q, i) => {
    const r = results[i];
    if ((r.points || 0) === r.maxPoints) return '';
    const userAnswer = q.type === 'multiple_choice'
      ? (q.shuffledOptions?.[parseInt(answers[i])] || '(keine Wahl)')
      : (answers[i] || '(keine Antwort)');
    const correctAnswer = q.type === 'multiple_choice'
      ? (q.shuffledOptions?.[q.shuffledCorrectIndex] ?? q.options?.[q.correct] ?? '–')
      : (q.sampleAnswer || '— siehe Musterantwort im Lerninhalt');
    // F-3: Erklaer-Button. Nur wenn q.id existiert (alte Custom-Topic-Fragen
    // ohne ID haben keinen stabilen Cache-Key).
    const explainRow = q.id
      ? _renderExplainRow(q.id, q, userAnswer, correctAnswer, meta.subjectName, meta.topicName)
      : '';
    return `
      <div class="wrong-item">
        <div class="wrong-q">${escapeHtml(q.question || '')}</div>
        <div class="wrong-user">Deine Antwort: <span class="wrong-val">${escapeHtml(String(userAnswer || ''))}</span></div>
        <div class="wrong-correct">Richtige Antwort: <span class="correct-val">${escapeHtml(String(correctAnswer || ''))}</span></div>
        ${explainRow}
      </div>`;
  }).filter(Boolean).join('');

  const wrongSection = wrongItems
    ? `<div class="section-title" style="margin-top:28px">Was war falsch?</div>
       <div class="wrong-list">${wrongItems}</div>`
    : `<div class="all-correct-banner">Alle Aufgaben korrekt beantwortet!</div>`;

  // ── F-04 Retry-Button-State (V-02-aufgehoben, aber _wrongQuestions bleibt
  //   fuer evtl. Tools/Tests via testState-Inspect verfuegbar) ────────────
  testState._wrongQuestions = wrongQuestions;

  // ── V-02 (Casey/Cycle-3): Post-Test-Action-Cards ──────────────────────
  // Ersetzt die flachen 3 Buttons (Nochmal/Falsche/Zurueck) durch 3
  // kontextuelle Action-Cards. "Falsche Fragen nochmal ueben" geht in
  // V-01 SRS-Auto-Banner auf — separater Button hier weg.
  const subjectId = testState?.subjectId;
  const yearId    = testState?.yearId;
  const topicId   = testState?.topicId;
  const subject   = structure?.[subjectId];
  // Casey-Cycle-3-Befund: Card-2 darf nicht ein Englisch-Topic zeigen, wenn
  // gerade ein Mathe-Test gelaufen ist. → Erst fach-aware probieren (gleiches
  // Fach, aktuelles Topic ausgeschlossen). Wenn da nichts kommt (z.B. einziges
  // Topic im Fach), Fallback global. Wenn auch global nichts → Card-2 nicht
  // rendern (siehe Card-2-Block unten).
  const currentKey = (subjectId && yearId && topicId)
    ? `${subjectId}__${yearId}__${topicId}`
    : null;
  let recommendations = [];
  if (typeof getRecommendations === 'function') {
    if (subjectId) {
      recommendations = getRecommendations({ subjectFilter: subjectId, excludeKey: currentKey }) || [];
    }
    if (!recommendations.length) {
      recommendations = getRecommendations({ excludeKey: currentKey }) || [];
    }
  }
  const topRec = recommendations[0] || null;
  const nextTopic = (subjectId && yearId && topicId)
    ? getNextTopic(subjectId, yearId, topicId)
    : null;
  const safeSubjectName = escapeHtml(meta.subjectName || '');
  const safeTopicName   = escapeHtml(meta.topicName || '');
  const isLowGrade  = grade.grade >= 4 || meta.penalty;
  const isMidGrade  = grade.grade === 3;

  // Cycle-2-Ramsey P2-1: Action-Cards nutzen jetzt data-* + addEventListener
  // statt inline-onclick mit String-interpolierten Werten. Heute waeren die
  // Werte (subjectId/yearId/topicId aus repo-`structure`) zwar safe, aber
  // sobald Custom-Topics ihre eigenen IDs liefern (Future), waere ein
  // Apostroph in einer ID ein JS-Breakout-Vektor. data-* + delegierter
  // Listener (siehe nach innerHTML-Assign) loest das sauber — Werte werden
  // als reine Strings ausgelesen, kein Code-Path.

  // Card 1 — Lerninhalt nochmal lesen (immer)
  const card1Sub = isLowGrade
    ? `${safeTopicName} — fang an der Quelle an.`
    : `${safeTopicName} — vertiefe was du schon kannst.`;
  const card1Hash = (subjectId && yearId && topicId)
    ? `#/fach/${subjectId}/${yearId}/${topicId}`
    : '#/';
  const card1 = {
    key: 'read',
    html: (cls) => `
      <div class="${cls}" data-action="hash" data-hash="${escapeAttr(card1Hash)}">
        <div class="action-card-icon">${lfIcon('book-open')}</div>
        <div class="action-card-body">
          <div class="action-card-title">Lerninhalt nochmal lesen</div>
          <div class="action-card-sub">${card1Sub}</div>
        </div>
        <div class="action-card-arrow">›</div>
      </div>`
  };

  // Card 2 — Schwaechstes Subtopic (nur wenn ≥1 Recommendation existiert)
  let card2 = null;
  if (topRec) {
    const recSubject = structure?.[topRec.subjectId];
    const recSubjectName = escapeHtml(recSubject?.name || topRec.subjectId);
    const recTopicName   = escapeHtml(topRec.topic?.name || topRec.topicId);
    const recReason      = escapeHtml(topRec.reason || '');
    const recHash        = `#/fach/${topRec.subjectId}/${topRec.yearId}/${topRec.topicId}`;
    card2 = {
      key: 'recommend',
      html: (cls) => `
        <div class="${cls}" data-action="hash" data-hash="${escapeAttr(recHash)}">
          <div class="action-card-icon">${lfIcon('target')}</div>
          <div class="action-card-body">
            <div class="action-card-title">\xdcbe dein schw\xe4chstes Subtopic</div>
            <div class="action-card-sub">${recReason} · ${recSubjectName} · ${recTopicName}</div>
          </div>
          <div class="action-card-arrow">›</div>
        </div>`
    };
  }

  // Card 3 — Probier das naechste Thema. Wenn kein next-Topic verfuegbar
  // (z.B. Mathe Klasse 9 = letztes Topic im Fach), Fallback "Wiederhole
  // ein altes Thema" auf ein bereits geuebtes Topic im gleichen Fach
  // (excl. aktuelles). Wenn auch das nicht klappt → Card-3 weglassen statt
  // Quatsch zeigen (Casey-Cycle-3-Befund).
  let card3 = null;
  if (nextTopic) {
    const nextTopicName = escapeHtml(nextTopic.topic?.name || nextTopic.topicId);
    const nextSubjectName = escapeHtml(nextTopic.subject?.name || subject?.name || '');
    const classMatch = /^Klasse[-_]?(\d+)$/i.exec(nextTopic.yearId);
    const card3Sub = nextTopic.sameYear
      ? `${nextSubjectName} · ${nextTopicName}`
      : (classMatch
          ? `${nextSubjectName} · Klasse ${classMatch[1]} · ${nextTopicName}`
          : `${nextSubjectName} · ${nextTopicName}`);
    const nextHash = `#/fach/${nextTopic.subjectId}/${nextTopic.yearId}/${nextTopic.topicId}`;
    card3 = {
      key: 'next',
      html: (cls) => `
        <div class="${cls}" data-action="hash" data-hash="${escapeAttr(nextHash)}">
          <div class="action-card-icon" aria-hidden="true">→</div>
          <div class="action-card-body">
            <div class="action-card-title">Probier das n\xe4chste Thema</div>
            <div class="action-card-sub">${card3Sub}</div>
          </div>
          <div class="action-card-arrow">›</div>
        </div>`
    };
  } else if (subjectId && subject) {
    // Fallback: schon geuebtes Topic im gleichen Fach, nicht aktuelles.
    const grades = userData?.grades || {};
    let fallbackEntry = null;
    Object.values(subject.years || {}).forEach(year => {
      Object.values(year.topics || {}).forEach(topic => {
        const k = `${subject.id}__${year.id}__${topic.id}`;
        if (k === currentKey) return;
        if (!grades[k]) return;
        if (!fallbackEntry) fallbackEntry = { yearId: year.id, topicId: topic.id, topic, year };
      });
    });
    if (fallbackEntry) {
      const repTopicName = escapeHtml(fallbackEntry.topic?.name || fallbackEntry.topicId);
      const repSubjectName = escapeHtml(subject?.name || subjectId);
      const repHash = `#/fach/${subjectId}/${fallbackEntry.yearId}/${fallbackEntry.topicId}`;
      card3 = {
        key: 'repeat',
        html: (cls) => `
          <div class="${cls}" data-action="hash" data-hash="${escapeAttr(repHash)}">
            <div class="action-card-icon" aria-hidden="true">${lfIcon('repeat')}</div>
            <div class="action-card-body">
              <div class="action-card-title">Wiederhole ein altes Thema</div>
              <div class="action-card-sub">${repSubjectName} · ${repTopicName}</div>
            </div>
            <div class="action-card-arrow">›</div>
          </div>`
      };
    }
  }

  // Wave-4 (Maya/Bereich-3): vierte Action-Card "Mit Freunden teilen" — nur
  // wenn User Freunde hat. Kopiert die Note in die Zwischenablage. Topic-Name
  // wandert in data-topic, Note in data-grade — Listener liest beide und ruft
  // shareGradeWithFriends auf. Kein onclick-String mit String-Args mehr
  // (P2-1 Hardening).
  let cardShare = null;
  const friendCount = (userData?.friendIds || []).length;
  if (friendCount > 0) {
    const safeTopicAttr = escapeAttr(meta.topicName || '');
    cardShare = {
      key: 'share',
      html: (cls) => `
        <div class="${cls}" data-action="share-grade" data-topic="${safeTopicAttr}" data-grade="${escapeAttr(grade.grade)}">
          <div class="action-card-icon">${lfIcon('users')}</div>
          <div class="action-card-body">
            <div class="action-card-title">Mit Freunden teilen</div>
            <div class="action-card-sub">Hab in ${safeTopicName} Note ${grade.grade} geschrieben! \u{1F389}</div>
          </div>
          <div class="action-card-arrow">›</div>
        </div>`
    };
  }

  // Reihenfolge je Note (Maya-Spec):
  //   Note 1-2: [3 → 2 → 1]  + Share am Ende (gute Note teilt man gern)
  //   Note 3:   [2 → 1 → 3]
  //   Note 4-6 / Penalty: [1 → 2 → 3]  (Share nicht — schlechte Note teilt man nicht)
  let order;
  if (isLowGrade)      order = [card1, card2, card3];
  else if (isMidGrade) order = [card2, card1, card3, cardShare];
  else                 order = [card3, card2, card1, cardShare];

  const visibleCards = order.filter(Boolean);
  const actionCardsHtml = visibleCards.length
    ? `<div class="section-title" style="margin-top:28px">Was als N\xe4chstes?</div>
       <div class="action-cards-grid">
         ${visibleCards.map((c, i) => c.html(i === 0 ? 'action-card-primary' : 'action-card')).join('')}
       </div>`
    : '';

  // Print-Items (DIN A4)
  const printItems = questions.map((q, i) => {
    const r = results[i];
    const answerText = q.type === 'multiple_choice'
      ? (q.shuffledOptions?.[parseInt(answers[i])] || '(keine Wahl)')
      : (answers[i] || '(keine Antwort)');
    return `
      <div class="print-question">
        <div class="print-q-header">
          <span class="print-q-num">Aufgabe ${i+1}</span>
          <span class="print-q-pts">${r.points}/${r.maxPoints} Punkte</span>
        </div>
        <div class="print-q-text">${escapeHtml(q.question || '')}</div>
        <div class="print-q-answer"><strong>Antwort:</strong> ${escapeHtml(String(answerText || ''))}</div>
        <div class="print-q-feedback"><strong>Feedback:</strong> ${r.feedback}</div>
      </div>`;
  }).join('');

  document.getElementById('testArea').innerHTML = `
    <div class="results-page">

      <!-- Bildschirm-Ansicht -->
      <div class="no-print">
        ${meta.penalty ? `<div class="penalty-banner">Tab-Wechsel während des Tests erkannt — automatisch Note 6 (Ungenügend)</div>` : ''}
        ${celebrationBlock}
        <div class="grade-display">
          <div class="grade-circle" style="background:${grade.color}">${grade.grade}</div>
          <div class="grade-label">${grade.label}</div>
          <div class="grade-points">${total} von ${max} Punkten · ${pct}%</div>
        </div>
        ${improvementBanner}
        ${confidenceBanner}
        ${srsAutoBanner}
        <div class="section-title">Aufgaben im Detail</div>
        <div class="results-list">${resultItems}</div>
        ${wrongSection}
        <div class="copy-section">
          <p>Fragen + Antworten kopieren — z.B. für ChatGPT-Feedback</p>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" onclick="window.LF.copyResults()">Kopieren</button>
            <button class="btn btn-secondary" onclick="window.LF.downloadPDF()">Als PDF speichern</button>
          </div>
        </div>
        ${actionCardsHtml}
        <div style="display:flex;gap:8px;margin-top:20px;flex-wrap:wrap">
          <button class="btn btn-secondary" onclick="window.LF.startTest('${testState.subjectId}','${testState.yearId}','${testState.topicId}')">
            Nochmal testen
          </button>
          <button class="btn btn-secondary" onclick="location.hash='#/fach/${testState.subjectId}/${testState.yearId}/${testState.topicId}'">Zum Thema</button>
          <button class="btn btn-ghost" onclick="location.hash='#/'">Zum Dashboard</button>
        </div>
      </div>

      <!-- Print / PDF-Ansicht (DIN A4) -->
      <div class="print-area">
        <div class="print-header">
          <div class="print-title">Test-Ergebnis</div>
          <div class="print-subtitle">${meta.subjectName} — ${meta.topicName}</div>
        </div>
        <div class="print-meta-row">
          <div class="print-meta-item"><span>Datum</span><strong>${date}</strong></div>
          <div class="print-meta-item"><span>Zeit</span><strong>${mins} min ${secs} s von ${meta.timeMinutes} min</strong></div>
          <div class="print-meta-item"><span>Punkte</span><strong>${total} / ${max} (${pct}%)</strong></div>
          <div class="print-meta-item">
            <span>Note</span>
            <strong class="print-grade-badge" style="background:${grade.color}">${grade.grade} — ${grade.label}</strong>
          </div>
        </div>
        <div class="print-divider"></div>
        <div class="print-questions">${printItems}</div>
        <div class="print-footer">Erstellt mit LearningForge</div>
      </div>

    </div>`;

  // Cycle-2-Ramsey P2-1: Delegierter Click-Listener fuer die Action-Cards.
  // Ersetzt die frueheren inline-onclick-Strings durch sauberes data-* +
  // addEventListener — keine String-Interpolation von potenziell unsicheren
  // Werten in JS-Code-Pfade. Container ist `.action-cards-grid`, Cards
  // tragen data-action="hash"|"share-grade" + zugehoerige data-*.
  const actionCardsGrid = document.getElementById('testArea').querySelector('.action-cards-grid');
  if (actionCardsGrid) {
    actionCardsGrid.addEventListener('click', (ev) => {
      const card = ev.target.closest('[data-action]');
      if (!card || !actionCardsGrid.contains(card)) return;
      const action = card.dataset.action;
      if (action === 'hash') {
        const h = card.dataset.hash || '#/';
        location.hash = h;
      } else if (action === 'share-grade') {
        const t = card.dataset.topic || '';
        const g = card.dataset.grade || '';
        if (typeof window.LF?.shareGradeWithFriends === 'function') {
          window.LF.shareGradeWithFriends(t, g);
        }
      }
    });
  }

  testState._copyText = generateCopyText(questions, answers, results, timeUsed, meta);

  // F5 (Casey/Wave-2): XP-Pop-In zentriert ueber der Note. Pattern wie
  // theme-drop-toast (Body-fixed, Animation), aber einfacher (nur XP-Zahl).
  // Fade nach 1.5s — schnell genug dass der User nicht warten muss, lang genug
  // zum Wahrnehmen.
  if (typeof meta.xpAwarded === 'number' && meta.xpAwarded > 0) {
    setTimeout(() => {
      const pop = document.createElement('div');
      pop.className = 'xp-pop-in';
      pop.textContent = `+${meta.xpAwarded} XP`;
      document.body.appendChild(pop);
      setTimeout(() => pop.remove(), 1700);
    }, 220);
  }
}

window.LF.copyResults = async () => {
  if (!testState?._copyText) return;
  await navigator.clipboard.writeText(testState._copyText).catch(() => {});
  showToast('Ergebnis kopiert!', 'success');
};

// ── F-04 Retry-Modus ─────────────────────
window.LF.startRetryTest = () => {
  const wrongQs = testState?._wrongQuestions;
  if (!wrongQs?.length) return;

  const shuffled = [...wrongQs].sort(() => Math.random() - 0.5).map(q => {
    if (q.type === 'multiple_choice' && q.options) {
      const indexed = q.options.map((opt, i) => ({ opt, correct: i === q.correct }));
      indexed.sort(() => Math.random() - 0.5);
      return { ...q, shuffledOptions: indexed.map(x => x.opt), shuffledCorrectIndex: indexed.findIndex(x => x.correct) };
    }
    return q;
  });

  uebenState = { questions: shuffled, current: 0, correct: 0 };

  document.getElementById('testArea').innerHTML = `
    <div style="margin-bottom:16px">
      <div class="badge" style="background:var(--accent-subtle);color:var(--accent);padding:6px 12px;border-radius:var(--radius-pill);font-size:13px;font-weight:600;display:inline-block">
        Wiederholung — ${shuffled.length} falsche Frage${shuffled.length !== 1 ? 'n' : ''}
      </div>
    </div>
    <div id="uebenArea"></div>`;

  renderUebenQuestion();
};

function updateProgress() {
  if (!testState) return;
  const answered = testState.answers.filter(a => a !== null).length;
  const pct = (answered / testState.questions.length) * 100;
  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = pct + '%';
  const prog = document.getElementById('qProgress');
  if (prog) prog.textContent = answered;
}

// ── Toast-Benachrichtigung ────────────────
function showToast(msg, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), type === 'error' ? 8000 : 3000);
}

// ── V11 (Casey/Wave-2): Toast mit Undo-Button ──
// 5s persistent Toast. onUndo wird gerufen wenn der User klickt; Toast verschwindet
// vorzeitig. Wenn der Timer ablaeuft ohne Klick, geschieht nichts (caller hat
// die Mutation schon vorher ausgefuehrt).
function showUndoToast(msg, onUndo, ms = 5000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast info toast-undo';
  const span = document.createElement('span');
  span.className = 'toast-undo-msg';
  span.textContent = msg;
  const btn = document.createElement('button');
  btn.className = 'toast-undo-btn';
  btn.type = 'button';
  btn.textContent = 'R\xfcckg\xe4ngig';
  let consumed = false;
  const remove = () => { if (toast.parentNode) toast.remove(); };
  btn.addEventListener('click', () => {
    if (consumed) return;
    consumed = true;
    try { onUndo && onUndo(); } catch (e) { console.warn('[showUndoToast]', e); }
    remove();
  });
  toast.appendChild(span);
  toast.appendChild(btn);
  container.appendChild(toast);
  setTimeout(() => { if (!consumed) remove(); }, ms);
}

// ── Hilfsfunktionen ───────────────────────
function gradeColor(grade) {
  const colors = { 1:'#10b981',2:'#22d3ee',3:'#f59e0b',4:'#f97316',5:'#ef4444',6:'#7f1d1d' };
  return colors[Math.round(grade)] || '#6366f1';
}

function avgGradeColor(avg) {
  return gradeColor(Math.round(avg));
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2,'0');
  const s = (seconds % 60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

function setCookie(name, val, days) {
  const exp = new Date(Date.now() + days*864e5).toUTCString();
  document.cookie = `${name}=${val};expires=${exp};path=/;SameSite=Lax`;
}

function getCookie(name) {
  return document.cookie.split('; ').find(r => r.startsWith(name+'='))?.split('=')[1] || null;
}

function translateFirebaseError(code) {
  const map = {
    'auth/user-not-found':    'Kein Konto mit dieser E-Mail gefunden.',
    'auth/wrong-password':    'Falsches Passwort.',
    'auth/email-already-in-use': 'Diese E-Mail ist bereits registriert.',
    'auth/weak-password':     'Passwort zu schwach (mind. 6 Zeichen).',
    'auth/invalid-email':     'Ungültige E-Mail-Adresse.',
    'auth/too-many-requests': 'Zu viele Versuche. Bitte warte kurz.'
  };
  return map[code] || 'Fehler: ' + code;
}

// ── Taschenrechner ────────────────────────
function mountCalculator() {
  if (document.getElementById('calcWidget')) return;
  const el = document.createElement('div');
  el.id = 'calcWidget';
  el.className = 'calc-widget';
  el.innerHTML = `
    <button class="calc-toggle-btn" onclick="window.LF.toggleCalc()">
      Taschenrechner <span id="calcArrow" class="notes-arrow open">${lfIcon('chevron-down')}</span>
    </button>
    <div class="calc-panel" id="calcPanel">
      <div class="calc-display">
        <div class="calc-expr-disp" id="calcExprDisp">0</div>
        <div class="calc-result-disp" id="calcResultDisp"></div>
      </div>
      <div class="calc-grid">
        <button class="calc-btn calc-clear" onclick="window.LF.calcClear()">C</button>
        <button class="calc-btn calc-fn"    onclick="window.LF.calcInput('(')">( </button>
        <button class="calc-btn calc-fn"    onclick="window.LF.calcInput(')')"> )</button>
        <button class="calc-btn calc-op"    onclick="window.LF.calcBack()">${lfIcon('delete')}</button>
        <button class="calc-btn calc-fn"    onclick="window.LF.calcInput('sqrt(')">√x</button>
        <button class="calc-btn calc-fn"    onclick="window.LF.calcInput('π')">π</button>
        <button class="calc-btn calc-fn"    onclick="window.LF.calcInput('^')">xⁿ</button>
        <button class="calc-btn calc-op"    onclick="window.LF.calcInput('/')">÷</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('7')">7</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('8')">8</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('9')">9</button>
        <button class="calc-btn calc-op"    onclick="window.LF.calcInput('*')">×</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('4')">4</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('5')">5</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('6')">6</button>
        <button class="calc-btn calc-op"    onclick="window.LF.calcInput('-')">−</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('1')">1</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('2')">2</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('3')">3</button>
        <button class="calc-btn calc-op"    onclick="window.LF.calcInput('+')">+</button>
        <button class="calc-btn calc-zero"  onclick="window.LF.calcInput('0')">0</button>
        <button class="calc-btn"            onclick="window.LF.calcInput('.')">.</button>
        <button class="calc-btn calc-eq"    onclick="window.LF.calcEval()">=</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

function unmountCalculator() {
  document.getElementById('calcWidget')?.remove();
  calcExpr = '';
}

// ── Tafelwerk ─────────────────────────────
let _twOpen = true;

function mountTafelwerk() {
  if (document.getElementById('twWidget')) return;
  const el = document.createElement('div');
  el.id = 'twWidget';
  el.className = 'calc-widget tw-widget';
  el.innerHTML = `
    <button class="calc-toggle-btn" onclick="window.LF.toggleTw()">
      Tafelwerk <span id="twArrow" class="notes-arrow open">${lfIcon('chevron-down')}</span>
    </button>
    <div class="calc-panel tw-panel" id="twPanel">
      <div class="tw-tabs">
        <button class="tw-tab active" onclick="window.LF.twTab(this,'tw-konstanten')">Konstanten</button>
        <button class="tw-tab" onclick="window.LF.twTab(this,'tw-formeln')">Formeln</button>
        <button class="tw-tab" onclick="window.LF.twTab(this,'tw-einheiten')">Einheiten</button>
        <button class="tw-tab" onclick="window.LF.twTab(this,'tw-perioden')">Periodensystem</button>
      </div>
      <div class="tw-body">
        <div id="tw-konstanten" class="tw-section">
          <table class="tw-table"><tbody>
            <tr><td>Lichtgeschwindigkeit</td><td><em>c</em> = 2,998 &times; 10<sup>8</sup> m/s</td></tr>
            <tr><td>Gravitationskonstante</td><td><em>G</em> = 6,674 &times; 10<sup>&minus;11</sup> N&middot;m&sup2;/kg&sup2;</td></tr>
            <tr><td>Erdbeschleunigung</td><td><em>g</em> = 9,81 m/s&sup2;</td></tr>
            <tr><td>Avogadro-Konstante</td><td><em>N</em><sub>A</sub> = 6,022 &times; 10<sup>23</sup> mol<sup>&minus;1</sup></td></tr>
            <tr><td>Planck-Konstante</td><td><em>h</em> = 6,626 &times; 10<sup>&minus;34</sup> J&middot;s</td></tr>
            <tr><td>Boltzmann-Konstante</td><td><em>k</em><sub>B</sub> = 1,381 &times; 10<sup>&minus;23</sup> J/K</td></tr>
            <tr><td>Elementarladung</td><td><em>e</em> = 1,602 &times; 10<sup>&minus;19</sup> C</td></tr>
            <tr><td>Elektrische Feldkonstante</td><td>&epsilon;<sub>0</sub> = 8,854 &times; 10<sup>&minus;12</sup> F/m</td></tr>
            <tr><td>Magnetische Feldkonstante</td><td>&mu;<sub>0</sub> = 4&pi; &times; 10<sup>&minus;7</sup> H/m</td></tr>
            <tr><td>Universelle Gaskonstante</td><td><em>R</em> = 8,314 J/(mol&middot;K)</td></tr>
            <tr><td>Ruhemasse Elektron</td><td><em>m</em><sub>e</sub> = 9,109 &times; 10<sup>&minus;31</sup> kg</td></tr>
            <tr><td>Ruhemasse Proton</td><td><em>m</em><sub>p</sub> = 1,673 &times; 10<sup>&minus;27</sup> kg</td></tr>
          </tbody></table>
        </div>
        <div id="tw-formeln" class="tw-section" style="display:none">
          <table class="tw-table"><tbody>
            <tr><th colspan="2">Mechanik</th></tr>
            <tr><td>Gleichf&ouml;rm. Bewegung</td><td><em>s</em> = <em>v</em> &middot; <em>t</em></td></tr>
            <tr><td>Beschleunigung</td><td><em>a</em> = &Delta;<em>v</em> / &Delta;<em>t</em></td></tr>
            <tr><td>Gleichm. beschl. Bew.</td><td><em>s</em> = &frac12;<em>at</em>&sup2;</td></tr>
            <tr><td>Kraft</td><td><em>F</em> = <em>m</em> &middot; <em>a</em></td></tr>
            <tr><td>Gewichtskraft</td><td><em>F</em><sub>G</sub> = <em>m</em> &middot; <em>g</em></td></tr>
            <tr><td>Arbeit</td><td><em>W</em> = <em>F</em> &middot; <em>s</em></td></tr>
            <tr><td>Leistung</td><td><em>P</em> = <em>W</em> / <em>t</em></td></tr>
            <tr><td>Kinetische Energie</td><td><em>E</em><sub>kin</sub> = &frac12;<em>mv</em>&sup2;</td></tr>
            <tr><td>Potentielle Energie</td><td><em>E</em><sub>pot</sub> = <em>mgh</em></td></tr>
            <tr><th colspan="2">Elektrik</th></tr>
            <tr><td>Ohmsches Gesetz</td><td><em>U</em> = <em>R</em> &middot; <em>I</em></td></tr>
            <tr><td>Elektrische Leistung</td><td><em>P</em> = <em>U</em> &middot; <em>I</em></td></tr>
            <tr><th colspan="2">W&auml;rmelehre</th></tr>
            <tr><td>W&auml;rmemenge</td><td><em>Q</em> = <em>m</em> &middot; <em>c</em> &middot; &Delta;<em>T</em></td></tr>
            <tr><th colspan="2">Optik</th></tr>
            <tr><td>Brechungsgesetz</td><td><em>n</em><sub>1</sub> sin&alpha; = <em>n</em><sub>2</sub> sin&beta;</td></tr>
            <tr><td>Linsengleichung</td><td>1/<em>f</em> = 1/<em>g</em> + 1/<em>b</em></td></tr>
          </tbody></table>
        </div>
        <div id="tw-einheiten" class="tw-section" style="display:none">
          <table class="tw-table"><tbody>
            <tr><th colspan="3">SI-Grundeinheiten</th></tr>
            <tr><td>L&auml;nge</td><td>Meter</td><td>m</td></tr>
            <tr><td>Masse</td><td>Kilogramm</td><td>kg</td></tr>
            <tr><td>Zeit</td><td>Sekunde</td><td>s</td></tr>
            <tr><td>Elektrische Stromst&auml;rke</td><td>Ampere</td><td>A</td></tr>
            <tr><td>Temperatur</td><td>Kelvin</td><td>K</td></tr>
            <tr><td>Stoffmenge</td><td>Mol</td><td>mol</td></tr>
            <tr><td>Lichts&auml;rke</td><td>Candela</td><td>cd</td></tr>
            <tr><th colspan="3">Abgeleitete Einheiten</th></tr>
            <tr><td>Kraft</td><td>Newton</td><td>N = kg&middot;m/s&sup2;</td></tr>
            <tr><td>Druck</td><td>Pascal</td><td>Pa = N/m&sup2;</td></tr>
            <tr><td>Energie</td><td>Joule</td><td>J = N&middot;m</td></tr>
            <tr><td>Leistung</td><td>Watt</td><td>W = J/s</td></tr>
            <tr><td>Spannung</td><td>Volt</td><td>V = W/A</td></tr>
            <tr><td>Widerstand</td><td>Ohm</td><td>&Omega; = V/A</td></tr>
            <tr><td>Frequenz</td><td>Hertz</td><td>Hz = 1/s</td></tr>
          </tbody></table>
        </div>
        <div id="tw-perioden" class="tw-section tw-perioden-section" style="display:none">
          <div class="tw-pse-note">Periodensystem (Hauptgruppen)</div>
          <div class="tw-pse-grid">${_buildPseGrid()}</div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
}

function _buildPseGrid() {
  const elements = [
    ['H','1','Wasserstoff'],['He','2','Helium'],
    ['Li','3','Lithium'],['Be','4','Beryllium'],['B','5','Bor'],['C','6','Kohlenstoff'],
    ['N','7','Stickstoff'],['O','8','Sauerstoff'],['F','9','Fluor'],['Ne','10','Neon'],
    ['Na','11','Natrium'],['Mg','12','Magnesium'],['Al','13','Aluminium'],['Si','14','Silicium'],
    ['P','15','Phosphor'],['S','16','Schwefel'],['Cl','17','Chlor'],['Ar','18','Argon'],
    ['K','19','Kalium'],['Ca','20','Calcium'],['Fe','26','Eisen'],['Cu','29','Kupfer'],
    ['Zn','30','Zink'],['Br','35','Brom'],['Ag','47','Silber'],['I','53','Iod'],
    ['Au','79','Gold'],['Hg','80','Quecksilber'],['Pb','82','Blei'],['U','92','Uran'],
  ];
  return elements.map(([sym, num, name]) =>
    `<div class="tw-elem" title="${name} (${num})"><div class="tw-elem-num">${num}</div><div class="tw-elem-sym">${sym}</div><div class="tw-elem-name">${name}</div></div>`
  ).join('');
}

function unmountTafelwerk() {
  document.getElementById('twWidget')?.remove();
  _twOpen = true;
}

// ── Tool-Konfiguration ────────────────────
let _toolsOverride = null;

async function loadToolsOverride() {
  if (_toolsOverride !== null) return _toolsOverride;
  try {
    const doc = await db().collection('appConfig').doc('subjectTools').get({ source: 'server' });
    _toolsOverride = doc.exists ? (doc.data().tools || {}) : {};
  } catch { _toolsOverride = {}; }
  return _toolsOverride;
}

function getSubjectTools(subjectId) {
  const base = structure?.[subjectId]?.tools || {};
  const over = (_toolsOverride || {})[subjectId] || {};
  return { ...base, ...over };
}

function safeCalcEval(expr) {
  if (!expr) return '';
  let e = expr
    .replace(/\^/g, '**')
    .replace(/π/g, 'Math.PI')
    .replace(/sqrt\(/g, 'Math.sqrt(');
  const stripped = e.replace(/Math\.(sqrt|PI)/g, '');
  if (/[^0-9+\-*/.() \s]/.test(stripped)) return 'Fehler';
  try {
    const r = Function('"use strict"; return (' + e + ')')();
    if (typeof r !== 'number' || !isFinite(r)) return 'Fehler';
    return String(Math.round(r * 1e10) / 1e10);
  } catch {
    return '';
  }
}

function updateCalcDisplay() {
  const disp = document.getElementById('calcExprDisp');
  const res  = document.getElementById('calcResultDisp');
  if (disp) disp.textContent = calcExpr || '0';
  if (res)  {
    const r = safeCalcEval(calcExpr);
    res.textContent = r && r !== calcExpr ? '= ' + r : '';
  }
}

window.LF.toggleCalc = () => {
  const panel = document.getElementById('calcPanel');
  const arrow = document.getElementById('calcArrow');
  if (!panel) return;
  // QA-fix (Sophie, 2026-05-09): inline style.display ist initial '' (leer),
  // CSS-Default ist 'none'. getComputedStyle liest den effektiv gerenderten Wert,
  // sonst First-Click-no-op weil wasOpen faelschlich true ist.
  const wasOpen = getComputedStyle(panel).display !== 'none';
  panel.style.display = wasOpen ? 'none' : 'block';
  // .notes-arrow.open rotates chevron-down 180deg → pfeil zeigt nach oben (Panel zu).
  // Wenn Panel jetzt offen ist → 'open' entfernen → chevron zeigt nach unten.
  if (arrow) arrow.classList.toggle('open', wasOpen);
};

window.LF.toggleTw = () => {
  const panel = document.getElementById('twPanel');
  const arrow = document.getElementById('twArrow');
  if (!panel) return;
  // QA-fix (Sophie, 2026-05-09): wie toggleCalc — getComputedStyle statt style.display
  // (CSS-Default ist 'none', inline-style initial leer → First-Click waere no-op).
  const wasOpen = getComputedStyle(panel).display !== 'none';
  panel.style.display = wasOpen ? 'none' : 'flex';
  if (arrow) arrow.classList.toggle('open', wasOpen);
};

window.LF.twTab = (btn, sectionId) => {
  document.querySelectorAll('.tw-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tw-section').forEach(s => s.style.display = 'none');
  btn.classList.add('active');
  const sec = document.getElementById(sectionId);
  if (sec) sec.style.display = 'block';
};

window.LF.calcInput = (val) => {
  if (calcExpr === '' && /^\d$/.test(val)) calcExpr = val;
  else calcExpr += val;
  updateCalcDisplay();
};

window.LF.calcClear = () => {
  calcExpr = '';
  updateCalcDisplay();
};

window.LF.calcBack = () => {
  calcExpr = calcExpr.slice(0, -1);
  updateCalcDisplay();
};

window.LF.calcEval = () => {
  const r = safeCalcEval(calcExpr);
  if (r && r !== 'Fehler') {
    calcExpr = r;
    updateCalcDisplay();
  } else {
    const res = document.getElementById('calcResultDisp');
    if (res) res.textContent = '= Fehler';
  }
};

// ── Test als PDF herunterladen ────────────
window.LF.downloadTestPDF = async (subjectId, yearId, topicId) => {
  const subject = structure?.[subjectId];
  const year    = subject?.years?.[yearId];
  const topic   = year?.topics?.[topicId];

  showToast('Testbogen wird generiert…', 'info');
  const meta = await getTopicMeta(subjectId, yearId, topicId);
  const contentForGemini = meta.subtopics?.length > 0
    ? meta.subtopics.map(st => st.content).join(' ')
    : meta.content;
  let questions = null;
  if (contentForGemini) {
    questions = await generateQuestionsWithGemini(contentForGemini, selectedTime);
  }
  if (!questions || questions.length === 0) {
    const allQ = await getTopicQuestions(subjectId, yearId, topicId);
    questions  = selectQuestions(allQ, selectedTime);
  }

  const totalPts = questions.reduce((s, q) =>
    s + (q.type === 'multiple_choice' ? (q.points || 2) : (q.maxPoints || 4)), 0);

  const questionBlocks = questions.map((q, i) => {
    const pts = q.type === 'multiple_choice' ? (q.points || 2) : (q.maxPoints || 4);
    if (q.type === 'multiple_choice') {
      const opts = (q.shuffledOptions || q.options || []).map((opt, j) =>
        `<div class="pdf-mc-opt">
           <span class="pdf-mc-box"></span>
           <span>${String.fromCharCode(65 + j)}) ${escapeHtml(opt || '')}</span>
         </div>`
      ).join('');
      return `
        <div class="pdf-question">
          <div class="pdf-q-header">
            <span class="pdf-q-num">Aufgabe ${i + 1}</span>
            <span class="pdf-q-pts">${pts} Punkt${pts !== 1 ? 'e' : ''}</span>
          </div>
          <div class="pdf-q-text">${escapeHtml(q.question || '')}</div>
          <div class="pdf-mc-options">${opts}</div>
        </div>`;
    } else {
      const lines = Math.max(4, Math.ceil(pts * 1.8));
      const lineHtml = Array(lines).fill('<div class="pdf-answer-line"></div>').join('');
      return `
        <div class="pdf-question">
          <div class="pdf-q-header">
            <span class="pdf-q-num">Aufgabe ${i + 1}</span>
            <span class="pdf-q-pts">${pts} Punkt${pts !== 1 ? 'e' : ''}</span>
          </div>
          <div class="pdf-q-text">${escapeHtml(q.question || '')}</div>
          <div class="pdf-answer-lines">${lineHtml}</div>
        </div>`;
    }
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Testbogen</title>
<style>
  /* Print = Theme-agnostisch by design — hardcoded colors fuer schwarzweiss-output. */
  @page { size: A4; margin: 20mm 20mm 20mm 20mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 11pt; color: #111; line-height: 1.5; }
  .pdf-header { border-bottom: 2.5px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .pdf-title  { font-size: 20pt; font-weight: 800; }
  .pdf-subtitle { font-size: 12pt; color: #444; margin-top: 3px; }
  .pdf-meta-row { display: flex; gap: 20px; margin: 12px 0 6px; }
  .pdf-meta-field { flex: 1; }
  .pdf-meta-label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; color: #777; margin-bottom: 4px; }
  .pdf-meta-line  { border-bottom: 1px solid #333; height: 20px; }
  .pdf-score-row  { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 10.5pt; }
  .pdf-score-box  { border: 1.5px solid #555; padding: 4px 14px; border-radius: 4px; }
  hr { border: none; border-top: 1px solid #ccc; margin: 16px 0; }
  .pdf-question   { margin-bottom: 22px; page-break-inside: avoid; }
  .pdf-q-header   { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
  .pdf-q-num      { font-weight: 700; font-size: 11.5pt; }
  .pdf-q-pts      { font-size: 10pt; color: #555; border: 1px solid #bbb; padding: 1px 8px; border-radius: 3px; }
  .pdf-q-text     { font-size: 11pt; margin-bottom: 10px; }
  .pdf-mc-options { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .pdf-mc-opt     { display: flex; align-items: center; gap: 10px; font-size: 10.5pt; }
  .pdf-mc-box     { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #444; border-radius: 50%; flex-shrink: 0; }
  .pdf-answer-lines { margin-top: 4px; }
  .pdf-answer-line  { border-bottom: 1px solid #aaa; height: 28px; margin-bottom: 0; }
  .pdf-footer { margin-top: 32px; text-align: center; font-size: 8pt; color: #999; border-top: 1px solid #eee; padding-top: 8px; }
</style>
</head>
<body>
  <div class="pdf-header">
    <div class="pdf-title">Testbogen</div>
    <div class="pdf-subtitle">${subject?.name || subjectId} &middot; ${year?.name || yearId} &middot; ${topic?.name || topicId}</div>
  </div>
  <div class="pdf-meta-row">
    <div class="pdf-meta-field">
      <div class="pdf-meta-label">Name</div>
      <div class="pdf-meta-line"></div>
    </div>
    <div class="pdf-meta-field">
      <div class="pdf-meta-label">Datum</div>
      <div class="pdf-meta-line"></div>
    </div>
    <div class="pdf-meta-field" style="max-width:110px">
      <div class="pdf-meta-label">Klasse</div>
      <div class="pdf-meta-line"></div>
    </div>
  </div>
  <div class="pdf-score-row">
    <span>Testzeit: ${selectedTime} Minuten</span>
    <div class="pdf-score-box">Punkte: _____ / ${totalPts} &nbsp;&nbsp;&nbsp; Note: _____</div>
  </div>
  <hr>
  ${questionBlocks}
  <div class="pdf-footer">LearningForge &middot; ${new Date().toLocaleDateString('de-DE')}</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) { showToast('Pop-up blockiert. Bitte Pop-ups erlauben.', 'error'); return; }
  win.document.write(html);
  win.document.close();
  setTimeout(() => win.print(), 400);
};

// ══════════════════════════════════════════
//  Phase 4 — Soziale Features
// ══════════════════════════════════════════

// ── Hilfsfunktionen ──────────────────────
function _relTime(date) {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60)    return 'gerade eben';
  if (diff < 3600)  return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  return `vor ${Math.floor(diff / 86400)} Tagen`;
}

function _avatar(photo, name) {
  // Attribut-XSS verhindern: photo kann ein User-controlled string sein.
  // escapeHtml escapt auch Quotes, sodass src="…" nicht ausbrechbar ist.
  return photo
    ? `<img src="${escapeHtml(photo)}" alt="" class="comment-avatar-img">`
    : `<span class="comment-avatar-letter">${escapeHtml((name || '?')[0].toUpperCase())}</span>`;
}

// Wave-4 (Maya/Bereich-5): Default-Avatar-Color aus uid-Hash. Stable per User
// (gleiche uid → immer gleiche Farbe), aber ueber 8 Buckets verteilt. Keine
// Backend-Roundtrips, kein persistierter State. Variablen werden als
// `var(--avatar-color-N)` aufgeloest, sodass jedes Theme eine eigene Palette
// haben koennte (heute: alle erben aus :root via inheritance — Hard-Rule-OK).
function _generateDefaultAvatarHsl(uid) {
  const s = String(uid || '');
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % 8;
  return `var(--avatar-color-${idx + 1})`;
}

// ── F-30: Freunde ─────────────────────────
async function renderFriends() {
  const app = document.getElementById('app');
  app.innerHTML = renderNav([{ label: 'Freunde' }]) + `
    <div class="page">
      ${[1,2,3].map(() => '<div class="sk-block" style="height:80px;margin-bottom:12px"></div>').join('')}
    </div>`;
  initNavCollapse();

  const myFriendIds = userData?.friendIds || [];
  const myRequests  = Object.entries(userData?.friendRequests || {});
  const friends     = await getFriendsData(myFriendIds);

  // Wave-1-Ramsey CHEAT-24: User-controlled Display-Name + Photo escapen.
  const reqHtml = myRequests.length ? `
    <div class="card" style="margin-bottom:20px">
      <div class="section-title" style="margin-bottom:16px">Anfragen (${myRequests.length})</div>
      ${myRequests.map(([fromUid, req]) => `
        <div class="friend-request-card">
          <div class="friend-avatar ${outlineFor(req)}">${_avatar(req.photo, req.name)}</div>
          <div class="friend-info">
            <div class="friend-name">${escapeHtml(req.name || '')} ${roleBadge(req.role)}</div>
            <div class="friend-sub">Möchte dein Freund sein</div>
          </div>
          <div class="friend-btns">
            <button class="btn btn-primary btn-sm"
              onclick="window.LF.acceptFriend('${escapeAttr(fromUid)}','${escapeAttr(req.name || '')}','${escapeAttr(req.photo || '')}')">Annehmen</button>
            <button class="btn btn-secondary btn-sm"
              onclick="window.LF.rejectFriend('${escapeAttr(fromUid)}')">Ablehnen</button>
          </div>
        </div>`).join('')}
    </div>` : '';

  const friendsHtml = friends.length
    ? friends.map(f => {
        const lv = calcLevel(f.xp || 0);
        return `
          <div class="friend-card">
            <div class="friend-avatar ${outlineFor(f)}">${_avatar(f.photo, f.name)}</div>
            <div class="friend-info">
              <div class="friend-name">${escapeHtml(f.name || '')} ${roleBadge(f.role)}</div>
              <div class="friend-sub">Lv. ${lv.level} — ${escapeHtml(lv.title || '')}</div>
            </div>
            <button class="btn btn-ghost btn-sm"
              onclick="window.LF.unfriendUser('${escapeAttr(f.uid)}','${escapeAttr(f.name || '')}')">Entfreunden</button>
          </div>`;
      }).join('')
    : renderEmptyState({
        icon: 'users',
        title: 'Noch keine Freunde',
        sub: 'Such oben nach deinem Klassenkameraden — Name reicht.',
        ctaLabel: 'Such-Feld fokussieren',
        ctaAction: "document.getElementById('friendSearch')?.focus()",
      });

  app.innerHTML = renderNav([{ label: 'Freunde' }]) + `
    <div class="page">
      <h1 class="page-title">Freunde</h1>
      ${reqHtml}
      <div class="card" style="margin-bottom:20px">
        <div class="section-title" style="margin-bottom:14px">Nutzer suchen</div>
        <input class="form-input" type="search" id="friendSearch" placeholder="Name eingeben…"
          oninput="window.LF.searchFriends(this.value)" autocomplete="off">
        <div id="friendSearchResults"></div>
      </div>
      <div class="card">
        <div class="section-title" style="margin-bottom:16px">Meine Freunde (${friends.length})</div>
        <div class="friends-list">${friendsHtml}</div>
      </div>
    </div>`;
  initNavCollapse();
}

// ── F-31: Aktivitäts-Feed ─────────────────
async function renderFeed() {
  const app = document.getElementById('app');
  app.innerHTML = renderNav([{ label: 'Feed' }]) + `
    <div class="page">
      ${[1,2,3,4].map(() => '<div class="sk-block" style="height:70px;margin-bottom:10px"></div>').join('')}
    </div>`;
  initNavCollapse();

  const friendIds = userData?.friendIds || [];
  if (!friendIds.length) {
    app.innerHTML = renderNav([{ label: 'Feed' }]) + `
      <div class="page">
        <h1 class="page-title">Aktivitäts-Feed</h1>
        <div class="card">
          <div class="empty-state">
            <p>Füge Freunde hinzu, um ihren Aktivitäts-Feed zu sehen.</p>
            <button class="btn btn-primary" onclick="location.hash='#/freunde'">Freunde hinzufügen</button>
          </div>
        </div>
      </div>`;
    initNavCollapse();
    return;
  }

  let entries = [];
  try { entries = await getFeedForFriends(friendIds); } catch { /* ignore */ }

  const entriesHtml = entries.length
    ? entries.map(e => {
        const time = e.createdAt?.toDate ? _relTime(e.createdAt.toDate()) : 'gerade eben';
        const icon = e.type === 'test'        ? lfIcon('pencil')
                   : e.type === 'achievement' ? lfIcon('medal')
                   : e.type === 'content'     ? lfIcon('book-open')
                   :                            lfIcon('zap');
        const name  = escapeHtml(e.payload?.name || '');
        const topic = escapeHtml(e.payload?.topic || '');
        const title = escapeHtml(e.payload?.title || '');
        const grade = escapeHtml(e.payload?.grade ?? '');
        // H7 (Casey/Wave-2): unbekannte Event-Types skip-rendern statt
        // generisches "war aktiv" anzuzeigen — das wirkte wie Filler-Content.
        let text;
        if (e.type === 'test') {
          text = `<strong>${name}</strong> hat <em>${topic}</em> mit Note <strong>${grade}</strong> abgeschlossen`;
        } else if (e.type === 'achievement') {
          text = `<strong>${name}</strong> hat das Achievement <em>${title}</em> erhalten`;
        } else if (e.type === 'content') {
          text = `<strong>${name}</strong> hat neuen Inhalt hochgeladen: <em>${topic}</em>`;
        } else {
          return ''; // unbekannter Event-Type → nicht rendern
        }
        return `
          <div class="feed-entry">
            <div class="feed-icon">${icon}</div>
            <div class="feed-body">
              <div class="feed-text">${text}</div>
              <div class="feed-time">${time}</div>
            </div>
          </div>`;
      }).filter(Boolean).join('') ||
      renderEmptyState({
        icon: 'zap',
        title: 'Hier wird was los, sobald deine Freunde lernen',
        sub: 'Füge mehr Freunde hinzu, dann erscheinen ihre Tests im Feed.',
        ctaLabel: 'Mehr Freunde finden',
        ctaAction: "location.hash='#/freunde'",
      })
    : renderEmptyState({
        icon: 'zap',
        title: 'Hier wird was los, sobald deine Freunde lernen',
        sub: 'Füge mehr Freunde hinzu, dann erscheinen ihre Tests im Feed.',
        ctaLabel: 'Mehr Freunde finden',
        ctaAction: "location.hash='#/freunde'",
      });

  app.innerHTML = renderNav([{ label: 'Feed' }]) + `
    <div class="page">
      <h1 class="page-title">Aktivitäts-Feed</h1>
      <div class="card">${entriesHtml}</div>
    </div>`;
  initNavCollapse();
}

// ── F-40: Lernplan — retired 2026-05-08 (Wave-2) ─────────
// Page hide per Maya-Decision-Spec lernplan-decision-2026-05-08.md.
// Echte Logik liegt jetzt in decideHeuteZuerstStep() (Dashboard-Card).
// Bookmark-Fallback: route()-else-Branch faengt #/lernplan auf Dashboard.

// ── F-46: Eltern-Bericht ─────────────────
async function renderShareReport(token) {
  document.getElementById('app').innerHTML = `
    <div style="max-width:640px;margin:0 auto;padding:24px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <span style="font-size:24px">&#x26A1;</span>
        <strong style="font-size:18px">LearningForge — Lernbericht</strong>
      </div>
      <div id="shareReportContent"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  // Mission 3: Eltern-Share laeuft jetzt ueber Cloud-Function. Server liefert
  // die kuratierte Subset (kein PII-Leak — Cheat #17 final geschlossen).
  // Shape: { name, klasse, totalGrades, avgGradePerSubject, xp, level,
  //          achievementsCount, streak, createdAt }
  let shareData;
  try { shareData = await cf.getParentShareReport(token); } catch (e) {
    console.warn('[share-report-cf]', e);
  }

  if (!shareData) {
    document.getElementById('shareReportContent').innerHTML =
      `<div class="empty-state"><div class="empty-icon">&#x1F517;</div>Link nicht gefunden oder abgelaufen.</div>`;
    return;
  }

  const safeName    = escapeHtml(shareData.name || 'Schüler');
  const safeKlasse  = shareData.klasse != null && _ALLOWED_KLASSEN.includes(String(shareData.klasse))
                      ? `Klasse ${escapeHtml(String(shareData.klasse))}` : '';
  const totalGrades = typeof shareData.totalGrades === 'number' ? shareData.totalGrades : 0;
  const avgPerSubject = shareData.avgGradePerSubject || {};
  // Gesamt-Ø aus den Per-Subject-Werten (gewichtet ueber count, falls geliefert)
  // — wenn nur {sid: avg} kommt, einfacher Mittelwert.
  let avgGrade = '&#8211;';
  const subjectKeys = Object.keys(avgPerSubject);
  if (subjectKeys.length) {
    let sum = 0, cnt = 0;
    for (const k of subjectKeys) {
      const v = avgPerSubject[k];
      if (typeof v === 'number') { sum += v; cnt += 1; }
      else if (v && typeof v.avg === 'number') { sum += v.avg * (v.count || 1); cnt += (v.count || 1); }
    }
    if (cnt > 0) avgGrade = (sum / cnt).toFixed(1);
  }
  const streak    = typeof shareData.streak === 'number' ? shareData.streak : 0;
  const xp        = typeof shareData.xp === 'number' ? shareData.xp : 0;
  const level     = typeof shareData.level === 'number' ? shareData.level : calcLevel(xp).level;
  const achCount  = typeof shareData.achievementsCount === 'number' ? shareData.achievementsCount : 0;

  const subjectRows = subjectKeys.map(sid => {
    const v = avgPerSubject[sid];
    const avg = typeof v === 'number' ? v : (v?.avg ?? 0);
    const count = typeof v === 'number' ? '–' : (v?.count ?? '–');
    const safeSid = (sid || '_').replace(/[^a-zA-Z0-9_-]/g, '');
    return `
    <tr>
      <td>${escapeHtml(safeSid)}</td>
      <td>${escapeHtml(String(count))}</td>
      <td><span class="grade-pill" style="background:${gradeColor(Math.round(avg))}">${avg.toFixed(1)}</span></td>
    </tr>`;
  }).join('');

  document.getElementById('shareReportContent').innerHTML = `
    <div class="share-report-box">
      <div class="share-report-header">
        <div class="profile-avatar-large" style="width:56px;height:56px;font-size:22px">${(safeName||'?')[0]}</div>
        <div>
          <div style="font-weight:700;font-size:18px">${safeName}</div>
          <div style="color:var(--text-muted);font-size:13px">${safeKlasse ? safeKlasse + ' &middot; ' : ''}Level ${level} &middot; ${xp} XP</div>
        </div>
      </div>
      <div class="stats-overview-grid" style="margin:16px 0">
        <div class="stat-overview-card">
          <div class="soc-val">${totalGrades}</div>
          <div class="soc-lbl">Tests</div>
        </div>
        <div class="stat-overview-card">
          <div class="soc-val">${avgGrade}</div>
          <div class="soc-lbl">&#216; Note</div>
        </div>
        <div class="stat-overview-card">
          <div class="soc-val">${streak}</div>
          <div class="soc-lbl">&#x1F525; Streak</div>
        </div>
        <div class="stat-overview-card">
          <div class="soc-val">${achCount}</div>
          <div class="soc-lbl">Erfolge</div>
        </div>
      </div>
      ${subjectRows ? `
        <div class="table-wrap">
          <table class="stats-table">
            <thead><tr><th>Fach</th><th>Tests</th><th>&#216; Note</th></tr></thead>
            <tbody>${subjectRows}</tbody>
          </table>
        </div>` : ''}
      <p style="margin-top:24px;font-size:12px;color:var(--text-muted)">
        Erstellt mit LearningForge &mdash; <a href="${location.origin}${location.pathname}">Kostenlos registrieren</a>
      </p>
    </div>`;
}

// ── F-34: Kommentare ──────────────────────
window.LF.loadComments = async () => {
  const area = document.getElementById('commentsList');
  if (!area || !_commentTopicKey) return;
  area.innerHTML = '<div class="comments-loading">Lade Kommentare…</div>';
  let comments = [];
  try { comments = await getComments(_commentTopicKey); } catch { /* ignore */ }

  if (!comments.length) {
    area.innerHTML = '<div class="empty-state" style="padding:20px 0"><p>Noch keine Kommentare. Sei der Erste!</p></div>';
    return;
  }
  area.innerHTML = comments.map(c => {
    const time      = c.createdAt?.toDate ? _relTime(c.createdAt.toDate()) : 'gerade eben';
    const likeCount = Object.keys(c.likes || {}).length;
    const liked     = !!(c.likes?.[currentUser?.uid]);
    const canDel    = c.uid === currentUser?.uid || isAdmin();
    const safeText  = escapeHtml(c.text || '');
    const safeName  = escapeHtml(c.name || 'Nutzer');
    return `
      <div class="comment-card" id="cmt_${c.id}">
        <div class="comment-avatar ${outlineFor(c)}">${_avatar(c.photo, c.name)}</div>
        <div class="comment-body">
          <div class="comment-header">
            <span class="comment-author">${safeName} ${roleBadge(c.role)}</span>
            <span class="comment-time">${time}</span>
          </div>
          <div class="comment-text">${safeText}</div>
          <div class="comment-actions">
            <button class="comment-like-btn ${liked ? 'liked' : ''}"
              onclick="window.LF.likeComment('${c.id}')">${lfIcon('heart')} ${likeCount || ''}</button>
            ${canDel ? `<button class="comment-delete-btn" onclick="window.LF.deleteCommentBtn('${c.id}')">Löschen</button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
};

window.LF.submitComment = async () => {
  const input = document.getElementById('commentInput');
  const text  = input?.value?.trim();
  if (!text || !_commentTopicKey) return;
  if (_blockClaudeWrite('Kommentieren')) return;
  // Red-Team #9: Debounce gegen Doppelklick + Konsolen-Spam.
  if (!_debounceCheck(`comment:${_commentTopicKey}`, 1500)) {
    showToast('Bitte einen Moment warten…', 'info');
    return;
  }
  const submitBtn = document.querySelector('[onclick*="submitComment"]');
  input.disabled = true;
  if (submitBtn) submitBtn.disabled = true;
  try {
    // Wave-5b HIGH-1: Marcus's Rules cross-checken request.resource.data.name
    // gegen users/uid.name. Wenn Auth.displayName != userData.name (Edge-Case),
    // schlaegt das silent fehl. userData.name first, dann fallbacks.
    await addComment(_commentTopicKey, currentUser.uid, userData?.name || currentUser.displayName || 'Nutzer', userData?.photoURL || currentUser.photoURL, text, userRole());
    input.value = '';
    await window.LF.loadComments();
  } catch (e) {
    showToast('Fehler beim Senden.', 'error');
  }
  input.disabled = false;
  if (submitBtn) setTimeout(() => { submitBtn.disabled = false; }, 1000);
};

window.LF.likeComment = async (commentId) => {
  if (!_commentTopicKey) return;
  if (_blockClaudeWrite('Liken')) return;
  const btn = document.querySelector(`#cmt_${commentId} .comment-like-btn`);
  try {
    const nowLiked = await toggleCommentLike(_commentTopicKey, commentId, currentUser.uid);
    await window.LF.loadComments();
  } catch { showToast('Fehler.', 'error'); }
};

window.LF.deleteCommentBtn = async (commentId) => {
  if (!_commentTopicKey) return;
  if (!confirm('Kommentar löschen?')) return;
  try {
    await deleteComment(_commentTopicKey, commentId);
    document.getElementById(`cmt_${commentId}`)?.remove();
  } catch { showToast('Fehler beim Löschen.', 'error'); }
};

// ── F-30: Freunde — window.LF Handler ─────
window.LF.searchFriends = async (query) => {
  const res = document.getElementById('friendSearchResults');
  if (!res) return;
  if (!query?.trim()) { res.innerHTML = ''; return; }
  res.innerHTML = '<div class="text-muted" style="padding:8px 0">Suche…</div>';
  const results = await searchUsers(query, currentUser.uid);
  if (!results.length) { res.innerHTML = '<div class="text-muted" style="padding:8px 0">Keine Nutzer gefunden.</div>'; return; }
  const myFriendIds  = userData?.friendIds || [];
  const myReqSentTo  = userData?.friendRequestsSent || [];
  // Wave-1-Ramsey CHEAT-24: Suchergebnisse escapen — Display-Name + Photo
  // sind User-controlled.
  res.innerHTML = results.map(u => {
    const isFriend  = myFriendIds.includes(u.uid);
    const isPending = myReqSentTo.includes(u.uid);
    return `
      <div class="friend-search-item">
        <div class="friend-avatar ${outlineFor(u)}">${_avatar(u.photo, u.name)}</div>
        <div class="friend-name" style="flex:1">${escapeHtml(u.name || '')} ${roleBadge(u.role)}</div>
        ${isFriend
          ? `<span class="badge badge-success">Freund</span>`
          : isPending
          ? `<span class="badge badge-muted">Angefragt</span>`
          : `<button class="btn btn-primary btn-sm"
               onclick="window.LF.sendFriendReq('${escapeAttr(u.uid)}','${escapeAttr(u.name || '')}','${escapeAttr(u.photo || '')}')">Hinzufügen</button>`}
      </div>`;
  }).join('');
};

window.LF.sendFriendReq = async (toUid, toName, toPhoto) => {
  if (_blockClaudeWrite('Freundesanfragen senden')) return;
  // Red-Team #9: 1000ms-Debounce verhindert Konsolen-Spam-Loops. Knopf wird
  // zusaetzlich fuer 1s deaktiviert (visuelles Feedback).
  if (!_debounceCheck(`friendReq:${toUid}`, 1500)) {
    showToast('Bitte einen Moment warten…', 'info');
    return;
  }
  const btn = document.querySelector(`button[onclick*="sendFriendReq('${toUid}'"]`);
  if (btn) { btn.disabled = true; setTimeout(() => { btn.disabled = false; }, 1000); }
  try {
    // Wave-5b HIGH-1: gleicher Pattern wie addComment — userData.name first,
    // damit Marcus's Rules-Cross-Check (request.resource.data.name == users/uid.name)
    // nicht silent fehlschlaegt bei Auth.displayName != userData.name.
    await sendFriendRequest(currentUser.uid, userData?.name || currentUser.displayName || 'Nutzer', userData?.photoURL || currentUser.photoURL, toUid, userRole());
    userData.friendRequestsSent = [...(userData.friendRequestsSent || []), toUid];
    showToast(`Anfrage an ${toName} gesendet.`, 'success');
    await window.LF.searchFriends(document.getElementById('friendSearch')?.value || '');
  } catch { showToast('Fehler beim Senden.', 'error'); }
};

window.LF.acceptFriend = async (fromUid, fromName, fromPhoto) => {
  if (_blockClaudeWrite('Freundesanfragen annehmen')) return;
  try {
    await acceptFriendRequest(currentUser.uid, fromUid);
    userData.friendIds = [...(userData.friendIds || []), fromUid];
    if (userData.friendRequests) delete userData.friendRequests[fromUid];
    showToast(`${fromName} ist jetzt dein Freund!`, 'success');
    renderFriends();
  } catch { showToast('Fehler.', 'error'); }
};

window.LF.rejectFriend = async (fromUid) => {
  try {
    await rejectFriendRequest(currentUser.uid, fromUid);
    if (userData.friendRequests) delete userData.friendRequests[fromUid];
    renderFriends();
  } catch { showToast('Fehler.', 'error'); }
};

window.LF.unfriendUser = async (friendUid, friendName) => {
  if (!confirm(`${friendName} entfreunden?`)) return;
  try {
    await unfriend(currentUser.uid, friendUid);
    userData.friendIds = (userData.friendIds || []).filter(id => id !== friendUid);
    showToast(`${friendName} entfernt.`, 'info');
    renderFriends();
  } catch { showToast('Fehler.', 'error'); }
};

// ── F-37: KI-Zusammenfassung ─────────────
window.LF.generateSummary = async () => {
  const btn = document.querySelector('.ai-summary-btn');
  const box = document.getElementById('aiSummaryBox');
  if (!btn || !box || !_tutorContext) return;
  btn.disabled = true;
  btn.textContent = 'KI denkt nach…';

  const cacheKey = _tutorContext.slice(0, 80);
  if (_summaryCache[cacheKey]) {
    box.innerHTML  = _summaryCache[cacheKey];
    box.style.display = 'block';
    btn.textContent   = 'KI-Zusammenfassung erstellen';
    btn.disabled      = false;
    return;
  }

  try {
    const text = await callAI(
      `Fasse den folgenden Lerninhalt in 3-5 kurzen, pr\xe4gnanten Stichpunkten auf Deutsch zusammen. Antworte nur mit den Stichpunkten, keine Einleitung:\n\n${_tutorContext.slice(0, 3000)}`,
      400
    );
    const html = '<ul>' + text.split('\n')
      .filter(l => l.trim())
      .map(l => `<li>${l.replace(/^[-*•]\s*/, '')}</li>`)
      .join('') + '</ul>';
    _summaryCache[cacheKey] = html;
    box.innerHTML     = html;
    box.style.display = 'block';
  } catch {
    box.innerHTML     = '<p style="color:var(--text-muted)">KI nicht verf\xfcgbar.</p>';
    box.style.display = 'block';
  }
  btn.textContent = 'KI-Zusammenfassung erstellen';
  btn.disabled    = false;
};

// ── F-38: KI-Tutor ───────────────────────
window.LF.tutorToggle = () => {
  const widget = document.getElementById('tutorWidget');
  if (widget) { unmountTutor(); return; }
  if (!_tutorContext) { showToast('Kein Lerninhalt f\xfcr dieses Thema.', 'info'); return; }
  _tutorChat = [
    { role: 'system', content: `Du bist ein hilfreicher Lernassistent. Thema: ${_tutorContext.slice(0, 1500)}` }
  ];
  mountTutor();
};

window.LF.tutorSend = async () => {
  const input = document.getElementById('tutorInput');
  const msg   = input?.value?.trim();
  if (!msg) return;
  input.value    = '';
  input.disabled = true;

  _tutorChat.push({ role: 'user', content: msg });
  renderTutorMessages();

  try {
    const reply = await callAIChat(_tutorChat, 400);
    _tutorChat.push({ role: 'assistant', content: reply });
  } catch {
    _tutorChat.push({ role: 'assistant', content: 'Entschuldigung, KI-Verbindung unterbrochen.' });
  }
  renderTutorMessages();
  input.disabled = false;
  input.focus();
};

// ── F-44: CSV-Export ─────────────────────
window.LF.exportGradesCSV = () => {
  const grades = userData?.grades || {};
  const rows   = [['Fach','Klasse','Thema','Note','Punkte','Max. Punkte','Datum']];
  Object.entries(grades).forEach(([key, g]) => {
    const [subjectId, yearId, topicId] = key.split('__');
    const subject = structure?.[subjectId];
    const year    = subject?.years?.[yearId];
    const topic   = year?.topics?.[topicId];
    const gp      = _gp(g);
    const date    = g.date?.seconds ? new Date(g.date.seconds*1000).toLocaleDateString('de-DE') : '–';
    rows.push([
      subject?.name || subjectId,
      year?.name    || yearId,
      topic?.name   || topicId,
      g.grade || '–',
      gp.pts,
      gp.max,
      date
    ]);
  });
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url; a.download = 'learningforge-noten.csv';
  a.click(); URL.revokeObjectURL(url);
};

// ── F-46: Share-Link ─────────────────────
window.LF.createShareLink = async () => {
  const btn   = document.querySelector('.share-link-card .btn-primary');
  const input = document.getElementById('shareLinkInput');
  if (!btn || !input) return;
  btn.disabled = true;
  btn.textContent = 'Wird erstellt…';
  try {
    const token = await createShareToken(currentUser.uid);
    const url   = `${location.origin}${location.pathname}#/bericht/${token}`;
    input.value = url;
    const copyBtn = document.getElementById('copyShareBtn');
    if (copyBtn) copyBtn.style.display = 'inline-flex';
    showToast('Link erstellt!', 'success');
  } catch(e) {
    console.error('[ShareLink]', e);
    showToast('Fehler beim Erstellen.', 'error');
  }
  btn.disabled    = false;
  btn.textContent = 'Link erstellen';
};

window.LF.copyShareLink = () => {
  const input = document.getElementById('shareLinkInput');
  if (!input?.value) return;
  navigator.clipboard.writeText(input.value)
    .then(() => showToast('Link kopiert!', 'success'))
    .catch(() => showToast('Kopieren nicht verf\xfcgbar.', 'error'));
};

// ── KI-Tutor-Knopf in Themenansicht ──────
window.LF.openTutor = () => window.LF.tutorToggle();

// ── Profil bearbeiten ────────────────────
let _pendingProfilePhotoURL = null;

window.LF.profileEditOpen = () => {
  _pendingProfilePhotoURL = null;
  // V3 (Casey/Wave-2): Header-Card (Avatar + Name + Klasse) sichtbar lassen,
  // damit der User sieht WER bearbeitet wird. Vorher wurde sie ebenfalls
  // versteckt — Form ohne Kontext wirkte wie eine separate Page.
  // Jetzt blenden wir nur Tabs + Tab-Content aus, das Edit-Form schiebt sich
  // unter die Header-Card.
  const tabs = document.querySelector('.profile-tabs');
  const tabContent = document.querySelector('.profile-tab-content');
  const form = document.getElementById('profileEditForm');
  if (tabs) tabs.style.display = 'none';
  if (tabContent) tabContent.style.display = 'none';
  if (form) form.style.display = '';
};

// Wave-3 (Maya/Bereich-4): Klick auf "Klasse nicht gesetzt"-Pill oeffnet das
// Edit-Sheet und fokussiert direkt das Klassen-Select.
window.LF.openProfileEditOnKlasse = () => {
  window.LF.profileEditOpen();
  setTimeout(() => document.getElementById('profileKlasseInput')?.focus(), 60);
};

window.LF.profileEditClose = () => {
  _pendingProfilePhotoURL = null;
  const tabs = document.querySelector('.profile-tabs');
  const tabContent = document.querySelector('.profile-tab-content');
  const form = document.getElementById('profileEditForm');
  if (tabs) tabs.style.display = '';
  if (tabContent) tabContent.style.display = '';
  if (form) form.style.display = 'none';
};

// Mission 8 Q1=C: window.LF.pickEmoji entfernt (Emoji-Picker abgeschafft).

// Wave-3 (Maya/Bereich-4): "Bild entfernen" im Profile-Edit-Sheet. Nutzt
// existing updateUserProfile() mit photoURL=null — Hard-Rule 5 ist sauber,
// weil set+merge im wrapper genutzt wird (kein delete()). Default-Avatar =
// Initial-Buchstabe greift dann automatisch.
window.LF.removeProfilePhoto = async () => {
  if (!currentUser) return;
  if (!confirm('Profilbild entfernen?')) return;
  try {
    const newName = document.getElementById('profileNameInput')?.value?.trim()
                 || userData?.name || currentUser.displayName || 'Nutzer';
    await updateUserProfile(currentUser.uid, newName, null);
    userData.photoURL = null;
    _pendingProfilePhotoURL = null;
    showToast('Profilbild entfernt.', 'success');
    renderProfile();
    window.LF.profileEditOpen();
  } catch(e) {
    console.error('[removeProfilePhoto]', e);
    showToast('Fehler beim Entfernen.', 'error');
  }
};

window.LF.handleProfileFile = async (input) => {
  const file = input.files?.[0];
  if (!file) return;
  try {
    const dataUrl = await _resizeProfileImage(file, 512);
    _pendingProfilePhotoURL = dataUrl;
    const preview = document.getElementById('profileAvatarPreview');
    if (preview) preview.innerHTML = `<img src="${dataUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`;
  } catch(e) {
    showToast(e.message, 'error');
  }
  input.value = '';
};

window.LF.saveProfile = async () => {
  const nameInput = document.getElementById('profileNameInput');
  const klInput   = document.getElementById('profileKlasseInput');
  const btn       = document.getElementById('profileSaveBtn');
  const newName   = nameInput?.value?.trim();
  const newKlasse = klInput ? parseInt(klInput.value, 10) : (userData?.klasse || null);
  if (!newName) { showToast('Name darf nicht leer sein.', 'error'); return; }
  // Red-Team #10: Klassen-Validator. Server-side rule check liegt bei Marcus,
  // hier defense-in-depth — verhindert Klasse '0' / 'GOAT' / Trailing-Space.
  if (newKlasse && !_ALLOWED_KLASSEN.includes(String(newKlasse))) {
    showToast('Ungueltige Klasse — erlaubt sind 5 bis 13.', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Speichern…';

  const photoURL = _pendingProfilePhotoURL ?? userData?.photoURL ?? currentUser.photoURL ?? null;
  try {
    await updateUserProfile(currentUser.uid, newName, photoURL);
    if (newKlasse) {
      // Mission 1: setUserKlasse mirroret zusätzlich auf leaderboard-Doc, damit
      // klassenspezifische Rangliste den User sofort einsortiert (statt erst nach
      // nächstem Test). String-standardisiert (Marcus' Design).
      await setUserKlasse(currentUser.uid, newKlasse);
      userData.klasse = String(newKlasse);
    }
    userData.name     = newName;
    userData.photoURL = photoURL;
    _pendingProfilePhotoURL = null;
    showToast('Profil gespeichert!', 'success');
    renderProfile();
  } catch(e) {
    console.error('[saveProfile]', e);
    showToast('Fehler beim Speichern.', 'error');
    btn.disabled    = false;
    btn.textContent = 'Speichern';
  }
};

// ════════════════════════════════════════════════════════════════
//  Inventar — Outlines + Themes
// ════════════════════════════════════════════════════════════════
// Mission 1: standalone renderInventory() ist obsolet — Route redirected zu
// #/profil?tab=inventar. Wird intern noch von selectOutline/selectTheme als
// "Tab neu zeichnen" benutzt: location.hash = same value triggert kein
// hashchange-Event, also direkt renderProfile() callen wenn wir schon dort sind.
function renderInventory() {
  if (location.hash.startsWith('#/profil')) {
    // Schon auf Profil → Tab neu rendern (Hash bleibt gleich, sonst kein Re-Render).
    renderProfile();
  } else {
    location.hash = '#/profil?tab=inventar';
  }
}

// Mission 7: Locked-Card Tap-Tooltip. Zeigt den langen Hint via showToast(info).
// Wird von onclick + onkeydown(Enter/Space) + onfocus auf Locked-Cards gerufen.
// `el` ist das DOM-Element (<div class="inv-card inv-locked-v2">).
// Debounce-Schutz fuer Focus-Events: Hint nur einmal pro Karte/3s zeigen.
let _lastLockedHintAt = 0;
let _lastLockedHintEl = null;
window.LF.showLockedHint = (el) => {
  if (!el) return;
  const hint = el.getAttribute('data-hint');
  if (!hint) return;
  const now = Date.now();
  if (el === _lastLockedHintEl && (now - _lastLockedHintAt) < 2500) return;
  _lastLockedHintEl = el;
  _lastLockedHintAt = now;
  showToast(hint, 'info');
};

// Red-Team #5 (defense in depth): jede Outline-/Theme-Auswahl muss vom User
// auch wirklich besessen sein (oder durch Level freigeschaltet). Verhindert
// dass ein Hacker uber die Konsole window.LF.selectOutline('cosmic') ruft
// ohne 'cosmic' jemals freigeschaltet zu haben. Server-Defense liegt bei Marcus.
window.LF.selectOutline = async (tierId) => {
  if (!currentUser) return;
  const tier = OUTLINE_TIERS.find(t => t.id === tierId);
  if (!tier) { showToast('Unbekannte Umrandung.', 'error'); return; }
  const owned = userData?.outlines || [];
  const lvl   = calcLevel(userData?.xp || 0).level;
  const isLevelUnlocked = lvl >= tier.level;
  const isOwned         = owned.includes(tierId);
  // Admin/Tester duerfen alles testen (siehe Inventar-Render Bypass).
  const bypass = isAdmin() || userData?.role === 'tester';
  if (!bypass && !isOwned && !isLevelUnlocked) {
    showToast('Diese Umrandung hast du noch nicht freigeschaltet.', 'error');
    return;
  }
  // Mission 3: erst Server-seitig unlocken (CF prueft Level), dann aktivieren.
  // Bypass-User (Admin/Tester) dürfen direkt aktivieren — Server würde es eh durchlassen.
  if (!isOwned && !bypass) {
    try {
      const r = await cf.unlockCosmetic('outline', tierId);
      if (!r?.unlocked) {
        showToast('Server: ' + (r?.reason || 'Unlock fehlgeschlagen.'), 'error');
        return;
      }
      userData.outlines = [...owned, tierId];
    } catch (e) {
      console.warn('[unlock-outline-cf]', e);
      showToast('Konnte Umrandung nicht freischalten.', 'error');
      return;
    }
  }
  userData.activeOutline = tierId;
  await setActiveOutline(currentUser.uid, tierId).catch(console.error);
  showToast('Umrandung ge&auml;ndert', 'success');
  renderInventory();
};

window.LF.selectTheme = async (themeId) => {
  if (!currentUser) return;
  const theme = THEMES.find(t => t.id === themeId);
  if (!theme) { showToast('Unbekanntes Theme.', 'error'); return; }
  const owned = userData?.themes || ['default'];
  const isOwned = owned.includes(themeId) || theme.default === true;
  const bypass  = isAdmin() || userData?.role === 'tester';
  if (!bypass && !isOwned) {
    showToast('Dieses Theme hast du noch nicht freigeschaltet.', 'error');
    return;
  }
  // Mission 3: Server-Unlock falls noch nicht owned (Drop-Gating laeuft via
  // users.themeDrops — siehe submitTest fuer den drop-write).
  if (!isOwned && !theme.default && !bypass) {
    try {
      const r = await cf.unlockCosmetic('theme', themeId);
      if (!r?.unlocked) {
        showToast('Server: ' + (r?.reason || 'Theme nicht freischaltbar.'), 'error');
        return;
      }
      userData.themes = [...owned, themeId];
    } catch (e) {
      console.warn('[unlock-theme-cf]', e);
      showToast('Konnte Theme nicht freischalten.', 'error');
      return;
    }
  }
  // Casey 3.2: Optimistic-UI — Theme sofort anwenden, Server-Save async.
  // Bei Fehler nicht zuruecksetzen, nur Toast (Sync beim naechsten Online-Start).
  userData.activeTheme = themeId;
  applyTheme(themeId);
  setActiveTheme(currentUser.uid, themeId)
    .then(() => showToast('Theme aktiviert', 'success'))
    .catch(e => {
      console.warn('[setActiveTheme]', e);
      showToast('Theme gespeichert (Sync erfolgt automatisch).', 'warn');
    });
  renderInventory();
};

// ════════════════════════════════════════════════════════════════
//  Testing-Tab (Admin + Tester) + Admin-Tab (nur Admin)
// ════════════════════════════════════════════════════════════════
// B7 (2026-05-08, Maya): Self-Grade-Setter im Testing-Bereich.
// Cascading-Dropdown Fach → Klasse → Thema → Note-Pill-Group.
// Sicht: tester + admin (siehe route()-Guard line 507). Schreibt nur in
// `currentUser`s userData.grades — keine Fremd-User-Modifikation.
let _testGradeDraft = { subjectId: '', yearId: '', topicId: '', grade: null };

function _testGradeKey(s, y, t) { return `${s}__${y}__${t}`; }

function _renderTesterGradeSection() {
  if (!structure || structure._configError) {
    return `<div class="testing-section">
      <div class="testing-section-title">&#128221; Eigene Noten setzen</div>
      <div class="text-muted" style="padding:8px 0">F&auml;cher werden geladen&hellip;</div>
    </div>`;
  }
  const d = _testGradeDraft;
  const subjects = Object.values(structure).filter(s => s && s.id);
  const subjectOpts = subjects.map(s =>
    `<option value="${escapeHtml(s.id)}" ${d.subjectId===s.id?'selected':''}>${escapeHtml(s.name)}</option>`
  ).join('');
  const subj  = d.subjectId ? structure[d.subjectId] : null;
  const years = subj ? Object.values(subj.years || {}) : [];
  const yearOpts = years.map(y =>
    `<option value="${escapeHtml(y.id)}" ${d.yearId===y.id?'selected':''}>${escapeHtml(y.name)}</option>`
  ).join('');
  const yr     = subj && d.yearId ? subj.years[d.yearId] : null;
  const topics = yr ? Object.values(yr.topics || {}) : [];
  const topicOpts = topics.map(t =>
    `<option value="${escapeHtml(t.id)}" ${d.topicId===t.id?'selected':''}>${escapeHtml(t.name)}</option>`
  ).join('');

  const canSave = d.subjectId && d.yearId && d.topicId && d.grade;
  const pillBtns = [1,2,3,4,5,6].map(n => {
    const active = d.grade === n;
    const style = active
      ? 'background:var(--accent);color:#fff;border-color:var(--accent)'
      : '';
    return `<button class="btn btn-secondary btn-sm" style="min-width:48px;${style}" onclick="window.LF.testGradeSetGrade(${n})">${n}</button>`;
  }).join('');

  // Bestehende Noten — aus userData.grades.
  const grades = userData?.grades || {};
  const gradeRows = Object.entries(grades).map(([key, g]) => {
    const [sid, yid, tid] = key.split('__');
    const subject = structure?.[sid];
    const year    = subject?.years?.[yid];
    const topic   = year?.topics?.[tid];
    const sName = escapeHtml(subject?.name || sid);
    const yName = escapeHtml(year?.name    || yid);
    const tName = escapeHtml(topic?.name   || tid);
    // Maya's Pro-Eintrag-Format: „{Fachname} · Klasse {n} · {Themenname} · Note {n}"
    const label = `${sName} &middot; Klasse ${yName} &middot; ${tName} &middot; Note ${parseInt(g.grade)||'?'}`;
    return `<div class="adm-grade-row">
      <span>${label}</span>
      <button class="btn btn-ghost btn-sm" title="Diese Note l&ouml;schen" onclick="window.LF.testGradeDelete('${escapeHtml(key)}')">${lfIcon('x')}</button>
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:8px">Noch keine Noten gesetzt.</div>';

  return `
    <div class="testing-section">
      <div class="testing-section-title">&#128221; Eigene Noten setzen</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
        Setze Noten direkt f&uuml;r deine eigenen Tests &mdash; zum Reproduzieren von Bugs.
      </div>
      <div class="form-group">
        <label class="form-label">Fach</label>
        <select class="form-input" id="tgSubject" onchange="window.LF.testGradeSetSubject(this.value)">
          <option value="">Fach w&auml;hlen&hellip;</option>
          ${subjectOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Klasse</label>
        <select class="form-input" id="tgYear" ${d.subjectId?'':'disabled'} onchange="window.LF.testGradeSetYear(this.value)">
          <option value="">Klasse w&auml;hlen&hellip;</option>
          ${yearOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Thema</label>
        <select class="form-input" id="tgTopic" ${d.yearId?'':'disabled'} onchange="window.LF.testGradeSetTopic(this.value)">
          <option value="">Thema w&auml;hlen&hellip;</option>
          ${topicOpts}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Note</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${pillBtns}</div>
      </div>
      <button class="btn btn-primary btn-sm" ${canSave?'':'disabled'} onclick="window.LF.testGradeSave()">Note speichern</button>
      <div class="adm-section-title" style="margin-top:20px">Bestehende Noten</div>
      <div class="adm-grade-list">${gradeRows}</div>
      ${Object.keys(grades).length ? `<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="window.LF.testGradeDeleteAll()">Alle Noten l&ouml;schen</button>` : ''}
    </div>`;
}

function renderTesting() {
  const isA = isAdmin();
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Testing' }])}
    <div class="page">
      <div class="page-header">
        <h1>&#129514; Testing-Bereich</h1>
        <div class="sub">${roleBadge(userRole())} ${isA ? 'Du hast Admin-Zugriff &mdash; volle Kontrolle.' : 'Du bist Tester &mdash; experimentiere mit deinen eigenen Stats.'}</div>
      </div>

      <div class="testing-section">
        <div class="testing-section-title">&#128202; Eigene Stats modifizieren</div>
        <div class="testing-grid">
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testSetXP(0)">XP zur&uuml;cksetzen</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testSetXP(1000)">+1000 XP</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testSetXP(10000)">+10k XP</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testSetXP(50000)">+50k XP (Lv 80+)</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testSetXP(150000)">+150k XP (Lv 100+)</button>
        </div>
      </div>

      ${_renderTesterGradeSection()}

      <div class="testing-section">
        <div class="testing-section-title">&#127912; Cosmetics</div>
        <div class="testing-grid">
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testUnlockAllThemes()">Alle Themes freischalten</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testUnlockAllOutlines()">Alle Outlines freischalten</button>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.testResetCosmetics()">Cosmetics zur&uuml;cksetzen</button>
        </div>
      </div>

      <div class="testing-section">
        <div class="testing-section-title">&#128293; Streak / Klasse</div>
        <div class="testing-grid">
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testSetStreak(7)">Streak: 7 Tage</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testSetStreak(30)">Streak: 30 Tage</button>
          <button class="btn btn-secondary btn-sm" onclick="window.LF.testSetStreak(100)">Streak: 100 Tage</button>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.testSetStreak(0)">Streak: 0</button>
        </div>
      </div>

      <div class="testing-section">
        <div class="testing-section-title">&#9851;&#65039; Reset / Wipe</div>
        <div class="testing-grid">
          <button class="btn btn-danger btn-sm" onclick="window.LF.testWipeGrades()">Alle Noten l&ouml;schen</button>
          <button class="btn btn-danger btn-sm" onclick="window.LF.testWipeAll()">Alles l&ouml;schen (User-Doc reset)</button>
        </div>
      </div>

      ${isA ? `
        <div class="testing-section admin-section">
          <div class="testing-section-title" style="color:var(--warning)">&#128081; ADMIN-Bereich</div>
          <div style="margin-bottom:12px">
            <input class="form-input" id="adminUserSearch" placeholder="Nutzer suchen (Name oder E-Mail)..." oninput="window.LF.adminSearchUsers(this.value)" style="margin-bottom:8px">
            <div id="adminUserResults"></div>
          </div>
        </div>` : ''}
    </div>`;
}

// ── Testing-Aktionen (eigener Account) ──────────────────
window.LF.testSetXP = async (xp) => {
  await adminPatchUser(currentUser.uid, { xp }).catch(e => { showToast(e.message, 'error'); throw e; });
  userData.xp = xp;
  showToast(`XP auf ${xp} gesetzt`, 'success');
  renderTesting();
};

window.LF.testUnlockAllThemes = async () => {
  await adminPatchUser(currentUser.uid, { themes: ALL_THEME_IDS }).catch(e => { showToast(e.message, 'error'); throw e; });
  userData.themes = ALL_THEME_IDS;
  showToast('Alle Themes freigeschaltet', 'success');
};

window.LF.testUnlockAllOutlines = async () => {
  const ids = OUTLINE_TIERS.map(t => t.id);
  await adminPatchUser(currentUser.uid, { outlines: ids }).catch(e => { showToast(e.message, 'error'); throw e; });
  userData.outlines = ids;
  showToast('Alle Outlines freigeschaltet', 'success');
};

window.LF.testResetCosmetics = async () => {
  await adminPatchUser(currentUser.uid, { themes: ['default'], outlines: [], activeOutline: null, activeTheme: 'default' }).catch(console.error);
  userData.themes = ['default'];
  userData.outlines = [];
  userData.activeOutline = null;
  userData.activeTheme = 'default';
  applyTheme('default');
  showToast('Cosmetics zur&uuml;ckgesetzt', 'info');
};

window.LF.testSetStreak = async (n) => {
  const today = new Date().toISOString().slice(0, 10);
  await adminPatchUser(currentUser.uid, { streakCount: n, lastStreakDate: today }).catch(console.error);
  userData.streakCount = n;
  showToast(`Streak: ${n}`, 'success');
};

window.LF.testWipeGrades = async () => {
  if (!confirm('Wirklich alle Noten l&ouml;schen?')) return;
  await adminPatchUser(currentUser.uid, { grades: {} }).catch(console.error);
  userData.grades = {};
  showToast('Alle Noten gel&ouml;scht', 'info');
};

// ── B7 — Tester Self-Grade Handlers (2026-05-08) ──────────────────────
window.LF.testGradeSetSubject = (sid) => {
  _testGradeDraft = { subjectId: sid || '', yearId: '', topicId: '', grade: null };
  if (location.hash.startsWith('#/testing')) renderTesting();
};
window.LF.testGradeSetYear = (yid) => {
  _testGradeDraft.yearId = yid || '';
  _testGradeDraft.topicId = '';
  _testGradeDraft.grade = null;
  if (location.hash.startsWith('#/testing')) renderTesting();
};
window.LF.testGradeSetTopic = (tid) => {
  _testGradeDraft.topicId = tid || '';
  // grade nicht zurücksetzen — User kann erst Topic wählen, dann Note klicken.
  if (location.hash.startsWith('#/testing')) renderTesting();
};
window.LF.testGradeSetGrade = (n) => {
  if (!_testGradeDraft.topicId) return; // pill nur klickbar wenn Topic gesetzt
  _testGradeDraft.grade = n;
  if (location.hash.startsWith('#/testing')) renderTesting();
};
window.LF.testGradeSave = async () => {
  const d = _testGradeDraft;
  if (!d.subjectId || !d.yearId || !d.topicId || !d.grade) return;
  const key = _testGradeKey(d.subjectId, d.yearId, d.topicId);
  // Maya: minimaler gradeObj-Shape für _gp()-Reader. bestPoints/bestMaxPoints
  // = 0/0 ist akzeptabel — Subject-Card-Avg-Display nutzt nur grade.
  const gradeObj = {
    grade:         d.grade,
    bestPoints:    0,
    bestMaxPoints: 0,
    lastTested:    Date.now()
  };
  try {
    const newGrades = { ...(userData?.grades || {}), [key]: gradeObj };
    await adminPatchUser(currentUser.uid, { grades: newGrades });
    userData.grades = newGrades;
    const subj = structure?.[d.subjectId];
    const topic = subj?.years?.[d.yearId]?.topics?.[d.topicId];
    const sName = subj?.name || d.subjectId;
    const tName = topic?.name || d.topicId;
    showToast(`Note gespeichert: ${sName} · ${tName} → Note ${d.grade}`, 'success');
    _testGradeDraft = { subjectId: '', yearId: '', topicId: '', grade: null };
    if (location.hash.startsWith('#/testing')) renderTesting();
  } catch(e) {
    console.error('[testGradeSave]', e);
    showToast('Fehler: ' + (e.message || 'Konnte nicht speichern'), 'error');
  }
};
window.LF.testGradeDelete = async (key) => {
  if (!key) return;
  try {
    // Hard Rule 4/5: kein update(), kein delete() — set+merge mit FieldValue.delete()
    // entfernt den Map-Key sauber ohne Race.
    await db().collection('users').doc(currentUser.uid).set({
      grades: { [key]: firebase.firestore.FieldValue.delete() }
    }, { merge: true });
    if (userData?.grades) delete userData.grades[key];
    showToast('Note gelöscht.', 'info');
    if (location.hash.startsWith('#/testing')) renderTesting();
  } catch(e) {
    console.error('[testGradeDelete]', e);
    showToast('Fehler: ' + (e.message || 'Konnte nicht löschen'), 'error');
  }
};
window.LF.testGradeDeleteAll = async () => {
  if (!confirm('Wirklich alle deine Noten löschen?')) return;
  try {
    await adminPatchUser(currentUser.uid, { grades: {} });
    userData.grades = {};
    showToast('Alle Noten gelöscht.', 'info');
    if (location.hash.startsWith('#/testing')) renderTesting();
  } catch(e) {
    console.error('[testGradeDeleteAll]', e);
    showToast('Fehler: ' + (e.message || 'Konnte nicht löschen'), 'error');
  }
};

window.LF.testWipeAll = async () => {
  if (!confirm('WARNUNG: Komplettes User-Doc reset (au&szlig;er name/email/role). Sicher?')) return;
  await adminPatchUser(currentUser.uid, {
    grades: {}, xp: 0, streakCount: 0, themes: ['default'], outlines: [],
    activeOutline: null, activeTheme: 'default', achievements: {}, srs: {}
  }).catch(console.error);
  showToast('User-Doc reset, lade neu...', 'info');
  setTimeout(() => location.reload(), 1500);
};

// ── Admin: User-Suche + Aktionen ───────────────────────
window.LF.adminSearchUsers = async (query) => {
  const res = document.getElementById('adminUserResults');
  if (!res) return;
  if (!query?.trim()) { res.innerHTML = ''; return; }
  res.innerHTML = '<div class="text-muted" style="padding:8px 0">Suche&hellip;</div>';
  try {
    const all = await getAllUsers();
    const q = query.toLowerCase().trim();
    const matches = all.filter(u =>
      (u.name||'').toLowerCase().includes(q) ||
      (u.email||'').toLowerCase().includes(q)
    ).slice(0, 10);
    if (!matches.length) { res.innerHTML = '<div class="text-muted">Keine Treffer.</div>'; return; }
    // Wave-1-Ramsey CHEAT-24: Admin-Search-Resultate escapen.
    res.innerHTML = matches.map(u => `
      <div class="friend-search-item" style="margin-bottom:6px">
        <div class="friend-avatar ${outlineFor(u)}">${_avatar(u.photoURL, u.name)}</div>
        <div class="friend-name" style="flex:1">
          ${escapeHtml(u.name || 'Unbekannt')} ${roleBadge(u.role)}
          <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(u.email || '')}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="window.LF.adminSetRole('${escapeAttr(u.uid)}', 'admin')">+Admin</button>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.adminSetRole('${escapeAttr(u.uid)}', 'tester')">+Tester</button>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.adminSetRole('${escapeAttr(u.uid)}', null)">Rolle entfernen</button>
          <button class="btn btn-${u.isBanned ? 'secondary' : 'danger'} btn-sm" onclick="window.LF.adminToggleBan('${escapeAttr(u.uid)}', ${!u.isBanned})">${u.isBanned ? 'Entsperren' : 'Sperren'}</button>
        </div>
      </div>`).join('');
  } catch(e) {
    console.error('[adminSearch]', e);
    res.innerHTML = `<div class="text-muted" style="color:var(--danger)">Fehler: ${e.message}</div>`;
  }
};

window.LF.adminSetRole = async (uid, role) => {
  try {
    await setUserRole(uid, role);
    showToast(`Rolle gesetzt: ${role || 'keine'}`, 'success');
    const q = document.getElementById('adminUserSearch')?.value;
    if (q) window.LF.adminSearchUsers(q);
  } catch(e) { showToast(e.message, 'error'); }
};

window.LF.adminToggleBan = async (uid, ban) => {
  try {
    await setBanStatus(uid, ban);
    showToast(ban ? 'Gesperrt' : 'Entsperrt', 'info');
    const q = document.getElementById('adminUserSearch')?.value;
    if (q) window.LF.adminSearchUsers(q);
  } catch(e) { showToast(e.message, 'error'); }
};

// ── Bug-Reports ─────────────────────────────────────────
window.LF.openBugReport = () => {
  if (document.getElementById('bugReportOverlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'kb-overlay';
  overlay.id = 'bugReportOverlay';
  overlay.addEventListener('click', ev => { if (ev.target === overlay) overlay.remove(); });
  overlay.innerHTML = `
    <div class="kb-dialog" style="max-width:480px">
      <h3>&#128027; Problem melden</h3>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:12px">
        Beschreibe was schiefgelaufen ist &mdash; Claude geht die Liste beim n&auml;chsten Test-Login durch.
      </p>
      <div class="form-group">
        <textarea class="form-input" id="bugReportText" rows="5"
          placeholder="z.B. 'Auf der Rangliste-Seite ist der XP-Tab abgeschnitten...'"></textarea>
      </div>
      <div id="bugReportErr" style="color:var(--danger);font-size:12px;min-height:16px;margin-bottom:8px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-secondary btn-sm" onclick="this.closest('.kb-overlay').remove()">Abbrechen</button>
        <button class="btn btn-primary btn-sm" onclick="window.LF.sendBugReport()">Absenden</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('bugReportText')?.focus(), 50);
};

window.LF.sendBugReport = async () => {
  const text = document.getElementById('bugReportText')?.value;
  const err  = document.getElementById('bugReportErr');
  if (!text?.trim()) { err.textContent = 'Bitte Beschreibung eingeben.'; return; }
  // Red-Team #9: Debounce gegen Bug-Report-Flood.
  if (!_debounceCheck('bugReport', 2000)) {
    err.textContent = 'Bitte einen Moment warten, bevor du erneut absendest.';
    return;
  }
  const submitBtn = document.querySelector('[onclick*="sendBugReport"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await submitBugReport(currentUser.uid,
      userData?.name || currentUser.displayName || 'Nutzer',
      userData?.photoURL || currentUser.photoURL || null,
      text);
    document.getElementById('bugReportOverlay')?.remove();
    showToast('Danke! Bug-Report abgesendet.', 'success');
    loadBugReportSection();
    if (isClaudeAccount()) loadClaudeBugList();
  } catch(e) {
    err.textContent = e.message || 'Konnte nicht abgesendet werden.';
    if (submitBtn) setTimeout(() => { submitBtn.disabled = false; }, 1000);
  }
};

window.LF.resolveBugReport = async (id) => {
  const note = prompt('Optional: kurze Notiz zur Lösung (wird im Log gespeichert):', '');
  if (note === null) return;
  try {
    await resolveBugReport(id, note || null);
    showToast('Als erledigt markiert.', 'success');
    loadBugReportSection();
    if (isClaudeAccount()) loadClaudeBugList();
  } catch(e) { showToast(e.message, 'error'); }
};

window.LF.deleteBugReport = async (id) => {
  if (!confirm('Bug-Report wirklich löschen?')) return;
  try {
    await deleteBugReport(id);
    showToast('Geloescht.', 'info');
    loadBugReportSection();
    if (isClaudeAccount()) loadClaudeBugList();
  } catch(e) { showToast(e.message, 'error'); }
};

// ── Cycle 2026-05-08 — F-1 / F-3 / F-4 window.LF-Bindings ────

// F-1 Klausur-Modal lifecycle
window.LF.openKlausurModal  = openKlausurModal;
window.LF.closeKlausurModal = closeKlausurModal;
window.LF.submitKlausur     = submitKlausur;
window.LF.deleteKlausur     = deleteKlausur;

// F-1 Modal-Form-Updates (re-render auf jeden Change, weil Topic-Liste
// vom (subject, klasse)-Pair abhaengt — kein partielles Update noetig).
window.LF.onKlausurDateChange = (val) => {
  if (!_klausurModalState) return;
  _klausurModalState.date = val;
  if (_klausurModalState.errors?.date) delete _klausurModalState.errors.date;
};
window.LF.onKlausurSubjectChange = (val) => {
  if (!_klausurModalState) return;
  _klausurModalState.subject = val;
  // Subject-Wechsel invalidiert die Topic-Auswahl.
  _klausurModalState.topicIds = [];
  if (_klausurModalState.errors?.subject) delete _klausurModalState.errors.subject;
  if (_klausurModalState.errors?.topicIds) delete _klausurModalState.errors.topicIds;
  _renderKlausurModalContent();
};
window.LF.onKlausurKlasseChange = (val) => {
  if (!_klausurModalState) return;
  _klausurModalState.klasse = val;
  // Klassen-Wechsel invalidiert die Topic-Auswahl (andere Year-Topics).
  _klausurModalState.topicIds = [];
  if (_klausurModalState.errors?.klasse) delete _klausurModalState.errors.klasse;
  if (_klausurModalState.errors?.topicIds) delete _klausurModalState.errors.topicIds;
  _renderKlausurModalContent();
};
window.LF.toggleKlausurTopic = (key) => {
  if (!_klausurModalState) return;
  const idx = _klausurModalState.topicIds.indexOf(key);
  if (idx >= 0) _klausurModalState.topicIds.splice(idx, 1);
  else          _klausurModalState.topicIds.push(key);
  if (_klausurModalState.errors?.topicIds) delete _klausurModalState.errors.topicIds;
};

// F-02 Cycle-6: Plan-Felder live-binden. Kein Re-Render auf jeden Tippen
// — User wuerde den Cursor verlieren. State direkt mutieren, Validierung
// laeuft erst beim Submit.
window.LF.onKlausurPlanStartChange = (val) => {
  if (!_klausurModalState) return;
  _klausurModalState.planStartDate = val || '';
  if (_klausurModalState.errors?.planStart) delete _klausurModalState.errors.planStart;
};
window.LF.onKlausurPlanMinChange = (val) => {
  if (!_klausurModalState) return;
  _klausurModalState.planMinutesPerDay = val || '';
  if (_klausurModalState.errors?.planMin) delete _klausurModalState.errors.planMin;
};

// F-3 KI-Erklaerung pro falscher Frage
window.LF.requestErrorExplanation = requestErrorExplanation;
window.LF.toggleErrorExplanation  = toggleErrorExplanation;

// Wave-4 (Maya/Bereich-3): Note-mit-Freunden-teilen-Handler. Kopiert eine
// kurze Mitteilung in die Zwischenablage (kein automatischer Direct-Share —
// User klebt das selbst in WhatsApp/Discord/etc, wo seine Freunde sind).
window.LF.shareGradeWithFriends = (topic, gradeNum) => {
  const t = String(topic ?? '');
  const g = String(gradeNum ?? '');
  const text = `Hab in ${t} Note ${g} geschrieben! \u{1F389} - LearningForge`;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('In Zwischenablage kopiert', 'success'))
      .catch(() => showToast('Kopieren fehlgeschlagen.', 'error'));
  } else {
    showToast('Zwischenablage nicht verf\xfcgbar.', 'error');
  }
};
