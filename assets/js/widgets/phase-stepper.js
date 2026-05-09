// ══════════════════════════════════════════
//  LearningForge — Widget: phase-stepper
//  Welle 2.2 — Phasen-Slider (Mitose, Reaktions-Mechanismus, Stadt-Entwicklung)
//  (siehe Plan 2026-05-09-interaktiv-ausbau.md, W2.2)
// ══════════════════════════════════════════
//
// Sequenz-Stepper: Schueler klickt durch Phasen einer Sequenz (z.B. Mitose
// 5 Phasen, Saeure-Base-Mechanismus, Stadt-Entwicklung).
// Pro Phase:
//   - Visual oben (Emoji / Inline-SVG / Bild-URL — Auto-Detect via Praefix)
//   - Phase-Name als Headline
//   - Erklaer-Text drunter
//   - Phase-Counter "i/n"
// Steuerung: Prev / Play-Pause / Next + klickbare Pill-Bar fuer Direkt-Sprung.
//
// Visual-Detection:
//   - startsWith '<svg' (case-insensitive)         → Inline-SVG (innerHTML, raw)
//   - startsWith '/' or 'http://' or 'https://'   → <img> (src)
//   - sonst                                        → Text/Emoji (escapeHtml)
//
// Hard-Rule #3: visual/name/text aus Config sind entity-encoded vom Müller —
// gehen 1:1 ins innerHTML (analog process-flow-anim, predict-reveal).
// Bild-URLs und Emoji-Strings escapen wir trotzdem (URL kann Sonderzeichen
// haben, Emoji ist sicher → escapeHtml ist no-op).
// Reduce-Motion: Auto-Play deaktiviert, Phase-Wechsel ohne CSS-Fade (instant).

import { lfWidgetReducedMotion } from './_base.js';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-ps-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
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

// ── Config-Normalisierung ─────────────────────────────────
function _normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const phases = Array.isArray(raw.phases) ? raw.phases : [];
  if (phases.length < 1) return null;

  const normPhases = [];
  for (const p of phases) {
    if (!p || typeof p !== 'object') continue;
    normPhases.push({
      name:   typeof p.name   === 'string' ? p.name   : '',
      visual: typeof p.visual === 'string' ? p.visual : '',
      text:   typeof p.text   === 'string' ? p.text   : ''
    });
  }
  if (normPhases.length < 1) return null;

  let dur = Number(raw.stepDuration);
  if (!Number.isFinite(dur) || dur < 400) dur = 3000;

  return {
    label: typeof raw.label === 'string' ? raw.label : '',
    phases: normPhases,
    autoPlay: raw.autoPlay === true,
    stepDuration: dur
  };
}

// Visual-Renderer: erkennt SVG / Image / Text-Emoji.
function _renderVisual(visual) {
  const s = String(visual == null ? '' : visual).trim();
  if (!s) return '<span class="lf-ps-visual-emoji" aria-hidden="true">&#x2728;</span>';
  // Case-insensitive '<svg'.
  if (s.length >= 4 && s.slice(0, 4).toLowerCase() === '<svg') {
    // Inline-SVG: raw 1:1. Müller liefert valides SVG.
    return '<div class="lf-ps-visual-svg" aria-hidden="true">' + s + '</div>';
  }
  if (s.charAt(0) === '/' || s.indexOf('http://') === 0 || s.indexOf('https://') === 0) {
    return '<img class="lf-ps-visual-img" src="' + _escapeAttr(s) + '" alt="" />';
  }
  // Text/Emoji.
  return '<span class="lf-ps-visual-emoji" aria-hidden="true">' + _escapeHtml(s) + '</span>';
}

function _renderShell(slotId, norm) {
  const titleHtml = norm.label
    ? '<h4 class="lf-ps-title">' + norm.label + '</h4>'
    : '';

  // Pills: pro Phase ein <button>. aria-pressed wird in applyPhase gesetzt.
  const pillsHtml = norm.phases.map((p, i) =>
    '<button type="button" class="lf-ps-pill" '
    + 'data-ps-action="goto" data-ps-index="' + i + '" '
    + 'aria-pressed="' + (i === 0 ? 'true' : 'false') + '">'
    + _escapeHtml(p.name || (i + 1))
    + '</button>'
  ).join('');

  return '<div class="lf-widget-phase-stepper" id="' + _escapeAttr(slotId) + '" '
       +   'data-ps-slot="' + _escapeAttr(slotId) + '">'
       +   titleHtml
       +   '<div class="lf-ps-pills" role="tablist">' + pillsHtml + '</div>'
       +   '<div class="lf-ps-stage">'
       +     '<div class="lf-ps-visual" data-ps-visual></div>'
       +     '<h5 class="lf-ps-phase-name" data-ps-name></h5>'
       +     '<div class="lf-ps-text" data-ps-text role="status" aria-live="polite" aria-atomic="true"></div>'
       +   '</div>'
       +   '<div class="lf-ps-controls">'
       +     '<button type="button" class="lf-ps-btn" data-ps-action="prev" aria-label="Phase zur&uuml;ck">&#x23EE;</button>'
       +     '<button type="button" class="lf-ps-btn lf-ps-btn-primary" data-ps-action="play" aria-label="Auto-Play"><span data-ps-play-icon>&#x25B6;</span></button>'
       +     '<button type="button" class="lf-ps-btn" data-ps-action="next" aria-label="Phase vor">&#x23ED;</button>'
       +     '<span class="lf-ps-counter" data-ps-counter>1/' + norm.phases.length + '</span>'
       +   '</div>'
       + '</div>';
}

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  const norm = _normalizeConfig(config);
  const slotId = _nextSlotId();

  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-phase-stepper lf-ps-empty" data-ps-slot="' + _escapeAttr(slotId) + '">'
      + 'Dieser Phasen-Slider ist noch nicht fertig konfiguriert.</div>';
    return _emptyInstance();
  }

  container.innerHTML = _renderShell(slotId, norm);
  const root = container.querySelector('#' + CSS.escape(slotId));
  try {
    container.setAttribute('aria-label', 'Phasen-Slider: ' + (norm.label || 'Sequenz'));
  } catch (e) {}

  const visualEl = root.querySelector('[data-ps-visual]');
  const nameEl   = root.querySelector('[data-ps-name]');
  const textEl   = root.querySelector('[data-ps-text]');
  const counter  = root.querySelector('[data-ps-counter]');
  const playIcn  = root.querySelector('[data-ps-play-icon]');
  const pills    = Array.from(root.querySelectorAll('.lf-ps-pill'));

  const reducedMotion = lfWidgetReducedMotion();
  if (reducedMotion) root.classList.add('lf-ps-reduced-motion');

  const state = {
    currentPhase: 0,
    isPlaying: false
  };
  let unmounted = false;
  let paused = false;
  let timerId = 0;
  const PLAY_ICON  = '▶';
  const PAUSE_ICON = '⏸';

  // ── Phase anwenden ──────────────────────────────────────
  function applyPhase(idx) {
    const p = norm.phases[idx];
    if (!p) return;
    if (visualEl) visualEl.innerHTML = _renderVisual(p.visual);
    if (nameEl)   nameEl.textContent = p.name || '';
    if (textEl)   textEl.textContent = p.text || '';
    if (counter)  counter.textContent = (idx + 1) + '/' + norm.phases.length;
    pills.forEach((pill, i) => {
      const active = (i === idx);
      pill.setAttribute('aria-pressed', active ? 'true' : 'false');
      pill.classList.toggle('lf-ps-pill-active', active);
    });
  }

  function gotoPhase(i) {
    if (unmounted) return;
    state.currentPhase = Math.max(0, Math.min(norm.phases.length - 1, i));
    applyPhase(state.currentPhase);
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
      if (state.currentPhase >= norm.phases.length - 1) {
        stopPlay();
        return;
      }
      gotoPhase(state.currentPhase + 1);
      scheduleNext();
    }, norm.stepDuration);
  }
  function togglePlay() {
    if (state.isPlaying) {
      stopPlay();
    } else {
      if (state.currentPhase >= norm.phases.length - 1) gotoPhase(0);
      startPlay();
    }
  }

  // ── Click-Delegation ────────────────────────────────────
  function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t || !t.closest) return;
    const btn = t.closest('[data-ps-action]');
    if (!btn || !root.contains(btn)) return;
    const action = btn.getAttribute('data-ps-action');
    if (action === 'next') {
      stopPlay();
      gotoPhase(state.currentPhase + 1);
    } else if (action === 'prev') {
      stopPlay();
      gotoPhase(state.currentPhase - 1);
    } else if (action === 'play') {
      togglePlay();
    } else if (action === 'goto') {
      const idx = parseInt(btn.getAttribute('data-ps-index'), 10);
      if (!Number.isNaN(idx)) {
        stopPlay();
        gotoPhase(idx);
      }
    }
  }
  root.addEventListener('click', onClick);

  applyPhase(0);
  if (norm.autoPlay && !reducedMotion) startPlay();

  return {
    widgetType: 'phase-stepper',

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
      return { currentPhase: state.currentPhase, isPlaying: state.isPlaying };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      stopPlay();
      if (typeof s.currentPhase === 'number') gotoPhase(s.currentPhase);
      if (s.isPlaying === true && !reducedMotion) startPlay();
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'phase-stepper',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'phase-stepper', mount: mount };
export { mount };
