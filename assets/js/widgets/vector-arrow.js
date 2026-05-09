// ══════════════════════════════════════════
//  LearningForge — Widget: vector-arrow
//  2 Vektoren + Resultierender (Welle 3.4, Size S)
//  (siehe Plan 2026-05-09-interaktiv-ausbau.md, W3.4)
// ══════════════════════════════════════════
//
// Canvas2D-Sandbox: Achsenkreuz mit Gitter (-5..5), 2 Vektoren a (rot) und
// b (blau) aus dem Ursprung. Endpunkte drag-bar. Resultierender Vektor
// a+b (gruen, dicker) live, Parallelogramm gestrichelt. Live-Werte:
// |a|, |b|, |a+b|, ∠(a,b). Pure Canvas2D — onTheme=redraw, kein RAF.
//
// Config: { label, initialA:{x,y}, initialB:{x,y}, gridSize, snapToGrid }

const W_RANGE = 5;
const HIT_R = 14;
const ARROW_HEAD = 10;
const DEF_A = { x: 3, y: 1 };
const DEF_B = { x: 1, y: 2 };

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function _dpr() { return window.devicePixelRatio || 1; }
function _fitCanvas(canvas, cssW, cssH) {
  const r = _dpr();
  canvas.width = Math.round(cssW * r);
  canvas.height = Math.round(cssH * r);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(r, 0, 0, r, 0, 0);
  return ctx;
}
// Theme-Reader mit Fallback. Pro Frame OK (Custom-Props, kein Layout-Thrash).
function _theme(name, fb) {
  const css = getComputedStyle(document.documentElement);
  let v = css.getPropertyValue('--lf-va-' + name).trim();
  if (!v && fb) v = css.getPropertyValue('--' + fb).trim();
  return v || '#888';
}
function _clamp(v) {
  if (!isFinite(v)) return 0;
  return v > W_RANGE ? W_RANGE : v < -W_RANGE ? -W_RANGE : v;
}

function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) {
    return { widgetType: 'vector-arrow', unmount(){}, pause(){}, resume(){}, onTheme(){}, onAnswer(){}, getState(){return{};}, setState(){} };
  }
  config = config || {};

  const initA = (config.initialA && typeof config.initialA === 'object') ? config.initialA : DEF_A;
  const initB = (config.initialB && typeof config.initialB === 'object') ? config.initialB : DEF_B;
  let ax = _clamp(+initA.x || 0), ay = _clamp(+initA.y || 0);
  let bx = _clamp(+initB.x || 0), by = _clamp(+initB.y || 0);
  let snap = config.snapToGrid === true;
  const gridSize = (typeof config.gridSize === 'number' && config.gridSize > 0) ? config.gridSize : 1;
  const label = (typeof config.label === 'string' && config.label) ? config.label : 'Vektoraddition';

  let unmounted = false;
  let dragging = null;

  container.innerHTML = '';
  const host = _el('div', 'lf-widget-physics-throw lf-va-host physik-sim');
  container.append(host);
  try { container.setAttribute('aria-label', 'Vektoraddition: zwei Vektoren ziehen, Resultierender wird live berechnet'); } catch (e) {}

  const titleEl = _el('div', 'lf-va-title');
  titleEl.textContent = label;
  host.append(titleEl);

  const canvas = _el('canvas', 'sim-canvas lf-va-canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Vektor-Sandbox: 2D-Gitter mit zwei ziehbaren Vektoren');
  canvas.setAttribute('tabindex', '0');
  host.append(canvas);

  const W_DEFAULT = Math.min(host.clientWidth || 320, 360);
  let W = W_DEFAULT, H = W_DEFAULT;
  let ctx = _fitCanvas(canvas, W, H);

  // ── Controls ──────────────────────────────────────────
  const controls = _el('div', 'sim-controls lf-va-controls');

  const inputs = _el('div', 'lf-va-inputs');
  // Number-Inputs als Tab-Alternative; je 4 Stueck (a.x/a.y/b.x/b.y).
  const inpEls = {};
  function _addInput(lbl, key, isA) {
    const wrap = _el('label', 'lf-va-num ' + (isA ? 'lf-va-num-a' : 'lf-va-num-b'));
    wrap.append(document.createTextNode(lbl));
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = String(gridSize);
    inp.min = String(-W_RANGE); inp.max = String(W_RANGE);
    inp.className = 'lf-va-num-input';
    inp.addEventListener('input', () => {
      const v = _clamp(parseFloat(inp.value) || 0);
      if (key === 'ax') ax = v; else if (key === 'ay') ay = v;
      else if (key === 'bx') bx = v; else by = v;
      draw(); updateLive();
    });
    wrap.append(inp);
    inputs.append(wrap);
    inpEls[key] = inp;
  }
  _addInput('a.x', 'ax', true);
  _addInput('a.y', 'ay', true);
  _addInput('b.x', 'bx', false);
  _addInput('b.y', 'by', false);
  controls.append(inputs);

  const live = _el('div', 'sim-readout lf-va-live');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  controls.append(live);

  const btnRow = _el('div', 'sim-btn-row lf-va-btn-row');
  const snapBtn = _el('button', 'sim-btn lf-va-btn');
  snapBtn.type = 'button';
  snapBtn.addEventListener('click', () => {
    snap = !snap;
    if (snap) { ax = Math.round(ax); ay = Math.round(ay); bx = Math.round(bx); by = Math.round(by); syncInputs(); }
    updateSnapBtn(); draw(); updateLive();
  });
  const resetBtn = _el('button', 'sim-btn lf-va-btn', '↺ Reset');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    ax = _clamp(+initA.x || 0); ay = _clamp(+initA.y || 0);
    bx = _clamp(+initB.x || 0); by = _clamp(+initB.y || 0);
    syncInputs(); draw(); updateLive();
  });
  btnRow.append(snapBtn, resetBtn);
  controls.append(btnRow);
  host.append(controls);

  // ── Welt → CSS-px-Mapping ─────────────────────────────
  function _scale() { return (Math.min(W, H) / 2 - 18) / W_RANGE; }
  function wToPx(wx, wy) {
    const s = _scale();
    return { x: W / 2 + wx * s, y: H / 2 - wy * s };
  }
  function pxToW(px, py) {
    const s = _scale();
    return { x: (px - W / 2) / s, y: (H / 2 - py) / s };
  }

  // ── Draw ──────────────────────────────────────────────
  function draw() {
    if (unmounted) return;
    ctx.clearRect(0, 0, W, H);
    const colBg = _theme('bg', 'bg-card');
    const colGrid = _theme('grid', 'border');
    const colAxis = _theme('axis', 'text-muted');
    const colA = _theme('vec-a', null);
    const colB = _theme('vec-b', null);
    const colR = _theme('vec-result', 'accent');
    const colPar = _theme('parallel', 'text-muted');

    ctx.fillStyle = colBg;
    ctx.fillRect(0, 0, W, H);

    // Gitter.
    ctx.strokeStyle = colGrid;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (let v = -W_RANGE; v <= W_RANGE; v += gridSize) {
      const p1 = wToPx(v, -W_RANGE), p2 = wToPx(v, W_RANGE);
      ctx.moveTo(p1.x + 0.5, p1.y); ctx.lineTo(p2.x + 0.5, p2.y);
      const p3 = wToPx(-W_RANGE, v), p4 = wToPx(W_RANGE, v);
      ctx.moveTo(p3.x, p3.y + 0.5); ctx.lineTo(p4.x, p4.y + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Achsen + Beschriftung.
    const ox = W / 2, oy = H / 2;
    ctx.strokeStyle = colAxis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8, oy); ctx.lineTo(W - 8, oy);
    ctx.moveTo(ox, 8); ctx.lineTo(ox, H - 8);
    ctx.stroke();

    ctx.fillStyle = colAxis;
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText('x', W - 6, oy + 4);
    ctx.textAlign = 'left';
    ctx.fillText('y', ox + 4, 6);

    // Tick-Beschriftung an ±W_RANGE-Endpunkten.
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    const xR = wToPx(W_RANGE, 0), xL = wToPx(-W_RANGE, 0);
    ctx.fillText(String(W_RANGE), xR.x, oy + 6);
    ctx.fillText(String(-W_RANGE), xL.x, oy + 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const yT = wToPx(0, W_RANGE), yB = wToPx(0, -W_RANGE);
    ctx.fillText(String(W_RANGE), ox - 6, yT.y);
    ctx.fillText(String(-W_RANGE), ox - 6, yB.y);

    // Resultierender = a + b.
    const rx = ax + bx, ry = ay + by;
    const pA = wToPx(ax, ay), pB = wToPx(bx, by), pR = wToPx(rx, ry);
    const pO = wToPx(0, 0);

    // Parallelogramm gestrichelt: a→r und b→r.
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = colPar;
    ctx.lineWidth = 1.25;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(pA.x, pA.y); ctx.lineTo(pR.x, pR.y);
    ctx.moveTo(pB.x, pB.y); ctx.lineTo(pR.x, pR.y);
    ctx.stroke();
    ctx.restore();

    // Vektoren als Pfeile mit Endpunkt-Griff (drag-Hint).
    _arrow(pO, pA, colA, 2.5, true);
    _arrow(pO, pB, colB, 2.5, true);
    _arrow(pO, pR, colR, 3.5, false);

    // Origin.
    ctx.fillStyle = colAxis;
    ctx.beginPath();
    ctx.arc(pO.x, pO.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pfeil mit optionalem Endpunkt-Griff (Kreis am Spitzenende).
  function _arrow(p1, p2, color, lineW, handle) {
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len >= 4) {
      const ux = dx / len, uy = dy / len;
      const hx = p2.x - ux * ARROW_HEAD, hy = p2.y - uy * ARROW_HEAD;
      const w = ARROW_HEAD * 0.45;
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(hx - uy * w, hy + ux * w);
      ctx.lineTo(hx + uy * w, hy - ux * w);
      ctx.closePath();
      ctx.fill();
    }
    if (handle) {
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Drag-Handling ─────────────────────────────────────
  function _hit(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const pA = wToPx(ax, ay), pB = wToPx(bx, by);
    const dA = Math.hypot(px - pA.x, py - pA.y);
    const dB = Math.hypot(px - pB.x, py - pB.y);
    if (dA <= HIT_R && dA <= dB) return 'a';
    if (dB <= HIT_R) return 'b';
    return null;
  }
  function _setVecFromPx(which, px, py) {
    const w = pxToW(px, py);
    let nx = _clamp(w.x), ny = _clamp(w.y);
    if (snap) { nx = Math.round(nx); ny = Math.round(ny); }
    if (which === 'a') { ax = nx; ay = ny; } else { bx = nx; by = ny; }
  }
  function onPointerDown(e) {
    const which = _hit(e.clientX, e.clientY);
    if (!which) return;
    dragging = which;
    try { canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!dragging) {
      canvas.style.cursor = _hit(e.clientX, e.clientY) ? 'grab' : 'crosshair';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    _setVecFromPx(dragging, e.clientX - rect.left, e.clientY - rect.top);
    syncInputs(); draw(); updateLive();
  }
  function onPointerUp(e) {
    if (!dragging) return;
    dragging = null;
    try { canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    canvas.style.cursor = 'crosshair';
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.style.cursor = 'crosshair';

  // ── Live-Readout ──────────────────────────────────────
  function updateLive() {
    const rx = ax + bx, ry = ay + by;
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lr = Math.hypot(rx, ry);
    let angDeg = NaN;
    if (la > 1e-9 && lb > 1e-9) {
      const cosT = (ax * bx + ay * by) / (la * lb);
      angDeg = Math.acos(Math.max(-1, Math.min(1, cosT))) * 180 / Math.PI;
    }
    const f = v => v.toFixed(2);
    live.innerHTML =
        '<span class="lf-va-rd lf-va-rd-a">|a| = <b>' + f(la) + '</b></span>'
      + '<span class="lf-va-rd lf-va-rd-b">|b| = <b>' + f(lb) + '</b></span>'
      + '<span class="lf-va-rd lf-va-rd-r">|a+b| = <b>' + f(lr) + '</b></span>'
      + '<span class="lf-va-rd">∠(a,b) = <b>' + (isNaN(angDeg) ? '—' : angDeg.toFixed(1) + '°') + '</b></span>';
  }
  function syncInputs() {
    inpEls.ax.value = String(ax);
    inpEls.ay.value = String(ay);
    inpEls.bx.value = String(bx);
    inpEls.by.value = String(by);
  }
  function updateSnapBtn() {
    snapBtn.textContent = (snap ? '✓ ' : '') + 'Snap zum Gitter';
    snapBtn.setAttribute('aria-pressed', snap ? 'true' : 'false');
  }

  // ── Resize ────────────────────────────────────────────
  function onResize() {
    if (unmounted) return;
    const next = Math.min(host.clientWidth || W_DEFAULT, 360);
    if (Math.abs(next - W) < 2) return;
    W = next; H = next;
    ctx = _fitCanvas(canvas, W, H);
    draw();
  }
  window.addEventListener('resize', onResize);

  // Initial.
  syncInputs();
  updateSnapBtn();
  draw();
  updateLive();

  return {
    widgetType: 'vector-arrow',
    unmount() {
      if (unmounted) return;
      unmounted = true;
      try {
        canvas.removeEventListener('pointerdown', onPointerDown);
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerup', onPointerUp);
        canvas.removeEventListener('pointercancel', onPointerUp);
        window.removeEventListener('resize', onResize);
      } catch (e) {}
    },
    pause() {}, resume() {},
    onTheme() { if (!unmounted) draw(); },
    onAnswer() {},
    getState() { return { ax, ay, bx, by, snap }; },
    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.ax === 'number') ax = _clamp(s.ax);
      if (typeof s.ay === 'number') ay = _clamp(s.ay);
      if (typeof s.bx === 'number') bx = _clamp(s.bx);
      if (typeof s.by === 'number') by = _clamp(s.by);
      if (typeof s.snap === 'boolean') snap = s.snap;
      syncInputs(); updateSnapBtn(); draw(); updateLive();
    }
  };
}

export default { widgetType: 'vector-arrow', mount };
export { mount };
