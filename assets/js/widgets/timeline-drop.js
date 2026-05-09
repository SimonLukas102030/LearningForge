// ══════════════════════════════════════════
//  LearningForge — Widget: timeline-drop
//  Welle 1.5 — Karten-Drop-auf-Zeitstrahl mit Snap-to-Year
//  (siehe Plan 2026-05-09-interaktiv-ausbau.md, W1.5)
// ══════════════════════════════════════════
//
// Schueler bekommt Karten mit Ereignis-Beschreibungen ("Beginn 1. Weltkrieg",
// "Erste Mondlandung") und droppt sie auf den richtigen Punkt am horizontalen
// Zeitstrahl. Snap-to-Year: Karte rastet bei Drop am naechsten Jahres-Marker
// ein. Score = correctCount / total bei Pruefen (correct = |dropYear - year|
// <= card.tolerance). Drag funktioniert mit Maus, Touch und Keyboard.
//
// Drei Bereiche:
//   1. Card-Tray (oben) — alle ungelegten Karten als <button>s.
//   2. Axis-Bereich (mitte) — Achse mit Jahres-Markern + Tick-Zone fuer Drops.
//   3. (gelegte Karten erscheinen direkt am Zeitstrahl als "Pin"s).
//
// Hard-Rule #3 (post-2026-05-09): Content-Strings (label) sind raw UTF-8 und
// gehen 1:1 ins innerHTML — KEIN escapeHtml. data-Attribute via _escapeAttr.
//
// Keyboard-Drag-Modell (a11y-Pfad):
//   - Tab fokussiert eine Card-Button (Tray oder Pin am Zeitstrahl).
//   - Enter/Space "hebt sie an": status='picking', Selektor erscheint.
//   - Pfeil links/rechts schiebt Selektor in 1-Jahres-Schritten.
//   - Enter/Space dropped Karte am Selektor-Jahr.
//   - Escape bricht Pickup ab.

import { lfWidgetReducedMotion } from './_base.js';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-td-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

function _escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Defensive Validation. Gibt null zurueck wenn config unbrauchbar.
function _normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const cards = Array.isArray(rawConfig.cards) ? rawConfig.cards : [];
  const range = Array.isArray(rawConfig.timelineRange) ? rawConfig.timelineRange : null;
  if (cards.length < 2 || !range || range.length !== 2) return null;
  const minYear = Number(range[0]);
  const maxYear = Number(range[1]);
  if (!Number.isFinite(minYear) || !Number.isFinite(maxYear) || minYear >= maxYear) return null;

  const seen = new Set();
  const norm = [];
  for (const c of cards) {
    if (!c || typeof c !== 'object') return null;
    const id    = (typeof c.id === 'string') ? c.id : '';
    const label = (typeof c.label === 'string') ? c.label : '';
    const year  = Number(c.year);
    const tol   = (c.tolerance == null) ? 1 : Number(c.tolerance);
    if (!id || !label || !Number.isFinite(year)) return null;
    if (year < minYear || year > maxYear) return null;
    if (seen.has(id)) return null;
    seen.add(id);
    norm.push({ id: id, label: label, year: year, tolerance: Math.max(0, tol) });
  }

  // Tick-Step: alle 5 Jahre Default; bei kleinen Ranges (<=20J) jaehrlich,
  // bei riesigen (>=200J) alle 25 Jahre, sonst 5/10.
  const span = maxYear - minYear;
  let tickStep = 5;
  if (span <= 20) tickStep = 1;
  else if (span <= 50) tickStep = 5;
  else if (span <= 120) tickStep = 10;
  else tickStep = 25;
  if (typeof rawConfig.tickStep === 'number' && rawConfig.tickStep > 0) {
    tickStep = Math.floor(rawConfig.tickStep);
  }

  return {
    setup:    typeof rawConfig.setup === 'string'    ? rawConfig.setup    : '',
    label:    typeof rawConfig.label === 'string'    ? rawConfig.label    : '',
    question: typeof rawConfig.question === 'string' ? rawConfig.question : '',
    reveal:   typeof rawConfig.reveal === 'string'   ? rawConfig.reveal   : '',
    cards:    norm,
    minYear:  minYear,
    maxYear:  maxYear,
    tickStep: tickStep
  };
}

function _yearToPercent(year, minY, maxY) {
  return ((year - minY) / (maxY - minY)) * 100;
}
function _percentToYear(pct, minY, maxY) {
  const y = minY + (pct / 100) * (maxY - minY);
  return Math.round(y);
}
function _clampYear(y, minY, maxY) {
  return Math.max(minY, Math.min(maxY, y));
}

// ── Render-Helper ──
function _renderTrayCard(slotId, card) {
  return '<button type="button" class="lf-td-card lf-td-card-tray" '
       + 'data-td-action="pick" '
       + 'data-td-card-id="' + _escapeAttr(card.id) + '" '
       + 'aria-label="Karte: ' + _escapeAttr(card.label) + '. Aktivieren, dann mit Pfeiltasten platzieren.">'
       + '<span class="lf-td-card-label">' + card.label + '</span>'
       + '</button>';
}
function _renderPin(slotId, card, dropYear, statusClass, minY, maxY) {
  const pct = _yearToPercent(dropYear, minY, maxY);
  return '<button type="button" class="lf-td-pin ' + statusClass + '" '
       + 'data-td-action="pick" '
       + 'data-td-card-id="' + _escapeAttr(card.id) + '" '
       + 'style="left:' + pct.toFixed(2) + '%;" '
       + 'aria-label="' + _escapeAttr(card.label) + ' bei ' + dropYear + '. Aktivieren, um zu verschieben.">'
       +   '<span class="lf-td-pin-stem" aria-hidden="true"></span>'
       +   '<span class="lf-td-pin-card">'
       +     '<span class="lf-td-pin-label">' + card.label + '</span>'
       +     '<span class="lf-td-pin-year">' + dropYear + '</span>'
       +   '</span>'
       + '</button>';
}
function _renderTicks(minY, maxY, step) {
  const out = [];
  // Erstes Tick auf naechstes Vielfaches von step (oder minY selbst).
  const first = Math.ceil(minY / step) * step;
  for (let y = first; y <= maxY; y += step) {
    const pct = _yearToPercent(y, minY, maxY);
    out.push(
      '<div class="lf-td-tick" style="left:' + pct.toFixed(2) + '%;">'
      + '<div class="lf-td-tick-line" aria-hidden="true"></div>'
      + '<div class="lf-td-tick-label">' + y + '</div>'
      + '</div>'
    );
  }
  return out.join('');
}

function _renderHtml(norm, slotId) {
  const setupHtml    = norm.setup    ? '<div class="lf-td-setup">' + norm.setup + '</div>' : '';
  const labelHtml    = norm.label    ? '<h4 class="lf-td-heading">' + norm.label + '</h4>' : '';
  const questionHtml = norm.question ? '<div class="lf-td-question">' + norm.question + '</div>' : '';
  const trayHtml     = norm.cards.map(c => _renderTrayCard(slotId, c)).join('');
  const ticksHtml    = _renderTicks(norm.minYear, norm.maxYear, norm.tickStep);
  const revealHtml   = norm.reveal
    ? '<div class="lf-td-reveal" id="' + _escapeAttr(slotId) + '-reveal" hidden>'
    +    '<div class="lf-td-reveal-heading">Erkl&auml;rung</div>'
    +    '<div class="lf-td-reveal-body">' + norm.reveal + '</div>'
    + '</div>'
    : '';

  return '<div class="lf-widget-timeline-drop lf-td-state-predict" '
       +   'id="' + _escapeAttr(slotId) + '" data-td-slot="' + _escapeAttr(slotId) + '">'
       +   labelHtml
       +   setupHtml
       +   questionHtml
       +   '<div class="lf-td-score" role="status" aria-live="polite">'
       +     '<span class="lf-td-score-text">Karten gelegt: <span class="lf-td-score-placed">0</span> / '
       +     norm.cards.length + '</span>'
       +   '</div>'
       +   '<div class="lf-td-tray" data-td-tray aria-label="Noch nicht platzierte Karten">' + trayHtml + '</div>'
       +   '<div class="lf-td-axis-wrap">'
       +     '<div class="lf-td-axis" data-td-axis tabindex="-1">'
       +       '<div class="lf-td-axis-line" aria-hidden="true"></div>'
       +       '<div class="lf-td-ticks" aria-hidden="false">' + ticksHtml + '</div>'
       +       '<div class="lf-td-pins" data-td-pins></div>'
       +       '<div class="lf-td-cursor" data-td-cursor hidden aria-hidden="true">'
       +         '<div class="lf-td-cursor-line"></div>'
       +         '<div class="lf-td-cursor-year">' + norm.minYear + '</div>'
       +       '</div>'
       +       '<div class="lf-td-ghost" data-td-ghost hidden aria-hidden="true"></div>'
       +     '</div>'
       +   '</div>'
       +   '<div class="lf-td-hint" id="' + _escapeAttr(slotId) + '-hint" role="status" aria-live="polite" hidden></div>'
       +   '<div class="lf-td-actions">'
       +     '<button type="button" class="lf-td-check" data-td-action="check">Pr&uuml;fen</button>'
       +     '<button type="button" class="lf-td-reset" data-td-action="reset">Zur&uuml;cksetzen</button>'
       +   '</div>'
       +   revealHtml
       + '</div>';
}

// ─── mount() ──────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();

  const norm = _normalizeConfig(config);
  const slotId = _nextSlotId();

  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-timeline-drop lf-td-empty" data-td-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  // Per-Instance-State.
  // placements: Map<cardId, dropYear> — null/missing = noch im Tray.
  // status: 'predict' | 'checked' (correct/wrong-Klassen pro Karte).
  // pickup: { cardId, year } | null — aktive Pickup (Maus/Touch/Keyboard).
  // pickupMode: 'kb' | 'pointer' | null
  const state = {
    config: norm,
    placements: new Map(),
    cardResults: new Map(), // nach check: cardId -> 'correct' | 'wrong'
    status: 'predict',
    pickup: null,
    pickupMode: null
  };
  let unmounted = false;
  const answerCbs = [];

  container.innerHTML = _renderHtml(norm, slotId);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Interaktive Aufgabe: Karten am Zeitstrahl platzieren');
  } catch (e) {}

  const reducedMotion = lfWidgetReducedMotion();

  const tray   = root.querySelector('[data-td-tray]');
  const axis   = root.querySelector('[data-td-axis]');
  const pins   = root.querySelector('[data-td-pins]');
  const cursor = root.querySelector('[data-td-cursor]');
  const ghost  = root.querySelector('[data-td-ghost]');

  // ── Re-Render: Tray + Pins ───────────────────────────────
  function rerenderTray() {
    if (!tray) return;
    const trayCards = norm.cards.filter(c => !state.placements.has(c.id));
    tray.innerHTML = trayCards.map(c => _renderTrayCard(slotId, c)).join('');
  }
  function rerenderPins() {
    if (!pins) return;
    let html = '';
    for (const [cardId, dropYear] of state.placements) {
      const card = norm.cards.find(c => c.id === cardId);
      if (!card) continue;
      let cls = 'lf-td-pin-placed';
      if (state.status === 'checked') {
        const r = state.cardResults.get(cardId);
        cls = r === 'correct' ? 'lf-td-pin-correct' : 'lf-td-pin-wrong';
      }
      html += _renderPin(slotId, card, dropYear, cls, norm.minYear, norm.maxYear);
    }
    pins.innerHTML = html;
  }
  function updateScoreText() {
    const placedEl = root.querySelector('.lf-td-score-placed');
    if (placedEl) placedEl.textContent = String(state.placements.size);
    const scoreText = root.querySelector('.lf-td-score-text');
    if (state.status === 'checked' && scoreText) {
      let correct = 0;
      for (const [, r] of state.cardResults) if (r === 'correct') correct++;
      scoreText.innerHTML = 'Richtig: <strong>' + correct + '</strong> / ' + norm.cards.length;
    } else if (scoreText) {
      scoreText.innerHTML = 'Karten gelegt: <span class="lf-td-score-placed">'
        + state.placements.size + '</span> / ' + norm.cards.length;
    }
  }
  function rerenderAll() {
    if (unmounted || !root) return;
    rerenderTray();
    rerenderPins();
    updateScoreText();
    root.classList.toggle('lf-td-state-predict', state.status === 'predict');
    root.classList.toggle('lf-td-state-checked', state.status === 'checked');
    const reveal = root.querySelector('#' + CSS.escape(slotId) + '-reveal');
    if (reveal) reveal.hidden = !(state.status === 'checked' && norm.reveal);
  }

  // ── Pickup-Helpers ───────────────────────────────────────
  function startPickup(cardId, mode) {
    if (state.status === 'checked') {
      // Wenn schon gecheckt: erlauben, aber Status zurueck zu predict.
      state.status = 'predict';
      state.cardResults.clear();
    }
    let initialYear;
    if (state.placements.has(cardId)) {
      initialYear = state.placements.get(cardId);
      // Aus Pins rausnehmen waehrend Pickup.
      state.placements.delete(cardId);
    } else {
      initialYear = Math.round((norm.minYear + norm.maxYear) / 2);
    }
    state.pickup = { cardId: cardId, year: initialYear };
    state.pickupMode = mode;
    rerenderAll();
    showCursor(initialYear);
    if (mode === 'kb') {
      // Kein Ghost im KB-Mode — Cursor + Selektor reichen.
      if (ghost) ghost.hidden = true;
    }
  }
  function updatePickupYear(year) {
    if (!state.pickup) return;
    state.pickup.year = _clampYear(year, norm.minYear, norm.maxYear);
    showCursor(state.pickup.year);
    showGhostFor(state.pickup.cardId, state.pickup.year);
  }
  function commitPickup() {
    if (!state.pickup) return;
    state.placements.set(state.pickup.cardId, state.pickup.year);
    const cardId = state.pickup.cardId;
    state.pickup = null;
    state.pickupMode = null;
    hideCursor();
    hideGhost();
    rerenderAll();
    // Refokus: neuer Pin (Keyboard-Pfad behaelt Workflow).
    setTimeout(() => {
      if (unmounted || !root) return;
      const pin = root.querySelector('.lf-td-pin[data-td-card-id="' + CSS.escape(cardId) + '"]');
      if (pin && typeof pin.focus === 'function') pin.focus();
    }, 0);
  }
  function cancelPickup() {
    if (!state.pickup) return;
    // Falls Karte vorher platziert war, war placements-Eintrag schon entfernt;
    // wir machen den NICHT rueckgaengig — Cancel = Karte zurueck in Tray.
    state.pickup = null;
    state.pickupMode = null;
    hideCursor();
    hideGhost();
    rerenderAll();
  }

  function showCursor(year) {
    if (!cursor) return;
    cursor.hidden = false;
    const pct = _yearToPercent(year, norm.minYear, norm.maxYear);
    cursor.style.left = pct.toFixed(2) + '%';
    const yEl = cursor.querySelector('.lf-td-cursor-year');
    if (yEl) yEl.textContent = year;
  }
  function hideCursor() {
    if (cursor) cursor.hidden = true;
  }
  function showGhostFor(cardId, year) {
    if (!ghost) return;
    const card = norm.cards.find(c => c.id === cardId);
    if (!card) return;
    ghost.hidden = false;
    const pct = _yearToPercent(year, norm.minYear, norm.maxYear);
    ghost.style.left = pct.toFixed(2) + '%';
    ghost.innerHTML = '<span class="lf-td-ghost-card">'
      + '<span class="lf-td-ghost-label">' + card.label + '</span>'
      + '<span class="lf-td-ghost-year">' + year + '</span>'
      + '</span>';
  }
  function hideGhost() {
    if (ghost) { ghost.hidden = true; ghost.innerHTML = ''; }
  }

  // ── Pixel-zu-Year-Konverter (fuer Pointer-Drag + Click-on-Axis) ──
  function pointerToYear(clientX) {
    if (!axis) return null;
    const rect = axis.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(0, Math.min(100, pct));
    return _percentToYear(clamped, norm.minYear, norm.maxYear);
  }

  // ── Check ───────────────────────────────────────────────
  function check() {
    if (unmounted) return;
    let correctCount = 0;
    state.cardResults.clear();
    for (const card of norm.cards) {
      const placed = state.placements.get(card.id);
      if (placed == null) continue;
      const ok = Math.abs(placed - card.year) <= card.tolerance;
      state.cardResults.set(card.id, ok ? 'correct' : 'wrong');
      if (ok) correctCount++;
    }
    state.status = 'checked';
    rerenderAll();

    // Hint mit zusammengefasstem Score
    const hint = root.querySelector('#' + CSS.escape(slotId) + '-hint');
    if (hint) {
      const placedTotal = state.placements.size;
      hint.hidden = false;
      if (placedTotal < norm.cards.length) {
        hint.textContent = 'Du hast ' + placedTotal + ' von ' + norm.cards.length
          + ' Karten platziert. ' + correctCount + ' davon richtig.';
      } else {
        hint.textContent = correctCount === norm.cards.length
          ? 'Perfekt! Alle Karten richtig zugeordnet.'
          : correctCount + ' von ' + norm.cards.length + ' Karten richtig zugeordnet.';
      }
    }

    const total = norm.cards.length;
    const partial = total > 0 ? correctCount / total : 0;
    const allCorrect = correctCount === total;
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: allCorrect,
          partial: partial,
          raw: { correctCount: correctCount, total: total }
        });
      } catch (e) { console.warn('[timeline-drop onAnswer]', e); }
    });
  }

  function reset() {
    if (unmounted) return;
    state.placements.clear();
    state.cardResults.clear();
    state.status = 'predict';
    state.pickup = null;
    state.pickupMode = null;
    hideCursor();
    hideGhost();
    rerenderAll();
    const hint = root.querySelector('#' + CSS.escape(slotId) + '-hint');
    if (hint) { hint.hidden = true; hint.textContent = ''; }
  }

  // ── Click/Tap-Delegation ────────────────────────────────
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    // Action-Buttons (check, reset)
    const actionEl = t.closest('[data-td-action]');
    if (actionEl && root.contains(actionEl)) {
      const action = actionEl.getAttribute('data-td-action');
      if (action === 'check') { check(); return; }
      if (action === 'reset') { reset(); return; }
      if (action === 'pick') {
        const cardId = actionEl.getAttribute('data-td-card-id');
        if (!cardId) return;
        // Wenn schon Pickup laeuft: dieser Click = Drop (wenn Click war
        // direkt auf einer Card im Tray = swap-pickup). Standard: starte
        // Keyboard-Pickup wenn nichts gerade laeuft.
        if (state.pickup && state.pickup.cardId === cardId) {
          // Erneuter Click auf gleiche Card: cancel.
          cancelPickup();
          return;
        }
        if (state.pickup) cancelPickup();
        startPickup(cardId, 'kb');
        return;
      }
    }
    // Click auf Achse waehrend Pickup = Drop dort.
    if (state.pickup && axis && axis.contains(t)) {
      const y = pointerToYear(ev.clientX);
      if (y != null) {
        state.pickup.year = y;
        commitPickup();
      }
    }
  }

  // ── Keyboard ────────────────────────────────────────────
  function onKeydown(ev) {
    if (unmounted) return;
    if (state.pickup) {
      // Im Pickup: Pfeile, Enter, Escape, Pos1/End
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        const step = ev.shiftKey ? 5 : 1;
        updatePickupYear(state.pickup.year - step);
        return;
      }
      if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        const step = ev.shiftKey ? 5 : 1;
        updatePickupYear(state.pickup.year + step);
        return;
      }
      if (ev.key === 'Home') {
        ev.preventDefault();
        updatePickupYear(norm.minYear);
        return;
      }
      if (ev.key === 'End') {
        ev.preventDefault();
        updatePickupYear(norm.maxYear);
        return;
      }
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        ev.preventDefault();
        commitPickup();
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelPickup();
        return;
      }
    }
  }

  // ── Pointer-Drag (Maus + Touch) ─────────────────────────
  // Pattern: pointerdown auf .lf-td-card / .lf-td-pin startet Drag im
  // 'pointer'-Mode; pointermove updated Ghost-Position; pointerup commit.
  let pointerActive = null; // { cardId, pointerId }
  function onPointerdown(ev) {
    if (unmounted) return;
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const card = t.closest('[data-td-action="pick"]');
    if (!card || !root.contains(card)) return;
    const cardId = card.getAttribute('data-td-card-id');
    if (!cardId) return;
    // Wenn KB-Pickup gerade laeuft: cancel zuerst.
    if (state.pickup && state.pickupMode === 'kb') cancelPickup();

    pointerActive = { cardId: cardId, pointerId: ev.pointerId };
    // Capture damit auch Move/Up ausserhalb des Card-Elements ankommen.
    try { card.setPointerCapture(ev.pointerId); } catch (e) {}
    // Initial-Year: aktueller Mitten-Wert oder placement.
    let initialYear;
    if (state.placements.has(cardId)) {
      initialYear = state.placements.get(cardId);
      state.placements.delete(cardId);
    } else {
      initialYear = pointerToYear(ev.clientX);
      if (initialYear == null) initialYear = Math.round((norm.minYear + norm.maxYear) / 2);
    }
    state.pickup = { cardId: cardId, year: initialYear };
    state.pickupMode = 'pointer';
    if (state.status === 'checked') {
      state.status = 'predict';
      state.cardResults.clear();
    }
    rerenderAll();
    showCursor(initialYear);
    showGhostFor(cardId, initialYear);
  }
  function onPointermove(ev) {
    if (!pointerActive) return;
    if (ev.pointerId !== pointerActive.pointerId) return;
    const y = pointerToYear(ev.clientX);
    if (y == null) return;
    if (!state.pickup) return;
    state.pickup.year = y;
    showCursor(y);
    showGhostFor(state.pickup.cardId, y);
    // Verhindere unerwuenschtes Scrollen waehrend Touch-Drag (passive=false
    // beim Listener). Nur preventDefault wenn auf der Achse.
    if (ev.pointerType === 'touch' && axis && axis.getBoundingClientRect()) {
      try { ev.preventDefault(); } catch (e) {}
    }
  }
  function onPointerup(ev) {
    if (!pointerActive) return;
    if (ev.pointerId !== pointerActive.pointerId) return;
    pointerActive = null;
    if (!state.pickup) return;
    // Wenn pointer ueber der Achse losgelassen: Drop dort, sonst Drop am
    // letzten bekannten Year (state.pickup.year wurde im move-Handler
    // upgedated). Falls niemals ueber Achse: einfach zurueck in Tray.
    const rect = axis ? axis.getBoundingClientRect() : null;
    if (rect && ev.clientX >= rect.left && ev.clientX <= rect.right
            && ev.clientY >= rect.top  - 80
            && ev.clientY <= rect.bottom + 80) {
      const y = pointerToYear(ev.clientX);
      if (y != null) state.pickup.year = y;
      commitPickup();
    } else {
      cancelPickup();
    }
  }
  function onPointercancel(ev) {
    if (!pointerActive) return;
    if (ev.pointerId !== pointerActive.pointerId) return;
    pointerActive = null;
    cancelPickup();
  }

  // Listener anhaengen.
  if (root) {
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('pointerdown', onPointerdown);
    root.addEventListener('pointermove', onPointermove, { passive: false });
    root.addEventListener('pointerup', onPointerup);
    root.addEventListener('pointercancel', onPointercancel);
  }

  // ─── Instance ───
  return {
    widgetType: 'timeline-drop',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
        try { root.removeEventListener('keydown', onKeydown); } catch (e) {}
        try { root.removeEventListener('pointerdown', onPointerdown); } catch (e) {}
        try { root.removeEventListener('pointermove', onPointermove); } catch (e) {}
        try { root.removeEventListener('pointerup', onPointerup); } catch (e) {}
        try { root.removeEventListener('pointercancel', onPointercancel); } catch (e) {}
      }
      pointerActive = null;
      answerCbs.length = 0;
    },

    onAnswer(cb) {
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      const placements = [];
      for (const [cid, y] of state.placements) placements.push([cid, y]);
      const results = [];
      for (const [cid, r] of state.cardResults) results.push([cid, r]);
      return {
        placements: placements,
        cardResults: results,
        status: state.status
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      const known = new Set(state.config.cards.map(c => c.id));
      state.placements = new Map();
      if (Array.isArray(s.placements)) {
        for (const e of s.placements) {
          if (!Array.isArray(e) || e.length !== 2) continue;
          const cid = e[0]; const y = Number(e[1]);
          if (!known.has(cid) || !Number.isFinite(y)) continue;
          state.placements.set(cid, _clampYear(y, norm.minYear, norm.maxYear));
        }
      }
      state.cardResults = new Map();
      if (Array.isArray(s.cardResults)) {
        for (const e of s.cardResults) {
          if (!Array.isArray(e) || e.length !== 2) continue;
          if (!known.has(e[0])) continue;
          if (e[1] === 'correct' || e[1] === 'wrong') state.cardResults.set(e[0], e[1]);
        }
      }
      if (s.status === 'predict' || s.status === 'checked') state.status = s.status;
      state.pickup = null;
      state.pickupMode = null;
      hideCursor();
      hideGhost();
      rerenderAll();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'timeline-drop',
    unmount() {},
    onAnswer() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'timeline-drop', mount: mount };
export { mount };
