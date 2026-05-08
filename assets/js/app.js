// ══════════════════════════════════════════
//  LearningForge — App (Router + Seiten)
// ══════════════════════════════════════════

import { CONFIG } from './config.js';
import { getStructure, getTopicMeta, getTopicQuestions, getChangelog, idToName } from './scanner.js';
import { initPhysikSimulations } from './physik-sim.js';
import { auth, db, logout, getUserData, saveGrade, saveWeakQuestions, onAuthStateChanged, updateLeaderboard, getLeaderboard, resetLeaderboard, getAllUsers, setBanStatus, createGroup, joinGroupByCode, leaveGroup, kickFromGroup, getUserGroups, saveCustomTopic, getMyCustomTopics, getGroupCustomTopics, deleteCustomTopic, getCustomTopicById, toggleBookmark, saveNote, saveSRS, addStudyTime, saveXP, saveAchievements, incrementCounter, saveDailyScore, getDailyScores, saveFreezeDays, addComment, getComments, deleteComment, toggleCommentLike, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest, unfriend, getFriendsData, writeFeedEntry, getFeedForFriends, createShareToken, getShareData, getMultipleUserData, updateUserProfile, syncUserRole, setUserRole, unlockTheme, setActiveTheme, setActiveOutline, adminPatchUser, adminUnlockAllForUser, loginAsClaude, markAsClaude, loginAsHacker, markAsHacker, submitBugReport, getOpenBugReports, getMyBugReports, resolveBugReport, deleteBugReport, setUserKlasse, markOnboarded, watchBannedStatus } from './auth.js';
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
// Claude-Test-Account darf lesen + privat testen, aber NICHT in fuer andere
// User sichtbare State schreiben (Comments, Friend-Requests, Group-Joins,
// Group-Topic-Uploads). Returnt true wenn der Aufruf abgebrochen werden soll.
function _blockClaudeWrite(what = 'Diese Aktion') {
  if (!isClaudeAccount()) return false;
  showToast(`${what} ist f\xfcr den Claude-Test-Account deaktiviert (kein Spam in geteiltem State).`, 'info');
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
  if (userInfo.activeOutline) {
    const tier = OUTLINE_TIERS.find(t => t.id === userInfo.activeOutline);
    if (tier?.css) return tier.css;
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
      if (userData?.isBanned) {
        await logout();
        currentUser = null;
        userData    = null;
        loginBanError = true;
        route();
        return;
      }
      // Claude-Test-Account: localStorage-Email matched → idempotent markieren.
      // Mission 3: primaerer Pfad ueber CF (Email-Whitelist serverseitig); bei
      // CF-Fehler (offline / Region-Issue) Fallback auf direkten markAsClaude-Write.
      try {
        const raw = localStorage.getItem('lf_claude_creds');
        if (raw) {
          const cc = JSON.parse(raw);
          if (cc?.email === user.email && !userData?.isClaude) {
            try {
              await cf.markTestAccount('claude');
            } catch (e) {
              console.warn('[claude-mark-cf-fallback]', e);
              await markAsClaude(user.uid);
            }
            userData = { ...(userData || {}), isClaude: true, role: 'admin', name: userData?.name || 'Claude (Test)' };
          }
        }
      } catch(e) { console.warn('[claude-mark]', e); }
      // Hacker-Test-Account: gleiches Pattern wie Claude.
      try {
        const raw = localStorage.getItem('lf_hacker_creds');
        if (raw) {
          const cc = JSON.parse(raw);
          if (cc?.email === user.email && !userData?.isHacker) {
            try {
              await cf.markTestAccount('hacker');
            } catch (e) {
              console.warn('[hacker-mark-cf-fallback]', e);
              await markAsHacker(user.uid);
            }
            userData = { ...(userData || {}), isHacker: true, role: 'admin', name: userData?.name || 'Hacker (Test)' };
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
      // Theme anwenden (User-Doc → localStorage-Fallback)
      try { applyTheme(userData?.activeTheme || getStoredTheme()); } catch(e) {}
      structure = await getStructure();
      getChangelog().then(entries => {
        changelog = entries;
        if (location.hash === '' || location.hash === '#/' || location.hash === '#') renderDashboard();
      });
      await loadToolsOverride();
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
  } else if (parts[0] === 'einstellungen') {
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
  } else if (parts[0] === 'lernplan') {
    renderLernplan();
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
                  onclick="${b.href ? `location.hash='${b.href}'` : ''}"
                  style="${b.href ? 'cursor:pointer' : 'cursor:default'}">${b.label}</span>
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
            ? `<img src="${userData?.photoURL || currentUser.photoURL}" alt="">`
            : (userData?.name || currentUser.displayName || 'U')[0].toUpperCase()
          }</div>
          <span class="uname">${(userData?.name || currentUser.displayName)?.split(' ')[0] || 'Nutzer'}${friendReqCount ? `<span class="nav-badge">${friendReqCount}</span>` : ''}</span>
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
      <div id="claudeSetupErr" style="color:#ef4444;font-size:12px;min-height:16px;margin-bottom:8px"></div>
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
      <div id="hackerSetupErr" style="color:#ef4444;font-size:12px;min-height:16px;margin-bottom:8px"></div>
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
          <div class="subject-card" style="--subject-color:${getSubjectColor(s.id)}"
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
async function loadBugReportSection() {
  const host = document.getElementById('bugReportSection');
  if (!host || !currentUser) return;
  let mine = [];
  try { mine = await getMyBugReports(currentUser.uid); } catch(e) { console.warn('[bugReports]', e); }
  const open  = mine.filter(b => !b.resolved);
  const closed = mine.filter(b =>  b.resolved).slice(0, 3);
  const row = (b) => `
    <div class="recent-item" style="--subject-color:${b.resolved ? '#16a34a' : '#f59e0b'}">
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
      <div class="install-card" style="margin-bottom:16px;border-left:3px solid #16a34a">
        <div class="install-card-icon">&#9989;</div>
        <div class="install-card-info">
          <div class="install-card-title">Keine offenen Bug-Reports</div>
          <div class="install-card-sub">Alles sauber &mdash; weiter mit normalem Testen.</div>
        </div>
      </div>`;
    return;
  }
  const fmt = (b) => `
    <div class="attention-item" style="--subject-color:#f59e0b;align-items:flex-start">
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
    <div class="section-title" style="margin-top:0;color:#f59e0b">
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

  const years = Object.values(subject.years || {});
  const grades = userData?.grades || {};

  const yearCards = years.length === 0
    ? `<div class="empty-state"><div class="empty-icon">${lfIcon('calendar')}</div>Noch keine Klassen vorhanden.</div>`
    : years.map(y => {
        const topicCount = Object.keys(y.topics || {}).length;
        const doneCount  = Object.keys(y.topics || {}).filter(tid => grades[`${subjectId}__${y.id}__${tid}`]).length;
        return `
          <div class="year-card" onclick="location.hash='#/fach/${subjectId}/${y.id}'">
            <div class="y-name">${y.name}</div>
            <div class="y-count">${topicCount} Themen · ${doneCount} getestet</div>
          </div>`;
      }).join('');

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
  mountPomodoro();

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

  let lernenTab;
  if (meta.subtopics?.length > 0) {
    currentSubtopics = meta.subtopics;
    lernenTab = renderSubtopicGrid(meta.subtopics);
  } else if (meta.content) {
    currentSubtopics = null;
    lernenTab = `<div class="content-block"><div class="content-body">${meta.content}</div></div>
      <div class="ai-summary-area" id="aiSummaryArea">
        <button class="btn btn-ghost btn-sm ai-summary-btn" onclick="window.LF.generateSummary()">KI-Zusammenfassung erstellen</button>
        <div class="ai-summary-box" id="aiSummaryBox" style="display:none"></div>
      </div>`;
  } else {
    currentSubtopics = null;
    lernenTab = `<div class="empty-state" style="padding:40px">Kein Lerninhalt für dieses Thema vorhanden.</div>`;
  }

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
}

function renderSubtopicGrid(subtopics) {
  const cards = subtopics.map((st, i) => `
    <div class="subtopic-card" onclick="window.LF.openSubtopic(${i})">
      <div class="subtopic-index">${i + 1}</div>
      <div class="subtopic-info">
        <div class="subtopic-name">${st.name}</div>
        ${st.description ? `<div class="subtopic-desc">${st.description}</div>` : ''}
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
function getRecommendations() {
  const grades = userData?.grades || {};
  const all = [];
  Object.values(structure || {}).forEach(subject => {
    Object.values(subject.years || {}).forEach(year => {
      Object.values(year.topics || {}).forEach(topic => {
        const key = `${subject.id}__${year.id}__${topic.id}`;
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

// ── F-37/38: KI-Zusammenfassung & Tutor ──
async function callAI(prompt, maxTokens = 600) {
  if (CONFIG.groq?.apiKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.groq.apiKey}` },
        body:    JSON.stringify({
          model:       'llama-3.3-70b-versatile',
          messages:    [{ role: 'user', content: prompt }],
          max_tokens:  maxTokens,
          temperature: 0.7
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch {}
  }
  if (CONFIG.gemini?.apiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.gemini.apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch {}
  }
  throw new Error('Kein KI-Provider verf\xfcgbar');
}

async function callAIChat(messages, maxTokens = 400) {
  if (CONFIG.groq?.apiKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.groq.apiKey}` },
        body:    JSON.stringify({
          model:       'llama-3.3-70b-versatile',
          messages,
          max_tokens:  maxTokens,
          temperature: 0.7
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch {}
  }
  // Gemini-Fallback: messages → flacher Prompt (Gemini hat kein system/role)
  if (CONFIG.gemini?.apiKey) {
    try {
      const flat = messages.map(m =>
        m.role === 'system' ? `[Anleitung] ${m.content}`
        : m.role === 'user' ? `Sch\xfcler: ${m.content}`
        : `Tutor: ${m.content}`
      ).join('\n\n');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${CONFIG.gemini.apiKey}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: flat }] }] }) }
      );
      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (text) return text;
      }
    } catch {}
  }
  throw new Error('Kein KI-Provider verf\xfcgbar');
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

function getSubjectProgress(subjectId) {
  const subject    = structure?.[subjectId];
  const grades     = userData?.grades || {};
  const allTopics  = Object.values(subject?.years || {})
    .flatMap(y => Object.keys(y.topics || {}).map(tid => `${subjectId}__${y.id}__${tid}`));
  const tested     = allTopics.filter(k => grades[k]);
  const gradeVals  = tested.map(k => grades[k].grade).filter(Boolean);
  const avgGrade   = gradeVals.length ? gradeVals.reduce((a, b) => a + b, 0) / gradeVals.length : null;
  return { total: allTopics.length, tested: tested.length, avgGrade };
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
        `<button class="wc-opt" onclick="window.LF.wissensCheckMC('${topicKey}',${i},${j},${q.correct})" id="wcOpt_${topicKey}_${i}_${j}">${o}</button>`
      ).join('');
      return `<div class="wc-item" id="wcItem_${topicKey}_${i}">
        <div class="wc-q">${i+1}. ${q.question}</div>
        <div class="wc-opts">${opts}</div>
        <div class="wc-fb" id="wcFb_${topicKey}_${i}" style="display:none"></div>
      </div>`;
    }
    return `<div class="wc-item" id="wcItem_${topicKey}_${i}">
      <div class="wc-q">${i+1}. ${q.question}</div>
      <button class="btn btn-ghost btn-sm" onclick="window.LF.wissensCheckReveal('${topicKey}',${i})" id="wcRevealBtn_${topicKey}_${i}">Antwort anzeigen</button>
      <div class="wc-fb" id="wcFb_${topicKey}_${i}" style="display:none"><strong>${lfIcon('check', {cls:'sx-correct'})} ${q.answer || ''}</strong></div>
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

// ── Einstellungen-Seite ──────────────────
function renderSettings() {
  const subjects = Object.values(structure || {});

  const colorRows = subjects.map(s => {
    const current = getSubjectColor(s.id);
    return `
      <div class="settings-color-row">
        <div class="settings-subject-info">
          <span class="settings-icon">${getSubjectIcon(s.id)}</span>
          <span class="settings-name">${s.name}</span>
        </div>
        <div class="settings-color-right">
          <span class="settings-color-preview" id="preview_${s.id}"
                style="background:${current}"></span>
          <input type="color" class="color-picker" id="color_${s.id}"
                 value="${current}"
                 oninput="document.getElementById('preview_${s.id}').style.background=this.value">
          <button class="btn btn-ghost btn-sm" onclick="window.LF.resetColor('${s.id}','${s.color}')">
            Zurücksetzen
          </button>
        </div>
      </div>`;
  }).join('');

  const iconRows = subjects.map(s => {
    const hasUrl     = !!userData?.settings?.customIconUrls?.[s.id];
    const emojiVal   = userData?.settings?.customIcons?.[s.id] || s.icon;
    const previewHtml = hasUrl
      ? `<img class="subject-icon-img" src="${userData.settings.customIconUrls[s.id]}" alt="" style="width:36px;height:36px">`
      : emojiVal;
    return `
      <div class="settings-color-row">
        <div class="settings-subject-info">
          <span class="settings-icon" id="iconPreview_${s.id}">${previewHtml}</span>
          <span class="settings-name">${s.name}</span>
        </div>
        <div class="settings-color-right">
          <input type="text" class="form-input" id="icon_${s.id}"
                 value="${emojiVal}" maxlength="2" style="width:54px;text-align:center;font-size:20px"
                 oninput="window.LF.onEmojiInput('${s.id}',this.value)">
          <label class="btn btn-ghost btn-sm icon-upload-label" title="PNG hochladen (64×64)">
            ${lfIcon('folder')}
            <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none"
                   onchange="window.LF.handleIconFile('${s.id}',this)">
          </label>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.resetIcon('${s.id}','${s.icon}')">
            ↩
          </button>
        </div>
      </div>`;
  }).join('');

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Einstellungen' }])}
    <div class="page">
      <div class="page-header">
        <h1>${lfIcon('settings')} Einstellungen</h1>
        <div class="sub">Passe LearningForge nach deinen Wünschen an.</div>
      </div>

      <div class="settings-card">
        <div class="settings-section-title">${lfIcon('palette')} Fächerfarben</div>
        <p class="settings-hint">Die Farben werden nur für dein Konto gespeichert.</p>
        <div class="settings-color-list">
          ${subjects.length === 0
            ? `<div class="empty-state"><div class="empty-icon">${lfIcon('folder-open')}</div>Noch keine Fächer vorhanden.</div>`
            : colorRows}
        </div>
        ${subjects.length > 0 ? `
          <div class="settings-actions">
            <button class="btn btn-primary" onclick="window.LF.saveColors()">Farben speichern</button>
            <button class="btn btn-secondary" onclick="window.LF.resetAllColors()">Alle zurücksetzen</button>
          </div>` : ''}
      </div>

      <div class="settings-card" style="margin-top:16px">
        <div class="settings-section-title">Fach-Icons</div>
        <p class="settings-hint">Emoji eingeben oder eigenes PNG hochladen (wird auf 64×64 px skaliert).</p>
        <div class="settings-color-list">
          ${subjects.length === 0
            ? `<div class="empty-state"><div class="empty-icon">${lfIcon('folder-open')}</div>Noch keine Fächer vorhanden.</div>`
            : iconRows}
        </div>
        ${subjects.length > 0 ? `
          <div class="settings-actions">
            <button class="btn btn-primary" onclick="window.LF.saveIcons()">Icons speichern</button>
          </div>` : ''}
      </div>

      <div class="settings-card" style="margin-top:16px">
        <div class="settings-section-title">${lfIcon('contrast')} Darstellung</div>
        <div class="settings-color-row">
          <div class="settings-subject-info">
            <span class="settings-name">Hell oder Dunkel</span>
          </div>
          <div class="settings-color-right">
            <button class="btn btn-secondary" onclick="window.LF.toggleTheme()">
              ${document.documentElement.getAttribute('data-theme') === 'dark' ? `${lfIcon('sun')} Hell` : `${lfIcon('moon')} Dunkel`}
            </button>
          </div>
        </div>
      </div>
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

  const subjectCards = subjects.length === 0
    ? `<div class="empty-state"><div class="empty-icon">${lfIcon('folder-open')}</div>Noch keine Fächer vorhanden — füge Ordner unter <code>Fächer/</code> hinzu.</div>`
    : subjects.map(s => {
        const prog = getSubjectProgress(s.id);
        const pct  = prog.total > 0 ? prog.tested / prog.total : 0;
        const circ = 100.48;
        const dash = pct * circ;
        return `
          <div class="subject-card" style="--subject-color:${getSubjectColor(s.id)}"
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
            ${prog.avgGrade ? `<div class="s-avg-grade" style="background:${avgGradeColor(prog.avgGrade)}">${prog.avgGrade.toFixed(1)}</div>` : ''}
          </div>`;
      }).join('');

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Lernen' }])}
    <div class="page">
      <div class="page-header">
        <h1>${lfIcon('book-open')} Lernen</h1>
        <div class="sub">Deine Lern-Aktionen auf einen Blick.</div>
      </div>

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

  const dots = (active) => {
    const total = 4;
    return `<div class="wizard-progress-dots">${
      Array.from({length: total}, (_, i) => `<span class="wp-dot ${i+1 <= active ? 'wp-active' : ''}"></span>`).join('')
    }</div>`;
  };

  let body = '';
  if (s.step === 1) {
    body = `
      <div class="wizard-step">
        <div class="wizard-icon-large">${lfIcon('zap', {cls:'lf-icon-2xl'})}</div>
        <h2>Willkommen!</h2>
        <p>Wir richten dein Konto in 4 Schritten ein — dauert keine Minute.</p>
        ${dots(1)}
        <div class="wizard-actions">
          <button class="btn btn-ghost" onclick="window.LF.onboardingSkipAll()">Überspringen</button>
          <button class="btn btn-primary btn-lg" onclick="window.LF.onboardingNext()">Los geht's</button>
        </div>
      </div>`;
  } else if (s.step === 2) {
    body = `
      <div class="wizard-step">
        <div class="wizard-step-num">Schritt 2 von 4</div>
        <h2>Wer bist du?</h2>
        <div class="form-group">
          <label class="form-label">Wie heißt du?</label>
          <input class="form-input" id="onbName" value="${escapeHtml(s.name).replace(/"/g,'&quot;')}" maxlength="40" placeholder="Dein Name">
          <div class="form-hint">So sehen dich Mitschüler in der Rangliste.</div>
        </div>
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
          ${s.skipSteps.includes(1) ? '' : '<button class="btn btn-ghost" onclick="window.LF.onboardingBack()">Zurück</button>'}
          <button class="btn btn-ghost" onclick="window.LF.onboardingSkipAll()">Überspringen</button>
          <button class="btn btn-primary" onclick="window.LF.onboardingNext()">Weiter</button>
        </div>
      </div>`;
  } else if (s.step === 3) {
    // Mission 8 Q1=C: Avatar-Picker = nur File-Upload, kein Emoji-Grid mehr.
    // Default-Fallback fuer User ohne Bild bleibt der Initial-Letter (universal).
    body = `
      <div class="wizard-step">
        <div class="wizard-step-num">Schritt 3 von 4</div>
        <h2>Lade dein Profilbild hoch.</h2>
        <div style="margin:16px 0">
          <div class="profile-avatar-large" style="margin:12px auto 0">${
            s.photoURL ? `<img src="${s.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">` : escapeHtml((s.name||'U')[0].toUpperCase())
          }</div>
        </div>
        <div class="form-hint">Optional — wenn du ueberspringst, wird der Anfangsbuchstabe deines Namens als Avatar genutzt.</div>
        <label class="btn btn-secondary btn-sm" style="cursor:pointer;display:inline-block;margin-top:12px">
          ${lfIcon('folder')} Bild hochladen
          <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="window.LF.onboardingHandleFile(this)">
        </label>
        ${dots(3)}
        <div class="wizard-actions">
          <button class="btn btn-ghost" onclick="window.LF.onboardingBack()">Zurück</button>
          <button class="btn btn-ghost" onclick="window.LF.onboardingSkip()">Überspringen</button>
          <button class="btn btn-primary" onclick="window.LF.onboardingNext()">Weiter</button>
        </div>
      </div>`;
  } else {
    // Mission 4: Step 4 wird zum Tour-Einstieg (Maya Architecture A).
    body = `
      <div class="wizard-step">
        <div class="wizard-step-num">Schritt 4 von 4</div>
        <div class="wizard-icon-large">${lfIcon('party-popper', {cls:'lf-icon-2xl'})}</div>
        <h2>Alles klar, ${escapeHtml(s.name || 'Lernender')}!</h2>
        <p>Soll ich dir die wichtigsten Funktionen in 8 kurzen Schritten zeigen?</p>
        ${dots(4)}
        <div class="wizard-actions">
          <button class="btn btn-ghost" onclick="window.LF.onboardingFinish('app')">Später, zur App</button>
          <button class="btn btn-primary" onclick="window.LF.onboardingFinish('tour')">Tour starten</button>
        </div>
      </div>`;
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
        <h1>${lfIcon('brain')} Spaced Repetition</h1>
        <div class="sub">${due.length} Karte${due.length !== 1 ? 'n' : ''} heute fällig</div>
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
          <div class="fc-text">${q.question}</div>
          <div class="fc-hint">Klicken zum Umdrehen</div>
        </div>
        <div class="fc-face fc-back">
          <div class="fc-label">Antwort</div>
          <div class="fc-text">${correctAnswer}</div>
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
function mountPomodoro() {
  if (document.getElementById('pomodoroWidget')) return;
  pomodoroState = { mode: 'work', seconds: 25*60, workMins: 25, breakMins: 5, timer: null, sessions: 0 };
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
      if (currentUser) addStudyTime(currentUser.uid, pomodoroState.workMins).catch(console.error);
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
      <button class="profile-tab ${tab === 'erfolge' ? 'active' : ''}"    onclick="window.LF.switchProfileTab('erfolge')">Erfolge</button>
      <button class="profile-tab ${tab === 'inventar' ? 'active' : ''}"   onclick="window.LF.switchProfileTab('inventar')">Inventar</button>
    </div>`;

  const header = `
    <div class="profile-header-card">
      <div class="profile-avatar-large ${outlineFor({activeOutline:userData?.activeOutline,xp:userData?.xp})}">${
        (userData?.photoURL || currentUser.photoURL)
          ? `<img src="${userData?.photoURL || currentUser.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
          : initial
      }</div>
      <div class="profile-header-info">
        <div class="profile-name">${escapeHtml(userData?.name || currentUser.displayName || 'Nutzer')} ${roleBadge(role)}</div>
        <div class="profile-meta">
          ${userData?.klasse ? `Klasse ${userData.klasse}` : '<span style="color:#f59e0b">Klasse nicht gesetzt</span>'}
          · Lv.${xpInfo.level} ${xpInfo.title}
          ${streak > 1 ? ` · ${lfIcon('flame', {cls:'sx-streak'})} ${streak} Tage` : ''}
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
  } else {
    content = _renderProfileUebersichtTab();
  }

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Profil' }])}
    <div class="page">
      <div class="page-header"><h1>Mein Profil</h1></div>
      ${header}
      ${tabBar}
      <div class="profile-tab-content">${content}</div>

      <!-- Bearbeitungs-Sheet (initial versteckt; profileEditOpen() schiebt rein) -->
      <div id="profileEditForm" style="display:none;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-top:16px">
        <div class="profile-avatar-large" id="profileAvatarPreview" style="margin:0 auto 12px">${
          (userData?.photoURL || currentUser.photoURL)
            ? `<img src="${userData?.photoURL || currentUser.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
            : initial
        }</div>
        <label class="btn btn-secondary btn-sm" style="margin:6px auto;cursor:pointer;display:block;width:fit-content">
          ${lfIcon('folder')} Bild hochladen
          <input type="file" accept="image/png,image/jpeg,image/webp" style="display:none"
                 onchange="window.LF.handleProfileFile(this)">
        </label>
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
  }).filter(Boolean).join('') || '<div class="empty-state" style="padding:16px">Noch keine Noten vorhanden.</div>';

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
            <div class="xp-sub">${xpInfo.xpCurrent} / ${xpInfo.xpNeeded} XP bis Stufe ${xpInfo.level + 1}</div>
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
        <div class="share-link-sub">Teile deinen Lernfortschritt ohne Login</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="share-link-input" id="shareLinkInput" readonly placeholder="Link wird gleich erstellt…">
        <button class="btn btn-primary btn-sm" onclick="window.LF.createShareLink()">Link erstellen</button>
        <button class="btn btn-ghost btn-sm" id="copyShareBtn" style="display:none" onclick="window.LF.copyShareLink()">Kopieren</button>
      </div>
    </div>

    <div style="margin-top:32px;text-align:center">
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
    return `<div class="empty-state"><div class="empty-icon">${lfIcon('chart-bar')}</div>Noch keine Tests gemacht — fang einfach an!</div>`;
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
           title="${escapeHtml(a.title)}">
        <div class="ach-code" style="${unlocked ? `background:${a.color};color:#fff` : ''}">${a.iconName ? lfIcon(a.iconName) : escapeHtml(a.code)}<span class="ach-code-suffix">${escapeHtml(a.code)}</span></div>
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
          ? `<img src="${userData.photoURL || currentUser.photoURL}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
          : initial
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
    const av = u.photoURL
      ? `<img src="${u.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
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
    document.getElementById('lbContent').innerHTML =
      `<div class="empty-state"><div class="empty-icon">${lfIcon('trophy')}</div>Noch keine Einträge — mach einen Test, um in die Rangliste zu kommen!</div>`;
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
    const av = u.photoURL
      ? `<img src="${u.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : escapeHtml((u.displayName||'?')[0].toUpperCase());
    const isMe = u.uid === currentUser?.uid;
    return `
      <div class="lb-row${isMe?' lb-me':''}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-avatar ${outlineFor(u)}">${av}</div>
        <div class="lb-name">${escapeHtml(u.displayName||'Unbekannt')} ${roleBadge(u.role)}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
        <div class="lb-meta">Lv.${xi.level} ${escapeHtml(xi.title)}</div>
        <div class="lb-score" style="color:#f59e0b">${u.xp} XP</div>
      </div>`;
  }).join('') : '<div class="empty-state" style="padding:24px">Noch keine XP-Daten vorhanden.</div>';

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
      html += `<div class="empty-state" style="margin-bottom:32px">Noch keine persönlichen Themen. Erstelle eines im <a onclick="location.hash='#/builder'" style="color:var(--accent);cursor:pointer">Builder</a>.</div>`;
    }

    const groupIds = userData?.groupIds || [];
    if (groupIds.length) {
      const groups = await getUserGroups(groupIds);
      for (const group of groups) {
        const topics = await getGroupCustomTopics(group.id);
        html += `<h2 style="font-size:18px;font-weight:700;margin:28px 0 12px">Gruppe: ${group.name}</h2>`;
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
  const qCount = (topic.questions || []).length;
  const safeId = topic.id;
  return `
    <div class="custom-topic-card">
      <div class="custom-topic-meta">${topic.fach || '?'} · ${topic.klasse || '?'}</div>
      <div class="custom-topic-name">${topic.thema || 'Unbenannt'}</div>
      ${topic.description ? `<div class="custom-topic-desc">${topic.description}</div>` : ''}
      <div class="custom-topic-footer">
        <span class="custom-topic-qcount">${qCount} Frage${qCount !== 1 ? 'n' : ''}</span>
        <div class="custom-topic-actions">
          <button class="btn btn-primary btn-sm" onclick="location.hash='#/meine-inhalte/${safeId}'">Ansehen</button>
          ${canDelete ? `<button class="btn btn-ghost btn-sm" onclick="window.LF.deleteCustomTopicUI('${safeId}')">Löschen</button>` : ''}
        </div>
      </div>
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

    document.getElementById('customTopicBody').innerHTML = `
      <div class="page-header">
        <div class="breadcrumb-sub">${t.fach} · ${t.klasse}</div>
        <h1>${t.thema}</h1>
        ${t.description ? `<div class="sub">${t.description}</div>` : ''}
      </div>
      <div class="topic-tab-bar">
        <button class="tab-btn active" id="ctTabBtnLernen" onclick="window.LF.ctSwitchTab('Lernen')">Lernen</button>
        ${qCount > 0 ? `<button class="tab-btn" id="ctTabBtnTest" onclick="window.LF.ctSwitchTab('Test')">Test</button>` : ''}
      </div>
      <div id="ctTabLernen">
        <div class="content-body">${t.content || '<p style="color:var(--text-muted)">Kein Inhalt vorhanden.</p>'}</div>
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

  const groupCards = groups.map(g => {
    const memberCount = Object.keys(g.members || {}).length;
    const isCreator   = g.creatorUid === currentUser.uid;
    return `
      <div class="group-card" onclick="location.hash='#/gruppen/${g.id}'">
        <div class="group-card-info">
          <div class="group-card-name">${g.name}</div>
          <div class="group-card-meta">${memberCount} Mitglied${memberCount !== 1 ? 'er' : ''} · ${isCreator ? 'Admin' : 'Mitglied'}</div>
        </div>
        <div class="group-card-arrow">›</div>
      </div>`;
  }).join('');

  document.getElementById('groupsContent').innerHTML = `
    ${groups.length > 0 ? `<div class="group-list">${groupCards}</div>` : ''}
    ${groups.length === 0 ? `<div class="empty-state" style="margin-bottom:24px"><div class="empty-icon">${lfIcon('users')}</div>Du bist noch in keiner Gruppe.</div>` : ''}

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

  // Re-render nav with group name
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Gruppen', href: '#/gruppen' }, { label: group.name }])}
    <div class="page">
      <div class="page-header">
        <h1>${group.name}</h1>
        <div class="sub">${members.length} Mitglied${members.length !== 1 ? 'er' : ''}</div>
      </div>
      <div id="groupDetailContent"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  // Mitgliederliste
  const memberRows = members.map(([uid, m]) => `
    <div class="group-member-row">
      <div class="group-member-avatar">${(m.displayName||'?')[0].toUpperCase()}</div>
      <div class="group-member-info">
        <div class="group-member-name">${m.displayName || 'Unbekannt'} ${m.role === 'admin' ? '<span class="group-admin-badge">Gruppen-Admin</span>' : ''} ${roleBadge(m.userRole)}</div>
      </div>
      ${isCreator && uid !== currentUser.uid
        ? `<button class="btn btn-ghost btn-sm" onclick="window.LF.groupKick('${groupId}','${uid}','${(m.displayName||'').replace(/'/g,"\\'")}')">Entfernen</button>`
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
               <code class="group-invite-code">${group.code}</code>
               <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText('${group.code}');window.LF.showToast('Code kopiert!','success')">Kopieren</button>
             </div>`
          : ''}

        <div style="margin-top:20px;display:flex;gap:8px;flex-wrap:wrap">
          ${isCreator
            ? `<button class="btn btn-danger btn-sm" onclick="window.LF.groupDelete('${groupId}','${group.name.replace(/'/g,"\\'")}')">Gruppe löschen</button>`
            : `<button class="btn btn-secondary btn-sm" onclick="window.LF.groupLeave('${groupId}','${group.name.replace(/'/g,"\\'")}')">Gruppe verlassen</button>`
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
    const lbRows = groupLb.map((u, i) => {
      const av = u.photoURL
        ? `<img src="${u.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
        : (u.displayName||'?')[0].toUpperCase();
      const isMe = u.uid === currentUser.uid;
      const medalCell = i < 3
        ? lfIcon('medal', { cls: 'lb-medal', color: medalColors[i] })
        : `<span style="font-size:13px;font-weight:700;color:var(--text-muted)">${i+1}</span>`;
      return `
        <div class="lb-row${isMe ? ' lb-me' : ''}">
          <div class="lb-rank">${medalCell}</div>
          <div class="lb-avatar ${outlineFor(u)}">${av}</div>
          <div class="lb-name">${u.displayName||'Unbekannt'} ${roleBadge(u.role)}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
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
        const av   = u.photoURL
          ? `<img src="${u.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
          : (u.name||'?')[0].toUpperCase();
        return `
          <tr>
            <td><div style="display:flex;align-items:center;gap:8px">
              <div class="lb-avatar" style="width:28px;height:28px;font-size:12px">${av}</div>
              ${u.name||'–'}
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
      return `
        <div class="admin-user-row ${u.isBanned ? 'admin-user-banned' : ''}">
          <div class="admin-user-avatar">${(u.name || '?')[0].toUpperCase()}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${u.name || 'Unbekannt'} ${u.isBanned ? '<span class="admin-ban-badge">GESPERRT</span>' : ''}</div>
            <div class="admin-user-meta">${u.email || '–'} · ${testCount} Tests · beigetreten ${joined}</div>
          </div>
          <div class="admin-user-actions">
            <button class="btn btn-primary btn-sm" onclick="window.LF.adminEditUser('${u.uid}')">Bearbeiten</button>
            ${u.isBanned
              ? `<button class="btn btn-secondary btn-sm" onclick="window.LF.adminUnban('${u.uid}','${(u.name||'').replace(/'/g,'\\&apos;')}')">Entsperren</button>`
              : `<button class="btn btn-danger btn-sm" onclick="window.LF.adminBan('${u.uid}','${(u.name||'').replace(/'/g,'\\&apos;')}')">Sperren</button>`
            }
            <button class="btn btn-ghost btn-sm" onclick="window.LF.adminResetLb('${u.uid}','${(u.name||'').replace(/'/g,'\\&apos;')}')">Rangliste reset</button>
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
    <div class="admin-section-title">Hilfsmittel pro Fach</div>
    <div class="admin-tool-list">${toolRows || '<div class="empty-state">Keine F&auml;cher geladen.</div>'}</div>
    <button class="btn btn-primary" style="margin-bottom:24px" onclick="window.LF.adminSaveTools()">Hilfsmittel speichern</button>
    <div class="admin-section-title">Nutzerverwaltung</div>
    <div class="admin-user-list">${rows || '<div class="empty-state">Keine Nutzer gefunden.</div>'}</div>`;
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
    builderState = { step: 1, mode: null, fach: '', klasse: '', thema: '', description: '', content: '', blocks: [], questions: [] };
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
        <input class="form-input" id="bFach" placeholder="z.B. Geschichte" value="${s.fach}"
               list="bFachList">
        <datalist id="bFachList">${Object.values(structure||{}).map(s=>`<option value="${s.name}">`).join('')}</datalist>
      </div>
      <div class="form-group">
        <label class="form-label">Klasse</label>
        <input class="form-input" id="bKlasse" placeholder="z.B. Klasse-9" value="${s.klasse}">
      </div>
      <div class="form-group">
        <label class="form-label">Thema-Name</label>
        <input class="form-input" id="bThema" placeholder="z.B. Erster Weltkrieg" value="${s.thema}">
      </div>
      <div class="form-group">
        <label class="form-label">Kurzbeschreibung (optional)</label>
        <input class="form-input" id="bDesc" placeholder="Was lernst du hier?" value="${s.description}">
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
          <div class="mode-icon">&lt;/&gt;</div>
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
    const fachFolder   = builderState.fach.replace(/\s+/g, '-');
    const klasseFolder = builderState.klasse.replace(/\s+/g, '-');
    const themaFolder  = builderState.thema.replace(/\s+/g, '-');
    return `
      <div class="builder-card">
        <h2>Fertig! Veröffentlichen</h2>
        <div class="builder-export-info">
          <div class="builder-export-row"><span class="builder-export-lbl">Fach:</span> <strong>${builderState.fach}</strong></div>
          <div class="builder-export-row"><span class="builder-export-lbl">Klasse:</span> <strong>${builderState.klasse}</strong></div>
          <div class="builder-export-row"><span class="builder-export-lbl">Thema:</span> <strong>${builderState.thema}</strong></div>
          <div class="builder-export-row"><span class="builder-export-lbl">Fragen:</span> <strong>${builderState.questions.length}</strong></div>
        </div>

        <div class="builder-publish-section">
          <h3>In der App hochladen</h3>
          <p class="sub">Sofort spielbar — kein ZIP, keine Mail nötig.</p>
          <div class="builder-publish-btns">
            <button class="btn btn-primary" onclick="window.LF.builderUploadPersonal()">
              Nur für mich hochladen
            </button>
            <div id="builderGroupSection">
              <div class="spinner" style="margin:8px auto;width:20px;height:20px"></div>
            </div>
          </div>
          <div id="builderUploadMsg"></div>
        </div>

        <div class="builder-export-divider"><span>oder per Mail einreichen</span></div>

        <div>
          <p class="sub" style="margin-bottom:12px">ZIP herunterladen und an <strong>simonkoper27@gmail.com</strong> senden — dann wird das Thema für alle freigeschaltet.</p>
          <div class="builder-export-steps">
            <div class="builder-export-step"><span class="builder-export-num">1</span> ZIP herunterladen</div>
            <div class="builder-export-step"><span class="builder-export-num">2</span> An <strong>simonkoper27@gmail.com</strong> senden</div>
            <div class="builder-export-step"><span class="builder-export-num">3</span> Betreff: <code>${builderState.fach} / ${builderState.klasse} / ${builderState.thema}</code></div>
          </div>
          <button class="btn btn-secondary" onclick="window.LF.builderExport()" style="margin-top:12px">ZIP herunterladen</button>
          <div id="builderExportMsg" style="margin-top:12px"></div>
        </div>

        <div class="builder-nav" style="margin-top:24px">
          <button class="btn btn-secondary" onclick="window.LF.builderPrev()">Zurück</button>
          <span></span>
        </div>
      </div>`;
  }
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
    const label = q.type === 'multiple_choice' ? `MC: ${q.question}`
                : q.type === 'free_text'       ? `Freitext: ${q.question}`
                : `Vokabel: ${q.word} → ${q.answers?.join(', ')}`;
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
          <button class="ueben-mc-option" onclick="window.LF.checkUebenMC(${i})">${opt}</button>
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
        <div class="question-text">${q.question}</div>
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

  const p = [];
  if (xpGained > 0) {
    p.push(saveXP(uid, xpGained).catch(console.error));
    // Mirror XP + Rolle zum leaderboard-Doc, damit Banner in Ranglisten auftaucht.
    // Claude- und Hacker-Test-Accounts NICHT mirroren — sonst tauchen sie im XP-Tab auf.
    if (!isClaudeAccount() && !isHackerAccount()) {
      p.push(db().collection('leaderboard').doc(uid).set({
        xp: userData.xp,
        displayName: currentUser.displayName || 'Nutzer',
        photoURL: currentUser.photoURL || null,
        role: userRole() || null
      }, { merge: true }).catch(console.error));
    }
  }
  if (newOnes.length) p.push(saveAchievements(uid, newOnes.map(a => a.id)).catch(console.error));
  await Promise.all(p);

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

  let allTopics = Object.values(structure || {})
    .flatMap(s => Object.values(s.years || {})
      .flatMap(y => Object.values(y.topics || {})
        .map(t => ({ subjectId: s.id, yearId: y.id, topicId: t.id }))));

  // Klassen-Filter (#7): Topics aus passender Klasse, plus solche ohne Klassenzuordnung (z.B. "Grammatik")
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

  if (!allTopics.length) return [];

  // Deterministisch shuffeln (Fisher-Yates mit Seed) — nicht mit rand()-0.5
  const shuffled = [...allTopics];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Mehr Topics einbeziehen (vorher 3 → oft zu wenig MC-Fragen für 6 Slots)
  const picked   = shuffled.slice(0, Math.min(5, shuffled.length));

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
  return `
    <div class="daily-card" data-tour="daily-card" onclick="location.hash='#/daily-challenge'">
      <div class="daily-card-label">Daily Challenge</div>
      <div class="daily-card-status">5 Min · 6 Fragen · Bonus-XP</div>
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
    const ranked  = [...scores].sort((a,b)=>(a.grade||9)-(b.grade||9));
    const lbHtml  = ranked.map((u,i) => {
      const medalColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
      const m = i < 3
        ? lfIcon('medal', { cls: 'lb-medal', color: medalColors[i] })
        : (i+1);
      const isMe = u.uid === currentUser?.uid;
      return `
        <div class="lb-row${isMe?' lb-me':''}">
          <div class="lb-rank">${m}</div>
          <div class="lb-avatar ${outlineFor(u)}">${u.displayName?.[0]?.toUpperCase()||'?'}</div>
          <div class="lb-name">${u.displayName||'?'} ${roleBadge(u.role)}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
          <div class="lb-meta">${u.points}/${u.maxPoints} Pkt</div>
          <div class="lb-score" style="color:${gradeColor(u.grade)}">${u.grade}</div>
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
  const optHtml = opts.map((o, i) => `
    <button class="dc-opt ${answers[current] === String(i) ? 'dc-opt-selected' : ''}"
            onclick="window.LF.dcSelectOpt(${i})">${String.fromCharCode(65+i)}. ${o}</button>`).join('');

  document.getElementById('dcArea').innerHTML = `
    <div class="dc-header">
      <div class="dc-timer" id="dcTimer">${Math.floor(timeLeft/60)}:${String(timeLeft%60).padStart(2,'0')}</div>
      <div class="dc-counter">${current+1} / ${questions.length}</div>
    </div>
    <div class="dc-progress"><div class="dc-progress-fill" style="width:${pct}%"></div></div>
    <div class="dc-question">${q.question}</div>
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

window.LF = {
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
      showToast('Lesezeichen entfernt.', 'info');
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
    const status = document.getElementById('notesStatus');
    if (status) status.textContent = 'Tippen…';
    _notesSaveTimer = setTimeout(async () => {
      if (!currentUser) return;
      userData = userData || {};
      if (!userData.notes) userData.notes = {};
      userData.notes[key] = value;
      await saveNote(currentUser.uid, key, value).catch(console.error);
      const s = document.getElementById('notesStatus');
      if (s) { s.textContent = 'Gespeichert'; setTimeout(() => { if(s) s.textContent=''; }, 2000); }
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

  // ── Builder Upload ──────────────────────
  initBuilderExport: async () => {
    const section = document.getElementById('builderGroupSection');
    if (!section) return;
    const groupIds = userData?.groupIds || [];
    if (!groupIds.length) { section.innerHTML = ''; return; }
    const groups = await getUserGroups(groupIds);
    if (!groups.length) { section.innerHTML = ''; return; }
    section.innerHTML = groups.map(g => `
      <button class="btn btn-secondary" onclick="window.LF.builderUploadGroup('${g.id}','${(g.name||'').replace(/'/g,"\\'")}')">
        Für Gruppe „${g.name}" hochladen
      </button>`).join('');
  },

  builderUploadPersonal: async () => {
    const msg = document.getElementById('builderUploadMsg');
    if (msg) msg.innerHTML = '<div class="spinner" style="margin:8px auto;width:20px;height:20px"></div>';
    try {
      await saveCustomTopic(currentUser.uid, builderState, null);
      grantXPAndAchievements({ xp: 50, customCreated: true }).catch(console.error);
      if (msg) msg.innerHTML = `<div class="success-msg">Hochgeladen! <a onclick="location.hash='#/meine-inhalte'" style="color:var(--accent);cursor:pointer;text-decoration:underline">Jetzt in Meine Inhalte ansehen →</a></div>`;
    } catch(e) {
      if (msg) msg.innerHTML = `<div class="error-msg">Fehler: ${e.message}</div>`;
    }
  },

  builderUploadGroup: async (groupId, groupName) => {
    if (_blockClaudeWrite('Gruppen-Uploads')) return;
    const msg = document.getElementById('builderUploadMsg');
    if (msg) msg.innerHTML = '<div class="spinner" style="margin:8px auto;width:20px;height:20px"></div>';
    try {
      await saveCustomTopic(currentUser.uid, builderState, groupId);
      if (msg) msg.innerHTML = `<div class="success-msg">Für Gruppe „${groupName}" hochgeladen! <a onclick="location.hash='#/meine-inhalte'" style="color:var(--accent);cursor:pointer;text-decoration:underline">Ansehen →</a></div>`;
    } catch(e) {
      if (msg) msg.innerHTML = `<div class="error-msg">Fehler: ${e.message}</div>`;
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
      `<div class="ueben-feedback-box ${ok?'ok':'fail'}">${ok ? 'Richtig!' : `Falsch. Richtige Antwort: <strong>${q.shuffledOptions[q.shuffledCorrectIndex]}</strong>`}</div>`;
    document.getElementById('uebenNext').style.display = 'block';
  },

  checkUebenText: () => {
    const q      = uebenState.questions[uebenState.current];
    const answer = document.getElementById('uebenTextarea')?.value?.trim() || '';
    document.getElementById('uebenFeedback').innerHTML =
      `<div class="ueben-feedback-box info">
        ${q.sampleAnswer ? `<strong>Musterantwort:</strong><br>${q.sampleAnswer}` : 'Vergleiche deine Antwort mit dem Lerninhalt.'}
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
    grid.innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="window.LF.closeSubtopic()" style="margin-bottom:16px">
        ← Zurück zur Übersicht
      </button>
      <div class="subtopic-detail">
        <h2 class="subtopic-detail-title">${st.name}</h2>
        <div class="content-body">${st.content}</div>
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
          <div class="subtopic-name">${st.name}</div>
          ${st.description ? `<div class="subtopic-desc">${st.description}</div>` : ''}
        </div>
        <div class="subtopic-arrow">›</div>
      </div>`).join('');
  }
};

// ── Mission 1 — Neue window.LF-Handler ────────────────────

// Profil-Tab-Switch
window.LF.switchProfileTab = (tab) => {
  // Update Hash mit ?tab=xy. route() greift dann renderProfile() → liest tab.
  const allowed = ['uebersicht','stats','erfolge','inventar'];
  const safe = allowed.includes(tab) ? tab : 'uebersicht';
  location.hash = `#/profil?tab=${safe}`;
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
        <div class="ach-modal-code" style="${unlocked ? `background:${a.color};color:#fff` : ''}">${a.iconName ? lfIcon(a.iconName) : escapeHtml(a.code)}<span class="ach-code-suffix">${escapeHtml(a.code)}</span></div>
        <div class="ach-modal-xp" style="color:${unlocked ? a.color : 'var(--text-muted)'}">+${a.xp} XP</div>
        <div class="ach-modal-desc">${escapeHtml(a.longDesc || a.desc)}</div>
        ${progressHtml}
        <div class="ach-modal-status">
          Status: ${unlocked ? `${lfIcon('lock-open')} Freigeschaltet` : `${lfIcon('lock')} Noch nicht freigeschaltet`}
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

// Lernen-Hub: Live-Filter-Suche
window.LF.filterLernenGrid = (q) => {
  const ql = String(q || '').toLowerCase().trim();
  const grid = document.getElementById('lernenSubjectsGrid');
  if (!grid) return;
  grid.querySelectorAll('.subject-card').forEach(card => {
    const name = card.querySelector('.s-name')?.textContent?.toLowerCase() || '';
    card.style.display = (!ql || name.includes(ql)) ? '' : 'none';
  });
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

function renderActiveTest(questions, timeMinutes, subjectId, yearId, topicId, subject, topic) {
  setupTabSwitchDetection();
  // B3: Mid-test guards aktivieren. Test-Hash = der aktuelle Topic-Hash, von
  // dem aus startTest aufgerufen wurde.
  _setupMidTestGuards(`#/fach/${subjectId}/${yearId}/${topicId}`);
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
          Frage <strong id="qProgress">–</strong> von <strong>${questions.length}</strong>
        </div>
        <div class="timer" id="timer">${formatTime(testState.remaining)}</div>
        <button class="btn btn-secondary btn-sm" onclick="window.LF.submitTest()">Abgeben</button>
      </div>
      <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
      <div id="questionsContainer" style="margin-top:20px"></div>
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
      <div class="question-text">${q.question}</div>
      ${q.type === 'multiple_choice'
        ? `<div class="mc-options">
            ${q.shuffledOptions.map((opt, j) => `
              <label class="mc-option" id="opt${i}_${j}">
                <input type="radio" name="q${i}" value="${j}"
                  onchange="window.LF.setAnswer(${i}, ${j}); document.querySelectorAll('#qcard${i} .mc-option').forEach(el=>el.classList.remove('selected')); document.getElementById('opt${i}_${j}').classList.add('selected')">
                ${opt}
              </label>`).join('')}
           </div>`
        : `<textarea class="form-input form-textarea" placeholder="Deine Antwort hier..."
              oninput="window.LF.setAnswer(${i}, this.value)"></textarea>`}
    </div>`).join('');

  document.getElementById('qProgress').textContent = '1';
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

    if (isTestAccount || isCustomTopic) {
      // Lokal-Pfad: Test-Accounts und Custom-Topics gehen NIE in die Cloud-Function.
      // Verhalten wie vor Mission 3 — saveGrade/XP/Achievements lokal.
      const attempt = {
        points: total, maxPoints: max,
        grade: penalty ? 6 : grade.grade,
        date: new Date().toISOString()
      };
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
  renderResults(questions, effectiveAns, results, grade, total, max, timeUsed, { subjectName, topicName, timeMinutes, penalty });
  } finally {
    if (testState) testState._submitting = false;
    // B3 Sophie-Audit-Fix (2026-05-08): wenn evaluateAnswers/CF wirft, hat
    // die happy-path-teardown weiter oben nicht gefeuert — beforeunload
    // würde den User auch nach Logout/Reload nerven. Defensiv im finally.
    if (!testState || !testState.results) _teardownMidTestGuards();
  }
};

function renderResults(questions, answers, results, grade, total, max, timeUsed, meta) {
  const mins = Math.floor(timeUsed/60);
  const secs = timeUsed % 60;
  const date = new Date().toLocaleDateString('de-DE');
  const pct  = Math.round(total/max*100);

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
          <div class="r-question">${q.question}</div>
          <div class="r-pts ${cls}">${pts}/${r.maxPoints}</div>
        </div>
        <div class="r-answer">Antwort: ${answerText}</div>
        <div class="r-feedback">${r.feedback}</div>
      </div>`;
  }).join('');

  // ── F-03 Fehler-Analyse ─────────────────
  const wrongQuestions = questions.filter((q, i) => (results[i].points || 0) < results[i].maxPoints);
  const wrongQIds      = wrongQuestions.map(q => q.id).filter(Boolean);

  if (wrongQIds.length > 0 && currentUser) {
    saveWeakQuestions(currentUser.uid, wrongQIds).catch(console.error);
  }

  const wrongItems = questions.map((q, i) => {
    const r = results[i];
    if ((r.points || 0) === r.maxPoints) return '';
    const userAnswer = q.type === 'multiple_choice'
      ? (q.shuffledOptions?.[parseInt(answers[i])] || '(keine Wahl)')
      : (answers[i] || '(keine Antwort)');
    const correctAnswer = q.type === 'multiple_choice'
      ? (q.shuffledOptions?.[q.shuffledCorrectIndex] ?? q.options?.[q.correct] ?? '–')
      : (q.sampleAnswer || '— siehe Musterantwort im Lerninhalt');
    return `
      <div class="wrong-item">
        <div class="wrong-q">${q.question}</div>
        <div class="wrong-user">Deine Antwort: <span class="wrong-val">${userAnswer}</span></div>
        <div class="wrong-correct">Richtige Antwort: <span class="correct-val">${correctAnswer}</span></div>
      </div>`;
  }).filter(Boolean).join('');

  const wrongSection = wrongItems
    ? `<div class="section-title" style="margin-top:28px">Was war falsch?</div>
       <div class="wrong-list">${wrongItems}</div>`
    : `<div class="all-correct-banner">Alle Aufgaben korrekt beantwortet!</div>`;

  // ── F-04 Retry-Button ────────────────────
  testState._wrongQuestions = wrongQuestions;
  const retryBtn = wrongQuestions.length > 0
    ? `<button class="btn btn-secondary" onclick="window.LF.startRetryTest()">Falsche Fragen nochmal ueben</button>`
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
        <div class="print-q-text">${q.question}</div>
        <div class="print-q-answer"><strong>Antwort:</strong> ${answerText}</div>
        <div class="print-q-feedback"><strong>Feedback:</strong> ${r.feedback}</div>
      </div>`;
  }).join('');

  document.getElementById('testArea').innerHTML = `
    <div class="results-page">

      <!-- Bildschirm-Ansicht -->
      <div class="no-print">
        ${meta.penalty ? `<div class="penalty-banner">Tab-Wechsel während des Tests erkannt — automatisch Note 6 (Ungenügend)</div>` : ''}
        <div class="grade-display">
          <div class="grade-circle" style="background:${grade.color}">${grade.grade}</div>
          <div class="grade-label">${grade.label}</div>
          <div class="grade-points">${total} von ${max} Punkten · ${pct}%</div>
        </div>
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
        <div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap">
          <button class="btn btn-primary" onclick="window.LF.startTest('${testState.subjectId}','${testState.yearId}','${testState.topicId}')">
            Nochmal testen
          </button>
          ${retryBtn}
          <button class="btn btn-secondary" onclick="location.hash='#/'">Zurück</button>
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

  testState._copyText = generateCopyText(questions, answers, results, timeUsed, meta);
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
  const wasOpen = panel.style.display !== 'none';
  panel.style.display = wasOpen ? 'none' : 'block';
  // .notes-arrow.open rotates chevron-down 180deg → pfeil zeigt nach oben (Panel zu).
  // Wenn Panel jetzt offen ist → 'open' entfernen → chevron zeigt nach unten.
  if (arrow) arrow.classList.toggle('open', wasOpen);
};

window.LF.toggleTw = () => {
  const panel = document.getElementById('twPanel');
  const arrow = document.getElementById('twArrow');
  if (!panel) return;
  const wasOpen = panel.style.display !== 'none';
  panel.style.display = wasOpen ? 'none' : 'block';
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
           <span>${String.fromCharCode(65 + j)}) ${opt}</span>
         </div>`
      ).join('');
      return `
        <div class="pdf-question">
          <div class="pdf-q-header">
            <span class="pdf-q-num">Aufgabe ${i + 1}</span>
            <span class="pdf-q-pts">${pts} Punkt${pts !== 1 ? 'e' : ''}</span>
          </div>
          <div class="pdf-q-text">${q.question}</div>
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
          <div class="pdf-q-text">${q.question}</div>
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

  const reqHtml = myRequests.length ? `
    <div class="card" style="margin-bottom:20px">
      <div class="section-title" style="margin-bottom:16px">Anfragen (${myRequests.length})</div>
      ${myRequests.map(([fromUid, req]) => `
        <div class="friend-request-card">
          <div class="friend-avatar ${outlineFor(req)}">${_avatar(req.photo, req.name)}</div>
          <div class="friend-info">
            <div class="friend-name">${req.name} ${roleBadge(req.role)}</div>
            <div class="friend-sub">Möchte dein Freund sein</div>
          </div>
          <div class="friend-btns">
            <button class="btn btn-primary btn-sm"
              onclick="window.LF.acceptFriend('${fromUid}','${req.name.replace(/'/g,"\\'")}','${req.photo||''}')">Annehmen</button>
            <button class="btn btn-secondary btn-sm"
              onclick="window.LF.rejectFriend('${fromUid}')">Ablehnen</button>
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
              <div class="friend-name">${f.name} ${roleBadge(f.role)}</div>
              <div class="friend-sub">Lv. ${lv.level} — ${lv.title}</div>
            </div>
            <button class="btn btn-ghost btn-sm"
              onclick="window.LF.unfriendUser('${f.uid}','${f.name.replace(/'/g,"\\'")}')">Entfreunden</button>
          </div>`;
      }).join('')
    : `<div class="empty-state" style="padding:20px 0"><p>Noch keine Freunde hinzugefügt.</p></div>`;

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
        const text = e.type === 'test'
          ? `<strong>${name}</strong> hat <em>${topic}</em> mit Note <strong>${grade}</strong> abgeschlossen`
          : e.type === 'achievement'
          ? `<strong>${name}</strong> hat das Achievement <em>${title}</em> erhalten`
          : e.type === 'content'
          ? `<strong>${name}</strong> hat neuen Inhalt hochgeladen: <em>${topic}</em>`
          : `<strong>${name}</strong> war aktiv`;
        return `
          <div class="feed-entry">
            <div class="feed-icon">${icon}</div>
            <div class="feed-body">
              <div class="feed-text">${text}</div>
              <div class="feed-time">${time}</div>
            </div>
          </div>`;
      }).join('')
    : `<div class="empty-state" style="padding:20px 0"><p>Noch keine Aktivitäten von deinen Freunden.</p></div>`;

  app.innerHTML = renderNav([{ label: 'Feed' }]) + `
    <div class="page">
      <h1 class="page-title">Aktivitäts-Feed</h1>
      <div class="card">${entriesHtml}</div>
    </div>`;
  initNavCollapse();
}

// ── F-40: Lernplan ───────────────────────
function renderLernplan() {
  const recs = getRecommendations();
  const days = ['Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag','Sonntag'];
  const plan = days.map((day, i) => ({ day, rec: recs[i % Math.max(recs.length, 1)] }));

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Lernplan' }])}
    <div class="page">
      <div class="page-header">
        <h1>&#x1F4C5; Lernplan</h1>
        <div class="sub">Dein personalisierter Wochenplan</div>
      </div>
      ${recs.length === 0
        ? `<div class="empty-state"><div class="empty-icon">&#x1F4C5;</div>Alle Themen auf dem neuesten Stand!</div>`
        : `<div class="lernplan-grid">
            ${plan.filter(p => p.rec).map(p => `
              <div class="lernplan-card" onclick="location.hash='#/fach/${p.rec.subjectId}/${p.rec.yearId}/${p.rec.topicId}'">
                <div class="lernplan-day">${p.day}</div>
                <div class="lernplan-topic">
                  <span class="lernplan-icon">${getSubjectIcon(p.rec.subjectId)}</span>
                  <div>
                    <div class="lernplan-topic-name">${p.rec.topic.name}</div>
                    <div class="lernplan-reason">${p.rec.reason}</div>
                  </div>
                </div>
              </div>`).join('')}
           </div>`}
    </div>`;
}

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
    await addComment(_commentTopicKey, currentUser.uid, currentUser.displayName || 'Nutzer', currentUser.photoURL, text, userRole());
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
  res.innerHTML = results.map(u => {
    const isFriend  = myFriendIds.includes(u.uid);
    const isPending = myReqSentTo.includes(u.uid);
    return `
      <div class="friend-search-item">
        <div class="friend-avatar ${outlineFor(u)}">${_avatar(u.photo, u.name)}</div>
        <div class="friend-name" style="flex:1">${u.name} ${roleBadge(u.role)}</div>
        ${isFriend
          ? `<span class="badge badge-success">Freund</span>`
          : isPending
          ? `<span class="badge badge-muted">Angefragt</span>`
          : `<button class="btn btn-primary btn-sm"
               onclick="window.LF.sendFriendReq('${u.uid}','${u.name.replace(/'/g,"\\'")}','${u.photo||''}')">Hinzufügen</button>`}
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
    await sendFriendRequest(currentUser.uid, currentUser.displayName || 'Nutzer', currentUser.photoURL, toUid, userRole());
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
  // Mission 1: profileView wrapper wurde im neuen Profile-Layout entfernt;
  // profileHeaderCard ist die View-Repräsentation. Optional-chain um Crash zu vermeiden.
  const view = document.getElementById('profileView') || document.querySelector('.profile-header-card');
  const tabs = document.querySelector('.profile-tabs');
  const tabContent = document.querySelector('.profile-tab-content');
  const form = document.getElementById('profileEditForm');
  if (view) view.style.display = 'none';
  if (tabs) tabs.style.display = 'none';
  if (tabContent) tabContent.style.display = 'none';
  if (form) form.style.display = '';
};

window.LF.profileEditClose = () => {
  _pendingProfilePhotoURL = null;
  const view = document.getElementById('profileView') || document.querySelector('.profile-header-card');
  const tabs = document.querySelector('.profile-tabs');
  const tabContent = document.querySelector('.profile-tab-content');
  const form = document.getElementById('profileEditForm');
  if (view) view.style.display = '';
  if (tabs) tabs.style.display = '';
  if (tabContent) tabContent.style.display = '';
  if (form) form.style.display = 'none';
};

// Mission 8 Q1=C: window.LF.pickEmoji entfernt (Emoji-Picker abgeschafft).

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
          <div class="testing-section-title" style="color:#f59e0b">&#128081; ADMIN-Bereich</div>
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
    res.innerHTML = matches.map(u => `
      <div class="friend-search-item" style="margin-bottom:6px">
        <div class="friend-avatar ${outlineFor(u)}">${_avatar(u.photoURL, u.name)}</div>
        <div class="friend-name" style="flex:1">
          ${u.name || 'Unbekannt'} ${roleBadge(u.role)}
          <div style="font-size:11px;color:var(--text-muted)">${u.email || ''}</div>
        </div>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="window.LF.adminSetRole('${u.uid}', 'admin')">+Admin</button>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.adminSetRole('${u.uid}', 'tester')">+Tester</button>
          <button class="btn btn-ghost btn-sm" onclick="window.LF.adminSetRole('${u.uid}', null)">Rolle entfernen</button>
          <button class="btn btn-${u.isBanned ? 'secondary' : 'danger'} btn-sm" onclick="window.LF.adminToggleBan('${u.uid}', ${!u.isBanned})">${u.isBanned ? 'Entsperren' : 'Sperren'}</button>
        </div>
      </div>`).join('');
  } catch(e) {
    console.error('[adminSearch]', e);
    res.innerHTML = `<div class="text-muted" style="color:#ef4444">Fehler: ${e.message}</div>`;
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
      <div id="bugReportErr" style="color:#ef4444;font-size:12px;min-height:16px;margin-bottom:8px"></div>
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
