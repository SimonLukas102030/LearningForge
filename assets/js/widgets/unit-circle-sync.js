// ══════════════════════════════════════════
//  LearningForge — Widget: unit-circle-sync
//  Einheitskreis ↔ Sinus-/Cosinus-Welle synchron (Welle 3.2)
//  (siehe Plan 2026-05-09-interaktiv-ausbau.md, W3.2)
// ══════════════════════════════════════════
//
// Links: SVG-Einheitskreis (Radius 1, Achsen ±1.2). Punkt P (rot) auf dem
// Kreis ist ziehbar; Radius-Strich + Projektionen auf X- und Y-Achse zeigen
// cos(θ) bzw. sin(θ) als gestrichelte Hilfslinien.
// Rechts: Sinus- + Cosinus-Welle (θ ∈ [0, 2π]) mit Marker bei aktuellem θ.
// Drag auf Kreis ODER Slider 0..360° steuert θ. Auto-Play laeuft 1 Umlauf
// in 5s; reduce-motion deaktiviert es. Show-Cosinus toggelt Cos-Welle.
// Snap-Toggle rastet auf Spezialwerten (0/30/45/60/90/...) ein.
//
// Pure SVG — onTheme() ist no-op (CSS-Vars).
//
// Config-Schema:
//   {
//     widgetType: 'unit-circle-sync',
//     config: {
//       label: string                 // optional, Titel
//       initialAngleDeg: number       // optional, default 30
//       showSin: boolean              // optional, default true
//       showCos: boolean              // optional, default true
//       autoPlay: boolean             // optional, default false
//     }
//   }

import { lfWidgetReducedMotion } from './_base.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-uc-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

// ── DOM-Helpers ───────────────────────────────────────────
function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function _setAttrs(el, attrs) { for (const k in attrs) el.setAttribute(k, attrs[k]); }
function _svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) _setAttrs(el, attrs);
  return el;
}

// Spezialwerte (Grad) fuer Snap.
const SNAP_DEG = [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330, 360];
const SNAP_TOL = 5; // ±5° um snappen
function _snapAngle(deg) {
  for (const s of SNAP_DEG) if (Math.abs(deg - s) <= SNAP_TOL) return s % 360;
  return deg;
}
function _normDeg(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

// ── Layout-Konstanten (SVG-Koordinaten) ───────────────────
// viewBox: 0 0 600 280. Linke Haelfte = Kreis (0..280), rechte = Wellen (290..600).
const VB_W = 600, VB_H = 280;
const C_CX = 140, C_CY = 140, C_R = 100;        // Kreis: Mittelpunkt + Radius
const W_X0 = 300, W_X1 = 590;                    // Wellen-Plot horizontal
const W_TOP = 20, W_BOT = 260;                   // Wellen-Plot vertikal

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  config = config || {};

  // State.
  let theta = (typeof config.initialAngleDeg === 'number') ? config.initialAngleDeg : 30;
  theta = _normDeg(theta);
  let showSin = config.showSin !== false;
  let showCos = config.showCos !== false;
  const wantAuto = config.autoPlay === true;
  const reducedMotion = lfWidgetReducedMotion();
  let auto = wantAuto && !reducedMotion;
  let snap = false;
  const label = (typeof config.label === 'string' && config.label) ? config.label : 'Einheitskreis und Sinus-Welle';

  let unmounted = false, paused = false;
  let rafId = 0, lastTs = 0;

  const slotId = _nextSlotId();

  // Layout.
  container.innerHTML = '';
  const host = _el('div', 'lf-widget-process-flow lf-uc-host');
  host.id = slotId;
  container.append(host);
  try { container.setAttribute('aria-label', 'Einheitskreis mit Sinus-Welle'); } catch (e) {}

  const titleEl = _el('h4', 'lf-pf-title lf-uc-title');
  titleEl.textContent = label;
  host.append(titleEl);

  // Stage = SVG-Container.
  const stage = _el('div', 'lf-pf-stage lf-uc-stage');
  host.append(stage);

  // SVG bauen.
  const svg = _svg('svg', {
    'class': 'lf-pf-svg lf-uc-svg',
    'viewBox': '0 0 ' + VB_W + ' ' + VB_H,
    'preserveAspectRatio': 'xMidYMid meet',
    'role': 'img',
    'aria-label': 'Einheitskreis mit Sinus- und Cosinus-Welle'
  });

  // ── Kreis-Bereich ──────────────────────────────────────
  // Achsen + Einheitskreis. Achsenbeschriftung minimal (klare Vars + projX/Y in Wellenfarben kommunizieren das).
  const axisH = _svg('line', { x1: C_CX - C_R - 20, y1: C_CY, x2: C_CX + C_R + 20, y2: C_CY, 'class': 'lf-uc-axis-line' });
  const axisV = _svg('line', { x1: C_CX, y1: C_CY - C_R - 20, x2: C_CX, y2: C_CY + C_R + 20, 'class': 'lf-uc-axis-line' });
  const circle = _svg('circle', { cx: C_CX, cy: C_CY, r: C_R, 'class': 'lf-uc-circle' });
  // Projektionen + Radius + Punkt P + Origin + Winkelbogen.
  const projX = _svg('line', { 'class': 'lf-uc-projection lf-uc-projection-x' });
  const projY = _svg('line', { 'class': 'lf-uc-projection lf-uc-projection-y' });
  const radius = _svg('line', { 'class': 'lf-uc-radius' });
  const pointP = _svg('circle', { r: 7, 'class': 'lf-uc-point' });
  const origin = _svg('circle', { cx: C_CX, cy: C_CY, r: 2.5, 'class': 'lf-uc-origin' });
  const arc = _svg('path', { 'class': 'lf-uc-arc' });

  svg.append(axisH, axisV, circle, arc, projX, projY, radius, origin, pointP);

  // ── Wellen-Bereich ─────────────────────────────────────
  const wTrackH = (W_BOT - W_TOP) / 2;
  const wMidSin = W_TOP + wTrackH * 0.5;
  const wMidCos = W_TOP + wTrackH * 1.5;
  const wAmp = wTrackH * 0.4;

  // BG-Streifen pro Track.
  const wBgSin = _svg('rect', {
    x: W_X0, y: W_TOP, width: W_X1 - W_X0, height: wTrackH,
    'class': 'lf-uc-wave-bg'
  });
  const wBgCos = _svg('rect', {
    x: W_X0, y: W_TOP + wTrackH, width: W_X1 - W_X0, height: wTrackH,
    'class': 'lf-uc-wave-bg'
  });

  // Nullachsen.
  const wAxisSin = _svg('line', {
    x1: W_X0, y1: wMidSin, x2: W_X1, y2: wMidSin, 'class': 'lf-uc-wave-axis'
  });
  const wAxisCos = _svg('line', {
    x1: W_X0, y1: wMidCos, x2: W_X1, y2: wMidCos, 'class': 'lf-uc-wave-axis'
  });

  // Spur-Labels.
  const wLblSin = _svg('text', { x: W_X0 + 6, y: W_TOP + 12, 'class': 'lf-uc-wave-label' });
  wLblSin.textContent = 'sin(θ)';
  const wLblCos = _svg('text', { x: W_X0 + 6, y: W_TOP + wTrackH + 12, 'class': 'lf-uc-wave-label' });
  wLblCos.textContent = 'cos(θ)';

  // Wellen-Pfade (vorberechnet, da konstant; nur Marker-Position ändert sich).
  const sinPath = _svg('path', { 'class': 'lf-uc-wave-sin', d: _buildWavePath(Math.sin) });
  const cosPath = _svg('path', { 'class': 'lf-uc-wave-cos', d: _buildWavePath(Math.cos) });

  // Marker auf den Wellen (vertikaler Strich + Punkt).
  const sinMarkerLine = _svg('line', { 'class': 'lf-uc-wave-marker-line' });
  const sinMarkerDot = _svg('circle', { r: 4.5, 'class': 'lf-uc-wave-marker-dot lf-uc-wave-marker-sin' });
  const cosMarkerLine = _svg('line', { 'class': 'lf-uc-wave-marker-line' });
  const cosMarkerDot = _svg('circle', { r: 4.5, 'class': 'lf-uc-wave-marker-dot lf-uc-wave-marker-cos' });

  // Horizontale Verbindung von Kreis-Projektion zur Welle (nur als visueller Hint).
  // → wir lassen das aus (visuell zu busy bei kleinen Bildschirmen).

  svg.append(wBgSin, wBgCos, wAxisSin, wAxisCos, wLblSin, wLblCos,
             sinPath, cosPath, sinMarkerLine, sinMarkerDot, cosMarkerLine, cosMarkerDot);

  stage.append(svg);

  // ── Controls ───────────────────────────────────────────
  const controls = _el('div', 'lf-uc-controls');

  // Slider θ.
  const sliderRow = _el('div', 'lf-uc-slider-row');
  const sliderLbl = _el('label', 'lf-uc-slider-label', 'Winkel θ');
  const sliderId = slotId + '-theta';
  sliderLbl.setAttribute('for', sliderId);
  const sliderVal = _el('span', 'lf-uc-slider-value', '');
  const slider = document.createElement('input');
  slider.id = sliderId;
  slider.type = 'range';
  slider.min = '0'; slider.max = '360'; slider.step = '1';
  slider.value = String(Math.round(theta));
  slider.className = 'lf-uc-slider';
  slider.addEventListener('input', () => {
    let v = parseFloat(slider.value);
    if (snap) v = _snapAngle(v);
    setTheta(v);
    cancelAuto();
  });
  const sliderHead = _el('div', 'lf-uc-slider-head');
  sliderHead.append(sliderLbl, sliderVal);
  sliderRow.append(sliderHead, slider);
  controls.append(sliderRow);

  // Toggle-Reihe: Auto-Play, Cos, Snap.
  const togRow = _el('div', 'lf-uc-toggle-row');
  const autoBtn = _el('button', 'lf-uc-btn');
  autoBtn.type = 'button';
  autoBtn.addEventListener('click', () => toggleAuto());
  const cosBtn = _el('button', 'lf-uc-btn');
  cosBtn.type = 'button';
  cosBtn.addEventListener('click', () => { showCos = !showCos; updateCosVisibility(); });
  const sinBtn = _el('button', 'lf-uc-btn');
  sinBtn.type = 'button';
  sinBtn.addEventListener('click', () => { showSin = !showSin; updateSinVisibility(); });
  const snapBtn = _el('button', 'lf-uc-btn');
  snapBtn.type = 'button';
  snapBtn.addEventListener('click', () => { snap = !snap; updateSnapBtn(); });
  togRow.append(autoBtn, sinBtn, cosBtn, snapBtn);
  controls.append(togRow);

  // Live-Readout (aria-live).
  const live = _el('div', 'lf-uc-readout');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  controls.append(live);

  host.append(controls);

  // ── Drag-Handling auf Kreis ───────────────────────────
  let dragging = false;
  function pickAngle(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    // Mouse → SVG-Koords (uniform scale, da preserveAspectRatio).
    const scale = Math.min(rect.width / VB_W, rect.height / VB_H);
    const offX = (rect.width - VB_W * scale) / 2;
    const offY = (rect.height - VB_H * scale) / 2;
    const sx = (clientX - rect.left - offX) / scale;
    const sy = (clientY - rect.top - offY) / scale;
    const dx = sx - C_CX;
    const dy = C_CY - sy; // SVG-y nach unten → invertieren
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    return _normDeg(deg);
  }
  function onPointerDown(e) {
    // Nur wenn auf/nahe dem Kreis: |r - C_R| < 30 oder direkt im Kreis-Quadranten.
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / VB_W, rect.height / VB_H);
    const offX = (rect.width - VB_W * scale) / 2;
    const offY = (rect.height - VB_H * scale) / 2;
    const sx = (e.clientX - rect.left - offX) / scale;
    if (sx > C_CX + C_R + 25) return; // rechts vom Kreis = Welle-Zone, ignorieren
    dragging = true;
    try { svg.setPointerCapture && svg.setPointerCapture(e.pointerId); } catch (_) {}
    let deg = pickAngle(e.clientX, e.clientY);
    if (snap) deg = _snapAngle(deg);
    setTheta(deg);
    cancelAuto();
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!dragging) return;
    let deg = pickAngle(e.clientX, e.clientY);
    if (snap) deg = _snapAngle(deg);
    setTheta(deg);
  }
  function onPointerUp(e) {
    dragging = false;
    try { svg.releasePointerCapture && svg.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  svg.addEventListener('pointerdown', onPointerDown);
  svg.addEventListener('pointermove', onPointerMove);
  svg.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('pointercancel', onPointerUp);

  // ── Wave-Path-Builder ────────────────────────────────
  function _buildWavePath(fn) {
    // θ ∈ [0, 2π] ↦ x ∈ [W_X0, W_X1], y ∈ wMid ± wAmp.
    // Sin/Cos passend gemittelt — sin → wMidSin, cos → wMidCos.
    const isSin = (fn === Math.sin);
    const mid = isSin ? wMidSin : wMidCos;
    const samples = 120;
    let d = '';
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const ang = t * 2 * Math.PI;
      const px = W_X0 + t * (W_X1 - W_X0);
      const py = mid - fn(ang) * wAmp;
      d += (i === 0 ? 'M' : 'L') + px.toFixed(2) + ',' + py.toFixed(2) + ' ';
    }
    return d;
  }

  // ── State-Setter ─────────────────────────────────────
  function setTheta(deg) {
    theta = _normDeg(deg);
    slider.value = String(Math.round(theta));
    updateGeometry();
    updateReadout();
  }

  // ── Render ───────────────────────────────────────────
  function _line(el, x1, y1, x2, y2) {
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
  }
  function _dot(el, cx, cy) { el.setAttribute('cx', cx); el.setAttribute('cy', cy); }
  function updateGeometry() {
    const rad = theta * Math.PI / 180;
    const cosT = Math.cos(rad), sinT = Math.sin(rad);
    const px = C_CX + cosT * C_R, py = C_CY - sinT * C_R;
    _line(radius, C_CX, C_CY, px, py);
    _line(projX, px, py, px, C_CY);     // P → X-Achse
    _line(projY, px, py, C_CX, py);     // P → Y-Achse
    _dot(pointP, px, py);
    // Winkelbogen 0°→θ (Y invertiert, sweepFlag=0 ⇒ math-positive).
    const arcR = 24;
    const ex = C_CX + cosT * arcR, ey = C_CY - sinT * arcR;
    arc.setAttribute('d', 'M ' + (C_CX + arcR) + ' ' + C_CY + ' A ' + arcR + ' ' + arcR +
      ' 0 ' + (theta > 180 ? 1 : 0) + ' 0 ' + ex + ' ' + ey);
    // Wellen-Marker: θ/360 ↦ Welle-x.
    const wx = W_X0 + (theta / 360) * (W_X1 - W_X0);
    _line(sinMarkerLine, wx, W_TOP + 2, wx, W_TOP + wTrackH - 2);
    _dot(sinMarkerDot, wx, wMidSin - sinT * wAmp);
    _line(cosMarkerLine, wx, W_TOP + wTrackH + 2, wx, W_BOT - 2);
    _dot(cosMarkerDot, wx, wMidCos - cosT * wAmp);
  }

  function updateReadout() {
    const rad = theta * Math.PI / 180;
    const radStr = (rad / Math.PI).toFixed(3);
    sliderVal.textContent = theta.toFixed(0) + '°';
    live.innerHTML =
        '<span class="lf-uc-rd">θ = <b>' + theta.toFixed(1) + '°</b> = <b>' + radStr + 'π</b> rad</span>'
      + '<span class="lf-uc-rd lf-uc-rd-sin">sin(θ) = <b>' + Math.sin(rad).toFixed(3) + '</b></span>'
      + '<span class="lf-uc-rd lf-uc-rd-cos">cos(θ) = <b>' + Math.cos(rad).toFixed(3) + '</b></span>';
  }

  function _setVis(els, on) {
    const d = on ? '' : 'none';
    for (const e of els) e.style.display = d;
  }
  function updateSinVisibility() {
    _setVis([sinPath, sinMarkerLine, sinMarkerDot, wBgSin, wAxisSin, wLblSin], showSin);
    sinBtn.textContent = showSin ? 'Sinus aus' : 'Sinus an';
    sinBtn.setAttribute('aria-pressed', showSin ? 'true' : 'false');
  }
  function updateCosVisibility() {
    _setVis([cosPath, cosMarkerLine, cosMarkerDot, wBgCos, wAxisCos, wLblCos], showCos);
    cosBtn.textContent = showCos ? 'Cosinus aus' : 'Cosinus an';
    cosBtn.setAttribute('aria-pressed', showCos ? 'true' : 'false');
  }
  function updateSnapBtn() {
    snapBtn.textContent = snap ? 'Snap an' : 'Snap aus';
    snapBtn.setAttribute('aria-pressed', snap ? 'true' : 'false');
  }
  function updateAutoBtn() {
    autoBtn.textContent = auto ? '⏸ Pause' : '▶ Auto-Play';
    autoBtn.setAttribute('aria-pressed', auto ? 'true' : 'false');
    if (reducedMotion) {
      autoBtn.disabled = true;
      autoBtn.title = 'Auto-Play deaktiviert (reduce-motion)';
    }
  }

  // ── Auto-Play (RAF) ──────────────────────────────────
  // 1 Umlauf in 5s → 72°/s.
  function tick(ts) {
    if (unmounted || paused || !auto) { rafId = 0; return; }
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    let next = theta + dt * 72;
    next = _normDeg(next);
    setTheta(next);
    rafId = requestAnimationFrame(tick);
  }
  function startAuto() {
    if (reducedMotion) return;
    auto = true;
    lastTs = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
    updateAutoBtn();
  }
  function cancelAuto() {
    if (!auto) return;
    auto = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    updateAutoBtn();
  }
  function toggleAuto() {
    if (auto) cancelAuto(); else startAuto();
  }

  // Initial-Render.
  updateGeometry();
  updateReadout();
  updateSinVisibility();
  updateCosVisibility();
  updateSnapBtn();
  updateAutoBtn();

  // Auto-Play wenn gewuenscht.
  if (auto) startAuto();

  return {
    widgetType: 'unit-circle-sync',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      try {
        svg.removeEventListener('pointerdown', onPointerDown);
        svg.removeEventListener('pointermove', onPointerMove);
        svg.removeEventListener('pointerup', onPointerUp);
        svg.removeEventListener('pointercancel', onPointerUp);
      } catch (e) {}
    },

    pause() {
      if (unmounted) return;
      paused = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    },

    resume() {
      if (unmounted) return;
      paused = false;
      if (auto && !rafId) {
        lastTs = 0;
        rafId = requestAnimationFrame(tick);
      }
    },

    onTheme() { /* no-op — pure CSS-Vars. */ },

    onAnswer() { /* explorativ — kein Bewertungs-Hook. */ },

    getState() {
      return { theta, showSin, showCos, auto, snap };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      cancelAuto();
      if (typeof s.theta === 'number') setTheta(s.theta);
      if (typeof s.showSin === 'boolean') { showSin = s.showSin; updateSinVisibility(); }
      if (typeof s.showCos === 'boolean') { showCos = s.showCos; updateCosVisibility(); }
      if (typeof s.snap === 'boolean') { snap = s.snap; updateSnapBtn(); }
      if (s.auto === true && !reducedMotion) startAuto();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'unit-circle-sync',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'unit-circle-sync', mount };
export { mount };
