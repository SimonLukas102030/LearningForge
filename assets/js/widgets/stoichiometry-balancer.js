// ══════════════════════════════════════════
//  LearningForge — Widget: stoichiometry-balancer
//  Welle 2.5 — Reaktions-Ausgleichen mit Atom-Visualisierung
//  (siehe Plan 2026-05-09-interaktiv-ausbau.md, W2.5)
// ══════════════════════════════════════════
//
// Schueler sieht eine unausgeglichene chem. Gleichung (z.B. H2 + O2 -> H2O).
// Vor jedem Reaktanten/Produkt steht ein <input type=number> fuer den Koeff.
// (Default 1, Range 1-9). Atome werden als bunte SVG-Kreise dargestellt
// (links Edukte, Mitte Pfeil, rechts Produkte). Atom-Counter oben zeigt
// pro Element die Summen "H: 4 ↔ 2" und faerbt rot/gruen je nach Balance.
//
// Live: bei Koeff-Aenderung re-rendern Atome + Counter sofort. "Pruefen"
// triggert onAnswer mit { correct, partial }. expectedCoefficients (optional)
// erlaubt Bonus-Validation auf exakte Werte.
//
// Hard-Rule #3: label-string aus Config 1:1 in <h4>; formula-strings (z.B.
// "H2O") werden zu HTML mit Subscript-Tags konvertiert (siehe _formatFormula),
// dabei wird der Element-Symbol-Teil escaped.
//
// Atom-Farben: hardcoded JS-Konstanten (chemische Konvention, theme-unabh.).
// Nur Container-/Counter-/Input-Backgrounds nutzen --lf-sb-*-Vars.
//
// API: mount/unmount, onAnswer (graded), getState/setState, pause/resume
// no-ops, onTheme no-op.

import { lfWidgetReducedMotion } from './_base.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Atom-DB (chemische Konvention, ~CPK-color-scheme angelehnt) ────────
// H ist #ffffff mit dunklem Border (CSS-side via stroke).
const ATOM_COLORS = {
  H:  '#ffffff',
  C:  '#444444',
  N:  '#3066be',
  O:  '#e63946',
  F:  '#9bd84a',
  S:  '#f4d03f',
  P:  '#ff8000',
  Cl: '#7cb342',
  Br: '#a52a2a',
  I:  '#9400d3',
  Na: '#9c27b0',
  K:  '#7e57c2',
  Mg: '#26a69a',
  Ca: '#bdbdbd',
  Fe: '#ff6f00',
  Cu: '#c87533',
  Zn: '#90a4ae',
  Al: '#b0bec5'
};
const ATOM_FALLBACK = '#888888';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-sb-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

function _escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// "H2O" -> "H<sub>2</sub>O", "Fe2O3" -> "Fe<sub>2</sub>O<sub>3</sub>".
// Letters bleiben unangetastet (escaped), Ziffern werden zu <sub>.
function _formatFormula(formula) {
  const s = String(formula == null ? '' : formula);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < s.length && s[j] >= '0' && s[j] <= '9') j += 1;
      out += '<sub>' + _escapeHtml(s.slice(i, j)) + '</sub>';
      i = j;
    } else {
      out += _escapeHtml(ch);
      i += 1;
    }
  }
  return out;
}

// ── Config-Normalisierung ─────────────────────────────────
function _normalizeSide(arr) {
  if (!Array.isArray(arr) || arr.length < 1) return null;
  const out = [];
  for (const m of arr) {
    if (!m || typeof m !== 'object') return null;
    const formula = typeof m.formula === 'string' && m.formula.length > 0 ? m.formula : null;
    if (!formula) return null;
    const atomsRaw = (m.atoms && typeof m.atoms === 'object' && !Array.isArray(m.atoms)) ? m.atoms : null;
    if (!atomsRaw) return null;
    const atoms = {};
    let total = 0;
    for (const k of Object.keys(atomsRaw)) {
      const v = Number(atomsRaw[k]);
      if (!Number.isFinite(v) || v < 0 || !/^[A-Z][a-z]?$/.test(k)) continue;
      const n = Math.floor(v);
      if (n > 0) {
        atoms[k] = n;
        total += n;
      }
    }
    if (total < 1) return null;
    out.push({ formula: formula, atoms: atoms });
  }
  return out;
}

function _normalizeExpected(raw, reactCount, prodCount) {
  if (!raw || typeof raw !== 'object') return null;
  const r = Array.isArray(raw.reactants) ? raw.reactants : null;
  const p = Array.isArray(raw.products) ? raw.products : null;
  if (!r || !p) return null;
  if (r.length !== reactCount || p.length !== prodCount) return null;
  const ri = r.map(v => Math.floor(Number(v)));
  const pi = p.map(v => Math.floor(Number(v)));
  for (const v of ri) if (!Number.isFinite(v) || v < 1 || v > 9) return null;
  for (const v of pi) if (!Number.isFinite(v) || v < 1 || v > 9) return null;
  return { reactants: ri, products: pi };
}

function _normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const reactants = _normalizeSide(raw.reactants);
  const products  = _normalizeSide(raw.products);
  if (!reactants || !products) return null;
  const expected = _normalizeExpected(raw.expectedCoefficients, reactants.length, products.length);
  return {
    label:     typeof raw.label === 'string' ? raw.label : '',
    reactants: reactants,
    products:  products,
    expectedCoefficients: expected
  };
}

// ── Atom-Summen ────────────────────────────────────────────
// Pro Seite: Summe pro Element (sum over molecules of coeff * atoms[el]).
function _atomTotals(side, coeffs) {
  const out = {};
  for (let i = 0; i < side.length; i += 1) {
    const c = Math.max(1, Math.min(9, coeffs[i] | 0 || 1));
    const atoms = side[i].atoms;
    for (const el of Object.keys(atoms)) {
      out[el] = (out[el] || 0) + c * atoms[el];
    }
  }
  return out;
}

// Vereinigte Element-Liste aus beiden Seiten (alphabetisch).
function _allElements(reactants, products) {
  const set = new Set();
  for (const m of reactants) for (const el of Object.keys(m.atoms)) set.add(el);
  for (const m of products)  for (const el of Object.keys(m.atoms)) set.add(el);
  return Array.from(set).sort();
}

// ── SVG-Builder ────────────────────────────────────────────
function _setAttrs(el, attrs) {
  for (const k in attrs) el.setAttribute(k, attrs[k]);
}
function _svg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) _setAttrs(el, attrs);
  return el;
}

// Liefert ein Array { el, count } in stable order (alphabetisch) fuer eine Seite.
function _sideAtomList(side, coeffs) {
  const totals = _atomTotals(side, coeffs);
  const els = Object.keys(totals).sort();
  const out = [];
  for (const el of els) out.push({ el: el, count: totals[el] });
  return out;
}

// Berechne Atom-Positionen in einer Seite (Grid-Layout).
// width = SVG-Bereich-Breite, atomR = Atom-Radius.
function _layoutAtoms(atomList, width, atomR, gap) {
  const positions = [];
  const cellW = atomR * 2 + gap;
  const cols = Math.max(1, Math.floor((width - gap) / cellW));
  let total = 0;
  for (const a of atomList) total += a.count;
  let idx = 0;
  for (const a of atomList) {
    for (let i = 0; i < a.count; i += 1) {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      positions.push({
        el: a.el,
        x: gap + col * cellW + atomR,
        y: gap + row * cellW + atomR
      });
      idx += 1;
    }
  }
  const rows = Math.ceil(total / cols);
  const usedHeight = rows > 0 ? gap + rows * cellW : 0;
  return { positions: positions, rows: rows, usedHeight: usedHeight };
}

// ── Render ─────────────────────────────────────────────────
function _renderShell(slotId, norm) {
  const titleHtml = norm.label ? '<h4 class="lf-sb-title">' + norm.label + '</h4>' : '';

  // Equation-Row: <input> coeff + <span formula> + " + " ... " → " ... " + ".
  let eqHtml = '<div class="lf-sb-equation" data-sb-equation>';
  eqHtml += '<div class="lf-sb-side lf-sb-side-react">';
  for (let i = 0; i < norm.reactants.length; i += 1) {
    const m = norm.reactants[i];
    if (i > 0) eqHtml += '<span class="lf-sb-plus" aria-hidden="true">+</span>';
    eqHtml += '<span class="lf-sb-term">'
           +    '<input type="number" min="1" max="9" step="1" value="1" '
           +      'class="lf-sb-coeff" '
           +      'data-sb-side="react" data-sb-idx="' + i + '" '
           +      'aria-label="Koeffizient ' + (i + 1) + ' Edukt ' + _escapeAttr(m.formula) + '">'
           +    '<span class="lf-sb-formula">' + _formatFormula(m.formula) + '</span>'
           +  '</span>';
  }
  eqHtml += '</div>';
  eqHtml += '<span class="lf-sb-arrow" aria-hidden="true">&#x2192;</span>';
  eqHtml += '<div class="lf-sb-side lf-sb-side-prod">';
  for (let i = 0; i < norm.products.length; i += 1) {
    const m = norm.products[i];
    if (i > 0) eqHtml += '<span class="lf-sb-plus" aria-hidden="true">+</span>';
    eqHtml += '<span class="lf-sb-term">'
           +    '<input type="number" min="1" max="9" step="1" value="1" '
           +      'class="lf-sb-coeff" '
           +      'data-sb-side="prod" data-sb-idx="' + i + '" '
           +      'aria-label="Koeffizient ' + (i + 1) + ' Produkt ' + _escapeAttr(m.formula) + '">'
           +    '<span class="lf-sb-formula">' + _formatFormula(m.formula) + '</span>'
           +  '</span>';
  }
  eqHtml += '</div>';
  eqHtml += '</div>';

  return '<div class="lf-widget-stoich-balancer lf-sb-state-predict" id="' + _escapeAttr(slotId) + '" data-sb-slot="' + _escapeAttr(slotId) + '">'
       +    titleHtml
       +    '<div class="lf-sb-counter-bar" data-sb-counter role="status" aria-live="polite" aria-atomic="true"></div>'
       +    eqHtml
       +    '<div class="lf-sb-stage" data-sb-stage></div>'
       +    '<div class="lf-sb-status" data-sb-status role="status" aria-live="polite"></div>'
       +    '<div class="lf-sb-actions">'
       +      '<button type="button" class="lf-sb-btn lf-sb-check" data-sb-action="check">Pr&uuml;fen</button>'
       +      '<button type="button" class="lf-sb-btn lf-sb-reset" data-sb-action="reset">Zur&uuml;cksetzen</button>'
       +    '</div>'
       + '</div>';
}

// ── mount() ────────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  const norm = _normalizeConfig(config);
  const slotId = _nextSlotId();

  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-stoich-balancer lf-sb-empty" data-sb-slot="' + _escapeAttr(slotId) + '">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  container.innerHTML = _renderShell(slotId, norm);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Reaktion ausgleichen' + (norm.label ? ': ' + norm.label : ''));
  } catch (e) {}

  const stage     = root.querySelector('[data-sb-stage]');
  const counterEl = root.querySelector('[data-sb-counter]');
  const statusEl  = root.querySelector('[data-sb-status]');
  const checkBtn  = root.querySelector('.lf-sb-check');
  const resetBtn  = root.querySelector('.lf-sb-reset');

  const reducedMotion = lfWidgetReducedMotion();
  if (reducedMotion) root.classList.add('lf-sb-reduced-motion');

  // SVG einmal bauen, danach werden nur Atome ge-replaced.
  const SVG_W = 600;
  const SVG_H = 220;
  const SIDE_W = 250;
  const ARROW_X = SVG_W / 2;
  const ATOM_R = 14;
  const GAP = 6;

  const svg = _svg('svg', {
    'class': 'lf-sb-svg',
    'viewBox': '0 0 ' + SVG_W + ' ' + SVG_H,
    'preserveAspectRatio': 'xMidYMid meet',
    'role': 'img',
    'aria-label': 'Atom-Visualisierung'
  });

  // Pfeil in der Mitte.
  const arrowGroup = _svg('g', { 'class': 'lf-sb-arrow-svg' });
  const arrowLine = _svg('path', {
    d: 'M ' + (ARROW_X - 22) + ' ' + (SVG_H / 2) + ' L ' + (ARROW_X + 22) + ' ' + (SVG_H / 2),
    'class': 'lf-sb-arrow-line'
  });
  const arrowHead = _svg('path', {
    d: 'M ' + (ARROW_X + 14) + ' ' + (SVG_H / 2 - 8) + ' L ' + (ARROW_X + 26) + ' ' + (SVG_H / 2) + ' L ' + (ARROW_X + 14) + ' ' + (SVG_H / 2 + 8) + ' Z',
    'class': 'lf-sb-arrow-line'
  });
  arrowGroup.appendChild(arrowLine);
  arrowGroup.appendChild(arrowHead);
  svg.appendChild(arrowGroup);

  // Zwei Gruppen fuer Edukt/Produkt-Atome.
  const reactGroup = _svg('g', { 'class': 'lf-sb-atoms lf-sb-atoms-react', transform: 'translate(0,0)' });
  const prodGroup  = _svg('g', { 'class': 'lf-sb-atoms lf-sb-atoms-prod',  transform: 'translate(' + (ARROW_X + 50) + ',0)' });
  svg.appendChild(reactGroup);
  svg.appendChild(prodGroup);

  if (stage) stage.appendChild(svg);

  // ── State ────────────────────────────────────────────────
  const state = {
    coeffs: {
      react: norm.reactants.map(() => 1),
      prod:  norm.products.map(() => 1)
    },
    status: 'predict' // 'predict' | 'correct' | 'wrong'
  };
  let unmounted = false;
  const answerCbs = [];

  // ── Atom-Counter ─────────────────────────────────────────
  // Ueber dem SVG: pro Element "H: 4 ↔ 2" (rot wenn ungleich, gruen wenn gleich).
  function _renderCounter() {
    if (!counterEl) return;
    const tR = _atomTotals(norm.reactants, state.coeffs.react);
    const tP = _atomTotals(norm.products,  state.coeffs.prod);
    const els = _allElements(norm.reactants, norm.products);
    let allBalanced = els.length > 0;
    let html = '';
    for (const el of els) {
      const left = tR[el] || 0;
      const right = tP[el] || 0;
      const balanced = left === right;
      if (!balanced) allBalanced = false;
      const cls = balanced ? 'lf-sb-cnt-ok' : 'lf-sb-cnt-bad';
      const dot = '<span class="lf-sb-cnt-dot" style="background:' + _escapeAttr(ATOM_COLORS[el] || ATOM_FALLBACK) + '" aria-hidden="true"></span>';
      html += '<span class="lf-sb-cnt ' + cls + '">'
            + dot
            + '<span class="lf-sb-cnt-el">' + _escapeHtml(el) + '</span>'
            + '<span class="lf-sb-cnt-val">' + left + '</span>'
            + '<span class="lf-sb-cnt-eq" aria-hidden="true">&#x2194;</span>'
            + '<span class="lf-sb-cnt-val">' + right + '</span>'
            + '</span>';
    }
    counterEl.innerHTML = html;
    counterEl.classList.toggle('lf-sb-counter-balanced', allBalanced);
    return allBalanced;
  }

  // ── Atom-Render in SVG ───────────────────────────────────
  function _renderAtomsSide(group, side, coeffs, sideWidth) {
    // Alte Atome weg.
    while (group.firstChild) group.removeChild(group.firstChild);
    const atomList = _sideAtomList(side, coeffs);
    const layout = _layoutAtoms(atomList, sideWidth, ATOM_R, GAP);
    // Vertikale Zentrierung.
    const yOff = Math.max(0, (SVG_H - layout.usedHeight) / 2);
    for (const p of layout.positions) {
      const fill = ATOM_COLORS[p.el] || ATOM_FALLBACK;
      const g = _svg('g', { 'class': 'lf-sb-atom', transform: 'translate(' + p.x + ',' + (p.y + yOff) + ')' });
      const circle = _svg('circle', {
        cx: 0, cy: 0, r: ATOM_R,
        'class': 'lf-sb-atom-circle',
        fill: fill
      });
      g.appendChild(circle);
      const txt = _svg('text', {
        x: 0, y: 4,
        'class': 'lf-sb-atom-label',
        'text-anchor': 'middle'
      });
      // Element-Symbol — H bekommt dunklen Text (weisser Kreis), Rest weiss.
      txt.textContent = p.el;
      txt.setAttribute('fill', p.el === 'H' ? '#222' : '#ffffff');
      g.appendChild(txt);
      group.appendChild(g);
    }
  }

  function _refresh() {
    if (unmounted) return;
    _renderCounter();
    _renderAtomsSide(reactGroup, norm.reactants, state.coeffs.react, SIDE_W);
    _renderAtomsSide(prodGroup,  norm.products,  state.coeffs.prod,  SIDE_W);
  }

  // ── Coeff-Input-Handler ──────────────────────────────────
  function _onInput(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains('lf-sb-coeff')) return;
    const side = t.getAttribute('data-sb-side');
    const idx = parseInt(t.getAttribute('data-sb-idx'), 10);
    if ((side !== 'react' && side !== 'prod') || !Number.isFinite(idx)) return;
    let v = parseInt(t.value, 10);
    if (!Number.isFinite(v) || v < 1) v = 1;
    if (v > 9) v = 9;
    // Den Input-Wert nicht ueberschreiben waehrend User tippt — nur clampen
    // beim blur. Aber fuer die Berechnung clampen wir.
    if (side === 'react') state.coeffs.react[idx] = v;
    else state.coeffs.prod[idx] = v;
    // Wenn User etwas aendert nach einem Pruef-Resultat: zurueck auf predict.
    if (state.status !== 'predict') {
      state.status = 'predict';
      _setStateClasses();
      if (statusEl) statusEl.textContent = '';
      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.textContent = 'Pr\xfcfen';
      }
    }
    _refresh();
  }

  // Bei blur: Input-Wert auf clamp-Wert ziehen, falls nicht parsable.
  function _onBlur(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains('lf-sb-coeff')) return;
    const side = t.getAttribute('data-sb-side');
    const idx = parseInt(t.getAttribute('data-sb-idx'), 10);
    if ((side !== 'react' && side !== 'prod') || !Number.isFinite(idx)) return;
    const v = (side === 'react') ? state.coeffs.react[idx] : state.coeffs.prod[idx];
    t.value = String(v);
  }

  function _setStateClasses() {
    root.classList.toggle('lf-sb-state-predict', state.status === 'predict');
    root.classList.toggle('lf-sb-state-correct', state.status === 'correct');
    root.classList.toggle('lf-sb-state-wrong',   state.status === 'wrong');
  }

  // ── Pruefen ──────────────────────────────────────────────
  function _check() {
    if (unmounted) return;
    if (state.status === 'correct') return;
    const tR = _atomTotals(norm.reactants, state.coeffs.react);
    const tP = _atomTotals(norm.products,  state.coeffs.prod);
    const els = _allElements(norm.reactants, norm.products);
    let balanced = els.length > 0;
    for (const el of els) {
      if ((tR[el] || 0) !== (tP[el] || 0)) { balanced = false; break; }
    }

    let exact = false;
    if (balanced && norm.expectedCoefficients) {
      exact = true;
      const er = norm.expectedCoefficients.reactants;
      const ep = norm.expectedCoefficients.products;
      for (let i = 0; i < er.length; i += 1) {
        if (state.coeffs.react[i] !== er[i]) { exact = false; break; }
      }
      if (exact) {
        for (let i = 0; i < ep.length; i += 1) {
          if (state.coeffs.prod[i] !== ep[i]) { exact = false; break; }
        }
      }
    }

    // Akzeptanz: balanced reicht (atom-conservation). exact = bonus.
    const correct = balanced;

    if (correct) {
      state.status = 'correct';
      if (statusEl) {
        statusEl.textContent = exact || !norm.expectedCoefficients
          ? 'Richtig! Reaktion ausgeglichen.'
          : 'Ausgeglichen — k\xf6nnte aber noch k\xfcrzer gehen.';
      }
      if (checkBtn) {
        checkBtn.disabled = true;
        checkBtn.textContent = 'Erledigt ✓';
      }
    } else {
      state.status = 'wrong';
      if (statusEl) statusEl.textContent = 'Noch nicht alle Atome ausgeglichen.';
      if (checkBtn) checkBtn.textContent = 'Pr\xfcfen';
    }
    _setStateClasses();

    // onAnswer-Hook (Phase-2 XP-Boundary).
    answerCbs.forEach(cb => {
      try {
        cb({
          correct: correct,
          partial: correct ? 1 : 0,
          raw: {
            balanced: balanced,
            exact: exact,
            coefficients: {
              reactants: state.coeffs.react.slice(),
              products:  state.coeffs.prod.slice()
            }
          }
        });
      } catch (e) { console.warn('[stoich-balancer onAnswer]', e); }
    });
  }

  function _reset() {
    if (unmounted) return;
    for (let i = 0; i < state.coeffs.react.length; i += 1) state.coeffs.react[i] = 1;
    for (let i = 0; i < state.coeffs.prod.length;  i += 1) state.coeffs.prod[i]  = 1;
    state.status = 'predict';
    _setStateClasses();
    if (statusEl) statusEl.textContent = '';
    if (checkBtn) {
      checkBtn.disabled = false;
      checkBtn.textContent = 'Pr\xfcfen';
    }
    // Inputs zuruecksetzen.
    const inputs = root.querySelectorAll('input.lf-sb-coeff');
    inputs.forEach(inp => { inp.value = '1'; });
    _refresh();
  }

  function _onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const btn = t.closest('[data-sb-action]');
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute('data-sb-action');
    if (action === 'check') _check();
    else if (action === 'reset') _reset();
  }

  function _onKeydown(ev) {
    if (unmounted) return;
    if (ev.key !== 'Enter') return;
    const t = ev.target;
    if (!t || !t.classList || !t.classList.contains('lf-sb-coeff')) return;
    if (!root.contains(t)) return;
    ev.preventDefault();
    _check();
  }

  root.addEventListener('input', _onInput);
  root.addEventListener('change', _onInput);
  root.addEventListener('blur', _onBlur, true); // capture, weil blur nicht bubbelt
  root.addEventListener('click', _onClick);
  root.addEventListener('keydown', _onKeydown);

  // Initial-Render.
  _refresh();

  return {
    widgetType: 'stoichiometry-balancer',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      try { root.removeEventListener('input', _onInput); } catch (e) {}
      try { root.removeEventListener('change', _onInput); } catch (e) {}
      try { root.removeEventListener('blur', _onBlur, true); } catch (e) {}
      try { root.removeEventListener('click', _onClick); } catch (e) {}
      try { root.removeEventListener('keydown', _onKeydown); } catch (e) {}
      answerCbs.length = 0;
    },

    pause() { /* no-op */ },
    resume() { /* no-op */ },
    onTheme() { /* no-op — pure CSS-Vars + hardcoded chemistry-colors. */ },

    onAnswer(cb) {
      if (typeof cb === 'function') answerCbs.push(cb);
    },

    getState() {
      return {
        currentCoefficients: {
          reactants: state.coeffs.react.slice(),
          products:  state.coeffs.prod.slice()
        },
        status: state.status
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      const cc = s.currentCoefficients;
      if (cc && typeof cc === 'object') {
        if (Array.isArray(cc.reactants) && cc.reactants.length === state.coeffs.react.length) {
          for (let i = 0; i < cc.reactants.length; i += 1) {
            let v = parseInt(cc.reactants[i], 10);
            if (!Number.isFinite(v) || v < 1) v = 1;
            if (v > 9) v = 9;
            state.coeffs.react[i] = v;
          }
        }
        if (Array.isArray(cc.products) && cc.products.length === state.coeffs.prod.length) {
          for (let i = 0; i < cc.products.length; i += 1) {
            let v = parseInt(cc.products[i], 10);
            if (!Number.isFinite(v) || v < 1) v = 1;
            if (v > 9) v = 9;
            state.coeffs.prod[i] = v;
          }
        }
      }
      if (s.status === 'predict' || s.status === 'wrong' || s.status === 'correct') {
        state.status = s.status;
      }
      // Inputs sync.
      const inputs = root.querySelectorAll('input.lf-sb-coeff');
      inputs.forEach(inp => {
        const side = inp.getAttribute('data-sb-side');
        const idx = parseInt(inp.getAttribute('data-sb-idx'), 10);
        if (!Number.isFinite(idx)) return;
        const v = (side === 'react') ? state.coeffs.react[idx] : state.coeffs.prod[idx];
        if (Number.isFinite(v)) inp.value = String(v);
      });
      _setStateClasses();
      if (statusEl) {
        if (state.status === 'correct') statusEl.textContent = 'Richtig! Reaktion ausgeglichen.';
        else if (state.status === 'wrong') statusEl.textContent = 'Noch nicht alle Atome ausgeglichen.';
        else statusEl.textContent = '';
      }
      if (checkBtn) {
        if (state.status === 'correct') {
          checkBtn.disabled = true;
          checkBtn.textContent = 'Erledigt ✓';
        } else {
          checkBtn.disabled = false;
          checkBtn.textContent = 'Pr\xfcfen';
        }
      }
      _refresh();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'stoichiometry-balancer',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'stoichiometry-balancer', mount: mount };
export { mount };
