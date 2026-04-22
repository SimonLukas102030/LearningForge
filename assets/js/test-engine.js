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
    pointFactor:     1.0,
    label:           '5 Minuten — Schnelltest'
  },
  10: {
    difficulties:    ['easy', 'medium'],
    maxQuestions:    10,
    textExpectation: 'Ein bis zwei vollständige Sätze werden erwartet.',
    pointFactor:     1.5,
    label:           '10 Minuten — Kurz-Test'
  },
  15: {
    difficulties:    ['easy', 'medium'],
    maxQuestions:    15,
    textExpectation: 'Zwei bis drei Sätze mit kurzer Begründung.',
    pointFactor:     2.0,
    label:           '15 Minuten — Standard-Test'
  },
  30: {
    difficulties:    ['easy', 'medium', 'hard'],
    maxQuestions:    25,
    textExpectation: 'Mehrere Sätze mit Begründung und ggf. Beispielen.',
    pointFactor:     2.5,
    label:           '30 Minuten — Ausführlicher Test'
  },
  90: {
    difficulties:    ['easy', 'medium', 'hard'],
    maxQuestions:    Infinity,
    textExpectation: 'Ausführliche Antwort mit Fachbegriffen, Beispielen und vollständigen Erklärungen erforderlich. Ein einzelner Satz ist nicht ausreichend für volle Punktzahl.',
    pointFactor:     4.0,
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
      const pts = Math.round((q.points || 2) * cfg.pointFactor);
      return { ...q, ...shuffleOptions(q.options, q.correct), timeConfig: cfg, points: pts };
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
async function evaluateWithGemini(question, answer, maxPoints, textExpectation, attempt = 0) {
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
    const res  = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.gemini.apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );

    // Rate limit → wait and retry (up to 3×, 3s / 6s / 10s)
    if (res.status === 429 && attempt < 3) {
      const wait = [3000, 6000, 10000][attempt];
      console.warn(`[LF] Gemini 429 — warte ${wait/1000}s, Versuch ${attempt + 2}/4`);
      await new Promise(r => setTimeout(r, wait));
      return evaluateWithGemini(question, answer, maxPoints, textExpectation, attempt + 1);
    }

    const data = await res.json();

    if (!res.ok || data.error) {
      console.warn('[LF] Gemini Fehler:', res.status, data.error?.message);
      return evaluateWithKeywords(question, answer, maxPoints);
    }

    const raw     = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!raw) {
      console.warn('[LF] Gemini leere Antwort — Keyword-Fallback');
      return evaluateWithKeywords(question, answer, maxPoints);
    }
    const cleaned = raw.replace(/```(?:json)?\n?|\n?```/g, '').trim();
    const jsonStr = cleaned.startsWith('{') ? cleaned : cleaned.slice(cleaned.indexOf('{'));
    const parsed  = JSON.parse(jsonStr);
    return {
      points:   Math.min(Math.max(0, Math.round(parsed.points ?? 0)), maxPoints),
      feedback: parsed.feedback || 'Keine Rückmeldung verfügbar.'
    };
  } catch(err) {
    console.warn('[LF] Gemini Exception:', err);
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

// ── Vokabeltrainer ───────────────────────
export function selectVocabQuestions(allQuestions) {
  const vocab = allQuestions.filter(q => q.type === 'vocabulary');
  for (let i = vocab.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [vocab[i], vocab[j]] = [vocab[j], vocab[i]];
  }
  return vocab;
}

export function evaluateVocabAnswer(question, answer) {
  if (!answer || !answer.trim()) {
    return { correct: false, almost: false, points: 0, maxPoints: question.points || 1 };
  }
  const norm = s => s.toLowerCase().trim().replace(/\s+/g, ' ');
  const given    = norm(answer);
  const accepted = (question.answers || []).map(norm);
  const correct  = accepted.includes(given);
  const almost   = !correct && accepted.some(a => a.length > 3 && _lev(given, a) <= 1);
  return {
    correct: correct || almost,
    almost,
    points:    (correct || almost) ? (question.points || 1) : 0,
    maxPoints: question.points || 1
  };
}

function _lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[a.length][b.length];
}

// ── KI-Fragengenerierung ─────────────────
function shuffleArr(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function generateQuestionsWithGemini(htmlContent, timeMinutes) {
  if (!CONFIG.gemini.apiKey || !htmlContent) return [];

  const cfg        = TIME_CONFIG[timeMinutes] || TIME_CONFIG[15];
  const totalCount = cfg.maxQuestions === Infinity ? 20 : Math.min(cfg.maxQuestions, 20);

  const mcRatio  = timeMinutes <= 5 ? 1.0 : timeMinutes <= 10 ? 0.5 : 0.0;
  const mcCount  = Math.round(totalCount * mcRatio);
  const textCount = totalCount - mcCount;

  const content = htmlContent
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3500);

  const typeLines = [
    mcCount   > 0 ? `- ${mcCount} Multiple-Choice-Fragen (4 Optionen, genau eine richtig, "correct": Index 0–3, "points": 2)`   : '',
    textCount > 0 ? `- ${textCount} Freitext-Fragen ("maxPoints": 4–8 je nach Schwierigkeit, "sampleAnswer" pflegen)` : ''
  ].filter(Boolean).join('\n');

  const exampleLines = [
    mcCount   > 0 ? `  {"type":"multiple_choice","difficulty":"easy","question":"...","options":["...","...","...","..."],"correct":0,"points":2}` : '',
    textCount > 0 ? `  {"type":"free_text","difficulty":"medium","question":"...","maxPoints":4,"sampleAnswer":"..."}` : ''
  ].filter(Boolean).join(',\n');

  const prompt =
`Du bist ein Lehrer. Erstelle abwechslungsreiche Testfragen zum folgenden Lerninhalt.
Generiere jedes Mal andere Fragen — variiere Formulierungen, Zahlenwerte und Beispiele.

LERNINHALT:
${content}

ANFORDERUNGEN:
${typeLines}
- Schwierigkeiten: ${cfg.difficulties.map(d => `"${d}"`).join(', ')}
- Freitext-Erwartung: ${cfg.textExpectation}
- Sprache: Deutsch
- Bei Mathe/Physik: Zahlenwerte bei jeder Generierung leicht variieren

Antworte AUSSCHLIESSLICH mit diesem JSON-Array, ohne weitere Zeichen:
[
${exampleLines}
]`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.gemini.apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    const data    = await res.json();
    const raw     = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const cleaned = raw.replace(/```(?:json)?\n?|\n?```/g, '').trim();
    const jsonStr = cleaned.startsWith('[') ? cleaned : cleaned.slice(cleaned.indexOf('['));
    const arr     = JSON.parse(jsonStr);

    if (!Array.isArray(arr) || arr.length === 0) return [];

    return arr.map((q, i) => {
      q.id = `gen_${Date.now()}_${i}`;
      if (q.type === 'multiple_choice' && Array.isArray(q.options)) {
        const pairs    = q.options.map((opt, idx) => ({ opt, isCorrect: idx === q.correct }));
        const shuffled = shuffleArr(pairs);
        return {
          ...q,
          shuffledOptions:      shuffled.map(x => x.opt),
          shuffledCorrectIndex: shuffled.findIndex(x => x.isCorrect),
          timeConfig: cfg
        };
      }
      return {
        ...q,
        maxPoints:  Math.round((q.maxPoints || 4) * cfg.pointFactor),
        timeConfig: cfg
      };
    });
  } catch {
    return [];
  }
}
