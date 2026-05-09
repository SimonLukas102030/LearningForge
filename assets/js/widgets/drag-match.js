// ══════════════════════════════════════════
//  LearningForge — Widget: drag-match
//  Migrated from app.js:2536-3030 (Phase 0 Commit 6)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════
//
// Schueler verbindet Begriff mit Definition (oder Person<->Werk, Stilmittel<->
// Beispiel, Symbol<->Bedeutung). Tap-Tap-Pattern statt echter Drag-Linien:
//   1. Tap left  -> Item highlightet als "selected" (lf-dm-selected).
//   2. Tap right -> Verbindung wird erstellt; beide Items kriegen die gleiche
//      --lf-conn-N-Farbe via inline-CSS-Var und einen farbigen Chip.
//   3. Re-Tap auf bereits verbundenes Item bricht die Verbindung wieder auf.
// "Pruefen" lockt korrekte Verbindungen (gruener Border), shaket falsche und
// gibt sie zur Re-Connection frei.
//
// Hard-Rule #3: setup/question/pair.left/pair.right/reveal sind
// HTML-entity-encoded und gehen 1:1 ins innerHTML — KEIN escapeHtml().
// Alle data-* Werte via _escapeAttr.
//
// Color-Pool-Ansatz: 6 themed CSS-Variablen --lf-conn-1..6 in :root + dark
// (siehe main.css). Cosmetic-Themes erben sie — kein per-theme Override
// noetig, weil die Farben bewusst absolute Anker sind. Mehr als 6 gleichzeitige
// Verbindungen (= pairs.length > 6) wird per Modulo gewrappt.
//
// Original hatte einen document-global click+keydown-Listener (idempotent
// via document.__lfDragMatchBound). Im Modul-Form delegieren wir auf root —
// pro Instance ein Listener, beim unmount() sauber entfernt.

import { lfWidgetReducedMotion } from './_base.js';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-dm-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
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

// Fisher-Yates Shuffle. Mirror drag-sort: garantiert result !== input
// (max 12 Versuche, sonst expliziter Swap [0]<->[1]).
function _shuffleIds(ids) {
  if (!Array.isArray(ids) || ids.length <= 1) return ids.slice();
  const a = ids.slice();
  for (let attempt = 0; attempt < 12; attempt++) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    let same = true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== ids[i]) { same = false; break; }
    }
    if (!same) return a;
  }
  const b = ids.slice();
  if (b.length >= 2) { const t = b[0]; b[0] = b[1]; b[1] = t; }
  return b;
}

// Defensive Validation: pairs.length >= 2, jeder pair hat id+left+right (alle
// non-empty strings), eindeutige IDs. Sonst null -> "noch nicht fertig
// konfiguriert"-Fallback.
function _normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const pairs = Array.isArray(rawConfig.pairs) ? rawConfig.pairs : [];
  if (pairs.length < 2) return null;
  const seenIds = new Set();
  const normPairs = [];
  for (const p of pairs) {
    if (!p || typeof p !== 'object') return null;
    const id    = (typeof p.id    === 'string') ? p.id    : '';
    const left  = (typeof p.left  === 'string') ? p.left  : '';
    const right = (typeof p.right === 'string') ? p.right : '';
    if (!id || !left || !right) return null;
    if (seenIds.has(id)) return null;
    seenIds.add(id);
    normPairs.push({ id: id, left: left, right: right });
  }
  return {
    setup:    typeof rawConfig.setup    === 'string' ? rawConfig.setup    : '',
    question: typeof rawConfig.question === 'string' ? rawConfig.question : '',
    pairs:    normPairs,
    reveal:   typeof rawConfig.reveal   === 'string' ? rawConfig.reveal   : ''
  };
}

// Connection-Color-Slot: 1..6. Stabil pro Verbindung, beide Seiten dieselbe
// Farbe. Erster freier Slot, sonst Hash-Wrap.
function _assignColorSlot(state, leftPairId) {
  const used = new Set();
  for (const [, info] of state.connections) {
    if (info && typeof info.colorSlot === 'number') used.add(info.colorSlot);
  }
  for (let i = 1; i <= 6; i++) {
    if (!used.has(i)) return i;
  }
  let h = 0;
  for (let i = 0; i < leftPairId.length; i++) h = (h * 31 + leftPairId.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 6) + 1);
}

// Render eines einzelnen Items (left oder right).
function _renderItem(slotId, pair, side, state) {
  let connInfo = null;
  let leftIdForLock = null;
  if (side === 'left') {
    if (state.connections.has(pair.id)) {
      connInfo = state.connections.get(pair.id);
      leftIdForLock = pair.id;
    }
  } else {
    for (const [lid, info] of state.connections) {
      if (info && info.rightPairId === pair.id) {
        connInfo = info;
        leftIdForLock = lid;
        break;
      }
    }
  }

  const isSelected      = side === 'left' && state.selectedLeft === pair.id;
  const isConnected     = !!connInfo;
  const isLockedCorrect = !!leftIdForLock && state.lockedConnections.has(leftIdForLock);
  const isWrong         = !!leftIdForLock && state.lastWrongLefts.has(leftIdForLock);

  const classes = ['lf-dm-item'];
  if (isSelected)      classes.push('lf-dm-selected');
  if (isConnected)     classes.push('lf-dm-connected');
  if (isLockedCorrect) classes.push('lf-dm-locked-correct');
  if (isWrong)         classes.push('lf-dm-wrong');

  let styleAttr = '';
  if (connInfo && typeof connInfo.colorSlot === 'number') {
    styleAttr = ' style="--lf-dm-conn: var(--lf-conn-' + connInfo.colorSlot + ');"';
  }

  const lockedAriaAttrs = isLockedCorrect
    ? ' aria-label="Richtige Verbindung. Gesperrt." aria-disabled="true"'
    : '';

  const action = side === 'left' ? 'select-left' : 'select-right';
  const labelHtml = side === 'left' ? pair.left : pair.right;

  return '<li class="' + classes.join(' ') + '"'
       + styleAttr
       + ' data-dm-slot="' + _escapeAttr(slotId) + '"'
       + ' data-dm-action="' + action + '"'
       + ' data-dm-pair-id="' + _escapeAttr(pair.id) + '"'
       + ' data-dm-side="' + side + '"'
       + ' tabindex="0"'
       + ' role="button"'
       + lockedAriaAttrs + '>'
       +   '<span class="lf-dm-label">' + labelHtml + '</span>'
       +   '<span class="lf-dm-chip" aria-hidden="true"></span>'
       + '</li>';
}

// Initial-HTML.
function _renderHtml(norm, slotId, initialState) {
  const setupHtml    = norm.setup    ? '<div class="lf-dm-setup">' + norm.setup + '</div>' : '';
  const questionHtml = norm.question ? '<h4 class="lf-dm-question">' + norm.question + '</h4>' : '';

  const leftItemsHtml  = norm.pairs.map(p => _renderItem(slotId, p, 'left', initialState)).join('');
  const rightItemsHtml = initialState.rightOrder.map(id => {
    const p = norm.pairs.find(x => x.id === id);
    if (!p) return '';
    return _renderItem(slotId, p, 'right', initialState);
  }).join('');

  const revealHtml = norm.reveal
    ? '<div class="lf-dm-reveal" id="' + _escapeAttr(slotId) + '-reveal" hidden>'
    +    '<div class="lf-dm-reveal-heading">Erkl&auml;rung</div>'
    +    '<div class="lf-dm-reveal-body">' + norm.reveal + '</div>'
    + '</div>'
    : '';

  return '<div class="lf-widget-drag-match lf-dm-state-predict" '
       +   'id="' + _escapeAttr(slotId) + '" data-dm-slot="' + _escapeAttr(slotId) + '">'
       +   setupHtml
       +   questionHtml
       +   '<div class="lf-dm-columns">'
       +     '<div class="lf-dm-column lf-dm-column-left">'
       +       '<div class="lf-dm-column-header">Begriff</div>'
       +       '<ul class="lf-dm-list" role="list">' + leftItemsHtml + '</ul>'
       +     '</div>'
       +     '<div class="lf-dm-column lf-dm-column-right">'
       +       '<div class="lf-dm-column-header">Definition</div>'
       +       '<ul class="lf-dm-list" role="list">' + rightItemsHtml + '</ul>'
       +     '</div>'
       +   '</div>'
       +   '<div class="lf-dm-hint" id="' + _escapeAttr(slotId) + '-hint" role="status" aria-live="polite" hidden></div>'
       +   '<div class="lf-dm-actions">'
       +     '<button type="button" class="lf-dm-check" '
       +       'data-dm-action="check">Pr\xfcfen</button>'
       +     '<button type="button" class="lf-dm-retry" '
       +       'data-dm-action="retry" hidden>Nochmal versuchen</button>'
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

  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-drag-match lf-dm-empty" data-dm-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  // Per-Instance-State.
  const pairIds = norm.pairs.map(p => p.id);
  const state = {
    config:            norm,
    rightOrder:        _shuffleIds(pairIds),
    connections:       new Map(),  // leftPairId -> { rightPairId, colorSlot }
    selectedLeft:      null,
    lockedConnections: new Set(),  // Set<leftPairId>
    status:            'predict',  // 'predict' | 'wrong' | 'correct'
    lastWrongLefts:    new Set()
  };
  let unmounted = false;
  const answerCbs = [];

  container.innerHTML = _renderHtml(norm, slotId, state);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Interaktive Aufgabe: Begriffe verbinden');
  } catch (e) {}

  // Reduce-Motion: skip shake + pulse-Animationen (Spec R-2 / a11y).
  const reducedMotion = lfWidgetReducedMotion();

  // ─── Re-Render aus state ───
  function rerender() {
    if (unmounted || !root) return;
    const leftList  = root.querySelector('.lf-dm-column-left  .lf-dm-list');
    const rightList = root.querySelector('.lf-dm-column-right .lf-dm-list');
    if (!leftList || !rightList) return;

    leftList.innerHTML = state.config.pairs.map(p => _renderItem(slotId, p, 'left', state)).join('');
    rightList.innerHTML = state.rightOrder.map(id => {
      const p = state.config.pairs.find(x => x.id === id);
      if (!p) return '';
      return _renderItem(slotId, p, 'right', state);
    }).join('');

    root.classList.toggle('lf-dm-state-predict', state.status === 'predict');
    root.classList.toggle('lf-dm-state-wrong',   state.status === 'wrong');
    root.classList.toggle('lf-dm-state-correct', state.status === 'correct');

    const hint     = root.querySelector('#' + CSS.escape(slotId) + '-hint');
    const retryBtn = root.querySelector('.lf-dm-retry');
    const checkBtn = root.querySelector('.lf-dm-check');
    const reveal   = root.querySelector('#' + CSS.escape(slotId) + '-reveal');

    if (state.status === 'wrong') {
      const total = state.config.pairs.length;
      const rightCount = state.lockedConnections.size;
      if (hint) {
        hint.hidden = false;
        hint.textContent = 'Von ' + total + ' richtig: ' + rightCount + '. Verbinde die anderen neu.';
      }
      if (retryBtn) retryBtn.hidden = false;
      if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = false; checkBtn.textContent = 'Pr\xfcfen'; }
      if (reveal)   reveal.hidden = true;
    } else if (state.status === 'correct') {
      if (hint)     hint.hidden = true;
      if (retryBtn) retryBtn.hidden = true;
      if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = true; checkBtn.textContent = 'Erledigt ✓'; }
      if (reveal)   reveal.hidden = !state.config.reveal;
    } else {
      if (hint)     hint.hidden = true;
      if (retryBtn) retryBtn.hidden = true;
      if (checkBtn) { checkBtn.hidden = false; checkBtn.disabled = false; checkBtn.textContent = 'Pr\xfcfen'; }
      if (reveal)   reveal.hidden = true;
    }
  }

  // Refokus-Helper nach rerender (DOM wird ersetzt -> focus weg).
  function focusItem(pairId, side) {
    setTimeout(() => {
      if (unmounted || !root) return;
      const sel = '.lf-dm-item[data-dm-pair-id="' + CSS.escape(pairId) + '"][data-dm-side="' + side + '"]';
      const el = root.querySelector(sel);
      if (el && typeof el.focus === 'function') el.focus();
    }, 0);
  }

  // ─── Helpers ───
  function disconnect(leftId) {
    if (!leftId) return;
    if (state.lockedConnections.has(leftId)) return; // locked = locked
    state.connections.delete(leftId);
    state.lastWrongLefts.delete(leftId);
  }
  function findLeftByRight(rightId) {
    for (const [lid, info] of state.connections) {
      if (info && info.rightPairId === rightId) return lid;
    }
    return null;
  }

  // ─── Tap-Handlers ───
  function tapLeft(leftId) {
    if (unmounted) return;
    if (state.status === 'correct') return;
    if (state.lockedConnections.has(leftId)) return;

    if (state.selectedLeft === leftId) {
      state.selectedLeft = null;
      rerender();
      return;
    }
    if (state.connections.has(leftId)) {
      disconnect(leftId);
    }
    state.selectedLeft = leftId;
    state.lastWrongLefts.clear();
    if (state.status === 'wrong') state.status = 'predict';
    rerender();
    focusItem(leftId, 'left');
  }

  function tapRight(rightId) {
    if (unmounted) return;
    if (state.status === 'correct') return;

    // Locked-rechts? -> no retap.
    let lockedLeftForThisRight = null;
    for (const lid of state.lockedConnections) {
      const info = state.connections.get(lid);
      if (info && info.rightPairId === rightId) { lockedLeftForThisRight = lid; break; }
    }
    if (lockedLeftForThisRight) return;

    const existingLeftForThisRight = findLeftByRight(rightId);
    if (existingLeftForThisRight && !state.selectedLeft) {
      // Re-Tap auf verbundenes Right ohne Selection -> trennen.
      disconnect(existingLeftForThisRight);
      state.lastWrongLefts.clear();
      if (state.status === 'wrong') state.status = 'predict';
      rerender();
      return;
    }

    if (!state.selectedLeft) return;

    const leftId = state.selectedLeft;
    if (existingLeftForThisRight && existingLeftForThisRight !== leftId) {
      disconnect(existingLeftForThisRight);
    }
    if (state.connections.has(leftId)) {
      disconnect(leftId);
    }
    const colorSlot = _assignColorSlot(state, leftId);
    state.connections.set(leftId, { rightPairId: rightId, colorSlot: colorSlot });
    state.selectedLeft = null;
    state.lastWrongLefts.clear();
    if (state.status === 'wrong') state.status = 'predict';
    rerender();
    focusItem(rightId, 'right');
  }

  // ─── Check ───
  function check() {
    if (unmounted) return;
    if (state.status === 'correct') return;

    const wrongLefts = new Set();
    const total = state.config.pairs.length;
    let correctCount = 0;
    for (const p of state.config.pairs) {
      const conn = state.connections.get(p.id);
      if (conn && conn.rightPairId === p.id) {
        state.lockedConnections.add(p.id);
        correctCount++;
      } else if (conn) {
        wrongLefts.add(p.id);
      }
    }
    state.lastWrongLefts = wrongLefts;

    if (correctCount === total) {
      state.status = 'correct';
      state.selectedLeft = null;
      rerender();
      if (!reducedMotion && root) {
        root.querySelectorAll('.lf-dm-item').forEach(el => el.classList.add('lf-dm-pulse'));
        setTimeout(() => {
          if (unmounted || !root.isConnected) return;
          root.querySelectorAll('.lf-dm-item').forEach(el => el.classList.remove('lf-dm-pulse'));
        }, 700);
      }
    } else {
      state.status = 'wrong';
      state.selectedLeft = null;
      // Falsche Verbindungen aufloesen — Items bleiben durch lf-dm-wrong-Klasse
      // markiert bis zur naechsten User-Aktion. Snapshot in Array, weil
      // disconnect() state.lastWrongLefts (= alias auf wrongLefts) mutiert.
      const wrongList = Array.from(wrongLefts);
      for (const lid of wrongList) {
        disconnect(lid);
        state.lastWrongLefts.add(lid); // wieder rein, disconnect putzt das weg
      }
      rerender();
      if (!reducedMotion && root) {
        root.querySelectorAll('.lf-dm-item.lf-dm-wrong').forEach(el => {
          el.classList.add('lf-dm-shake');
        });
        setTimeout(() => {
          if (unmounted || !root.isConnected) return;
          root.querySelectorAll('.lf-dm-item').forEach(el => el.classList.remove('lf-dm-shake'));
        }, 450);
      }
    }

    // onAnswer-Hook (Phase-2 XP-Vergabe-Boundary, Spec).
    const rightCount = state.lockedConnections.size;
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: state.status === 'correct',
          partial: total > 0 ? rightCount / total : 0,
          raw: { lockedCount: rightCount, total: total }
        });
      } catch (e) { console.warn('[drag-match onAnswer]', e); }
    });
  }

  function retry() {
    if (unmounted) return;
    if (state.status !== 'wrong') return;
    state.status = 'predict';
    state.selectedLeft = null;
    state.lastWrongLefts.clear();
    rerender();
  }

  // ─── Click-Delegation (root-scoped, kein document-Listener mehr) ───
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-dm-action]');
    if (!el || !root.contains(el)) return;
    const action = el.getAttribute('data-dm-action');
    if (action === 'check') {
      check();
    } else if (action === 'retry') {
      retry();
    } else if (action === 'select-left' || action === 'select-right') {
      if (el.getAttribute('aria-disabled') === 'true') return;
      const pairId = el.getAttribute('data-dm-pair-id');
      if (!pairId) return;
      if (action === 'select-left') tapLeft(pairId);
      else                          tapRight(pairId);
    }
  }

  // ─── Keyboard: Enter / Space auf .lf-dm-item triggert Tap. Tab navigiert
  // nativ (tabindex=0). Buttons bekommen native Enter/Space-Behandlung. ───
  // Spec a11y: Paar-Matcher muss Tab + Enter (Auswahl) + Tab + Enter (Ziel)
  // funktionieren — schon im Original vorhanden, hier nur root-scoped.
  function onKeydown(ev) {
    if (unmounted) return;
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    const target = ev.target;
    if (!target || !target.classList || !target.classList.contains('lf-dm-item')) return;
    if (!root.contains(target)) return;
    if (target.getAttribute('aria-disabled') === 'true') return;
    const pairId = target.getAttribute('data-dm-pair-id');
    const side = target.getAttribute('data-dm-side');
    if (!pairId || !side) return;
    ev.preventDefault();
    if (side === 'left')  tapLeft(pairId);
    else                  tapRight(pairId);
  }

  if (root) {
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
  }

  // ─── Instance ───
  return {
    widgetType: 'drag-match',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
        try { root.removeEventListener('keydown', onKeydown); } catch (e) {}
      }
      // DOM nicht selbst leeren — _loader.js / closeSubtopic schmeissen
      // den Subtree weg. Wir geben nur Listeners + Closure-State frei.
      answerCbs.length = 0;
    },

    onAnswer(cb) {
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      // Plain-JSON-serializable Snapshot. Map -> Array<[k,v]>, Set -> Array.
      const conns = [];
      for (const [lid, info] of state.connections) {
        conns.push([lid, { rightPairId: info.rightPairId, colorSlot: info.colorSlot }]);
      }
      return {
        rightOrder:        state.rightOrder.slice(),
        connections:       conns,
        selectedLeft:      state.selectedLeft,
        lockedConnections: Array.from(state.lockedConnections),
        status:            state.status,
        lastWrongLefts:    Array.from(state.lastWrongLefts)
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      const known = new Set(state.config.pairs.map(p => p.id));
      if (Array.isArray(s.rightOrder)
          && s.rightOrder.length === state.config.pairs.length
          && s.rightOrder.every(id => known.has(id))) {
        state.rightOrder = s.rightOrder.slice();
      }
      if (Array.isArray(s.connections)) {
        state.connections = new Map();
        for (const entry of s.connections) {
          if (!Array.isArray(entry) || entry.length !== 2) continue;
          const lid = entry[0];
          const info = entry[1];
          if (!known.has(lid) || !info || !known.has(info.rightPairId)) continue;
          const slot = (typeof info.colorSlot === 'number' && info.colorSlot >= 1 && info.colorSlot <= 6)
            ? info.colorSlot : 1;
          state.connections.set(lid, { rightPairId: info.rightPairId, colorSlot: slot });
        }
      }
      state.selectedLeft = (typeof s.selectedLeft === 'string' && known.has(s.selectedLeft))
        ? s.selectedLeft : null;
      if (Array.isArray(s.lockedConnections)) {
        state.lockedConnections = new Set(s.lockedConnections.filter(id => known.has(id)));
      }
      if (s.status === 'predict' || s.status === 'wrong' || s.status === 'correct') {
        state.status = s.status;
      }
      if (Array.isArray(s.lastWrongLefts)) {
        state.lastWrongLefts = new Set(s.lastWrongLefts.filter(id => known.has(id)));
      }
      rerender();
    }
  };
}

// Stub-Instance fuer Empty-State / kaputten Container. Idempotent unmount.
function _emptyInstance() {
  let done = false;
  return {
    widgetType: 'drag-match',
    unmount() { done = true; },
    onAnswer() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'drag-match', mount: mount };
export { mount };
