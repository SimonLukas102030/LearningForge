// ══════════════════════════════════════════
//  LearningForge — Widget: step-sequencer
//  Welle 5.5 — 16-Step-Rhythmus-Grid + Web-Audio
// ══════════════════════════════════════════
//
// 4 Spuren × 16 Steps. Klick toggled Step an/aus.
// Play: Web-Audio Lookahead-Scheduler (setInterval + scheduleAheadTime).
// Spuren: kick (sub-osc), snare (noise), hihat (noise kurz), melody (sine).
// BPM-Slider 60–180, Reset, ReducedMotion deaktiviert visuellen Cursor.

import { lfWidgetReducedMotion } from './_base.js';

// ── Noten-Frequenz ────────────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function _noteFreq(note) {
  if (!note || typeof note !== 'string') return 261.63;
  const FLAT_MAP = { Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#', Bb:'A#' };
  const oct = parseInt(note.slice(-1), 10);
  if (!Number.isFinite(oct)) return 261.63;
  const raw = note.slice(0, -1);
  const name = FLAT_MAP[raw] || raw;
  const idx = NOTE_NAMES.indexOf(name);
  if (idx < 0) return 261.63;
  return 440 * Math.pow(2, (oct * 12 + idx - 57) / 12);
}

// ── Audio-Context ─────────────────────────────────────────
let _sharedCtx = null;
function _getCtx() {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    try { _sharedCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  if (_sharedCtx.state === 'suspended') _sharedCtx.resume().catch(() => {});
  return _sharedCtx;
}

// ── Sound-Synths ──────────────────────────────────────────
function _playKick(ctx, t) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.frequency.setValueAtTime(200, t);
  osc.frequency.exponentialRampToValueAtTime(60, t + 0.1);
  gain.gain.setValueAtTime(1, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.start(t); osc.stop(t + 0.31);
}

function _playSnare(ctx, t) {
  // Noise burst + pitched body
  const bufLen = ctx.sampleRate * 0.2;
  const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data   = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src  = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  src.connect(gain); gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.5, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.start(t); src.stop(t + 0.2);

  // Pitched tone underneath
  const osc  = ctx.createOscillator();
  const og   = ctx.createGain();
  osc.connect(og); og.connect(ctx.destination);
  osc.frequency.setValueAtTime(250, t);
  og.gain.setValueAtTime(0.3, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.start(t); osc.stop(t + 0.13);
}

function _playHihat(ctx, t) {
  const bufLen = ctx.sampleRate * 0.05;
  const buf    = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data   = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
  const src  = ctx.createBufferSource();
  src.buffer = buf;
  // High-pass filter to make it more hi-haty
  const hp   = ctx.createBiquadFilter();
  hp.type    = 'highpass';
  hp.frequency.setValueAtTime(7000, t);
  const gain = ctx.createGain();
  src.connect(hp); hp.connect(gain); gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.4, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  src.start(t); src.stop(t + 0.05);
}

function _playMelody(ctx, t, freq) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain); gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
  gain.gain.setValueAtTime(0.3, t + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.start(t); osc.stop(t + 0.26);
}

// ── Spurname → Synth-Dispatcher ──────────────────────────
function _playSynthForTrack(ctx, t, track, melodyFreq) {
  if (track === 'kick')   return _playKick(ctx, t);
  if (track === 'snare')  return _playSnare(ctx, t);
  if (track === 'hihat')  return _playHihat(ctx, t);
  if (track === 'melody') return _playMelody(ctx, t, melodyFreq);
}

// ── Config-Normalisierung ─────────────────────────────────
const TRACKS    = ['kick', 'snare', 'hihat', 'melody'];
const TRACK_LABELS = { kick: 'Kick', snare: 'Snare', hihat: 'Hi-Hat', melody: 'Melodie' };

function _normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label  = typeof raw.label === 'string' ? raw.label : 'Rhythmus-Maschine';
  const bpm    = Number.isFinite(+raw.bpm) && +raw.bpm >= 60 && +raw.bpm <= 180 ? +raw.bpm : 120;
  const steps  = Number.isFinite(+raw.steps) && +raw.steps >= 8 && +raw.steps <= 32
    ? Math.round(+raw.steps) : 16;
  const melody = typeof raw.melodyNote === 'string' ? raw.melodyNote : 'C4';

  // Pattern: 4 Spuren × steps steps (0 oder 1)
  const rawPat = (raw.pattern && typeof raw.pattern === 'object') ? raw.pattern : {};
  const pattern = {};
  TRACKS.forEach(tr => {
    const arr = Array.isArray(rawPat[tr]) ? rawPat[tr] : [];
    pattern[tr] = Array.from({ length: steps }, (_, i) => (arr[i] ? 1 : 0));
  });

  return { label, bpm, steps, melody, pattern };
}

// ── Attr-Escape ───────────────────────────────────────────
function _ea(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── HTML-Shell ─────────────────────────────────────────────
let _SLOT_SEQ = 0;
function _nextId() { return 'lf-sq-' + Date.now().toString(36) + '-' + (++_SLOT_SEQ); }

function _buildShell(id, norm) {
  const trackRows = TRACKS.map(tr => {
    const steps = norm.pattern[tr].map((on, i) =>
      '<button type="button" ' +
        'class="lf-sq-step' + (on ? ' lf-sq-on' : '') + '" ' +
        'data-sq-track="' + _ea(tr) + '" ' +
        'data-sq-step="' + i + '" ' +
        'aria-pressed="' + (on ? 'true' : 'false') + '" ' +
        'aria-label="' + _ea(TRACK_LABELS[tr]) + ' Schritt ' + (i+1) + '">' +
      '</button>'
    ).join('');
    return (
      '<div class="lf-sq-row" data-sq-row="' + _ea(tr) + '">' +
        '<span class="lf-sq-label lf-sq-label-' + _ea(tr) + '">' +
          _ea(TRACK_LABELS[tr]) +
        '</span>' +
        '<div class="lf-sq-steps" data-sq-steps="' + _ea(tr) + '">' +
          steps +
        '</div>' +
      '</div>'
    );
  }).join('');

  return (
    '<div class="lf-widget-step-sequencer" id="' + _ea(id) + '" role="region" aria-label="' + _ea(norm.label) + '">' +
      '<div class="lf-sq-header">' +
        '<h4 class="lf-sq-title">' + _ea(norm.label) + '</h4>' +
        '<div class="lf-sq-controls">' +
          '<button type="button" class="lf-sq-btn lf-sq-play-btn" data-sq-play aria-label="Abspielen">' +
            '&#x25B6; Play' +
          '</button>' +
          '<button type="button" class="lf-sq-btn lf-sq-reset-btn" data-sq-reset aria-label="Zur&uuml;cksetzen">' +
            'Reset' +
          '</button>' +
          '<label class="lf-sq-bpm-wrap">' +
            '<span class="lf-sq-bpm-label">BPM: <b data-sq-bpm-val>' + Math.round(norm.bpm) + '</b></span>' +
            '<input type="range" class="lf-sq-bpm-slider" data-sq-bpm ' +
              'min="60" max="180" step="1" value="' + Math.round(norm.bpm) + '" ' +
              'aria-label="BPM">' +
          '</label>' +
        '</div>' +
      '</div>' +
      '<div class="lf-sq-grid" data-sq-grid role="grid" aria-label="Step-Grid">' +
        trackRows +
      '</div>' +
    '</div>'
  );
}

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  const norm = _normalizeConfig(config);
  if (!norm) {
    container.innerHTML = '<div class="lf-widget-step-sequencer lf-sq-empty">Konfiguration fehlt.</div>';
    return _emptyInstance();
  }

  const id = _nextId();
  container.innerHTML = _buildShell(id, norm);
  const root = container.querySelector('#' + CSS.escape(id));

  // ── DOM-Refs ──────────────────────────────────────────
  const playBtn   = root.querySelector('[data-sq-play]');
  const resetBtn  = root.querySelector('[data-sq-reset]');
  const bpmSlider = root.querySelector('[data-sq-bpm]');
  const bpmVal    = root.querySelector('[data-sq-bpm-val]');
  const grid      = root.querySelector('[data-sq-grid]');

  // ── State ─────────────────────────────────────────────
  // Deep-copy pattern so we don't mutate config
  const pattern = {};
  TRACKS.forEach(tr => { pattern[tr] = [...norm.pattern[tr]]; });

  let bpm         = norm.bpm;
  let isPlaying   = false;
  let currentStep = 0;
  let unmounted   = false;

  // Scheduler state
  let _interval    = null;
  let _nextBeatTime = 0;   // AudioContext time of next beat
  const SCHEDULE_AHEAD = 0.1; // seconds to schedule ahead
  const TICK_MS        = 25;  // setInterval resolution

  const melodyFreq = _noteFreq(norm.melody);

  // ── Step-Button-Refs: track × step → element ─────────
  const stepEls = {}; // stepEls[track][step]
  TRACKS.forEach(tr => {
    stepEls[tr] = Array.from(root.querySelectorAll('[data-sq-track="' + tr + '"]'));
  });

  // ── Visual Cursor ─────────────────────────────────────
  function _setCursor(step) {
    if (lfWidgetReducedMotion()) return;
    TRACKS.forEach(tr => {
      stepEls[tr].forEach((el, i) => {
        el.classList.toggle('lf-sq-cursor', i === step);
      });
    });
  }
  function _clearCursor() {
    TRACKS.forEach(tr => {
      stepEls[tr].forEach(el => el.classList.remove('lf-sq-cursor'));
    });
  }

  // ── Scheduler ─────────────────────────────────────────
  function _scheduleBeat(step, beatTime) {
    const ctx = _getCtx();
    if (!ctx) return;
    TRACKS.forEach(tr => {
      if (pattern[tr][step]) {
        _playSynthForTrack(ctx, beatTime, tr, melodyFreq);
      }
    });
    // Visual cursor: schedule via setTimeout matched to audio time
    const delay = (beatTime - ctx.currentTime) * 1000;
    if (!lfWidgetReducedMotion()) {
      setTimeout(() => {
        if (!unmounted && isPlaying) _setCursor(step);
      }, Math.max(0, delay));
    }
  }

  function _tick() {
    const ctx = _getCtx();
    if (!ctx || unmounted) return;
    const secPerBeat = 60 / (bpm * 4); // 16th notes: 4 per beat
    while (_nextBeatTime < ctx.currentTime + SCHEDULE_AHEAD) {
      _scheduleBeat(currentStep, _nextBeatTime);
      _nextBeatTime += secPerBeat;
      currentStep = (currentStep + 1) % norm.steps;
    }
  }

  function _startPlayback() {
    const ctx = _getCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    isPlaying   = true;
    currentStep = 0;
    _nextBeatTime = ctx.currentTime + 0.05;
    _interval   = setInterval(_tick, TICK_MS);
    playBtn.textContent = '&#9646;&#9646; Stop';
    playBtn.innerHTML   = '&#9646;&#9646; Stop';
    playBtn.setAttribute('aria-label', 'Stop');
    playBtn.classList.add('lf-sq-playing');
  }

  function _stopPlayback() {
    isPlaying = false;
    if (_interval) { clearInterval(_interval); _interval = null; }
    _clearCursor();
    playBtn.innerHTML = '&#x25B6; Play';
    playBtn.setAttribute('aria-label', 'Abspielen');
    playBtn.classList.remove('lf-sq-playing');
  }

  // ── Step-Toggle ───────────────────────────────────────
  function _toggleStep(track, step) {
    const newVal = pattern[track][step] ? 0 : 1;
    pattern[track][step] = newVal;
    const el = stepEls[track][step];
    if (!el) return;
    el.classList.toggle('lf-sq-on', newVal === 1);
    el.setAttribute('aria-pressed', newVal === 1 ? 'true' : 'false');
  }

  // ── Reset ─────────────────────────────────────────────
  function _doReset() {
    _stopPlayback();
    TRACKS.forEach(tr => {
      pattern[tr].fill(0);
      stepEls[tr].forEach(el => {
        el.classList.remove('lf-sq-on', 'lf-sq-cursor');
        el.setAttribute('aria-pressed', 'false');
      });
    });
  }

  // ── Event delegation ──────────────────────────────────
  function _onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t) return;

    if ('sqPlay' in t.dataset) {
      isPlaying ? _stopPlayback() : _startPlayback();
      return;
    }
    if ('sqReset' in t.dataset) {
      _doReset();
      return;
    }
    if (t.dataset.sqTrack != null && t.dataset.sqStep != null) {
      _toggleStep(t.dataset.sqTrack, +t.dataset.sqStep);
      return;
    }
  }

  function _onBpmInput(ev) {
    bpm = +ev.target.value;
    bpmVal.textContent = Math.round(bpm);
    // Scheduler picks up new bpm on next tick automatically (reads bpm var).
  }

  root.addEventListener('click', _onClick);
  bpmSlider.addEventListener('input', _onBpmInput);

  // ── Instance ──────────────────────────────────────────
  const _instance = {
    widgetType: 'step-sequencer',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      _stopPlayback();
      try { root.removeEventListener('click', _onClick); } catch(e) {}
      try { bpmSlider.removeEventListener('input', _onBpmInput); } catch(e) {}
    },

    pause()  { if (isPlaying) _stopPlayback(); },
    resume() { if (!isPlaying) _startPlayback(); },
    onTheme() { /* no-op — pure CSS-Vars */ },

    getState() {
      const patCopy = {};
      TRACKS.forEach(tr => { patCopy[tr] = [...pattern[tr]]; });
      return { pattern: patCopy, bpm, isPlaying };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (Number.isFinite(s.bpm) && s.bpm >= 60 && s.bpm <= 180) {
        bpm = s.bpm;
        bpmSlider.value   = Math.round(bpm);
        bpmVal.textContent = Math.round(bpm);
      }
      if (s.pattern && typeof s.pattern === 'object') {
        TRACKS.forEach(tr => {
          if (!Array.isArray(s.pattern[tr])) return;
          for (let i = 0; i < norm.steps; i++) {
            const val = s.pattern[tr][i] ? 1 : 0;
            if (pattern[tr][i] !== val) _toggleStep(tr, i);
          }
        });
      }
      if (s.isPlaying === true && !isPlaying)  _startPlayback();
      if (s.isPlaying === false && isPlaying) _stopPlayback();
    }
  };

  return _instance;
}

function _emptyInstance() {
  return {
    widgetType: 'step-sequencer',
    unmount(){}, pause(){}, resume(){}, onTheme(){},
    getState(){ return {}; }, setState(){}
  };
}

export default { widgetType: 'step-sequencer', mount };
export { mount };
