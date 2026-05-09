// ══════════════════════════════════════════
//  LearningForge — Widget: predict-reveal
//  Migrated from app.js:1796-2012 (Phase 0 Commit 4)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════
//
// Schueler tippt eine Vorhersage, sieht dann die richtige Antwort + Erklaerung.
// "Falsch raten ist Teil des Lernens" — falsche Antworten lassen sich nach
// Retry erneut ausschliessen, bis nur noch die richtige uebrig ist.
//
// Hard-Rule #3: setup/question/label/explanation/reveal kommen entity-encoded
// aus dem JSON und gehen 1:1 ins innerHTML — KEIN escapeHtml darauf, das
// wuerde Entitaeten doppelt-encoden ("M&uuml;nchen" -> "M&amp;uuml;nchen").
// Custom-Topics-Future = separate Sanitisier-Stufe beim Upload, nicht hier.

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-pr-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

// HTML-Attribut-Escape (& " ' < >). Lokal, damit das Widget self-contained
// bleibt (kein Import aus app.js' escapeAttr).
function _escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Defensiv: validiert+normalisiert config. Erste correct:true gewinnt; restliche
// correct werden auf false gesetzt. Gibt null zurueck wenn unbrauchbar (keine
// Optionen, keine Korrekt-Antwort).
function _normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const opts = Array.isArray(rawConfig.options) ? rawConfig.options : [];
  if (opts.length === 0) return null;
  let correctSeen = false;
  const normOpts = opts.map(o => {
    const isCorrect = !!(o && o.correct) && !correctSeen;
    if (isCorrect) correctSeen = true;
    if (o && o.correct && correctSeen && !isCorrect) {
      try { console.warn('[predict-reveal] more than one option marked correct — only the first counts.', o); } catch (e) {}
    }
    return {
      label:       (o && typeof o.label === 'string') ? o.label : '',
      correct:     isCorrect,
      explanation: (o && typeof o.explanation === 'string') ? o.explanation : ''
    };
  });
  if (!correctSeen) return null;
  return {
    setup:    typeof rawConfig.setup === 'string'    ? rawConfig.setup    : '',
    question: typeof rawConfig.question === 'string' ? rawConfig.question : '',
    options:  normOpts,
    reveal:   typeof rawConfig.reveal === 'string'   ? rawConfig.reveal   : ''
  };
}

// Initial-HTML (State 1, Predict). State-Updates passieren via _applyState.
function _renderHtml(norm, slotId) {
  const setupHtml = norm.setup
    ? '<div class="lf-pr-setup">' + norm.setup + '</div>'
    : '';

  const optsHtml = norm.options.map((o, i) => {
    const explHtml = o.explanation
      ? '<div class="lf-pr-option-explanation" id="' + _escapeAttr(slotId) + '-expl-' + i + '" hidden>' + o.explanation + '</div>'
      : '';
    return '<li class="lf-pr-option-item">'
         +   '<button type="button" class="lf-pr-option" '
         +     'data-pr-action="select" '
         +     'data-pr-index="' + i + '">'
         +     '<span class="lf-pr-option-label">' + o.label + '</span>'
         +   '</button>'
         +   explHtml
         + '</li>';
  }).join('');

  const revealHtml = norm.reveal
    ? '<div class="lf-pr-reveal" id="' + _escapeAttr(slotId) + '-reveal" hidden>'
    +    '<div class="lf-pr-reveal-heading">Erkl&auml;rung</div>'
    +    '<div class="lf-pr-reveal-body">' + norm.reveal + '</div>'
    + '</div>'
    : '';

  const retryHtml = '<button type="button" class="lf-pr-retry" '
    + 'data-pr-action="retry" hidden>Nochmal versuchen</button>';

  const hintHtml = '<div class="lf-pr-hint">Tippe deinen Tipp &mdash; falsch raten ist Teil des Lernens.</div>';

  const questionHtml = norm.question
    ? '<h4 class="lf-pr-question">' + norm.question + '</h4>'
    : '';

  return '<div class="lf-widget-predict-reveal lf-pr-state-predict" '
       +   'id="' + _escapeAttr(slotId) + '" data-pr-slot="' + _escapeAttr(slotId) + '">'
       +   setupHtml
       +   questionHtml
       +   '<ul class="lf-pr-options" role="radiogroup">' + optsHtml + '</ul>'
       +   hintHtml
       +   revealHtml
       +   retryHtml
       + '</div>';
}

// ─── mount() ──────────────────────────────────────────────
// Container ist der Slot vom Loader. Wir haengen unser Widget-DOM hinein
// und binden EINEN delegated click-Listener auf das Wrapper-Element.
// Closure-State (kein Modul-Map) — beim unmount() wird der Listener entfernt
// und der State automatisch GC'd. Behebt FU-5 aus der Spec.
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) {
    return _emptyInstance();
  }

  const norm = _normalizeConfig(config);
  const slotId = _nextSlotId();

  // Empty-State: nicht konfiguriert.
  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-predict-reveal lf-pr-empty" data-pr-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  // Per-Instance-State.
  const state = {
    config: norm,
    lockedWrong: new Set(),
    revealed: false,
    selectedIndex: null
  };
  let unmounted = false;
  const answerCbs = [];

  container.innerHTML = _renderHtml(norm, slotId);
  const root = container.querySelector('#' + CSS.escape(slotId));
  // A11y-Marker auf dem Slot (Spec: role="region" + aria-label).
  // Loader hat schon role="region" + aria-label="Aufgabe wird geladen" gesetzt;
  // ueberschreiben mit beschreibendem Label sobald gemounted.
  try {
    container.setAttribute('aria-label', 'Interaktive Aufgabe: Vorhersage und Auflösung');
  } catch (e) {}

  // ─── State → DOM (idempotent) ───
  function applyState() {
    if (unmounted || !root) return;
    const optionBtns = root.querySelectorAll('.lf-pr-option');
    const correctIdx = state.config.options.findIndex(o => o.correct);

    optionBtns.forEach((btn, i) => {
      btn.classList.remove('lf-pr-correct', 'lf-pr-wrong', 'lf-pr-wrong-locked');
      btn.removeAttribute('aria-label');
      btn.disabled = false;

      if (state.lockedWrong.has(i)) {
        btn.classList.add('lf-pr-wrong-locked');
        btn.disabled = true;
        btn.setAttribute('aria-label', 'Bereits ausgeschlossen');
      }

      const expl = root.querySelector('#' + CSS.escape(slotId) + '-expl-' + i);
      if (expl) expl.hidden = !state.revealed;

      if (state.revealed) {
        btn.disabled = true;
        if (i === correctIdx) {
          btn.classList.add('lf-pr-correct');
          btn.setAttribute('aria-label', 'Richtige Antwort');
        } else if (i === state.selectedIndex && i !== correctIdx) {
          btn.classList.add('lf-pr-wrong');
          btn.setAttribute('aria-label', 'Falsche Antwort');
        }
      }
    });

    root.classList.toggle('lf-pr-state-predict',  !state.revealed);
    root.classList.toggle('lf-pr-state-revealed',  state.revealed);

    const revealBox = root.querySelector('#' + CSS.escape(slotId) + '-reveal');
    if (revealBox) {
      const showReveal = state.revealed && state.selectedIndex === correctIdx;
      revealBox.hidden = !showReveal;
    }

    const retryBtn = root.querySelector('.lf-pr-retry');
    if (retryBtn) {
      const showRetry = state.revealed && state.selectedIndex !== correctIdx;
      retryBtn.hidden = !showRetry;
    }
  }

  // ─── Actions ───
  function selectOption(index) {
    if (unmounted) return;
    if (state.revealed) return;
    if (state.lockedWrong.has(index)) return;
    const opts = state.config.options;
    if (index < 0 || index >= opts.length) return;
    state.selectedIndex = index;
    state.revealed = true;
    applyState();
    // onAnswer-Hook (Phase-2 XP-Vergabe-Boundary, Spec).
    const correctIdx = state.config.options.findIndex(o => o.correct);
    const correct = (index === correctIdx);
    answerCbs.forEach(cb => {
      try {
        cb({ correct: correct, partial: correct ? 1 : 0, raw: { selectedIndex: index } });
      } catch (e) { console.warn('[predict-reveal onAnswer]', e); }
    });
  }

  function retry() {
    if (unmounted) return;
    const correctIdx = state.config.options.findIndex(o => o.correct);
    if (state.selectedIndex !== null && state.selectedIndex !== correctIdx) {
      state.lockedWrong.add(state.selectedIndex);
    }
    state.selectedIndex = null;
    state.revealed = false;
    applyState();
  }

  // ─── Click-Delegation auf wrapper-Level ───
  // Original nutzte document-level Listener — fuer self-contained module
  // delegieren wir auf root. Beim unmount() entfernen wir den Listener sauber.
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const btn = t.closest('[data-pr-action]');
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute('data-pr-action');
    if (action === 'select') {
      const idx = parseInt(btn.getAttribute('data-pr-index'), 10);
      if (!Number.isNaN(idx)) selectOption(idx);
    } else if (action === 'retry') {
      retry();
    }
  }
  if (root) root.addEventListener('click', onClick);

  // ─── Instance ───
  return {
    widgetType: 'predict-reveal',

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
      // Plain-JSON-serializable Snapshot (Spec). Set → Array.
      return {
        revealed: state.revealed,
        selectedIndex: state.selectedIndex,
        lockedWrong: Array.from(state.lockedWrong)
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      state.revealed = !!s.revealed;
      state.selectedIndex = (typeof s.selectedIndex === 'number') ? s.selectedIndex : null;
      state.lockedWrong = new Set(Array.isArray(s.lockedWrong) ? s.lockedWrong : []);
      applyState();
    }
  };
}

// Stub-Instance fuer Empty-State / kaputten Container. Idempotent unmount.
function _emptyInstance() {
  let done = false;
  return {
    widgetType: 'predict-reveal',
    unmount() { done = true; },
    onAnswer() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'predict-reveal', mount: mount };
export { mount };
