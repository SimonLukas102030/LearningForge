// ══════════════════════════════════════════
//  LearningForge — Widget: function-plotter
//  Live-Plot parametrisierter Funktionen (Welle 1.2)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md + Plan-Welle-1)
// ══════════════════════════════════════════
//
// User waehlt einen Funktions-Typ (quadratic / linear / trig-sin / exponential)
// und stellt Parameter a/b/c/d via Slider ein. Canvas2D plottet live, X-Achse
// per Range-Slider justierbar. Klick auf den Graph (oder Number-Input + "Punkt
// hinzufuegen" fuer Keyboard) speichert (x, y) in einer scrollbaren Tabelle.
//
// KEIN String-Parser, KEIN eval(): Die 4 Funktionen sind feste JS-Closures.
//
// Reduce-Motion: Der Plot selbst hat keine Animation. Lediglich der Klick-Pulse
// auf neu hinzugefuegten Punkten wird gedrosselt (instant statt fade).
//
// Theme: --lf-fp-* Vars (Light + Dark blocks in main.css). Fallback im JS auf
// --sim-* damit Cosmetics-Themes nicht alle Vars duplizieren muessen.
//
// Config-Schema:
//   {
//     widgetType: 'function-plotter',
//     config: {
//       initialType:   'quadratic'|'linear'|'trig-sin'|'exponential'  // optional
//       initialParams: { a, b, c, d }                                  // optional
//       xRange:        [min, max]                                     // optional, default [-10, 10]
//       yRange:        [min, max]                                     // optional, default [-10, 10]
//       label:         string                                         // optional, Titel
//     }
//   }

import { lfWidgetReducedMotion } from './_base.js';

// ── Theme-Reader ──────────────────────────────────────────
function _theme(name, fallback) {
  const css = getComputedStyle(document.documentElement);
  let v = css.getPropertyValue('--lf-fp-' + name).trim();
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
// Jeder Typ: welche Slider aktiv sind + Default-Werte + Formel.
const FUNCTIONS = {
  'linear': {
    label: 'Linear: f(x) = a·x + b',
    params: ['a', 'b'],
    defaults: { a: 1, b: 0 },
    ranges:   { a: [-5, 5, 0.1], b: [-10, 10, 0.1] },
    fn: (a, b, c, d, x) => a * x + b
  },
  'quadratic': {
    label: 'Quadratisch: f(x) = a·x² + b·x + c',
    params: ['a', 'b', 'c'],
    defaults: { a: 1, b: 0, c: 0 },
    ranges:   { a: [-3, 3, 0.1], b: [-5, 5, 0.1], c: [-10, 10, 0.1] },
    fn: (a, b, c, d, x) => a * x * x + b * x + c
  },
  'trig-sin': {
    label: 'Trigonometrisch: f(x) = a·sin(b·x + c) + d',
    params: ['a', 'b', 'c', 'd'],
    defaults: { a: 1, b: 1, c: 0, d: 0 },
    ranges:   { a: [-3, 3, 0.1], b: [0.1, 3, 0.1], c: [-3.14, 3.14, 0.1], d: [-3, 3, 0.1] },
    fn: (a, b, c, d, x) => a * Math.sin(b * x + c) + d
  },
  'exponential': {
    label: 'Exponentiell: f(x) = a·exp(b·x) + c',
    params: ['a', 'b', 'c'],
    defaults: { a: 1, b: 0.5, c: 0 },
    ranges:   { a: [-3, 3, 0.1], b: [-1, 1, 0.05], c: [-5, 5, 0.1] },
    fn: (a, b, c, d, x) => a * Math.exp(b * x) + c
  }
};

// ── Slider-Builder ────────────────────────────────────────
function _slider(label, min, max, step, value, onInput) {
  const wrap = _el('div', 'sim-slider');
  const head = _el('div', 'sim-slider-head');
  const lbl  = _el('span', 'sim-slider-label', label);
  const val  = _el('span', 'sim-slider-value', value.toFixed(step < 1 ? 2 : 0));
  head.append(lbl, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min); input.max = String(max);
  input.step = String(step); input.value = String(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = step < 1 ? v.toFixed(2) : v.toFixed(0);
    onInput(v);
  });
  wrap.append(head, input);
  return { wrap, input, valEl: val };
}

function _btn(label, onClick, primary) {
  const b = _el('button', 'sim-btn ' + (primary ? 'sim-btn-primary' : ''), label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  config = config || {};

  // State.
  let type = (config.initialType && FUNCTIONS[config.initialType]) ? config.initialType : 'quadratic';
  let params = Object.assign({}, FUNCTIONS[type].defaults, config.initialParams || {});
  let xRange = Array.isArray(config.xRange) && config.xRange.length === 2
    ? [Number(config.xRange[0]), Number(config.xRange[1])] : [-10, 10];
  let yRange = Array.isArray(config.yRange) && config.yRange.length === 2
    ? [Number(config.yRange[0]), Number(config.yRange[1])] : [-10, 10];
  const label = (typeof config.label === 'string' && config.label) ? config.label : 'Funktions-Plotter';

  /** @type {{x:number,y:number,pulseUntil:number}[]} */
  const points = [];

  let unmounted = false;
  let pulseRaf = 0;

  // Layout.
  container.innerHTML = '';
  const host = _el('div', 'lf-widget-physics-throw lf-fp-host physik-sim');
  container.append(host);
  try {
    container.setAttribute('aria-label', 'Funktions-Plot mit Parameter-Slidern');
  } catch (e) {}

  const titleEl = _el('div', 'lf-fp-title');
  titleEl.textContent = label;
  host.append(titleEl);

  // Funktions-Typ-Dropdown.
  const typeRow = _el('div', 'lf-fp-type-row');
  const typeLbl = _el('label', 'lf-fp-type-label', 'Funktionstyp');
  const typeSel = document.createElement('select');
  typeSel.className = 'lf-fp-type-select';
  Object.keys(FUNCTIONS).forEach(k => {
    const opt = document.createElement('option');
    opt.value = k; opt.textContent = FUNCTIONS[k].label;
    if (k === type) opt.selected = true;
    typeSel.append(opt);
  });
  typeSel.id = 'lf-fp-type-' + Math.random().toString(36).slice(2, 8);
  typeLbl.setAttribute('for', typeSel.id);
  typeSel.addEventListener('change', () => {
    type = typeSel.value;
    params = Object.assign({}, FUNCTIONS[type].defaults);
    rebuildSliders();
    formulaEl.textContent = FUNCTIONS[type].label;
    draw();
  });
  typeRow.append(typeLbl, typeSel);
  host.append(typeRow);

  // Aktuelle Formel (wechselt beim Type-Switch).
  const formulaEl = _el('div', 'lf-fp-formula');
  formulaEl.textContent = FUNCTIONS[type].label;
  host.append(formulaEl);

  // Canvas.
  const canvas = _el('canvas', 'sim-canvas lf-fp-canvas');
  canvas.setAttribute('aria-label', 'Funktions-Plot');
  canvas.setAttribute('role', 'img');
  host.append(canvas);

  const W_DEFAULT = container.clientWidth || 600;
  const H = 280;
  let W = W_DEFAULT;
  let ctx = _fitCanvas(canvas, W, H);

  // Click-Handler auf Canvas: wandelt Pixel → Welt-Koord (x), berechnet y, speichert.
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const xWorld = pxToX(px);
    addPoint(xWorld);
  });
  canvas.style.cursor = 'crosshair';

  // Controls.
  const controls = _el('div', 'sim-controls lf-fp-controls');

  // Slider-Container — wird bei Type-Switch neu befuellt.
  const sliderHost = _el('div', 'lf-fp-sliders');
  controls.append(sliderHost);

  /** @type {Object<string, ReturnType<typeof _slider>>} */
  let sliders = {};

  function rebuildSliders() {
    sliderHost.innerHTML = '';
    sliders = {};
    const def = FUNCTIONS[type];
    def.params.forEach(p => {
      const [min, max, step] = def.ranges[p];
      const s = _slider('Parameter ' + p, min, max, step, params[p], v => {
        params[p] = v;
        draw();
      });
      sliders[p] = s;
      sliderHost.append(s.wrap);
    });
  }
  rebuildSliders();

  // X-Range-Slider (Min/Max).
  const xRangeRow = _el('div', 'lf-fp-xrange');
  const xMinS = _slider('X-Min', -50, 0, 1, xRange[0], v => {
    xRange[0] = v; if (xRange[0] >= xRange[1] - 1) xRange[1] = xRange[0] + 1;
    xMaxS.input.value = String(xRange[1]); xMaxS.valEl.textContent = xRange[1].toFixed(0);
    draw();
  });
  const xMaxS = _slider('X-Max', 1, 50, 1, xRange[1], v => {
    xRange[1] = v; if (xRange[1] <= xRange[0] + 1) xRange[0] = xRange[1] - 1;
    xMinS.input.value = String(xRange[0]); xMinS.valEl.textContent = xRange[0].toFixed(0);
    draw();
  });
  xRangeRow.append(xMinS.wrap, xMaxS.wrap);
  controls.append(xRangeRow);

  // Keyboard-Punkt-Eingabe (a11y: Klick-Punkte sind Canvas-only sonst nicht erreichbar).
  const kbRow = _el('div', 'lf-fp-kb-row');
  const kbLbl = _el('label', 'lf-fp-kb-label', 'x-Wert eingeben');
  const kbInput = document.createElement('input');
  kbInput.type = 'number';
  kbInput.step = '0.1';
  kbInput.value = '0';
  kbInput.className = 'lf-fp-kb-input';
  kbInput.id = 'lf-fp-x-' + Math.random().toString(36).slice(2, 8);
  kbLbl.setAttribute('for', kbInput.id);
  const kbBtn = _btn('Punkt hinzufügen', () => {
    const xv = parseFloat(kbInput.value);
    if (!isFinite(xv)) return;
    addPoint(xv);
  });
  kbRow.append(kbLbl, kbInput, kbBtn);
  controls.append(kbRow);

  // Reset-Button.
  const btnRow = _el('div', 'sim-btn-row');
  btnRow.append(_btn('↺ Tabelle leeren', () => {
    points.length = 0; renderTable(); draw();
  }));
  controls.append(btnRow);

  host.append(controls);

  // Werte-Tabelle.
  const tableWrap = _el('div', 'lf-fp-table-wrap');
  const tableHead = _el('div', 'lf-fp-table-head', 'Wertetabelle (' + 0 + ' Punkte)');
  const table = document.createElement('table');
  table.className = 'lf-fp-table';
  table.setAttribute('aria-label', 'Wertetabelle der ausgewaehlten Punkte');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th scope="col">x</th><th scope="col">f(x)</th><th scope="col"></th></tr>';
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  tableWrap.append(tableHead, table);
  host.append(tableWrap);

  // ── Mathe ─────────────────────────────────────────────
  function evalFn(x) {
    const def = FUNCTIONS[type];
    const v = def.fn(params.a || 0, params.b || 0, params.c || 0, params.d || 0, x);
    return isFinite(v) ? v : NaN;
  }

  // Welt → Pixel
  function xToPx(x) { return ((x - xRange[0]) / (xRange[1] - xRange[0])) * W; }
  function yToPx(y) { return H - ((y - yRange[0]) / (yRange[1] - yRange[0])) * H; }
  function pxToX(px) { return xRange[0] + (px / W) * (xRange[1] - xRange[0]); }

  // ── Punkt hinzufuegen ─────────────────────────────────
  function addPoint(xv) {
    const yv = evalFn(xv);
    if (!isFinite(yv)) return;
    const rm = lfWidgetReducedMotion();
    points.push({ x: xv, y: yv, pulseUntil: performance.now() + (rm ? 0 : 600) });
    renderTable(); draw();
    if (!rm && !pulseRaf && !unmounted) {
      const step = () => {
        if (unmounted) { pulseRaf = 0; return; }
        const stillPulsing = points.some(p => p.pulseUntil > performance.now());
        draw();
        pulseRaf = stillPulsing ? requestAnimationFrame(step) : 0;
      };
      pulseRaf = requestAnimationFrame(step);
    }
  }

  // ── Tabelle rendern ──────────────────────────────────
  function renderTable() {
    tableHead.textContent = 'Wertetabelle (' + points.length + ' Punkte)';
    tbody.innerHTML = '';
    points.forEach((p, idx) => {
      const tr = document.createElement('tr');
      const tdX = document.createElement('td');
      tdX.textContent = p.x.toFixed(2);
      const tdY = document.createElement('td');
      tdY.textContent = isFinite(p.y) ? p.y.toFixed(2) : '—';
      const tdAct = document.createElement('td');
      const rmBtn = document.createElement('button');
      rmBtn.type = 'button';
      rmBtn.className = 'lf-fp-rm-btn';
      rmBtn.textContent = '×';
      rmBtn.setAttribute('aria-label', 'Punkt ' + (idx + 1) + ' entfernen');
      rmBtn.addEventListener('click', () => {
        points.splice(idx, 1); renderTable(); draw();
      });
      tdAct.append(rmBtn);
      tr.append(tdX, tdY, tdAct);
      tbody.append(tr);
    });
  }

  // ── Draw ─────────────────────────────────────────────
  function draw() {
    if (unmounted) return;
    ctx.clearRect(0, 0, W, H);

    // Canvas-BG.
    ctx.fillStyle = _theme('bg', 'sky');
    ctx.fillRect(0, 0, W, H);

    // Grid (Minor-Lines pro Einheit).
    const gridColor = _theme('grid', 'grid');
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.35;
    const xStep = niceStep(xRange[1] - xRange[0]);
    const yStep = niceStep(yRange[1] - yRange[0]);
    ctx.beginPath();
    for (let xv = Math.ceil(xRange[0] / xStep) * xStep; xv <= xRange[1]; xv += xStep) {
      const px = xToPx(xv);
      ctx.moveTo(px, 0); ctx.lineTo(px, H);
    }
    for (let yv = Math.ceil(yRange[0] / yStep) * yStep; yv <= yRange[1]; yv += yStep) {
      const py = yToPx(yv);
      ctx.moveTo(0, py); ctx.lineTo(W, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Achsen (X = y=0, Y = x=0) — kraeftiger.
    const axisColor = _theme('axis', 'text');
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (yRange[0] <= 0 && yRange[1] >= 0) {
      const py0 = yToPx(0);
      ctx.moveTo(0, py0); ctx.lineTo(W, py0);
    }
    if (xRange[0] <= 0 && xRange[1] >= 0) {
      const px0 = xToPx(0);
      ctx.moveTo(px0, 0); ctx.lineTo(px0, H);
    }
    ctx.stroke();

    // Achsen-Beschriftung (Tick-Labels).
    ctx.fillStyle = _theme('text', 'text-muted');
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const py0 = (yRange[0] <= 0 && yRange[1] >= 0) ? yToPx(0) : H - 12;
    for (let xv = Math.ceil(xRange[0] / xStep) * xStep; xv <= xRange[1]; xv += xStep) {
      if (Math.abs(xv) < xStep / 2) continue; // skip 0 (overlap mit y-Achse)
      ctx.fillText(formatTick(xv, xStep), xToPx(xv), Math.min(H - 12, py0 + 3));
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const px0 = (xRange[0] <= 0 && xRange[1] >= 0) ? xToPx(0) : 22;
    for (let yv = Math.ceil(yRange[0] / yStep) * yStep; yv <= yRange[1]; yv += yStep) {
      if (Math.abs(yv) < yStep / 2) continue;
      ctx.fillText(formatTick(yv, yStep), Math.max(22, px0 - 4), yToPx(yv));
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';

    // Achsen-Labels (x, y).
    ctx.fillStyle = _theme('text', 'text-muted');
    ctx.font = 'italic 11px sans-serif';
    ctx.fillText('x', W - 12, Math.max(12, Math.min(H - 4, py0 - 4)));
    ctx.fillText('y', Math.min(W - 12, Math.max(4, px0 + 4)), 10);

    // Funktions-Kurve plotten.
    ctx.strokeStyle = _theme('curve', null);
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const samples = Math.max(200, W);
    let prevValid = false;
    for (let i = 0; i <= samples; i++) {
      const xv = xRange[0] + (i / samples) * (xRange[1] - xRange[0]);
      const yv = evalFn(xv);
      if (!isFinite(yv)) { prevValid = false; continue; }
      // Clip: zeichne nur wenn y im sichtbaren Bereich +/- Puffer (sonst lange Vertikal-Zacken bei exp).
      const yClamped = Math.max(yRange[0] - (yRange[1] - yRange[0]) * 5,
                       Math.min(yRange[1] + (yRange[1] - yRange[0]) * 5, yv));
      const px = xToPx(xv);
      const py = yToPx(yClamped);
      if (!prevValid) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
      prevValid = true;
    }
    ctx.stroke();

    // Klickbare Punkte zeichnen.
    const pointColor = _theme('point', 'ball');
    const bgColor = _theme('bg', 'sky');
    const now = performance.now();
    ctx.font = 'bold 11px sans-serif';
    points.forEach(p => {
      const px = xToPx(p.x), py = yToPx(p.y);
      if (px < -10 || px > W + 10 || py < -10 || py > H + 10) return;
      const remain = p.pulseUntil - now;
      if (remain > 0) {
        const t = remain / 600;
        ctx.fillStyle = pointColor; ctx.globalAlpha = 0.25 * t;
        ctx.beginPath(); ctx.arc(px, py, 6 + 14 * t, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = pointColor;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = bgColor; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = _theme('text', 'text');
      ctx.fillText('(' + p.x.toFixed(1) + ', ' + p.y.toFixed(1) + ')', px + 8, py - 8);
    });
  }

  // niceStep: liefert eine "schoene" Tick-Distanz (1, 2, 5, 10, ...).
  function niceStep(span) {
    const target = span / 10;
    const base = Math.pow(10, Math.floor(Math.log10(Math.abs(target))));
    const m = target / base;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * base;
  }
  function formatTick(v, step) {
    return step >= 1 ? Math.round(v).toString() : v.toFixed(1);
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
  draw();
  renderTable();

  return {
    widgetType: 'function-plotter',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      if (pulseRaf) { cancelAnimationFrame(pulseRaf); pulseRaf = 0; }
      try { window.removeEventListener('resize', onResize); } catch (e) {}
    },

    pause() { /* no-op — Plot ist statisch (Pulse haengt von RAF, aber nicht laufend) */ },
    resume() { /* no-op */ },

    onTheme() {
      if (unmounted) return;
      draw();
    },

    onAnswer() {
      // Explorativ — kein Bewertungs-Hook noetig. Stub.
    },

    getState() {
      return {
        type, params: Object.assign({}, params),
        xRange: xRange.slice(), yRange: yRange.slice(),
        points: points.map(p => ({ x: p.x, y: p.y }))
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.type === 'string' && FUNCTIONS[s.type]) {
        type = s.type; typeSel.value = type;
        params = Object.assign({}, FUNCTIONS[type].defaults);
        rebuildSliders();
        formulaEl.textContent = FUNCTIONS[type].label;
      }
      if (s.params) Object.keys(s.params).forEach(k => {
        if (typeof s.params[k] === 'number') {
          params[k] = s.params[k];
          if (sliders[k]) {
            sliders[k].input.value = String(s.params[k]);
            sliders[k].valEl.textContent = s.params[k].toFixed(2);
          }
        }
      });
      if (Array.isArray(s.xRange) && s.xRange.length === 2) {
        xRange = [+s.xRange[0], +s.xRange[1]];
        xMinS.input.value = String(xRange[0]); xMinS.valEl.textContent = xRange[0].toFixed(0);
        xMaxS.input.value = String(xRange[1]); xMaxS.valEl.textContent = xRange[1].toFixed(0);
      }
      if (Array.isArray(s.yRange) && s.yRange.length === 2) yRange = [+s.yRange[0], +s.yRange[1]];
      if (Array.isArray(s.points)) {
        points.length = 0;
        s.points.forEach(p => {
          if (typeof p.x === 'number' && typeof p.y === 'number') points.push({ x: p.x, y: p.y, pulseUntil: 0 });
        });
      }
      renderTable(); draw();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'function-plotter',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'function-plotter', mount };
export { mount };
