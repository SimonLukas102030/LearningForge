// ══════════════════════════════════════════
//  LearningForge — Widget: hot-spot
//  Migrated from app.js:3460-3837 (Phase 0 Commit 8)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════
//
// Schueler klickt auf das Bild und sucht alle Spots. Jeder Spot ist als
// normalisierte (x,y) ∈ [0,1]² mit Toleranzradius r definiert. Treffer →
// Marker (Check-Mark + Tooltip mit label/explanation). Daneben → Ripple-
// Effekt + Hint. "Loesung anzeigen" gibt auf und zeigt verbleibende Spots
// als faded Marker. Bei allen-gefunden → reveal blendet ein.
//
// Hard-Rule #3: setup, question, reveal, spot.label, spot.explanation sind
// HTML-entity-encoded vom Author und gehen 1:1 ins innerHTML — kein
// escapeHtml(). image-URL + alt-Text gehen via _escapeAttr in HTML-Attribute.
// alt-Text ist plain-decoded (decodeHtmlEntities) damit Screenreader nicht
// "ampersand b-d-quo" liest.
//
// Keyboard-Nav: Original hatte BEREITS Spot-Buttons-Fallback unter dem Bild
// — jeder Spot kriegt einen generisch nummerierten Button "Spot N", durch
// Tab navigierbar, Enter/Space toggelt found-State (kein Treffer-Test, weil
// der Button generisch ist; pragmatisch fuer a11y-User die das Bild nicht
// sehen). Wurde 1:1 uebernommen — keine neue Tab-Variante noetig.
//
// State pro Instance: { config (normalized), foundSpotIds (Set<int>),
// status, gaveUp }. Status: 'predict' | 'complete'. gaveUp ist ein
// orthogonales Flag (ein User der gaveUp und nichts gefunden hat ist
// "predict + gaveUp", nicht "complete").
//
// Original hatte einen document-global click-Listener (idempotent via
// document.__lfHotSpotBound). Im Modul-Form delegieren wir auf root —
// pro Instance ein Listener, beim unmount() sauber entfernt.
//
// Reduce-Motion: pulse-Animation auf complete + ripple-Effekt werden
// uebersprungen (Spec R-2 / a11y).

import { lfWidgetReducedMotion } from './_base.js';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-hs-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

// HTML-Attribut-Escape (& " ' < >). Lokal — Widget self-contained.
function _escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// HTML-Entity-Decoder fuer alt-Attribut (geht in Accessibility-Tree als
// Plaintext, sonst wuerde Screenreader Entities ansagen). Lokal repliziert
// — Widget bleibt self-contained.
function _decodeHtmlEntities(s) {
  if (!s) return '';
  const ta = document.createElement('textarea');
  ta.innerHTML = String(s);
  return ta.value;
}

// Defensive Validation: image non-empty, spots-Array mit min. 1 Eintrag,
// jeder Spot mit valider x∈[0,1], y∈[0,1], r∈(0,1] (default→tolerance),
// label string. tolerance default 0.04. Invalide Spots werden uebersprungen;
// wenn am Ende < 1 valid → Config invalid (null returned).
function _normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const image = typeof rawConfig.image === 'string' ? rawConfig.image.trim() : '';
  if (!image) return null;

  let tolerance = Number(rawConfig.tolerance);
  if (!isFinite(tolerance) || tolerance <= 0 || tolerance > 0.5) tolerance = 0.04;

  const rawSpots = Array.isArray(rawConfig.spots) ? rawConfig.spots : [];
  const spots = [];
  for (let i = 0; i < rawSpots.length; i++) {
    const s = rawSpots[i];
    if (!s || typeof s !== 'object') continue;
    const x = Number(s.x);
    const y = Number(s.y);
    if (!isFinite(x) || x < 0 || x > 1) continue;
    if (!isFinite(y) || y < 0 || y > 1) continue;
    let r = Number(s.r);
    if (!isFinite(r) || r <= 0 || r > 1) r = tolerance;
    const label = typeof s.label === 'string' ? s.label : ('Spot ' + (i + 1));
    const explanation = typeof s.explanation === 'string' ? s.explanation : '';
    spots.push({ x: x, y: y, r: r, label: label, explanation: explanation });
  }
  if (spots.length < 1) return null;

  const setup    = typeof rawConfig.setup    === 'string' ? rawConfig.setup    : '';
  const question = typeof rawConfig.question === 'string' ? rawConfig.question : '';
  const alt      = typeof rawConfig.alt      === 'string' ? rawConfig.alt      : '';
  const reveal   = typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : '';

  // alt-Fallback wenn leer: question (decoded) oder generisch.
  let altPlain;
  if (alt) {
    altPlain = _decodeHtmlEntities(alt);
  } else if (question) {
    altPlain = _decodeHtmlEntities(question);
    try { console.warn('[LF/hot-spot] config.alt missing — falling back to question for alt-text. Author should provide explicit alt.'); } catch (e) {}
  } else {
    altPlain = 'Aufgabenbild';
    try { console.warn('[LF/hot-spot] config.alt + config.question both missing — using generic alt. Please supply alt for accessibility.'); } catch (e) {}
  }

  return {
    setup: setup,
    question: question,
    image: image,
    alt: altPlain,
    spots: spots,
    tolerance: tolerance,
    reveal: reveal
  };
}

// Initial-HTML.
function _renderHtml(norm, slotId) {
  const setupHtml    = norm.setup    ? '<div class="lf-hs-setup">' + norm.setup + '</div>' : '';
  const questionHtml = norm.question ? '<h4 class="lf-hs-question">' + norm.question + '</h4>' : '';

  // Buttons-Fallback unter dem Bild: jeder Spot bekommt einen Button "Spot N",
  // generisch nummeriert (kein Label-Spoiler). Tab-navigierbar.
  const spotButtonsHtml = norm.spots.map((_s, i) =>
    '<button type="button" class="lf-hs-spot-btn" '
    + 'data-hs-action="click-spot-button" data-hs-slot="' + _escapeAttr(slotId) + '" '
    + 'data-hs-spot-index="' + i + '" '
    + 'aria-label="Spot ' + (i + 1) + ' ausw\xe4hlen">Spot ' + (i + 1) + '</button>'
  ).join('');

  const revealHtml = norm.reveal
    ? '<div class="lf-hs-reveal" id="' + _escapeAttr(slotId) + '-reveal" hidden>'
    +    '<div class="lf-hs-reveal-heading">Erkl\xe4rung</div>'
    +    '<div class="lf-hs-reveal-body">' + norm.reveal + '</div>'
    + '</div>'
    : '';

  return '<div class="lf-widget-hot-spot lf-hs-state-predict" '
       +   'id="' + _escapeAttr(slotId) + '" data-hs-slot="' + _escapeAttr(slotId) + '">'
       +   setupHtml
       +   questionHtml
       +   '<figure class="lf-hs-figure">'
       +     '<img class="lf-hs-image" '
       +       'src="' + _escapeAttr(norm.image) + '" '
       +       'alt="' + _escapeAttr(norm.alt) + '" '
       +       'loading="lazy" '
       +       'data-hs-action="click-image" data-hs-slot="' + _escapeAttr(slotId) + '" '
       +       'draggable="false">'
       +     '<div class="lf-hs-overlay" id="' + _escapeAttr(slotId) + '-overlay" aria-hidden="true"></div>'
       +   '</figure>'
       +   '<div class="lf-hs-status" id="' + _escapeAttr(slotId) + '-status" role="status" aria-live="polite">'
       +     '0 von ' + norm.spots.length + ' gefunden'
       +   '</div>'
       +   '<div class="lf-hs-hint" id="' + _escapeAttr(slotId) + '-hint" role="status" aria-live="polite" hidden></div>'
       +   '<div class="lf-hs-spot-buttons" aria-label="Spot-Auswahl per Tastatur">' + spotButtonsHtml + '</div>'
       +   '<div class="lf-hs-actions">'
       +     '<button type="button" class="lf-hs-give-up" '
       +       'data-hs-action="give-up" data-hs-slot="' + _escapeAttr(slotId) + '">L\xf6sung anzeigen</button>'
       +   '</div>'
       +   revealHtml
       + '</div>';
}

// ─── mount() ──────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) {
    return _emptyInstance();
  }

  const norm = _normalizeConfig(config);
  const slotId = _nextSlotId();

  // Empty-State: nicht konfiguriert.
  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-hot-spot lf-hs-empty" data-hs-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  // Per-Instance-State.
  const state = {
    config:       norm,
    foundSpotIds: new Set(),
    status:       'predict', // 'predict' | 'complete'
    gaveUp:       false
  };
  let unmounted = false;
  const answerCbs = [];

  container.innerHTML = _renderHtml(norm, slotId);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Interaktive Aufgabe: Bildausschnitte finden');
  } catch (e) {}

  // Reduce-Motion: skip pulse + ripple (Spec R-2 / a11y).
  const reducedMotion = lfWidgetReducedMotion();

  // ─── Refresh: Overlay-Marker + Status + Buttons + Reveal. ───
  // Bild selbst wird NICHT neu gerendert (sonst lade-Flicker / Layout-Shift).
  function refresh() {
    if (unmounted || !root) return;
    const overlay  = root.querySelector('#' + CSS.escape(slotId) + '-overlay');
    const statusEl = root.querySelector('#' + CSS.escape(slotId) + '-status');
    const hint     = root.querySelector('#' + CSS.escape(slotId) + '-hint');
    const reveal   = root.querySelector('#' + CSS.escape(slotId) + '-reveal');
    const giveUp   = root.querySelector('.lf-hs-give-up');

    // State-Klassen
    root.classList.toggle('lf-hs-state-predict',  state.status === 'predict');
    root.classList.toggle('lf-hs-state-complete', state.status === 'complete');
    // Dataset-Flag fuer CSS (z.B. cursor nach Give-Up zuruecksetzen).
    root.dataset.hsGaveup = state.gaveUp ? 'true' : 'false';

    // Overlay-Marker neu aufbauen. Hit-Marker fuer found, faded-Marker fuer
    // not-found wenn gaveUp.
    if (overlay) {
      let markersHtml = '';
      for (let i = 0; i < state.config.spots.length; i++) {
        const s = state.config.spots[i];
        const found = state.foundSpotIds.has(i);
        if (found) {
          // Treffer-Marker mit Tooltip (label + optional explanation).
          // label/explanation sind HTML-entity-encoded → 1:1 in innerHTML (Hard-Rule #3).
          const tooltipBody = s.explanation
            ? '<span class="lf-hs-tooltip-label">' + s.label + '</span><span class="lf-hs-tooltip-explanation">' + s.explanation + '</span>'
            : '<span class="lf-hs-tooltip-label">' + s.label + '</span>';
          markersHtml += '<span class="lf-hs-marker" '
            + 'style="left: ' + (s.x * 100).toFixed(2) + '%; top: ' + (s.y * 100).toFixed(2) + '%;">'
            + '<span class="lf-hs-marker-check" aria-hidden="true">&#10003;</span>'
            + '<span class="lf-hs-tooltip">' + tooltipBody + '</span>'
            + '</span>';
        } else if (state.gaveUp) {
          // Faded marker (Loesung-anzeigen-Modus): zeigt verbleibende Spots.
          markersHtml += '<span class="lf-hs-marker lf-hs-marker-faded" '
            + 'style="left: ' + (s.x * 100).toFixed(2) + '%; top: ' + (s.y * 100).toFixed(2) + '%;">'
            + '<span class="lf-hs-marker-dot" aria-hidden="true"></span>'
            + '<span class="lf-hs-tooltip"><span class="lf-hs-tooltip-label">' + s.label + '</span></span>'
            + '</span>';
        }
      }
      overlay.innerHTML = markersHtml;
    }

    // Status-Zeile
    if (statusEl) {
      const found = state.foundSpotIds.size;
      const total = state.config.spots.length;
      if (state.status === 'complete') {
        statusEl.textContent = 'Alle ' + total + ' Spots gefunden ✓';
      } else if (state.gaveUp) {
        statusEl.textContent = found + ' von ' + total + ' gefunden — restliche Spots werden angezeigt.';
      } else {
        statusEl.textContent = found + ' von ' + total + ' gefunden';
      }
    }

    // Spot-Buttons: aria-disabled wenn schon found oder complete oder gaveUp.
    const spotButtons = root.querySelectorAll('.lf-hs-spot-btn');
    spotButtons.forEach(btn => {
      const idx = parseInt(btn.getAttribute('data-hs-spot-index'), 10);
      const isFound = state.foundSpotIds.has(idx);
      const lock = isFound || state.status === 'complete' || state.gaveUp;
      btn.disabled = lock;
      if (lock) btn.setAttribute('aria-disabled', 'true');
      else btn.removeAttribute('aria-disabled');
      btn.classList.toggle('lf-hs-spot-btn-found', isFound);
      // aria-label spiegelt den State (found / gaveUp / predict) fuer Screen-Reader.
      btn.setAttribute('aria-label',
        isFound        ? 'Spot ' + (idx + 1) + ', gefunden'
        : state.gaveUp ? 'Spot ' + (idx + 1) + ', L\xf6sung wurde angezeigt'
        :                'Spot ' + (idx + 1) + ' ausw\xe4hlen');
    });

    // Give-up-Button: ausblenden wenn complete oder bereits gaveUp.
    if (giveUp) {
      if (state.status === 'complete' || state.gaveUp) {
        giveUp.hidden = true;
      } else {
        giveUp.hidden = false;
      }
    }

    // Hint + Reveal je nach Status.
    if (state.status === 'complete') {
      if (hint) hint.hidden = true;
      if (reveal) reveal.hidden = !state.config.reveal;
    } else {
      // hint wird transient gesetzt von Click-Handler (z.B. bei Falsch-Klick),
      // aber bei state-changes ohne hint-event NICHT geclearet hier — der
      // Caller (hit/miss/giveUp) verwaltet hint selbst.
      if (reveal) reveal.hidden = true;
    }
  }

  // ─── Click-Image: x/y in normalized coords, finde naechsten Spot, vergleich r. ───
  function handleImageClick(img, clientX, clientY) {
    if (unmounted) return;
    if (state.status === 'complete') return;
    if (state.gaveUp) return;
    const norm = state.config;

    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return; // Image not yet rendered.
    const nx = (clientX - rect.left) / rect.width;
    const ny = (clientY - rect.top) / rect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    // Find best (closest) matching spot within its r.
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < norm.spots.length; i++) {
      if (state.foundSpotIds.has(i)) continue; // schon found → ignorieren
      const s = norm.spots[i];
      const dx = s.x - nx;
      const dy = s.y - ny;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = (typeof s.r === 'number' && s.r > 0) ? s.r : norm.tolerance;
      if (dist <= r && dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      hit(bestIdx);
    } else {
      miss(nx, ny);
    }
  }

  function hit(spotIdx) {
    if (unmounted) return;
    state.foundSpotIds.add(spotIdx);
    const total = state.config.spots.length;
    const wasComplete = state.status === 'complete';
    if (state.foundSpotIds.size >= total) {
      state.status = 'complete';
    }
    // Hint clearen — User hat gerade Treffer gemacht.
    if (root) {
      const hint = root.querySelector('#' + CSS.escape(slotId) + '-hint');
      if (hint) { hint.hidden = true; hint.textContent = ''; }
    }
    refresh();
    // Pulse-Animation auf allen Markern bei complete (skip bei reduce-motion).
    if (state.status === 'complete' && !wasComplete && !reducedMotion && root) {
      root.querySelectorAll('.lf-hs-marker').forEach(el => el.classList.add('lf-hs-pulse'));
      setTimeout(() => {
        if (unmounted || !root.isConnected) return;
        root.querySelectorAll('.lf-hs-marker').forEach(el => el.classList.remove('lf-hs-pulse'));
      }, 700);
    }

    // onAnswer-Hook (Phase-2 XP-Vergabe-Boundary, Spec). Feuert pro Treffer
    // mit partial = found/total. correct=true erst wenn alle gefunden.
    const found = state.foundSpotIds.size;
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: state.status === 'complete',
          partial: total > 0 ? found / total : 0,
          raw: { foundCount: found, total: total, gaveUp: state.gaveUp }
        });
      } catch (e) { console.warn('[hot-spot onAnswer]', e); }
    });
  }

  function miss(nx, ny) {
    if (unmounted || !root) return;
    // Ripple-Effekt am Klick-Point. Position relativ zum overlay. Skip bei
    // reduce-motion — dort kein visuelles Feedback ueber das hint hinaus.
    const overlay = root.querySelector('#' + CSS.escape(slotId) + '-overlay');
    if (overlay && !reducedMotion) {
      const ripple = document.createElement('span');
      ripple.className = 'lf-hs-ripple';
      ripple.style.left = (nx * 100).toFixed(2) + '%';
      ripple.style.top  = (ny * 100).toFixed(2) + '%';
      overlay.appendChild(ripple);
      setTimeout(() => {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      }, 600);
    }
    // Hint
    const hint = root.querySelector('#' + CSS.escape(slotId) + '-hint');
    if (hint) {
      hint.hidden = false;
      hint.textContent = 'Versuche es nochmal — das war daneben.';
    }
  }

  // Spot-Button-Click (a11y-Fallback): toggles found-state des Spots direkt
  // (kein Treffer-Test, weil der Button generisch nummeriert ist und der
  // User per Tastatur "diesen Spot meine ich" sagt). Pragmatisch: das ist
  // der a11y-Pfad fuer Keyboard-/Screenreader-User; sie waeren sonst ganz
  // ausgeschlossen vom Bild-Click. Akzeptabel.
  function clickSpotButton(spotIdx) {
    if (unmounted) return;
    if (state.status === 'complete' || state.gaveUp) return;
    if (state.foundSpotIds.has(spotIdx)) return;
    if (spotIdx < 0 || spotIdx >= state.config.spots.length) return;
    hit(spotIdx);
  }

  // Give-up: alle nicht-gefundenen Spots als faded marker einblenden, reveal
  // einblenden, Status auf "X von Y gefunden — restliche werden angezeigt".
  // Status bleibt 'predict' (nicht 'complete', weil User nicht alle selbst
  // gefunden hat) — gaveUp-Flag steuert UI.
  function giveUp() {
    if (unmounted) return;
    if (state.status === 'complete' || state.gaveUp) return;
    state.gaveUp = true;
    // Hint clearen.
    if (root) {
      const hint = root.querySelector('#' + CSS.escape(slotId) + '-hint');
      if (hint) { hint.hidden = true; hint.textContent = ''; }
    }
    refresh();
    // Reveal nach gaveUp einblenden (manuell, weil refresh nur bei
    // status==='complete' reveal sichtbar macht).
    if (root) {
      const reveal = root.querySelector('#' + CSS.escape(slotId) + '-reveal');
      if (reveal && state.config.reveal) reveal.hidden = false;
    }
    // onAnswer feuert auch bei give-up — partial = aktueller Stand,
    // correct=false (User hat nicht selbst geloest).
    const total = state.config.spots.length;
    const found = state.foundSpotIds.size;
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: false,
          partial: total > 0 ? found / total : 0,
          raw: { foundCount: found, total: total, gaveUp: true }
        });
      } catch (e) { console.warn('[hot-spot onAnswer]', e); }
    });
  }

  // ─── Click-Delegation (root-scoped, kein document-Listener mehr) ───
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-hs-action]');
    if (!el || !root.contains(el)) return;
    if (el.getAttribute('aria-disabled') === 'true' || el.disabled) return;
    const action = el.getAttribute('data-hs-action');
    if (action === 'click-image') {
      // el ist das <img>. clientX/Y kommen von ev.
      handleImageClick(el, ev.clientX, ev.clientY);
    } else if (action === 'click-spot-button') {
      const idxStr = el.getAttribute('data-hs-spot-index');
      const idx = parseInt(idxStr, 10);
      if (isFinite(idx)) clickSpotButton(idx);
    } else if (action === 'give-up') {
      giveUp();
    }
  }

  if (root) {
    root.addEventListener('click', onClick);
  }

  // ─── Instance ───
  return {
    widgetType: 'hot-spot',

    unmount() {
      if (unmounted) return; // Idempotenz (Spec).
      unmounted = true;
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
      }
      // DOM nicht selbst leeren — _loader.js / closeSubtopic schmeissen
      // den Subtree weg. Wir geben nur Listeners + Closure-State frei.
      answerCbs.length = 0;
    },

    onAnswer(cb) {
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      // Plain-JSON-serializable Snapshot. Set -> Array.
      return {
        foundSpotIds: Array.from(state.foundSpotIds),
        status:       state.status,
        gaveUp:       state.gaveUp
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      const total = state.config.spots.length;
      if (Array.isArray(s.foundSpotIds)) {
        state.foundSpotIds = new Set(
          s.foundSpotIds
            .map(n => Number(n))
            .filter(n => Number.isInteger(n) && n >= 0 && n < total)
        );
      }
      if (s.status === 'predict' || s.status === 'complete') {
        state.status = s.status;
      }
      // Konsistenz: wenn alle gefunden -> status complete erzwingen.
      if (state.foundSpotIds.size >= total) state.status = 'complete';
      if (typeof s.gaveUp === 'boolean') state.gaveUp = s.gaveUp;
      refresh();
    }
  };
}

// Stub-Instance fuer Empty-State / kaputten Container. Idempotent unmount.
function _emptyInstance() {
  let done = false;
  return {
    widgetType: 'hot-spot',
    unmount() { done = true; },
    onAnswer() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'hot-spot', mount: mount };
export { mount };
