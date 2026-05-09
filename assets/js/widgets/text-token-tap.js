// ══════════════════════════════════════════
//  LearningForge — Widget: text-token-tap
//  Welle 4.5 (Plan Z.209)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════
//
// Sprach-Analyse: Schueler tippt Woerter im Text an (Adjektive, Stilmittel,
// Wortformen, Quellen-Marker etc.). Pro Wort ein <button> mit data-token-id.
// "Pruefen" -> Auswertung: correct (gruen), wrong (rot, overshoot),
// missed (orange, gestrichelt). Optional Lehrer-Annotation pro richtigem
// Wort (Tooltip + Inline-Box nach Reveal).
//
// Token-Generierung: text wird in Woerter zerlegt; Satzzeichen sind
// Glue-Spans (nicht klickbar). IDs t1, t2, ... in Reihenfolge.
//
// Hard-Rule #3: question, annotations[], reveal sind HTML-entity-encoded
// vom Author und gehen 1:1 in innerHTML. Token-Text (aus rohem `text`)
// wird via _escapeHtml in <button>-Innerem geschuetzt — Author kann
// im Plain-Text Umlaute schreiben, Entities werden ebenfalls korrekt
// gerendert (Browser dekodiert sie beim innerHTML-Set).
//
// State pro Instance: { config, marked: Set<tokenId>, status,
// correctIds, wrongIds, missedIds }. Status:
//   'predict'  = User klickt Tokens, kann togglen.
//   'graded'   = Auswertung sichtbar, weitere Klicks gesperrt.
//   'revealed' = Loesung gezeigt (alle Targets markiert + Annotations).

import { lfWidgetReducedMotion } from './_base.js';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-tt-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

function _escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Token-Text-Escape: User-Author schreibt Plain-Text, der ins
// <button>-innerHTML geht. Hier minimal escapen (& < >), damit z.B.
// "Fuchs & Hund" nicht als Entity-Bug erscheint. Author kann zusaetzlich
// HTML-Entities verwenden — die werden vom Browser beim Lesen dekodiert,
// d.h. "&auml;" -> "ä" rendert wie erwartet.
function _escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Text -> Tokens (Wort-Spans + Punctuation/Whitespace-Glue).
// Regex matched Word-Runs (alles ausser Whitespace + ASCII-Satzzeichen).
// Unicode-aware: Umlaute, scharfes-S, Akzente zaehlen als Wort-Zeichen.
// Token-IDs: 't1', 't2', ... in Reihenfolge.
function _tokenize(text) {
  const tokens = [];      // [{ kind: 'word'|'glue', id?, text }]
  // Wort = beliebige Letters/Digits/Bindestrich-Sequenz; Glue = Rest
  // (Whitespace, Satzzeichen, HTML-Entity-Strings wie "&auml;" werden
  // hier vom Browser bereits zu echten Zeichen dekodiert weil text
  // aus JSON kommt — aber falls nicht, ist das robust dank Unicode-Klasse).
  const wordRe = /[\p{L}\p{N}][\p{L}\p{N}\-_'’]*/gu;
  let lastIdx = 0;
  let counter = 0;
  let m;
  while ((m = wordRe.exec(text)) !== null) {
    const before = text.slice(lastIdx, m.index);
    if (before) tokens.push({ kind: 'glue', text: before });
    counter += 1;
    tokens.push({ kind: 'word', id: 't' + counter, text: m[0] });
    lastIdx = wordRe.lastIndex;
  }
  const tail = text.slice(lastIdx);
  if (tail) tokens.push({ kind: 'glue', text: tail });
  return tokens;
}

function _normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const text = typeof rawConfig.text === 'string' ? rawConfig.text : '';
  if (!text.trim()) return null;
  const tokens = _tokenize(text);
  const wordTokens = tokens.filter(t => t.kind === 'word');
  if (wordTokens.length < 1) return null;
  const wordIds = new Set(wordTokens.map(t => t.id));

  const targetIdsRaw = Array.isArray(rawConfig.targetIds) ? rawConfig.targetIds : [];
  const targetIds = [];
  for (const id of targetIdsRaw) {
    if (typeof id === 'string' && wordIds.has(id)) targetIds.push(id);
    else try { console.warn('[LF/text-token-tap] targetId "' + id + '" not in tokens — skipped.'); } catch (e) {}
  }
  if (targetIds.length < 1) return null;

  const annotations = (rawConfig.annotations && typeof rawConfig.annotations === 'object' && !Array.isArray(rawConfig.annotations))
    ? rawConfig.annotations : {};

  const label    = typeof rawConfig.label    === 'string' ? rawConfig.label    : '';
  const question = typeof rawConfig.question === 'string' ? rawConfig.question : '';
  const reveal   = typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : '';

  return {
    label: label,
    question: question,
    tokens: tokens,
    targetIds: new Set(targetIds),
    annotations: annotations,
    reveal: reveal
  };
}

function _renderHtml(norm, slotId) {
  const labelHtml    = norm.label    ? '<div class="lf-tt-label">' + norm.label + '</div>' : '';
  const questionHtml = norm.question ? '<h4 class="lf-tt-question">' + norm.question + '</h4>' : '';

  let textHtml = '';
  for (const tok of norm.tokens) {
    if (tok.kind === 'glue') {
      textHtml += '<span class="lf-tt-glue">' + _escapeHtml(tok.text) + '</span>';
    } else {
      // <button> = nativ Tab-fokussierbar + Enter/Space toggelt (kein extra
      // keydown-Handler noetig — type=button mit click-Listener reicht).
      textHtml += '<button type="button" class="lf-tt-token" '
        + 'data-tt-action="toggle-token" data-tt-slot="' + _escapeAttr(slotId) + '" '
        + 'data-tt-token-id="' + _escapeAttr(tok.id) + '" '
        + 'aria-pressed="false">'
        + _escapeHtml(tok.text)
        + '</button>';
    }
  }

  const revealHtml = norm.reveal
    ? '<div class="lf-tt-reveal" id="' + _escapeAttr(slotId) + '-reveal" hidden>'
    +    '<div class="lf-tt-reveal-heading">Erkl\xe4rung</div>'
    +    '<div class="lf-tt-reveal-body">' + norm.reveal + '</div>'
    + '</div>'
    : '';

  return '<div class="lf-widget-text-token-tap lf-tt-state-predict" '
       +   'id="' + _escapeAttr(slotId) + '" data-tt-slot="' + _escapeAttr(slotId) + '">'
       +   labelHtml
       +   questionHtml
       +   '<div class="lf-tt-text">' + textHtml + '</div>'
       +   '<div class="lf-tt-status" id="' + _escapeAttr(slotId) + '-status" role="status" aria-live="polite"></div>'
       +   '<div class="lf-tt-annotations" id="' + _escapeAttr(slotId) + '-annotations" hidden></div>'
       +   '<div class="lf-tt-actions">'
       +     '<button type="button" class="lf-tt-check" '
       +       'data-tt-action="check" data-tt-slot="' + _escapeAttr(slotId) + '">Pr\xfcfen</button>'
       +     '<button type="button" class="lf-tt-show" '
       +       'data-tt-action="show" data-tt-slot="' + _escapeAttr(slotId) + '" hidden>L\xf6sung zeigen</button>'
       +     '<button type="button" class="lf-tt-reset" '
       +       'data-tt-action="reset" data-tt-slot="' + _escapeAttr(slotId) + '" hidden>Zur\xfccksetzen</button>'
       +   '</div>'
       +   revealHtml
       + '</div>';
}

function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();

  const norm = _normalizeConfig(config);
  const slotId = _nextSlotId();

  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-text-token-tap lf-tt-empty" data-tt-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  const state = {
    config:     norm,
    marked:     new Set(), // tokenIds vom User markiert
    status:     'predict', // 'predict' | 'graded' | 'revealed'
    correctIds: new Set(), // user-markiert UND target
    wrongIds:   new Set(), // user-markiert NICHT target
    missedIds:  new Set()  // target NICHT user-markiert
  };
  let unmounted = false;
  const answerCbs = [];

  container.innerHTML = _renderHtml(norm, slotId);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try { container.setAttribute('aria-label', 'Interaktive Aufgabe: W\xf6rter antippen'); } catch (e) {}

  const reducedMotion = lfWidgetReducedMotion();

  function tokenButtons() {
    return root ? root.querySelectorAll('.lf-tt-token') : [];
  }

  function refresh() {
    if (unmounted || !root) return;
    root.classList.toggle('lf-tt-state-predict',  state.status === 'predict');
    root.classList.toggle('lf-tt-state-graded',   state.status === 'graded');
    root.classList.toggle('lf-tt-state-revealed', state.status === 'revealed');

    const checkBtn  = root.querySelector('.lf-tt-check');
    const showBtn   = root.querySelector('.lf-tt-show');
    const resetBtn  = root.querySelector('.lf-tt-reset');
    const statusEl  = root.querySelector('#' + CSS.escape(slotId) + '-status');
    const annosEl   = root.querySelector('#' + CSS.escape(slotId) + '-annotations');
    const revealEl  = root.querySelector('#' + CSS.escape(slotId) + '-reveal');

    // Token-Klassen + aria.
    tokenButtons().forEach(btn => {
      const id = btn.getAttribute('data-tt-token-id');
      if (!id) return;
      btn.classList.remove('lf-tt-marked', 'lf-tt-correct', 'lf-tt-wrong', 'lf-tt-missed');
      const isMarked = state.marked.has(id);
      btn.setAttribute('aria-pressed', isMarked ? 'true' : 'false');
      if (state.status === 'predict') {
        btn.disabled = false;
        if (isMarked) btn.classList.add('lf-tt-marked');
      } else {
        // graded oder revealed
        btn.disabled = true;
        if (state.correctIds.has(id))      btn.classList.add('lf-tt-correct');
        else if (state.wrongIds.has(id))   btn.classList.add('lf-tt-wrong');
        else if (state.missedIds.has(id))  btn.classList.add('lf-tt-missed');
        // Annotation als Tooltip (nur fuer correct + missed, also Targets).
        // wrongIds: kein Annotation-Lookup (Author gibt nur fuer Targets eine).
      }
    });

    // Status.
    if (statusEl) {
      if (state.status === 'predict') {
        const n = state.marked.size;
        statusEl.textContent = n === 0 ? '' : (n + ' ' + (n === 1 ? 'Wort markiert' : 'W\xf6rter markiert'));
      } else {
        const correct = state.correctIds.size;
        const totalT  = norm.targetIds.size;
        const wrong   = state.wrongIds.size;
        let msg = correct + ' von ' + totalT + ' richtig';
        if (wrong > 0) msg += ' — ' + wrong + ' ' + (wrong === 1 ? 'Wort' : 'W\xf6rter') + ' zuviel.';
        statusEl.textContent = msg;
      }
    }

    // Annotations: nach graded/revealed einblenden.
    if (annosEl) {
      if (state.status === 'predict') {
        annosEl.hidden = true;
        annosEl.innerHTML = '';
      } else {
        // Pro Target-Annotation eine Zeile (correct + missed).
        let html = '';
        const showIds = new Set([...state.correctIds, ...state.missedIds]);
        // Stable order: input order der targetIds (Set behaelt Insertion-Order).
        for (const id of norm.targetIds) {
          if (!showIds.has(id)) continue;
          const ann = norm.annotations[id];
          if (typeof ann !== 'string' || !ann) continue;
          const cls = state.correctIds.has(id) ? 'lf-tt-anno lf-tt-anno-correct' : 'lf-tt-anno lf-tt-anno-missed';
          html += '<div class="' + cls + '">' + ann + '</div>';
        }
        if (html) {
          annosEl.innerHTML = html;
          annosEl.hidden = false;
        } else {
          annosEl.hidden = true;
          annosEl.innerHTML = '';
        }
      }
    }

    // Buttons.
    if (checkBtn) {
      checkBtn.hidden = state.status !== 'predict';
      checkBtn.disabled = state.status !== 'predict';
    }
    if (showBtn) {
      showBtn.hidden = state.status !== 'graded';
    }
    if (resetBtn) {
      resetBtn.hidden = state.status === 'predict';
    }

    // Reveal.
    if (revealEl) {
      revealEl.hidden = !((state.status === 'graded' || state.status === 'revealed') && norm.reveal);
    }
  }

  function toggleToken(tokenId) {
    if (unmounted) return;
    if (state.status !== 'predict') return;
    if (state.marked.has(tokenId)) state.marked.delete(tokenId);
    else state.marked.add(tokenId);
    refresh();
  }

  function check() {
    if (unmounted) return;
    if (state.status !== 'predict') return;
    state.correctIds.clear();
    state.wrongIds.clear();
    state.missedIds.clear();
    for (const id of state.marked) {
      if (norm.targetIds.has(id)) state.correctIds.add(id);
      else state.wrongIds.add(id);
    }
    for (const id of norm.targetIds) {
      if (!state.marked.has(id)) state.missedIds.add(id);
    }
    state.status = 'graded';
    refresh();

    if (!reducedMotion && root) {
      // Kurzer Pulse auf den correct-Tokens (instant skip bei reduce-motion).
      root.querySelectorAll('.lf-tt-token.lf-tt-correct').forEach(el => el.classList.add('lf-tt-pulse'));
      setTimeout(() => {
        if (unmounted || !root.isConnected) return;
        root.querySelectorAll('.lf-tt-token').forEach(el => el.classList.remove('lf-tt-pulse'));
      }, 700);
    }

    const total = norm.targetIds.size;
    const correct = state.correctIds.size;
    const wrong = state.wrongIds.size;
    // correct=true nur wenn alle Targets markiert UND keine zuviel.
    const fullyCorrect = (correct === total) && (wrong === 0);
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: fullyCorrect,
          partial: total > 0 ? Math.max(0, (correct - wrong)) / total : 0,
          raw: { correct: correct, wrong: wrong, missed: state.missedIds.size, total: total }
        });
      } catch (e) { console.warn('[text-token-tap onAnswer]', e); }
    });
  }

  function show() {
    if (unmounted) return;
    if (state.status !== 'graded') return;
    // Alle Targets als markiert anzeigen (missed -> correct visuell).
    state.status = 'revealed';
    // Alle missed werden als "correct gezeigt" gerendert (Loesung).
    for (const id of state.missedIds) {
      state.correctIds.add(id);
    }
    state.missedIds.clear();
    refresh();
  }

  function reset() {
    if (unmounted) return;
    state.marked.clear();
    state.correctIds.clear();
    state.wrongIds.clear();
    state.missedIds.clear();
    state.status = 'predict';
    refresh();
  }

  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-tt-action]');
    if (!el || !root.contains(el)) return;
    if (el.disabled) return;
    const action = el.getAttribute('data-tt-action');
    if (action === 'toggle-token') {
      const id = el.getAttribute('data-tt-token-id');
      if (id) toggleToken(id);
    } else if (action === 'check') {
      check();
    } else if (action === 'show') {
      show();
    } else if (action === 'reset') {
      reset();
    }
  }

  if (root) root.addEventListener('click', onClick);

  return {
    widgetType: 'text-token-tap',
    unmount() {
      if (unmounted) return;
      unmounted = true;
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
      }
      answerCbs.length = 0;
    },
    onAnswer(cb) { if (typeof cb === 'function') answerCbs.push(cb); },
    pause() {},
    resume() {},
    onTheme() {},
    getState() {
      return {
        marked:     Array.from(state.marked),
        status:     state.status,
        correctIds: Array.from(state.correctIds),
        wrongIds:   Array.from(state.wrongIds),
        missedIds:  Array.from(state.missedIds)
      };
    },
    setState(s) {
      if (!s || typeof s !== 'object') return;
      const wordIds = new Set();
      for (const tok of norm.tokens) if (tok.kind === 'word') wordIds.add(tok.id);
      const filt = arr => Array.isArray(arr)
        ? arr.filter(id => typeof id === 'string' && wordIds.has(id))
        : [];
      state.marked     = new Set(filt(s.marked));
      state.correctIds = new Set(filt(s.correctIds));
      state.wrongIds   = new Set(filt(s.wrongIds));
      state.missedIds  = new Set(filt(s.missedIds));
      if (s.status === 'predict' || s.status === 'graded' || s.status === 'revealed') {
        state.status = s.status;
      }
      refresh();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'text-token-tap',
    unmount() {},
    onAnswer() {},
    pause() {},
    resume() {},
    onTheme() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'text-token-tap', mount: mount };
export { mount };
