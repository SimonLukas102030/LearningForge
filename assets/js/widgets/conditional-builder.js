// ══════════════════════════════════════════
//  LearningForge — Widget: conditional-builder
//  Welle 5.2 (Plan Z.233) — Englisch If-Satz-Typen-Builder
//  (Englisch: Type 0/1/2/3 — Tense-Dropdowns)
// ══════════════════════════════════════════
//
// User wählt einen Conditional-Type (0–3) via Dropdown.
// Das Widget zeigt die Satzstruktur (If-Clause + Main-Clause)
// mit je einem Dropdown für die Verbform. "Prüfen"-Button gibt
// sofortiges Feedback. Wiederholen-Button setzt zurück.
//
// Die 4 Types sind hardcoded (kein config nötig):
//   Type 0: If + Present Simple → Present Simple (General Truth)
//   Type 1: If + Present Simple → will + Infinitive (Real Condition)
//   Type 2: If + Past Simple → would + Infinitive (Hypothetical)
//   Type 3: If + Past Perfect → would have + Past Participle (Impossible Past)
//
// API: mount/unmount/onAnswer/getState/setState
// onAnswer: { type: 0–3, correct: bool, ifForm: string, mainForm: string }
// getState/setState: { selectedType, ifAnswer, mainAnswer, status }

import { lfWidgetReducedMotion } from './_base.js';

let _SEQ = 0;
function _nextId() {
  _SEQ += 1;
  return 'lf-cb-' + Date.now().toString(36) + '-' + _SEQ;
}

// ── Static Type-Data ─────────────────────────────────────────
// Each entry: label, name, ifLabel, mainLabel, ifOptions[], mainOptions[],
//             correctIf, correctMain, exampleIf, exampleMain
const TYPES = [
  {
    type:        0,
    name:        'Type 0 — General Truth',
    desc:        'Allgemeingültige Aussage / wissenschaftliche Fakten',
    colorVar:    'var(--lf-cb-type0)',
    ifLabel:     'If-Clause (Bedingung)',
    mainLabel:   'Main Clause (Hauptsatz)',
    exampleIf:   'If you heat water to 100°C,',
    exampleMain: 'it ___.',
    ifOptions:   ['Present Simple', 'Past Simple', 'will + Infinitive', 'would + Infinitive'],
    mainOptions: ['Present Simple', 'Past Simple', 'will + Infinitive', 'would + Infinitive'],
    correctIf:   'Present Simple',
    correctMain: 'Present Simple',
    ifHint:      'If + Present Simple',
    mainHint:    'Present Simple',
    exampleSolved: 'If you heat water to 100°C, it boils.'
  },
  {
    type:        1,
    name:        'Type 1 — Real Condition',
    desc:        'Reale / mögliche Bedingung in der Gegenwart oder Zukunft',
    colorVar:    'var(--lf-cb-type1)',
    ifLabel:     'If-Clause (Bedingung)',
    mainLabel:   'Main Clause (Ergebnis)',
    exampleIf:   'If it rains tomorrow,',
    exampleMain: 'we ___ the match.',
    ifOptions:   ['Present Simple', 'Past Simple', 'will + Infinitive', 'would + Infinitive'],
    mainOptions: ['Present Simple', 'Past Simple', 'will + Infinitive', 'would + Infinitive'],
    correctIf:   'Present Simple',
    correctMain: 'will + Infinitive',
    ifHint:      'If + Present Simple',
    mainHint:    'will + Infinitive',
    exampleSolved: 'If it rains tomorrow, we will cancel the match.'
  },
  {
    type:        2,
    name:        'Type 2 — Hypothetical',
    desc:        'Unwahrscheinliche / hypothetische Situation in der Gegenwart',
    colorVar:    'var(--lf-cb-type2)',
    ifLabel:     'If-Clause (Hypothese)',
    mainLabel:   'Main Clause (Folge)',
    exampleIf:   'If I had more time,',
    exampleMain: 'I ___ more books.',
    ifOptions:   ['Present Simple', 'Past Simple', 'will + Infinitive', 'would + Infinitive'],
    mainOptions: ['Present Simple', 'Past Simple', 'will + Infinitive', 'would + Infinitive'],
    correctIf:   'Past Simple',
    correctMain: 'would + Infinitive',
    ifHint:      'If + Past Simple',
    mainHint:    'would + Infinitive',
    exampleSolved: 'If I had more time, I would read more books.'
  },
  {
    type:        3,
    name:        'Type 3 — Impossible Past',
    desc:        'Unmögliche Situation in der Vergangenheit (Rückblick)',
    colorVar:    'var(--lf-cb-type3)',
    ifLabel:     'If-Clause (Vergangenheit)',
    mainLabel:   'Main Clause (Ergebnis)',
    exampleIf:   'If she had studied harder,',
    exampleMain: 'she ___ the exam.',
    ifOptions:   ['Past Simple', 'Past Perfect', 'would + Infinitive', 'would have + Past Participle'],
    mainOptions: ['Past Simple', 'Past Perfect', 'would + Infinitive', 'would have + Past Participle'],
    correctIf:   'Past Perfect',
    correctMain: 'would have + Past Participle',
    ifHint:      'If + Past Perfect',
    mainHint:    'would have + Past Participle',
    exampleSolved: 'If she had studied harder, she would have passed the exam.'
  }
];

// ── Escape ───────────────────────────────────────────────────
function _ea(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Config normalize (minimal — types are hardcoded) ─────────
function _normalize(c) {
  const label = (c && typeof c.label === 'string') ? c.label : '';
  const showExplanation = !c || c.showExplanation !== false;
  return { label, showExplanation };
}

// ── Build options HTML ────────────────────────────────────────
function _optHtml(opts, selectedVal) {
  return opts.map(o =>
    '<option value="' + _ea(o) + '"' + (o === selectedVal ? ' selected' : '') + '>'
    + _ea(o) + '</option>'
  ).join('');
}

// ── Type Selector ────────────────────────────────────────────
function _typeSelectorHtml(slotId, selectedType) {
  return '<div class="lf-cb-type-row">'
    + '<label class="lf-cb-type-label" for="' + _ea(slotId) + '-typesel">Conditional-Typ:</label>'
    + '<select class="lf-cb-type-select" id="' + _ea(slotId) + '-typesel" '
    +   'data-cb-action="change-type" data-cb-slot="' + _ea(slotId) + '">'
    + TYPES.map(t =>
        '<option value="' + t.type + '"' + (t.type === selectedType ? ' selected' : '') + '>'
        + _ea(t.name) + '</option>'
      ).join('')
    + '</select>'
    + '</div>';
}

// ── Card HTML for one type ────────────────────────────────────
function _cardHtml(slotId, td, ifAnswer, mainAnswer, status) {
  const locked = status !== 'idle';

  const explanationHtml = '<div class="lf-cb-explanation">'
    + '<span class="lf-cb-exp-if">' + _ea(td.ifHint) + '</span>'
    + '<span class="lf-cb-exp-arrow"> → </span>'
    + '<span class="lf-cb-exp-main">' + _ea(td.mainHint) + '</span>'
    + '</div>';

  const ifSel = '<select class="lf-cb-sel lf-cb-sel-if" '
    + 'data-cb-action="set-if" data-cb-slot="' + _ea(slotId) + '" '
    + (locked ? 'disabled ' : '')
    + 'aria-label="Verbform If-Clause">'
    + '<option value="">— Tense wählen —</option>'
    + _optHtml(td.ifOptions, ifAnswer)
    + '</select>';

  const mainSel = '<select class="lf-cb-sel lf-cb-sel-main" '
    + 'data-cb-action="set-main" data-cb-slot="' + _ea(slotId) + '" '
    + (locked ? 'disabled ' : '')
    + 'aria-label="Verbform Main Clause">'
    + '<option value="">— Tense wählen —</option>'
    + _optHtml(td.mainOptions, mainAnswer)
    + '</select>';

  const solvedHtml = (status === 'revealed')
    ? '<div class="lf-cb-solved-example">'
      + '<span class="lf-cb-solved-label">Beispiel: </span>'
      + _ea(td.exampleSolved)
      + '</div>'
    : '';

  return '<div class="lf-cb-card" style="--lf-cb-type-color:' + td.colorVar + '">'
    + '<div class="lf-cb-card-header">'
    +   '<span class="lf-cb-type-badge" style="background:' + td.colorVar + '">' + _ea(td.name) + '</span>'
    +   '<span class="lf-cb-type-desc">' + _ea(td.desc) + '</span>'
    + '</div>'
    + '<div class="lf-cb-clauses">'
    +   '<div class="lf-cb-clause">'
    +     '<div class="lf-cb-clause-label">' + _ea(td.ifLabel) + '</div>'
    +     '<div class="lf-cb-clause-example">' + _ea(td.exampleIf) + '</div>'
    +     ifSel
    +   '</div>'
    +   '<div class="lf-cb-clause-divider">+</div>'
    +   '<div class="lf-cb-clause">'
    +     '<div class="lf-cb-clause-label">' + _ea(td.mainLabel) + '</div>'
    +     '<div class="lf-cb-clause-example">' + _ea(td.exampleMain) + '</div>'
    +     mainSel
    +   '</div>'
    + '</div>'
    + solvedHtml
    + '</div>';
}

// ── Shell HTML ────────────────────────────────────────────────
function _shellHtml(slotId, norm, selectedType, ifAnswer, mainAnswer, status) {
  const titleHtml = norm.label
    ? '<h4 class="lf-cb-title">' + _ea(norm.label) + '</h4>'
    : '';

  const td = TYPES[selectedType];

  const feedbackHtml = '<div class="lf-cb-feedback" data-cb-feedback '
    + 'id="' + _ea(slotId) + '-feedback" role="status" aria-live="polite"></div>';

  const checkBtn = '<button type="button" class="lf-cb-btn lf-cb-btn-check" '
    + 'data-cb-action="check" data-cb-slot="' + _ea(slotId) + '" '
    + (status !== 'idle' ? 'hidden ' : '')
    + '>Pr\xfcfen</button>';

  const retryBtn = '<button type="button" class="lf-cb-btn lf-cb-btn-retry" '
    + 'data-cb-action="retry" data-cb-slot="' + _ea(slotId) + '" '
    + (status === 'idle' ? 'hidden ' : '')
    + '>Nochmal</button>';

  const solveBtn = '<button type="button" class="lf-cb-btn lf-cb-btn-solve" '
    + 'data-cb-action="solve" data-cb-slot="' + _ea(slotId) + '" '
    + (status !== 'checked' ? 'hidden ' : '')
    + '>L\xf6sung zeigen</button>';

  return '<div class="lf-widget-conditional-builder" id="' + _ea(slotId) + '" data-cb-slot="' + _ea(slotId) + '">'
    + titleHtml
    + _typeSelectorHtml(slotId, selectedType)
    + '<div class="lf-cb-card-wrap" data-cb-card>'
    + _cardHtml(slotId, td, ifAnswer, mainAnswer, status)
    + '</div>'
    + feedbackHtml
    + '<div class="lf-cb-actions">'
    + checkBtn
    + solveBtn
    + retryBtn
    + '</div>'
    + '</div>';
}

// ── mount() ──────────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _empty();

  const norm = _normalize(config);
  const slotId = _nextId();

  const state = {
    selectedType: 0,   // 0–3
    ifAnswer:     '',
    mainAnswer:   '',
    status:       'idle'  // 'idle' | 'checked' | 'revealed'
  };

  let unmounted = false;
  const answerCbs = [];

  function _render() {
    container.innerHTML = _shellHtml(slotId, norm,
      state.selectedType, state.ifAnswer, state.mainAnswer, state.status);
  }

  function _root()     { return container.querySelector('#' + CSS.escape(slotId)); }
  function _feedback() { return container.querySelector('[data-cb-feedback]'); }

  function _setFeedback(msg, cls) {
    const el = _feedback();
    if (!el) return;
    el.className = 'lf-cb-feedback' + (cls ? ' ' + cls : '');
    el.textContent = msg;
  }

  function _check() {
    if (unmounted || state.status !== 'idle') return;
    const td = TYPES[state.selectedType];
    if (!state.ifAnswer || !state.mainAnswer) {
      _setFeedback('Bitte beide Felder ausfüllen.', 'lf-cb-feedback-warn');
      return;
    }
    const ifOk   = state.ifAnswer   === td.correctIf;
    const mainOk = state.mainAnswer === td.correctMain;
    const correct = ifOk && mainOk;

    state.status = 'checked';
    _render();

    // Re-mark select elements after re-render
    const root = _root();
    if (root) {
      const ifSel   = root.querySelector('.lf-cb-sel-if');
      const mainSel = root.querySelector('.lf-cb-sel-main');
      if (ifSel) {
        ifSel.classList.toggle('lf-cb-sel-correct', ifOk);
        ifSel.classList.toggle('lf-cb-sel-wrong', !ifOk);
      }
      if (mainSel) {
        mainSel.classList.toggle('lf-cb-sel-correct', mainOk);
        mainSel.classList.toggle('lf-cb-sel-wrong', !mainOk);
      }
    }

    if (correct) {
      _setFeedback('Richtig! Beide Verbformen korrekt.', 'lf-cb-feedback-ok');
    } else {
      let msg = 'Noch nicht ganz. ';
      if (!ifOk)   msg += 'If-Clause: ' + td.correctIf + '. ';
      if (!mainOk) msg += 'Main Clause: ' + td.correctMain + '.';
      _setFeedback(msg.trim(), 'lf-cb-feedback-err');
    }

    answerCbs.forEach(cb => {
      try {
        cb({
          type:      state.selectedType,
          correct:   correct,
          ifForm:    state.ifAnswer,
          mainForm:  state.mainAnswer
        });
      } catch (e) { console.warn('[conditional-builder onAnswer]', e); }
    });
  }

  function _solve() {
    if (unmounted || state.status !== 'checked') return;
    const td = TYPES[state.selectedType];
    state.ifAnswer   = td.correctIf;
    state.mainAnswer = td.correctMain;
    state.status = 'revealed';
    _render();
    _setFeedback('Lösung: ' + td.ifHint + ' → ' + td.mainHint, 'lf-cb-feedback-info');
  }

  function _retry() {
    if (unmounted || state.status === 'idle') return;
    state.ifAnswer   = '';
    state.mainAnswer = '';
    state.status = 'idle';
    _render();
  }

  function _changeType(newType) {
    if (unmounted) return;
    const t = parseInt(newType, 10);
    if (t < 0 || t > 3 || Number.isNaN(t)) return;
    state.selectedType = t;
    state.ifAnswer     = '';
    state.mainAnswer   = '';
    state.status       = 'idle';
    _render();
  }

  function _onClick(ev) {
    if (unmounted) return;
    const el = ev.target && ev.target.closest && ev.target.closest('[data-cb-action]');
    if (!el) return;
    const root = _root();
    if (!root || !root.contains(el)) return;
    const action = el.getAttribute('data-cb-action');
    if (action === 'check')       _check();
    else if (action === 'retry')  _retry();
    else if (action === 'solve')  _solve();
  }

  function _onChange(ev) {
    if (unmounted) return;
    const el = ev.target;
    if (!el || !el.matches || !el.matches('[data-cb-action]')) return;
    const root = _root();
    if (!root || !root.contains(el)) return;
    const action = el.getAttribute('data-cb-action');
    if (action === 'change-type') {
      _changeType(el.value);
    } else if (action === 'set-if' && state.status === 'idle') {
      state.ifAnswer = el.value;
    } else if (action === 'set-main' && state.status === 'idle') {
      state.mainAnswer = el.value;
    }
  }

  _render();
  container.addEventListener('click', _onClick);
  container.addEventListener('change', _onChange);

  try {
    container.setAttribute('aria-label', 'If-Satz-Typen-Übung' + (norm.label ? ': ' + norm.label : ''));
  } catch (e) {}

  return {
    widgetType: 'conditional-builder',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      try { container.removeEventListener('click', _onClick); } catch (e) {}
      try { container.removeEventListener('change', _onChange); } catch (e) {}
      answerCbs.length = 0;
    },

    pause()   { /* no timers */ },
    resume()  { /* no timers */ },
    onTheme() { /* pure CSS vars */ },

    onAnswer(cb) {
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      return {
        selectedType: state.selectedType,
        ifAnswer:     state.ifAnswer,
        mainAnswer:   state.mainAnswer,
        status:       state.status
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object' || unmounted) return;
      const t = parseInt(s.selectedType, 10);
      if (t >= 0 && t <= 3 && !Number.isNaN(t)) state.selectedType = t;
      if (typeof s.ifAnswer   === 'string') state.ifAnswer   = s.ifAnswer;
      if (typeof s.mainAnswer === 'string') state.mainAnswer = s.mainAnswer;
      if (s.status === 'idle' || s.status === 'checked' || s.status === 'revealed') {
        state.status = s.status;
      }
      _render();
    }
  };
}

function _empty() {
  return {
    widgetType: 'conditional-builder',
    unmount() {}, pause() {}, resume() {}, onTheme() {},
    onAnswer() {}, getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'conditional-builder', mount: mount };
export { mount };
