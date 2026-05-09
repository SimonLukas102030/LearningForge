// ══════════════════════════════════════════
//  LearningForge — Widget: tense-timeline
//  Welle 5.1 (Plan Z.232)
//  Englisch Tense-Zonen-Auswahl
// ══════════════════════════════════════════
//
// User sieht einen Satz mit Lücke und 3 Zone-Buttons
// (past-before-past / past / present-future).
// Klick auf eine Zone → Feedback: Tense-Name + Beispielform + Hint.
// Pro sentence-Eintrag vollständig; Reset → nächster Satz.
//
// Config-Schema (vereinfacht, kein echtes Drag):
//   {
//     label: string,           // optional Aufgaben-Label
//     sentences: [{
//       verb: string,          // "to go"
//       context: string,       // "She ___ to school every day."
//       zones: {
//         past2:   { tense, form, hint },   // past-before-past
//         past:    { tense, form, hint },
//         present: { tense, form, hint }
//       },
//       correct: "past2" | "past" | "present"
//     }]
//   }
//
// API: mount / unmount / onAnswer / getState / setState
// State: { index, picked, total, finished }
// onAnswer payload: { correct: bool, tense, form, hint, zone, correctZone }

import { lfWidgetReducedMotion } from './_base.js';

let _SEQ = 0;
const _sid = () => 'lf-tt2-' + Date.now().toString(36) + '-' + (++_SEQ);

const _ea = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ZONE_KEYS   = ['past2', 'past', 'present'];
const ZONE_LABELS = {
  past2:   'Vergangenheit<br>vor Vergangenheit',
  past:    'Vergangenheit',
  present: 'Gegenwart /<br>Zukunft'
};

function _normalizeSentence(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.verb    !== 'string' || !s.verb.trim())    return null;
  if (typeof s.context !== 'string' || !s.context.trim()) return null;
  if (!ZONE_KEYS.includes(s.correct)) return null;
  if (!s.zones || typeof s.zones !== 'object') return null;
  for (const k of ZONE_KEYS) {
    const z = s.zones[k];
    if (!z || typeof z.tense !== 'string' || typeof z.form !== 'string') return null;
  }
  return {
    verb:    s.verb,
    context: s.context,
    zones:   { past2: s.zones.past2, past: s.zones.past, present: s.zones.present },
    correct: s.correct
  };
}

function _normalize(c) {
  if (!c || typeof c !== 'object') return null;
  const label = typeof c.label === 'string' ? c.label : '';
  const raw = Array.isArray(c.sentences) ? c.sentences : [];
  const sentences = raw.map(_normalizeSentence).filter(Boolean);
  if (sentences.length === 0) return null;
  return { label, sentences };
}

// ── HTML builders ──────────────────────────────────────────────

function _buildZoneButtons(slotId) {
  return ZONE_KEYS.map(k =>
    '<button type="button" class="lf-tt2-zone" '
    + 'data-tt2-action="pick" data-tt2-slot="' + _ea(slotId) + '" '
    + 'data-tt2-zone="' + _ea(k) + '">'
    + ZONE_LABELS[k]
    + '</button>'
  ).join('');
}

function _buildSentenceHtml(s) {
  // Replace first ___ in context with a <mark> placeholder
  const displayed = _ea(s.context).replace('___', '<mark class="lf-tt2-blank">___</mark>');
  return '<p class="lf-tt2-sentence">'
       + '<span class="lf-tt2-verb">' + _ea(s.verb) + '</span> — '
       + displayed
       + '</p>';
}

function _buildHtml(norm, slotId) {
  const labelHtml = norm.label
    ? '<div class="lf-tt2-label">' + norm.label + '</div>'
    : '';

  const totalHint = norm.sentences.length > 1
    ? '<div class="lf-tt2-progress" id="' + _ea(slotId) + '-prog"></div>'
    : '';

  return '<div class="lf-widget-tense-timeline" id="' + _ea(slotId) + '">'
       + labelHtml
       + totalHint
       + '<div class="lf-tt2-card" id="' + _ea(slotId) + '-card"></div>'
       + '<div class="lf-tt2-zones" id="' + _ea(slotId) + '-zones">'
       +   _buildZoneButtons(slotId)
       + '</div>'
       + '<div class="lf-tt2-feedback" id="' + _ea(slotId) + '-fb" hidden></div>'
       + '<div class="lf-tt2-actions">'
       +   '<button type="button" class="lf-tt2-next" hidden '
       +     'data-tt2-action="next" data-tt2-slot="' + _ea(slotId) + '">'
       +     'Weiter'
       +   '</button>'
       + '</div>'
       + '</div>';
}

// ── mount ──────────────────────────────────────────────────────

function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _empty();

  const norm = _normalize(config);
  if (!norm) {
    container.innerHTML = '<div class="lf-widget-tense-timeline lf-tt2-empty">'
      + 'Diese Aufgabe ist noch nicht fertig konfiguriert.</div>';
    return _empty();
  }

  const slotId = _sid();
  container.innerHTML = _buildHtml(norm, slotId);

  const root     = container.querySelector('#' + CSS.escape(slotId));
  const cardEl   = root.querySelector('#' + CSS.escape(slotId) + '-card');
  const fbEl     = root.querySelector('#' + CSS.escape(slotId) + '-fb');
  const progEl   = root.querySelector('#' + CSS.escape(slotId) + '-prog');
  const zonesEl  = root.querySelector('#' + CSS.escape(slotId) + '-zones');
  const nextBtn  = root.querySelector('[data-tt2-action="next"]');

  const reducedMotion = lfWidgetReducedMotion();
  let unmounted = false;
  const answerCbs = [];

  const state = {
    index:    0,
    picked:   null,   // zone key the user chose, or null
    finished: false
  };

  function currentSentence() {
    return norm.sentences[state.index] || null;
  }

  function renderCard() {
    const s = currentSentence();
    if (!s) {
      cardEl.innerHTML = '<p class="lf-tt2-done">Alle Sätze abgeschlossen!</p>';
      zonesEl.hidden = true;
      if (nextBtn) nextBtn.hidden = true;
      return;
    }
    cardEl.innerHTML = _buildSentenceHtml(s);
    if (progEl && norm.sentences.length > 1) {
      progEl.textContent = (state.index + 1) + ' / ' + norm.sentences.length;
    }
  }

  function setZoneDisabled(disabled) {
    zonesEl.querySelectorAll('.lf-tt2-zone').forEach(btn => {
      btn.disabled = disabled;
    });
  }

  function renderFeedback(zone) {
    const s = currentSentence();
    if (!s) return;
    const z   = s.zones[zone];
    const isCorrect = zone === s.correct;
    const correctZ  = s.zones[s.correct];

    let html = '<div class="lf-tt2-fb-inner '
      + (isCorrect ? 'lf-tt2-fb-correct' : 'lf-tt2-fb-wrong') + '">';

    if (isCorrect) {
      html += '<span class="lf-tt2-fb-icon">&#10003;</span> ';
      html += '<strong>' + _ea(z.tense) + '</strong>';
      html += ' &mdash; <em>' + _ea(z.form) + '</em>';
      if (z.hint) html += '<div class="lf-tt2-fb-hint">' + _ea(z.hint) + '</div>';
    } else {
      html += '<span class="lf-tt2-fb-icon">&#10007;</span> ';
      html += 'Das war <em>' + _ea(z.tense) + '</em>. ';
      html += 'Richtig: <strong>' + _ea(correctZ.tense) + '</strong>';
      html += ' &mdash; <em>' + _ea(correctZ.form) + '</em>';
      if (correctZ.hint) html += '<div class="lf-tt2-fb-hint">' + _ea(correctZ.hint) + '</div>';
    }
    html += '</div>';
    fbEl.innerHTML = html;
    fbEl.hidden = false;

    // Highlight chosen zone button
    zonesEl.querySelectorAll('.lf-tt2-zone').forEach(btn => {
      const bz = btn.getAttribute('data-tt2-zone');
      btn.classList.toggle('lf-tt2-zone-chosen',  bz === zone);
      btn.classList.toggle('lf-tt2-zone-correct',  bz === s.correct);
      btn.classList.toggle('lf-tt2-zone-wrong',
        bz === zone && !isCorrect);
    });
  }

  function clearFeedback() {
    fbEl.hidden = true;
    fbEl.innerHTML = '';
    zonesEl.querySelectorAll('.lf-tt2-zone').forEach(btn => {
      btn.classList.remove('lf-tt2-zone-chosen', 'lf-tt2-zone-correct', 'lf-tt2-zone-wrong');
      btn.disabled = false;
    });
  }

  function pick(zone) {
    if (unmounted) return;
    if (state.picked !== null) return;   // already answered this sentence
    const s = currentSentence();
    if (!s) return;

    state.picked = zone;
    setZoneDisabled(true);
    renderFeedback(zone);

    if (!nextBtn) return;
    const isLast = state.index >= norm.sentences.length - 1;
    nextBtn.textContent = isLast ? 'Fertig' : 'Weiter';
    nextBtn.hidden = false;

    const isCorrect = zone === s.correct;
    const z = s.zones[zone];
    const cz = s.zones[s.correct];
    answerCbs.forEach(cb => {
      try {
        cb({
          correct:     isCorrect,
          tense:       z.tense,
          form:        z.form,
          hint:        z.hint || '',
          zone:        zone,
          correctZone: s.correct,
          correctTense: cz.tense,
          correctForm:  cz.form
        });
      } catch (e) { console.warn('[tense-timeline onAnswer]', e); }
    });
  }

  function next() {
    if (unmounted) return;
    if (state.picked === null) return;
    const isLast = state.index >= norm.sentences.length - 1;
    if (isLast) {
      state.finished = true;
      clearFeedback();
      cardEl.innerHTML = '<p class="lf-tt2-done">Alle Sätze abgeschlossen! &#10003;</p>';
      zonesEl.hidden = true;
      if (nextBtn) nextBtn.hidden = true;
      return;
    }
    state.index += 1;
    state.picked = null;
    clearFeedback();
    if (nextBtn) nextBtn.hidden = true;
    renderCard();
    if (!reducedMotion && cardEl) {
      cardEl.classList.add('lf-tt2-card-in');
      setTimeout(() => {
        if (!unmounted) cardEl.classList.remove('lf-tt2-card-in');
      }, 350);
    }
  }

  function onClick(ev) {
    if (unmounted) return;
    const el = ev.target.closest('[data-tt2-action]');
    if (!el || !root.contains(el)) return;
    if (el.disabled) return;
    const action = el.getAttribute('data-tt2-action');
    if (action === 'pick') {
      pick(el.getAttribute('data-tt2-zone'));
    } else if (action === 'next') {
      next();
    }
  }

  root.addEventListener('click', onClick);
  renderCard();

  return {
    widgetType: 'tense-timeline',
    unmount() {
      if (unmounted) return;
      unmounted = true;
      try { root.removeEventListener('click', onClick); } catch (e) {}
      answerCbs.length = 0;
    },
    onAnswer(cb) { if (typeof cb === 'function') answerCbs.push(cb); },
    pause()  {},
    resume() {},
    onTheme() {},
    getState() {
      return {
        index:    state.index,
        picked:   state.picked,
        finished: state.finished,
        total:    norm.sentences.length
      };
    },
    setState(s) {
      if (!s || typeof s !== 'object') return;
      const idx = typeof s.index === 'number' ? Math.max(0, Math.min(s.index, norm.sentences.length - 1)) : 0;
      state.index    = idx;
      state.finished = !!s.finished;
      state.picked   = typeof s.picked === 'string' && ZONE_KEYS.includes(s.picked) ? s.picked : null;
      clearFeedback();
      if (nextBtn) nextBtn.hidden = true;
      if (state.finished) {
        cardEl.innerHTML = '<p class="lf-tt2-done">Alle Sätze abgeschlossen! &#10003;</p>';
        zonesEl.hidden = true;
      } else {
        zonesEl.hidden = false;
        renderCard();
        if (state.picked !== null) {
          setZoneDisabled(true);
          renderFeedback(state.picked);
          if (nextBtn) {
            const isLast = state.index >= norm.sentences.length - 1;
            nextBtn.textContent = isLast ? 'Fertig' : 'Weiter';
            nextBtn.hidden = false;
          }
        }
      }
    }
  };
}

function _empty() {
  return {
    widgetType: 'tense-timeline',
    unmount() {},
    onAnswer() {},
    pause()  {},
    resume() {},
    onTheme() {},
    getState() { return {}; },
    setState() {}
  };
}

export default { widgetType: 'tense-timeline', mount };
export { mount };
