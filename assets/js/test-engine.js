// ══════════════════════════════════════════
//  LearningForge — Test-Engine
// ══════════════════════════════════════════

import { CONFIG } from './config.js';
import * as cf      from './cf.js';

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
    pointFactor:     1.0,
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
    pointFactor:     1.0,
    label:           '30 Minuten — Ausführlicher Test'
  },
  90: {
    difficulties:    ['easy', 'medium', 'hard'],
    maxQuestions:    Infinity,
    textExpectation: 'Ausführliche Antwort mit Fachbegriffen, Beispielen und vollständigen Erklärungen erforderlich. Ein einzelner Satz ist nicht ausreichend für volle Punktzahl.',
    pointFactor:     1.0,
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
        // Mission 8: Markup statt Plain-Text — wird via innerHTML gerendert,
        // lfIcon-SVG nutzt currentColor und themed automatisch.
        feedback:  correct
          ? '<span class="sx-correct" style="font-weight:600">Richtig!</span>'
          : `Falsch. Richtige Antwort: „${q.shuffledOptions?.[q.shuffledCorrectIndex]}"`
      });
    } else {
      const maxPts = q.maxPoints || Math.round(4 * cfg.pointFactor);
      // Mission-12 (2026-05-08): direkte Groq+Gemini-Aufrufe raus,
      // jetzt durch Cloudflare Worker /aiCall (cf.js). Worker macht
      // intern Groq-zuerst-Gemini-Fallback. Bei Worker-Fail (503,
      // Auth, Netz) → keyword-Fallback wie bisher.
      const result = await evaluateWithAI(q, answer, maxPts, cfg.textExpectation);
      results.push({ ...result, maxPoints: maxPts });
    }
  }

  return results;
}

// ── KI-Auswertung via Worker-Proxy ──────
// Mission-12 (2026-05-08, Ethan): vorher zwei Funktionen
// (evaluateWithGroq + evaluateWithGemini) mit handgeschriebener
// Fallback-Chain. Beide Pfade benutzten direkt CONFIG.groq.apiKey
// bzw. CONFIG.gemini.apiKey — nach dem Key-Strip aus dem Frontend
// ergaben das silent fails. Jetzt EIN Aufruf gegen cf.aiCall, der
// Worker macht intern Groq→Gemini-Fallback. Auf Worker-Fehler
// (503 = beide Provider tot, Auth-Fail, Netz-Exception) graceful
// auf evaluateWithKeywords zurueckfallen.
async function evaluateWithAI(question, answer, maxPoints, textExpectation) {
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
    const result = await cf.aiCall({
      mode:        'chat',
      messages:    [{ role: 'user', content: prompt }],
      maxTokens:   200,
      temperature: 0.1
    });
    const raw = (result?.text || '').trim();
    if (!raw) {
      console.warn('[LF] aiCall leere Antwort — Keyword-Fallback');
      return evaluateWithKeywords(question, answer, maxPoints);
    }
    // Worker liefert text als string — Groq antwortet meist sauberes
    // JSON, Gemini wrapped manchmal in ```json fences; beide Pfade
    // hier robust handlen.
    const cleaned = raw.replace(/```(?:json)?\n?|\n?```/g, '').trim();
    const jsonStr = cleaned.startsWith('{') ? cleaned : cleaned.slice(cleaned.indexOf('{'));
    const parsed  = JSON.parse(jsonStr);
    return {
      points:   Math.min(Math.max(0, Math.round(parsed.points ?? 0)), maxPoints),
      feedback: parsed.feedback || 'Keine Rückmeldung verfügbar.'
    };
  } catch (err) {
    console.warn('[LF] aiCall Exception:', err?.message || err);
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
  // Mission-12 (2026-05-08, Ethan): Frontend hat keine Keys mehr —
  // Provider-Verfuegbarkeit checked der Worker. Wir versuchen den
  // Call und fangen 503/Auth/Netz-Errors als „keine Fragen" ab.
  if (!htmlContent) return [];

  const cfg        = TIME_CONFIG[timeMinutes] || TIME_CONFIG[15];
  const totalCount = cfg.maxQuestions === Infinity ? 20 : Math.min(cfg.maxQuestions, 20);

  const mcRatio   = timeMinutes <= 5 ? 1.0 : timeMinutes <= 10 ? 0.5 : 0.0;
  const mcCount   = Math.round(totalCount * mcRatio);
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

  // Mission-12 (2026-05-08, Ethan): vorher zwei separate Pfade
  // (Groq mit JSON-Objekt-Wrapper + Gemini mit reinem Array). Jetzt
  // EIN Prompt gegen den Worker; Worker macht intern Groq-zuerst-
  // Gemini-Fallback. Wir verlangen ein Array — beide Provider liefern
  // das (Groq via {"questions":[...]} oder direkt, Gemini direkt) —
  // der Parse unten ist robust gegen beides + ```json-Fences.
  // B5 (2026-05-08, Ramsey): MC-Längen-Balance-Regel — LLMs schreiben die
  // korrekte Antwort ausführlicher als die Distraktoren, was eine
  // „längste Antwort = richtig"-Heuristik mit ~85% Trefferquote ergibt.
  // Prompt-Hardening reduziert das (defense in depth zusammen mit dem
  // post-process Length-Balancer in _processGeneratedQuestions).
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
- WICHTIG: Bei Multiple-Choice-Fragen müssen ALLE 4 Optionen ungefähr gleich lang sein (max. 20% Längendifferenz in Wortanzahl). Die korrekte Antwort darf nicht durch Länge oder Detailgrad herausstechen — Distraktoren müssen genauso ausführlich und plausibel formuliert sein wie die richtige Antwort, nicht nur Stichworte.

Antworte AUSSCHLIESSLICH mit diesem JSON-Objekt, ohne weitere Zeichen:
{"questions": [
${exampleLines}
]}`;

  try {
    const result = await cf.aiCall({
      mode:        'chat',
      messages:    [{ role: 'user', content: prompt }],
      maxTokens:   2000,
      temperature: 0.7
    });
    const raw = (result?.text || '').trim();
    if (!raw) return [];
    // Strip optional ```json fences und parse — versuche erst Objekt
    // ({"questions":[...]}), dann blanken Array-Form.
    const cleaned = raw.replace(/```(?:json)?\n?|\n?```/g, '').trim();
    let arr = null;
    if (cleaned.startsWith('{')) {
      const obj = JSON.parse(cleaned.slice(cleaned.indexOf('{')));
      arr = obj.questions;
    } else if (cleaned.startsWith('[')) {
      arr = JSON.parse(cleaned.slice(cleaned.indexOf('[')));
    } else {
      // Mischfall: irgendwo im Text steckt das JSON — heuristisch suchen.
      const objStart = cleaned.indexOf('{');
      const arrStart = cleaned.indexOf('[');
      if (objStart >= 0 && (arrStart < 0 || objStart < arrStart)) {
        const obj = JSON.parse(cleaned.slice(objStart));
        arr = obj.questions;
      } else if (arrStart >= 0) {
        arr = JSON.parse(cleaned.slice(arrStart));
      }
    }
    if (Array.isArray(arr) && arr.length > 0) return _processGeneratedQuestions(arr, cfg);
  } catch (err) {
    console.warn('[LF] aiCall Fragen-Generierung fehlgeschlagen:', err?.message || err);
  }

  return [];
}

// B5 (2026-05-08): Length-Balancer für MC-Optionen — wenn die korrekte
// Antwort deutlich länger ist als die Distraktoren-Median-Länge, sanft
// kürzen. Das schließt das „längste = richtig"-Loophole für Gemini-/Groq-
// generierte Fragen. Manuell-handgeschriebene questions.json bleiben
// unangetastet (separater Linter-Job, Marcus).
//
// Heuristik: wenn correct.length > 1.4 * median(others), gracefully truncate
// auf 1.2 * median. „Graceful" = Schnitt am letzten Komma/Punkt/Klammer-Ende
// vor dem Limit. Wenn keine saubere Grenze vor 1.2× → Frage in Ruhe lassen
// (besser unbalanced als unverständlich).
function _truncateGracefully(text, maxLen) {
  if (typeof text !== 'string' || text.length <= maxLen) return text;
  // Suche letzten Satz-/Klausel-Endpunkt vor maxLen.
  // Reihenfolge der Vorzieher: Punkt > Fragezeichen > Ausrufezeichen > Komma > Klammer-Ende.
  const slice = text.slice(0, Math.floor(maxLen));
  const candidates = [
    slice.lastIndexOf('. '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf(') '),
    slice.lastIndexOf(', ')
  ].filter(i => i > maxLen * 0.5); // muss mindestens halbe Länge sein
  if (!candidates.length) return text; // keine saubere Schnittstelle → Original lassen
  const cut = Math.max(...candidates);
  // +1 wegen des Punkts/Kommas selbst, ohne Trailing-Space.
  return text.slice(0, cut + 1).trim();
}

function _balanceMCOptionLengths(options, correctIdx) {
  if (!Array.isArray(options) || options.length < 2 || correctIdx < 0 || correctIdx >= options.length) {
    return options;
  }
  const others = options.filter((_, i) => i !== correctIdx).map(o => String(o).length).sort((a,b) => a-b);
  if (!others.length) return options;
  const median = others[Math.floor(others.length / 2)];
  const correctLen = String(options[correctIdx]).length;
  if (correctLen <= median * 1.4) return options;
  const target = Math.max(median * 1.2, median + 12); // mindestens median+12 chars Toleranz
  const truncated = _truncateGracefully(String(options[correctIdx]), target);
  if (truncated === options[correctIdx]) return options; // truncate fehlgeschlagen → in Ruhe lassen
  const out = [...options];
  out[correctIdx] = truncated;
  return out;
}

function _processGeneratedQuestions(arr, cfg) {
  return arr.map((q, i) => {
    q.id = `gen_${Date.now()}_${i}`;
    if (q.type === 'multiple_choice' && Array.isArray(q.options)) {
      // B5: Length-Balancing VOR dem Shuffle — operiert auf q.correct (Original-Index).
      const balancedOpts = _balanceMCOptionLengths(q.options, q.correct);
      const pairs    = balancedOpts.map((opt, idx) => ({ opt, isCorrect: idx === q.correct }));
      const shuffled = shuffleArr(pairs);
      return {
        ...q,
        options:              balancedOpts,
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
}
