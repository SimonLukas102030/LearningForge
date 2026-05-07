// ══════════════════════════════════════════
//  LearningForge — Physik-Simulationen
//  Wurfbewegungen interaktiv
// ══════════════════════════════════════════

const G = 9.81; // Erdbeschleunigung m/s²

// Hilfsfunktionen ─────────────────────────────────────────
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function dpr() { return window.devicePixelRatio || 1; }

function fitCanvas(canvas, cssWidth, cssHeight) {
  const r = dpr();
  canvas.width  = Math.round(cssWidth  * r);
  canvas.height = Math.round(cssHeight * r);
  canvas.style.width  = cssWidth  + 'px';
  canvas.style.height = cssHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(r, 0, 0, r, 0, 0);
  return ctx;
}

function makeSlider(label, min, max, step, value, unit, onInput) {
  const wrap = el('div', 'sim-slider');
  const head = el('div', 'sim-slider-head');
  const lbl  = el('span', 'sim-slider-label', label);
  const val  = el('span', 'sim-slider-value', `${value}&nbsp;${unit}`);
  head.append(lbl, val);
  const input = el('input');
  input.type = 'range';
  input.min  = min;
  input.max  = max;
  input.step = step;
  input.value = value;
  input.addEventListener('input', () => {
    val.innerHTML = `${parseFloat(input.value).toFixed(step < 1 ? 1 : 0)}&nbsp;${unit}`;
    onInput(parseFloat(input.value));
  });
  wrap.append(head, input);
  return wrap;
}

function makeReadout(label, value) {
  const wrap = el('div', 'sim-readout');
  wrap.append(el('span', 'sim-readout-label', label));
  const v = el('span', 'sim-readout-value', value);
  wrap.append(v);
  return { wrap, set: txt => v.textContent = txt };
}

function makeBtn(label, onClick, primary = false) {
  const b = el('button', `sim-btn ${primary ? 'sim-btn-primary' : ''}`, label);
  b.addEventListener('click', onClick);
  return b;
}

// ── Sim 1: Schwimmer im Fluss ──────────────────────────────
// Zeigt vektorielle Addition von zwei senkrechten Geschwindigkeiten
function initSchwimmer(host) {
  host.innerHTML = '';
  const w = host.clientWidth || 600, h = 280;

  let vSchwimmer = 1.0;  // m/s (quer)
  let vFluss     = 2.0;  // m/s (längs)
  const flussBreite = 30; // m

  const canvas = el('canvas', 'sim-canvas');
  host.append(canvas);
  const ctx = fitCanvas(canvas, w, h);

  const controls = el('div', 'sim-controls');
  const ro1 = makeReadout('Resultierende Geschwindigkeit', '');
  const ro2 = makeReadout('Winkel zur Querrichtung', '');
  const ro3 = makeReadout('Versatz flussabwärts', '');
  controls.append(
    makeSlider('Schwimmer-Geschwindigkeit', 0.2, 3, 0.1, vSchwimmer, 'm/s', v => { vSchwimmer = v; redraw(); }),
    makeSlider('Strömung', 0, 4, 0.1, vFluss, 'm/s', v => { vFluss = v; redraw(); }),
    ro1.wrap, ro2.wrap, ro3.wrap
  );
  host.append(controls);

  function redraw() {
    ctx.clearRect(0, 0, w, h);
    // Hintergrund: Flussufer
    ctx.fillStyle = '#dbeafe'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#a7c7e7'; ctx.fillRect(0, 60, w, h - 120);
    ctx.fillStyle = '#86a3c4';
    for (let i = 0; i < 6; i++) {
      const yy = 60 + (h - 120) * (i + 0.3) / 6;
      ctx.fillRect(0, yy, w, 2);
    }
    ctx.fillStyle = '#10b981'; ctx.fillRect(0, 0, w, 60);
    ctx.fillRect(0, h - 60, w, 60);

    // Pfeile in Mitte
    const cx = 100, cy = h / 2;
    const scale = 30; // px pro m/s

    // v_Schwimmer (quer, nach unten)
    drawArrow(ctx, cx, cy, cx, cy + vSchwimmer * scale, '#0ea5e9', 3);
    ctx.fillStyle = '#0369a1'; ctx.font = '12px sans-serif';
    ctx.fillText(`v_S = ${vSchwimmer.toFixed(1)} m/s`, cx + 8, cy + vSchwimmer * scale / 2);

    // v_Fluss (längs)
    drawArrow(ctx, cx, cy, cx + vFluss * scale, cy, '#f97316', 3);
    ctx.fillStyle = '#9a3412';
    ctx.fillText(`v_F = ${vFluss.toFixed(1)} m/s`, cx + vFluss * scale / 2 - 30, cy - 10);

    // Resultierende
    drawArrow(ctx, cx, cy, cx + vFluss * scale, cy + vSchwimmer * scale, '#10b981', 4);

    // Tatsächliche Bahn vom linken Ufer
    const t = flussBreite / vSchwimmer;
    const versatz = vFluss * t;
    const startX = 30, startY = 60;
    const endX   = startX + versatz / flussBreite * (w - 60);
    const endY   = h - 60;
    if (endX < w - 30) {
      ctx.beginPath();
      ctx.strokeStyle = '#10b981';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#10b981';
      ctx.beginPath(); ctx.arc(endX, endY, 6, 0, Math.PI * 2); ctx.fill();
    }

    // Werte
    const vRes  = Math.sqrt(vSchwimmer ** 2 + vFluss ** 2);
    const winkel = Math.atan2(vFluss, vSchwimmer) * 180 / Math.PI;
    ro1.set(`${vRes.toFixed(2)} m/s`);
    ro2.set(`${winkel.toFixed(0)}°`);
    ro3.set(`${versatz.toFixed(1)} m (bei ${flussBreite} m Flussbreite)`);
  }

  redraw();
  window.addEventListener('resize', () => {
    fitCanvas(canvas, host.clientWidth || w, h);
    redraw();
  });
}

// ── Sim 2: Galileo — Fall vs. Wurf ─────────────────────────
// Zwei Bälle: einer fällt, einer wird waagerecht abgeworfen. Zeigt: gleiche Fallzeit.
function initGalileo(host) {
  host.innerHTML = '';
  const w = host.clientWidth || 600, h = 320;

  let v0 = 4.0, hoehe = 12;
  let t = 0, running = false, lastTs = 0;

  const canvas = el('canvas', 'sim-canvas');
  host.append(canvas);
  const ctx = fitCanvas(canvas, w, h);

  const controls = el('div', 'sim-controls');
  const ro1 = makeReadout('Fallzeit (beide Kugeln!)', '');
  controls.append(
    makeSlider('Wurfgeschwindigkeit v₀', 1, 8, 0.5, v0, 'm/s', v => { v0 = v; reset(); }),
    makeSlider('Höhe', 5, 25, 1, hoehe, 'm', v => { hoehe = v; reset(); }),
    ro1.wrap
  );
  const btnRow = el('div', 'sim-btn-row');
  const btnStart = makeBtn('▶ Start', () => { running = true; lastTs = 0; tick(performance.now()); }, true);
  const btnReset = makeBtn('↺ Reset', () => reset());
  btnRow.append(btnStart, btnReset);
  controls.append(btnRow);
  host.append(controls);

  const tFall = Math.sqrt(2 * hoehe / G);
  const padX = 60, padTop = 30, padBot = 50;
  const ground = h - padBot;
  const top    = padTop;
  function pxPerM_y() { return (ground - top) / hoehe; }
  function pxPerM_x() { return (w - 2 * padX) / Math.max(v0 * Math.sqrt(2 * hoehe / G), 1); }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    // Boden + Achse
    ctx.fillStyle = '#a7c7e7'; ctx.fillRect(0, 0, w, top);
    ctx.fillStyle = '#fef3c7'; ctx.fillRect(0, top, w, ground - top);
    ctx.fillStyle = '#92400e'; ctx.fillRect(0, ground, w, h - ground);

    // Höhen-Markierung
    ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padX, top); ctx.lineTo(padX, ground); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#475569'; ctx.font = '11px sans-serif';
    ctx.fillText(`${hoehe} m`, 5, (top + ground) / 2);

    const tF = Math.sqrt(2 * hoehe / G);
    const tt = Math.min(t, tF);

    // Kugel 1: freier Fall (links)
    const y1 = top + 0.5 * G * tt * tt * pxPerM_y();
    drawBall(ctx, padX, y1, '#ef4444', 'A: Fällt');

    // Kugel 2: waagerechter Wurf (von links nach rechts)
    const x2 = padX + v0 * tt * pxPerM_x();
    const y2 = top + 0.5 * G * tt * tt * pxPerM_y();
    drawBall(ctx, x2, y2, '#3b82f6', 'B: Wurf');

    // Bahnspur Kugel B
    ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let s = 0; s <= tt; s += tF / 50) {
      const xx = padX + v0 * s * pxPerM_x();
      const yy = top  + 0.5 * G * s * s * pxPerM_y();
      if (s === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();

    // Status
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`t = ${tt.toFixed(2)} s`, w - 100, 22);
    if (tt >= tF) {
      ctx.fillStyle = '#10b981';
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
    ro1.set(`${tF.toFixed(2)} s — beide Kugeln treffen gleichzeitig auf!`);
    draw();
    if (running) requestAnimationFrame(tick);
  }

  function reset() {
    t = 0; running = false; lastTs = 0;
    ro1.set(`${Math.sqrt(2 * hoehe / G).toFixed(2)} s — beide Kugeln treffen gleichzeitig auf!`);
    draw();
  }

  reset();
}

// ── Sim 3: Waagerechter Wurf ───────────────────────────────
function initWaagerecht(host) {
  host.innerHTML = '';
  const w = host.clientWidth || 600, h = 320;

  let v0 = 5, hoehe = 20;
  let t = 0, running = false, lastTs = 0;

  const canvas = el('canvas', 'sim-canvas');
  host.append(canvas);
  const ctx = fitCanvas(canvas, w, h);

  const controls = el('div', 'sim-controls');
  const roT  = makeReadout('Fallzeit', '');
  const roW  = makeReadout('Wurfweite', '');
  const roV  = makeReadout('Auftreffgeschwindigkeit', '');
  const roWi = makeReadout('Auftreffwinkel', '');
  controls.append(
    makeSlider('Anfangsgeschwindigkeit v₀', 1, 25, 1, v0, 'm/s', v => { v0 = v; reset(); }),
    makeSlider('Höhe h', 5, 50, 1, hoehe, 'm', v => { hoehe = v; reset(); }),
    roT.wrap, roW.wrap, roV.wrap, roWi.wrap
  );
  const btnRow = el('div', 'sim-btn-row');
  btnRow.append(
    makeBtn('▶ Start', () => { running = true; lastTs = 0; tick(performance.now()); }, true),
    makeBtn('↺ Reset', () => reset())
  );
  controls.append(btnRow);
  host.append(controls);

  const padX = 50, padTop = 30, padBot = 50;
  const ground = h - padBot;
  const top    = padTop;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#a7c7e7'; ctx.fillRect(0, 0, w, top);
    ctx.fillStyle = '#fef3c7'; ctx.fillRect(0, top, w, ground - top);
    ctx.fillStyle = '#92400e'; ctx.fillRect(0, ground, w, h - ground);

    const tF = Math.sqrt(2 * hoehe / G);
    const wWeite = v0 * tF;
    const pxX = (w - 2 * padX) / wWeite;
    const pxY = (ground - top) / hoehe;

    // Bahnspur (komplett)
    ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let s = 0; s <= tF; s += tF / 80) {
      const xx = padX + v0 * s * pxX;
      const yy = top  + 0.5 * G * s * s * pxY;
      if (s === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Aktuelle Position
    const tt = Math.min(t, tF);
    const x  = padX + v0 * tt * pxX;
    const y  = top  + 0.5 * G * tt * tt * pxY;
    drawBall(ctx, x, y, '#3b82f6', '');

    // Geschwindigkeitsvektoren
    if (tt > 0.1 && tt < tF - 0.05) {
      drawArrow(ctx, x, y, x + v0 * 4, y, '#0ea5e9', 2);
      drawArrow(ctx, x, y, x, y + G * tt * 4, '#f97316', 2);
    }

    // Höhenmaß
    ctx.strokeStyle = '#94a3b8'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(padX, top); ctx.lineTo(padX, ground); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#475569'; ctx.font = '11px sans-serif';
    ctx.fillText(`${hoehe} m`, 5, (top + ground) / 2);
    ctx.fillText(`${wWeite.toFixed(1)} m`, padX + (w - 2 * padX) / 2 - 20, ground + 18);
  }

  function update() {
    const tF = Math.sqrt(2 * hoehe / G);
    const wWeite = v0 * tF;
    const vy = G * tF;
    const vRes = Math.sqrt(v0 ** 2 + vy ** 2);
    const winkel = Math.atan2(vy, v0) * 180 / Math.PI;
    roT.set(`${tF.toFixed(2)} s`);
    roW.set(`${wWeite.toFixed(2)} m`);
    roV.set(`${vRes.toFixed(2)} m/s (${(vRes*3.6).toFixed(0)} km/h)`);
    roWi.set(`${winkel.toFixed(0)}° zur Horizontalen`);
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tF = Math.sqrt(2 * hoehe / G);
    if (t >= tF) { running = false; t = tF; }
    draw();
    if (running) requestAnimationFrame(tick);
  }

  function reset() { t = 0; running = false; lastTs = 0; update(); draw(); }
  reset();
}

// ── Sim 4: Senkrechter Wurf nach oben ──────────────────────
function initSenkrechtHoch(host) {
  host.innerHTML = '';
  const w = host.clientWidth || 600, h = 360;

  let v0 = 15;
  let t = 0, running = false, lastTs = 0;

  const canvas = el('canvas', 'sim-canvas');
  host.append(canvas);
  const ctx = fitCanvas(canvas, w, h);

  const controls = el('div', 'sim-controls');
  const roH = makeReadout('Maximale Höhe', '');
  const roTs = makeReadout('Steigzeit', '');
  const roTg = makeReadout('Gesamte Flugzeit', '');
  const roVnow = makeReadout('Aktuelle Geschwindigkeit', '');
  controls.append(
    makeSlider('Anfangsgeschwindigkeit v₀', 5, 30, 1, v0, 'm/s', v => { v0 = v; reset(); }),
    roH.wrap, roTs.wrap, roTg.wrap, roVnow.wrap
  );
  const btnRow = el('div', 'sim-btn-row');
  btnRow.append(
    makeBtn('▶ Start', () => { running = true; lastTs = 0; tick(performance.now()); }, true),
    makeBtn('↺ Reset', () => reset())
  );
  controls.append(btnRow);
  host.append(controls);

  const padTop = 20, padBot = 40;
  const ground = h - padBot;
  const top    = padTop;
  const cx     = w / 2;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#a7c7e7'; ctx.fillRect(0, 0, w, top);
    ctx.fillStyle = '#fef3c7'; ctx.fillRect(0, top, w, ground - top);
    ctx.fillStyle = '#92400e'; ctx.fillRect(0, ground, w, h - ground);

    const hMax = v0 * v0 / (2 * G);
    const tS   = v0 / G;
    const tG   = 2 * tS;
    const pxY  = (ground - top - 30) / Math.max(hMax, 1);

    // Höhen-Linie
    ctx.strokeStyle = '#cbd5e1'; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(cx, top); ctx.lineTo(cx, ground); ctx.stroke();
    const hMaxY = ground - hMax * pxY;
    ctx.beginPath(); ctx.moveTo(cx - 50, hMaxY); ctx.lineTo(cx + 50, hMaxY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#64748b'; ctx.font = '11px sans-serif';
    ctx.fillText(`h_max ≈ ${hMax.toFixed(1)} m`, cx + 55, hMaxY + 4);

    const tt = Math.min(t, tG);
    const yMeter = v0 * tt - 0.5 * G * tt * tt;
    const yPos   = ground - yMeter * pxY;
    drawBall(ctx, cx, yPos, '#3b82f6', '');

    // Geschwindigkeit aktuell
    const vNow = v0 - G * tt;
    if (Math.abs(vNow) > 0.1) {
      drawArrow(ctx, cx, yPos, cx, yPos - vNow * 5, vNow > 0 ? '#10b981' : '#ef4444', 2);
    }

    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`t = ${tt.toFixed(2)} s`, w - 100, 22);
  }

  function update() {
    const hMax = v0 * v0 / (2 * G);
    const tS = v0 / G;
    roH.set(`${hMax.toFixed(2)} m`);
    roTs.set(`${tS.toFixed(2)} s`);
    roTg.set(`${(2 * tS).toFixed(2)} s`);
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tG = 2 * v0 / G;
    if (t >= tG) { running = false; t = tG; }
    const vNow = v0 - G * Math.min(t, tG);
    roVnow.set(`${Math.abs(vNow).toFixed(2)} m/s ${vNow >= 0 ? '↑' : '↓'}`);
    draw();
    if (running) requestAnimationFrame(tick);
  }

  function reset() { t = 0; running = false; lastTs = 0; update(); roVnow.set(`${v0.toFixed(2)} m/s ↑`); draw(); }
  reset();
}

// ── Sim 5: Wurf nach unten — Vergleich mit freiem Fall ─────
function initWurfNachUnten(host) {
  host.innerHTML = '';
  const w = host.clientWidth || 600, h = 360;

  let v0 = 5, hoehe = 20;
  let t = 0, running = false, lastTs = 0;

  const canvas = el('canvas', 'sim-canvas');
  host.append(canvas);
  const ctx = fitCanvas(canvas, w, h);

  const controls = el('div', 'sim-controls');
  const roT = makeReadout('Fallzeit (Wurf)', '');
  const roTfrei = makeReadout('Fallzeit (freier Fall, v₀=0)', '');
  const roV = makeReadout('Auftreffgeschwindigkeit (Wurf)', '');
  const roVfrei = makeReadout('Auftreffgeschwindigkeit (frei)', '');
  controls.append(
    makeSlider('Anfangsgeschwindigkeit v₀ ↓', 0, 20, 0.5, v0, 'm/s', v => { v0 = v; reset(); }),
    makeSlider('Höhe h', 5, 50, 1, hoehe, 'm', v => { hoehe = v; reset(); }),
    roT.wrap, roTfrei.wrap, roV.wrap, roVfrei.wrap
  );
  const btnRow = el('div', 'sim-btn-row');
  btnRow.append(
    makeBtn('▶ Start', () => { running = true; lastTs = 0; tick(performance.now()); }, true),
    makeBtn('↺ Reset', () => reset())
  );
  controls.append(btnRow);
  host.append(controls);

  const padTop = 30, padBot = 40;
  const ground = h - padBot;
  const top    = padTop;
  const cxA    = w * 0.30;
  const cxB    = w * 0.70;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#a7c7e7'; ctx.fillRect(0, 0, w, top);
    ctx.fillStyle = '#fef3c7'; ctx.fillRect(0, top, w, ground - top);
    ctx.fillStyle = '#92400e'; ctx.fillRect(0, ground, w, h - ground);

    const tFw  = (-v0 + Math.sqrt(v0*v0 + 2*G*hoehe)) / G;       // Wurf
    const tFr  = Math.sqrt(2 * hoehe / G);                       // Frei
    const tMax = Math.max(tFw, tFr);
    const pxY  = (ground - top) / hoehe;

    // Säulen-Anzeigen
    ctx.fillStyle = '#1e293b'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText('Wurf nach unten', cxA - 50, top - 8);
    ctx.fillText('Freier Fall', cxB - 35, top - 8);

    const tt = Math.min(t, tMax);
    // Wurf-Ball
    const sW = Math.min(v0 * tt + 0.5 * G * tt * tt, hoehe);
    const yW = top + sW * pxY;
    drawBall(ctx, cxA, yW, '#3b82f6', '');

    // Frei-Ball
    const sF = Math.min(0.5 * G * tt * tt, hoehe);
    const yF = top + sF * pxY;
    drawBall(ctx, cxB, yF, '#ef4444', '');

    // Beschriftung
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`t = ${tt.toFixed(2)} s`, w / 2 - 35, h - 14);

    // Markierung wer zuerst landet
    if (tt >= tFw && tt < tFw + 0.3) {
      ctx.fillStyle = '#10b981';
      ctx.fillText('✓ Wurf landet', cxA - 35, ground + 22);
    }
    if (tt >= tFr && tt < tFr + 0.3) {
      ctx.fillStyle = '#10b981';
      ctx.fillText('✓ Frei landet', cxB - 30, ground + 22);
    }
  }

  function update() {
    const tFw = (-v0 + Math.sqrt(v0*v0 + 2*G*hoehe)) / G;
    const tFr = Math.sqrt(2 * hoehe / G);
    const vW  = Math.sqrt(v0*v0 + 2*G*hoehe);
    const vF  = Math.sqrt(2*G*hoehe);
    roT.set(`${tFw.toFixed(2)} s`);
    roTfrei.set(`${tFr.toFixed(2)} s  (${(tFr - tFw).toFixed(2)} s länger)`);
    roV.set(`${vW.toFixed(2)} m/s`);
    roVfrei.set(`${vF.toFixed(2)} m/s`);
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tFr = Math.sqrt(2 * hoehe / G);
    if (t >= tFr + 0.3) { running = false; }
    draw();
    if (running) requestAnimationFrame(tick);
  }

  function reset() { t = 0; running = false; lastTs = 0; update(); draw(); }
  reset();
}

// ── Sim 6: Schiefer Wurf ───────────────────────────────────
function initSchief(host) {
  host.innerHTML = '';
  const w = host.clientWidth || 600, h = 340;

  let v0 = 20, alpha = 45;
  let t = 0, running = false, lastTs = 0;

  const canvas = el('canvas', 'sim-canvas');
  host.append(canvas);
  const ctx = fitCanvas(canvas, w, h);

  const controls = el('div', 'sim-controls');
  const roH = makeReadout('Max. Höhe', '');
  const roW = makeReadout('Wurfweite', '');
  const roTg = makeReadout('Flugzeit', '');
  controls.append(
    makeSlider('v₀', 5, 40, 1, v0, 'm/s', v => { v0 = v; reset(); }),
    makeSlider('Abwurfwinkel α', 5, 85, 1, alpha, '°', v => { alpha = v; reset(); }),
    roH.wrap, roW.wrap, roTg.wrap
  );
  const btnRow = el('div', 'sim-btn-row');
  btnRow.append(
    makeBtn('▶ Start', () => { running = true; lastTs = 0; tick(performance.now()); }, true),
    makeBtn('↺ Reset', () => reset()),
    makeBtn('🎯 45° (Optimum)', () => { alpha = 45; controls.querySelectorAll('input')[1].value = 45; reset(); })
  );
  controls.append(btnRow);
  host.append(controls);

  const padX = 40, padTop = 20, padBot = 40;
  const ground = h - padBot;
  const top    = padTop;

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#a7c7e7'; ctx.fillRect(0, 0, w, top);
    ctx.fillStyle = '#fef3c7'; ctx.fillRect(0, top, w, ground - top);
    ctx.fillStyle = '#92400e'; ctx.fillRect(0, ground, w, h - ground);

    const aRad = alpha * Math.PI / 180;
    const vx   = v0 * Math.cos(aRad);
    const vy0  = v0 * Math.sin(aRad);
    const tG   = 2 * vy0 / G;
    const wWeite = vx * tG;
    const hMax = vy0 * vy0 / (2 * G);

    // Auto-Skala: Verhältnis erhalten
    const availW = w - 2 * padX;
    const availH = ground - top;
    const scaleX = availW / Math.max(wWeite, 1);
    const scaleY = availH / Math.max(hMax, 1);
    const scale  = Math.min(scaleX, scaleY) * 0.9;

    // Bahnspur
    ctx.strokeStyle = '#93c5fd'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let s = 0; s <= tG; s += tG / 100) {
      const xx = padX + vx * s * scale;
      const yy = ground - (vy0 * s - 0.5 * G * s * s) * scale;
      if (s === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Aktuelle Position
    const tt = Math.min(t, tG);
    const x  = padX + vx * tt * scale;
    const y  = ground - (vy0 * tt - 0.5 * G * tt * tt) * scale;
    drawBall(ctx, x, y, '#3b82f6', '');

    // Geschwindigkeitspfeile
    if (tt > 0.05 && tt < tG - 0.05) {
      const vyNow = vy0 - G * tt;
      drawArrow(ctx, x, y, x + vx * 1.5, y, '#0ea5e9', 2);
      drawArrow(ctx, x, y, x, y - vyNow * 1.5, vyNow >= 0 ? '#10b981' : '#ef4444', 2);
    }

    // Beschriftung
    ctx.fillStyle = '#475569'; ctx.font = '11px sans-serif';
    ctx.fillText(`Weite: ${wWeite.toFixed(1)} m`, padX, ground + 16);
    ctx.fillText(`H: ${hMax.toFixed(1)} m`, padX, top + 12);
    ctx.fillStyle = '#0f172a'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`t = ${tt.toFixed(2)} s`, w - 90, 18);

    // Hinweis bei 45°
    if (Math.abs(alpha - 45) < 0.5) {
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText('✓ Maximale Wurfweite!', w - 180, ground + 16);
    }
  }

  function update() {
    const aRad = alpha * Math.PI / 180;
    const vx   = v0 * Math.cos(aRad);
    const vy0  = v0 * Math.sin(aRad);
    const tG   = 2 * vy0 / G;
    const wWeite = vx * tG;
    const hMax = vy0 * vy0 / (2 * G);
    roH.set(`${hMax.toFixed(2)} m`);
    roW.set(`${wWeite.toFixed(2)} m`);
    roTg.set(`${tG.toFixed(2)} s`);
  }

  function tick(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (running) t += dt;
    const tG = 2 * v0 * Math.sin(alpha * Math.PI / 180) / G;
    if (t >= tG) { running = false; t = tG; }
    draw();
    if (running) requestAnimationFrame(tick);
  }

  function reset() { t = 0; running = false; lastTs = 0; update(); draw(); }
  reset();
}

// ── Zeichen-Helfer ─────────────────────────────────────────
function drawBall(ctx, x, y, color, label) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x - 2, y - 2, 2, 0, Math.PI * 2); ctx.fill();
  if (label) {
    ctx.fillStyle = color;
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText(label, x + 12, y + 4);
  }
}

function drawArrow(ctx, x1, y1, x2, y2, color, lw) {
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

// ── Public API: scan + init ────────────────────────────────
const SIMS = {
  'schwimmer':       initSchwimmer,
  'galileo':         initGalileo,
  'waagerecht':      initWaagerecht,
  'senkrecht-hoch':  initSenkrechtHoch,
  'wurf-unten':      initWurfNachUnten,
  'schief':          initSchief,
};

export function initPhysikSimulations(container) {
  if (!container) return;
  container.querySelectorAll('[data-sim]').forEach(el => {
    if (el.dataset._initialized) return;
    el.dataset._initialized = '1';
    const type = el.dataset.sim;
    const fn   = SIMS[type];
    if (!fn) {
      el.innerHTML = `<div class="sim-error">Unbekannte Simulation: ${type}</div>`;
      return;
    }
    try { fn(el); } catch (err) {
      console.error('[physik-sim]', type, err);
      el.innerHTML = `<div class="sim-error">Simulation konnte nicht gestartet werden.</div>`;
    }
  });
}
