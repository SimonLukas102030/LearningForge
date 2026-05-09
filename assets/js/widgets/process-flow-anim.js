// ══════════════════════════════════════════
//  LearningForge — Widget: process-flow-anim
//  Welle 2.1 — SVG Schritt-fuer-Schritt-Animation
//  (siehe Plan 2026-05-09-interaktiv-ausbau.md, W2.1)
// ══════════════════════════════════════════
//
// Animiertes Flow-Diagramm. User schaltet via Buttons (oder Auto-Play) durch
// Schritte eines Prozesses (Photosynthese, Reflexbogen, Wasserkreislauf …).
// Pro Schritt:
//   - SVG-Knoten + -Edges aus highlightNodes/highlightEdges glühen via
//     CSS-Klasse .lf-pf-highlight (drop-shadow + Pulse-Animation).
//   - Schritt-Text in aria-live-Region unter dem SVG.
// Steuerung: Prev / Play-Pause / Next / Reset + Step-Counter.
//
// Pure SVG mit CSS-Vars — onTheme() ist no-op (Theme-Wechsel zieht durch
// CSS-Vars automatisch). Reduce-Motion: keine Pulse-Animation, Auto-Play
// deaktiviert, statische Highlights.
//
// Hard-Rule #3: label/text-Strings aus Config gehen 1:1 ins SVG <text> bzw.
// <div> (raw UTF-8). Ids gehen via _escapeAttr in Attribute.

import { lfWidgetReducedMotion } from './_base.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-pf-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

function _escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Config-Normalisierung ─────────────────────────────────
function _normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  if (nodes.length < 1 || steps.length < 1) return null;

  const nodeById = new Map();
  const normNodes = [];
  for (const n of nodes) {
    if (!n || typeof n !== 'object') return null;
    const id = typeof n.id === 'string' ? n.id : '';
    const x = Number(n.x);
    const y = Number(n.y);
    if (!id || nodeById.has(id) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const shape = (n.shape === 'rect' || n.shape === 'ellipse') ? n.shape : 'circle';
    const node = {
      id: id, x: x, y: y, shape: shape,
      label: typeof n.label === 'string' ? n.label : '',
      size: Number.isFinite(+n.size) ? +n.size : 30,
      w: Number.isFinite(+n.w) ? +n.w : 80,
      h: Number.isFinite(+n.h) ? +n.h : 50,
      rx: Number.isFinite(+n.rx) ? +n.rx : 40,
      ry: Number.isFinite(+n.ry) ? +n.ry : 25
    };
    nodeById.set(id, node);
    normNodes.push(node);
  }

  const normEdges = [];
  for (const e of edges) {
    if (!e || typeof e !== 'object') continue;
    const from = typeof e.from === 'string' ? e.from : '';
    const to   = typeof e.to === 'string' ? e.to : '';
    if (!nodeById.has(from) || !nodeById.has(to)) continue;
    normEdges.push({
      id: from + '-' + to,
      from: from, to: to,
      label: typeof e.label === 'string' ? e.label : ''
    });
  }

  const normSteps = [];
  for (const s of steps) {
    if (!s || typeof s !== 'object') continue;
    const hn = Array.isArray(s.highlightNodes) ? s.highlightNodes.filter(id => nodeById.has(id)) : [];
    const he = Array.isArray(s.highlightEdges) ? s.highlightEdges.slice() : [];
    normSteps.push({
      highlightNodes: hn,
      highlightEdges: he,
      text: typeof s.text === 'string' ? s.text : ''
    });
  }
  if (normSteps.length < 1) return null;

  let svgW = Number(raw.svgWidth);
  let svgH = Number(raw.svgHeight);
  if (!Number.isFinite(svgW) || svgW <= 0) svgW = 600;
  if (!Number.isFinite(svgH) || svgH <= 0) svgH = 280;

  let dur = Number(raw.stepDuration);
  if (!Number.isFinite(dur) || dur < 400) dur = 2500;

  return {
    label: typeof raw.label === 'string' ? raw.label : '',
    svgWidth: svgW,
    svgHeight: svgH,
    nodes: normNodes,
    nodeById: nodeById,
    edges: normEdges,
    steps: normSteps,
    autoPlay: raw.autoPlay === true,
    stepDuration: dur
  };
}

// ── SVG-Builder ───────────────────────────────────────────
function _setAttrs(el, attrs) {
  for (const k in attrs) el.setAttribute(k, attrs[k]);
}
function _svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) _setAttrs(el, attrs);
  return el;
}

// Pfad zwischen 2 Knoten — von Rand-zu-Rand, nicht Mitte-zu-Mitte
// (sonst verschwindet der Pfeil hinter der Form).
function _edgePath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const r1 = _radius(from);
  const r2 = _radius(to) + 8; // +8 fuer Pfeilspitze-Padding
  const x1 = from.x + ux * r1;
  const y1 = from.y + uy * r1;
  const x2 = to.x - ux * r2;
  const y2 = to.y - uy * r2;
  return 'M' + x1 + ',' + y1 + ' L' + x2 + ',' + y2;
}
function _radius(node) {
  if (node.shape === 'rect')    return Math.max(node.w, node.h) / 2;
  if (node.shape === 'ellipse') return Math.max(node.rx, node.ry);
  return node.size / 2;
}

function _renderShell(slotId, norm) {
  const titleHtml = norm.label
    ? '<h4 class="lf-pf-title">' + norm.label + '</h4>'
    : '';
  return '<div class="lf-widget-process-flow" id="' + _escapeAttr(slotId) + '" data-pf-slot="' + _escapeAttr(slotId) + '">'
       +   titleHtml
       +   '<div class="lf-pf-stage" data-pf-stage></div>'
       +   '<div class="lf-pf-text-box" data-pf-text role="status" aria-live="polite" aria-atomic="true"></div>'
       +   '<div class="lf-pf-controls">'
       +     '<button type="button" class="lf-pf-btn" data-pf-action="reset" aria-label="Zur&uuml;ck zum Anfang">&#x21BB;</button>'
       +     '<button type="button" class="lf-pf-btn" data-pf-action="prev" aria-label="Schritt zur&uuml;ck">&#x23EE;</button>'
       +     '<button type="button" class="lf-pf-btn lf-pf-btn-primary" data-pf-action="play" aria-label="Auto-Play"><span data-pf-play-icon>&#x25B6;</span></button>'
       +     '<button type="button" class="lf-pf-btn" data-pf-action="next" aria-label="Schritt vor">&#x23ED;</button>'
       +     '<span class="lf-pf-counter" data-pf-counter aria-live="polite">1/' + norm.steps.length + '</span>'
       +   '</div>'
       + '</div>';
}

// SVG-Bau: einmal beim mount, danach werden nur Klassen umgeschaltet.
function _buildSvg(norm) {
  const svg = _svg('svg', {
    'class': 'lf-pf-svg',
    'viewBox': '0 0 ' + norm.svgWidth + ' ' + norm.svgHeight,
    'preserveAspectRatio': 'xMidYMid meet',
    'role': 'img',
    'aria-label': 'Animation: ' + (norm.label || 'Prozess-Diagramm')
  });

  // Pfeilspitze-Marker (1x pro SVG, von Edges per marker-end referenziert).
  const defs = _svg('defs');
  const marker = _svg('marker', {
    id: 'lf-pf-arrow',
    viewBox: '0 0 10 10',
    refX: '8', refY: '5',
    markerWidth: '7', markerHeight: '7',
    orient: 'auto-start-reverse'
  });
  const markerPath = _svg('path', {
    d: 'M 0 0 L 10 5 L 0 10 z',
    'class': 'lf-pf-arrow-head'
  });
  marker.appendChild(markerPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  // Edges zuerst (damit sie unter Knoten liegen).
  const edgeRefs = new Map(); // id → { line, label }
  const edgeGroup = _svg('g', { 'class': 'lf-pf-edges' });
  for (const e of norm.edges) {
    const from = norm.nodeById.get(e.from);
    const to   = norm.nodeById.get(e.to);
    const g = _svg('g', { 'class': 'lf-pf-edge', 'data-pf-edge-id': e.id });
    const path = _svg('path', {
      d: _edgePath(from, to),
      'class': 'lf-pf-edge-line',
      'marker-end': 'url(#lf-pf-arrow)'
    });
    g.appendChild(path);
    let labelEl = null;
    if (e.label) {
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2 - 6;
      labelEl = _svg('text', {
        x: mx, y: my,
        'class': 'lf-pf-edge-label',
        'text-anchor': 'middle'
      });
      labelEl.textContent = e.label;
      g.appendChild(labelEl);
    }
    edgeGroup.appendChild(g);
    edgeRefs.set(e.id, { group: g });
  }
  svg.appendChild(edgeGroup);

  // Knoten.
  const nodeRefs = new Map(); // id → { group }
  const nodeGroup = _svg('g', { 'class': 'lf-pf-nodes' });
  for (const n of norm.nodes) {
    const g = _svg('g', {
      'class': 'lf-pf-node lf-pf-node-' + n.shape,
      'data-pf-node-id': n.id,
      transform: 'translate(' + n.x + ',' + n.y + ')'
    });
    let shape;
    if (n.shape === 'rect') {
      shape = _svg('rect', {
        x: -n.w / 2, y: -n.h / 2,
        width: n.w, height: n.h,
        rx: 8, ry: 8,
        'class': 'lf-pf-node-shape'
      });
    } else if (n.shape === 'ellipse') {
      shape = _svg('ellipse', {
        cx: 0, cy: 0, rx: n.rx, ry: n.ry,
        'class': 'lf-pf-node-shape'
      });
    } else {
      shape = _svg('circle', {
        cx: 0, cy: 0, r: n.size / 2,
        'class': 'lf-pf-node-shape'
      });
    }
    g.appendChild(shape);
    // Optionales Bild: "image": "URL" überblendet den Node-Shape.
    // Label erscheint dann als Caption darunter.
    if (n.image) {
      const iw = n.shape === 'rect' ? n.w - 10 : (n.shape === 'ellipse' ? n.rx * 1.6 : n.size * 0.85);
      const ih = n.shape === 'rect' ? n.h - 10 : (n.shape === 'ellipse' ? n.ry * 1.6 : n.size * 0.85);
      g.appendChild(_svg('image', {
        href: n.image, x: -iw / 2, y: -ih / 2,
        width: iw, height: ih,
        preserveAspectRatio: 'xMidYMid meet',
        'class': 'lf-pf-node-image'
      }));
    }
    if (n.label) {
      const yOffset = n.image
        ? (n.shape === 'rect' ? n.h / 2 + 12 : (n.shape === 'ellipse' ? n.ry + 12 : n.size / 2 + 12))
        : 4;
      const t = _svg('text', {
        x: 0, y: yOffset,
        'class': 'lf-pf-node-label' + (n.image ? ' lf-pf-node-label-caption' : ''),
        'text-anchor': 'middle'
      });
      t.textContent = n.label;
      g.appendChild(t);
    }
    nodeGroup.appendChild(g);
    nodeRefs.set(n.id, { group: g });
  }
  svg.appendChild(nodeGroup);

  return { svg: svg, nodeRefs: nodeRefs, edgeRefs: edgeRefs };
}

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  const norm = _normalizeConfig(config);
  const slotId = _nextSlotId();

  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-process-flow lf-pf-empty" data-pf-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Animation ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  container.innerHTML = _renderShell(slotId, norm);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Animation: ' + (norm.label || 'Prozess-Diagramm'));
  } catch (e) {}

  const stage   = root.querySelector('[data-pf-stage]');
  const textEl  = root.querySelector('[data-pf-text]');
  const counter = root.querySelector('[data-pf-counter]');
  const playIcn = root.querySelector('[data-pf-play-icon]');

  const built = _buildSvg(norm);
  if (stage) stage.appendChild(built.svg);

  const reducedMotion = lfWidgetReducedMotion();
  if (reducedMotion) root.classList.add('lf-pf-reduced-motion');

  const state = {
    currentStep: 0,
    isPlaying: false
  };
  let unmounted = false;
  let paused = false;       // ext. Visibility-Pause (haelt Auto-Play)
  let timerId = 0;
  const PLAY_ICON  = '▶';
  const PAUSE_ICON = '⏸';

  // ── Highlight-Anwendung ─────────────────────────────────
  function applyStep(idx) {
    const step = norm.steps[idx];
    if (!step) return;

    // Alle Highlights zuruecksetzen.
    built.nodeRefs.forEach(ref => ref.group.classList.remove('lf-pf-highlight'));
    built.edgeRefs.forEach(ref => ref.group.classList.remove('lf-pf-highlight'));

    // Aktuellen Schritt anwenden.
    for (const id of step.highlightNodes) {
      const ref = built.nodeRefs.get(id);
      if (ref) ref.group.classList.add('lf-pf-highlight');
    }
    for (const id of step.highlightEdges) {
      const ref = built.edgeRefs.get(id);
      if (ref) ref.group.classList.add('lf-pf-highlight');
    }

    if (textEl)  textEl.textContent = step.text || '';
    if (counter) counter.textContent = (idx + 1) + '/' + norm.steps.length;
  }

  function gotoStep(i) {
    if (unmounted) return;
    state.currentStep = Math.max(0, Math.min(norm.steps.length - 1, i));
    applyStep(state.currentStep);
  }

  // ── Auto-Play ───────────────────────────────────────────
  function startPlay() {
    if (unmounted || reducedMotion) return;
    state.isPlaying = true;
    if (playIcn) playIcn.textContent = PAUSE_ICON;
    scheduleNext();
  }
  function stopPlay() {
    state.isPlaying = false;
    if (timerId) { clearTimeout(timerId); timerId = 0; }
    if (playIcn) playIcn.textContent = PLAY_ICON;
  }
  function scheduleNext() {
    if (timerId) clearTimeout(timerId);
    if (!state.isPlaying || paused || unmounted) return;
    timerId = setTimeout(() => {
      timerId = 0;
      if (!state.isPlaying || paused || unmounted) return;
      if (state.currentStep >= norm.steps.length - 1) {
        // Am Ende angekommen — Stop.
        stopPlay();
        return;
      }
      gotoStep(state.currentStep + 1);
      scheduleNext();
    }, norm.stepDuration);
  }
  function togglePlay() {
    if (state.isPlaying) {
      stopPlay();
    } else {
      // Wenn am Ende: erst zurueck auf 0.
      if (state.currentStep >= norm.steps.length - 1) gotoStep(0);
      startPlay();
    }
  }

  // ── Click-Delegation ────────────────────────────────────
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const btn = t.closest('[data-pf-action]');
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute('data-pf-action');
    if (action === 'next') {
      stopPlay();
      gotoStep(state.currentStep + 1);
    } else if (action === 'prev') {
      stopPlay();
      gotoStep(state.currentStep - 1);
    } else if (action === 'reset') {
      stopPlay();
      gotoStep(0);
    } else if (action === 'play') {
      togglePlay();
    }
  }
  root.addEventListener('click', onClick);

  // Initial-Render: Schritt 0.
  applyStep(0);

  // Auto-Play wenn gewuenscht (und nicht reduced-motion).
  if (norm.autoPlay && !reducedMotion) {
    startPlay();
  }

  return {
    widgetType: 'process-flow-anim',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      stopPlay();
      try { root.removeEventListener('click', onClick); } catch (e) {}
    },

    pause() {
      if (unmounted) return;
      paused = true;
      if (timerId) { clearTimeout(timerId); timerId = 0; }
    },

    resume() {
      if (unmounted) return;
      paused = false;
      if (state.isPlaying) scheduleNext();
    },

    onTheme() { /* no-op — pure CSS-Vars. */ },

    onAnswer() { /* explorativ — kein Bewertungs-Hook. */ },

    getState() {
      return { currentStep: state.currentStep, isPlaying: state.isPlaying };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      stopPlay();
      if (typeof s.currentStep === 'number') gotoStep(s.currentStep);
      if (s.isPlaying === true && !reducedMotion) startPlay();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'process-flow-anim',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'process-flow-anim', mount: mount };
export { mount };
