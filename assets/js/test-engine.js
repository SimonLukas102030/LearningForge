// ══════════════════════════════════════════
//  LearningForge — Test-Engine
// ══════════════════════════════════════════

import { CONFIG } from './config.js';

// ── Zeitkonfiguration ───────────────────
export const TIME_OPTIONS = [5, 10, 15, 30, 90];

const TIME_CONFIG = {
  5:  {
    difficulties:    ['easy'],
    maxQuestions:    6,
    textExpectation: 'Ein kurzer Satz reicht für volle Punktzahl.',
    pointFactor:     0.5,
    label:           '5 Minuten — Schnelltest'
  },
  10: {
    difficulties:    ['easy', 'medium'],
    maxQuestions:    10,
    textExpectation: 'Ein bis zwei vollständige Sätze werden erwartet.',
    pointFactor:     0.75,
    label:           '10 Minuten — Kurz-Test'
  },
  15: {
    difficulties:    ['easy', 'medium'],
    maxQuestions:    15,
    textExpectation: 'Zwei bis drei Sätze mit kurzer Begründung.',
    pointFactor:     1.0,
    label:           '15 Minuten — Standard-Test'
  },
  30: {
    difficulties:    ['easy', 'medium', 'hard'],
    maxQuestions:    25,
    textExpectation: 'Mehrere Sätze mit Begründung und ggf. Beispielen.',
    pointFactor:     1.5,
    label:           '30 Minuten — Ausführlicher Test'
  },
  90: {
    difficulties:    ['easy', 'medium', 'hard'],
    maxQuestions:    Infinity,
    textExpectation: 'Ausführliche Antwort mit Fachbegriffen, Beispielen und vollständigen Erklärungen erforderlich. Ein einzelner Satz ist nicht ausreichend für volle Punktzahl.',
    pointFactor:     2.5,
    label:           '90 Minuten — Klassenarbeit-Simulation'
  }
};

// ── Fragen auswählen & mischen ──────────
export function selectQuestions(allQuestions, timeMinutes) {
  const cfg = TIME_CONFIG[timeMinutes] || TIME_CONFIG[15];
  const available = allQuestions.filter(q =>
    !q.difficulty || cfg.difficulties.includes(q.difficulty)
  );

  // Mischen (Fisher-Yates)
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const selected = shuffled.slice(0, Math.min(shuffled.length, cfg.maxQuestions));

  return selected.map(q => {
    if (q.type === 'multiple_choice' && q.options) {
      return { ...q, ...shuffleOptions(q.options, q.correct), timeConfig: cfg };
    }
    return {
      ...q,
      maxPoints: Math.round((q.maxPoints || 4) * cfg.pointFactor),
      timeConfig: cfg
    };
  });
}

function shuffleOptions(options, correctIndex) {
  const indexed = options.map((opt, i) => ({ opt, isCorrect: i === correctIndex }));
  for (let i = indexed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexed[i], indexed[j]] = [indexed[j], indexed[i]];
  }
  return {
    shuffledOptions:      indexed.map(x => x.opt),
    shuffledCorrectIndex: indexed.findIndex(x => x.isCorrect)
  };
}

// ── Antworten auswerten ─────────────────
export async function evaluateAnswers(questions, answers, timeMinutes) {
  const cfg = TIME_CONFIG[timeMinutes] || TIME_CONFIG[15];
  const results = [];

  for (let i = 0; i < questions.length; i++) {
    const q      = questions[i];
    const answer = answers[i];

    if (q.type === 'multiple_choice') {
      const correct = parseInt(answer) === q.shuffledCorrectIndex;
      results.push({
        points:    correct ? (q.points || 2) : 0,
        maxPoints: q.points || 2,
        correct,
        feedback:  correct
          ? 'Richtig! ✓'
          : `Falsch. Richtige Antwort: „${q.shuffledOptions?.[q.shuffledCorrectIndex]}"`
      });
    } else {
      const maxPts = q.maxPoints || Math.round(4 * cfg.pointFactor);
      let result;
      if (CONFIG.gemini.apiKey) {
        result = await evaluateWithGemini(q, answer, maxPts, cfg.textExpectation);
      } else {
        result = evaluateWithKeywords(q, answer, maxPts);
      }
      results.push({ ...result, maxPoints: maxPts });
    }
  }

  return results;
}

// ── Gemini KI-Auswertung ────────────────
async function evaluateWithGemini(question, answer, maxPoints, textExpectation) {
  const prompt =
`Du bist ein sachlicher Schullehrer. Bewerte diese Schülerantwort fair und objektiv.

FRAGE: ${question.question}
MAXIMALE PUNKTZAHL: ${maxPoints}
ANFORDERUNG: ${textExpectation}
${question.sampleAnswer ? `MUSTERANTWORT: ${question.sampleAnswer}` : ''}

SCHÜLERANTWORT: "${answer?.trim() || '(keine Antwort)'}"

Antworte AUSSCHLIESSLICH mit diesem JSON-Format, ohne weitere Zeichen:
{"points": <Zahl 0 bis ${maxPoints}>, "feedback": "<1-2 Sätze Feedback auf Deutsch>"}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${CONFIG.gemini.apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    const data    = await res.json();
    const raw     = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    return {
      points:   Math.min(Math.max(0, Math.round(parsed.points ?? 0)), maxPoints),
      feedback: parsed.feedback || 'Keine Rückmeldung verfügbar.'
    };
  } catch {
    return evaluateWithKeywords(question, answer, maxPoints);
  }
}

// ── Keyword-Fallback ─────────────────────
function evaluateWithKeywords(question, answer, maxPoints) {
  if (!answer || answer.trim().length < 5) {
    return { points: 0, feedback: 'Keine oder zu kurze Antwort.' };
  }

  const norm = s => s.toLowerCase()
    .replace(/[.,;:!?()[\]{}'"`´]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const noSpace = s => s.replace(/\s/g, '');
  const nums    = s => s.match(/\d+[,.]?\d*/g) || [];

  const na  = norm(answer);
  const nns = noSpace(na);

  const keywords = question.keywords || [];
  if (keywords.length === 0) {
    const words = answer.trim().split(/\s+/).length;
    return {
      points:   Math.round(Math.min(words / 15, 1) * maxPoints * 0.6),
      feedback: 'Automatische Auswertung — kein Gemini-Key. Tipp: Kopieren & in ChatGPT einfügen.'
    };
  }

  let matched = 0;
  for (const kw of keywords) {
    const nk  = norm(kw);
    const nks = noSpace(nk);
    // 1. Direkter Treffer
    if (na.includes(nk))   { matched++; continue; }
    // 2. Ohne Leerzeichen (z.B. "3 s" → "3s")
    if (nns.includes(nks)) { matched++; continue; }
    // 3. Nur Zahlen vergleichen (z.B. "45 m" → "45")
    const kNums = nums(nk);
    if (kNums.length > 0 && kNums.every(n => na.includes(n))) { matched++; continue; }
  }

  const ratio       = matched / keywords.length;
  const wordBonus   = answer.trim().split(/\s+/).length >= 25 ? 0.1 : 0;
  const finalRatio  = Math.min(ratio + wordBonus, 1);
  const pts         = Math.round(finalRatio * maxPoints);

  return {
    points:   pts,
    feedback: `${matched} von ${keywords.length} Schlüsselbegriffen erkannt.${ratio < 0.5 ? ' Füge Gemini-API-Key in config.js ein für genaue KI-Auswertung.' : ''}`
  };
}

// ── Note berechnen (Notenskala 1–6) ─────
export function calcGrade(totalPoints, maxPoints) {
  const pct = maxPoints > 0 ? totalPoints / maxPoints : 0;
  if (pct >= 0.875) return { grade: 1, label: 'Sehr gut',    color: '#10b981' };
  if (pct >= 0.750) return { grade: 2, label: 'Gut',         color: '#22d3ee' };
  if (pct >= 0.625) return { grade: 3, label: 'Befriedigend',color: '#f59e0b' };
  if (pct >= 0.500) return { grade: 4, label: 'Ausreichend', color: '#f97316' };
  if (pct >= 0.250) return { grade: 5, label: 'Mangelhaft',  color: '#ef4444' };
  return              { grade: 6, label: 'Ungenügend',        color: '#7f1d1d' };
}

// ── Kopier-Text generieren ───────────────
export function generateCopyText(questions, answers, results, timeUsedSeconds, meta) {
  const total = results.reduce((s, r) => s + (r.points || 0), 0);
  const max   = results.reduce((s, r) => s + (r.maxPoints || 0), 0);
  const { grade, label } = calcGrade(total, max);
  const mins = Math.floor(timeUsedSeconds / 60);
  const secs = timeUsedSeconds % 60;

  const lines = [
    `╔══════════════════════════════════════╗`,
    `║     LearningForge – Test-Ergebnis    ║`,
    `╚══════════════════════════════════════╝`,
    ``,
    `Fach:   ${meta.subjectName}`,
    `Thema:  ${meta.topicName}`,
    `Datum:  ${new Date().toLocaleDateString('de-DE')}`,
    `Note:   ${grade} – ${label}`,
    `Punkte: ${total} / ${max} (${Math.round(total/max*100)}%)`,
    `Zeit:   ${mins} min ${secs} s (von ${meta.timeMinutes} min)`,
    ``,
    `──────────────────────────────────────`,
  ];

  questions.forEach((q, i) => {
    const r      = results[i];
    const answerText = q.type === 'multiple_choice'
      ? (q.shuffledOptions?.[parseInt(answers[i])] || '(keine Wahl)')
      : (answers[i] || '(keine Antwort)');

    lines.push(``, `Aufgabe ${i + 1}  [${r.points}/${r.maxPoints} Punkte]`);
    lines.push(`Frage:    ${q.question}`);
    lines.push(`Antwort:  ${answerText}`);
    lines.push(`Feedback: ${r.feedback}`);
  });

  lines.push(``, `──────────────────────────────────────`);
  lines.push(`Erstellt mit LearningForge`);

  return lines.join('\n');
}

export function getTimeConfig(minutes) {
  return TIME_CONFIG[minutes] || TIME_CONFIG[15];
}
