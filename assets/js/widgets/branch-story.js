// ══════════════════════════════════════════
//  LearningForge — Widget: branch-story
//  Welle 4.3 — Karten-basierte Verzweigungs-Story
//  (Geschichte/LER/PB/Bio: Entscheidungspfade)
// ══════════════════════════════════════════
//
// User liest eine Story-Karte (Text + 2-3 Choice-Buttons). Klick → nächste
// Karte. Am Ende: Pfad-Zusammenfassung ("Start → Ultimatum → Krieg") und
// optionaler onAnswer-Hook mit dem gewählten Pfad.
//
// Hard-Rule #3: node.text und choice.label sind entity-encoded vom Müller —
// gehen 1:1 ins innerHTML des Card-Containers (role="region" + aria-live).
// Node-IDs und endLabel werden via _ea escaped.
//
// Reduce-Motion: Card-Wechsel ohne CSS-fade-Klasse (instant swap).
//
// onAnswer: { path: ["start","ultimatum","end_war"], endLabel: "Historischer Verlauf" }
// getState/setState: { currentNode, path, finished }

import { lfWidgetReducedMotion } from './_base.js';

let _SEQ = 0;
const _slot = () => 'lf-bs-' + Date.now().toString(36) + '-' + (++_SEQ);

const _ea = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Config-Normalisierung ─────────────────────────────────
function _normalize(c) {
  if (!c || typeof c !== 'object') return null;
  const startNode = typeof c.startNode === 'string' ? c.startNode : null;
  const nodes = c.nodes && typeof c.nodes === 'object' ? c.nodes : null;
  if (!startNode || !nodes || !nodes[startNode]) return null;

  // Alle Nodes validieren: jeder muss text haben + entweder choices (Array)
  // oder end:true.
  for (const [id, node] of Object.entries(nodes)) {
    if (!node || typeof node !== 'object') return null;
    if (typeof node.text !== 'string') return null;
    if (node.end !== true) {
      if (!Array.isArray(node.choices) || node.choices.length < 1) return null;
      for (const ch of node.choices) {
        if (!ch || typeof ch.label !== 'string' || typeof ch.next !== 'string') return null;
        if (!nodes[ch.next]) return null;          // dangling pointer
      }
    }
  }

  return {
    label:     typeof c.label === 'string' ? c.label : '',
    startNode: startNode,
    nodes:     nodes,
    showPath:  c.showPath !== false       // default true
  };
}

// ── Shell-Render ─────────────────────────────────────────
function _renderShell(slotId, norm) {
  const titleH = norm.label
    ? '<h4 class="lf-bs-title">' + _ea(norm.label) + '</h4>'
    : '';
  return (
    '<div class="lf-widget-branch-story" id="' + _ea(slotId) + '" data-bs-slot="' + _ea(slotId) + '">'
    + titleH
    + '<div class="lf-bs-step-counter" data-bs-counter aria-live="off"></div>'
    + '<div class="lf-bs-card" role="region" aria-live="polite" aria-atomic="true" data-bs-card></div>'
    + '<div class="lf-bs-choices" data-bs-choices></div>'
    + '<div class="lf-bs-path" data-bs-path hidden></div>'
    + '</div>'
  );
}

// ── Card Content ─────────────────────────────────────────
function _renderCard(node, step, reducedMotion, cardEl, choicesEl) {
  // text ist entity-encoded (Müller-Konvention) → innerHTML
  cardEl.innerHTML = '<p class="lf-bs-card-text">' + node.text + '</p>';

  if (!reducedMotion) {
    cardEl.classList.remove('lf-bs-card-in');
    // Force reflow, then animate
    void cardEl.offsetWidth;
    cardEl.classList.add('lf-bs-card-in');
  }

  if (node.end) {
    choicesEl.innerHTML =
      '<div class="lf-bs-end-label">'
      + (typeof node.endLabel === 'string' ? node.endLabel : 'Ende')
      + '</div>';
  } else {
    choicesEl.innerHTML = node.choices.map((ch, i) =>
      '<button type="button" class="lf-bs-choice" data-bs-choice="' + i + '">'
      + ch.label
      + '</button>'
    ).join('');
  }
}

// ── Path Display ─────────────────────────────────────────
function _renderPath(pathIds, nodes, pathEl) {
  const labels = pathIds.map(id => {
    const n = nodes[id];
    // Use endLabel for end-nodes as suffix, else fall back to node text
    // truncated to 30 chars
    if (n && n.end && typeof n.endLabel === 'string') return n.endLabel;
    if (n && typeof n.text === 'string') {
      const raw = n.text.replace(/&[a-z#0-9]+;/gi, '·');
      return raw.length > 28 ? raw.slice(0, 26) + '…' : raw;
    }
    return id;
  });
  pathEl.innerHTML =
    '<span class="lf-bs-path-label">Dein Weg:</span> '
    + labels.map(l => '<span class="lf-bs-path-step">' + _ea(l) + '</span>').join('<span class="lf-bs-path-arrow"> → </span>');
}

// ── mount() ──────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _empty();
  const norm = _normalize(config);
  const slotId = _slot();

  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-branch-story lf-bs-empty" data-bs-slot="' + _ea(slotId) + '">'
      + 'Diese Story-Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _empty();
  }

  container.innerHTML = _renderShell(slotId, norm);
  const root      = container.querySelector('#' + CSS.escape(slotId));
  const cardEl    = root.querySelector('[data-bs-card]');
  const choicesEl = root.querySelector('[data-bs-choices]');
  const pathEl    = root.querySelector('[data-bs-path]');
  const counterEl = root.querySelector('[data-bs-counter]');

  try {
    container.setAttribute('aria-label', 'Interaktive Story: ' + (norm.label || 'Verzweigungs-Story'));
  } catch (e) {}

  const reducedMotion = lfWidgetReducedMotion();
  if (reducedMotion) root.classList.add('lf-bs-reduced-motion');

  const state = {
    currentNode: norm.startNode,
    path: [norm.startNode],
    finished: false
  };
  let unmounted = false;
  const _answerCbs = [];

  function _stepLabel() {
    return 'Schritt ' + state.path.length;
  }

  function _applyNode(nodeId) {
    const node = norm.nodes[nodeId];
    if (!node) return;
    state.currentNode = nodeId;

    if (counterEl) counterEl.textContent = _stepLabel();
    _renderCard(node, state.path.length, reducedMotion, cardEl, choicesEl);

    if (node.end) {
      state.finished = true;
      root.classList.add('lf-bs-done');
      if (norm.showPath && pathEl) {
        pathEl.hidden = false;
        _renderPath(state.path, norm.nodes, pathEl);
      }
      // Fire onAnswer
      const result = {
        path: state.path.slice(),
        endLabel: typeof node.endLabel === 'string' ? node.endLabel : ''
      };
      _answerCbs.forEach(cb => {
        try { cb(result); } catch (e) { console.warn('[branch-story onAnswer]', e); }
      });
    }
  }

  function _choose(choiceIndex) {
    if (unmounted || state.finished) return;
    const node = norm.nodes[state.currentNode];
    if (!node || !node.choices || !node.choices[choiceIndex]) return;
    const next = node.choices[choiceIndex].next;
    if (!norm.nodes[next]) return;
    state.path.push(next);
    _applyNode(next);
  }

  function onClick(ev) {
    if (unmounted) return;
    const btn = ev.target && ev.target.closest && ev.target.closest('[data-bs-choice]');
    if (!btn || !root.contains(btn)) return;
    const idx = parseInt(btn.getAttribute('data-bs-choice'), 10);
    if (!Number.isNaN(idx)) _choose(idx);
  }

  root.addEventListener('click', onClick);
  _applyNode(norm.startNode);

  return {
    widgetType: 'branch-story',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      try { root.removeEventListener('click', onClick); } catch (e) {}
      _answerCbs.length = 0;
    },

    pause()   { /* no timers */ },
    resume()  { /* no timers */ },
    onTheme() { /* pure CSS vars */ },

    onAnswer(cb) {
      if (typeof cb === 'function') _answerCbs.push(cb);
    },

    getState() {
      return {
        currentNode: state.currentNode,
        path:        state.path.slice(),
        finished:    state.finished
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object' || unmounted) return;
      // Replay path from scratch to re-render correctly
      const newPath = Array.isArray(s.path) ? s.path.filter(id => norm.nodes[id]) : null;
      if (!newPath || newPath.length < 1) return;
      state.path = newPath;
      state.finished = false;
      root.classList.remove('lf-bs-done');
      if (pathEl) pathEl.hidden = true;
      _applyNode(newPath[newPath.length - 1]);
    }
  };
}

function _empty() {
  return {
    widgetType: 'branch-story',
    unmount() {}, pause() {}, resume() {}, onTheme() {},
    onAnswer() {}, getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'branch-story', mount: mount };
export { mount };
