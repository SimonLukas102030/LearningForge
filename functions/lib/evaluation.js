// =============================================================
//  LearningForge Cloud Functions - Server-side answer evaluation
// -------------------------------------------------------------
//  Mirrors assets/js/test-engine.js. Pure-JS, no AI calls (the
//  AI grading still runs client-side; the server records the
//  per-question {points, maxPoints} the client computed BUT
//  re-validates MC against the original-order options + clamps
//  every per-question point to [0..maxPoints]. This is the
//  defense-in-depth for Cheat #7 variant C (faked AI response).
//
//  Hard rule: feature parity with TIME_CONFIG so grade math
//  doesn't drift between client display and server record.
// =============================================================

export const TIME_CONFIG = {
  5:  { difficulties: ['easy'],                  maxQuestions: 6,        pointFactor: 1.0 },
  10: { difficulties: ['easy','medium'],         maxQuestions: 10,       pointFactor: 1.0 },
  15: { difficulties: ['easy','medium'],         maxQuestions: 15,       pointFactor: 1.0 },
  30: { difficulties: ['easy','medium','hard'],  maxQuestions: 25,       pointFactor: 1.0 },
  90: { difficulties: ['easy','medium','hard'],  maxQuestions: Infinity, pointFactor: 1.0 }
};

export function getTimeConfig(minutes) {
  return TIME_CONFIG[minutes] || TIME_CONFIG[15];
}

// Mirrors test-engine.js calcGrade (Notenskala 1..6)
export function calcGrade(totalPoints, maxPoints) {
  const pct = maxPoints > 0 ? totalPoints / maxPoints : 0;
  if (pct >= 0.875) return { grade: 1, label: 'Sehr gut'     };
  if (pct >= 0.750) return { grade: 2, label: 'Gut'          };
  if (pct >= 0.625) return { grade: 3, label: 'Befriedigend' };
  if (pct >= 0.500) return { grade: 4, label: 'Ausreichend'  };
  if (pct >= 0.250) return { grade: 5, label: 'Mangelhaft'   };
  return              { grade: 6, label: 'Ungenuegend'        };
}

// Mirrors achievements.js calcXPForTest. Note 1 -> 108 (capped 100 client-side actually = 108)
// Originally: Math.max(10, (7 - grade) * 18). Note 1 -> 108, Note 6 -> 18 -> floored to 10.
export function calcXPForTest(grade) {
  return Math.max(10, (7 - grade) * 18);
}

// =============================================================
//  Per-question evaluation
// -------------------------------------------------------------
//  answer shape from client (Adrian's chosen contract):
//    {
//      questionIndex: 0,
//      selectedOriginalIndex: 2,   // for MC: index into ORIGINAL options array (client de-shuffled)
//      freeText: "...",            // for free_text / vocabulary
//      // For free_text/vocab the server TRUSTS the client-supplied
//      // {points,maxPoints} that the AI graders produced — but clamps
//      // to [0..maxPoints] (Cheat #7 variant C clamp).
//      reportedPoints: 4,
//      reportedMaxPoints: 8
//    }
// =============================================================

const _norm    = s => String(s || '').toLowerCase().replace(/[.,;:!?()[\]{}'"`]/g, ' ').replace(/\s+/g,' ').trim();
const _noSpace = s => s.replace(/\s/g, '');
const _nums    = s => s.match(/\d+[,.]?\d*/g) || [];

function _evaluateKeywords(question, answer, maxPoints) {
  if (!answer || answer.trim().length < 5) return { points: 0 };
  const na  = _norm(answer);
  const nns = _noSpace(na);
  const keywords = question.keywords || [];
  if (keywords.length === 0) {
    const words = answer.trim().split(/\s+/).length;
    return { points: Math.round(Math.min(words / 15, 1) * maxPoints * 0.6) };
  }
  let matched = 0;
  for (const kw of keywords) {
    const nk  = _norm(kw);
    const nks = _noSpace(nk);
    if (na.includes(nk))   { matched++; continue; }
    if (nns.includes(nks)) { matched++; continue; }
    const kNums = _nums(nk);
    if (kNums.length > 0 && kNums.every(n => na.includes(n))) { matched++; continue; }
  }
  const ratio      = matched / keywords.length;
  const wordBonus  = answer.trim().split(/\s+/).length >= 25 ? 0.1 : 0;
  const finalRatio = Math.min(ratio + wordBonus, 1);
  return { points: Math.round(finalRatio * maxPoints) };
}

function _lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

function _evaluateVocab(question, answer) {
  const maxPoints = question.points || 1;
  if (!answer || !answer.trim()) return { points: 0, maxPoints };
  const norm = s => s.toLowerCase().trim().replace(/\s+/g, ' ');
  const given    = norm(answer);
  const accepted = (question.answers || []).map(norm);
  const correct  = accepted.includes(given);
  const almost   = !correct && accepted.some(a => a.length > 3 && _lev(given, a) <= 1);
  return { points: (correct || almost) ? maxPoints : 0, maxPoints };
}

// =============================================================
//  Main entrypoint - mirrors test-engine.js evaluateAnswers
// -------------------------------------------------------------
//  questions  = array fetched from raw CDN (in original order)
//  answers    = array of {questionIndex, selectedOriginalIndex, freeText, reportedPoints, reportedMaxPoints}
//  timeMinutes = same as client
//  isPenalty  = boolean (tab-switch penalty -> total = 0, grade 6)
// =============================================================
export function evaluateServerSide(questions, answers, timeMinutes, isPenalty) {
  const cfg = getTimeConfig(timeMinutes);

  // Filter+limit to mirror selectQuestions: server gets ALL official questions,
  // but the test only ran on a subset. The client tells us via questionIndex
  // which original-order question each answer references.
  const results = [];
  for (const a of (answers || [])) {
    const qIdx = a.questionIndex;
    const q = questions[qIdx];
    if (!q) {
      // Client referenced an out-of-range question - ignore it (don't grant points).
      results.push({ points: 0, maxPoints: 0, questionIndex: qIdx, type: 'unknown' });
      continue;
    }

    if (q.type === 'multiple_choice') {
      const maxPts  = Math.round((q.points || 2) * cfg.pointFactor);
      const correct = Number.isInteger(a.selectedOriginalIndex)
                   && a.selectedOriginalIndex === q.correct;
      results.push({
        points:    correct ? maxPts : 0,
        maxPoints: maxPts,
        type:      'multiple_choice',
        questionIndex: qIdx
      });
    } else if (q.type === 'vocabulary') {
      const r = _evaluateVocab(q, a.freeText);
      results.push({ ...r, type: 'vocabulary', questionIndex: qIdx });
    } else {
      // free_text - server uses keyword-fallback as the AUTHORITATIVE grade
      // (the AI grading was client-trusted and hence forgeable - Cheat #7c).
      // Trade-off: legitimate users with no/weak keywords lose points server-side.
      // Adrian's call: keyword grade is the floor; we additionally accept the
      // client-reported AI grade if and only if it's <= maxPoints AND not
      // higher than 1.5x the keyword grade (so a faked "999" gets caught).
      const maxPts = Math.round((q.maxPoints || 4) * cfg.pointFactor);
      const kw     = _evaluateKeywords(q, a.freeText, maxPts);
      const reported = Number(a.reportedPoints || 0);
      const reportedClamped = Math.max(0, Math.min(reported, maxPts));
      // Anti-fake: cap reported to max(keywordGrade*1.5, keywordGrade+2)
      // - if keywords give 0 (no keywords), allow up to maxPts (legitimate
      //   free-text without keywords cannot be server-validated).
      const cap = (q.keywords && q.keywords.length > 0)
        ? Math.min(maxPts, Math.max(kw.points + 2, Math.ceil(kw.points * 1.5)))
        : maxPts;
      const accepted = Math.min(reportedClamped, cap);
      // Use the higher of (server-keyword-grade, capped-client-grade).
      const finalPoints = Math.max(kw.points, accepted);
      results.push({
        points:    finalPoints,
        maxPoints: maxPts,
        type:      'free_text',
        questionIndex: qIdx
      });
    }
  }

  const rawTotal = results.reduce((s, r) => s + (r.points || 0), 0);
  const max      = results.reduce((s, r) => s + (r.maxPoints || 0), 0);
  const total    = isPenalty ? 0 : rawTotal;
  const gradeInfo = isPenalty
    ? { grade: 6, label: 'Ungenuegend (Tab-Wechsel)' }
    : calcGrade(total, max);

  return {
    points:    total,
    maxPoints: max,
    grade:     gradeInfo.grade,
    label:     gradeInfo.label,
    perQuestion: results
  };
}
