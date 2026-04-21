// ══════════════════════════════════════════
//  LearningForge — App (Router + Seiten)
// ══════════════════════════════════════════

import { getStructure, getTopicMeta, getTopicQuestions, idToName } from './scanner.js';
import { auth, db, logout, getUserData, saveGrade, onAuthStateChanged } from './auth.js';
import {
  selectQuestions, evaluateAnswers, calcGrade,
  generateCopyText, TIME_OPTIONS, getTimeConfig
} from './test-engine.js';

// ── Globaler State ───────────────────────
let currentUser   = null;
let userData      = null;
let structure     = null;
let testState     = null; // aktiver Test

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
      userData  = await getUserData(user.uid);
      structure = await getStructure();
    }
    route();
  });

  window.addEventListener('hashchange', route);
  document.addEventListener('click', () => {
    document.getElementById('userChip')?.classList.remove('open');
  });
}

// ── Router ───────────────────────────────
function route() {
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
  } else {
    renderDashboard();
  }
}

// ── Navbar rendern ───────────────────────
function renderNav(breadcrumbs = []) {
  const theme = document.documentElement.getAttribute('data-theme');
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
          <a class="nav-link ${breadcrumbs[0]?.label==='Statistiken' ? 'active' : ''}" onclick="location.hash='#/statistiken'">Statistiken</a>
          <a class="nav-link ${breadcrumbs[0]?.label==='Profil' ? 'active' : ''}" onclick="location.hash='#/profil'">Profil</a>
          <a class="nav-link ${breadcrumbs[0]?.label==='Einstellungen' ? 'active' : ''}" onclick="location.hash='#/einstellungen'">Einstellungen</a>
        </div>
      </div>
      <div class="nav-right">
        <button class="btn-icon" id="themeBtn" onclick="window.LF.toggleTheme()" title="Theme wechseln">
          ${theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <div class="user-chip" id="userChip" onclick="window.LF.toggleUserMenu(event)">
          <div class="avatar">${currentUser.photoURL
            ? `<img src="${currentUser.photoURL}" alt="">`
            : (currentUser.displayName || 'U')[0].toUpperCase()
          }</div>
          <span class="uname">${currentUser.displayName?.split(' ')[0] || 'Nutzer'}</span>
          <div class="user-dropdown">
            <a onclick="location.hash='#/profil'">👤 Profil</a>
            <a onclick="location.hash='#/statistiken'">📊 Statistiken</a>
            <a onclick="location.hash='#/einstellungen'">⚙️ Einstellungen</a>
            <div class="divider"></div>
            <button class="danger" onclick="window.LF.doLogout()">Abmelden</button>
          </div>
        </div>
      </div>
    </nav>`;
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
                <div class="s-icon">${s.icon}</div>
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
          <span class="att-icon">${a.subject.icon}</span>
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
          <span class="recent-icon">${r.subject.icon}</span>
          <div class="recent-info">
            <div class="recent-name">${r.topic.name}</div>
            <div class="recent-sub">${r.subject.name} · ${r.g.points}/${r.g.maxPoints} Pkt</div>
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
      </div>
      ${attentionHtml}
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
        <h1>${subject.icon} ${subject.name}</h1>
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
        const gradeInfo = g ? calcGrade(g.points||0, g.maxPoints||1) : null;
        return `
          <div class="topic-card" onclick="location.hash='#/fach/${subjectId}/${yearId}/${t.id}'">
            <div class="t-info">
              <div class="t-name">${t.name}</div>
              ${g ? `<div class="t-desc">Letzte Note: ${g.grade} · ${g.points}/${g.maxPoints} Pkt.</div>` : '<div class="t-desc">Noch nicht getestet</div>'}
            </div>
            <div class="t-right">
              ${gradeInfo ? `<div class="t-grade" style="background:${gradeInfo.color}">${g.grade}</div>` : ''}
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
        <h1>${subject.icon} ${year.name}</h1>
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

  document.getElementById('app').innerHTML = `
    ${renderNav([
      { label: subject.name, href: `#/fach/${subjectId}` },
      { label: year.name,    href: `#/fach/${subjectId}/${yearId}` },
      { label: topic.name }
    ])}
    <div class="page topic-page">
      <div class="topic-header" style="--subject-color:${subject.color}">
        <span class="badge">${subject.icon} ${subject.name} · ${year.name}</span>
        <h1>${topic.name}</h1>
      </div>
      <div id="topicBody"><div class="spinner" style="margin:40px auto"></div></div>
    </div>`;

  const meta      = await getTopicMeta(subjectId, yearId, topicId);
  const questions = await getTopicQuestions(subjectId, yearId, topicId);
  const grades    = userData?.grades || {};
  const prevGrade = grades[`${subjectId}__${yearId}__${topicId}`];
  const color     = getSubjectColor(subjectId);

  const lernenTab = meta.content
    ? `<div class="content-block"><div class="content-body">${meta.content}</div></div>`
    : `<div class="empty-state" style="padding:40px">Kein Lerninhalt für dieses Thema vorhanden.</div>`;

  const uebenTab = questions.length > 0
    ? renderUebenStart(questions, subjectId, yearId, topicId)
    : `<div class="empty-state" style="padding:40px">Keine Übungsaufgaben vorhanden.</div>`;

  const gradeInfo = prevGrade ? calcGrade(prevGrade.points||0, prevGrade.maxPoints||1) : null;
  const testTab = questions.length > 0 ? `
    <div class="test-start" id="testArea">
      <h2>Test starten</h2>
      ${gradeInfo
        ? `<p>Letzte Note: <strong>${prevGrade.grade} – ${gradeInfo.label}</strong> (${prevGrade.points}/${prevGrade.maxPoints} Punkte)</p>`
        : '<p>Noch kein Test gemacht. Wie lange möchtest du testen?</p>'}
      <div class="time-selector">
        ${TIME_OPTIONS.map(t => `<button class="time-btn ${t===15?'active':''}" onclick="window.LF.selectTime(${t})" id="timeBtn${t}">${t} min</button>`).join('')}
      </div>
      <div class="time-hint" id="timeHint">Zwei bis drei Sätze mit kurzer Begründung.</div>
      <button class="btn btn-primary btn-lg" onclick="window.LF.startTest('${subjectId}','${yearId}','${topicId}')">
        Test beginnen
      </button>
    </div>` : `<div class="empty-state" style="padding:40px">Keine Testfragen vorhanden.</div>`;

  document.getElementById('topicBody').innerHTML = `
    <div class="topic-tabs" style="--subject-color:${color}">
      <button class="tab-btn active" id="tabBtnLernen"  onclick="window.LF.switchTab('Lernen')">Lernen</button>
      <button class="tab-btn"        id="tabBtnUeben"   onclick="window.LF.switchTab('Ueben')">Üben</button>
      <button class="tab-btn"        id="tabBtnTest"    onclick="window.LF.switchTab('Test')">Test</button>
    </div>
    <div id="tabLernen" class="tab-panel">${lernenTab}</div>
    <div id="tabUeben"  class="tab-panel" style="display:none">${uebenTab}</div>
    <div id="tabTest"   class="tab-panel" style="display:none">${testTab}</div>`;
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
  const datestrs = [...new Set(
    Object.values(grades)
      .filter(g => g.date?.seconds)
      .map(g => new Date(g.date.seconds * 1000).toDateString())
  )].sort((a, b) => new Date(b) - new Date(a));

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
  return Object.entries(grades)
    .filter(([, g]) => g.date?.seconds)
    .sort((a, b) => b[1].date.seconds - a[1].date.seconds)
    .slice(0, 5)
    .map(([key, g]) => {
      const [subjectId, yearId, topicId] = key.split('__');
      const subject = structure?.[subjectId];
      const topic   = subject?.years?.[yearId]?.topics?.[topicId];
      return subject && topic ? { subjectId, yearId, topicId, subject, topic, g } : null;
    })
    .filter(Boolean);
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

// ── Fachfarbe abrufen (Nutzer > Standard) ─
export function getSubjectColor(subjectId) {
  const custom = userData?.settings?.subjectColors?.[subjectId];
  return custom || structure?.[subjectId]?.color || '#6366f1';
}

// ── Einstellungen-Seite ──────────────────
function renderSettings() {
  const subjects = Object.values(structure || {});

  const colorRows = subjects.map(s => {
    const current = getSubjectColor(s.id);
    return `
      <div class="settings-color-row">
        <div class="settings-subject-info">
          <span class="settings-icon">${s.icon}</span>
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
          <span>${s.icon} ${s.name}</span>
          <span class="subj-bar-meta">${prog.tested}/${prog.total} Themen${avgInfo}</span>
        </div>
        <div class="subj-bar-track">
          <div class="subj-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="subj-bar-pct" style="color:${color}">${pct}%</div>
      </div>`;
  }).join('');

  // Letzte 10 Tests als Tabelle
  const allTestsSorted = Object.entries(grades)
    .filter(([,g]) => g.date?.seconds)
    .sort((a,b) => b[1].date.seconds - a[1].date.seconds)
    .slice(0, 10);

  const testRows = allTestsSorted.map(([key, g]) => {
    const [subjectId, yearId, topicId] = key.split('__');
    const subject = structure?.[subjectId];
    const topic   = subject?.years?.[yearId]?.topics?.[topicId];
    if (!subject || !topic) return '';
    const date = new Date(g.date.seconds * 1000).toLocaleDateString('de-DE');
    const info = calcGrade(g.points||0, g.maxPoints||1);
    return `
      <tr onclick="location.hash='#/fach/${subjectId}/${yearId}/${topicId}'" style="cursor:pointer">
        <td>${subject.icon} ${subject.name}</td>
        <td>${topic.name}</td>
        <td><span class="grade-pill" style="background:${gradeColor(g.grade)}">${g.grade}</span></td>
        <td>${g.points}/${g.maxPoints}</td>
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
          <div class="stats-card-title">🕐 Letzte 10 Tests</div>
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

// ── Profil-Seite ─────────────────────────
function renderProfile() {
  const grades   = userData?.grades || {};
  const subjects = Object.values(structure || {});
  const initial  = (currentUser.displayName || 'U')[0].toUpperCase();

  const gradeRows = subjects.map(s => {
    const sGrades = Object.entries(grades).filter(([k]) => k.startsWith(s.id));
    if (sGrades.length === 0) return '';
    const avg = sGrades.reduce((sum, [,g]) => sum + (g.grade||0), 0) / sGrades.length;
    const { color } = calcGrade(0, 1); // just for color logic
    const gi = calcGrade(Math.max(0, 7 - avg), 6);
    return `
      <div class="grade-row">
        <span>${s.icon} ${s.name}</span>
        <div class="grade-badge" style="background:${gi.color}">${avg.toFixed(1)}</div>
      </div>`;
  }).filter(Boolean).join('') || '<div class="empty-state" style="padding:16px">Noch keine Noten vorhanden.</div>';

  document.getElementById('app').innerHTML = `
    ${renderNav([{ label: 'Profil' }])}
    <div class="page">
      <div class="page-header"><h1>👤 Mein Profil</h1></div>
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
    </div>`;
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

// ── Test-Ablauf ───────────────────────────
let selectedTime = 15;

window.LF = {
  toggleTheme,
  toggleUserMenu: (e) => {
    e.stopPropagation();
    const chip = document.getElementById('userChip');
    chip?.classList.toggle('open');
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
    // Struktur-Cache aktualisieren
    subjects.forEach(s => { if (structure[s.id]) structure[s.id].color = colors[s.id]; });
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
  selectTime: (t) => {
    selectedTime = t;
    TIME_OPTIONS.forEach(opt => {
      document.getElementById(`timeBtn${opt}`)?.classList.toggle('active', opt === t);
    });
    const hint = document.getElementById('timeHint');
    if (hint) hint.textContent = getTimeConfig(t).textExpectation;
  },
  startTest: async (subjectId, yearId, topicId) => {
    const questions = await getTopicQuestions(subjectId, yearId, topicId);
    const selected  = selectQuestions(questions, selectedTime);
    const subject   = structure[subjectId];
    const topic     = subject.years[yearId].topics[topicId];
    renderActiveTest(selected, selectedTime, subjectId, yearId, topicId, subject, topic);
  },

  switchTab: (name) => {
    ['Lernen','Ueben','Test'].forEach(t => {
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
    userData.grades = {};
    await db().collection('users').doc(currentUser.uid).update({ grades: {} }).catch(console.error);
    showToast('Statistiken zurückgesetzt.', 'info');
    renderProfile();
  },

  downloadPDF: () => window.print()
};

function renderActiveTest(questions, timeMinutes, subjectId, yearId, topicId, subject, topic) {
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
  const { questions, answers, timeMinutes, subjectId, yearId, topicId, subjectName, topicName, startTime } = testState;
  const timeUsed = Math.round((Date.now() - startTime) / 1000);

  document.getElementById('testArea').innerHTML = `
    <div style="text-align:center;padding:40px">
      <div class="spinner" style="margin:0 auto 16px"></div>
      <p>Antworten werden ausgewertet…</p>
    </div>`;

  const results = await evaluateAnswers(questions, answers, timeMinutes);
  const total   = results.reduce((s,r) => s+(r.points||0), 0);
  const max     = results.reduce((s,r) => s+(r.maxPoints||0), 0);
  const grade   = calcGrade(total, max);

  // Note speichern
  if (currentUser) {
    userData = userData || {};
    userData.grades = userData.grades || {};
    userData.grades[`${subjectId}__${yearId}__${topicId}`] = {
      grade: grade.grade, points: total, maxPoints: max
    };
    await saveGrade(currentUser.uid, subjectId, yearId, topicId, {
      grade: grade.grade, points: total, maxPoints: max
    }).catch(console.error);
  }

  renderResults(questions, answers, results, grade, total, max, timeUsed, { subjectName, topicName, timeMinutes });
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
        <div class="grade-display">
          <div class="grade-circle" style="background:${grade.color}">${grade.grade}</div>
          <div class="grade-label">${grade.label}</div>
          <div class="grade-points">${total} von ${max} Punkten · ${pct}%</div>
        </div>
        <div class="section-title">Aufgaben im Detail</div>
        <div class="results-list">${resultItems}</div>
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
  setTimeout(() => toast.remove(), 3000);
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
