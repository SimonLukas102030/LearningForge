// ══════════════════════════════════════════
//  LearningForge — Widget: prob-tree-builder
//  Welle 3.5 — Wahrscheinlichkeitsbaum mit Pfad-Validierung
// ══════════════════════════════════════════
//
// Vorgefertigter 2- bis 3-stufiger Wahrscheinlichkeitsbaum. User tippt pro
// Zweig P (akzeptiert "0.5", "1/2", "50%", "0,5"). Widget berechnet pro Endpfad
// das Produkt der P, prueft pro Stufe ob Σ = 1.0 (innerhalb tolerance) und
// vergleicht jedes Input mit branch.expectedP.
//
// Layout: SVG-Linien zwischen DOM-Knoten in Spalten (Wurzel | Stufe1 | Stufe2).
// Hard-Rule #3: label-Strings sind raw (entity-encoded vom Author) und gehen
// 1:1 ins innerHTML. data-Attribute via _ea (escapeAttr).
//
// onAnswer: { correct, partial, raw: { stageSums, leafProbs, allStagesValid,
//             correctCount, total } }

import { lfWidgetReducedMotion } from './_base.js';

let _SEQ = 0;
const _slot = () => 'lf-tr-' + Date.now().toString(36) + '-' + (++_SEQ);

const _ea = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

// "0.5" | "0,5" | "1/2" | "50%" -> Number; null bei leer/unparsable.
function _parseProb(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (s.endsWith('%')) {
    const n = parseFloat(s.slice(0, -1).replace(',', '.'));
    return Number.isFinite(n) ? n / 100 : null;
  }
  const m = s.match(/^(-?\d+(?:[.,]\d+)?)\s*\/\s*(-?\d+(?:[.,]\d+)?)$/);
  if (m) {
    const a = parseFloat(m[1].replace(',', '.'));
    const b = parseFloat(m[2].replace(',', '.'));
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
    return a / b;
  }
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// Tree { label, branches: [{label, expectedP, branches?}] } -> flache Liste.
function _collect(tree) {
  const out = [];
  (function walk(node, parentPath, depth) {
    if (!node || !Array.isArray(node.branches)) return;
    node.branches.forEach((b, i) => {
      const path = parentPath.concat([i]);
      out.push({
        id: path.join('-'),
        path: path,
        depth: depth + 1,
        parentPath: parentPath.join('-'),
        label: typeof b.label === 'string' ? b.label : '',
        expectedP: Number(b.expectedP)
      });
      if (Array.isArray(b.branches) && b.branches.length) walk(b, path, depth + 1);
    });
  })(tree, [], 0);
  return out;
}

function _normalize(c) {
  if (!c || typeof c !== 'object') return null;
  const tree = c.tree;
  if (!tree || typeof tree !== 'object' || !Array.isArray(tree.branches) || tree.branches.length < 2) return null;
  const branches = _collect(tree);
  if (branches.length < 2) return null;
  let maxDepth = 0;
  for (const b of branches) {
    if (!b.label || !Number.isFinite(b.expectedP)) return null;
    if (b.expectedP < 0 || b.expectedP > 1) return null;
    if (b.depth > maxDepth) maxDepth = b.depth;
  }
  if (maxDepth < 1 || maxDepth > 3) return null;
  return {
    setup:     typeof c.setup === 'string'    ? c.setup    : '',
    label:     typeof c.label === 'string'    ? c.label    : '',
    question:  typeof c.question === 'string' ? c.question : '',
    reveal:    typeof c.reveal === 'string'   ? c.reveal   : '',
    rootLabel: typeof tree.label === 'string' ? tree.label : 'Start',
    branches:  branches,
    maxDepth:  maxDepth,
    tolerance: (typeof c.tolerance === 'number' && c.tolerance >= 0) ? c.tolerance : 0.01
  };
}

function _siblings(branches) {
  const m = new Map();
  for (const b of branches) {
    if (!m.has(b.parentPath)) m.set(b.parentPath, []);
    m.get(b.parentPath).push(b);
  }
  return m;
}

function _leaves(branches, maxDepth) {
  return branches.filter(b => b.depth === maxDepth);
}

function _chain(leaf, branches) {
  const out = [leaf];
  let p = leaf.path;
  while (p.length > 1) {
    p = p.slice(0, -1);
    const id = p.join('-');
    const a = branches.find(b => b.id === id);
    if (!a) break;
    out.unshift(a);
  }
  return out;
}

// Knoten-Positionen im Canvas (% von Box). Spalten = Tiefe, Reihen gleichverteilt.
function _layout(norm) {
  const byD = new Map();
  byD.set(0, [{ id: 'root', depth: 0 }]);
  for (const b of norm.branches) {
    if (!byD.has(b.depth)) byD.set(b.depth, []);
    byD.get(b.depth).push(b);
  }
  const cols = norm.maxDepth + 1;
  const map = new Map();
  for (let d = 0; d < cols; d++) {
    const arr = byD.get(d) || [];
    const x = cols === 1 ? 50 : (d / (cols - 1)) * 100;
    arr.forEach((node, i) => {
      const y = arr.length === 1 ? 50 : ((i + 0.5) / arr.length) * 100;
      map.set(node.id, { x: x, y: y });
    });
  }
  return map;
}

function _renderHtml(norm, slotId) {
  const layout = _layout(norm);
  const leafSet = new Set(_leaves(norm.branches, norm.maxDepth).map(b => b.id));

  let nodes = '';
  const rp = layout.get('root');
  nodes += `<div class="lf-tr-node lf-tr-node-root" style="left:${rp.x.toFixed(2)}%;top:${rp.y.toFixed(2)}%;"><span class="lf-tr-node-label">${norm.rootLabel}</span></div>`;
  for (const b of norm.branches) {
    const p = layout.get(b.id); if (!p) continue;
    const isLeaf = leafSet.has(b.id);
    const cls = 'lf-tr-node lf-tr-node-d' + b.depth + (isLeaf ? ' lf-tr-node-leaf' : '');
    let inner;
    if (isLeaf) {
      const chain = _chain(b, norm.branches);
      const pathLabel = chain.map(c => c.label).join(', ');
      inner = `<span class="lf-tr-leaf-path">P(${pathLabel})</span><span class="lf-tr-leaf-prob" data-tr-leaf-prob="${_ea(b.id)}">&mdash;</span>`;
    } else {
      inner = '<span class="lf-tr-node-dot" aria-hidden="true"></span>';
    }
    nodes += `<div class="${cls}" style="left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%;">${inner}</div>`;
  }

  let lines = '<svg class="lf-tr-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">';
  let inputs = '';
  for (const b of norm.branches) {
    const to = layout.get(b.id);
    const from = b.parentPath === '' ? layout.get('root') : layout.get(b.parentPath);
    if (!from || !to) continue;
    lines += `<line class="lf-tr-line" x1="${from.x.toFixed(2)}" y1="${from.y.toFixed(2)}" x2="${to.x.toFixed(2)}" y2="${to.y.toFixed(2)}" vector-effect="non-scaling-stroke" />`;
    const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    const inpId = `${slotId}-inp-${_ea(b.id)}`;
    inputs += `<div class="lf-tr-branch-input" style="left:${mx.toFixed(2)}%;top:${my.toFixed(2)}%;">`
           +   `<label class="lf-tr-branch-label" for="${inpId}">${b.label}</label>`
           +   `<input type="text" inputmode="decimal" class="lf-tr-prob-input" id="${inpId}" data-tr-branch-id="${_ea(b.id)}" aria-label="Wahrscheinlichkeit f\xfcr Zweig ${_ea(b.label)}" placeholder="z.B. 0.5" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">`
           + `</div>`;
  }
  lines += '</svg>';

  let stages = '<div class="lf-tr-stages">';
  let sIdx = 0;
  for (const [parentKey, sibs] of _siblings(norm.branches)) {
    sIdx++;
    const lbl = parentKey === ''
      ? 'Stufe 1 (von Start)'
      : `Stufe ${sibs[0].depth} (von ${(norm.branches.find(b => b.id === parentKey) || {}).label})`;
    stages += `<div class="lf-tr-stage" data-tr-stage-key="${_ea(parentKey)}">`
           +   `<span class="lf-tr-stage-label">${lbl}</span>`
           +   `<span class="lf-tr-stage-sum" data-tr-stage-sum="${_ea(parentKey)}">&Sigma; = &mdash;</span>`
           + `</div>`;
  }
  stages += '</div>';

  const setupH = norm.setup ? `<div class="lf-tr-setup">${norm.setup}</div>` : '';
  const labelH = norm.label ? `<h4 class="lf-tr-heading">${norm.label}</h4>` : '';
  const qH = norm.question ? `<div class="lf-tr-question">${norm.question}</div>` : '';
  const revealH = norm.reveal
    ? `<div class="lf-tr-reveal" id="${_ea(slotId)}-reveal" hidden><div class="lf-tr-reveal-heading">Erkl&auml;rung</div><div class="lf-tr-reveal-body">${norm.reveal}</div></div>`
    : '';

  return `<div class="lf-widget-prob-tree lf-tr-state-predict" id="${_ea(slotId)}" data-tr-slot="${_ea(slotId)}">`
       +   labelH + setupH + qH
       +   `<div class="lf-tr-canvas" data-tr-canvas>${lines}${nodes}${inputs}</div>`
       +   stages
       +   `<div class="lf-tr-status" id="${_ea(slotId)}-status" role="status" aria-live="polite"></div>`
       +   `<div class="lf-tr-actions"><button type="button" class="lf-tr-check" data-tr-action="check">Auswerten</button><button type="button" class="lf-tr-reset" data-tr-action="reset">Zur&uuml;cksetzen</button></div>`
       +   revealH
       + `</div>`;
}

// ─── mount() ──────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _empty();
  const norm = _normalize(config);
  const slotId = _slot();

  if (!norm) {
    container.innerHTML = `<div class="lf-widget-prob-tree lf-tr-empty" data-tr-slot="${_ea(slotId)}">Diese Aufgabe ist noch nicht fertig konfiguriert.</div>`;
    return _empty();
  }

  const state = { config: norm, values: new Map(), status: 'predict' };
  let unmounted = false;
  const cbs = [];

  container.innerHTML = _renderHtml(norm, slotId);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try { container.setAttribute('aria-label', 'Interaktive Aufgabe: Wahrscheinlichkeitsbaum ausf\xfcllen'); } catch (e) {}

  // ── Compute ──
  function stageSums() {
    const out = new Map();
    for (const [key, sibs] of _siblings(norm.branches)) {
      let sum = 0, all = true;
      for (const b of sibs) {
        const p = _parseProb(state.values.get(b.id));
        if (p == null) { all = false; break; }
        sum += p;
      }
      out.set(key, { sum: all ? sum : null, valid: all && Math.abs(sum - 1) <= norm.tolerance });
    }
    return out;
  }
  function leafProbs() {
    const out = new Map();
    for (const leaf of _leaves(norm.branches, norm.maxDepth)) {
      let prod = 1, ok = true;
      for (const c of _chain(leaf, norm.branches)) {
        const p = _parseProb(state.values.get(c.id));
        if (p == null) { ok = false; break; }
        prod *= p;
      }
      out.set(leaf.id, ok ? prod : null);
    }
    return out;
  }
  const trim0 = n => n.toFixed(4).replace(/\.?0+$/, '');

  function refresh() {
    if (unmounted || !root) return;
    if (state.status === 'predict') {
      root.querySelectorAll('input.lf-tr-prob-input').forEach(inp => {
        inp.classList.remove('lf-tr-input-correct', 'lf-tr-input-wrong');
        inp.removeAttribute('aria-invalid');
      });
    }
    for (const [key, info] of stageSums()) {
      const el = root.querySelector(`[data-tr-stage-sum="${CSS.escape(key)}"]`);
      const wrap = root.querySelector(`[data-tr-stage-key="${CSS.escape(key)}"]`);
      if (!el) continue;
      if (info.sum == null) {
        el.innerHTML = '&Sigma; = &mdash;';
        if (wrap) wrap.classList.remove('lf-tr-stage-ok', 'lf-tr-stage-bad');
      } else {
        el.innerHTML = `&Sigma; = ${info.sum.toFixed(3).replace(/\.?0+$/, '')}${info.valid ? ' ✓' : ' (soll 1)'}`;
        if (wrap) {
          wrap.classList.toggle('lf-tr-stage-ok', !!info.valid);
          wrap.classList.toggle('lf-tr-stage-bad', !info.valid);
        }
      }
    }
    for (const [bid, p] of leafProbs()) {
      const el = root.querySelector(`[data-tr-leaf-prob="${CSS.escape(bid)}"]`);
      if (!el) continue;
      if (p == null) el.innerHTML = '&mdash;';
      else el.textContent = '= ' + trim0(p);
    }
    root.classList.toggle('lf-tr-state-predict', state.status === 'predict');
    root.classList.toggle('lf-tr-state-checked', state.status === 'checked');
    const rev = root.querySelector('#' + CSS.escape(slotId) + '-reveal');
    if (rev) rev.hidden = !(state.status === 'checked' && norm.reveal);
  }

  function check() {
    if (unmounted) return;
    const inputs = root.querySelectorAll('input.lf-tr-prob-input');
    inputs.forEach(inp => {
      const bid = inp.getAttribute('data-tr-branch-id');
      if (bid) state.values.set(bid, inp.value);
    });
    let correct = 0;
    inputs.forEach(inp => {
      const bid = inp.getAttribute('data-tr-branch-id');
      const branch = norm.branches.find(b => b.id === bid);
      if (!branch) return;
      const p = _parseProb(inp.value);
      const ok = p != null && Math.abs(p - branch.expectedP) <= norm.tolerance;
      inp.classList.remove(ok ? 'lf-tr-input-wrong' : 'lf-tr-input-correct');
      inp.classList.add(ok ? 'lf-tr-input-correct' : 'lf-tr-input-wrong');
      inp.setAttribute('aria-invalid', ok ? 'false' : 'true');
      if (ok) correct++;
    });
    state.status = 'checked';
    refresh();

    const sums = stageSums();
    let allValid = true;
    for (const [, info] of sums) if (!info.valid) { allValid = false; break; }
    const total = norm.branches.length;
    const allCorrect = correct === total && allValid;

    const sEl = root.querySelector('#' + CSS.escape(slotId) + '-status');
    if (sEl) sEl.textContent = allCorrect
      ? 'Perfekt — alle Wahrscheinlichkeiten richtig und Stufen-Summen = 1.'
      : `${correct} von ${total} Zweige korrekt${allValid ? '.' : ' — mindestens eine Stufen-Summe ist nicht 1.'}`;

    const sumObj = {}, leafObj = {};
    for (const [k, v] of sums) sumObj[k] = v.sum;
    for (const [k, v] of leafProbs()) leafObj[k] = v;

    cbs.forEach(cb => {
      try {
        cb({
          correct: allCorrect,
          partial: total > 0 ? correct / total : 0,
          raw: { stageSums: sumObj, leafProbs: leafObj, allStagesValid: allValid, correctCount: correct, total: total }
        });
      } catch (e) { console.warn('[prob-tree-builder onAnswer]', e); }
    });
  }

  function reset() {
    if (unmounted) return;
    state.values.clear();
    state.status = 'predict';
    root.querySelectorAll('input.lf-tr-prob-input').forEach(inp => {
      inp.value = '';
      inp.classList.remove('lf-tr-input-correct', 'lf-tr-input-wrong');
      inp.removeAttribute('aria-invalid');
    });
    const sEl = root.querySelector('#' + CSS.escape(slotId) + '-status');
    if (sEl) sEl.textContent = '';
    refresh();
  }

  function onClick(ev) {
    if (unmounted) return;
    const el = ev.target && ev.target.closest && ev.target.closest('[data-tr-action]');
    if (!el || !root.contains(el)) return;
    const a = el.getAttribute('data-tr-action');
    if (a === 'check') check();
    else if (a === 'reset') reset();
  }
  function onInput(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains('lf-tr-prob-input')) return;
    if (state.status === 'checked') {
      state.status = 'predict';
      root.querySelectorAll('input.lf-tr-prob-input').forEach(inp => {
        inp.classList.remove('lf-tr-input-correct', 'lf-tr-input-wrong');
        inp.removeAttribute('aria-invalid');
      });
    }
    const bid = t.getAttribute('data-tr-branch-id');
    if (bid) state.values.set(bid, t.value);
    refresh();
  }
  function onKey(ev) {
    if (unmounted || ev.key !== 'Enter') return;
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains('lf-tr-prob-input')) return;
    if (!root.contains(t)) return;
    ev.preventDefault();
    check();
  }

  if (root) {
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('keydown', onKey);
  }

  // touch reduce-motion to suppress unused-import lint (no animations to skip).
  void lfWidgetReducedMotion;

  return {
    widgetType: 'prob-tree-builder',
    unmount() {
      if (unmounted) return;
      unmounted = true;
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
        try { root.removeEventListener('input', onInput); } catch (e) {}
        try { root.removeEventListener('keydown', onKey); } catch (e) {}
      }
      cbs.length = 0;
    },
    onAnswer(cb) { if (typeof cb === 'function') cbs.push(cb); },
    getState() {
      const v = {};
      for (const [k, val] of state.values) v[k] = val;
      return { values: v, status: state.status };
    },
    setState(s) {
      if (!s || typeof s !== 'object' || !root) return;
      state.values.clear();
      if (s.values && typeof s.values === 'object') {
        for (const k of Object.keys(s.values)) {
          if (typeof s.values[k] === 'string') state.values.set(k, s.values[k]);
        }
      }
      if (s.status === 'predict' || s.status === 'checked') state.status = s.status;
      root.querySelectorAll('input.lf-tr-prob-input').forEach(inp => {
        const bid = inp.getAttribute('data-tr-branch-id');
        if (!bid) return;
        const v = state.values.get(bid);
        inp.value = typeof v === 'string' ? v : '';
        inp.classList.remove('lf-tr-input-correct', 'lf-tr-input-wrong');
        inp.removeAttribute('aria-invalid');
      });
      refresh();
    }
  };
}

function _empty() {
  return {
    widgetType: 'prob-tree-builder',
    unmount() {}, onAnswer() {}, getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'prob-tree-builder', mount: mount };
export { mount };
