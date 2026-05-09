// ══════════════════════════════════════════
//  LearningForge — Widget: wave-superposition
//  2 Sinus + Sum-Welle live (Welle 1.3)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md + Plan-Welle-1)
// ══════════════════════════════════════════
//
// Drei horizontale Wellen-Spuren in einem Canvas:
//   Spur 1: f1(x,t) = A1 * sin(2*pi*f1*x + phi1 + omega*t)
//   Spur 2: f2(x,t) = A2 * sin(2*pi*f2*x + phi2 + omega*t)
//   Spur 3: f1 + f2 (Ueberlagerung) — mit Knoten-Markern auf der Achse
//
// User stellt 6 Slider ein (A1, f1, phi1, A2, f2, phi2). RAF animiert,
// Pause-Toggle haelt an. Reset auf Defaults. Reduce-Motion: kein RAF,
// statisches Bild bei t=0.
//
// Theme: --lf-ws-* CSS-Vars (Light + Dark in main.css). Fallback auf
// --sim-* / --accent damit Cosmetics-Themes nichts duplizieren muessen.
//
// Config-Schema:
//   {
//     widgetType: 'wave-superposition',
//     config: {
//       initialA1: number      // optional, default 1
//       initialF1: number      // optional, default 1 (Wellen pro Einheit)
//       initialPhi1: number    // optional, default 0
//       initialA2: number      // optional, default 1
//       initialF2: number      // optional, default 1
//       initialPhi2: number    // optional, default 0
//       autoPlay: boolean      // optional, default true
//       label: string          // optional, Titel
//     }
//   }

import { lfWidgetReducedMotion } from './_base.js';

// ── Theme-Reader ──────────────────────────────────────────
function _theme(name, fallback) {
  const css = getComputedStyle(document.documentElement);
  let v = css.getPropertyValue('--lf-ws-' + name).trim();
  if (!v && fallback) v = css.getPropertyValue('--sim-' + fallback).trim();
  if (!v && name === 'wave-sum') v = css.getPropertyValue('--accent').trim();
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

// ── Slider-Builder ────────────────────────────────────────
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

// ── Defaults ──────────────────────────────────────────────
const DEF = { A1: 1, f1: 1, phi1: 0, A2: 1, f2: 1, phi2: 0 };
// Ranges: A in [-2,2], f in [0.1,3], phi in [-pi, pi]
const R_A   = [-2, 2, 0.1];
const R_F   = [0.1, 3, 0.1];
const R_PHI = [-3.14, 3.14, 0.1];

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  config = config || {};

  // State.
  let A1   = +(config.initialA1   ?? DEF.A1);
  let f1   = +(config.initialF1   ?? DEF.f1);
  let phi1 = +(config.initialPhi1 ?? DEF.phi1);
  let A2   = +(config.initialA2   ?? DEF.A2);
  let f2   = +(config.initialF2   ?? DEF.f2);
  let phi2 = +(config.initialPhi2 ?? DEF.phi2);
  const wantAuto = config.autoPlay !== false;
  const label = (typeof config.label === 'string' && config.label) ? config.label : 'Wellen-Überlagerung';

  let t = 0;             // Sim-Zeit (s)
  let running = wantAuto && !lfWidgetReducedMotion();
  let lastTs = 0;
  let rafId = 0;
  let unmounted = false;
  let paused = false;

  // Layout.
  container.innerHTML = '';
  const host = _el('div', 'lf-widget-physics-throw lf-ws-host physik-sim');
  container.append(host);
  try {
    container.setAttribute('aria-label', 'Animation: Überlagerung zweier Sinuswellen');
  } catch (e) {}

  const titleEl = _el('div', 'lf-ws-title');
  titleEl.textContent = label;
  host.append(titleEl);

  // Canvas.
  const canvas = _el('canvas', 'sim-canvas lf-ws-canvas');
  canvas.setAttribute('aria-label', 'Animation: Überlagerung zweier Sinuswellen');
  canvas.setAttribute('role', 'img');
  host.append(canvas);

  const W_DEFAULT = container.clientWidth || 600;
  const H = 320;
  let W = W_DEFAULT;
  let ctx = _fitCanvas(canvas, W, H);

  // Controls.
  const controls = _el('div', 'sim-controls lf-ws-controls');

  // aria-live: aktuelle Sum-Amplitude.
  const live = _el('div', 'sim-readout lf-ws-live');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const liveLabel = _el('span', 'sim-readout-label', 'Aktuelle Sum-Amplitude');
  const liveVal   = _el('span', 'sim-readout-value', '0.00');
  live.append(liveLabel, liveVal);

  // 6 Slider in 2 Reihen (Welle 1, Welle 2).
  const row1 = _el('div', 'lf-ws-row');
  const row2 = _el('div', 'lf-ws-row');
  const sA1   = _slider('Amplitude A₁',  R_A[0], R_A[1], R_A[2], A1, '', v => { A1 = v; renderStatic(); });
  const sF1   = _slider('Frequenz f₁',   R_F[0], R_F[1], R_F[2], f1, '', v => { f1 = v; renderStatic(); });
  const sP1   = _slider('Phase φ₁', R_PHI[0], R_PHI[1], R_PHI[2], phi1, 'rad', v => { phi1 = v; renderStatic(); });
  const sA2   = _slider('Amplitude A₂',  R_A[0], R_A[1], R_A[2], A2, '', v => { A2 = v; renderStatic(); });
  const sF2   = _slider('Frequenz f₂',   R_F[0], R_F[1], R_F[2], f2, '', v => { f2 = v; renderStatic(); });
  const sP2   = _slider('Phase φ₂', R_PHI[0], R_PHI[1], R_PHI[2], phi2, 'rad', v => { phi2 = v; renderStatic(); });
  row1.append(sA1.wrap, sF1.wrap, sP1.wrap);
  row2.append(sA2.wrap, sF2.wrap, sP2.wrap);
  controls.append(row1, row2, live);

  // Buttons: Play/Pause + Reset.
  const btnRow = _el('div', 'sim-btn-row');
  const playBtn = _btn(running ? '⏸ Pause' : '▶ Start', () => toggleRun(), true);
  const resetBtn = _btn('↺ Reset', () => doReset());
  btnRow.append(playBtn, resetBtn);
  controls.append(btnRow);
  host.append(controls);

  // ── Mathe / Render ────────────────────────────────────
  function eval1(x, time) { return A1 * Math.sin(2 * Math.PI * f1 * x + phi1 + time); }
  function eval2(x, time) { return A2 * Math.sin(2 * Math.PI * f2 * x + phi2 + time); }

  function draw() {
    if (unmounted) return;
    ctx.clearRect(0, 0, W, H);

    // BG.
    ctx.fillStyle = _theme('bg', 'ground');
    ctx.fillRect(0, 0, W, H);

    // 3 Spuren — vertikales Layout. Hoehe pro Spur ~H/3, mit Padding.
    const padX = 8;
    const trackH = (H - 24) / 3;
    const trackPad = 8;

    // Wave-Travel: phi-Verschiebung ueber Zeit (omega*t). 1.5 rad/s = visuell angenehm.
    const time = t * 1.5;

    drawTrack(0,         trackH, padX, trackPad, x => eval1(x, time),
              _theme('wave-1', 'vec-x'), 2, 'Welle 1');
    drawTrack(trackH,     trackH, padX, trackPad, x => eval2(x, time),
              _theme('wave-2', 'vec-y'), 2, 'Welle 2');
    drawTrack(trackH * 2, trackH, padX, trackPad,
              x => eval1(x, time) + eval2(x, time),
              _theme('wave-sum', null), 3.2, 'Summe', true);
  }

  // drawTrack: zeichnet eine Wellenspur in einem horizontalen Streifen.
  // y0 = top-y der Spur, h = Hoehe der Spur, fn = x->y in Welt-Einheiten.
  // Welt-X = [0, 4] (4 "Wellenlaengen"-Einheiten breit). Welt-Y dynamisch
  // skaliert: max-Amp ist 4 (A1+A2 max je 2), Sum-Spur teilt sich Skala.
  function drawTrack(y0, h, padX, trackPad, fn, color, lineW, name, isSum) {
    const cy = y0 + h / 2;
    const usableH = h - 2 * trackPad;
    const maxAmp = 4; // A1 + A2 max
    const yScale = (usableH / 2) / maxAmp;

    // Nullachse + leichtes Spur-BG.
    ctx.fillStyle = _theme('axis-bg', 'sky');
    ctx.globalAlpha = 0.15;
    ctx.fillRect(padX, y0 + trackPad, W - 2 * padX, usableH);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = _theme('axis', 'grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, cy); ctx.lineTo(W - padX, cy);
    ctx.stroke();

    // Spur-Label.
    ctx.fillStyle = _theme('text-muted', 'text-muted');
    ctx.font = '11px sans-serif';
    ctx.fillText(name, padX + 4, y0 + trackPad + 12);

    // Welle plotten.
    const samples = Math.max(160, W);
    const xMin = 0, xMax = 4;
    const xToPx = x => padX + ((x - xMin) / (xMax - xMin)) * (W - 2 * padX);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let prevY = NaN;
    let maxAbsSum = 0;
    for (let i = 0; i <= samples; i++) {
      const xv = xMin + (i / samples) * (xMax - xMin);
      const yv = fn(xv);
      const yClamped = Math.max(-maxAmp, Math.min(maxAmp, yv));
      const px = xToPx(xv);
      const py = cy - yClamped * yScale;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      if (isSum && Math.abs(yv) > maxAbsSum) maxAbsSum = Math.abs(yv);
      prevY = yv;
    }
    ctx.stroke();

    // Knoten-Marker auf der Sum-Spur: Vorzeichenwechsel von fn ueber Samples.
    if (isSum) {
      ctx.fillStyle = _theme('node', null) || color;
      const nodeColor = _theme('node', null);
      let prev = fn(xMin);
      let prevX = xMin;
      const nodeStep = (xMax - xMin) / 400;
      for (let xv = xMin + nodeStep; xv <= xMax; xv += nodeStep) {
        const cur = fn(xv);
        if (Math.abs(cur) < 0.001 || (prev * cur < 0)) {
          // Lineare Interpolation auf Nullstelle.
          const xZero = (Math.abs(cur) < 0.001) ? xv : (prevX + (xv - prevX) * (prev / (prev - cur)));
          const px = xToPx(xZero);
          ctx.fillStyle = nodeColor || color;
          ctx.beginPath(); ctx.arc(px, cy, 3, 0, Math.PI * 2); ctx.fill();
        }
        prev = cur; prevX = xv;
      }

      // Live-Wert update.
      liveVal.textContent = maxAbsSum.toFixed(2);
    }
  }

  // ── Render-Triggers ──────────────────────────────────
  // Bei Slider-Change: wenn nicht laufend, einmal zeichnen.
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
      t += dt;
      // t wraparound nach 1000s gegen FP-Drift (rein kosmetisch).
      if (t > 1000) t -= 1000;
      draw();
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  }

  function toggleRun() {
    if (unmounted) return;
    if (lfWidgetReducedMotion()) {
      // Reduce-Motion: kein RAF, statisches Bild.
      running = false;
      playBtn.textContent = '▶ Start';
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
    A1 = DEF.A1; f1 = DEF.f1; phi1 = DEF.phi1;
    A2 = DEF.A2; f2 = DEF.f2; phi2 = DEF.phi2;
    t = 0;
    sA1.input.value = String(A1); sA1.valEl.textContent = sA1.fmt(A1);
    sF1.input.value = String(f1); sF1.valEl.textContent = sF1.fmt(f1);
    sP1.input.value = String(phi1); sP1.valEl.textContent = sP1.fmt(phi1);
    sA2.input.value = String(A2); sA2.valEl.textContent = sA2.fmt(A2);
    sF2.input.value = String(f2); sF2.valEl.textContent = sF2.fmt(f2);
    sP2.input.value = String(phi2); sP2.valEl.textContent = sP2.fmt(phi2);
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

  // Erst-Render + RAF-Start wenn auto.
  draw();
  if (running) {
    lastTs = 0;
    rafId = requestAnimationFrame(tick);
  }

  return {
    widgetType: 'wave-superposition',

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
        A1, f1, phi1, A2, f2, phi2,
        t, running
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
      const a1 = setSlider(sA1, 'A1', R_A);   if (a1 !== undefined) A1 = a1;
      const f1n = setSlider(sF1, 'f1', R_F);  if (f1n !== undefined) f1 = f1n;
      const p1 = setSlider(sP1, 'phi1', R_PHI); if (p1 !== undefined) phi1 = p1;
      const a2 = setSlider(sA2, 'A2', R_A);   if (a2 !== undefined) A2 = a2;
      const f2n = setSlider(sF2, 'f2', R_F);  if (f2n !== undefined) f2 = f2n;
      const p2 = setSlider(sP2, 'phi2', R_PHI); if (p2 !== undefined) phi2 = p2;
      if (typeof s.t === 'number') t = s.t;
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
    widgetType: 'wave-superposition',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'wave-superposition', mount };
export { mount };
