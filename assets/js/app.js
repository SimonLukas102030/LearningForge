// ══════════════════════════════════════════
//  LearningForge — App (Router + Seiten)
// ══════════════════════════════════════════

import { getStructure, getTopicMeta, getTopicQuestions, idToName } from './scanner.js';
import { auth, db, logout, getUserData, saveGrade, saveWeakQuestions, onAuthStateChanged, updateLeaderboard, getLeaderboard, resetLeaderboard, getAllUsers, setBanStatus, createGroup, joinGroupByCode, leaveGroup, kickFromGroup, getUserGroups, saveCustomTopic, getMyCustomTopics, getGroupCustomTopics, deleteCustomTopic, getCustomTopicById, toggleBookmark, saveNote, saveSRS, addStudyTime, saveXP, saveAchievements, incrementCounter, saveDailyScore, getDailyScores, saveFreezeDays } from './auth.js';
import { ACHIEVEMENTS, calcLevel, calcXPForTest, MOTIVATION_SENTENCES } from './achievements.js';
import {
  selectQuestions, evaluateAnswers, calcGrade,
  generateCopyText, TIME_OPTIONS, getTimeConfig,
  generateQuestionsWithGemini,
  selectVocabQuestions, evaluateVocabAnswer
} from './test-engine.js';

// ── Globaler State ───────────────────────
const ADMIN_EMAIL = 'simonkoper27@gmail.com';

let currentUser        = null;
let userData           = null;
let structure          = null;
let testState          = null;
let tabSwitchPenalty   = false;
let visibilityHandler  = null;
let calcExpr           = '';
let currentSubtopics   = null;
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

// ── Online/Offline-Banner (F-11) ─────────
function updateOnlineStatus(isOnline) {
  const existing = document.getElementById('offlineBanner');
  if (!isOnline) {
    if (!existing) {
      const el = document.createElement('div');
      el.id = 'offlineBanner';
      el.className = 'offline-banner';
      el.innerHTML = '📶 Offline — Inhalte aus dem Cache';
      document.body.appendChild(el);
    }
  } else {
    if (existing) {
      existing.remove();
      showToast('Wieder online ✓', 'success');
    }
  }
}

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

  const check = () => {
    // Remove class first so we can measure natural content width
    navbar.classList.remove('navbar--collapsed');
    const brand  = navbar.querySelector('.nav-brand');
    const center = navbar.querySelector('.nav-center');
    const right  = navbar.querySelector('.nav-right');
    if (!brand || !center || !right) return;
    // 48 = left+right padding, 32 = safety buffer
    const needed = brand.offsetWidth + center.scrollWidth + right.offsetWidth + 80;
    if (needed > navbar.offsetWidth) navbar.classList.add('navbar--collapsed');
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
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}

// ── App starten ──────────────────────────
export function startApp() {
  onAuthStateChanged(async user => {
    currentUser = user;
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
      structure = await getStructure();
      await loadToolsOverride();
      checkAndShowWeeklySummary();
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

// ── Router ───────────────────────────────
function route() {
  unmountCalculator();
  unmountTafelwerk();
  unmountPomodoro();
  const hash  = location.hash.replace('#/', '') || '';
  const parts = hash.split('/').filter(Boolean);

  if (!currentUser) {
    renderLogin();
    return;
  }

  if (parts[0] === 'fach') {
    const [, subject, year, topic] = parts;
    if (topic)    renderTopic(subject, year, topic);
    else if (year) renderYear(subject, year);
    else           renderSubject(subject);
  } else if (parts[0] === 'profil') {
    renderProfile();
  } else if (parts[0] === 'einstellungen') {
    renderSettings();
  } else if (parts[0] === 'statistiken') {
    renderStatistics();
  } else if (parts[0] === 'rangliste') {
    renderLeaderboard();
  } else if (parts[0] === 'admin') {
    if (currentUser?.email === ADMIN_EMAIL) renderAdmin();
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
  } else {
    renderDashboard();
  }
}

// ── Navbar rendern ───────────────────────
function renderNav(breadcrumbs = []) {
  const theme = document.documentElement.getAttribute('data-theme');
  const act   = (label) => breadcrumbs[0]?.label === label ? 'active' : '';
  return `
    <nav class="navbar">
      <div class="nav-brand" onclick="location.hash='#/'">
        <span class="icon">⚡</span> LearningForge
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
          <a class="nav-link ${act('Statistiken')}"  onclick="location.hash='#/statistiken'">Statistiken</a>
          <a class="nav-link ${act('Rangliste')}"    onclick="location.hash='#/rangliste'">Rangliste</a>
          <a class="nav-link ${act('Gruppen')}"        onclick="location.hash='#/gruppen'">Gruppen</a>
          <a class="nav-link ${act('Meine Inhalte')}" onclick="location.hash='#/meine-inhalte'">Meine Inhalte</a>
          <a class="nav-link ${act('Builder')}"        onclick="location.hash='#/builder'">Builder</a>
          <a class="nav-link ${act('Profil')}"       onclick="location.hash='#/profil'">Profil</a>
          <a class="nav-link ${act('Einstellungen')}" onclick="location.hash='#/einstellungen'">Einstellungen</a>
          ${currentUser?.email === ADMIN_EMAIL ? `<a class="nav-link nav-link-admin ${act('Admin')}" onclick="location.hash='#/admin'">Admin</a>` : ''}
        </div>
      </div>
      <div class="nav-right">
        ${(() => { const xi = userData ? calcLevel(userData.xp || 0) : null; return xi ? `
        <div class="nav-xp-chip" title="Level ${xi.level} — ${xi.title} | ${xi.xpCurrent}/${xi.xpNeeded} XP" onclick="location.hash='#/profil'">
          <span class="nav-xp-level">Lv.${xi.level}</span>
          <div class="nav-xp-track"><div class="nav-xp-fill" id="navXPFill" style="width:${xi.pct}%"></div></div>
        </div>` : ''; })()}
        <button class="btn-icon" id="themeBtn" onclick="window.LF.toggleTheme()" title="Theme wechseln">
          ${theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <button class="btn-icon hamburger" onclick="window.LF.toggleMobileMenu(event)" aria-label="Menü">
          <svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor">
            <rect width="16" height="2" rx="1"/><rect y="6" width="16" height="2" rx="1"/><rect y="12" width="16" height="2" rx="1"/>
          </svg>
        </button>
        <div class="user-chip" id="userChip" onclick="window.LF.toggleUserMenu(event)">
          <div class="avatar">${currentUser.photoURL
            ? `<img src="${currentUser.photoURL}" alt="">`
            : (currentUser.displayName || 'U')[0].toUpperCase()
          }</div>
          <span class="uname">${currentUser.displayName?.split(' ')[0] || 'Nutzer'}</span>
          <div class="user-dropdown">
            <a onclick="location.hash='#/profil'">Profil</a>
            <a onclick="location.hash='#/statistiken'">Statistiken</a>
            <a onclick="location.hash='#/rangliste'">Rangliste</a>
            <a onclick="location.hash='#/gruppen'">Gruppen</a>
            <a onclick="location.hash='#/builder'">Builder</a>
            <a onclick="location.hash='#/einstellungen'">Einstellungen</a>
            ${currentUser?.email === ADMIN_EMAIL ? `<a onclick="location.hash='#/admin'" style="color:var(--accent);font-weight:600">Admin-Panel</a>` : ''}
            <div class="divider"></div>
            <button class="danger" onclick="window.LF.doLogout()">Abmelden</button>
          </div>
        </div>
      </div>
    </nav>
    <div class="mobile-nav" id="mobileNav">
      <a class="mobile-nav-link ${!breadcrumbs.length ? 'mnl-active' : ''}" onclick="location.hash='#/';window.LF.closeMobileMenu()">Start</a>
      <a class="mobile-nav-link ${act('Statistiken')}"  onclick="location.hash='#/statistiken';window.LF.closeMobileMenu()">Statistiken</a>
      <a class="mobile-nav-link ${act('Rangliste')}"    onclick="location.hash='#/rangliste';window.LF.closeMobileMenu()">Rangliste</a>
      <a class="mobile-nav-link ${act('Gruppen')}"        onclick="location.hash='#/gruppen';window.LF.closeMobileMenu()">Gruppen</a>
      <a class="mobile-nav-link ${act('Meine Inhalte')}" onclick="location.hash='#/meine-inhalte';window.LF.closeMobileMenu()">Meine Inhalte</a>
      <a class="mobile-nav-link ${act('Builder')}"        onclick="location.hash='#/builder';window.LF.closeMobileMenu()">Builder</a>
      <a class="mobile-nav-link ${act('Profil')}"       onclick="location.hash='#/profil';window.LF.closeMobileMenu()">Profil</a>
      <a class="mobile-nav-link ${act('Einstellungen')}" onclick="location.hash='#/einstellungen';window.LF.closeMobileMenu()">Einstellungen</a>
      ${currentUser?.email === ADMIN_EMAIL ? `<a class="mobile-nav-link" style="color:var(--accent)" onclick="location.hash='#/admin';window.LF.closeMobileMenu()">Admin-Panel</a>` : ''}
      <div class="mobile-nav-sep"></div>
      <a class="mobile-nav-link mobile-nav-danger" onclick="window.LF.doLogout()">Abmelden</a>
    </div>`;
}

// ── Login-Seite ──────────────────────────
function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-wrap">
      <div class="login-card">
        <div style="position:absolute;top:16px;right:16px">
          <button class="btn-icon" onclick="window.LF.toggleTheme()" title="Theme">
            ${document.documentElement.getAttribute('data-theme')==='dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div class="login-logo">
          <div class="logo-icon">⚡</div>
          <h1>LearningForge</h1>
          <p>Dein persönlicher Lernhub</p>
        </div>
        ${loginBanError ? `<div class="error-msg" style="margin-bottom:12px">Dein Konto wurde gesperrt. Wende dich an den Administrator.</div>` : ''}
        <div id="authError"></div>
        <div id="loginForm">
          <div id="nameGroup" style="display:none" class="form-group">
            <label class="form-label">Name</label>
            <input class="form-input" id="authName" type="text" placeholder="Dein Name">
          </div>
          <div class="form-group">
            <label class="form-label">E-Mail</label>
            <input class="form-input" id="authEmail" type="email" placeholder="name@schule.de">
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
          <div class="toggle-auth">
            <span id="toggleText">Noch kein Konto?</span>
            <button onclick="window.LF.toggleAuthMode()">Registrieren</button>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById('authEmail').addEventListener('keydown', e => { if(e.key==='Enter') window.LF.submitAuth(); });
  document.getElementById('authPass').addEventListener('keydown',  e => { if(e.key==='Enter') window.LF.submitAuth(); });
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
          <div class="setup-icon">⚙️</div>
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
  const attention  = getNeedsAttention();
  const recent     = getRecentTests();

  // Subject cards mit Fortschrittsring
  const subjectCards = subjects.length === 0
    ? `<div class="empty-state"><div class="empty-icon">📂</div>Noch keine Fächer vorhanden.<br>Füge Ordner unter <code>Fächer/</code> hinzu.</div>`
    : subjects.map(s => {
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
                <div class="s-name">${s.name}</div>
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
    <div class="section-title" style="margin-top:32px">⚠️ Braucht Aufmerksamkeit</div>
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
    <div class="section-title" style="margin-top:32px">🕐 Letzte Tests</div>
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
          <h1>Willkommen zurück, ${currentUser.displayName?.split(' ')[0] || 'Lernender'}! 👋</h1>
          <div class="sub">Wähle ein Fach und starte deine Lernsession.</div>
        </div>
        ${streak > 1 ? `<div class="streak-badge">🔥 ${streak} Tage Streak</div>` : ''}
      </div>
      <div class="stats-bar">
        <div class="stat-chip"><span class="stat-val">${subjects.length}</span><span class="stat-lbl">Fächer</span></div>
        <div class="stat-chip"><span class="stat-val">${totalTests}</span><span class="stat-lbl">Tests gemacht</span></div>
        <div class="stat-chip"><span class="stat-val">${avgGrade}</span><span class="stat-lbl">Ø Note</span></div>
        <div class="stat-chip" onclick="location.hash='#/statistiken'" style="cursor:pointer">
          <span class="stat-val">📊</span><span class="stat-lbl">Statistiken</span>
        </div>
        ${getSRSDueCount() > 0 ? `
        <div class="stat-chip srs-chip" onclick="location.hash='#/srs'" style="cursor:pointer">
          <span class="stat-val">${getSRSDueCount()}</span><span class="stat-lbl">SRS fällig</span>
        </div>` : ''}
      </div>
      ${renderDailyChallengeCard()}
      ${attentionHtml}
      ${_installPrompt && !localStorage.getItem('lf_install_dismissed') ? `
        <div class="install-card" id="installCard">
          <div class="install-card-icon">⚡</div>
          <div class="install-card-info">
            <div class="install-card-title">App installieren</div>
            <div class="install-card-sub">Offline nutzen &amp; schneller laden</div>
          </div>
          <div class="install-card-actions">
            <button class="btn btn-primary btn-sm" onclick="window.LF.installApp()">Installieren</button>
            <button class="btn btn-ghost btn-sm" onclick="window.LF.dismissInstall()">Nicht jetzt</button>
          </div>
        </div>` : ''}
      <div class="section-title" style="margin-top:${attention.length?'32px':'0'}">📚 Fächer</div>
      <div class="subjects-grid">${subjectCards}</div>
      ${recentHtml}
    </div>`;
}

// ── Fach-Seite (Jahresauswahl) ────────────
function renderSubject(subjectId) {
  const subject = structure?.[subjectId];
  if (!subject) { location.hash = '#/'; return; }

  const years = Object.values(subject.years || {});
  const grades = userData?.grades || {};

  const yearCards = years.length === 0
    ? `<div class="empty-state"><div class="empty-icon">📅</div>Noch keine Klassen vorhanden.</div>`
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
    ? `<div class="empty-state"><div class="empty-icon">📝</div>Noch keine Themen vorhanden.</div>`
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
                onclick="event.stopPropagation();window.LF.toggleBookmarkTopic('${tKey}')">🔖</button>
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
    lernenTab = `<div class="content-block"><div class="content-body">${meta.content}</div></div>`;
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
  flashcardState = null;

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
        ${TIME_OPTIONS.map(t => `<button class="time-btn ${t===15?'active':''}" onclick="window.LF.selectTime(${t})" id="timeBtn${t}">${t} min</button>`).join('')}
      </div>
      <div class="time-hint" id="timeHint">Zwei bis drei Sätze mit kurzer Begründung.</div>
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
        <div class="fc-start-icon">🃏</div>
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
        ⚠️ Empfohlene Voraussetzungen noch nicht abgeschlossen:
        ${missedPrereqs.map(p => `<span class="prereq-tag">${decodeURIComponent(p).replace(/-/g,' ')}</span>`).join('')}
      </div>` : ''}
    <div class="topic-toolbar">
      <button class="bookmark-btn ${isBookmarked ? 'active' : ''}" id="bookmarkBtn"
              onclick="window.LF.toggleBookmarkTopic('${topicKey}')">
        ${isBookmarked ? '🔖 Gespeichert' : '🔖 Lesezeichen'}
      </button>
    </div>
    <div class="topic-tabs" style="--subject-color:${color}">
      <button class="tab-btn active" id="tabBtnLernen"  onclick="window.LF.switchTab('Lernen')">Lernen</button>
      <button class="tab-btn"        id="tabBtnUeben"   onclick="window.LF.switchTab('Ueben')">Üben</button>
      <button class="tab-btn"        id="tabBtnTest"    onclick="window.LF.switchTab('Test')">Test</button>
      ${hasFlashcards ? `<button class="tab-btn" id="tabBtnKarten" onclick="window.LF.switchTab('Karten')">🃏 Karten</button>` : ''}
      ${hasVocab ? `<button class="tab-btn" id="tabBtnVokabeln" onclick="window.LF.switchTab('Vokabeln')">Vokabeln</button>` : ''}
    </div>
    <div id="tabLernen"  class="tab-panel">${lernenTabFull}</div>
    <div id="tabUeben"   class="tab-panel" style="display:none">${uebenTab}</div>
    <div id="tabTest"    class="tab-panel" style="display:none">${testTab}</div>
    ${hasFlashcards ? `<div id="tabKarten"  class="tab-panel" style="display:none">${flashcardTab}</div>` : ''}
    ${hasVocab ? `<div id="tabVokabeln" class="tab-panel" style="display:none">${renderVocabStart(vocabQuestions)}</div>` : ''}
    <div class="notes-panel" id="notesPanel">
      <button class="notes-toggle" onclick="window.LF.toggleNotes()">
        📝 Notizen <span id="notesArrow">▼</span>
      </button>
      <div class="notes-body" id="notesBody" style="display:none">
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
      <div class="vocab-start-icon">📖</div>
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
  const icon = result.correct ? (result.almost ? '~' : '✓') : '✗';
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
      <div class="wc-fb" id="wcFb_${topicKey}_${i}" style="display:none"><strong>✓ ${q.answer || ''}</strong></div>
    </div>`;
  }).join('');
  return `
    <div class="wissens-check">
      <div class="wissens-check-title">🧪 Schnell-Check</div>
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
function getSubjectIcon(subjectId) {
  const url = userData?.settings?.customIconUrls?.[subjectId];
  if (url) return `<img class="subject-icon-img" src="${url}" alt="">`;
  return userData?.settings?.customIcons?.[subjectId] || structure?.[subjectId]?.icon || '📚';
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
            📁
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
        <h1>⚙️ Einstellungen</h1>
        <div class="sub">Passe LearningForge nach deinen Wünschen an.</div>
      </div>

      <div class="settings-card">
        <div class="settings-section-title">🎨 Fächerfarben</div>
        <p class="settings-hint">Die Farben werden nur für dein Konto gespeichert.</p>
        <div class="settings-color-list">
          ${subjects.length === 0
            ? '<div class="empty-state"><div class="empty-icon">📂</div>Noch keine Fächer vorhanden.</div>'
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
            ? '<div class="empty-state"><div class="empty-icon">📂</div>Noch keine Fächer vorhanden.</div>'
            : iconRows}
        </div>
        ${subjects.length > 0 ? `
          <div class="settings-actions">
            <button class="btn btn-primary" onclick="window.LF.saveIcons()">Icons speichern</button>
          </div>` : ''}
      </div>

      <div class="settings-card" style="margin-top:16px">
        <div class="settings-section-title">🌗 Darstellung</div>
        <div class="settings-color-row">
          <div class="settings-subject-info">
            <span class="settings-name">Dark / Light Mode</span>
          </div>
          <div class="settings-color-right">
            <button class="btn btn-secondary" onclick="window.LF.toggleTheme()">
              ${document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Statistik-Seite ──────────────────────
function renderStatistics() {
  const grades   = userData?.grades || {};
  const subjects = Object.values(structure || {});
  const allGrades = Object.values(grades).filter(g => g.grade);
  const totalTests = allGrades.length;
  const avgGrade   = totalTests ? (allGrades.reduce((s,g)=>s+g.grade,0)/totalTests).toFixed(2) : null;
  const bestGrade  = totalTests ? Math.min(...allGrades.map(g=>g.grade)) : null;
  const worstGrade = totalTests ? Math.max(...allGrades.map(g=>g.grade)) : null;
  const streak     = calcStreak();

  // Übersicht-Karten
  const overviewCards = `
    <div class="stats-overview-grid">
      <div class="stat-overview-card">
        <div class="soc-val">${totalTests}</div>
        <div class="soc-lbl">Tests insgesamt</div>
      </div>
      <div class="stat-overview-card">
        <div class="soc-val" style="color:${avgGrade ? gradeColor(Math.round(parseFloat(avgGrade))) : 'inherit'}">${avgGrade || '–'}</div>
        <div class="soc-lbl">Ø Note gesamt</div>
      </div>
      <div class="stat-overview-card">
        <div class="soc-val" style="color:${bestGrade ? gradeColor(bestGrade) : 'inherit'}">${bestGrade || '–'}</div>
        <div class="soc-lbl">Beste Note</div>
      </div>
      <div class="stat-overview-card">
        <div class="soc-val">${streak}</div>
        <div class="soc-lbl">🔥 Tage Streak</div>
      </div>
    </div>`;

  // Fächer-Balken
  const subjectBars = subjects.map(s => {
    const prog = getSubjectProgress(s.id);
    if (prog.total === 0) return '';
    const color = getSubjectColor(s.id);
    const pct   = prog.total > 0 ? Math.round(prog.tested / prog.total * 100) : 0;
    const avgInfo = prog.avgGrade ? ` · Ø Note ${prog.avgGrade.toFixed(1)}` : '';
    return `
      <div class="subj-bar-row">
        <div class="subj-bar-label">
          <span>${getSubjectIcon(s.id)} ${s.name}</span>
          <span class="subj-bar-meta">${prog.tested}/${prog.total} Themen${avgInfo}</span>
        </div>
        <div class="subj-bar-track">
          <div class="subj-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="subj-bar-pct" style="color:${color}">${pct}%</div>
      </div>`;
  }).join('');

  // Alle Versuche aus history flach machen, nach Datum sortieren
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
             date: new Date(g.date.seconds * 1000).toISOString() }
      }];
    }
    return [];
  }).sort((a, b) => new Date(b.h.date) - new Date(a.h.date)).slice(0, 15);

  const testRows = allAttempts.map(({ subjectId, yearId, topicId, subject, topic, h }) => {
    const date = new Date(h.date).toLocaleDateString('de-DE');
    return `
      <tr onclick="location.hash='#/fach/${subjectId}/${yearId}/${topicId}'" style="cursor:pointer">
        <td>${getSubjectIcon(subjectId)} ${subject.name}</td>
        <td>${topic.name}</td>
        <td><span class="grade-pill" style="background:${gradeColor(h.grade)}">${h.grade}</span></td>
        <td>${h.points}/${h.maxPoints}</td>
        <td>${date}</td>
      </tr>`;
  }).join('');

  // Notenverteilung (1-6)
  const gradeCounts = [1,2,3,4,5,6].map(n => ({
    grade: n,
    count: allGrades.filter(g => g.grade === n).length
  }));
  const maxCount = Math.max(...gradeCounts.map(g=>g.count), 1);
  const gradeDistribution = gradeCounts.map(({grade, count}) => `
    <div class="grade-dist-col">
      <div class="grade-dist-bar-wrap">
        <div class="grade-dist-count">${count || ''}</div>
        <div class="grade-dist-bar" style="height:${Math.round(count/maxCount*80)+8}px;background:${gradeColor(grade)}"></div>
      </div>
      <div class="grade-dist-label">${grade}</div>
    </div>`).join('');

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Statistiken' }])}
    <div class="page">
      <div class="page-header">
        <h1>📊 Statistiken</h1>
        <div class="sub">Dein Lernfortschritt auf einen Blick.</div>
      </div>

      ${totalTests === 0 ? `
        <div class="empty-state"><div class="empty-icon">📊</div>Noch keine Tests gemacht.<br>Starte einen Test um Statistiken zu sehen!</div>
      ` : `
        ${overviewCards}

        <div class="stats-section-grid">
          <div class="stats-card">
            <div class="stats-card-title">📈 Fortschritt nach Fach</div>
            <div class="subj-bars">${subjectBars || '<div class="empty-state" style="padding:16px">Keine Daten</div>'}</div>
          </div>
          <div class="stats-card">
            <div class="stats-card-title">📊 Notenverteilung</div>
            <div class="grade-distribution">${gradeDistribution}</div>
            <div class="grade-dist-legend">Note 1 (sehr gut) → Note 6 (ungenügend)</div>
          </div>
        </div>

        <div class="stats-card" style="margin-top:16px">
          <div class="stats-card-title">🕐 Letzte Versuche</div>
          ${testRows ? `
            <div class="table-wrap">
              <table class="stats-table">
                <thead><tr><th>Fach</th><th>Thema</th><th>Note</th><th>Punkte</th><th>Datum</th></tr></thead>
                <tbody>${testRows}</tbody>
              </table>
            </div>` : '<div class="empty-state" style="padding:16px">Keine Tests</div>'}
        </div>
      `}
    </div>`;
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
            onclick="event.stopPropagation();window.LF.toggleBookmarkTopic('${key}')">🔖</button>
          <div class="t-arrow">›</div>
        </div>
      </div>`;
  }).filter(Boolean).join('');

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Lesezeichen' }])}
    <div class="page">
      <div class="page-header">
        <h1>🔖 Lesezeichen</h1>
        <div class="sub">Gespeicherte Themen</div>
      </div>
      ${cards
        ? `<div class="topic-list">${cards}</div>`
        : `<div class="empty-state"><div class="empty-icon">🔖</div>Noch keine Lesezeichen.<br>Öffne ein Thema und klicke auf 🔖.</div>`}
    </div>`;
}

// ── SRS-Seite (F-16) ─────────────────────
function renderSRS() {
  const due = getSRSDueCards();

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'SRS — Wiederholung' }])}
    <div class="page">
      <div class="page-header">
        <h1>🧠 Spaced Repetition</h1>
        <div class="sub">${due.length} Karte${due.length !== 1 ? 'n' : ''} heute fällig</div>
      </div>
      <div id="srsArea">
        ${due.length === 0
          ? `<div class="empty-state"><div class="empty-icon">🧠</div>Alle Karten für heute erledigt!<br>Mach weiter beim <a href="#/" onclick="location.hash='#/'">Dashboard</a>.</div>`
          : renderSRSCard(due, 0)}
      </div>
    </div>`;

  if (due.length > 0) srsState = { cards: due, current: 0, done: 0 };
}

function renderSRSCard(cards, idx) {
  if (idx >= cards.length) {
    return `<div class="srs-done"><div class="srs-done-icon">🎉</div><h2>Session abgeschlossen!</h2>
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
          <button class="srs-rate-btn rate-bad"   onclick="window.LF.rateSRS(1)">✗ Nicht gewusst</button>
          <button class="srs-rate-btn rate-ok"    onclick="window.LF.rateSRS(3)">~ Schwer</button>
          <button class="srs-rate-btn rate-good"  onclick="window.LF.rateSRS(4)">✓ Gut</button>
          <button class="srs-rate-btn rate-great" onclick="window.LF.rateSRS(5)">⚡ Leicht</button>
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
        <div class="fc-done-icon">🎉</div>
        <h2>Fertig!</h2>
        <div class="fc-score">
          <span class="fc-score-knew">${knew} ✓ gewusst</span>
          <span class="fc-score-didnt">${didntKnow} ✗ nicht gewusst</span>
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
    <div class="fc-counter">${current+1} / ${cards.length} &nbsp;·&nbsp; ✓ ${knew} &nbsp; ✗ ${didntKnow}</div>
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
      <button class="fc-btn fc-btn-no" onclick="window.LF.fcDidntKnow()">✗ Nicht gewusst</button>
      <button class="fc-btn fc-btn-yes" onclick="window.LF.fcKnew()">✓ Gewusst</button>
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
      ⏱ ${m}:${s} <span class="pomo-mode-pill ${mode}">${mode==='work'?'Fokus':'Pause'}</span>
    </button>
    <div class="pomo-panel" id="pomoPanel" style="display:none">
      <div class="pomo-display">
        <div class="pomo-time" id="pomoTime">${m}:${s}</div>
        <div class="pomo-label">${mode==='work'?'🎯 Fokuszeit':'☕ Pause'} · ${sessions} Session${sessions!==1?'s':''}</div>
      </div>
      <div class="pomo-controls">
        <button class="btn btn-primary btn-sm" onclick="window.LF.pomodoroToggle()">${running?'⏸ Pause':'▶ Start'}</button>
        <button class="btn btn-ghost btn-sm" onclick="window.LF.pomodoroReset()">↺</button>
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
      showToast('☕ Fokuszeit vorbei! Pause genießen.', 'info');
    } else {
      pomodoroState.mode = 'work';
      pomodoroState.seconds = pomodoroState.workMins * 60;
      showToast('🎯 Pause vorbei! Weiter geht\'s.', 'info');
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
  if (b) b.innerHTML = `⏱ ${m}:${s} <span class="pomo-mode-pill ${pomodoroState.mode}">${pomodoroState.mode==='work'?'Fokus':'Pause'}</span>`;
}

// ── Profil-Seite ─────────────────────────
function renderProfile() {
  const grades    = userData?.grades || {};
  const subjects  = Object.values(structure || {});
  const initial   = (currentUser.displayName || 'U')[0].toUpperCase();
  const xpInfo    = calcLevel(userData?.xp || 0);
  const achieved  = new Set(userData?.achievements || []);

  const gradeRows = subjects.map(s => {
    const sGrades = Object.entries(grades).filter(([k]) => k.startsWith(s.id));
    if (!sGrades.length) return '';
    const avg = sGrades.reduce((sum, [,g]) => sum + (g.grade||0), 0) / sGrades.length;
    const gi  = calcGrade(Math.max(0, 7 - avg), 6);
    return `
      <div class="grade-row">
        <span>${getSubjectIcon(s.id)} ${s.name}</span>
        <div class="grade-badge" style="background:${gi.color}">${avg.toFixed(1)}</div>
      </div>`;
  }).filter(Boolean).join('') || '<div class="empty-state" style="padding:16px">Noch keine Noten vorhanden.</div>';

  // Achievement grid
  const achTiles = ACHIEVEMENTS.map(a => {
    const unlocked = achieved.has(a.id);
    return `
      <div class="ach-tile ${unlocked ? 'ach-unlocked' : 'ach-locked'}" title="${a.title}: ${a.desc}${unlocked ? '' : ' (noch nicht freigeschaltet)'}">
        <div class="ach-code" style="${unlocked ? `background:${a.color}` : ''}">${a.code}</div>
        <div class="ach-title">${a.title}</div>
        ${unlocked ? `<div class="ach-xp">+${a.xp} XP</div>` : `<div class="ach-xp ach-xp-locked">${a.xp} XP</div>`}
      </div>`;
  }).join('');

  const achCount = achieved.size;

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Profil' }])}
    <div class="page">
      <div class="page-header"><h1>Mein Profil</h1></div>

      <div class="profile-grid">
        <div class="profile-info-card">
          <div class="profile-avatar-large">${
            currentUser.photoURL
              ? `<img src="${currentUser.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
              : initial
          }</div>
          <div class="profile-name">${currentUser.displayName || 'Nutzer'}</div>
          <div class="profile-email">${currentUser.email}</div>
          <br>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn btn-secondary btn-sm" onclick="window.LF.doLogout()">Abmelden</button>
            <button class="btn btn-danger btn-sm" onclick="window.LF.resetAllGrades()">Statistiken zurücksetzen</button>
          </div>
        </div>
        <div class="grades-overview">
          <h3>Ø Noten nach Fach</h3>
          ${gradeRows}
        </div>
      </div>

      <!-- XP / Level (F-25) -->
      <div class="xp-card">
        <div class="xp-card-left">
          <div class="xp-level-badge">Lv.${xpInfo.level}</div>
          <div class="xp-card-info">
            <div class="xp-title">${xpInfo.title}</div>
            <div class="xp-sub">${xpInfo.xpCurrent} / ${xpInfo.xpNeeded} XP bis Level ${xpInfo.level + 1}</div>
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

      <!-- Streak-Kalender (F-27) -->
      <div class="section-title" style="margin-top:32px;margin-bottom:12px">Lern-Aktivität</div>
      ${renderStreakCalendar()}

      <!-- Achievement-Grid (F-24) -->
      <div class="section-title" style="margin-top:32px;margin-bottom:12px">
        Achievements
        <span class="ach-count-badge">${achCount} / ${ACHIEVEMENTS.length}</span>
      </div>
      <div class="achievement-grid">${achTiles}</div>
    </div>`;
}

// ── Rangliste ────────────────────────────
async function renderLeaderboard() {
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Rangliste' }])}
    <div class="page">
      <div class="page-header">
        <h1>🏆 Rangliste</h1>
        <div class="sub">Gesamte Testpunkte aller Themen summiert</div>
      </div>
      <div id="lbContent"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  let data = [];
  let permError = false;
  try { data = await getLeaderboard(); }
  catch(e) { if (e.code === 'permission-denied') permError = true; }

  if (permError) {
    document.getElementById('lbContent').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        Firestore-Regel fehlt.<br>
        <small style="color:var(--text-light);font-size:13px;display:block;margin-top:8px">
          Füge in der Firebase Console unter Firestore → Regeln hinzu:<br>
          <code style="font-size:11px">match /leaderboard/{uid} { allow read: if request.auth != null; allow write: if request.auth.uid == uid; }</code>
        </small>
      </div>`;
    return;
  }

  if (!data.length) {
    document.getElementById('lbContent').innerHTML =
      `<div class="empty-state"><div class="empty-icon">🏆</div>Noch keine Einträge.<br>Mache Tests um in die Rangliste aufgenommen zu werden!</div>`;
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

  const renderRow = (rank, u, score, count, isMe) => {
    const medal = rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : `<span style="font-size:13px;font-weight:700;color:var(--text-muted)">${rank}</span>`;
    const av = u.photoURL
      ? `<img src="${u.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : (u.displayName || '?')[0].toUpperCase();
    return `
      <div class="lb-row${isMe?' lb-me':''}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-avatar">${av}</div>
        <div class="lb-name">${u.displayName||'Unbekannt'}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
        <div class="lb-meta">${count} Test${count!==1?'s':''}</div>
        <div class="lb-score" style="color:var(--accent)">${score}</div>
      </div>`;
  };

  const top10 = [...users].sort((a,b)=>b.overall-a.overall).slice(0,10);
  const top10Html = top10.map((u,i)=>renderRow(i+1,u,u.overall,u.testCount,u.uid===currentUser?.uid)).join('');

  const subjectGridHtml = subjects.map(s => {
    const ranked = users.filter(u=>u.subjectTotals[s.id]).sort((a,b)=>b.subjectTotals[s.id].total-a.subjectTotals[s.id].total).slice(0,5);
    if (!ranked.length) return '';
    const color = getSubjectColor(s.id);
    return `
      <div class="lb-card">
        <div class="lb-card-head" style="border-top:3px solid ${color}">${getSubjectIcon(s.id)} ${s.name}</div>
        ${ranked.map((u,i)=>renderRow(i+1,u,u.subjectTotals[s.id].total,u.subjectTotals[s.id].count,u.uid===currentUser?.uid)).join('')}
      </div>`;
  }).filter(Boolean).join('');

  // XP-Rangliste
  const xpSorted = [...data].filter(u => u.xp > 0).sort((a,b) => (b.xp||0)-(a.xp||0)).slice(0,10);
  const xpHtml = xpSorted.length ? xpSorted.map((u,i) => {
    const xi = calcLevel(u.xp || 0);
    const medal = i < 3 ? ['🥇','🥈','🥉'][i] : `<span style="font-size:13px;font-weight:700;color:var(--text-muted)">${i+1}</span>`;
    const av = u.photoURL
      ? `<img src="${u.photoURL}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : (u.displayName||'?')[0].toUpperCase();
    const isMe = u.uid === currentUser?.uid;
    return `
      <div class="lb-row${isMe?' lb-me':''}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-avatar">${av}</div>
        <div class="lb-name">${u.displayName||'Unbekannt'}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
        <div class="lb-meta">Lv.${xi.level} ${xi.title}</div>
        <div class="lb-score" style="color:#f59e0b">${u.xp} XP</div>
      </div>`;
  }).join('') : '<div class="empty-state" style="padding:24px">Noch keine XP-Daten vorhanden.</div>';

  document.getElementById('lbContent').innerHTML = `
    <div class="lb-tabs" id="lbTabs">
      <button class="lb-tab active" onclick="window.LF.switchLbTab('punkte',this)">Testpunkte</button>
      <button class="lb-tab" onclick="window.LF.switchLbTab('xp',this)">XP / Level</button>
    </div>
    <div id="lbPunkte">
      <div class="lb-main">
        <div class="lb-main-title">Gesamt — Top 10</div>
        <div class="lb-header-row">
          <span class="lb-rank">Pl.</span><span class="lb-avatar"></span>
          <span class="lb-name">Name</span><span class="lb-meta">Tests</span><span class="lb-score">Pkt</span>
        </div>
        ${top10Html}
      </div>
      ${subjectGridHtml ? `<div class="section-title" style="margin-top:32px;margin-bottom:16px">Nach Fach</div><div class="lb-grid">${subjectGridHtml}</div>` : ''}
    </div>
    <div id="lbXP" style="display:none">
      <div class="lb-main">
        <div class="lb-main-title">XP-Rangliste — Top 10</div>
        <div class="lb-header-row">
          <span class="lb-rank">Pl.</span><span class="lb-avatar"></span>
          <span class="lb-name">Name</span><span class="lb-meta">Level</span><span class="lb-score">XP</span>
        </div>
        ${xpHtml}
      </div>
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
    ${groups.length === 0 ? `<div class="empty-state" style="margin-bottom:24px"><div class="empty-icon">👥</div>Du bist noch in keiner Gruppe.</div>` : ''}

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
        <div class="group-member-name">${m.displayName || 'Unbekannt'} ${m.role === 'admin' ? '<span class="group-admin-badge">Admin</span>' : ''}</div>
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

    const medals = ['🥇','🥈','🥉'];
    const lbRows = groupLb.map((u, i) => {
      const av = u.photoURL
        ? `<img src="${u.photoURL}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
        : (u.displayName||'?')[0].toUpperCase();
      const isMe = u.uid === currentUser.uid;
      return `
        <div class="lb-row${isMe ? ' lb-me' : ''}">
          <div class="lb-rank">${i < 3 ? medals[i] : `<span style="font-size:13px;font-weight:700;color:var(--text-muted)">${i+1}</span>`}</div>
          <div class="lb-avatar">${av}</div>
          <div class="lb-name">${u.displayName||'Unbekannt'}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
          <div class="lb-meta">${u.testCount} Test${u.testCount!==1?'s':''}</div>
          <div class="lb-score" style="color:var(--accent)">${u.total}</div>
        </div>`;
    }).join('');

    document.getElementById('groupLbContent').innerHTML = groupLb.length
      ? lbRows
      : '<div class="empty-state" style="padding:16px;font-size:14px">Noch keine Tests gemacht.</div>';
  } catch(e) {
    document.getElementById('groupLbContent').innerHTML = `<div class="empty-state" style="padding:16px;font-size:14px">Rangliste nicht verfügbar.</div>`;
  }
}

// ── Admin-Panel ──────────────────────────
async function renderAdmin() {
  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Admin' }])}
    <div class="page">
      <div class="page-header">
        <h1>Admin-Panel</h1>
        <div class="sub">Nur für ${ADMIN_EMAIL}</div>
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
        <span class="admin-tool-fach">${s.icon || '📚'} ${s.name}</span>
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
  info:    '<div class="lf-box lf-info">💡 Hinweis hier</div>',
  tip:     '<div class="lf-box lf-tip">✅ Tipp hier</div>',
  warn:    '<div class="lf-box lf-warn">⚠️ Warnung hier</div>',
  danger:  '<div class="lf-box lf-danger">🚨 Denkfehler hier</div>',
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
      <div class="builder-step-num">${i + 1 < step ? '✓' : i + 1}</div>
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
          <div class="mode-icon">🧱</div>
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
  heading:    { icon: 'H2', label: 'Überschrift',  make: () => ({ text: 'Neue Überschrift' }) },
  paragraph:  { icon: '¶',  label: 'Absatz',        make: () => ({ text: '' }) },
  infobox:    { icon: '💡', label: 'Info-Box',       make: () => ({ variant: 'info', text: 'Hinweis hier eintragen' }) },
  keypoint:   { icon: '★',  label: 'Kernaussage',   make: () => ({ title: 'Kernaussage', text: 'Inhalt hier' }) },
  list:       { icon: '≡',  label: 'Liste',          make: () => ({ ordered: false, items: ['Punkt 1', 'Punkt 2', 'Punkt 3'] }) },
  definition: { icon: '📖', label: 'Definition',    make: () => ({ term: 'Begriff', text: 'Die Definition des Begriffs.' }) },
  divider:    { icon: '—',  label: 'Trennlinie',    make: () => ({}) },
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
        const icons = { info:'💡 ', tip:'✅ ', warn:'⚠️ ', danger:'🚨 ', formula:'' };
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
  const del = `<button class="vblock-delete" onclick="window.LF.visualDeleteBlock(${i})" title="Entfernen">🗑</button>`;
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
      const variants = { info:'💡 Hinweis', tip:'✅ Tipp', warn:'⚠️ Warnung', danger:'🚨 Fehler', formula:'∑ Formel' };
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
function setupTabSwitchDetection() {
  tabSwitchPenalty = false;
  removeTabSwitchDetection();
  visibilityHandler = () => {
    if (!document.hidden || !testState) return;
    removeTabSwitchDetection();
    tabSwitchPenalty = true;
    showToast('Tab-Wechsel erkannt — Test wird als Note 6 gewertet.', 'error');
    setTimeout(() => window.LF.submitTest(), 1500);
  };
  document.addEventListener('visibilitychange', visibilityHandler);
}

function removeTabSwitchDetection() {
  if (visibilityHandler) {
    document.removeEventListener('visibilitychange', visibilityHandler);
    visibilityHandler = null;
  }
}

// ── Test-Ablauf ───────────────────────────
let selectedTime = 15;

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
    // Mirror XP to leaderboard doc so XP-tab can show it
    p.push(db().collection('leaderboard').doc(uid).set({ xp: userData.xp, displayName: currentUser.displayName || 'Nutzer', photoURL: currentUser.photoURL || null }, { merge: true }).catch(console.error));
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
  const seed    = dateKey.split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  const rand    = _seededRand(seed);

  const allTopics = Object.values(structure || {})
    .flatMap(s => Object.values(s.years || {})
      .flatMap(y => Object.values(y.topics || {})
        .map(t => ({ subjectId: s.id, yearId: y.id, topicId: t.id }))));

  if (!allTopics.length) return [];

  const shuffled = [...allTopics].sort(() => rand() - 0.5);
  const picked   = shuffled.slice(0, Math.min(3, shuffled.length));

  const sets = await Promise.all(
    picked.map(t => getTopicQuestions(t.subjectId, t.yearId, t.topicId).catch(() => ({ questions: [] })))
  );

  const mc = sets.flatMap(r => (r.questions || []).filter(q => q.type === 'multiple_choice'));
  const shuffledQ = [...mc].sort(() => rand() - 0.5);
  return shuffledQ.slice(0, 6);
}

function renderDailyChallengeCard() {
  const today    = new Date().toISOString().slice(0, 10);
  const done     = userData?.dailyChallenges?.[today];
  if (done) {
    const gi = calcGrade(done.points, done.maxPoints);
    return `
      <div class="daily-card daily-card-done" onclick="location.hash='#/daily-challenge'">
        <div class="daily-card-label">Daily Challenge</div>
        <div class="daily-card-status">Heute erledigt</div>
        <div class="daily-card-grade" style="background:${gi.color}">${done.grade}</div>
      </div>`;
  }
  return `
    <div class="daily-card" onclick="location.hash='#/daily-challenge'">
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
      const m = i < 3 ? ['🥇','🥈','🥉'][i] : (i+1);
      const isMe = u.uid === currentUser?.uid;
      return `
        <div class="lb-row${isMe?' lb-me':''}">
          <div class="lb-rank">${m}</div>
          <div class="lb-avatar">${u.displayName?.[0]?.toUpperCase()||'?'}</div>
          <div class="lb-name">${u.displayName||'?'}${isMe?'<span class="lb-me-tag">Du</span>':''}</div>
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

  // Shuffle options for MC
  questions = questions.map(q => {
    if (q.type === 'multiple_choice' && q.options) {
      const indexed = q.options.map((opt, i) => ({ opt, correct: i === q.correct }));
      indexed.sort(() => Math.random() - 0.5);
      return { ...q, shuffledOptions: indexed.map(x=>x.opt), shuffledCorrectIndex: indexed.findIndex(x=>x.correct) };
    }
    return q;
  });

  dailyChallengeState = { questions, answers: new Array(questions.length).fill(null), current: 0, startTime: Date.now(), timer: null, timeLeft: 300, dateKey: today };

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
  doLogout: async () => { await logout(); location.hash = '#/'; },
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
    await db().collection('users').doc(currentUser.uid).update({
      'settings.subjectColors': colors
    }).catch(console.error);
    showToast('Farben gespeichert! ✓', 'success');
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
      await db().collection('users').doc(currentUser.uid).update({
        'settings.subjectColors': {}
      }).catch(console.error);
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

    await db().collection('users').doc(currentUser.uid).update({
      'settings.customIcons':    icons,
      'settings.customIconUrls': mergedUrls
    }).catch(console.error);
    showToast('Icons gespeichert! ✓', 'success');
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
    let pts = 0, max = 0;
    questions.forEach((q, i) => {
      const userAns = parseInt(answers[i] ?? '-1');
      const correct = q.shuffledCorrectIndex ?? q.correct;
      max += q.points || 2;
      if (userAns === correct) pts += q.points || 2;
    });
    const gi = calcGrade(pts, max);

    userData = userData || {};
    userData.dailyChallenges = userData.dailyChallenges || {};
    userData.dailyChallenges[dateKey] = { grade: gi.grade, points: pts, maxPoints: max };
    userData.dailyChallengesCompleted = (userData.dailyChallengesCompleted || 0) + 1;
    await incrementCounter(currentUser.uid, 'dailyChallengesCompleted').catch(console.error);
    await saveDailyScore(currentUser.uid, currentUser.displayName || 'Nutzer', currentUser.photoURL, dateKey, gi.grade, pts, max).catch(console.error);
    await db().collection('users').doc(currentUser.uid).set({ dailyChallenges: { [dateKey]: userData.dailyChallenges[dateKey] } }, { merge: true }).catch(console.error);

    const xpBonus = gi.grade === 1 ? 80 : gi.grade <= 2 ? 50 : 30;
    grantXPAndAchievements({ xp: xpBonus, dailyPerfect: gi.grade === 1 }).catch(console.error);

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
      showToast('Lesezeichen gespeichert! 🔖', 'success');
    }
    // Update UI immediately
    const btn = document.getElementById('bookmarkBtn');
    if (btn) {
      btn.className = `bookmark-btn${isBm ? '' : ' active'}`;
      btn.textContent = isBm ? '🔖 Lesezeichen' : '🔖 Gespeichert';
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
    const body  = document.getElementById('notesBody');
    const arrow = document.getElementById('notesArrow');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (arrow) arrow.textContent = open ? '▼' : '▲';
    if (!open) document.getElementById('notesInput')?.focus();
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
      if (s) { s.textContent = '✓ Gespeichert'; setTimeout(() => { if(s) s.textContent=''; }, 2000); }
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
    if (btn) btn.textContent = pomodoroState.timer ? '⏸ Pause' : '▶ Start';
  },

  pomodoroReset: () => {
    if (!pomodoroState) return;
    clearInterval(pomodoroState.timer);
    pomodoroState.timer = null;
    pomodoroState.mode = 'work';
    pomodoroState.seconds = pomodoroState.workMins * 60;
    _updatePomodoroDisplay();
    const btn = document.querySelector('#pomoPanel .btn-primary');
    if (btn) btn.textContent = '▶ Start';
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
    if (fb) { fb.style.display = 'block'; fb.textContent = chosenIdx === correctIdx ? '✓ Richtig!' : '✗ Falsch'; fb.className = `wc-fb ${chosenIdx===correctIdx?'correct':'wrong'}`; }
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
    const questions = customTopicData.questions || [];
    if (!questions.length) { showToast('Keine Fragen in diesem Thema.', 'error'); return; }
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
    ['Lernen','Ueben','Test','Karten','Vokabeln'].forEach(t => {
      document.getElementById(`tab${t}`)?.style.setProperty('display', t === name ? 'block' : 'none');
      document.getElementById(`tabBtn${t}`)?.classList.toggle('active', t === name);
    });
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

function renderActiveTest(questions, timeMinutes, subjectId, yearId, topicId, subject, topic) {
  setupTabSwitchDetection();
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
  clearInterval(timerInterval);
  removeTabSwitchDetection();
  const penalty = tabSwitchPenalty;
  tabSwitchPenalty = false;

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

  if (currentUser) {
    userData = userData || {};
    userData.grades = userData.grades || {};
    const key      = `${subjectId}__${yearId}__${topicId}`;
    const existing = userData.grades[key] || {};

    const attempt = {
      points: total, maxPoints: max,
      grade: penalty ? 6 : grade.grade,
      date: new Date().toISOString()
    };
    const history = [...(existing.history || []), attempt];

    // Best = attempt with highest percentage
    const bestRun  = history.reduce((best, h) =>
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
    await updateLeaderboard(
      currentUser.uid, currentUser.displayName || 'Nutzer', currentUser.photoURL,
      subjectId, yearId, topicId, bestInfo.grade, bestRun.points
    ).catch(console.error);

    // F-25: XP + F-24: Achievements
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
  }

  renderResults(questions, effectiveAns, results, grade, total, max, timeUsed, { subjectName, topicName, timeMinutes, penalty });
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
  showToast('Ergebnis kopiert! ✓', 'success');
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
      Taschenrechner <span id="calcArrow">▲</span>
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
        <button class="calc-btn calc-op"    onclick="window.LF.calcBack()">⌫</button>
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
      Tafelwerk <span id="twArrow">▲</span>
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
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▲' : '▼';
};

window.LF.toggleTw = () => {
  const panel = document.getElementById('twPanel');
  const arrow = document.getElementById('twArrow');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : 'block';
  if (arrow) arrow.textContent = open ? '▲' : '▼';
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
