// ══════════════════════════════════════════
//  LearningForge — Widget: fill-blanks
//  Migrated from app.js:3845-4276 (Phase 0 Commit 9)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════
//
// Cloze-Text mit Inputs an Stelle der {{key}}-Placeholder. User tippt, drueckt
// "Pruefen", jeder Blank wird gruen (correct, locked) oder rot (shake, mit
// optionalem Hint-?-Icon). Wenn alles korrekt -> reveal.
//
// State-Lifecycle:
//   'predict'  = User tippt, noch nicht geprueft.
//   'wrong'    = mind. ein Blank hat falsche/leere Antwort, "Nochmal"-Button da.
//   'correct'  = alle Blanks korrekt, Pulse + Reveal blendet ein, Button locked.
//
// Text-Parsing: split text bei /\{\{([a-zA-Z0-9_]+)\}\}/g, alterniere
// Text-Spans (innerHTML mit entity-encoded content, Hard-Rule #3) +
// <input>-Elemente. Das vermeidet HTML-Tag-Zerschneiden, weil split die Tags
// niemals teilt — ein vom Author korrekt geschriebener {{key}} faellt immer
// ausserhalb von Tag-Grenzen (Author-Konvention).
//
// Hard-Rule #3: setup, question, reveal, text-Fragmente, hint sind HTML-
// entity-encoded vom Author und gehen 1:1 ins innerHTML — kein escapeHtml().
// Datenattribute (slotId, blank-key, width) via _escapeAttr.
//
// Keyboard-Nav: native <input> ist gratis. Tab zwischen Lücken (kein
// tabindex-Override), Enter im Input -> _check() (preventDefault auf Form-
// Submit). Original hatte einen document-globalen keydown-Listener; im
// Modul-Form delegieren wir auf root — pro Instance ein Listener,
// beim unmount() sauber entfernt.
//
// State pro Instance: { config (normalized), status, lockedBlanks }.
// lockedBlanks ist ein Set<`${key}#${blankIdx}`>, weil {{key}} mehrfach im
// Text vorkommen darf — pro Occurrence ein eigener Lock-State.
//
// Reduce-Motion: pulse + shake werden uebersprungen.

import { lfWidgetReducedMotion } from './_base.js';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-fb-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
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

// Defensive Validation:
//   text non-empty, blanks ist object mit >=1 keys.
//   Jeder blank hat answers Array mit >=1 nicht-leerem string.
//   Jeder Placeholder im text muss in blanks definiert sein (sonst rendert er
//   als leerer Slot — wir warnen + skippen den Slot).
//   Jeder blank-key muss im text vorkommen (Warnung; harmlos, Blank wird nie
//   gerendert).
function _normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const text = typeof rawConfig.text === 'string' ? rawConfig.text : '';
  if (!text.trim()) return null;
  const rawBlanks = (rawConfig.blanks && typeof rawConfig.blanks === 'object' && !Array.isArray(rawConfig.blanks))
    ? rawConfig.blanks
    : null;
  if (!rawBlanks) return null;
  const keys = Object.keys(rawBlanks);
  if (keys.length < 1) return null;

  // Welche Placeholder erscheinen im text?
  const placeholderRe = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  const placeholdersInText = new Set();
  let m;
  while ((m = placeholderRe.exec(text)) !== null) {
    placeholdersInText.add(m[1]);
  }

  // Blanks-Object normalisieren — pro Key: answers (>=1 non-leer string),
  // case, trim, width, hint.
  const blanks = {};
  for (const key of keys) {
    const b = rawBlanks[key];
    if (!b || typeof b !== 'object') continue;
    const ansRaw = Array.isArray(b.answers) ? b.answers : [];
    const answers = [];
    for (const a of ansRaw) {
      if (typeof a === 'string' && a.length > 0) answers.push(a);
    }
    if (answers.length < 1) continue; // skip — kann nicht validieren
    if (!placeholdersInText.has(key)) {
      try { console.warn('[LF/fill-blanks] blank key "' + key + '" not found in text — will never render.'); } catch (e) {}
    }
    blanks[key] = {
      answers:       answers,
      caseSensitive: !!b.caseSensitive,
      trim:          b.trim !== false, // default true
      width:         (typeof b.width === 'number' && isFinite(b.width) && b.width > 0) ? Math.floor(b.width) : null,
      hint:          typeof b.hint === 'string' ? b.hint : ''
    };
  }
  if (Object.keys(blanks).length < 1) return null;

  // Warne fuer text-Placeholder ohne blank-Definition (wird als leerer Slot
  // geskippt beim Render).
  for (const ph of placeholdersInText) {
    if (!blanks[ph]) {
      try { console.warn('[LF/fill-blanks] placeholder "{{' + ph + '}}" in text without blank-definition — will be skipped.'); } catch (e) {}
    }
  }

  const setup    = typeof rawConfig.setup    === 'string' ? rawConfig.setup    : '';
  const question = typeof rawConfig.question === 'string' ? rawConfig.question : '';
  const reveal   = typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : '';

  return { setup: setup, question: question, text: text, blanks: blanks, reveal: reveal };
}

// User-Input vs answers vergleichen. Beide werden je nach trim/case
// normalisiert; Match wenn ANY answer identisch.
function _answerMatches(userInput, blank) {
  if (typeof userInput !== 'string') return false;
  let u = userInput;
  if (blank.trim) u = u.trim();
  if (!blank.caseSensitive) u = u.toLowerCase();
  if (u.length === 0) return false;
  for (const a of blank.answers) {
    let cmp = a;
    if (blank.trim) cmp = cmp.trim();
    if (!blank.caseSensitive) cmp = cmp.toLowerCase();
    if (u === cmp) return true;
  }
  return false;
}

// Initial-HTML.
function _renderHtml(norm, slotId) {
  const setupHtml    = norm.setup    ? '<div class="lf-fb-setup">' + norm.setup + '</div>' : '';
  const questionHtml = norm.question ? '<h4 class="lf-fb-question">' + norm.question + '</h4>' : '';

  // Text-Parser: split bei {{key}}, alterniere text-fragments (innerHTML mit
  // entities) + inputs.
  const re = /\{\{([a-zA-Z0-9_]+)\}\}/g;
  let lastIdx = 0;
  let blankIdx = 0;
  let textHtml = '';
  let m;
  while ((m = re.exec(norm.text)) !== null) {
    const before = norm.text.slice(lastIdx, m.index);
    if (before) {
      // HTML-entity-encoded Text-Fragment -> 1:1 in innerHTML (Hard-Rule #3).
      textHtml += '<span class="lf-fb-text-frag">' + before + '</span>';
    }
    const key = m[1];
    const blank = norm.blanks[key];
    if (blank) {
      blankIdx += 1;
      const widthAttr = blank.width ? ' size="' + _escapeAttr(String(blank.width)) + '"' : '';
      const ariaLabel = 'L\xfccke ' + blankIdx + ' (' + key + ')';
      const hintBtn = blank.hint
        ? '<button type="button" class="lf-fb-hint-trigger" '
          + 'data-fb-action="toggle-hint" data-fb-slot="' + _escapeAttr(slotId) + '" '
          + 'data-fb-blank="' + _escapeAttr(key) + '" '
          + 'data-fb-blank-idx="' + blankIdx + '" '
          + 'aria-label="Hinweis f\xfcr L\xfccke ' + blankIdx + '" hidden>?</button>'
        : '';
      const hintTooltip = blank.hint
        ? '<span class="lf-fb-hint-tooltip" id="' + _escapeAttr(slotId) + '-hint-' + _escapeAttr(key) + '-' + blankIdx + '" role="status" aria-live="polite" hidden>' + blank.hint + '</span>'
        : '';
      textHtml += '<span class="lf-fb-blank-wrap">'
        + '<input type="text" class="lf-fb-blank" '
        + 'data-fb-blank="' + _escapeAttr(key) + '" data-fb-slot="' + _escapeAttr(slotId) + '" '
        + 'data-fb-blank-idx="' + blankIdx + '" '
        + 'aria-label="' + _escapeAttr(ariaLabel) + '" '
        + 'autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"'
        + widthAttr + '>'
        + hintBtn
        + hintTooltip
        + '</span>';
    } else {
      // Placeholder ohne blank-Def -> skip (Warnung schon in Normalize).
    }
    lastIdx = re.lastIndex;
  }
  const tail = norm.text.slice(lastIdx);
  if (tail) {
    textHtml += '<span class="lf-fb-text-frag">' + tail + '</span>';
  }

  const revealHtml = norm.reveal
    ? '<div class="lf-fb-reveal" id="' + _escapeAttr(slotId) + '-reveal" hidden>'
    +    '<div class="lf-fb-reveal-heading">Erkl\xe4rung</div>'
    +    '<div class="lf-fb-reveal-body">' + norm.reveal + '</div>'
    + '</div>'
    : '';

  return '<div class="lf-widget-fill-blanks lf-fb-state-predict" '
       +   'id="' + _escapeAttr(slotId) + '" data-fb-slot="' + _escapeAttr(slotId) + '">'
       +   setupHtml
       +   questionHtml
       +   '<div class="lf-fb-text">' + textHtml + '</div>'
       +   '<div class="lf-fb-status" id="' + _escapeAttr(slotId) + '-status" role="status" aria-live="polite"></div>'
       +   '<div class="lf-fb-actions">'
       +     '<button type="button" class="lf-fb-check" '
       +       'data-fb-action="check" data-fb-slot="' + _escapeAttr(slotId) + '">Pr\xfcfen</button>'
       +     '<button type="button" class="lf-fb-retry" '
       +       'data-fb-action="retry" data-fb-slot="' + _escapeAttr(slotId) + '" hidden>Nochmal versuchen</button>'
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
      '<div class="lf-widget-fill-blanks lf-fb-empty" data-fb-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  // Per-Instance-State.
  const state = {
    config:       norm,
    status:       'predict', // 'predict' | 'wrong' | 'correct'
    lockedBlanks: new Set()  // Set<`${key}#${blankIdx}`>
  };
  let unmounted = false;
  const answerCbs = [];

  container.innerHTML = _renderHtml(norm, slotId);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Interaktive Aufgabe: L\xfccken ausf\xfcllen');
  } catch (e) {}

  const reducedMotion = lfWidgetReducedMotion();

  // ─── Refresh: aria-label + classes + locked + hint-trigger sichtbarkeit +
  // status + reveal + buttons. Inputs werden NICHT neu gerendert (sonst
  // verliert User Cursor-Position waehrend des Tippens). ───
  function refresh() {
    if (unmounted || !root) return;
    const norm = state.config;

    root.classList.toggle('lf-fb-state-predict', state.status === 'predict');
    root.classList.toggle('lf-fb-state-wrong',   state.status === 'wrong');
    root.classList.toggle('lf-fb-state-correct', state.status === 'correct');

    const checkBtn = root.querySelector('.lf-fb-check');
    const retryBtn = root.querySelector('.lf-fb-retry');
    const statusEl = root.querySelector('#' + CSS.escape(slotId) + '-status');
    const revealEl = root.querySelector('#' + CSS.escape(slotId) + '-reveal');

    // Inputs durchgehen.
    const inputs = root.querySelectorAll('input.lf-fb-blank');
    let totalBlanks = 0;
    let correctCount = 0;
    inputs.forEach(inp => {
      const key = inp.getAttribute('data-fb-blank');
      if (!key || !norm.blanks[key]) return;
      totalBlanks += 1;
      const blankIdx = inp.getAttribute('data-fb-blank-idx') || '';
      const isLocked = state.lockedBlanks.has(key + '#' + blankIdx);
      if (isLocked) {
        correctCount += 1;
        inp.classList.add('lf-fb-correct');
        inp.classList.remove('lf-fb-wrong');
        inp.readOnly = true;
        inp.setAttribute('aria-invalid', 'false');
        const ariaIdx = parseInt(blankIdx, 10) || '?';
        inp.setAttribute('aria-label', 'L\xfccke ' + ariaIdx + ' (' + key + '), korrekt');
      } else {
        inp.readOnly = false;
        // wrong-class wird vom Check-Handler gesetzt; bei retry hier
        // zurueckgesetzt.
      }
    });

    // Hint-Trigger: nur sichtbar wenn der zugehoerige Blank (per blankIdx,
    // da {{key}} mehrfach im Text vorkommen darf — pro occurrence eigener
    // Status) wrong-Klasse hat.
    const hintTriggers = root.querySelectorAll('.lf-fb-hint-trigger');
    hintTriggers.forEach(btn => {
      const key = btn.getAttribute('data-fb-blank');
      const blankIdxAttr = btn.getAttribute('data-fb-blank-idx') || '';
      const wrap = btn.closest('.lf-fb-blank-wrap');
      const inp = wrap ? wrap.querySelector('input.lf-fb-blank') : null;
      if (inp && inp.classList.contains('lf-fb-wrong')) {
        btn.hidden = false;
      } else {
        btn.hidden = true;
        const tip = root.querySelector('#' + CSS.escape(slotId) + '-hint-' + CSS.escape(key || '') + '-' + CSS.escape(blankIdxAttr));
        if (tip) tip.hidden = true;
      }
    });

    // Status-Zeile.
    if (statusEl) {
      if (state.status === 'correct') {
        statusEl.textContent = 'Alle ' + totalBlanks + ' L\xfccken richtig ✓';
      } else if (state.status === 'wrong') {
        const wrong = totalBlanks - correctCount;
        statusEl.textContent = correctCount + ' von ' + totalBlanks + ' richtig — ' + wrong + ' ' + (wrong === 1 ? 'L\xfccke' : 'L\xfccken') + ' noch falsch.';
      } else {
        statusEl.textContent = '';
      }
    }

    // Buttons.
    if (checkBtn) {
      if (state.status === 'correct') {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Erledigt ✓';
      } else {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Pr\xfcfen';
      }
    }
    if (retryBtn) {
      retryBtn.hidden = state.status !== 'wrong';
    }

    // Reveal.
    if (revealEl) {
      revealEl.hidden = !(state.status === 'correct' && norm.reveal);
    }
  }

  // ─── Pruefen aller Blanks. Pro blank: read input value, vergleiche,
  // mark correct/wrong. Wenn alle correct -> status='correct' + pulse. ───
  function check() {
    if (unmounted) return;
    if (state.status === 'correct') return;
    const norm = state.config;

    const inputs = root.querySelectorAll('input.lf-fb-blank');
    let total = 0;
    let correct = 0;
    inputs.forEach(inp => {
      const key = inp.getAttribute('data-fb-blank');
      if (!key || !norm.blanks[key]) return;
      total += 1;
      const blankIdx = inp.getAttribute('data-fb-blank-idx') || '';
      const lockKey = key + '#' + blankIdx;
      if (state.lockedBlanks.has(lockKey)) {
        correct += 1;
        return;
      }
      const blank = norm.blanks[key];
      const userVal = inp.value;
      if (_answerMatches(userVal, blank)) {
        // Korrekt — locken (per occurrence, nicht per key).
        state.lockedBlanks.add(lockKey);
        correct += 1;
        inp.classList.remove('lf-fb-wrong');
        inp.classList.add('lf-fb-correct');
        inp.setAttribute('aria-invalid', 'false');
      } else {
        // Falsch — wrong-class + shake (skip shake bei reduce-motion).
        inp.classList.remove('lf-fb-correct');
        inp.classList.add('lf-fb-wrong');
        inp.setAttribute('aria-invalid', 'true');
        if (!reducedMotion) {
          inp.classList.remove('lf-fb-shake');
          // Reflow erzwingen, damit re-add die Animation neu startet.
          void inp.offsetWidth;
          inp.classList.add('lf-fb-shake');
          setTimeout(() => {
            if (inp.isConnected) inp.classList.remove('lf-fb-shake');
          }, 500);
        }
      }
    });

    if (correct >= total) {
      state.status = 'correct';
    } else {
      state.status = 'wrong';
    }
    refresh();

    // Pulse on complete (skip bei reduce-motion).
    if (state.status === 'correct' && !reducedMotion && root) {
      root.querySelectorAll('input.lf-fb-blank.lf-fb-correct').forEach(el => el.classList.add('lf-fb-pulse'));
      setTimeout(() => {
        if (unmounted || !root.isConnected) return;
        root.querySelectorAll('input.lf-fb-blank').forEach(el => el.classList.remove('lf-fb-pulse'));
      }, 700);
    }

    // onAnswer-Hook (Phase-2 XP-Vergabe-Boundary, Spec). correct=true erst
    // wenn alle blanks korrekt; partial = correct/total.
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: state.status === 'correct',
          partial: total > 0 ? correct / total : 0,
          raw: { correctCount: correct, total: total }
        });
      } catch (e) { console.warn('[fill-blanks onAnswer]', e); }
    });
  }

  // ─── Retry: status zurueck auf 'predict'. Wrong-classes von allen NICHT-
  // locked inputs entfernen — User-Werte bleiben drin (er soll korrigieren).
  // Locked (correct) bleiben locked. Focus auf ersten falschen blank. ───
  function retry() {
    if (unmounted) return;
    if (state.status !== 'wrong') return;

    state.status = 'predict';
    const inputs = root.querySelectorAll('input.lf-fb-blank');
    inputs.forEach(inp => {
      const key = inp.getAttribute('data-fb-blank');
      if (!key) return;
      const blankIdx = inp.getAttribute('data-fb-blank-idx') || '';
      if (state.lockedBlanks.has(key + '#' + blankIdx)) return;
      inp.classList.remove('lf-fb-wrong');
      inp.classList.remove('lf-fb-shake');
      inp.removeAttribute('aria-invalid');
    });
    refresh();
    // Focus auf ersten falschen blank.
    const firstWrong = root.querySelector('input.lf-fb-blank:not(.lf-fb-correct):not([readonly])');
    if (firstWrong) {
      try { firstWrong.focus(); } catch (e) {}
    }
  }

  function toggleHint(key, blankIdx) {
    if (unmounted || !root) return;
    const idxStr = String(blankIdx == null ? '' : blankIdx);
    const tip = root.querySelector('#' + CSS.escape(slotId) + '-hint-' + CSS.escape(key) + '-' + CSS.escape(idxStr));
    if (!tip) return;
    tip.hidden = !tip.hidden;
  }

  // ─── Click-Delegation (root-scoped, kein document-Listener mehr) ───
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-fb-action]');
    if (!el || !root.contains(el)) return;
    if (el.disabled) return;
    const action = el.getAttribute('data-fb-action');
    if (action === 'check') {
      check();
    } else if (action === 'retry') {
      retry();
    } else if (action === 'toggle-hint') {
      const key = el.getAttribute('data-fb-blank');
      const blankIdx = el.getAttribute('data-fb-blank-idx');
      if (key) toggleHint(key, blankIdx);
    }
  }

  // ─── Keydown-Delegation: Enter im Input -> check. Tab-Nav ist nativ und
  // braucht keinen Handler. ───
  function onKeydown(ev) {
    if (unmounted) return;
    if (ev.key !== 'Enter') return;
    const target = ev.target;
    if (!target || !target.classList || !target.classList.contains('lf-fb-blank')) return;
    if (!root.contains(target)) return;
    ev.preventDefault();
    check();
  }

  if (root) {
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
  }

  // ─── Instance ───
  return {
    widgetType: 'fill-blanks',

    unmount() {
      if (unmounted) return; // Idempotenz (Spec).
      unmounted = true;
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
        try { root.removeEventListener('keydown', onKeydown); } catch (e) {}
      }
      // DOM nicht selbst leeren — _loader.js / closeSubtopic schmeissen
      // den Subtree weg. Wir geben nur Listener + Closure-State frei.
      answerCbs.length = 0;
    },

    onAnswer(cb) {
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      // Plain-JSON-serializable Snapshot. Locked-Set -> Array. User-Eingaben
      // pro Lücke werden mit eingesammelt, damit setState() den Zustand
      // exakt wiederherstellen kann (auch noch nicht gepruefte Eingaben).
      const values = {};
      if (root) {
        const inputs = root.querySelectorAll('input.lf-fb-blank');
        inputs.forEach(inp => {
          const key = inp.getAttribute('data-fb-blank');
          const blankIdx = inp.getAttribute('data-fb-blank-idx') || '';
          if (!key) return;
          values[key + '#' + blankIdx] = inp.value;
        });
      }
      return {
        status:       state.status,
        lockedBlanks: Array.from(state.lockedBlanks),
        values:       values
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object' || !root) return;
      if (Array.isArray(s.lockedBlanks)) {
        state.lockedBlanks = new Set(
          s.lockedBlanks.filter(k => typeof k === 'string')
        );
      }
      if (s.status === 'predict' || s.status === 'wrong' || s.status === 'correct') {
        state.status = s.status;
      }
      // User-Eingaben rekonstruieren falls vorhanden.
      if (s.values && typeof s.values === 'object') {
        const inputs = root.querySelectorAll('input.lf-fb-blank');
        inputs.forEach(inp => {
          const key = inp.getAttribute('data-fb-blank');
          const blankIdx = inp.getAttribute('data-fb-blank-idx') || '';
          if (!key) return;
          const v = s.values[key + '#' + blankIdx];
          if (typeof v === 'string') inp.value = v;
        });
      }
      refresh();
    }
  };
}

// Stub-Instance fuer Empty-State / kaputten Container. Idempotent unmount.
function _emptyInstance() {
  let done = false;
  return {
    widgetType: 'fill-blanks',
    unmount() { done = true; },
    onAnswer() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'fill-blanks', mount: mount };
export { mount };
