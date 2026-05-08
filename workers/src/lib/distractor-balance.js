// =============================================================
//  LearningForge Worker - Distractor-Length Balancer
// -------------------------------------------------------------
//  B5 fix (2026-05-08, Marcus). Ramsey quantified: in
//  Fächer/Geschichte/Klasse-9/Erster-Weltkrieg/questions.json
//  the correct option is on average ~3x the median distractor
//  length, max 5.6x. ~85% pick-longest hit rate = Note 1-2 without
//  learning. Same bias is in workers/src/lib/daily-challenges.js.
//
//  Strategy:
//    For each MC question where the correct option is materially
//    longer than the median distractor (factor > 1.4), trim the
//    correct option down at a "natural" cut-point (after a comma,
//    semicolon, em-dash, parenthesis, or "(" / ":") + ellipsis.
//    Prefer trimming over padding distractors — padding plausibly
//    is content-wrong (a distractor stays a distractor only as long
//    as it's still incorrect; appending "in der damaligen Zeit" can
//    accidentally make it true). Trimming is content-safe.
//
//  Guarantees:
//    - `correct` index is preserved (we never reshuffle).
//    - `options.length` is preserved.
//    - Only the option at index `q.correct` may be modified, and
//      only its trailing tail is dropped.
//    - If trimming cannot bring the factor under TARGET_FACTOR
//      without dropping below MIN_CHARS, we leave the option as-is.
//      That's acceptable — Ethan does a parallel client-side pass
//      that may catch what we miss.
//
//  Returns a NEW question object (does not mutate input).
// =============================================================

// Length factor above which we consider the correct option "outlier-long"
// and intervene. 1.4 = ~40% longer than median distractor. Below this is
// noise (humans naturally write more words for the right answer in some
// domains; trimming hurts pedagogy). Above this is the cheat-vector.
const TARGET_FACTOR = 1.4;

// Don't trim below this length — short answers like "x = +/-3" or "1914"
// must stay intact. If trimming would go below this, we keep the original.
const MIN_CHARS = 12;

// Try cut-points in this priority order. Each returns the index of the
// last char to keep (exclusive end), or -1 if no such cut exists.
const CUT_RULES = [
  // After last em-dash / en-dash followed by space (German: "X — Erläuterung")
  s => { const m = s.match(/.*[—–]\s/); return m ? m[0].length - 2 : -1; },
  // After last colon + space (German: "X: weil ...")
  s => { const i = s.lastIndexOf(': '); return i > 0 ? i : -1; },
  // Before opening parenthesis (drop trailing parenthetical)
  s => { const i = s.lastIndexOf(' ('); return i > 0 ? i : -1; },
  // After last comma + space — drop trailing subordinate clause
  s => { const i = s.lastIndexOf(', '); return i > 0 ? i : -1; },
  // After last semicolon
  s => { const i = s.lastIndexOf('; '); return i > 0 ? i : -1; },
  // After last "weil" / "da" / "der ..."-style connector — fallback word boundary
  s => { const m = s.match(/^(.{20,}?)\s(?:weil|da|um|durch|als|wenn)\s/i); return m ? m[1].length : -1; }
];

function _medianLen(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// Internal: try to trim `s` so that its new length is roughly `targetLen`.
// Returns trimmed string + ellipsis, or null if no clean cut available.
function _trimToTarget(s, targetLen) {
  if (s.length <= targetLen) return s;
  for (const rule of CUT_RULES) {
    const cut = rule(s);
    if (cut > MIN_CHARS && cut <= targetLen + 8) {
      // +8 tolerance — we'd rather take a slightly-too-long natural cut
      // than a clean one in the wrong spot. The factor will still drop
      // a lot.
      const trimmed = s.slice(0, cut).replace(/[\s,;:—–(]+$/, '').trim();
      if (trimmed.length >= MIN_CHARS) return trimmed + ' ...';
    }
  }
  return null;
}

// Public API. Takes a question object, returns a balanced clone.
// Non-MC questions and questions without options are returned unchanged.
export function balanceDistractorLength(question) {
  if (!question || question.type !== 'multiple_choice') return question;
  const options = question.options;
  if (!Array.isArray(options) || options.length < 2) return question;
  if (!Number.isInteger(question.correct)) return question;
  if (question.correct < 0 || question.correct >= options.length) return question;

  const correctOpt   = String(options[question.correct] || '');
  const distractors  = options
    .map((o, i) => i === question.correct ? null : String(o || ''))
    .filter(o => o !== null);
  if (distractors.length === 0) return question;

  const medianLen = _medianLen(distractors.map(d => d.length));
  if (medianLen <= 0) return question;
  const factor = correctOpt.length / medianLen;

  if (factor <= TARGET_FACTOR) return question;       // already balanced
  if (correctOpt.length <= MIN_CHARS) return question; // can't trim further

  // Trim target: median * TARGET_FACTOR (so the new factor ≈ 1.4 exactly).
  const target = Math.max(MIN_CHARS, Math.round(medianLen * TARGET_FACTOR));
  const trimmed = _trimToTarget(correctOpt, target);
  if (!trimmed) return question;                       // no clean cut found

  // Build a new options array — only the correct slot changes.
  const newOptions = options.slice();
  newOptions[question.correct] = trimmed;

  return { ...question, options: newOptions };
}

// Helper for callers with an array of questions. Returns a new array;
// non-MC entries pass through unchanged. Used in any future endpoint
// that ships MC questions to the client (today: only the daily-challenge
// curated map). The submitDailyChallenge eval-path does NOT call this —
// the user already saw the (un-balanced) options on their device, so
// rewriting them server-side at submit time would mean a length factor
// improvement that the user never benefited from.
export function balanceDistractorLengthBatch(questions) {
  if (!Array.isArray(questions)) return questions;
  return questions.map(q => balanceDistractorLength(q));
}
