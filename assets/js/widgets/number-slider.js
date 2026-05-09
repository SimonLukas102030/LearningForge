// ══════════════════════════════════════════
//  LearningForge — Widget: number-slider
//  Migrated from app.js:3036-3437 (Phase 0 Commit 7)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════
//
// Schueler schaetzt einen Zahlenwert per <input type="range">, kriegt Range-
// Reveal mit Toleranz. Use-Cases: "Wie viele Tote forderte Verdun?", "CO2-
// Anstieg seit 1850?", "Schallgeschwindigkeit in Luft?". Pure Predict-Then-
// Reveal-UX, aber mit kontinuierlichem Wert + Toleranz statt MC.
//
// Hard-Rule #3: setup, question, reveal, unit sind HTML-entity-encoded vom
// Author und gehen 1:1 ins innerHTML — kein escapeHtml(). Datenattribute
// via escapeAttr.
//
// State pro Instance: { config (normalized), currentValue, attempts (int),
// lastGuess (number|null) — fuer Marker nach reveal, status }.
// Status: 'predict' | 'wrong' | 'correct' | 'revealed'.
//   'revealed' = nach 3x falsch erzwungener Reveal (Slider lockt, Marker
//   zeigen letzten Tipp + correct).
//
// Custom-Slider-CSS deckt Webkit (-webkit-slider-runnable-track + -thumb)
// und Firefox (::-moz-range-track + -thumb) komplett ab. Touch-Target via
// uebergrosser Thumb (24px Visible) + min-height auf <input>-Wrapper.
//
// Keyboard-Nav ist gratis: <input type="range"> ist nativ keyboard-aware
// (Pfeil-Tasten = step, Page-Up/Down = larger step, Home/End = min/max).
// Original hatte document-global click+input Listener (idempotent via
// document.__lfNumberSliderBound). Im Modul-Form delegieren wir auf root.
//
// Reduce-Motion: pulse + flash-wrong Animationen werden uebersprungen.

import { lfWidgetReducedMotion } from './_base.js';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-ns-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
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

// HTML-Entity-Decoder fuer aria-valuetext (geht in Accessibility-Tree als
// Plaintext). Lokal repliziert — Widget bleibt self-contained.
function _decodeHtmlEntities(s) {
  if (!s) return '';
  const ta = document.createElement('textarea');
  ta.innerHTML = String(s);
  return ta.value;
}

// Snap value auf step-Raster relativ zu min. Bsp.: min=0,step=50000,v=510000 -> 500000.
// Float-Drift via Math.round ausgleichen. Clamp auf [min,max].
function _snap(value, min, max, step) {
  if (!isFinite(value)) value = min;
  if (value < min) value = min;
  if (value > max) value = max;
  if (step > 0) {
    const k = Math.round((value - min) / step);
    value = min + k * step;
    // IEEE-754 Residue eliminieren: auf step's decimal precision runden.
    // Sonst gibt z.B. _snap(0.3, 0, 1, 0.1) => 0.30000000000000004.
    // Display zeigt Schrott + slider.value-Re-Assign triggert Mid-Drag-Jitter.
    const stepStr = String(step);
    const dot = stepStr.indexOf('.');
    if (dot >= 0) {
      const decimals = stepStr.length - dot - 1;
      value = Number(value.toFixed(decimals));
    }
    // Clamp nach Snap fuer Floats (kann gerade ueber max landen).
    if (value > max) value = max - ((value - min) % step);
    if (value < min) value = min;
  }
  return value;
}

// Defensive Validation: min<max, step>0, correct in [min,max], tolerance>=0,
// tolerance<=(max-min)/2. default optional -> fallback (min+max)/2 auf step
// gerundet. Sonst null -> "noch nicht fertig konfiguriert".
function _normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const min  = Number(rawConfig.min);
  const max  = Number(rawConfig.max);
  const step = Number(rawConfig.step);
  const correct = Number(rawConfig.correct);
  const tolerance = Number(rawConfig.tolerance);
  if (!isFinite(min) || !isFinite(max) || min >= max) return null;
  if (!isFinite(step) || step <= 0) return null;
  if (!isFinite(correct) || correct < min || correct > max) return null;
  if (!isFinite(tolerance) || tolerance < 0) return null;
  if (tolerance > (max - min) / 2) return null;
  // default: optional. Fallback = mitte, snap auf step.
  let def;
  if (typeof rawConfig.default === 'number' && isFinite(rawConfig.default)) {
    def = _snap(rawConfig.default, min, max, step);
  } else {
    def = _snap((min + max) / 2, min, max, step);
  }
  const unit = typeof rawConfig.unit === 'string' ? rawConfig.unit : '';
  return {
    setup:     typeof rawConfig.setup    === 'string' ? rawConfig.setup    : '',
    question:  typeof rawConfig.question === 'string' ? rawConfig.question : '',
    min, max, step, correct, tolerance,
    default:   def,
    unit:      unit,
    // Decoded unit fuer aria — einmal parsen statt pro input-tick (~60 Hz waehrend Drag,
    // sonst hunderte Orphan-<textarea>-Nodes/sec via _decodeHtmlEntities).
    unitAria:  _decodeHtmlEntities(unit),
    format:    typeof rawConfig.format   === 'string' ? rawConfig.format   : 'de-DE',
    reveal:    typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : ''
  };
}

// Wert formatieren: Number.toLocaleString(format) + Unit mit &nbsp; falls vorhanden.
// Unit ist HTML-entity-encoded vom Author -> 1:1 in innerHTML. Wert-Teil aus
// toLocaleString ist schon plaintext-safe (nur Ziffern + Locale-Separatoren).
function _formatValue(value, norm) {
  let text;
  try {
    text = Number(value).toLocaleString(norm.format || 'de-DE');
  } catch (e) {
    text = String(value);
  }
  if (norm.unit) return text + '&nbsp;' + norm.unit;
  return text;
}

// Marker-Position auf Slider-Track als Prozent von [min,max]. Clamp auf [0,100]
// damit visuell nichts ueber den Track ueberhaengt (z.B. wenn correct === max).
function _posPct(value, norm) {
  const range = norm.max - norm.min;
  if (range <= 0) return 0;
  const pct = ((value - norm.min) / range) * 100;
  return Math.max(0, Math.min(100, pct));
}

// Plaintext-Format ohne &nbsp; (fuer aria-valuetext, das geht in den
// Accessibility-Tree als Text — Entities wuerden dort angesagt).
function _formatValueAria(value, norm) {
  let text;
  try {
    text = Number(value).toLocaleString(norm.format || 'de-DE');
  } catch (e) {
    text = String(value);
  }
  if (norm.unit) {
    // unit kann HTML-entities haben — pre-decoded in _normalizeConfig (norm.unitAria).
    return text + ' ' + (norm.unitAria || '');
  }
  return text;
}

// Initial-HTML.
function _renderHtml(norm, slotId) {
  const setupHtml    = norm.setup    ? '<div class="lf-ns-setup">' + norm.setup + '</div>' : '';
  const questionHtml = norm.question ? '<h4 class="lf-ns-question">' + norm.question + '</h4>' : '';

  const guessPct = _posPct(norm.default, norm);
  const correctPct = _posPct(norm.correct, norm);

  const revealHtml = norm.reveal
    ? '<div class="lf-ns-reveal" id="' + _escapeAttr(slotId) + '-reveal" hidden>'
    +    '<div class="lf-ns-reveal-heading">Erkl&auml;rung</div>'
    +    '<div class="lf-ns-reveal-body">' + norm.reveal + '</div>'
    + '</div>'
    : '';

  // Slider mit aria-valuetext fuer Screenreader (sagt "500.000 Menschen" statt "500000").
  // Marker-Container hat zwei spans: guess (immer sichtbar) + correct (hidden bis reveal).
  return '<div class="lf-widget-number-slider lf-ns-state-predict" '
       +   'id="' + _escapeAttr(slotId) + '" data-ns-slot="' + _escapeAttr(slotId) + '">'
       +   setupHtml
       +   questionHtml
       +   '<div class="lf-ns-display" id="' + _escapeAttr(slotId) + '-display" '
       +     'role="status" aria-live="polite">' + _formatValue(norm.default, norm) + '</div>'
       +   '<div class="lf-ns-slider-wrap">'
       +     '<div class="lf-ns-markers" aria-hidden="true">'
       +       '<span class="lf-ns-marker lf-ns-marker-guess" '
       +         'id="' + _escapeAttr(slotId) + '-marker-guess" '
       +         'style="left: ' + guessPct + '%;" hidden></span>'
       +       '<span class="lf-ns-marker lf-ns-marker-correct" '
       +         'id="' + _escapeAttr(slotId) + '-marker-correct" '
       +         'style="left: ' + correctPct + '%;" hidden></span>'
       +     '</div>'
       +     '<input type="range" class="lf-ns-input" '
       +       'data-ns-slot="' + _escapeAttr(slotId) + '" '
       +       'min="' + _escapeAttr(String(norm.min)) + '" '
       +       'max="' + _escapeAttr(String(norm.max)) + '" '
       +       'step="' + _escapeAttr(String(norm.step)) + '" '
       +       'value="' + _escapeAttr(String(norm.default)) + '" '
       +       'aria-valuetext="' + _escapeAttr(_formatValueAria(norm.default, norm)) + '">'
       +   '</div>'
       +   '<div class="lf-ns-hint" id="' + _escapeAttr(slotId) + '-hint" role="status" aria-live="polite" hidden></div>'
       +   '<div class="lf-ns-actions">'
       +     '<button type="button" class="lf-ns-confirm" '
       +       'data-ns-action="confirm" data-ns-slot="' + _escapeAttr(slotId) + '">Best&auml;tigen</button>'
       +     '<button type="button" class="lf-ns-reset" '
       +       'data-ns-action="reset" data-ns-slot="' + _escapeAttr(slotId) + '" hidden>Nochmal versuchen</button>'
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
      '<div class="lf-widget-number-slider lf-ns-empty" data-ns-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  // Per-Instance-State.
  const state = {
    config:       norm,
    currentValue: norm.default,
    attempts:     0,
    lastGuess:    null,
    status:       'predict' // 'predict' | 'wrong' | 'correct' | 'revealed'
  };
  let unmounted = false;
  const answerCbs = [];

  container.innerHTML = _renderHtml(norm, slotId);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Interaktive Aufgabe: Zahlenwert schätzen');
  } catch (e) {}

  // Reduce-Motion: skip pulse + flash-wrong (Spec R-2 / a11y).
  const reducedMotion = lfWidgetReducedMotion();

  // ─── Refresh: Display + Hint + Marker + State-Klassen + Buttons + Reveal-Sichtbarkeit. ───
  // Kein Re-Render des Slider-Inputs (sonst geht Drag-Fokus / Active-Touch verloren).
  function refresh() {
    if (unmounted || !root) return;
    const display     = root.querySelector('#' + CSS.escape(slotId) + '-display');
    const hint        = root.querySelector('#' + CSS.escape(slotId) + '-hint');
    const reveal      = root.querySelector('#' + CSS.escape(slotId) + '-reveal');
    const confirmBtn  = root.querySelector('.lf-ns-confirm');
    const resetBtn    = root.querySelector('.lf-ns-reset');
    const slider      = root.querySelector('.lf-ns-input');
    const markerGuess = root.querySelector('#' + CSS.escape(slotId) + '-marker-guess');
    const markerCorrect = root.querySelector('#' + CSS.escape(slotId) + '-marker-correct');

    // Display zeigt aktuellen Wert (live waehrend predict, frozen letzter-Tipp ab correct/revealed).
    const showValue = (state.status === 'correct' || state.status === 'revealed')
      ? (state.lastGuess != null ? state.lastGuess : state.currentValue)
      : state.currentValue;
    if (display) display.innerHTML = _formatValue(showValue, state.config);

    // State-Klassen
    root.classList.toggle('lf-ns-state-predict',  state.status === 'predict');
    root.classList.toggle('lf-ns-state-wrong',    state.status === 'wrong');
    root.classList.toggle('lf-ns-state-correct',  state.status === 'correct');
    root.classList.toggle('lf-ns-state-revealed', state.status === 'revealed');

    // Slider-Lock + aria-valuetext aktuell halten.
    if (slider) {
      const lock = (state.status === 'correct' || state.status === 'revealed');
      slider.disabled = lock;
      if (lock) slider.setAttribute('aria-disabled', 'true');
      else slider.removeAttribute('aria-disabled');
      // Slider-Wert nur setzen wenn er abweicht (sonst springt das Thumb mid-drag).
      const sv = String(state.currentValue);
      if (slider.value !== sv) slider.value = sv;
      slider.setAttribute('aria-valuetext', _formatValueAria(state.currentValue, state.config));
    }

    // Marker. Guess sichtbar nur nach erstem confirm. Correct nur nach correct/revealed.
    if (markerGuess) {
      if (state.lastGuess != null) {
        markerGuess.hidden = false;
        markerGuess.style.left = _posPct(state.lastGuess, state.config) + '%';
      } else {
        markerGuess.hidden = true;
      }
    }
    if (markerCorrect) {
      if (state.status === 'correct' || state.status === 'revealed') {
        markerCorrect.hidden = false;
        markerCorrect.style.left = _posPct(state.config.correct, state.config) + '%';
      } else {
        markerCorrect.hidden = true;
      }
    }

    // Hint + Buttons + Reveal je nach Status.
    if (state.status === 'wrong') {
      if (hint) {
        hint.hidden = false;
        const direction = (state.lastGuess != null && state.lastGuess < state.config.correct)
          ? 'Zu niedrig — versuche höher.'
          : 'Zu hoch — versuche niedriger.';
        const remaining = Math.max(0, 3 - state.attempts);
        hint.textContent = remaining > 0
          ? direction + ' (Noch ' + remaining + ' ' + (remaining === 1 ? 'Versuch' : 'Versuche') + ')'
          : direction;
      }
      if (confirmBtn) { confirmBtn.hidden = false; confirmBtn.disabled = false; confirmBtn.textContent = 'Bestätigen'; }
      if (resetBtn)   resetBtn.hidden = true;
      if (reveal)     reveal.hidden = true;
    } else if (state.status === 'correct') {
      if (hint) {
        hint.hidden = false;
        hint.textContent = 'Treffer! Im Toleranz-Bereich.';
      }
      if (confirmBtn) {
        confirmBtn.hidden = false;
        confirmBtn.disabled = true;
        confirmBtn.setAttribute('aria-disabled', 'true');
        confirmBtn.textContent = 'Erledigt ✓';
      }
      if (resetBtn) resetBtn.hidden = true;
      if (reveal)   reveal.hidden = !state.config.reveal;
    } else if (state.status === 'revealed') {
      if (hint) {
        hint.hidden = false;
        hint.innerHTML = 'Der korrekte Wert war ' + _formatValue(state.config.correct, state.config) + '.';
      }
      if (confirmBtn) {
        confirmBtn.hidden = false;
        confirmBtn.disabled = true;
        confirmBtn.setAttribute('aria-disabled', 'true');
        confirmBtn.textContent = 'Aufgelöst';
      }
      if (resetBtn) resetBtn.hidden = true;
      if (reveal)   reveal.hidden = !state.config.reveal;
    } else {
      // predict (initial)
      if (hint)       hint.hidden = true;
      if (confirmBtn) {
        confirmBtn.hidden = false;
        confirmBtn.disabled = false;
        confirmBtn.removeAttribute('aria-disabled');
        confirmBtn.textContent = 'Bestätigen';
      }
      if (resetBtn)   resetBtn.hidden = true;
      if (reveal)     reveal.hidden = true;
    }
  }

  // ─── Update: Slider-Drag aktualisiert state.currentValue + Display. ───
  // Snap auf step (HTML5-range macht das schon, aber doppelt-snappen ist gratis).
  // Wenn vorher 'wrong' war -> zurueck auf 'predict' (User darf wieder bestaetigen).
  function update(rawValue) {
    if (unmounted) return;
    if (state.status === 'correct' || state.status === 'revealed') return;
    const v = _snap(Number(rawValue), state.config.min, state.config.max, state.config.step);
    state.currentValue = v;
    if (state.status === 'wrong') {
      // Hint clearen + zurueck auf predict (User hat etwas geaendert -> frischer Versuch).
      state.status = 'predict';
    }
    refresh();
  }

  // ─── Confirm: User bestaetigt seinen Tipp. ───
  function confirm() {
    if (unmounted) return;
    if (state.status === 'correct' || state.status === 'revealed') return;
    const norm = state.config;
    state.attempts += 1;
    state.lastGuess = state.currentValue;
    const diff = Math.abs(state.currentValue - norm.correct);
    let correctNow = false;
    if (diff <= norm.tolerance) {
      state.status = 'correct';
      correctNow = true;
      refresh();
      // Pulse-Animation auf Display (skip bei reduce-motion).
      if (!reducedMotion && root) {
        const display = root.querySelector('#' + CSS.escape(slotId) + '-display');
        if (display) {
          display.classList.add('lf-ns-pulse');
          setTimeout(() => {
            if (unmounted || !root.isConnected) return;
            display.classList.remove('lf-ns-pulse');
          }, 700);
        }
      }
    } else {
      if (state.attempts >= 3) {
        // Forced Reveal.
        state.status = 'revealed';
        refresh();
      } else {
        state.status = 'wrong';
        refresh();
        // Flash auf Display + Shake (skip bei reduce-motion).
        if (!reducedMotion && root) {
          const display = root.querySelector('#' + CSS.escape(slotId) + '-display');
          if (display) {
            display.classList.add('lf-ns-flash-wrong');
            setTimeout(() => {
              if (unmounted || !root.isConnected) return;
              display.classList.remove('lf-ns-flash-wrong');
            }, 450);
          }
        }
      }
    }

    // onAnswer-Hook (Phase-2 XP-Vergabe-Boundary, Spec).
    // partial = 1 wenn correct, sonst 1 - clamp(diff/range, 0, 1) als Naehe-Score.
    const range = norm.max - norm.min;
    const closeness = range > 0 ? Math.max(0, 1 - (diff / range)) : 0;
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: correctNow,
          partial: correctNow ? 1 : closeness,
          raw: {
            guess: state.lastGuess,
            correctValue: norm.correct,
            attempts: state.attempts,
            status: state.status
          }
        });
      } catch (e) { console.warn('[number-slider onAnswer]', e); }
    });
  }

  // ─── Click-Delegation (root-scoped) ───
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const btn = t.closest('[data-ns-action]');
    if (!btn || !root.contains(btn)) return;
    if (btn.getAttribute('aria-disabled') === 'true' || btn.disabled) return;
    const action = btn.getAttribute('data-ns-action');
    if (action === 'confirm') {
      confirm();
    }
    // 'reset' wird heute nicht angeboten (Spec sagt: Slider lockt bei correct/
    // revealed. Reset-Button ist hidden. Hook bleibt fuer Future.)
  }

  // ─── Input-Delegation (root-scoped) ───
  // Feuert kontinuierlich waehrend Drag — wir snappen + updaten state.currentValue + Display.
  // Pfeil-Tasten / Page-Up/Down / Home/End auf <input type="range"> triggern
  // ebenfalls 'input' Events nativ — keyboard-nav ist gratis.
  function onInput(ev) {
    if (unmounted) return;
    const target = ev.target;
    if (!target || target.tagName !== 'INPUT') return;
    if (target.type !== 'range') return;
    if (!root.contains(target)) return;
    update(target.value);
  }

  if (root) {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
  }

  // ─── Instance ───
  return {
    widgetType: 'number-slider',

    unmount() {
      if (unmounted) return; // Idempotenz (Spec).
      unmounted = true;
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
        try { root.removeEventListener('input', onInput); } catch (e) {}
      }
      // DOM nicht selbst leeren — _loader.js / closeSubtopic schmeissen
      // den Subtree weg. Wir geben nur Listeners + Closure-State frei.
      answerCbs.length = 0;
    },

    onAnswer(cb) {
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      // Plain-JSON-serializable Snapshot (Spec).
      return {
        currentValue: state.currentValue,
        attempts:     state.attempts,
        lastGuess:    state.lastGuess,
        status:       state.status
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.currentValue === 'number' && isFinite(s.currentValue)) {
        state.currentValue = _snap(s.currentValue, state.config.min, state.config.max, state.config.step);
      }
      if (typeof s.attempts === 'number' && s.attempts >= 0) {
        state.attempts = s.attempts | 0;
      }
      if (s.lastGuess === null
          || (typeof s.lastGuess === 'number' && isFinite(s.lastGuess))) {
        state.lastGuess = s.lastGuess;
      }
      if (s.status === 'predict' || s.status === 'wrong'
          || s.status === 'correct' || s.status === 'revealed') {
        state.status = s.status;
      }
      refresh();
    }
  };
}

// Stub-Instance fuer Empty-State / kaputten Container. Idempotent unmount.
function _emptyInstance() {
  let done = false;
  return {
    widgetType: 'number-slider',
    unmount() { done = true; },
    onAnswer() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'number-slider', mount: mount };
export { mount };
