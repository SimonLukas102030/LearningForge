// =============================================================
//  Endpoint - aiCall  (Mission 12)
// -------------------------------------------------------------
//  AI-Provider-Proxy. Replaces direct frontend calls to Groq /
//  Gemini so API-Keys live in CF-Worker-Secrets, not in the
//  public GitHub repo (which Push-Protection blocks anyway).
//
//  Frontend calls this with a Firebase ID-token; the Worker
//  forwards to Groq first, falls back to Gemini, and returns a
//  unified shape regardless of which provider answered.
//
//  Body shape:
//    {
//      mode:        'chat' | 'completion',
//      messages:    [{role, content}, ...]   // chat-mode only
//      prompt:      'single prompt string',  // completion-mode only
//      model:       <optional override>,
//      maxTokens:   <int, default 400, capped 2000>,
//      temperature: <0..2, default 0.7>
//    }
//
//  Response shape (always OpenAI-shape, even when Gemini answered):
//    { text: '...', provider: 'groq'|'gemini', model: '...' }
//
//  TODO Mission 13: per-user rate-limit (30 calls/h). Skipped for
//  now - CF-Worker isolate-local maps are not durable enough to
//  enforce reliably and we don't want to round-trip Firestore on
//  every AI call. Cost-cap is acceptable on free tiers for now.
// =============================================================

import { requireAuth }              from '../lib/auth.js';
import { readJsonBody, httpError }  from '../lib/http.js';

// Defaults mirror what app.js / test-engine.js currently send.
const GROQ_DEFAULT_MODEL   = 'llama-3.3-70b-versatile';
const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';
const GROQ_URL             = 'https://api.groq.com/openai/v1/chat/completions';

// Cap to prevent users requesting huge completions (cost / latency).
const MAX_TOKENS_HARD_CAP = 2000;

export async function handleAiCall(request, env) {
  // Auth: Firebase ID-token required (same as every other authed
  // endpoint). UID is not used downstream right now but is captured
  // for future rate-limiting (Mission 13) and abuse-tracing.
  await requireAuth(request, env);

  const body = await readJsonBody(request);
  const mode = body?.mode === 'completion' ? 'completion' : 'chat';

  // Build the message-list both providers will see (Groq native shape).
  let messages;
  if (mode === 'chat') {
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw httpError(400, 'mode=chat: messages[] muss nicht-leer sein.');
    }
    // Light validation - shape only, no content rewriting.
    for (const m of body.messages) {
      if (!m || typeof m.role !== 'string' || typeof m.content !== 'string') {
        throw httpError(400, 'messages[]: jedes Element braucht role+content (string).');
      }
    }
    messages = body.messages;
  } else {
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      throw httpError(400, 'mode=completion: prompt (string) erforderlich.');
    }
    messages = [{ role: 'user', content: body.prompt }];
  }

  const maxTokens = clampInt(body.maxTokens, 1, MAX_TOKENS_HARD_CAP, 400);
  const temperature = clampFloat(body.temperature, 0, 2, 0.7);

  // ---- Provider 1: Groq -------------------------------------------------
  if (env.GROQ_API_KEY) {
    const groqModel = typeof body.model === 'string' && body.model.startsWith('llama')
      ? body.model
      : GROQ_DEFAULT_MODEL;
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model:       groqModel,
          messages,
          max_tokens:  maxTokens,
          temperature
        })
      });
      const raw = await res.text().catch(() => '');
      if (!res.ok) {
        console.error('[aiCall] Groq HTTP', res.status, raw.slice(0, 300));
      } else {
        try {
          const data = JSON.parse(raw);
          const text = data?.choices?.[0]?.message?.content?.trim();
          if (text) return { text, provider: 'groq', model: groqModel };
          console.error('[aiCall] Groq empty/unexpected JSON shape:', raw.slice(0, 300));
        } catch (parseErr) {
          console.error('[aiCall] Groq non-JSON 200 body:', raw.slice(0, 300));
        }
      }
    } catch (err) {
      console.error('[aiCall] Groq network error:', err?.message || err);
    }
  } else {
    console.error('[aiCall] GROQ_API_KEY env missing');
  }

  // ---- Provider 2: Gemini ----------------------------------------------
  if (env.GEMINI_API_KEY) {
    const geminiModel = typeof body.model === 'string' && body.model.startsWith('gemini')
      ? body.model
      : GEMINI_DEFAULT_MODEL;
    try {
      // Gemini has no role-system; flatten chat to a single prompt the
      // same way app.js's callAIChat does, so behaviour is consistent.
      const flat = messages.map(m =>
          m.role === 'system' ? `[Anleitung] ${m.content}`
        : m.role === 'user'   ? `Schueler: ${m.content}`
        :                       `Tutor: ${m.content}`
      ).join('\n\n');

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
      const res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contents: [{ parts: [{ text: flat }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature
          }
        })
      });
      const raw = await res.text().catch(() => '');
      if (!res.ok) {
        console.error('[aiCall] Gemini HTTP', res.status, raw.slice(0, 300));
      } else {
        try {
          const data = JSON.parse(raw);
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (text) return { text, provider: 'gemini', model: geminiModel };
          console.error('[aiCall] Gemini empty/unexpected JSON shape:', raw.slice(0, 300));
        } catch (parseErr) {
          console.error('[aiCall] Gemini non-JSON 200 body:', raw.slice(0, 300));
        }
      }
    } catch (err) {
      console.error('[aiCall] Gemini network error:', err?.message || err);
    }
  } else {
    console.error('[aiCall] GEMINI_API_KEY env missing');
  }

  // Both providers down (or no keys configured).
  throw httpError(503, 'AI providers unavailable');
}

// ---- helpers ----------------------------------------------------------
function clampInt(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
function clampFloat(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
