// ══════════════════════════════════════════
//  LearningForge — Widget: drag-sort
//  Migrated from app.js:2014-2530 (Phase 0 Commit 5)
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════
//
// Schueler bringt Items in die richtige Reihenfolge (z.B. Schlieffenplan,
// Mitose-Phasen, Argumente nach Klimax). Mobile-first: Pfeil-Buttons sind
// primaerer Interaktionspfad, Touch-Drag + HTML5-Drag sind Komfort-Layer,
// Keyboard (Pfeil hoch/runter, Enter zum Pruefen) ist Vollwert-A11y-Pfad.
//
// Hard-Rule #3 (legacy entity-encoding): setup/question/label/reveal kommen
// aus dem JSON und gehen 1:1 ins innerHTML — KEIN escapeHtml darauf, das
// wuerde Entitaeten doppelt-encoden. Custom-Topics-Future = separate
// Sanitisier-Stufe beim Upload, nicht hier.

import { lfWidgetReducedMotion } from './_base.js';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-ds-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
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

// Fisher-Yates shuffle. Garantiert: result !== input-order falls items.length>=2
// (sonst waere Aufgabe trivial wenn Schema = correctOrder). Notfall-fallback:
// bei <=1 item return as-is (nichts zu sortieren).
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
  // Last resort: swap erste zwei
  const b = ids.slice();
  if (b.length >= 2) { const t = b[0]; b[0] = b[1]; b[1] = t; }
  return b;
}

// Defensive Validation. Gibt null zurueck wenn unbrauchbar (zu wenig items,
// Length-Mismatch, doppelte ids, fehlende ids in correctOrder).
function _normalizeConfig(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return null;
  const items = Array.isArray(rawConfig.items) ? rawConfig.items : [];
  const correctOrder = Array.isArray(rawConfig.correctOrder) ? rawConfig.correctOrder.slice() : [];
  if (items.length < 2 || correctOrder.length !== items.length) return null;
  const itemIds = items.map(it => (it && typeof it.id === 'string') ? it.id : null);
  if (itemIds.some(id => !id)) return null;
  const idSet = new Set(itemIds);
  if (idSet.size !== itemIds.length) return null; // doppelte ids
  for (const id of correctOrder) {
    if (!idSet.has(id)) return null;
  }
  const normItems = items.map(it => ({
    id:    it.id,
    label: typeof it.label === 'string' ? it.label : ''
  }));
  return {
    setup:        typeof rawConfig.setup === 'string'    ? rawConfig.setup    : '',
    question:     typeof rawConfig.question === 'string' ? rawConfig.question : '',
    items:        normItems,
    correctOrder: correctOrder,
    reveal:       typeof rawConfig.reveal === 'string'   ? rawConfig.reveal   : ''
  };
}

// Item-LI-Renderer. idx + state werden durchgereicht damit Move-Buttons an
// Listenraendern bzw. neben Locked-Items disabled gesetzt werden (Sophie-Fix-2).
function _renderItem(slotId, item, isLockedCorrect, idx, state) {
  const lockClass = isLockedCorrect ? ' lf-ds-locked-correct' : '';
  let upDisabled = isLockedCorrect;
  let downDisabled = isLockedCorrect;
  if (typeof idx === 'number' && state && Array.isArray(state.currentOrder)) {
    const len = state.currentOrder.length;
    const isFirst = idx === 0;
    const isLast  = idx === len - 1;
    const upNeighborLocked   = !isFirst && state.lockedIds.has(state.currentOrder[idx - 1]);
    const downNeighborLocked = !isLast  && state.lockedIds.has(state.currentOrder[idx + 1]);
    upDisabled   = isLockedCorrect || isFirst || !!upNeighborLocked;
    downDisabled = isLockedCorrect || isLast  || !!downNeighborLocked;
  }
  // Sophie-Fix-3: aria-label auf locked-Items + aria-disabled. Tab-Index bleibt,
  // damit User hinfokussieren + den Status hoeren kann.
  const lockedAriaAttrs = isLockedCorrect
    ? ' aria-label="Richtige Position. Item gesperrt." aria-disabled="true"'
    : '';
  return '<li class="lf-ds-item' + lockClass + '" '
       +   'data-ds-slot="' + _escapeAttr(slotId) + '" '
       +   'data-ds-item-id="' + _escapeAttr(item.id) + '" '
       +   'tabindex="0" '
       +   'draggable="' + (isLockedCorrect ? 'false' : 'true') + '"' + lockedAriaAttrs + '>'
       +   '<span class="lf-ds-grip" aria-hidden="true">&#9776;</span>'
       +   '<span class="lf-ds-label">' + item.label + '</span>'
       +   '<span class="lf-ds-arrows">'
       +     '<button type="button" class="lf-ds-arrow lf-ds-arrow-up" '
       +       'data-ds-action="move-up" '
       +       'data-ds-item-id="' + _escapeAttr(item.id) + '" '
       +       'aria-label="Nach oben verschieben"' + (upDisabled ? ' disabled' : '') + '>&#9650;</button>'
       +     '<button type="button" class="lf-ds-arrow lf-ds-arrow-down" '
       +       'data-ds-action="move-down" '
       +       'data-ds-item-id="' + _escapeAttr(item.id) + '" '
       +       'aria-label="Nach unten verschieben"' + (downDisabled ? ' disabled' : '') + '>&#9660;</button>'
       +   '</span>'
       + '</li>';
}

// Initial-HTML.
function _renderHtml(norm, slotId, initialState) {
  const setupHtml    = norm.setup    ? '<div class="lf-ds-setup">' + norm.setup + '</div>' : '';
  const questionHtml = norm.question ? '<h4 class="lf-ds-question">' + norm.question + '</h4>' : '';

  const itemsHtml = initialState.currentOrder.map((id, idx) => {
    const it = norm.items.find(x => x.id === id);
    if (!it) return '';
    return _renderItem(slotId, it, initialState.lockedIds.has(id), idx, initialState);
  }).join('');

  const revealHtml = norm.reveal
    ? '<div class="lf-ds-reveal" id="' + _escapeAttr(slotId) + '-reveal" hidden>'
    +    '<div class="lf-ds-reveal-heading">Erkl&auml;rung</div>'
    +    '<div class="lf-ds-reveal-body">' + norm.reveal + '</div>'
    + '</div>'
    : '';

  return '<div class="lf-widget-drag-sort lf-ds-state-predict" '
       +   'id="' + _escapeAttr(slotId) + '" data-ds-slot="' + _escapeAttr(slotId) + '">'
       +   setupHtml
       +   questionHtml
       +   '<ol class="lf-ds-list" role="list">' + itemsHtml + '</ol>'
       +   '<div class="lf-ds-hint" id="' + _escapeAttr(slotId) + '-hint" role="status" aria-live="polite" hidden></div>'
       +   '<div class="lf-ds-actions">'
       +     '<button type="button" class="lf-ds-check" '
       +       'data-ds-action="check">Pr&uuml;fen</button>'
       +     '<button type="button" class="lf-ds-retry" '
       +       'data-ds-action="retry" hidden>Nochmal versuchen</button>'
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
      '<div class="lf-widget-drag-sort lf-ds-empty" data-ds-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  // Per-Instance-State.
  const itemIds = norm.items.map(it => it.id);
  const state = {
    config:       norm,
    currentOrder: _shuffleIds(itemIds),
    lockedIds:    new Set(),
    status:       'predict' // 'predict' | 'wrong' | 'correct'
  };
  let unmounted = false;
  const answerCbs = [];

  container.innerHTML = _renderHtml(norm, slotId, state);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Interaktive Aufgabe: Reihenfolge sortieren');
  } catch (e) {}

  // Reduce-Motion: skip shake + pulse-Animationen (Spec R-2 / a11y).
  const reducedMotion = lfWidgetReducedMotion();

  // ─── Re-Render der <ol> aus state.currentOrder ───
  function rerenderList() {
    if (unmounted || !root) return;
    const list = root.querySelector('.lf-ds-list');
    if (!list) return;
    const items = state.config.items;
    const itemsHtml = state.currentOrder.map((id, idx) => {
      const it = items.find(x => x.id === id);
      if (!it) return '';
      return _renderItem(slotId, it, state.lockedIds.has(id), idx, state);
    }).join('');
    list.innerHTML = itemsHtml;

    root.classList.toggle('lf-ds-state-predict',  state.status === 'predict');
    root.classList.toggle('lf-ds-state-wrong',    state.status === 'wrong');
    root.classList.toggle('lf-ds-state-correct',  state.status === 'correct');

    const hint = root.querySelector('#' + CSS.escape(slotId) + '-hint');
    const retryBtn = root.querySelector('.lf-ds-retry');
    const checkBtn = root.querySelector('.lf-ds-check');
    const reveal   = root.querySelector('#' + CSS.escape(slotId) + '-reveal');

    if (state.status === 'wrong') {
      const total = state.config.correctOrder.length;
      const rightCount = state.lockedIds.size;
      if (hint) {
        hint.hidden = false;
        hint.textContent = 'Von ' + total + ' richtig: ' + rightCount + '. Verschiebe die anderen.';
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

  // ─── Reorder-Helper ───
  function move(itemId, direction) {
    if (unmounted) return;
    if (state.status === 'correct') return;
    if (state.lockedIds.has(itemId)) return;
    const idx = state.currentOrder.indexOf(itemId);
    if (idx < 0) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= state.currentOrder.length) return;
    const neighborId = state.currentOrder[target];
    if (state.lockedIds.has(neighborId)) return;
    const a = state.currentOrder.slice();
    const t = a[idx]; a[idx] = a[target]; a[target] = t;
    state.currentOrder = a;
    if (state.status === 'wrong') state.status = 'predict';
    rerenderList();
  }

  // ─── Drop-Insertion (Drag + Touch nutzen das gemeinsam) ───
  function insertBefore(srcId, dstId) {
    if (unmounted) return;
    if (state.status === 'correct') return;
    if (!srcId || !dstId || srcId === dstId) return;
    if (state.lockedIds.has(srcId) || state.lockedIds.has(dstId)) return;
    const order = state.currentOrder.slice();
    const sIdx = order.indexOf(srcId);
    if (sIdx < 0) return;
    order.splice(sIdx, 1);
    const dIdx = order.indexOf(dstId);
    if (dIdx < 0) return;
    order.splice(dIdx, 0, srcId);
    state.currentOrder = order;
    if (state.status === 'wrong') state.status = 'predict';
    rerenderList();
  }

  // ─── Check ───
  function check() {
    if (unmounted) return;
    if (state.status === 'correct') return;
    const correct = state.config.correctOrder;
    const cur = state.currentOrder;
    let allRight = true;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] === correct[i]) {
        state.lockedIds.add(cur[i]);
      } else {
        allRight = false;
      }
    }
    if (allRight) {
      state.status = 'correct';
      rerenderList();
      // Pulse-animation: nur ohne reduce-motion.
      if (!reducedMotion && root) {
        root.querySelectorAll('.lf-ds-item').forEach(el => el.classList.add('lf-ds-pulse'));
        setTimeout(() => {
          if (unmounted || !root.isConnected) return;
          root.querySelectorAll('.lf-ds-item').forEach(el => el.classList.remove('lf-ds-pulse'));
        }, 700);
      }
    } else {
      state.status = 'wrong';
      rerenderList();
      if (!reducedMotion && root) {
        root.querySelectorAll('.lf-ds-item').forEach(el => {
          const id = el.getAttribute('data-ds-item-id');
          if (id && !state.lockedIds.has(id)) {
            el.classList.add('lf-ds-shake');
          }
        });
        setTimeout(() => {
          if (unmounted || !root.isConnected) return;
          root.querySelectorAll('.lf-ds-item').forEach(el => el.classList.remove('lf-ds-shake'));
        }, 450);
      }
    }
    // onAnswer-Hook (Phase-2 XP-Vergabe-Boundary, Spec).
    const total = state.config.correctOrder.length;
    const rightCount = state.lockedIds.size;
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: state.status === 'correct',
          partial: total > 0 ? rightCount / total : 0,
          raw: { lockedCount: rightCount, total: total }
        });
      } catch (e) { console.warn('[drag-sort onAnswer]', e); }
    });
  }

  function retry() {
    if (unmounted) return;
    if (state.status !== 'wrong') return;
    state.status = 'predict';
    rerenderList();
  }

  // ─── Click-Delegation (root-scoped, kein document-Listener mehr) ───
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const btn = t.closest('[data-ds-action]');
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute('data-ds-action');
    if (action === 'move-up') {
      const id = btn.getAttribute('data-ds-item-id');
      if (id) move(id, 'up');
    } else if (action === 'move-down') {
      const id = btn.getAttribute('data-ds-item-id');
      if (id) move(id, 'down');
    } else if (action === 'check') {
      check();
    } else if (action === 'retry') {
      retry();
    }
  }

  // ─── Keyboard (Pfeil hoch/runter auf .lf-ds-item, Enter zum Pr\xfcfen) ───
  // Original-Code hatte Pfeil-Tasten, Enter-zum-Pr\xfcfen ist neu (Spec a11y).
  function onKeydown(ev) {
    if (unmounted) return;
    const target = ev.target;
    if (!target || !target.classList) return;
    if (target.classList.contains('lf-ds-item')
        && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown')) {
      const itemId = target.getAttribute('data-ds-item-id');
      if (!itemId) return;
      ev.preventDefault();
      move(itemId, ev.key === 'ArrowUp' ? 'up' : 'down');
      // Refokus aufs neu gerenderte item, damit Tastatur-Workflow weitergeht.
      setTimeout(() => {
        if (unmounted || !root) return;
        const next = root.querySelector('.lf-ds-item[data-ds-item-id="' + CSS.escape(itemId) + '"]');
        if (next && typeof next.focus === 'function') next.focus();
      }, 0);
      return;
    }
    // Enter auf Item ODER auf check-button = check (a11y-Bonus). Item-Enter
    // wird nur akzeptiert wenn nicht schon im correct-state.
    if (ev.key === 'Enter' && target.classList.contains('lf-ds-item')) {
      ev.preventDefault();
      if (state.status !== 'correct') check();
    }
  }

  // ─── HTML5-Drag (Desktop), root-scoped ───
  let dragSrc = null; // itemId
  function onDragstart(ev) {
    const item = ev.target && ev.target.closest && ev.target.closest('.lf-ds-item');
    if (!item || !root.contains(item)) return;
    if (item.classList.contains('lf-ds-locked-correct')) {
      ev.preventDefault();
      return;
    }
    const itemId = item.getAttribute('data-ds-item-id');
    if (!itemId) return;
    dragSrc = itemId;
    item.classList.add('lf-ds-dragging');
    try {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', itemId);
    } catch (e) {}
  }
  function onDragend(ev) {
    const item = ev.target && ev.target.closest && ev.target.closest('.lf-ds-item');
    if (item) item.classList.remove('lf-ds-dragging');
    dragSrc = null;
  }
  function onDragover(ev) {
    if (!dragSrc) return;
    const item = ev.target && ev.target.closest && ev.target.closest('.lf-ds-item');
    if (!item || !root.contains(item)) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'move'; } catch (e) {}
  }
  function onDrop(ev) {
    if (!dragSrc) return;
    const item = ev.target && ev.target.closest && ev.target.closest('.lf-ds-item');
    if (!item || !root.contains(item)) return;
    const dstId = item.getAttribute('data-ds-item-id');
    const srcId = dragSrc;
    dragSrc = null;
    if (!dstId || dstId === srcId) return;
    ev.preventDefault();
    insertBefore(srcId, dstId);
  }

  // ─── Touch-Drag (Mobile), root-scoped ───
  let touch = null; // { itemId, startY, el }
  function onTouchstart(ev) {
    if (!ev.touches || ev.touches.length !== 1) return;
    const t = ev.touches[0];
    const grip = t.target && t.target.closest && t.target.closest('.lf-ds-grip');
    if (!grip) return;
    const item = grip.closest('.lf-ds-item');
    if (!item || !root.contains(item)) return;
    if (item.classList.contains('lf-ds-locked-correct')) return;
    const itemId = item.getAttribute('data-ds-item-id');
    if (!itemId) return;
    touch = { itemId: itemId, startY: t.clientY, el: item };
    item.classList.add('lf-ds-dragging');
  }
  function onTouchmove(ev) {
    if (!touch) return;
    if (!ev.touches || ev.touches.length !== 1) return;
    const t = ev.touches[0];
    const dy = t.clientY - touch.startY;
    if (touch.el) {
      touch.el.style.transform = 'translateY(' + dy + 'px)';
      touch.el.style.zIndex = '5';
    }
    if (Math.abs(dy) > 10) {
      try { ev.preventDefault(); } catch (e) {}
    }
  }
  function onTouchend(ev) {
    if (!touch) return;
    const drag = touch;
    touch = null;
    if (drag.el) {
      drag.el.style.transform = '';
      drag.el.style.zIndex = '';
      drag.el.classList.remove('lf-ds-dragging');
    }
    const ct = ev.changedTouches && ev.changedTouches[0];
    if (!ct) return;
    const dropEl = document.elementFromPoint(ct.clientX, ct.clientY);
    if (!dropEl || !dropEl.closest) return;
    const dstItem = dropEl.closest('.lf-ds-item');
    if (!dstItem || !root.contains(dstItem)) return;
    const dstId = dstItem.getAttribute('data-ds-item-id');
    if (!dstId || dstId === drag.itemId) return;
    insertBefore(drag.itemId, dstId);
  }
  // Sophie-Fix-1: touchcancel raeumt Zombie-State weg, wenn das OS den Touch
  // abbricht (Notification-Pull, Multi-Touch, System-Wisch-Geste).
  function onTouchcancel() {
    if (!touch) return;
    const drag = touch;
    touch = null;
    if (drag.el) {
      drag.el.style.transform = '';
      drag.el.style.zIndex = '';
      drag.el.classList.remove('lf-ds-dragging');
    }
  }

  // Listener anhaengen.
  if (root) {
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    root.addEventListener('dragstart', onDragstart);
    root.addEventListener('dragend', onDragend);
    root.addEventListener('dragover', onDragover);
    root.addEventListener('drop', onDrop);
    root.addEventListener('touchstart', onTouchstart, { passive: true });
    root.addEventListener('touchmove', onTouchmove, { passive: false });
    root.addEventListener('touchend', onTouchend);
    root.addEventListener('touchcancel', onTouchcancel);
  }

  // ─── Instance ───
  return {
    widgetType: 'drag-sort',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
        try { root.removeEventListener('keydown', onKeydown); } catch (e) {}
        try { root.removeEventListener('dragstart', onDragstart); } catch (e) {}
        try { root.removeEventListener('dragend', onDragend); } catch (e) {}
        try { root.removeEventListener('dragover', onDragover); } catch (e) {}
        try { root.removeEventListener('drop', onDrop); } catch (e) {}
        try { root.removeEventListener('touchstart', onTouchstart); } catch (e) {}
        try { root.removeEventListener('touchmove', onTouchmove); } catch (e) {}
        try { root.removeEventListener('touchend', onTouchend); } catch (e) {}
        try { root.removeEventListener('touchcancel', onTouchcancel); } catch (e) {}
      }
      answerCbs.length = 0;
    },

    onAnswer(cb) {
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      return {
        currentOrder: state.currentOrder.slice(),
        lockedIds:    Array.from(state.lockedIds),
        status:       state.status
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (Array.isArray(s.currentOrder)) {
        // Defensiv: nur akzeptieren, wenn alle ids dem config-set entsprechen.
        const known = new Set(state.config.items.map(it => it.id));
        if (s.currentOrder.length === state.config.items.length
            && s.currentOrder.every(id => known.has(id))) {
          state.currentOrder = s.currentOrder.slice();
        }
      }
      if (Array.isArray(s.lockedIds)) {
        state.lockedIds = new Set(s.lockedIds);
      }
      if (s.status === 'predict' || s.status === 'wrong' || s.status === 'correct') {
        state.status = s.status;
      }
      rerenderList();
    }
  };
}

// Stub-Instance fuer Empty-State / kaputten Container. Idempotent unmount.
function _emptyInstance() {
  let done = false;
  return {
    widgetType: 'drag-sort',
    unmount() { done = true; },
    onAnswer() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'drag-sort', mount: mount };
export { mount };
