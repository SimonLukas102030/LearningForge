// ══════════════════════════════════════════
//  LearningForge — Widget: tangent-visualizer
//  Sekante → Tangente Animation (Welle 3.1)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md + Plan-Welle-3)
// ══════════════════════════════════════════
//
// Funktion auf Canvas + zwei Punkte P (rot) und Q (blau, P+Δx). Linie
// zwischen P und Q ist die Sekante; bei Δx<0.05 wird sie als Tangente
// (rot, gestrichelt) gezeichnet. User schiebt P via Slider (oder Drag),
// Δx via Log-Slider, waehlt eine von 4 Funktionen (x², x³, sin, e^x).
// Button "Animiere" laesst Δx exponentiell von 2.0 auf 0.01 in ~3s laufen.
//
// Reduce-Motion: Animations-Button zeigt direkt die Tangente (Δx=0.01).
//
// Theme: --lf-tv-* CSS-Vars, JS faellt auf --sim-* / --accent zurueck.
//
// Config-Schema:
//   {
//     widgetType: 'tangent-visualizer',
//     config: {
//       label:           string         // optional, Titel
//       initialFunction: 'x_squared'|'x_cubed'|'sin'|'exp'  // optional
//       initialX:        number         // optional, default 1.5
//       initialDx:       number         // optional, default 1.0
//       xRange:          [min, max]     // optional, default [-5, 5]
//       yRange:          [min, max]     // optional, default [-2, 10]
//     }
//   }

import { lfWidgetReducedMotion } from './_base.js';

// ── Theme-Reader ──────────────────────────────────────────
function _theme(name, fallback) {
  const css = getComputedStyle(document.documentElement);
  let v = css.getPropertyValue('--lf-tv-' + name).trim();
  if (!v && fallback) v = css.getPropertyValue('--sim-' + fallback).trim();
  if (!v && name === 'curve') v = css.getPropertyValue('--accent').trim();
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

// ── Funktions-Definitionen ────────────────────────────────
// f + analytische Ableitung f'. Keys = Config-Strings.
const FUNCTIONS = {
  'x_squared': { label: 'f(x) = x²',    f: x => x*x,        df: x => 2*x },
  'x_cubed':   { label: 'f(x) = x³',    f: x => x*x*x,      df: x => 3*x*x },
  'sin':       { label: 'f(x) = sin(x)', f: x => Math.sin(x), df: x => Math.cos(x) },
  'exp':       { label: 'f(x) = e^x',   f: x => Math.exp(x), df: x => Math.exp(x) }
};

// ── Slider-Builder ────────────────────────────────────────
function _slider(label, min, max, step, value, fmt, onInput) {
  const wrap = _el('div', 'sim-slider');
  const head = _el('div', 'sim-slider-head');
  const lbl  = _el('span', 'sim-slider-label', label);
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

// Δx via Log-Slider: Slider-Value 0..100 → Δx 0.01..2.0 logarithmisch.
const DX_MIN = 0.01, DX_MAX = 2.0;
function dxFromSlider(s) {
  const t = Math.max(0, Math.min(100, s)) / 100;
  return DX_MIN * Math.pow(DX_MAX / DX_MIN, t);
}
function sliderFromDx(dx) {
  const t = Math.log(dx / DX_MIN) / Math.log(DX_MAX / DX_MIN);
  return Math.max(0, Math.min(100, t * 100));
}

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  config = config || {};

  // State.
  let fnKey = (config.initialFunction && FUNCTIONS[config.initialFunction]) ? config.initialFunction : 'x_squared';
  let x = +(config.initialX ?? 1.5);
  let dx = +(config.initialDx ?? 1.0);
  if (!isFinite(dx) || dx < DX_MIN) dx = DX_MIN;
  if (dx > DX_MAX) dx = DX_MAX;
  let xRange = Array.isArray(config.xRange) && config.xRange.length === 2
    ? [+config.xRange[0], +config.xRange[1]] : [-5, 5];
  let yRange = Array.isArray(config.yRange) && config.yRange.length === 2
    ? [+config.yRange[0], +config.yRange[1]] : [-2, 10];
  const label = (typeof config.label === 'string' && config.label) ? config.label : 'Vom Differenzenquotient zur Ableitung';

  let unmounted = false, paused = false;
  let animRaf = 0, animStart = 0;

  // Layout.
  container.innerHTML = '';
  const host = _el('div', 'lf-widget-physics-throw lf-tv-host physik-sim');
  container.append(host);
  try {
    container.setAttribute('aria-label', 'Sekante zu Tangente Animation');
  } catch (e) {}

  const titleEl = _el('div', 'lf-tv-title');
  titleEl.textContent = label;
  host.append(titleEl);

  // Funktions-Dropdown.
  const typeRow = _el('div', 'lf-tv-type-row');
  const typeLbl = _el('label', 'lf-tv-type-label', 'Funktion');
  const typeSel = document.createElement('select');
  typeSel.className = 'lf-tv-type-select';
  Object.keys(FUNCTIONS).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = FUNCTIONS[k].label;
    if (k === fnKey) opt.selected = true;
    typeSel.append(opt);
  });
  typeSel.id = 'lf-tv-fn-' + Math.random().toString(36).slice(2, 8);
  typeLbl.setAttribute('for', typeSel.id);
  typeSel.addEventListener('change', () => {
    fnKey = typeSel.value;
    cancelAnim();
    draw(); updateReadout();
  });
  typeRow.append(typeLbl, typeSel);
  host.append(typeRow);

  // Canvas.
  const canvas = _el('canvas', 'sim-canvas lf-tv-canvas');
  canvas.setAttribute('aria-label', 'Funktionsgraph mit Sekante und Tangente');
  canvas.setAttribute('role', 'img');
  host.append(canvas);

  const W_DEFAULT = container.clientWidth || 600;
  const H = 280;
  let W = W_DEFAULT;
  let ctx = _fitCanvas(canvas, W, H);

  // Drag-Handling auf Canvas: P entlang x-Achse verschieben.
  let dragging = false;
  function pickX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    return xRange[0] + (px / W) * (xRange[1] - xRange[0]);
  }
  function onPointerDown(e) {
    dragging = true;
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
    setX(pickX(e.clientX));
    cancelAnim();
  }
  function onPointerMove(e) {
    if (!dragging) return;
    setX(pickX(e.clientX));
  }
  function onPointerUp(e) {
    dragging = false;
    try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.style.cursor = 'ew-resize';

  // Controls.
  const controls = _el('div', 'sim-controls lf-tv-controls');

  // Slider: x-Position von P.
  const xS = _slider('Position x von P', xRange[0], xRange[1], 0.01, x,
    v => v.toFixed(2),
    v => { setX(v); cancelAnim(); });

  // Slider: Δx (Log-Skala).
  const dxS = _slider('Δx (Abstand Q zu P)', 0, 100, 0.1, sliderFromDx(dx),
    v => dxFromSlider(v).toFixed(2),
    v => { dx = dxFromSlider(v); cancelAnim(); draw(); updateReadout(); });

  controls.append(xS.wrap, dxS.wrap);

  // Buttons.
  const btnRow = _el('div', 'sim-btn-row');
  const animBtn = _btn('▶ Animiere Sekante→Tangente', () => startAnim(), true);
  const resetBtn = _btn('↺ Reset', () => doReset());
  btnRow.append(animBtn, resetBtn);
  controls.append(btnRow);

  // Steigungs-Readout (aria-live).
  const readout = _el('div', 'lf-tv-readout');
  readout.setAttribute('aria-live', 'polite');
  readout.setAttribute('aria-atomic', 'true');
  const r1 = _el('div', 'lf-tv-readout-row');
  const r2 = _el('div', 'lf-tv-readout-row');
  const r3 = _el('div', 'lf-tv-readout-row lf-tv-readout-tan');
  readout.append(r1, r2, r3);
  controls.append(readout);

  host.append(controls);

  // ── Welt → Pixel ─────────────────────────────────────
  const xToPx = xv => ((xv - xRange[0]) / (xRange[1] - xRange[0])) * W;
  const yToPx = yv => H - ((yv - yRange[0]) / (yRange[1] - yRange[0])) * H;

  // ── State-Setter ─────────────────────────────────────
  function setX(v) {
    x = Math.max(xRange[0], Math.min(xRange[1], v));
    xS.input.value = String(x);
    xS.valEl.textContent = xS.fmt(x);
    draw(); updateReadout();
  }

  // ── Mathe ────────────────────────────────────────────
  const evalF  = xv => { const v = FUNCTIONS[fnKey].f(xv);  return isFinite(v) ? v : NaN; };
  const evalDf = xv => { const v = FUNCTIONS[fnKey].df(xv); return isFinite(v) ? v : NaN; };

  // ── Readout ──────────────────────────────────────────
  function updateReadout() {
    const fp = evalF(x), fq = evalF(x + dx);
    const sec = (fq - fp) / dx;
    r1.textContent = 'Δx = ' + dx.toFixed(3);
    r2.textContent = 'Sekante: (f(' + (x + dx).toFixed(2) + ')−f(' + x.toFixed(2) + '))/' + dx.toFixed(3) + ' = ' + sec.toFixed(3);
    r3.textContent = 'Tangente f′(' + x.toFixed(2) + ') = ' + evalDf(x).toFixed(3);
  }

  // ── Draw ─────────────────────────────────────────────
  function draw() {
    if (unmounted) return;
    ctx.clearRect(0, 0, W, H);

    // BG.
    ctx.fillStyle = _theme('bg', 'ground');
    ctx.fillRect(0, 0, W, H);

    // Grid + Achsen.
    const xStep = niceStep(xRange[1] - xRange[0]);
    const yStep = niceStep(yRange[1] - yRange[0]);
    ctx.strokeStyle = _theme('grid', 'grid');
    ctx.lineWidth = 1; ctx.globalAlpha = 0.35;
    ctx.beginPath();
    for (let xv = Math.ceil(xRange[0] / xStep) * xStep; xv <= xRange[1]; xv += xStep) {
      const px = xToPx(xv); ctx.moveTo(px, 0); ctx.lineTo(px, H);
    }
    for (let yv = Math.ceil(yRange[0] / yStep) * yStep; yv <= yRange[1]; yv += yStep) {
      const py = yToPx(yv); ctx.moveTo(0, py); ctx.lineTo(W, py);
    }
    ctx.stroke(); ctx.globalAlpha = 1;

    ctx.strokeStyle = _theme('axis', 'text'); ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (yRange[0] <= 0 && yRange[1] >= 0) { const py0 = yToPx(0); ctx.moveTo(0, py0); ctx.lineTo(W, py0); }
    if (xRange[0] <= 0 && xRange[1] >= 0) { const px0 = xToPx(0); ctx.moveTo(px0, 0); ctx.lineTo(px0, H); }
    ctx.stroke();

    // Tick-Labels.
    ctx.fillStyle = _theme('text', 'text-muted');
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const py0 = (yRange[0] <= 0 && yRange[1] >= 0) ? yToPx(0) : H - 12;
    for (let xv = Math.ceil(xRange[0] / xStep) * xStep; xv <= xRange[1]; xv += xStep) {
      if (Math.abs(xv) < xStep / 2) continue;
      ctx.fillText(formatTick(xv, xStep), xToPx(xv), Math.min(H - 12, py0 + 3));
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const px0 = (xRange[0] <= 0 && xRange[1] >= 0) ? xToPx(0) : 22;
    for (let yv = Math.ceil(yRange[0] / yStep) * yStep; yv <= yRange[1]; yv += yStep) {
      if (Math.abs(yv) < yStep / 2) continue;
      ctx.fillText(formatTick(yv, yStep), Math.max(22, px0 - 4), yToPx(yv));
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';

    // Funktions-Kurve.
    ctx.strokeStyle = _theme('curve', null);
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const samples = Math.max(200, W);
    let prevValid = false;
    for (let i = 0; i <= samples; i++) {
      const xv = xRange[0] + (i / samples) * (xRange[1] - xRange[0]);
      const yv = evalF(xv);
      if (!isFinite(yv)) { prevValid = false; continue; }
      const yClamped = Math.max(yRange[0] - (yRange[1] - yRange[0]) * 5,
                       Math.min(yRange[1] + (yRange[1] - yRange[0]) * 5, yv));
      const px = xToPx(xv), py = yToPx(yClamped);
      if (!prevValid) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      prevValid = true;
    }
    ctx.stroke();

    // P (rot) + Q (blau) + Linie.
    const fp = evalF(x), fq = evalF(x + dx);
    const px = xToPx(x), py = yToPx(fp);
    const qx = xToPx(x + dx), qy = yToPx(fq);
    const isTangent = dx < 0.05;
    const slope = isTangent ? evalDf(x) : (fq - fp) / dx;
    const bg = _theme('bg', 'ground');

    ctx.strokeStyle = isTangent ? _theme('tangent', null) : _theme('secant', null);
    ctx.lineWidth = 2;
    if (isTangent) ctx.setLineDash([6, 4]);
    if (isFinite(slope)) {
      ctx.beginPath();
      ctx.moveTo(xToPx(xRange[0]), yToPx(fp + slope * (xRange[0] - x)));
      ctx.lineTo(xToPx(xRange[1]), yToPx(fp + slope * (xRange[1] - x)));
      ctx.stroke();
    }
    ctx.setLineDash([]);

    function dot(cx, cy, r, fill) {
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bg; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if (!isTangent && isFinite(fq)) dot(qx, qy, 5, _theme('point-q', null));
    if (isFinite(fp)) dot(px, py, 6, _theme('point-p', null));

    ctx.fillStyle = _theme('text', 'text');
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('P', px + 8, py - 8);
    if (!isTangent) ctx.fillText('Q', qx + 8, qy - 8);
  }

  // niceStep + formatTick.
  function niceStep(span) {
    const target = span / 10;
    const base = Math.pow(10, Math.floor(Math.log10(Math.abs(target) || 1)));
    const m = (target || 1) / base;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * base;
  }
  function formatTick(v, step) {
    return step >= 1 ? Math.round(v).toString() : v.toFixed(1);
  }

  // ── Animation Δx: 2.0 → 0.01 in ~3000ms (exp interp) ─
  const ANIM_MS = 3000;
  function startAnim() {
    cancelAnim();
    if (lfWidgetReducedMotion()) {
      // Direkt End-Wert anzeigen.
      dx = DX_MIN;
      dxS.input.value = String(sliderFromDx(dx));
      dxS.valEl.textContent = dxS.fmt(sliderFromDx(dx));
      draw(); updateReadout();
      return;
    }
    animStart = performance.now();
    animBtn.textContent = '⏹ Stop';
    const step = (ts) => {
      if (unmounted || paused) { animRaf = 0; return; }
      const t = Math.min(1, (ts - animStart) / ANIM_MS);
      // exp interp: start=2.0, end=0.01.
      dx = 2.0 * Math.pow(DX_MIN / 2.0, t);
      dxS.input.value = String(sliderFromDx(dx));
      dxS.valEl.textContent = dxS.fmt(sliderFromDx(dx));
      draw(); updateReadout();
      if (t < 1) animRaf = requestAnimationFrame(step);
      else { animRaf = 0; animBtn.textContent = '▶ Animiere Sekante→Tangente'; }
    };
    animRaf = requestAnimationFrame(step);
  }
  function cancelAnim() {
    if (animRaf) { cancelAnimationFrame(animRaf); animRaf = 0; }
    animBtn.textContent = '▶ Animiere Sekante→Tangente';
  }

  // ── Reset ────────────────────────────────────────────
  function doReset() {
    cancelAnim();
    fnKey = 'x_squared'; typeSel.value = fnKey;
    x = 1.5; dx = 1.0;
    xS.input.value = String(x); xS.valEl.textContent = xS.fmt(x);
    dxS.input.value = String(sliderFromDx(dx));
    dxS.valEl.textContent = dxS.fmt(sliderFromDx(dx));
    draw(); updateReadout();
  }

  // ── Resize ───────────────────────────────────────────
  function onResize() {
    if (unmounted) return;
    W = host.clientWidth || W_DEFAULT;
    ctx = _fitCanvas(canvas, W, H);
    draw();
  }
  window.addEventListener('resize', onResize);

  // Erst-Render.
  draw(); updateReadout();

  return {
    widgetType: 'tangent-visualizer',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      cancelAnim();
      try { window.removeEventListener('resize', onResize); } catch (e) {}
    },

    pause() {
      if (unmounted) return;
      paused = true;
      if (animRaf) { cancelAnimationFrame(animRaf); animRaf = 0; }
    },

    resume() {
      if (unmounted) return;
      paused = false;
      // Animation wird nicht automatisch fortgesetzt — User muss neu starten.
    },

    onTheme() {
      if (unmounted) return;
      draw();
    },

    onAnswer() { /* explorativ — kein Bewertungs-Hook */ },

    getState() {
      return { fnKey, x, dx, xRange: xRange.slice(), yRange: yRange.slice() };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      cancelAnim();
      if (typeof s.fnKey === 'string' && FUNCTIONS[s.fnKey]) {
        fnKey = s.fnKey; typeSel.value = fnKey;
      }
      if (typeof s.x === 'number') {
        x = Math.max(xRange[0], Math.min(xRange[1], s.x));
        xS.input.value = String(x); xS.valEl.textContent = xS.fmt(x);
      }
      if (typeof s.dx === 'number') {
        dx = Math.max(DX_MIN, Math.min(DX_MAX, s.dx));
        dxS.input.value = String(sliderFromDx(dx));
        dxS.valEl.textContent = dxS.fmt(sliderFromDx(dx));
      }
      if (Array.isArray(s.xRange) && s.xRange.length === 2) xRange = [+s.xRange[0], +s.xRange[1]];
      if (Array.isArray(s.yRange) && s.yRange.length === 2) yRange = [+s.yRange[0], +s.yRange[1]];
      draw(); updateReadout();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'tangent-visualizer',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'tangent-visualizer', mount };
export { mount };
