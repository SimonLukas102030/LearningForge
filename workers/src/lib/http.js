// =============================================================
//  LearningForge Worker - HTTP helpers
// -------------------------------------------------------------
//  Shared response builders. All endpoints return strict JSON
//  (Hard rule 4 from the brief). CORS is set wide-open since
//  the Worker is callable from learning-forge.simonsstudios.de
//  and from the public parent-share page (unauth path).
// =============================================================

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age':       '86400'
};

export function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

export function cors(response) {
  // Build a new Response so we can extend headers safely (Response.headers
  // is mutable on a fresh instance but cheap to clone here).
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(response.body, {
    status:     response.status,
    statusText: response.statusText,
    headers
  });
}

export function errorResponse(status, msg) {
  return json(status, { success: false, error: String(msg || 'unknown error') });
}

// Reads + parses JSON body. Throws {status:400} on bad JSON.
export async function readJsonBody(request) {
  let raw;
  try { raw = await request.text(); }
  catch { throw { status: 400, message: 'Body konnte nicht gelesen werden.' }; }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw { status: 400, message: 'Ungueltiges JSON im Body.' }; }
}

// Throw-helper to produce a {status, message} object (caught by index.js).
export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
