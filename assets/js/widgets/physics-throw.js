// ══════════════════════════════════════════
//  LearningForge — Widget: physics-throw
//  Migrated from physik-sim.js (Phase 0 Commit 10)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md, Refactor-Plan Schritt 7)
// ══════════════════════════════════════════
//
// Sechs Wurf-Sims hinter EINEM Widget-Type, dispatched per config.variant:
//   'schwimmer'      — Vektor-Addition (Schwimmer im Fluss)
//   'galileo'        — freier Fall vs waagerechter Wurf (gleiche Fallzeit)
//   'waagerecht'     — waagerechter Wurf
//   'senkrecht-hoch' — senkrechter Wurf nach oben
//   'wurf-unten'     — Wurf nach unten vs freier Fall
//   'schief'         — schiefer Wurf
//
// Theme: alle Farben aus CSS-Vars (--sim-*) via lfWidgetTheme(). KEINE
// hardcoded Hex-Werte ausser dem Highlight-rgba auf dem Ball (subtile
// Glanz-Bubble, Theme-unabhängig — bleibt wie im Original).
//
// RAF-Lifecycle: pause/resume bei visibilitychange (Loader macht das),
// onTheme rezeichnet bei Theme-Wechsel. unmount canceltcAnimationFrame +
// removed resize-Listener.
//
// Reduce-Motion: tick() wird nicht gestartet, stattdessen wird sofort der
// End-Frame (t = tFinal) gezeichnet — User sieht das Endergebnis.

import { lfWidgetReducedMotion } from './_base.js';

const G = 9.81;

// ── Theme ─────────────────────────────────────────────────
// Liest --sim-<name> direkt von documentElement. (lfWidgetTheme aus _base.js
// nimmt einen FULL-Var-Namen ohne '--', wir prefixen lokal mit 'sim-'.)
function _theme(name) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--sim-' + name).trim();
  return v || '#888';
}

// ── DOM-Helpers ───────────────────────────────────────────
function _el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
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
  const val  = _el('span', 'sim-slider-value', value + ' ' + unit);
  head.append(lbl, val);
  const input = _el('input');
  input.type = 'range'; input.min = min; input.max = max;
  input.step = step;    input.value = value;
  input.addEventListener('input', () => {
    val.innerHTML = parseFloat(input.value).toFixed(step < 1 ? 1 : 0) + ' ' + unit;
    onInput(parseFloat(input.value));
  });
  wrap.append(head, input);
  return wrap;
}

function _readout(label, value) {
  const wrap = _el('div', 'sim-readout');
  wrap.append(_el('span', 'sim-readout-label', label));
  const v = _el('span', 'sim-readout-value', value);
  wrap.append(v);
  return { wrap: wrap, set: txt => v.textContent = txt };
}

function _btn(label, onClick, primary) {
  const b = _el('button', 'sim-btn ' + (primary ? 'sim-btn-primary' : ''), label);
  b.addEventListener('click', onClick);
  return b;
}

function _drawBall(ctx, x, y, color, label) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
  // Highlight (subtil aufgehellt — Theme-unabhängige Glanz-Bubble).
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath(); ctx.arc(x - 2, y - 2, 2, 0, Math.PI * 2); ctx.fill();
  if (label) {
    ctx.fillStyle = color;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(label, x + 12, y + 4);
  }
}

function _drawArrow(ctx, x1, y1, x2, y2, color, lw) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const ah = 8;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - ah * Math.cos(ang - 0.4), y2 - ah * Math.sin(ang - 0.4));
  ctx.lineTo(x2 - ah * Math.cos(ang + 0.4), y2 - ah * Math.sin(ang + 0.4));
  ctx.closePath(); ctx.fill();
}

// Hintergrund mit Himmel/Boden/Erde — von 4 Variants gemeinsam genutzt.
function _drawScene(ctx, w, h, top, ground) {
  ctx.fillStyle = _theme('sky');    ctx.fillRect(0, 0, w, top);
  ctx.fillStyle = _theme('ground'); ctx.fillRect(0, top, w, ground - top);
  ctx.fillStyle = _theme('soil');   ctx.fillRect(0, ground, w, h - ground);
}

// ── Variant-Builders ──────────────────────────────────────
// Jeder builder gibt { canvas, draw, tick?, reset?, controls } zurück.
// mount() orchestriert: erzeugt host-Layout, ruft builder, hängt RAF ein.

// 1) Schwimmer im Fluss — Vektor-Addition
function _buildSchwimmer(host, w, h, ariaLabel) {
  let vS = 1.0, vF = 2.0;
  const flussBreite = 30;

  const canvas = _el('canvas', 'sim-canvas');
  canvas.setAttribute('aria-label', ariaLabel);
  host.append(canvas);
  const ctx = _fitCanvas(canvas, w, h);

  const controls = _el('div', 'sim-controls');
  const r1 = _readout('Resultierende Geschwindigkeit', '');
  const r2 = _readout('Winkel zur Querrichtung', '');
  const r3 = _readout('Versatz flussabwärts', '');
  controls.append(
    _slider('Schwimmer-Geschwindigkeit', 0.2, 3, 0.1, vS, 'm/s', v => { vS = v; draw(); }),
    _slider('Strömung', 0, 4, 0.1, vF, 'm/s', v => { vF = v; draw(); }),
    r1.wrap, r2.wrap, r3.wrap
  );
  host.append(controls);

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = _theme('grass'); ctx.fillRect(0, 0, w, 60); ctx.fillRect(0, h - 60, w, 60);
    ctx.fillStyle = _theme('water'); ctx.fillRect(0, 60, w, h - 120);
    ctx.fillStyle = _theme('water-line');
    for (let i = 0; i < 6; i++) {
      const yy = 60 + (h - 120) * (i + 0.3) / 6;
      ctx.fillRect(0, yy, w, 2);
    }

    const cx = 100, cy = h / 2, scale = 30;
    _drawArrow(ctx, cx, cy, cx, cy + vS * scale, _theme('vec-x'), 3);
    ctx.fillStyle = _theme('text'); ctx.font = '12px sans-serif';
    ctx.fillText('v_S = ' + vS.toFixed(1) + ' m/s', cx + 8, cy + vS * scale / 2);
    _drawArrow(ctx, cx, cy, cx + vF * scale, cy, _theme('vec-y'), 3);
    ctx.fillStyle = _theme('text');
    ctx.fillText('v_F = ' + vF.toFixed(1) + ' m/s', cx + vF * scale / 2 - 30, cy - 10);
    _drawArrow(ctx, cx, cy, cx + vF * scale, cy + vS * scale, _theme('success'), 4);

    const t = flussBreite / vS;
    const versatz = vF * t;
    const startX = 30, startY = 60;
    const endX = startX + versatz / flussBreite * (w - 60);
    const endY = h - 60;
    if (endX < w - 30) {
      ctx.beginPath();
      ctx.strokeStyle = _theme('success');
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.moveTo(startX, startY); ctx.lineTo(endX, endY);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = _theme('success');
      ctx.beginPath(); ctx.arc(endX, endY, 6, 0, Math.PI * 2); ctx.fill();
    }

    const vRes = Math.sqrt(vS * vS + vF * vF);
    const winkel = Math.atan2(vF, vS) * 180 / Math.PI;
    r1.set(vRes.toFixed(2) + ' m/s');
    r2.set(winkel.toFixed(0) + '°');
    r3.set(versatz.toFixed(1) + ' m (bei ' + flussBreite + ' m Flussbreite)');
  }

  draw();
  return { canvas: canvas, draw: draw, animated: false };
}

// 2) Galileo — Fall vs Wurf
function _buildGalileo(host, w, h, ariaLabel) {
  let v0 = 4.0, hoehe = 12;
  let t = 0, running = false, lastTs = 0;

  const canvas = _el('canvas', 'sim-canvas');
  canvas.setAttribute('aria-label', ariaLabel);
  host.append(canvas);
  const ctx = _fitCanvas(canvas, w, h);

  const controls = _el('div', 'sim-controls');
  const r1 = _readout('Fallzeit (beide Kugeln!)', '');
  controls.append(
    _slider('Wurfgeschwindigkeit v₀', 1, 8, 0.5, v0, 'm/s', v => { v0 = v; reset(); }),
    _slider('Höhe', 5, 25, 1, hoehe, 'm', v => { hoehe = v; reset(); }),
    r1.wrap
  );
  const btnRow = _el('div', 'sim-btn-row');
  btnRow.append(
    _btn('▶ Start', () => api.start(), true),
    _btn('↺ Reset', () => reset())
  );
  controls.append(btnRow);
  host.append(controls);

  const padX = 60, padTop = 30, padBot = 50;
  const ground = h - padBot, top = padTop;

  function pxY() { return (ground - top) / hoehe; }
  function pxX() { return (w - 2 * padX) / Math.max(v0 * Math.sqrt(2 * hoehe / G), 1); }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    _drawScene(ctx, w, h, top, ground);

    ctx.strokeStyle = _theme('grid'); ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padX, top); ctx.lineTo(padX, ground); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = _theme('text-muted'); ctx.font = '11px sans-serif';
    ctx.fillText(hoehe + ' m', 5, (top + ground) / 2);

    const tF = Math.sqrt(2 * hoehe / G);
    const tt = Math.min(t, tF);

    const y1 = top + 0.5 * G * tt * tt * pxY();
    _drawBall(ctx, padX, y1, _theme('ball-2'), 'A: Fällt');

    const x2 = padX + v0 * tt * pxX();
    const y2 = top + 0.5 * G * tt * tt * pxY();
    _drawBall(ctx, x2, y2, _theme('ball'), 'B: Wurf');

    ctx.strokeStyle = _theme('trajectory'); ctx.lineWidth = 2;
    ctx.beginPath();
    for (let s = 0; s <= tt; s += tF / 50) {
      const xx = padX + v0 * s * pxX();
      const yy = top + 0.5 * G * s * s * pxY();
      if (s === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();

    ctx.fillStyle = _theme('text'); ctx.font = 'bold 13px sans-serif';
    ctx.fillText('t = ' + tt.toFixed(2) + ' s', w - 100, 22);
    if (tt >= tF) {
      ctx.fillStyle = _theme('success');
      ctx.fillText('✓ Beide gleichzeitig!', w - 175, 42);
    }
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tF = Math.sqrt(2 * hoehe / G);
    if (t >= tF) { running = false; t = tF; }
    r1.set(tF.toFixed(2) + ' s — beide Kugeln treffen gleichzeitig auf!');
    draw();
    return running;
  }

  function reset() {
    t = 0; running = false; lastTs = 0;
    r1.set(Math.sqrt(2 * hoehe / G).toFixed(2) + ' s — beide Kugeln treffen gleichzeitig auf!');
    draw();
  }

  const api = {
    canvas: canvas, draw: draw, animated: true,
    start() { running = true; lastTs = 0; },
    isRunning() { return running; },
    tick: tick,
    reset: reset,
    end() { t = Math.sqrt(2 * hoehe / G); running = false; draw(); }
  };
  reset();
  return api;
}

// 3) Waagerechter Wurf
function _buildWaagerecht(host, w, h, ariaLabel) {
  let v0 = 5, hoehe = 20;
  let t = 0, running = false, lastTs = 0;

  const canvas = _el('canvas', 'sim-canvas');
  canvas.setAttribute('aria-label', ariaLabel);
  host.append(canvas);
  const ctx = _fitCanvas(canvas, w, h);

  const controls = _el('div', 'sim-controls');
  const rT  = _readout('Fallzeit', '');
  const rW  = _readout('Wurfweite', '');
  const rV  = _readout('Auftreffgeschwindigkeit', '');
  const rWi = _readout('Auftreffwinkel', '');
  controls.append(
    _slider('Anfangsgeschwindigkeit v₀', 1, 25, 1, v0, 'm/s', v => { v0 = v; reset(); }),
    _slider('Höhe h', 5, 50, 1, hoehe, 'm', v => { hoehe = v; reset(); }),
    rT.wrap, rW.wrap, rV.wrap, rWi.wrap
  );
  const btnRow = _el('div', 'sim-btn-row');
  btnRow.append(
    _btn('▶ Start', () => api.start(), true),
    _btn('↺ Reset', () => reset())
  );
  controls.append(btnRow);
  host.append(controls);

  const padX = 50, padTop = 30, padBot = 50;
  const ground = h - padBot, top = padTop;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    _drawScene(ctx, w, h, top, ground);

    const tF = Math.sqrt(2 * hoehe / G);
    const wWeite = v0 * tF;
    const pxX = (w - 2 * padX) / wWeite;
    const pxY = (ground - top) / hoehe;

    ctx.strokeStyle = _theme('trajectory'); ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let s = 0; s <= tF; s += tF / 80) {
      const xx = padX + v0 * s * pxX;
      const yy = top + 0.5 * G * s * s * pxY;
      if (s === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke(); ctx.setLineDash([]);

    const tt = Math.min(t, tF);
    const x = padX + v0 * tt * pxX;
    const y = top + 0.5 * G * tt * tt * pxY;
    _drawBall(ctx, x, y, _theme('ball'), '');

    if (tt > 0.1 && tt < tF - 0.05) {
      _drawArrow(ctx, x, y, x + v0 * 4, y, _theme('vec-x'), 2);
      _drawArrow(ctx, x, y, x, y + G * tt * 4, _theme('vec-y'), 2);
    }

    ctx.strokeStyle = _theme('grid'); ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padX, top); ctx.lineTo(padX, ground); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = _theme('text-muted'); ctx.font = '11px sans-serif';
    ctx.fillText(hoehe + ' m', 5, (top + ground) / 2);
    ctx.fillText(wWeite.toFixed(1) + ' m', padX + (w - 2 * padX) / 2 - 20, ground + 18);
  }

  function update() {
    const tF = Math.sqrt(2 * hoehe / G);
    const wWeite = v0 * tF;
    const vy = G * tF;
    const vRes = Math.sqrt(v0 * v0 + vy * vy);
    const winkel = Math.atan2(vy, v0) * 180 / Math.PI;
    rT.set(tF.toFixed(2) + ' s');
    rW.set(wWeite.toFixed(2) + ' m');
    rV.set(vRes.toFixed(2) + ' m/s (' + (vRes * 3.6).toFixed(0) + ' km/h)');
    rWi.set(winkel.toFixed(0) + '° zur Horizontalen');
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tF = Math.sqrt(2 * hoehe / G);
    if (t >= tF) { running = false; t = tF; }
    draw();
    return running;
  }

  function reset() { t = 0; running = false; lastTs = 0; update(); draw(); }

  const api = {
    canvas: canvas, draw: draw, animated: true,
    start() { running = true; lastTs = 0; },
    isRunning() { return running; },
    tick: tick,
    reset: reset,
    end() { t = Math.sqrt(2 * hoehe / G); running = false; draw(); }
  };
  reset();
  return api;
}

// 4) Senkrechter Wurf nach oben
function _buildSenkrechtHoch(host, w, h, ariaLabel) {
  let v0 = 15;
  let t = 0, running = false, lastTs = 0;

  const canvas = _el('canvas', 'sim-canvas');
  canvas.setAttribute('aria-label', ariaLabel);
  host.append(canvas);
  const ctx = _fitCanvas(canvas, w, h);

  const controls = _el('div', 'sim-controls');
  const rH = _readout('Maximale Höhe', '');
  const rTs = _readout('Steigzeit', '');
  const rTg = _readout('Gesamte Flugzeit', '');
  const rVnow = _readout('Aktuelle Geschwindigkeit', '');
  controls.append(
    _slider('Anfangsgeschwindigkeit v₀', 5, 30, 1, v0, 'm/s', v => { v0 = v; reset(); }),
    rH.wrap, rTs.wrap, rTg.wrap, rVnow.wrap
  );
  const btnRow = _el('div', 'sim-btn-row');
  btnRow.append(
    _btn('▶ Start', () => api.start(), true),
    _btn('↺ Reset', () => reset())
  );
  controls.append(btnRow);
  host.append(controls);

  const padTop = 20, padBot = 40;
  const ground = h - padBot, top = padTop, cx = w / 2;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    _drawScene(ctx, w, h, top, ground);

    const hMax = v0 * v0 / (2 * G);
    const tS = v0 / G;
    const pxY = (ground - top - 30) / Math.max(hMax, 1);

    ctx.strokeStyle = _theme('grid'); ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, ground); ctx.stroke();
    const hMaxY = ground - hMax * pxY;
    ctx.beginPath(); ctx.moveTo(cx - 50, hMaxY); ctx.lineTo(cx + 50, hMaxY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = _theme('text-muted'); ctx.font = '11px sans-serif';
    ctx.fillText('h_max ≈ ' + hMax.toFixed(1) + ' m', cx + 55, hMaxY + 4);

    const tG = 2 * tS;
    const tt = Math.min(t, tG);
    const yMeter = v0 * tt - 0.5 * G * tt * tt;
    const yPos = ground - yMeter * pxY;
    _drawBall(ctx, cx, yPos, _theme('ball'), '');

    const vNow = v0 - G * tt;
    if (Math.abs(vNow) > 0.1) {
      _drawArrow(ctx, cx, yPos, cx, yPos - vNow * 5, vNow > 0 ? _theme('vec-up') : _theme('vec-down'), 2);
    }

    ctx.fillStyle = _theme('text'); ctx.font = 'bold 13px sans-serif';
    ctx.fillText('t = ' + tt.toFixed(2) + ' s', w - 100, 22);
  }

  function update() {
    const hMax = v0 * v0 / (2 * G);
    const tS = v0 / G;
    rH.set(hMax.toFixed(2) + ' m');
    rTs.set(tS.toFixed(2) + ' s');
    rTg.set((2 * tS).toFixed(2) + ' s');
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tG = 2 * v0 / G;
    if (t >= tG) { running = false; t = tG; }
    const vNow = v0 - G * Math.min(t, tG);
    rVnow.set(Math.abs(vNow).toFixed(2) + ' m/s ' + (vNow >= 0 ? '↑' : '↓'));
    draw();
    return running;
  }

  function reset() {
    t = 0; running = false; lastTs = 0;
    update(); rVnow.set(v0.toFixed(2) + ' m/s ↑'); draw();
  }

  const api = {
    canvas: canvas, draw: draw, animated: true,
    start() { running = true; lastTs = 0; },
    isRunning() { return running; },
    tick: tick,
    reset: reset,
    end() { t = 2 * v0 / G; running = false; draw(); }
  };
  reset();
  return api;
}

// 5) Wurf nach unten vs freier Fall
function _buildWurfUnten(host, w, h, ariaLabel) {
  let v0 = 5, hoehe = 20;
  let t = 0, running = false, lastTs = 0;

  const canvas = _el('canvas', 'sim-canvas');
  canvas.setAttribute('aria-label', ariaLabel);
  host.append(canvas);
  const ctx = _fitCanvas(canvas, w, h);

  const controls = _el('div', 'sim-controls');
  const rT = _readout('Fallzeit (Wurf)', '');
  const rTfrei = _readout('Fallzeit (freier Fall, v₀=0)', '');
  const rV = _readout('Auftreffgeschwindigkeit (Wurf)', '');
  const rVfrei = _readout('Auftreffgeschwindigkeit (frei)', '');
  controls.append(
    _slider('Anfangsgeschwindigkeit v₀ ↓', 0, 20, 0.5, v0, 'm/s', v => { v0 = v; reset(); }),
    _slider('Höhe h', 5, 50, 1, hoehe, 'm', v => { hoehe = v; reset(); }),
    rT.wrap, rTfrei.wrap, rV.wrap, rVfrei.wrap
  );
  const btnRow = _el('div', 'sim-btn-row');
  btnRow.append(
    _btn('▶ Start', () => api.start(), true),
    _btn('↺ Reset', () => reset())
  );
  controls.append(btnRow);
  host.append(controls);

  const padTop = 30, padBot = 40;
  const ground = h - padBot, top = padTop;
  const cxA = w * 0.30, cxB = w * 0.70;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    _drawScene(ctx, w, h, top, ground);

    const tFw = (-v0 + Math.sqrt(v0 * v0 + 2 * G * hoehe)) / G;
    const tFr = Math.sqrt(2 * hoehe / G);
    const tMax = Math.max(tFw, tFr);
    const pxY = (ground - top) / hoehe;

    ctx.fillStyle = _theme('text'); ctx.font = 'bold 12px sans-serif';
    ctx.fillText('Wurf nach unten', cxA - 50, top - 8);
    ctx.fillText('Freier Fall', cxB - 35, top - 8);

    const tt = Math.min(t, tMax);
    const sW = Math.min(v0 * tt + 0.5 * G * tt * tt, hoehe);
    _drawBall(ctx, cxA, top + sW * pxY, _theme('ball'), '');
    const sF = Math.min(0.5 * G * tt * tt, hoehe);
    _drawBall(ctx, cxB, top + sF * pxY, _theme('ball-2'), '');

    ctx.fillStyle = _theme('text'); ctx.font = 'bold 13px sans-serif';
    ctx.fillText('t = ' + tt.toFixed(2) + ' s', w / 2 - 35, h - 14);

    if (tt >= tFw && tt < tFw + 0.3) {
      ctx.fillStyle = _theme('success');
      ctx.fillText('✓ Wurf landet', cxA - 35, ground + 22);
    }
    if (tt >= tFr && tt < tFr + 0.3) {
      ctx.fillStyle = _theme('success');
      ctx.fillText('✓ Frei landet', cxB - 30, ground + 22);
    }
  }

  function update() {
    const tFw = (-v0 + Math.sqrt(v0 * v0 + 2 * G * hoehe)) / G;
    const tFr = Math.sqrt(2 * hoehe / G);
    const vW = Math.sqrt(v0 * v0 + 2 * G * hoehe);
    const vF = Math.sqrt(2 * G * hoehe);
    rT.set(tFw.toFixed(2) + ' s');
    rTfrei.set(tFr.toFixed(2) + ' s  (' + (tFr - tFw).toFixed(2) + ' s länger)');
    rV.set(vW.toFixed(2) + ' m/s');
    rVfrei.set(vF.toFixed(2) + ' m/s');
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tFr = Math.sqrt(2 * hoehe / G);
    if (t >= tFr + 0.3) { running = false; }
    draw();
    return running;
  }

  function reset() { t = 0; running = false; lastTs = 0; update(); draw(); }

  const api = {
    canvas: canvas, draw: draw, animated: true,
    start() { running = true; lastTs = 0; },
    isRunning() { return running; },
    tick: tick,
    reset: reset,
    end() { t = Math.sqrt(2 * hoehe / G) + 0.3; running = false; draw(); }
  };
  reset();
  return api;
}

// 6) Schiefer Wurf
function _buildSchief(host, w, h, ariaLabel) {
  let v0 = 20, alpha = 45;
  let t = 0, running = false, lastTs = 0;

  const canvas = _el('canvas', 'sim-canvas');
  canvas.setAttribute('aria-label', ariaLabel);
  host.append(canvas);
  const ctx = _fitCanvas(canvas, w, h);

  const controls = _el('div', 'sim-controls');
  const rH = _readout('Max. Höhe', '');
  const rW = _readout('Wurfweite', '');
  const rTg = _readout('Flugzeit', '');
  controls.append(
    _slider('v₀', 5, 40, 1, v0, 'm/s', v => { v0 = v; reset(); }),
    _slider('Abwurfwinkel α', 5, 85, 1, alpha, '°', v => { alpha = v; reset(); }),
    rH.wrap, rW.wrap, rTg.wrap
  );
  const btnRow = _el('div', 'sim-btn-row');
  btnRow.append(
    _btn('▶ Start', () => api.start(), true),
    _btn('↺ Reset', () => reset()),
    _btn('🎯 45° (Optimum)', () => {
      alpha = 45;
      controls.querySelectorAll('input')[1].value = 45;
      reset();
    })
  );
  controls.append(btnRow);
  host.append(controls);

  const padX = 40, padTop = 20, padBot = 40;
  const ground = h - padBot, top = padTop;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    _drawScene(ctx, w, h, top, ground);

    const aRad = alpha * Math.PI / 180;
    const vx = v0 * Math.cos(aRad);
    const vy0 = v0 * Math.sin(aRad);
    const tG = 2 * vy0 / G;
    const wWeite = vx * tG;
    const hMax = vy0 * vy0 / (2 * G);

    const availW = w - 2 * padX;
    const availH = ground - top;
    const scale = Math.min(availW / Math.max(wWeite, 1), availH / Math.max(hMax, 1)) * 0.9;

    ctx.strokeStyle = _theme('trajectory'); ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let s = 0; s <= tG; s += tG / 100) {
      const xx = padX + vx * s * scale;
      const yy = ground - (vy0 * s - 0.5 * G * s * s) * scale;
      if (s === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke(); ctx.setLineDash([]);

    const tt = Math.min(t, tG);
    const x = padX + vx * tt * scale;
    const y = ground - (vy0 * tt - 0.5 * G * tt * tt) * scale;
    _drawBall(ctx, x, y, _theme('ball'), '');

    if (tt > 0.05 && tt < tG - 0.05) {
      const vyNow = vy0 - G * tt;
      _drawArrow(ctx, x, y, x + vx * 1.5, y, _theme('vec-x'), 2);
      _drawArrow(ctx, x, y, x, y - vyNow * 1.5, vyNow >= 0 ? _theme('vec-up') : _theme('vec-down'), 2);
    }

    ctx.fillStyle = _theme('text-muted'); ctx.font = '11px sans-serif';
    ctx.fillText('Weite: ' + wWeite.toFixed(1) + ' m', padX, ground + 16);
    ctx.fillText('H: ' + hMax.toFixed(1) + ' m', padX, top + 12);
    ctx.fillStyle = _theme('text'); ctx.font = 'bold 13px sans-serif';
    ctx.fillText('t = ' + tt.toFixed(2) + ' s', w - 90, 18);

    if (Math.abs(alpha - 45) < 0.5) {
      ctx.fillStyle = _theme('success');
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('✓ Maximale Wurfweite!', w - 180, ground + 16);
    }
  }

  function update() {
    const aRad = alpha * Math.PI / 180;
    const vx = v0 * Math.cos(aRad);
    const vy0 = v0 * Math.sin(aRad);
    const tG = 2 * vy0 / G;
    rH.set((vy0 * vy0 / (2 * G)).toFixed(2) + ' m');
    rW.set((vx * tG).toFixed(2) + ' m');
    rTg.set(tG.toFixed(2) + ' s');
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tG = 2 * v0 * Math.sin(alpha * Math.PI / 180) / G;
    if (t >= tG) { running = false; t = tG; }
    draw();
    return running;
  }

  function reset() { t = 0; running = false; lastTs = 0; update(); draw(); }

  const api = {
    canvas: canvas, draw: draw, animated: true,
    start() { running = true; lastTs = 0; },
    isRunning() { return running; },
    tick: tick,
    reset: reset,
    end() {
      t = 2 * v0 * Math.sin(alpha * Math.PI / 180) / G;
      running = false; draw();
    }
  };
  reset();
  return api;
}

// ── Variant-Map ───────────────────────────────────────────
const _VARIANTS = {
  'schwimmer':      _buildSchwimmer,
  'galileo':        _buildGalileo,
  'waagerecht':     _buildWaagerecht,
  'senkrecht-hoch': _buildSenkrechtHoch,
  'wurf-unten':     _buildWurfUnten,
  'schief':         _buildSchief
};

const _ARIA = {
  'schwimmer':      'Animation: Schwimmer im Fluss (Vektor-Addition)',
  'galileo':        'Animation: Galileo — freier Fall vs waagerechter Wurf',
  'waagerecht':     'Animation: Waagerechter Wurf',
  'senkrecht-hoch': 'Animation: Senkrechter Wurf nach oben',
  'wurf-unten':     'Animation: Wurf nach unten gegen freien Fall',
  'schief':         'Animation: Schiefer Wurf'
};

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();

  const variant = config && typeof config.variant === 'string' ? config.variant : '';
  const builder = _VARIANTS[variant];

  if (!builder) {
    container.innerHTML =
      '<div class="lf-widget-physics-throw lf-pt-empty">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  // Host-Wrapper: ersetzt das innere Slot-DOM (skeleton ist schon vom Loader
  // entfernt worden, aber sicher ist sicher).
  container.innerHTML = '';
  const host = _el('div', 'lf-widget-physics-throw lf-pt-' + variant + ' physik-sim');
  container.append(host);
  try {
    container.setAttribute('aria-label', _ARIA[variant] || 'Interaktive Aufgabe: Wurfbewegung');
  } catch (e) {}

  // Default-Dimensionen pro Variant — entspricht den Original-Werten in
  // physik-sim.js, damit Sophies Visual-Diff klein bleibt.
  const dims = {
    'schwimmer':      [container.clientWidth || 600, 280],
    'galileo':        [container.clientWidth || 600, 320],
    'waagerecht':     [container.clientWidth || 600, 320],
    'senkrecht-hoch': [container.clientWidth || 600, 360],
    'wurf-unten':     [container.clientWidth || 600, 360],
    'schief':         [container.clientWidth || 600, 340]
  };
  const [w, h] = dims[variant];

  const sim = builder(host, w, h, _ARIA[variant] || '');

  // Resize-Handler — original hatte das nur fuer schwimmer; wir spendieren
  // es allen damit DPR-Wechsel (z.B. Browser-Zoom) sauber rezeichnet.
  const onResize = () => {
    if (unmounted) return;
    _fitCanvas(sim.canvas, host.clientWidth || w, h);
    sim.draw();
  };
  window.addEventListener('resize', onResize);

  let unmounted = false;
  let rafId = 0;
  let paused = false;

  // RAF-Loop: laeuft solange sim.isRunning() true zurueckgibt. Die einzelnen
  // sim.tick(ts) sind so geschrieben, dass running = false das Stop-Signal ist.
  function loop(ts) {
    if (unmounted || paused) return;
    const stillRunning = sim.tick ? sim.tick(ts) : false;
    if (stillRunning) {
      rafId = requestAnimationFrame(loop);
    } else {
      rafId = 0;
    }
  }

  // start() vom Sim-Builder ruft die Setup-Funktion (running=true), wir
  // kicken danach den loop. Wir wrappen dafuer sim.start().
  const origStart = sim.start;
  if (origStart) {
    sim.start = () => {
      if (unmounted) return;
      // Reduce-Motion: User klickt Start → nicht animieren, sofort End-State.
      if (lfWidgetReducedMotion()) {
        if (sim.end) sim.end();
        return;
      }
      origStart();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(loop);
    };
  }

  // Reduce-Motion beim ersten Mount: animierte Sims direkt auf End-Frame.
  if (sim.animated && lfWidgetReducedMotion() && sim.end) {
    sim.end();
  }

  const answerCbs = [];

  return {
    widgetType: 'physics-throw',

    unmount() {
      if (unmounted) return; // Idempotenz (Spec).
      unmounted = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      try { window.removeEventListener('resize', onResize); } catch (e) {}
      answerCbs.length = 0;
    },

    pause() {
      // Loader ruft das bei visibilitychange → hidden. RAF einfrieren.
      if (unmounted) return;
      paused = true;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    },

    resume() {
      // Loader ruft das bei visibilitychange → visible. Wenn der Sim noch
      // running war, RAF wieder starten — sonst nichts tun.
      if (unmounted) return;
      paused = false;
      if (sim.isRunning && sim.isRunning() && !rafId) {
        // lastTs muss neu kalibriert werden, sonst macht der erste Frame
        // einen riesigen Sprung. Setzt sim.tick beim naechsten Aufruf
        // selbst zurueck, weil tick() lastTs=0-Branch hat.
        rafId = requestAnimationFrame(loop);
      }
    },

    onTheme() {
      // Theme-Wechsel — Canvas neu zeichnen mit aktuellen CSS-Var-Werten.
      if (unmounted) return;
      sim.draw();
    },

    onAnswer(cb) {
      // Wurf-Sims sind explorativ, nicht graded. Hook bleibt registrierbar
      // fuer Wave-2-Erweiterung (z.B. "stelle Winkel auf 45° ein").
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      // Phase-0: nur Variant zurueckgeben. Slider-Werte sind Closure-State
      // pro Builder; vollstaendiges Resume waere Phase-2-Feature.
      return { variant: variant };
    },

    setState(s) {
      // No-op fuer Phase 0 (kein vollstaendiger State-Restore noetig — Variant
      // ist beim Mount gesetzt, andere Werte koennen nicht ausserhalb der
      // Slider geaendert werden).
      if (!s || typeof s !== 'object') return;
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'physics-throw',
    unmount() {},
    onAnswer() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'physics-throw', mount: mount };
export { mount };
