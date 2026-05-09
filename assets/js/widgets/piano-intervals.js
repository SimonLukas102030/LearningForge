// ══════════════════════════════════════════
//  LearningForge — Widget: piano-intervals
//  Welle 5.4 — Klavier-SVG + Web-Audio Intervalle
// ══════════════════════════════════════════
//
// Modus 1 — Freies Spielen: SVG-Klavier (2 Oktaven), Klick spielt Ton,
//   aktive Taste wird hervorgehoben, Note-Name wird angezeigt.
// Modus 2 — Hörtest: Widget spielt 2 Noten, User wählt Intervallname,
//   Feedback + onAnswer() Callback.
//
// Web-Audio: AudioContext wird lazy beim ersten Klick erstellt (User-Gesture-
//   Anforderung). triangle-Waveform (wärmerer Klang als sine). ADSR-ähnlich
//   über exponentialRampToValueAtTime.
//
// Pure SVG + CSS-Vars — kein Canvas, kein RAF-Loop. onTheme() ist no-op
//   weil Theme-Wechsel durch CSS-Vars automatisch zieht.

import { lfWidgetReducedMotion } from './_base.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// ── Musik-Theorie Helpers ─────────────────────────────────

// Chromatische Noten-Sequenz (C=0 … B=11).
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Halbton-Index: Name + Oktave → MIDI-ähnlicher Integer (C4=48).
function _noteIndex(name, oct) {
  const i = NOTE_NAMES.indexOf(name);
  if (i < 0) return -1;
  return oct * 12 + i;
}

// Frequenz aus MIDI-ähnlichem Index: A4=440 Hz → idx(A4)=57.
// f = 440 * 2^((idx - 57) / 12)
function _freqFromIdx(idx) {
  return 440 * Math.pow(2, (idx - 57) / 12);
}

// Frequenz aus Note-String wie "C4", "F#5", "Bb3".
function noteFreq(note) {
  if (!note || typeof note !== 'string') return 440;
  const s = note.replace('b', '#').trim(); // normiere Bb→B#-ish … nein, besser explizit:
  // Flat-Noten: Db→C#, Eb→D#, Gb→F#, Ab→G#, Bb→A#
  const FLAT_MAP = { 'Db':'C#','Eb':'D#','Gb':'F#','Ab':'G#','Bb':'A#' };
  const oct = parseInt(note.slice(-1), 10);
  if (!Number.isFinite(oct)) return 440;
  let nameRaw = note.slice(0, -1);
  const name = FLAT_MAP[nameRaw] || nameRaw;
  const idx = _noteIndex(name, oct);
  if (idx < 0) return 440;
  return _freqFromIdx(idx);
}

// Intervall-Semitone-Abstände (aufwärts).
const INTERVALS = [
  { name: 'Prim',    semitones: 0  },
  { name: 'Sekunde', semitones: 2  },
  { name: 'Terz',    semitones: 4  },
  { name: 'Quarte',  semitones: 5  },
  { name: 'Quinte',  semitones: 7  },
  { name: 'Sexte',   semitones: 9  },
  { name: 'Septime', semitones: 11 },
  { name: 'Oktave',  semitones: 12 },
];

function _intervallBySemitones(n) {
  return INTERVALS.find(i => i.semitones === n) || null;
}

// ── Config-Normalisierung ─────────────────────────────────
function _normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const label   = typeof raw.label === 'string' ? raw.label : 'Intervalle am Klavier';
  const mode    = raw.mode === 'hear' ? 'hear' : 'play';
  const octaves = (Number.isFinite(+raw.octaves) && +raw.octaves >= 1 && +raw.octaves <= 3)
    ? Math.round(+raw.octaves) : 2;
  const startOct = raw.startNote && typeof raw.startNote === 'string'
    ? (parseInt(raw.startNote.slice(-1), 10) || 4) : 4;

  const htRaw  = raw.hearingTest && typeof raw.hearingTest === 'object' ? raw.hearingTest : {};
  const htIntervals = Array.isArray(htRaw.intervals) && htRaw.intervals.length > 0
    ? htRaw.intervals.filter(n => INTERVALS.some(i => i.name === n))
    : INTERVALS.map(i => i.name);
  const htRounds = Number.isFinite(+htRaw.rounds) && +htRaw.rounds > 0 ? +htRaw.rounds : 5;

  return { label, mode, octaves, startOct, htIntervals, htRounds };
}

// ── SVG Klavier-Builder ───────────────────────────────────
// Gibt { svg, keyEls } zurück.
// keyEls: Map<noteString → SVGElement>
//
// 2 Oktaven = 14 weiße Tasten, 10 schwarze (C,D,E,F,G,A,B pro Oktave =7 weiß;
// C#,D#,F#,G#,A# pro Oktave = 5 schwarz).
// Weiße Tasten: W=28px, H=120px. Schwarze: W=18px, H=72px.
const WHITE_W = 28;
const WHITE_H = 120;
const BLACK_W = 18;
const BLACK_H = 72;
// Halbton-Offset innerhalb einer Oktave → x-Position der schwarzen Taste
// relativ zum linken Rand der Oktave (weiße Tasten 0-6, je 28px breit).
// Schwarze Tasten sitzen ZWISCHEN weißen Tasten:
// C# zwischen C(0) und D(1) → x = WHITE_W - BLACK_W/2
// D# zwischen D(1) und E(2) → x = 2*WHITE_W - BLACK_W/2
// F# zwischen F(3) und G(4) → x = 4*WHITE_W - BLACK_W/2
// G# zwischen G(4) und A(5) → x = 5*WHITE_W - BLACK_W/2
// A# zwischen A(5) und B(6) → x = 6*WHITE_W - BLACK_W/2
const BLACK_X_IN_OCT = { 1: 1, 3: 2, 6: 4, 8: 5, 10: 6 }; // semitone-in-oct → white-gap-index

function _buildPiano(octaves, startOct) {
  const totalWhite = octaves * 7;
  const svgW       = totalWhite * WHITE_W + 2;
  const svgH       = WHITE_H + 4;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'lf-pi-svg');
  svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Klaviatur');

  const keyEls = new Map();

  // Weiße Tasten zuerst (hinter schwarzen).
  const whiteOrder = [0,2,4,5,7,9,11]; // Semitone-in-Oktave für weiße Tasten
  for (let o = 0; o < octaves; o++) {
    const oct = startOct + o;
    whiteOrder.forEach((semInOct, wi) => {
      const noteName = NOTE_NAMES[semInOct];
      const noteStr  = noteName + oct;
      const xPos = (o * 7 + wi) * WHITE_W + 1;

      const btn = document.createElementNS(SVG_NS, 'rect');
      btn.setAttribute('class', 'lf-pi-key lf-pi-white');
      btn.setAttribute('x',      xPos);
      btn.setAttribute('y',      2);
      btn.setAttribute('width',  WHITE_W - 1);
      btn.setAttribute('height', WHITE_H);
      btn.setAttribute('rx',     3);
      btn.setAttribute('role',   'button');
      btn.setAttribute('aria-label', 'Note ' + noteStr);
      btn.setAttribute('tabindex', '0');
      btn.dataset.note = noteStr;
      svg.appendChild(btn);
      keyEls.set(noteStr, btn);
    });
  }

  // Schwarze Tasten obendrüber.
  const blackSemitones = [1,3,6,8,10]; // Semitone-in-Oktave für schwarze Tasten
  for (let o = 0; o < octaves; o++) {
    const oct = startOct + o;
    blackSemitones.forEach(semInOct => {
      const noteName = NOTE_NAMES[semInOct];
      const noteStr  = noteName + oct;
      const gapIdx   = BLACK_X_IN_OCT[semInOct]; // 1-indexed white gap
      const xPos     = (o * 7 + gapIdx) * WHITE_W - BLACK_W / 2 + 1;

      const btn = document.createElementNS(SVG_NS, 'rect');
      btn.setAttribute('class', 'lf-pi-key lf-pi-black');
      btn.setAttribute('x',      xPos);
      btn.setAttribute('y',      2);
      btn.setAttribute('width',  BLACK_W);
      btn.setAttribute('height', BLACK_H);
      btn.setAttribute('rx',     2);
      btn.setAttribute('role',   'button');
      btn.setAttribute('aria-label', 'Note ' + noteStr);
      btn.setAttribute('tabindex', '0');
      btn.dataset.note = noteStr;
      svg.appendChild(btn);
      keyEls.set(noteStr, btn);
    });
  }

  return { svg, keyEls };
}

// ── Audio-Engine ──────────────────────────────────────────
// Lazy: AudioContext wird beim ersten Ton-Aufruf erstellt.
let _sharedCtx = null;
function _getCtx() {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    try { _sharedCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  if (_sharedCtx.state === 'suspended') {
    _sharedCtx.resume().catch(() => {});
  }
  return _sharedCtx;
}

// Spielt eine Note. Gibt Promise zurück, die nach duration+0.1s resolved.
function _playNote(freq, duration) {
  const ctx = _getCtx();
  if (!ctx) return Promise.resolve();
  const now  = ctx.currentTime;
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(freq, now);
  // Envelope: schneller Attack, sanftes Release.
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.28, now + 0.02);
  gain.gain.setValueAtTime(0.28, now + duration - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.start(now);
  osc.stop(now + duration + 0.01);
  return new Promise(resolve => setTimeout(resolve, (duration + 0.05) * 1000));
}

// ── HTML-Shell ─────────────────────────────────────────────
function _escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _renderShell(slotId, norm) {
  return (
    '<div class="lf-widget-piano-intervals" id="' + _escapeAttr(slotId) + '">' +
      (norm.label ? '<h4 class="lf-pi-title">' + norm.label + '</h4>' : '') +
      '<div class="lf-pi-mode-bar">' +
        '<button type="button" class="lf-pi-mode-btn lf-pi-mode-active" data-pi-mode="play">Spielen</button>' +
        '<button type="button" class="lf-pi-mode-btn" data-pi-mode="hear">H&ouml;rtest</button>' +
      '</div>' +
      '<div class="lf-pi-note-display" data-pi-note aria-live="polite" aria-atomic="true">&nbsp;</div>' +
      '<div class="lf-pi-piano-wrap" data-pi-piano></div>' +
      '<div class="lf-pi-hear-panel" data-pi-hear style="display:none">' +
        '<div class="lf-pi-hear-prompt" data-pi-hear-prompt>Welches Intervall ist das?</div>' +
        '<button type="button" class="lf-pi-play-btn" data-pi-play-btn>&#x25B6; Abspielen</button>' +
        '<div class="lf-pi-choices" data-pi-choices></div>' +
        '<div class="lf-pi-feedback" data-pi-feedback aria-live="polite" aria-atomic="true"></div>' +
        '<div class="lf-pi-progress" data-pi-progress></div>' +
      '</div>' +
    '</div>'
  );
}

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-pi-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

// ── mount() ───────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();
  const norm = _normalizeConfig(config);
  if (!norm) {
    container.innerHTML = '<div class="lf-widget-piano-intervals lf-pi-empty">Konfiguration fehlt.</div>';
    return _emptyInstance();
  }

  const slotId = _nextSlotId();
  container.innerHTML = _renderShell(slotId, norm);
  const root = container.querySelector('#' + CSS.escape(slotId));

  // DOM-Refs.
  const noteDisplay = root.querySelector('[data-pi-note]');
  const pianoWrap   = root.querySelector('[data-pi-piano]');
  const hearPanel   = root.querySelector('[data-pi-hear]');
  const hearPrompt  = root.querySelector('[data-pi-hear-prompt]');
  const playBtn     = root.querySelector('[data-pi-play-btn]');
  const choicesEl   = root.querySelector('[data-pi-choices]');
  const feedbackEl  = root.querySelector('[data-pi-feedback]');
  const progressEl  = root.querySelector('[data-pi-progress]');
  const modeBtns    = root.querySelectorAll('[data-pi-mode]');

  // Klavier bauen.
  const { svg, keyEls } = _buildPiano(norm.octaves, norm.startOct);
  pianoWrap.appendChild(svg);

  // State.
  let unmounted    = false;
  let currentMode  = norm.mode; // 'play' | 'hear'
  let activeKeys   = new Set();
  let hearState    = null;      // { rootNote, interval, answered }
  let hearRound    = 0;
  let hearCorrect  = 0;
  let hearBusy     = false;     // verhindert Doppel-Klick während Audio läuft

  // ── Taste aktivieren/deaktivieren ──────────────────────
  function _flashKey(noteStr, active) {
    const el = keyEls.get(noteStr);
    if (!el) return;
    if (active) {
      el.classList.add('lf-pi-active');
      activeKeys.add(noteStr);
    } else {
      el.classList.remove('lf-pi-active');
      activeKeys.delete(noteStr);
    }
  }
  function _clearAllKeys() {
    activeKeys.forEach(n => {
      const el = keyEls.get(n);
      if (el) el.classList.remove('lf-pi-active');
    });
    activeKeys.clear();
  }

  // ── Ton spielen + visuelle Rückmeldung ─────────────────
  async function _playAndFlash(noteStr, duration) {
    if (unmounted) return;
    _flashKey(noteStr, true);
    await _playNote(noteFreq(noteStr), duration || 0.9);
    if (!unmounted) _flashKey(noteStr, false);
  }

  // ── Hörtest-Runde aufbauen ─────────────────────────────
  function _setupHearRound() {
    if (unmounted) return;
    // Zufälliges Intervall aus der konfigurierten Liste wählen.
    const iName = norm.htIntervals[Math.floor(Math.random() * norm.htIntervals.length)];
    const iDef  = INTERVALS.find(i => i.name === iName) || INTERVALS[4]; // Fallback: Quinte
    // Zufällige Wurzel-Note aus dem Klavierbereich.
    const allKeys = [...keyEls.keys()];
    // Filterung: Wurzelnote + Intervall darf den Klavierbereich nicht verlassen.
    const validRoots = allKeys.filter(n => {
      const noteName = n.slice(0, -1);
      const octN     = parseInt(n.slice(-1), 10);
      const rootIdx  = _noteIndex(noteName, octN);
      const topNote  = rootIdx + iDef.semitones;
      const topOct   = Math.floor(topNote / 12);
      const topName  = NOTE_NAMES[topNote % 12];
      return keyEls.has(topName + topOct);
    });
    if (validRoots.length === 0) {
      // Fallback auf Prim.
      hearState = { rootNote: allKeys[0], interval: INTERVALS[0], answered: false };
    } else {
      const rootNote = validRoots[Math.floor(Math.random() * validRoots.length)];
      hearState = { rootNote, interval: iDef, answered: false };
    }

    feedbackEl.textContent = '';
    feedbackEl.className   = 'lf-pi-feedback';
    progressEl.textContent = 'Runde ' + (hearRound + 1) + ' / ' + norm.htRounds;
    hearPrompt.textContent = 'Welches Intervall ist das?';

    // Choice-Buttons neu rendern — 4 zufällige Optionen inkl. korrekte.
    _buildChoices();
    _enableChoices(false);
    playBtn.disabled = false;
    playBtn.textContent = '▶ Abspielen';
  }

  // 4 Antwort-Buttons (immer die richtige + 3 Falsche).
  function _buildChoices() {
    if (!hearState) return;
    const correct = hearState.interval.name;
    // Alle konfigurierten Intervalle als Pool, dedupliziert.
    const pool = [...new Set(norm.htIntervals)];
    const wrong = pool.filter(n => n !== correct);
    // Mische + nimm 3 falsche (oder weniger falls Pool klein).
    for (let i = wrong.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [wrong[i], wrong[j]] = [wrong[j], wrong[i]];
    }
    const options = [correct, ...wrong.slice(0, 3)];
    // Mische finale Options.
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    choicesEl.innerHTML = options.map(n =>
      '<button type="button" class="lf-pi-choice" data-pi-choice="' + _escapeAttr(n) + '" disabled>' +
        n +
      '</button>'
    ).join('');
  }

  function _enableChoices(enabled) {
    choicesEl.querySelectorAll('[data-pi-choice]').forEach(btn => {
      btn.disabled = !enabled;
    });
  }

  // Intervall abspielen (beide Noten).
  async function _playInterval() {
    if (!hearState || hearBusy || unmounted) return;
    hearBusy     = true;
    playBtn.disabled = true;
    _clearAllKeys();
    const rootStr = hearState.rootNote;
    const rootN   = rootStr.slice(0, -1);
    const rootO   = parseInt(rootStr.slice(-1), 10);
    const topIdx  = _noteIndex(rootN, rootO) + hearState.interval.semitones;
    const topName = NOTE_NAMES[topIdx % 12] + Math.floor(topIdx / 12);

    await _playAndFlash(rootStr,  0.8);
    if (!unmounted) await new Promise(r => setTimeout(r, 150));
    if (!unmounted) await _playAndFlash(topName, 0.8);

    hearBusy = false;
    if (!unmounted && !hearState.answered) {
      _enableChoices(true);
      playBtn.disabled = false;
    }
  }

  // Antwort auswerten.
  function _evalAnswer(chosen) {
    if (!hearState || hearState.answered || unmounted) return;
    hearState.answered = true;
    _enableChoices(false);
    playBtn.disabled = true;

    const correct = chosen === hearState.interval.name;
    if (correct) hearCorrect++;
    feedbackEl.className = 'lf-pi-feedback ' + (correct ? 'lf-pi-fb-correct' : 'lf-pi-fb-wrong');
    feedbackEl.textContent = correct
      ? '✓ Richtig! Es war eine ' + hearState.interval.name + '.'
      : '✗ Falsch. Es war eine ' + hearState.interval.name + '.';

    // onAnswer feuern.
    if (typeof _instance.onAnswer === 'function') {
      _instance.onAnswer({
        correct,
        chosen,
        expected: hearState.interval.name,
        round: hearRound + 1,
        total: norm.htRounds
      });
    }

    hearRound++;
    if (hearRound >= norm.htRounds) {
      // Test abgeschlossen.
      setTimeout(() => {
        if (!unmounted) _showHearResult();
      }, 1200);
    } else {
      setTimeout(() => {
        if (!unmounted) _setupHearRound();
      }, 1200);
    }
  }

  function _showHearResult() {
    feedbackEl.className  = 'lf-pi-feedback lf-pi-fb-result';
    feedbackEl.textContent = 'Test abgeschlossen: ' + hearCorrect + '/' + norm.htRounds + ' richtig.';
    choicesEl.innerHTML = '<button type="button" class="lf-pi-choice lf-pi-choice-retry" data-pi-retry>Nochmal</button>';
    playBtn.disabled = true;
    progressEl.textContent = '';
    hearPrompt.textContent  = 'Ergebnis';
  }

  function _startHear() {
    hearRound   = 0;
    hearCorrect = 0;
    hearBusy    = false;
    hearState   = null;
    _setupHearRound();
  }

  // ── Mode-Wechsel ────────────────────────────────────────
  function _setMode(mode) {
    currentMode = mode;
    modeBtns.forEach(btn => {
      btn.classList.toggle('lf-pi-mode-active', btn.dataset.piMode === mode);
    });
    if (mode === 'hear') {
      hearPanel.style.display = '';
      _clearAllKeys();
      noteDisplay.innerHTML   = '&nbsp;';
      _startHear();
    } else {
      hearPanel.style.display = 'none';
      _clearAllKeys();
      noteDisplay.innerHTML   = '&nbsp;';
    }
  }

  // ── Klick-Delegation ────────────────────────────────────
  async function onClick(ev) {
    if (unmounted) return;
    const t = ev.target;
    if (!t) return;

    // Mode-Button.
    if (t.dataset && t.dataset.piMode) {
      _setMode(t.dataset.piMode);
      return;
    }

    // Play-Button (Hörtest).
    if (t.dataset && 'piPlayBtn' in t.dataset) {
      if (!hearBusy) _playInterval();
      return;
    }

    // Choice-Button.
    if (t.dataset && t.dataset.piChoice != null) {
      _evalAnswer(t.dataset.piChoice);
      return;
    }

    // Retry-Button.
    if (t.dataset && 'piRetry' in t.dataset) {
      _startHear();
      return;
    }

    // Klaviertaste.
    const key = t.dataset && t.dataset.note;
    if (key && currentMode === 'play') {
      _clearAllKeys();
      noteDisplay.textContent = key;
      _playAndFlash(key, 1.1);
    }
  }

  root.addEventListener('click', onClick);

  // Keyboard-Support für SVG-Tasten (tabindex="0" + Enter/Space).
  function onKeydown(ev) {
    if (unmounted) return;
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const key = ev.target && ev.target.dataset && ev.target.dataset.note;
    if (key && currentMode === 'play') {
      ev.preventDefault();
      _clearAllKeys();
      noteDisplay.textContent = key;
      _playAndFlash(key, 1.1);
    }
  }
  root.addEventListener('keydown', onKeydown);

  // Initialen Mode setzen.
  _setMode(currentMode);

  // Instance-Objekt.
  const _instance = {
    widgetType: 'piano-intervals',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      try { root.removeEventListener('click', onClick); } catch (e) {}
      try { root.removeEventListener('keydown', onKeydown); } catch (e) {}
    },

    pause()  { /* Audio stoppt von selbst. */ },
    resume() {},
    onTheme() { /* no-op — pure CSS-Vars. */ },
    onAnswer() { /* wird von außen überschrieben (z.B. test-engine.js). */ },

    getState() {
      return { mode: currentMode, round: hearRound, correct: hearCorrect };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (s.mode && s.mode !== currentMode) _setMode(s.mode);
    }
  };

  return _instance;
}

function _emptyInstance() {
  return {
    widgetType: 'piano-intervals',
    unmount() {}, pause() {}, resume() {}, onTheme() {}, onAnswer() {},
    getState() { return {}; }, setState() {}
  };
}

export default { widgetType: 'piano-intervals', mount };
export { mount };
