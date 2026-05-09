// ══════════════════════════════════════════
//  LearningForge — Widget: pendulum-sim
//  Pendel mit Energieerhaltung (Welle 1.4)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md + Plan-Welle-1)
// ══════════════════════════════════════════
//
// Ein 2D-Canvas-Pendel das physikalisch korrekt schwingt:
//   - Aufhaengung oben mittig, Faden Laenge L, Bob am Ende
//   - Numerische Loesung der Bewegungsgleichung mit Daempfung:
//       d²θ/dt² = -(g/L)·sin(θ) - 2γ·(dθ/dt)
//     (Semi-implizit Euler — stabil genug fuer Schul-Visualisierung)
//   - Reibung γ daempft Amplitude exponentiell
//
// Energie-Doppel-Bar unter dem Canvas zeigt E_kin / E_pot live mit
// m=1kg implizit. Bei γ=0 ist E_kin+E_pot konstant — ohne γ sieht man
// das schoene "Energie-Pendeln" zwischen kin/pot.
//
// Theme: --lf-pn-* CSS-Vars (Light + Dark in main.css). Fallback-Pattern
// wie wave-superposition: erst eigene Var, dann --sim-*, dann --accent.
//
// Config-Schema:
//   {
//     widgetType: 'pendulum-sim',
//     config: {
//       initialL: number       // optional, default 1.0 (m)
//       initialTheta0: number  // optional, default 30 (Grad)
//       initialGamma: number   // optional, default 0
//       autoPlay: boolean      // optional, default true
//       label: string          // optional
//     }
//   }

import { lfWidgetReducedMotion } from './_base.js';

const G = 9.81;

// ── Theme-Reader ──────────────────────────────────────────
function _theme(name, fallback) {
  const css = getComputedStyle(document.documentElement);
  let v = css.getPropertyValue('--lf-pn-' + name).trim();
  if (!v && fallback) v = css.getPropertyValue('--sim-' + fallback).trim();
  if (!v && name === 'bob') v = css.getPropertyValue('--accent').trim();
  return v || '#888';
}

// ── DOM-Helpers ───────────────────────────────────────────
function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function _dpr() { return window.devicePixelRatio || 1; }
function _fitCanvas(canvas, cssW, cssH) {
  const r = _dpr();
  canvas.width  = Math.round(cssW * r);
  canvas.height = Math.round(cssH * r);
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(r, 0, 0, r, 0, 0);
  return ctx;
}

function _slider(label, min, max, step, value, unit, onInput) {
  const wrap = _el('div', 'sim-slider');
  const head = _el('div', 'sim-slider-head');
  const lbl  = _el('span', 'sim-slider-label', label);
  const fmt  = v => (step < 1 ? v.toFixed(2) : v.toFixed(0)) + (unit ? ' ' + unit : '');
  const val  = _el('span', 'sim-slider-value', fmt(value));
  head.append(lbl, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min); input.max = String(max);
  input.step = String(step); input.value = String(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  wrap.append(head, input);
  return { wrap, input, valEl: val, fmt };
}

function _btn(label, onClick, primary) {
  const b = _el('button', 'sim-btn ' + (primary ? 'sim-btn-primary' : ''), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// ── Defaults / Ranges ─────────────────────────────────────
const DEF = { L: 1.0, theta0: 30, gamma: 0 };
const R_L     = [0.2, 3.0, 0.1];
const R_THETA = [5, 80, 1];
const R_GAMMA = [0, 0.5, 0.01];

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  config = config || {};

  // State.
  let L      = +(config.initialL      ?? DEF.L);
  let theta0 = +(config.initialTheta0 ?? DEF.theta0);
  let gamma  = +(config.initialGamma  ?? DEF.gamma);
  const wantAuto = config.autoPlay !== false;
  const label = (typeof config.label === 'string' && config.label) ? config.label : 'Pendel mit Energieerhaltung';

  // Live Pendel-State.
  let theta = theta0 * Math.PI / 180;     // Auslenkung (rad)
  let omega = 0;                           // Winkelgeschw. (rad/s)
  let simTime = 0;
  let running = wantAuto && !lfWidgetReducedMotion();
  let lastTs = 0;
  let rafId = 0;
  let unmounted = false;
  let paused = false;

  // Layout.
  container.innerHTML = '';
  const host = _el('div', 'lf-widget-physics-throw lf-pn-host physik-sim');
  container.append(host);
  try {
    container.setAttribute('aria-label', 'Animation: Pendel mit Energieerhaltung');
  } catch (e) {}

  const titleEl = _el('div', 'lf-pn-title');
  titleEl.textContent = label;
  host.append(titleEl);

  const canvas = _el('canvas', 'sim-canvas lf-pn-canvas');
  canvas.setAttribute('aria-label', 'Animation: Pendel mit Energieerhaltung');
  canvas.setAttribute('role', 'img');
  host.append(canvas);

  const W_DEFAULT = container.clientWidth || 600;
  const H = 280;
  let W = W_DEFAULT;
  let ctx = _fitCanvas(canvas, W, H);

  // Controls.
  const controls = _el('div', 'sim-controls lf-pn-controls');

  // aria-live: aktuelle Energien.
  const live = _el('div', 'sim-readout lf-pn-live');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const liveLabel = _el('span', 'sim-readout-label', 'E_kin / E_pot / θ');
  const liveVal   = _el('span', 'sim-readout-value', '0.00 J / 0.00 J / 0°');
  live.append(liveLabel, liveVal);

  const row = _el('div', 'lf-pn-row');
  const sL = _slider('Länge L', R_L[0], R_L[1], R_L[2], L, 'm', v => {
    L = v;
    // Reset Pendel auf θ0 damit Energiebudget konsistent bleibt
    theta = theta0 * Math.PI / 180;
    omega = 0;
    simTime = 0;
    renderStatic();
  });
  const sT = _slider('Loslass-Winkel θ₀', R_THETA[0], R_THETA[1], R_THETA[2], theta0, '°', v => {
    theta0 = v;
    theta = theta0 * Math.PI / 180;
    omega = 0;
    simTime = 0;
    renderStatic();
  });
  const sG = _slider('Reibung γ', R_GAMMA[0], R_GAMMA[1], R_GAMMA[2], gamma, '', v => {
    gamma = v;
    renderStatic();
  });
  row.append(sL.wrap, sT.wrap, sG.wrap);
  controls.append(row, live);

  const btnRow = _el('div', 'sim-btn-row');
  const playBtn = _btn(running ? '⏸ Pause' : '▶ Start', () => toggleRun(), true);
  const resetBtn = _btn('↺ Reset', () => doReset());
  btnRow.append(playBtn, resetBtn);
  controls.append(btnRow);
  host.append(controls);

  // ── Mathe ────────────────────────────────────────────
  // E_pot = m·g·h, mit h = L·(1 - cos(θ)) gemessen vom Tiefpunkt
  // E_kin = 0.5·m·v², mit v = L·ω
  // m = 1 kg implizit.
  function energies() {
    const h = L * (1 - Math.cos(theta));
    const v = L * omega;
    const eKin = 0.5 * v * v;
    const ePot = G * h;
    return { eKin, ePot };
  }

  // Initial-Energie bei Loslass (θ=θ0, ω=0): E_total = m·g·L·(1 - cos(θ0))
  function eMax() {
    return G * L * (1 - Math.cos(theta0 * Math.PI / 180));
  }

  // ── Render ───────────────────────────────────────────
  function draw() {
    if (unmounted) return;
    ctx.clearRect(0, 0, W, H);

    // BG.
    ctx.fillStyle = _theme('bg', 'ground');
    ctx.fillRect(0, 0, W, H);

    // Layout: linke 60% Pendel-Szene, rechte 40% Energie-Bars.
    const sceneW = Math.round(W * 0.62);
    const barsX0 = sceneW + 12;
    const barsW  = W - barsX0 - 12;

    // ── Pendel-Szene ───────────────────────────────────
    const pivotX = sceneW / 2;
    const pivotY = 28;
    // Skalierung: maximal 3m Laenge muss in (H - pivotY - 30) px passen.
    const lengthPx = (H - pivotY - 36) * (L / R_L[1]);

    // Decken-Linie (subtil).
    ctx.strokeStyle = _theme('text-muted', 'text-muted');
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(8, pivotY); ctx.lineTo(sceneW - 8, pivotY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Ruhelage (gestrichelt).
    ctx.strokeStyle = _theme('text-muted', 'text-muted');
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY); ctx.lineTo(pivotX, pivotY + lengthPx);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Faden.
    const bobX = pivotX + Math.sin(theta) * lengthPx;
    const bobY = pivotY + Math.cos(theta) * lengthPx;
    ctx.strokeStyle = _theme('rope', 'text');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY); ctx.lineTo(bobX, bobY);
    ctx.stroke();

    // Pivot-Punkt.
    ctx.fillStyle = _theme('pivot', 'text');
    ctx.beginPath(); ctx.arc(pivotX, pivotY, 4, 0, Math.PI * 2); ctx.fill();

    // Bob.
    ctx.fillStyle = _theme('bob', null);
    ctx.beginPath(); ctx.arc(bobX, bobY, 14, 0, Math.PI * 2); ctx.fill();
    // subtle highlight (Theme-unabhängig, wie physics-throw)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.arc(bobX - 4, bobY - 4, 4, 0, Math.PI * 2); ctx.fill();

    // Kleinwinkel-Kurve (Bahn-Bogen, dezent).
    ctx.strokeStyle = _theme('rope', 'text');
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    const a0 = theta0 * Math.PI / 180;
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, lengthPx, Math.PI / 2 - a0, Math.PI / 2 + a0);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Zeit-Anzeige.
    ctx.fillStyle = _theme('text', 'text');
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('t = ' + simTime.toFixed(2) + ' s', 8, H - 10);

    // ── Energie-Bars ───────────────────────────────────
    const { eKin, ePot } = energies();
    const eTotal = eKin + ePot;
    const eRef   = Math.max(eMax(), 0.0001);

    const barTop = 36;
    const barH   = H - barTop - 60;
    const barW   = Math.max(28, Math.min(48, (barsW - 24) / 2));
    const gap    = Math.max(16, barsW - 2 * barW - 16);
    const xKin   = barsX0 + (barsW - 2 * barW - gap) / 2;
    const xPot   = xKin + barW + gap;

    // Bar-Hintergruende.
    ctx.fillStyle = _theme('bar-bg', 'sky');
    ctx.fillRect(xKin, barTop, barW, barH);
    ctx.fillRect(xPot, barTop, barW, barH);

    // Bar-Border.
    ctx.strokeStyle = _theme('text-muted', 'text-muted');
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(xKin, barTop, barW, barH);
    ctx.strokeRect(xPot, barTop, barW, barH);
    ctx.globalAlpha = 1;

    // Fuell-Hoehen.
    const hKin = Math.max(0, Math.min(1, eKin / eRef)) * barH;
    const hPot = Math.max(0, Math.min(1, ePot / eRef)) * barH;

    ctx.fillStyle = _theme('bar-kin', null) || _theme('bob', null);
    ctx.fillRect(xKin, barTop + barH - hKin, barW, hKin);
    ctx.fillStyle = _theme('bar-pot', null);
    ctx.fillRect(xPot, barTop + barH - hPot, barW, hPot);

    // Maximum-Marker (gestrichelte Linie auf E_max).
    ctx.strokeStyle = _theme('text-muted', 'text-muted');
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xKin - 2, barTop); ctx.lineTo(xPot + barW + 2, barTop);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Beschriftungen.
    ctx.fillStyle = _theme('text', 'text');
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('E_kin', xKin + barW / 2, barTop - 8);
    ctx.fillText('E_pot', xPot + barW / 2, barTop - 8);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = _theme('text-muted', 'text-muted');
    ctx.fillText(eKin.toFixed(2) + ' J', xKin + barW / 2, barTop + barH + 12);
    ctx.fillText(ePot.toFixed(2) + ' J', xPot + barW / 2, barTop + barH + 12);

    ctx.fillStyle = _theme('text', 'text');
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('E_total = ' + eTotal.toFixed(2) + ' J',
                 (xKin + xPot + barW) / 2, barTop + barH + 28);

    if (gamma > 0) {
      ctx.fillStyle = _theme('text-muted', 'text-muted');
      ctx.font = '9px sans-serif';
      ctx.fillText('(sinkt durch Reibung)', (xKin + xPot + barW) / 2, barTop + barH + 42);
    } else {
      ctx.fillStyle = _theme('text-muted', 'text-muted');
      ctx.font = '9px sans-serif';
      ctx.fillText('(konstant — Erhaltung)', (xKin + xPot + barW) / 2, barTop + barH + 42);
    }
    ctx.textAlign = 'left';

    // Live-Readout updaten (drosseln auf jeden ~6. Frame, sonst zu spammy).
    if ((_drawCount++ % 6) === 0) {
      const thetaDeg = theta * 180 / Math.PI;
      liveVal.textContent = eKin.toFixed(2) + ' J / ' + ePot.toFixed(2) + ' J / ' + thetaDeg.toFixed(0) + '°';
    }
  }
  let _drawCount = 0;

  function renderStatic() {
    if (!running) draw();
  }

  // ── Tick ─────────────────────────────────────────────
  function tick(ts) {
    if (unmounted || paused) { rafId = 0; return; }
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (dt > 0.05) dt = 0.05;
    if (running) {
      // Sub-Steps fuer Stabilitaet (dt/n, n=4)
      const n = 4;
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const alpha = -(G / L) * Math.sin(theta) - 2 * gamma * omega;
        omega += alpha * h;
        theta += omega * h;
      }
      simTime += dt;
      if (simTime > 1e6) simTime = 0;
      draw();
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  }

  function toggleRun() {
    if (unmounted) return;
    if (lfWidgetReducedMotion()) {
      running = false;
      playBtn.textContent = '▶ Start';
      // Zeige Pendel in Endposition (Tiefpunkt) + Bars statisch bei Initialwert
      theta = 0; omega = 0;
      draw();
      return;
    }
    running = !running;
    playBtn.textContent = running ? '⏸ Pause' : '▶ Start';
    if (running) {
      lastTs = 0;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(tick);
    } else {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      draw();
    }
  }

  function doReset() {
    L = DEF.L; theta0 = DEF.theta0; gamma = DEF.gamma;
    theta = theta0 * Math.PI / 180; omega = 0; simTime = 0;
    sL.input.value = String(L);   sL.valEl.textContent = sL.fmt(L);
    sT.input.value = String(theta0); sT.valEl.textContent = sT.fmt(theta0);
    sG.input.value = String(gamma); sG.valEl.textContent = sG.fmt(gamma);
    draw();
  }

  // ── Resize ───────────────────────────────────────────
  function onResize() {
    if (unmounted) return;
    W = host.clientWidth || W_DEFAULT;
    ctx = _fitCanvas(canvas, W, H);
    draw();
  }
  window.addEventListener('resize', onResize);

  // Erst-Render. Bei Reduce-Motion: Pendel haengt in Ruhe.
  if (lfWidgetReducedMotion()) {
    theta = 0; omega = 0;
  }
  draw();
  if (running) {
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  return {
    widgetType: 'pendulum-sim',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      try { window.removeEventListener('resize', onResize); } catch (e) {}
    },

    pause() {
      if (unmounted) return;
      paused = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    },

    resume() {
      if (unmounted) return;
      paused = false;
      if (running && !rafId) {
        lastTs = 0;
        rafId = requestAnimationFrame(tick);
      }
    },

    onTheme() {
      if (unmounted) return;
      draw();
    },

    onAnswer() { /* explorativ — kein Bewertungs-Hook */ },

    getState() {
      return {
        L, theta0, gamma,
        theta, omega,
        simTime, running
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      const setSlider = (slider, key, range) => {
        if (typeof s[key] !== 'number') return;
        const clamped = Math.max(range[0], Math.min(range[1], s[key]));
        slider.input.value = String(clamped);
        slider.valEl.textContent = slider.fmt(clamped);
        return clamped;
      };
      const Ln = setSlider(sL, 'L', R_L);          if (Ln !== undefined) L = Ln;
      const t0 = setSlider(sT, 'theta0', R_THETA); if (t0 !== undefined) theta0 = t0;
      const gn = setSlider(sG, 'gamma', R_GAMMA);  if (gn !== undefined) gamma = gn;
      if (typeof s.theta === 'number') theta = s.theta;
      if (typeof s.omega === 'number') omega = s.omega;
      if (typeof s.simTime === 'number') simTime = s.simTime;
      if (typeof s.running === 'boolean') {
        if (s.running !== running) toggleRun();
      } else {
        draw();
      }
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'pendulum-sim',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'pendulum-sim', mount };
export { mount };
