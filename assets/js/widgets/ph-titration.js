// ══════════════════════════════════════════
//  LearningForge — Widget: ph-titration
//  Säure-Base-Titrationskurve (Welle 2.4)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md + Plan-Welle-2)
// ══════════════════════════════════════════
//
// Simuliert eine Säure-Base-Titration: Säure (Vorlage, V_a fix) +
// Lauge (NaOH) zugetropft via Slider. Live-pH wird berechnet, Kurve
// auf Canvas geplottet, Indikator-Farbe als großes Farbquadrat
// dargestellt.
//
// Drei Säure-Typen:
//   - HCl      (stark)               pH = -log10([H+])   bis EQ, dann pOH
//   - Essigsäure (CH3COOH, pKa=4.76) Henderson-Hasselbalch + Schwächungen
//   - Phosphor­säure (H3PO4, pKa1=2.15, pKa2=7.20)  vereinfacht erste Stufe
//
// Vier Indikatoren mit korrektem Umschlagsbereich:
//   - phenolphthalein  (8.2–10, farblos -> pink)
//   - methylorange     (3.1–4.4, rot -> gelb)
//   - bromthymolblau   (6.0–7.6, gelb -> grün -> blau)
//   - universal        (gradient rot->grün->blau über 1–14)
//
// Kein RAF-Loop — nur Re-Draw bei Slider-/Dropdown-Änderung. Indikator
// blendet seine Farbe linear über den Umschlag (CSS-Transition wenn
// nicht reduceMotion, sonst snap).
//
// Theme: --lf-ph-* Vars (Light + Dark in main.css). Fallback im JS auf
// --sim-* / --accent.
//
// Config-Schema:
//   {
//     widgetType: 'ph-titration',
//     config: {
//       label:               string  // optional, Titel
//       initialAcid:         'HCl'|'CH3COOH'|'H3PO4'   // optional, default HCl
//       initialIndicator:    'phenolphthalein'|'methylorange'|'bromthymolblau'|'universal'
//       acidVolume:          number  // mL, default 25
//       acidConcentration:   number  // mol/L, default 0.1
//       baseConcentration:   number  // mol/L, default 0.1
//     }
//   }

import { lfWidgetReducedMotion } from './_base.js';

// ── Theme-Reader ──────────────────────────────────────────
function _theme(name, fallback) {
  const css = getComputedStyle(document.documentElement);
  let v = css.getPropertyValue('--lf-ph-' + name).trim();
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
function _slider(label, min, max, step, value, unit, onInput) {
  const wrap = _el('div', 'sim-slider');
  const head = _el('div', 'sim-slider-head');
  const lbl  = _el('span', 'sim-slider-label', label);
  const fmt  = v => (step < 1 ? v.toFixed(1) : v.toFixed(0)) + (unit ? ' ' + unit : '');
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

// ── Säure-Definitionen ────────────────────────────────────
const ACIDS = {
  'HCl':     { label: 'HCl (Salzsäure, stark)',    type: 'strong' },
  'CH3COOH': { label: 'Essigsäure (schwach, pKa=4.76)', type: 'weak', pKa: 4.76 },
  'H3PO4':   { label: 'Phosphorsäure (schwach, pKa1=2.15)', type: 'weak', pKa: 2.15 }
};

// ── Indikator-Farben ──────────────────────────────────────
// Hex-Farben pro pH-Bereich. Übergang wird linear interpoliert.
const INDICATORS = {
  'phenolphthalein': {
    label: 'Phenolphthalein (8.2–10)',
    range: [8.2, 10.0],
    colorLow:  '#f8fafc',  // nahezu farblos (slate-50)
    colorHigh: '#db2777'   // pink-600
  },
  'methylorange': {
    label: 'Methylorange (3.1–4.4)',
    range: [3.1, 4.4],
    colorLow:  '#dc2626',  // rot (red-600)
    colorHigh: '#fbbf24'   // gelb (amber-400)
  },
  'bromthymolblau': {
    label: 'Bromthymolblau (6.0–7.6)',
    range: [6.0, 7.6],
    colorLow:  '#fbbf24',  // gelb
    colorHigh: '#2563eb'   // blau (blue-600)
  },
  'universal': {
    label: 'Universalindikator (1–14)',
    range: [1, 14],
    // gradient — wird in colorFor() spezial behandelt
    universal: true
  }
};

// Universal-Indikator: 7-Stop-Gradient rot -> orange -> gelb -> grün -> türkis -> blau -> violett
const UNIVERSAL_STOPS = [
  { pH: 1,  hex: '#dc2626' }, // rot
  { pH: 3,  hex: '#f97316' }, // orange
  { pH: 5,  hex: '#fbbf24' }, // gelb
  { pH: 7,  hex: '#22c55e' }, // grün
  { pH: 9,  hex: '#06b6d4' }, // türkis
  { pH: 11, hex: '#2563eb' }, // blau
  { pH: 14, hex: '#7c3aed' }  // violett
];

// ── Farb-Interpolation (hex -> hex, t ∈ [0,1]) ────────────
function _lerpColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}

function _indicatorColor(indicatorKey, pH) {
  const ind = INDICATORS[indicatorKey];
  if (!ind) return '#cccccc';
  if (ind.universal) {
    // 7-Stop linear interpolation
    if (pH <= UNIVERSAL_STOPS[0].pH) return UNIVERSAL_STOPS[0].hex;
    if (pH >= UNIVERSAL_STOPS[UNIVERSAL_STOPS.length - 1].pH) return UNIVERSAL_STOPS[UNIVERSAL_STOPS.length - 1].hex;
    for (let i = 0; i < UNIVERSAL_STOPS.length - 1; i++) {
      const a = UNIVERSAL_STOPS[i], b = UNIVERSAL_STOPS[i + 1];
      if (pH >= a.pH && pH <= b.pH) {
        const t = (pH - a.pH) / (b.pH - a.pH);
        return _lerpColor(a.hex, b.hex, t);
      }
    }
    return UNIVERSAL_STOPS[0].hex;
  }
  // Range-basierter Indikator: unter range[0] = colorLow, über range[1] = colorHigh, dazwischen interpoliert
  const [lo, hi] = ind.range;
  if (pH <= lo) return ind.colorLow;
  if (pH >= hi) return ind.colorHigh;
  const t = (pH - lo) / (hi - lo);
  return _lerpColor(ind.colorLow, ind.colorHigh, t);
}

// ── pH-Berechnung ─────────────────────────────────────────
// Stoffmengen in mmol, Volumen in mL — kürzt sich zu mol/L bei Quotienten heraus.
function _computePH(acidKey, V_a, c_a, V_b, c_b) {
  const n_a = V_a * c_a;          // mmol Säure (initial)
  const n_b = V_b * c_b;          // mmol Lauge (zugesetzt)
  const V_total = V_a + V_b;      // mL Gesamt
  if (V_total <= 0) return 7;
  const acid = ACIDS[acidKey] || ACIDS.HCl;

  // Spezialfall V_b = 0: reine Säure
  if (V_b <= 0) {
    if (acid.type === 'strong') {
      // [H+] = c_a
      const H = c_a;
      return H > 0 ? -Math.log10(H) : 7;
    } else {
      // Schwache Säure: [H+] ≈ sqrt(Ka · c)
      const Ka = Math.pow(10, -acid.pKa);
      const H = Math.sqrt(Ka * c_a);
      return -Math.log10(H);
    }
  }

  const n_eq = n_a;  // Äquivalenz wenn n_b = n_a (1:1 Stöchiometrie für HCl/AcOH/erste Stufe H3PO4)
  const epsilon = 1e-9;

  if (n_b < n_a - epsilon) {
    // Vor Äquivalenzpunkt
    if (acid.type === 'strong') {
      // Überschuss starker Säure: [H+] = (n_a - n_b) / V_total
      const H = (n_a - n_b) / V_total;
      return -Math.log10(H);
    } else {
      // Schwache Säure mit konjugierter Base — Henderson-Hasselbalch:
      // pH = pKa + log10([A-]/[HA]) = pKa + log10(n_b / (n_a - n_b))
      // Singularität bei n_b=0 wird oben (V_b<=0) abgefangen — hier ist n_b>0.
      const n_HA = n_a - n_b;
      const n_A  = n_b;
      if (n_HA <= 0 || n_A <= 0) return acid.pKa;
      return acid.pKa + Math.log10(n_A / n_HA);
    }
  } else if (Math.abs(n_b - n_a) <= epsilon) {
    // Äquivalenzpunkt
    if (acid.type === 'strong') {
      return 7;
    } else {
      // Schwache Säure + starke Base: Salz reagiert basisch
      // pH = 7 + 0.5·(pKa + log10(c_salt))
      // c_salt = n_a / V_total (in mol/L, mmol/mL = mol/L)
      const c_salt = n_a / V_total;
      return 7 + 0.5 * (acid.pKa + Math.log10(c_salt));
    }
  } else {
    // Nach Äquivalenzpunkt: Überschuss OH-
    // [OH-] = (n_b - n_a) / V_total
    const OH = (n_b - n_a) / V_total;
    if (OH <= 0) return 7;
    const pOH = -Math.log10(OH);
    return 14 - pOH;
  }
}

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  config = config || {};

  // State.
  let acidKey      = (config.initialAcid && ACIDS[config.initialAcid]) ? config.initialAcid : 'HCl';
  let indicatorKey = (config.initialIndicator && INDICATORS[config.initialIndicator]) ? config.initialIndicator : 'phenolphthalein';
  const V_a = +(config.acidVolume         ?? 25);   // mL (fix)
  const c_a = +(config.acidConcentration  ?? 0.1);  // mol/L
  const c_b = +(config.baseConcentration  ?? 0.1);  // mol/L
  const V_B_MAX = 50;
  let V_b = 0;
  const label = (typeof config.label === 'string' && config.label) ? config.label : 'Säure-Base-Titration';

  let unmounted = false;

  // Layout.
  container.innerHTML = '';
  const host = _el('div', 'lf-widget-physics-throw lf-ph-host physik-sim');
  container.append(host);
  try {
    container.setAttribute('aria-label', 'Säure-Base-Titration mit pH-Kurve und Indikatorfarbe');
  } catch (e) {}

  const titleEl = _el('div', 'lf-ph-title');
  titleEl.textContent = label;
  host.append(titleEl);

  // Reagenz/Indikator-Auswahl.
  const selectRow = _el('div', 'lf-ph-select-row');

  const acidWrap = _el('div', 'lf-ph-select-cell');
  const acidLbl  = _el('label', 'lf-ph-select-label', 'Säure');
  const acidSel  = document.createElement('select');
  acidSel.className = 'lf-ph-select';
  acidSel.id = 'lf-ph-acid-' + Math.random().toString(36).slice(2, 8);
  acidLbl.setAttribute('for', acidSel.id);
  Object.keys(ACIDS).forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = ACIDS[k].label;
    if (k === acidKey) o.selected = true;
    acidSel.append(o);
  });
  acidSel.addEventListener('change', () => { acidKey = acidSel.value; redraw(); });
  acidWrap.append(acidLbl, acidSel);

  const indWrap = _el('div', 'lf-ph-select-cell');
  const indLbl  = _el('label', 'lf-ph-select-label', 'Indikator');
  const indSel  = document.createElement('select');
  indSel.className = 'lf-ph-select';
  indSel.id = 'lf-ph-ind-' + Math.random().toString(36).slice(2, 8);
  indLbl.setAttribute('for', indSel.id);
  Object.keys(INDICATORS).forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = INDICATORS[k].label;
    if (k === indicatorKey) o.selected = true;
    indSel.append(o);
  });
  indSel.addEventListener('change', () => { indicatorKey = indSel.value; redraw(); });
  indWrap.append(indLbl, indSel);

  selectRow.append(acidWrap, indWrap);
  host.append(selectRow);

  // Hauptbereich: Canvas links, Info-Panel rechts.
  const main = _el('div', 'lf-ph-main');

  // Canvas.
  const canvasWrap = _el('div', 'lf-ph-canvas-wrap');
  const canvas = _el('canvas', 'sim-canvas lf-ph-canvas');
  canvas.setAttribute('aria-label', 'pH-Titrationskurve');
  canvas.setAttribute('role', 'img');
  canvasWrap.append(canvas);
  main.append(canvasWrap);

  // Info-Panel rechts (Farbquadrat + pH-Anzeige + Daten).
  const panel = _el('div', 'lf-ph-panel');

  const colorBox = _el('div', 'lf-ph-color');
  colorBox.setAttribute('aria-hidden', 'true');
  if (lfWidgetReducedMotion()) {
    colorBox.style.transition = 'none';
  }
  panel.append(colorBox);

  const phLive = _el('div', 'lf-ph-live');
  phLive.setAttribute('aria-live', 'polite');
  phLive.setAttribute('aria-atomic', 'true');
  const phLabel = _el('div', 'lf-ph-live-label', 'pH-Wert');
  const phValue = _el('div', 'lf-ph-live-value', '0.00');
  phLive.append(phLabel, phValue);
  panel.append(phLive);

  const info = _el('div', 'lf-ph-info');
  info.innerHTML =
    '<div class="lf-ph-info-row"><span>V(Säure)</span><b>' + V_a.toFixed(0) + ' mL</b></div>' +
    '<div class="lf-ph-info-row"><span>c(Säure)</span><b>' + c_a.toFixed(2) + ' mol/L</b></div>' +
    '<div class="lf-ph-info-row"><span>c(Lauge)</span><b>' + c_b.toFixed(2) + ' mol/L</b></div>' +
    '<div class="lf-ph-info-row"><span>V(Lauge)</span><b class="lf-ph-vb">0.0 mL</b></div>';
  panel.append(info);
  const vbReadout = info.querySelector('.lf-ph-vb');

  main.append(panel);
  host.append(main);

  // Controls (Slider + Reset).
  const controls = _el('div', 'sim-controls lf-ph-controls');
  const sV = _slider('Volumen Lauge V(b)', 0, V_B_MAX, 0.1, V_b, 'mL', v => {
    V_b = v;
    redraw();
  });
  controls.append(sV.wrap);

  const btnRow = _el('div', 'sim-btn-row');
  btnRow.append(_btn('↺ Reset', () => {
    V_b = 0;
    sV.input.value = '0';
    sV.valEl.textContent = sV.fmt(0);
    redraw();
  }));
  controls.append(btnRow);
  host.append(controls);

  // Canvas-Größe.
  const W_DEFAULT = canvasWrap.clientWidth || 380;
  const H = 260;
  let W = W_DEFAULT;
  let ctx = _fitCanvas(canvas, W, H);

  // ── Draw ─────────────────────────────────────────────
  function draw() {
    if (unmounted) return;
    ctx.clearRect(0, 0, W, H);

    // BG.
    ctx.fillStyle = _theme('bg', 'ground');
    ctx.fillRect(0, 0, W, H);

    // Padding für Achsen-Beschriftung.
    const padL = 36, padR = 14, padT = 14, padB = 30;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // Mapping: x = V_b (0..V_B_MAX), y = pH (0..14)
    const xToPx = v => padL + (v / V_B_MAX) * plotW;
    const yToPx = p => padT + (1 - p / 14) * plotH;

    // Grid.
    ctx.strokeStyle = _theme('grid', 'grid');
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let v = 0; v <= V_B_MAX; v += 10) {
      const px = xToPx(v);
      ctx.moveTo(px, padT); ctx.lineTo(px, padT + plotH);
    }
    for (let p = 0; p <= 14; p += 2) {
      const py = yToPx(p);
      ctx.moveTo(padL, py); ctx.lineTo(padL + plotW, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Achsen.
    ctx.strokeStyle = _theme('axis', 'text');
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padL, padT); ctx.lineTo(padL, padT + plotH);
    ctx.lineTo(padL + plotW, padT + plotH);
    ctx.stroke();

    // Tick-Labels.
    ctx.fillStyle = _theme('text', 'text-muted');
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = 0; v <= V_B_MAX; v += 10) {
      ctx.fillText(v.toString(), xToPx(v), padT + plotH + 4);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let p = 0; p <= 14; p += 2) {
      ctx.fillText(p.toString(), padL - 4, yToPx(p));
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';

    // Achsen-Labels.
    ctx.fillStyle = _theme('text', 'text');
    ctx.font = '10px sans-serif';
    ctx.fillText('V(Lauge) / mL', padL + plotW - 70, padT + plotH + 18);
    ctx.save();
    ctx.translate(10, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('pH', 0, 0);
    ctx.restore();

    // Kurve plotten.
    ctx.strokeStyle = _theme('curve', null);
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const samples = 250;
    for (let i = 0; i <= samples; i++) {
      const v = (i / samples) * V_B_MAX;
      const p = _computePH(acidKey, V_a, c_a, v, c_b);
      const px = xToPx(v);
      const py = yToPx(Math.max(0, Math.min(14, p)));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Äquivalenzpunkt-Marker (vertikale gestrichelte Linie).
    const V_eq = V_a * c_a / c_b;
    if (V_eq <= V_B_MAX) {
      ctx.strokeStyle = _theme('text-muted', 'text-muted');
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      const pxEq = xToPx(V_eq);
      ctx.moveTo(pxEq, padT); ctx.lineTo(pxEq, padT + plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = _theme('text-muted', 'text-muted');
      ctx.font = '9px sans-serif';
      ctx.fillText('ÄP', pxEq + 3, padT + 10);
      ctx.globalAlpha = 1;
    }

    // Aktueller Punkt.
    const pHCurrent = _computePH(acidKey, V_a, c_a, V_b, c_b);
    const px = xToPx(V_b);
    const py = yToPx(Math.max(0, Math.min(14, pHCurrent)));
    ctx.fillStyle = _theme('point', null);
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = _theme('bg', 'ground');
    ctx.lineWidth = 2;
    ctx.stroke();

    return pHCurrent;
  }

  // ── Komplett-Update (Canvas + Panel) ─────────────────
  function redraw() {
    if (unmounted) return;
    const pH = draw();
    // pH-Anzeige
    phValue.textContent = pH.toFixed(2);
    // V_b-Anzeige
    if (vbReadout) vbReadout.textContent = V_b.toFixed(1) + ' mL';
    // Indikator-Farbe
    const col = _indicatorColor(indicatorKey, pH);
    colorBox.style.background = col;
  }

  // ── Resize ───────────────────────────────────────────
  function onResize() {
    if (unmounted) return;
    W = canvasWrap.clientWidth || W_DEFAULT;
    ctx = _fitCanvas(canvas, W, H);
    redraw();
  }
  window.addEventListener('resize', onResize);

  // Erst-Render.
  redraw();

  return {
    widgetType: 'ph-titration',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      try { window.removeEventListener('resize', onResize); } catch (e) {}
    },

    pause()  { /* no-op — kein RAF */ },
    resume() { /* no-op */ },

    onTheme() {
      if (unmounted) return;
      redraw();
    },

    onAnswer() { /* explorativ — kein Bewertungs-Hook */ },

    getState() {
      return { acidKey, indicatorKey, V_b };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.acidKey === 'string' && ACIDS[s.acidKey]) {
        acidKey = s.acidKey;
        acidSel.value = acidKey;
      }
      if (typeof s.indicatorKey === 'string' && INDICATORS[s.indicatorKey]) {
        indicatorKey = s.indicatorKey;
        indSel.value = indicatorKey;
      }
      if (typeof s.V_b === 'number') {
        V_b = Math.max(0, Math.min(V_B_MAX, s.V_b));
        sV.input.value = String(V_b);
        sV.valEl.textContent = sV.fmt(V_b);
      }
      redraw();
    }
  };
}

function _emptyInstance() {
  const noop = () => {};
  return {
    widgetType: 'ph-titration',
    unmount: noop, pause: noop, resume: noop, onTheme: noop, onAnswer: noop,
    getState: () => ({}), setState: noop
  };
}

export default { widgetType: 'ph-titration', mount };
export { mount };
