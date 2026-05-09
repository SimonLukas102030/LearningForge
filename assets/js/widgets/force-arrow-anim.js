// ══════════════════════════════════════════
//  LearningForge — Widget: force-arrow-anim
//  Newton's 2. Gesetz als Live-Animation (Welle 1.1)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md + Plan-Welle-1)
// ══════════════════════════════════════════
//
// Zeigt eine Masse-Box auf einer horizontalen Bodenlinie. Der User stellt
// Masse m + Kraft F per Slider ein. Pfeil rechts der Box waechst proportional
// zu F. Beim Klick "Start" beschleunigt die Box mit a = F/m (oder
// (F-Reibung)/m wenn Reibung aktiv) und faehrt nach rechts. Live-Anzeige:
// a, v, x. Reset setzt zurueck.
//
// Reduce-Motion: tick() laeuft nicht, statt dessen wird ein End-Frame
// gezeichnet (Box ein Stueck nach rechts versetzt mit beschriftetem
// "wuerde sich bewegen"-Indikator).
//
// Theme: Farben kommen aus --lf-fa-*-CSS-Vars (siehe main.css). Wir nutzen
// den --sim-*-Ecosystem-Stil (Light + Dark blocks) — alle Cosmetics-Themes
// erben durchs Cascading.
//
// Config-Schema:
//   {
//     widgetType: 'force-arrow-anim',
//     config: {
//       initialMass:   number      // optional, default 5 (kg)
//       initialForce:  number      // optional, default 10 (N)
//       massRange:     [min,max]   // optional, default [1, 50]
//       forceRange:    [min,max]   // optional, default [0, 100]
//       showFriction:  boolean     // optional, default false (zeigt Reibungs-Toggle)
//       label:         string      // optional, Titel ueber Canvas (default "Newton: F = m \xb7 a")
//     }
//   }

import { lfWidgetReducedMotion } from './_base.js';

// ── Theme-Reader ──────────────────────────────────────────
// Liest --lf-fa-<name> direkt von documentElement. Fallback zu --sim-<name>
// damit wir keinen kompletten Theme-Var-Block fuer alle Cosmetics
// duplizieren muessen — die Wurf-Sims haben dieselbe Logik bereits.
function _theme(name, fallback) {
  const css = getComputedStyle(document.documentElement);
  let v = css.getPropertyValue('--lf-fa-' + name).trim();
  if (!v && fallback) v = css.getPropertyValue('--sim-' + fallback).trim();
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

// ── Arrow-Drawer ──────────────────────────────────────────
// Horizontaler Pfeil von (x,y) nach rechts mit Laenge L. lineWidth + Kopf-
// groesse skalieren mit thickness, damit kleine Pfeile schmal + grosse
// fett aussehen — visuelle Skala "kraefiger = stark".
function _drawArrowH(ctx, x, y, length, color, thickness) {
  if (length < 0.5) return; // zero-arrow nicht zeichnen
  const dir = length >= 0 ? 1 : -1;
  const L = Math.abs(length);
  const ah = Math.max(8, thickness * 2.2);
  const aw = Math.max(6, thickness * 1.6);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + dir * (L - ah), y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + dir * L, y);
  ctx.lineTo(x + dir * (L - ah), y - aw);
  ctx.lineTo(x + dir * (L - ah), y + aw);
  ctx.closePath();
  ctx.fill();
}

// ── Slider-Builder ────────────────────────────────────────
function _slider(label, min, max, step, value, unit, onInput) {
  const wrap = _el('div', 'sim-slider');
  const head = _el('div', 'sim-slider-head');
  const lbl  = _el('span', 'sim-slider-label', label);
  const val  = _el('span', 'sim-slider-value', value + ' ' + unit);
  head.append(lbl, val);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = (step < 1 ? v.toFixed(1) : v.toFixed(0)) + ' ' + unit;
    onInput(v);
  });
  wrap.append(head, input);
  return { wrap: wrap, input: input };
}

function _readout(label, value) {
  const wrap = _el('div', 'sim-readout');
  wrap.append(_el('span', 'sim-readout-label', label));
  const v = _el('span', 'sim-readout-value', value);
  wrap.append(v);
  return { wrap: wrap, set: txt => { v.textContent = txt; } };
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

  // Defaults + Sanitize.
  const massRange  = Array.isArray(config.massRange)  && config.massRange.length === 2
    ? config.massRange  : [1, 50];
  const forceRange = Array.isArray(config.forceRange) && config.forceRange.length === 2
    ? config.forceRange : [0, 100];
  const initialMass  = Math.max(massRange[0],  Math.min(massRange[1],  Number(config.initialMass)  || 5));
  const initialForce = Math.max(forceRange[0], Math.min(forceRange[1], Number(config.initialForce) || 10));
  const showFriction = !!config.showFriction;
  const label = (typeof config.label === 'string' && config.label) ? config.label : 'Newton: F = m \xb7 a';

  // Mutable State.
  let m = initialMass;
  let F = initialForce;
  let friction = false;          // Toggle-Status (nur sichtbar wenn showFriction)
  const FRICTION_COEFF = 0.3;    // Reibungszahl, nur fuer Demo-Zweck (kein realer mu)
  let xPos = 0;                  // Position der Box in m (Welt-Koordinaten)
  let v = 0;                     // Geschwindigkeit in m/s
  let t = 0;                     // Sim-Zeit in s
  let running = false;
  let lastTs = 0;
  let unmounted = false;
  let rafId = 0;
  let paused = false;

  // Layout: host > canvas + controls.
  container.innerHTML = '';
  const host = _el('div', 'lf-widget-physics-throw lf-fa-host physik-sim');
  container.append(host);
  try {
    container.setAttribute('aria-label',
      'Animation: Newton\'s 2. Gesetz — Kraft, Masse, Beschleunigung');
  } catch (e) {}

  const title = _el('div', 'lf-fa-title');
  title.textContent = label;
  host.append(title);

  const canvas = _el('canvas', 'sim-canvas');
  canvas.setAttribute('aria-label',
    'Animation: Newton\'s 2. Gesetz — Kraft, Masse, Beschleunigung');
  host.append(canvas);

  // Canvas-Dimensionen — Hoehe fix 300, Breite responsive.
  const W_DEFAULT = container.clientWidth || 600;
  const H = 300;
  let W = W_DEFAULT;
  let ctx = _fitCanvas(canvas, W, H);

  // Controls.
  const controls = _el('div', 'sim-controls');

  // aria-live-Region fuer Zahlen — Screenreader hoert die Werte.
  const live = _el('div', 'sim-readout lf-fa-live');
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  const liveLabel = _el('span', 'sim-readout-label', 'Aktuell');
  const liveVal   = _el('span', 'sim-readout-value', '');
  live.append(liveLabel, liveVal);

  const sM = _slider('Masse m', massRange[0], massRange[1], 1, m, 'kg', val => {
    m = val; updateLive(); draw();
  });
  const sF = _slider('Kraft F', forceRange[0], forceRange[1], 1, F, 'N', val => {
    F = val; updateLive(); draw();
  });
  controls.append(sM.wrap, sF.wrap);

  // Optional: Reibungs-Toggle.
  let frictionToggle = null;
  if (showFriction) {
    frictionToggle = _el('label', 'lf-fa-toggle');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = false;
    cb.addEventListener('change', () => {
      friction = cb.checked;
      updateLive(); draw();
    });
    frictionToggle.append(cb, _el('span', null, 'Reibung an'));
    controls.append(frictionToggle);
  }

  controls.append(live);

  const btnRow = _el('div', 'sim-btn-row');
  const startBtn = _btn('▶ Start', () => start(), true);
  const pauseBtn = _btn('⏸ Pause', () => userPause());
  const resetBtn = _btn('↺ Reset', () => reset());
  btnRow.append(startBtn, pauseBtn, resetBtn);
  controls.append(btnRow);
  host.append(controls);

  // ── Physik ────────────────────────────────────────────
  function netForce() {
    if (!friction) return F;
    // Reibung wirkt nur wenn Box sich bewegt ODER F sie bewegen wuerde.
    // Mu-mal-mass-mal-g-light (g normalisiert auf 1 fuer Demo, FRICTION_COEFF
    // didaktisch, nicht physikalisch sauber — Zweck: "weniger a, mehr Realitaet").
    const fricMag = FRICTION_COEFF * m * 9.81;
    if (v === 0 && F <= fricMag) return 0; // Haftreibung haelt
    // Gleitreibung wirkt entgegengesetzt zu v (oder zu F bei v=0).
    const dir = v !== 0 ? Math.sign(v) : Math.sign(F);
    return F - dir * fricMag;
  }
  function accel() { return m > 0 ? netForce() / m : 0; }

  // ── Update Readout ────────────────────────────────────
  function updateLive() {
    const a = accel();
    liveVal.textContent =
      'a = ' + a.toFixed(2) + ' m/s\xB2  ·  ' +
      'v = ' + v.toFixed(2) + ' m/s  ·  ' +
      'x = ' + xPos.toFixed(2) + ' m';
  }

  // ── Draw ─────────────────────────────────────────────
  function draw() {
    if (unmounted) return;
    ctx.clearRect(0, 0, W, H);

    // Hintergrund: Himmel oben, Boden unten — gleicher Stil wie Wurf-Sims.
    const groundY = H - 60;
    ctx.fillStyle = _theme('sky', 'sky'); ctx.fillRect(0, 0, W, groundY);
    ctx.fillStyle = _theme('ground', 'ground'); ctx.fillRect(0, groundY, W, 12);
    ctx.fillStyle = _theme('soil', 'soil');   ctx.fillRect(0, groundY + 12, W, H - groundY - 12);

    // Bodenlinie + Markierungen alle 1 m (fuer Distanz-Wahrnehmung).
    const pxPerMeter = 30;
    ctx.strokeStyle = _theme('grid', 'grid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();
    // Strich-Markierungen pro Meter — relativ zur aktuellen Box-Position,
    // damit es aussieht als ob die Welt vorbeizieht.
    ctx.strokeStyle = _theme('grid', 'grid');
    ctx.fillStyle = _theme('text-muted', 'text-muted');
    ctx.font = '10px sans-serif';
    const startMeter = Math.floor(xPos);
    for (let i = -2; i < W / pxPerMeter + 2; i++) {
      const mw = startMeter + i;
      const px = (mw - xPos) * pxPerMeter + 60;
      if (px < -30 || px > W + 30) continue;
      ctx.beginPath();
      ctx.moveTo(px, groundY);
      ctx.lineTo(px, groundY + 5);
      ctx.stroke();
      if (mw % 5 === 0) {
        ctx.fillText(mw + ' m', px - 8, groundY + 18);
      }
    }

    // Box: Position immer linksseitig (px=60) — Welt scrollt drumherum.
    // Boxgroesse waechst leicht mit Masse (visuelles Feedback).
    const boxW = 50 + Math.min(40, m * 0.8);
    const boxH = 40 + Math.min(30, m * 0.6);
    const boxX = 60;
    const boxY = groundY - boxH;

    // Schatten unter Box.
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(boxX + boxW / 2, groundY, boxW * 0.55, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Box (mit dezenter Top-Highlight via Linear-ish-Stripe).
    ctx.fillStyle = _theme('box', 'ball');
    ctx.fillRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = _theme('box-top', 'ball');
    ctx.globalAlpha = 0.25;
    ctx.fillRect(boxX, boxY, boxW, 6);
    ctx.globalAlpha = 1;

    // Box-Kontur.
    ctx.strokeStyle = _theme('box-border', 'text');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxW - 1, boxH - 1);

    // Masse-Label im Inneren.
    ctx.fillStyle = _theme('box-text', 'text');
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('m = ' + m.toFixed(0) + ' kg', boxX + boxW / 2, boxY + boxH / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';

    // Kraft-Pfeil rechts der Box.
    // Pfeillaenge ∝ F. Skala: 1 N = 2 px, max 200 px (bei F=100).
    const arrowMaxLen = Math.min(W - boxX - boxW - 30, 200);
    const arrowLen = (F / Math.max(1, forceRange[1])) * arrowMaxLen;
    if (F > 0.1) {
      const ay = boxY + boxH / 2;
      const ax = boxX + boxW + 6;
      const thickness = 4 + Math.min(8, F / 12);
      _drawArrowH(ctx, ax, ay, arrowLen, _theme('arrow-force', 'vec-x'), thickness);
      // Beschriftung "F = X N" an der Pfeilmitte.
      ctx.fillStyle = _theme('arrow-force', 'vec-x');
      ctx.font = 'bold 12px sans-serif';
      const fLabel = 'F = ' + F.toFixed(0) + ' N';
      ctx.fillText(fLabel, ax + Math.max(arrowLen / 2 - 25, 4), ay - 8);
    }

    // Reibungs-Pfeil (entgegengesetzt zur Box-Bewegungsrichtung), nur wenn aktiv.
    if (friction && F > 0) {
      const fricMag = FRICTION_COEFF * m * 9.81;
      const dir = v !== 0 ? Math.sign(v) : Math.sign(F);
      const fricLen = Math.min(arrowMaxLen, (fricMag / Math.max(1, forceRange[1])) * arrowMaxLen);
      if (fricLen > 1) {
        const fy = boxY + boxH / 2;
        const fx = boxX - 6;
        _drawArrowH(ctx, fx, fy, -dir * fricLen, _theme('arrow-friction', 'vec-down'), 3);
      }
    }

    // Beschleunigungs-Pfeil unter der Box (kleiner, andere Farbe).
    const a = accel();
    if (Math.abs(a) > 0.05) {
      const ax2 = boxX + boxW / 2;
      const ay2 = groundY + 30;
      const aMaxLen = Math.min(W - 100, 140);
      // Skala: 1 m/s\xB2 = 8 px, gecapt.
      const aLen = Math.max(-aMaxLen, Math.min(aMaxLen, a * 8));
      _drawArrowH(ctx, ax2, ay2, aLen, _theme('arrow-accel', 'vec-up'), 2);
      ctx.fillStyle = _theme('arrow-accel', 'vec-up');
      ctx.font = '11px sans-serif';
      ctx.fillText('a = ' + a.toFixed(2) + ' m/s\xB2',
        ax2 + (aLen >= 0 ? 4 : aLen - 70), ay2 - 4);
    }

    // Velocity-Trail: dezente Linie hinter der Box (zeigt v).
    if (Math.abs(v) > 0.05) {
      const ty = boxY + boxH / 2;
      const tLen = Math.min(40, Math.abs(v) * 4);
      ctx.strokeStyle = _theme('trail', 'trajectory');
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(boxX, ty);
      ctx.lineTo(boxX - Math.sign(v) * tLen, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // HUD oben-rechts: t, v, x.
    ctx.fillStyle = _theme('text', 'text');
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('t = ' + t.toFixed(2) + ' s', W - 110, 22);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = _theme('text-muted', 'text-muted');
    ctx.fillText('v = ' + v.toFixed(2) + ' m/s', W - 110, 40);
    ctx.fillText('x = ' + xPos.toFixed(2) + ' m', W - 110, 56);

    // Reduce-Motion-Hinweis: wenn der Anwender RM aktiv hat und die Box
    // "fertig" ist, kleines Label.
    if (lfWidgetReducedMotion() && running === false && t > 0) {
      ctx.fillStyle = _theme('arrow-accel', 'vec-up');
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText('✓ Endzustand (Reduce-Motion)', 8, 18);
    }
  }

  // ── Tick ─────────────────────────────────────────────
  function tick(ts) {
    if (unmounted || paused) return;
    if (!lastTs) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    // Cap dt — falls Tab kurz im Hintergrund war oder erste Frame gross ist.
    if (dt > 0.05) dt = 0.05;
    if (running) {
      const a = accel();
      v += a * dt;
      xPos += v * dt;
      t += dt;
      // Stop-Bedingung: Box ist 50 m gefahren ODER haengen geblieben (Reibung).
      if (xPos > 50 || (friction && F < FRICTION_COEFF * m * 9.81 && Math.abs(v) < 0.01)) {
        running = false;
        if (Math.abs(v) < 0.01) v = 0;
      }
    }
    updateLive();
    draw();
    if (running && !unmounted && !paused) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  }

  function start() {
    if (unmounted) return;
    if (running) return;
    if (lfWidgetReducedMotion()) {
      // End-Frame: simuliere 2 Sekunden Bewegung, ohne RAF.
      const a = accel();
      const dtTotal = 2;
      v = v + a * dtTotal;
      xPos = xPos + v * dtTotal * 0.5; // Mittlere v in der Zeit
      t = t + dtTotal;
      running = false;
      updateLive();
      draw();
      return;
    }
    running = true;
    paused = false;
    lastTs = 0;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  }

  function userPause() {
    if (!running) return;
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    updateLive(); draw();
  }

  function reset() {
    running = false;
    paused = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    xPos = 0; v = 0; t = 0;
    lastTs = 0;
    updateLive(); draw();
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
  updateLive();
  draw();

  return {
    widgetType: 'force-arrow-anim',

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

    onAnswer() {
      // Explorativ — kein Bewertungs-Hook noetig. Stub fuer API-Kontrakt.
    },

    getState() {
      return {
        m: m, F: F, friction: friction,
        xPos: xPos, v: v, t: t, isRunning: running
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.m === 'number') {
        m = Math.max(massRange[0], Math.min(massRange[1], s.m));
        sM.input.value = String(m);
      }
      if (typeof s.F === 'number') {
        F = Math.max(forceRange[0], Math.min(forceRange[1], s.F));
        sF.input.value = String(F);
      }
      if (typeof s.friction === 'boolean' && frictionToggle) {
        friction = s.friction;
        const cb = frictionToggle.querySelector('input');
        if (cb) cb.checked = s.friction;
      }
      if (typeof s.xPos === 'number') xPos = s.xPos;
      if (typeof s.v === 'number')    v = s.v;
      if (typeof s.t === 'number')    t = s.t;
      // isRunning bewusst nicht restored — Resume macht der visibility-Hook.
      updateLive(); draw();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'force-arrow-anim',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'force-arrow-anim', mount: mount };
export { mount };
