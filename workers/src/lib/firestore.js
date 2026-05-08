// =============================================================
//  LearningForge Worker - Firestore REST client
// -------------------------------------------------------------
//  Replaces the firebase-admin SDK (Node-only) with a tiny REST
//  client that talks to:
//    - oauth2.googleapis.com   (service-account JWT exchange)
//    - firestore.googleapis.com (REST v1 API)
//
//  Auth flow:
//    1. Sign a JWT with SA_PRIVATE_KEY (RS256) via crypto.subtle.
//    2. POST it to oauth2.googleapis.com/token, get back a 1h
//       access_token.
//    3. Cache the token in globalThis._fsTokens[scope] with a 50min
//       TTL (so we never serve a request with a token that will
//       expire mid-flight). Scope-keyed because deleteAccount mints
//       a separate `firebase`-scope token for Identity-Toolkit.
//
//  All writes use PATCH with updateMask (== merge:true) or the
//  :commit endpoint when transforms (serverTimestamp /
//  arrayUnion / increment) are needed.
// =============================================================

import { httpError } from './http.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FS_BASE   = 'https://firestore.googleapis.com/v1';

// =============================================================
//  Service-account JWT signing + token exchange
// =============================================================

// Strips PEM wrapper, base64-decodes the body, importKey as PKCS#8.
async function importSaPrivateKey(pemText) {
  if (!pemText) throw httpError(500, 'SA_PRIVATE_KEY nicht gesetzt.');
  // The wrangler secret may arrive with literal "\n" sequences if pasted
  // through a shell; normalise to real newlines either way.
  const normalized = pemText.replace(/\\n/g, '\n');
  const b64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g,   '')
    .replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function bytesToB64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToB64Url(str) {
  return bytesToB64Url(new TextEncoder().encode(str));
}

// Default scope = Firestore-Datastore. Cycle-3 (Marcus, 2026-05-08):
// scope is now a parameter so the deleteAccount endpoint can request a
// `firebase`-scope token to call Identity-Toolkit accounts:delete.
// Token cache is keyed per-scope (different scopes mint different tokens).
const SCOPE_DATASTORE = 'https://www.googleapis.com/auth/datastore';
const SCOPE_FIREBASE  = 'https://www.googleapis.com/auth/firebase';

async function buildSaJwt(env, scope = SCOPE_DATASTORE) {
  const clientEmail = env.SA_CLIENT_EMAIL;
  if (!clientEmail) throw httpError(500, 'SA_CLIENT_EMAIL nicht gesetzt.');

  const now = Math.floor(Date.now() / 1000);
  const header  = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss:   clientEmail,
    scope,
    aud:   TOKEN_URL,
    exp:   now + 3600,
    iat:   now
  };

  const key  = await importSaPrivateKey(env.SA_PRIVATE_KEY);
  const head = strToB64Url(JSON.stringify(header));
  const pay  = strToB64Url(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${head}.${pay}`);
  const sig  = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, data);
  return `${head}.${pay}.${bytesToB64Url(new Uint8Array(sig))}`;
}

export async function getAccessToken(env, scope = SCOPE_DATASTORE) {
  // Cache keyed by scope: globalThis._fsTokens[scope] = {accessToken, expiresAt}
  const cacheBag = globalThis._fsTokens || (globalThis._fsTokens = {});
  const cache = cacheBag[scope];
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.accessToken;

  const jwt = await buildSaJwt(env, scope);
  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt
    })
  });
  if (!res.ok) {
    // Do NOT log the JWT or response body verbatim - may contain
    // diagnostic key info. Use opaque message.
    throw httpError(503, `Service-Account-Login fehlgeschlagen (HTTP ${res.status}).`);
  }
  const json = await res.json();
  if (!json.access_token) throw httpError(503, 'Service-Account-Login: kein access_token.');

  cacheBag[scope] = {
    accessToken: json.access_token,
    // Cache for 50min even if Google says 60min - safety margin.
    expiresAt:   now + 50 * 60 * 1000
  };
  return json.access_token;
}

// =============================================================
//  deleteFirebaseAuthUser(env, uid)
// -------------------------------------------------------------
//  Cycle-3 Settings-Refactor (Marcus, 2026-05-08, Ramsey P0 #1):
//  hard-deletes the Firebase Auth account. Closes the Auth/Firestore-
//  Delete-Sequencing-Race where the frontend would Worker-delete the
//  Firestore docs first, THEN call firebase.auth().currentUser.delete()
//  — if the second step failed (network blip, expired ID-token after
//  the long-running Worker call), the user was left in a "Firestore-
//  gone, Auth-still-there" limbo state. They could log back in but
//  the app crashed (no user-doc) and they couldn't re-register the
//  same email (Auth account still claims it).
//
//  REST endpoint:
//    POST https://identitytoolkit.googleapis.com/v1/projects/{PID}/accounts:delete
//    Body: { localId: "<uid>" }
//    Auth: Bearer <SA-token-with-firebase-scope>
//
//  Idempotent: returns OK on 200 OR on 400 USER_NOT_FOUND (already
//  deleted on a prior call — same idempotency contract as the
//  Firestore-side "alreadyDeleted" branch in deleteAccount.js).
// =============================================================
const ITK_BASE = 'https://identitytoolkit.googleapis.com/v1';
export async function deleteFirebaseAuthUser(env, uid) {
  const token = await getAccessToken(env, SCOPE_FIREBASE);
  const url = `${ITK_BASE}/projects/${env.PROJECT_ID}/accounts:delete`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ localId: uid })
  });
  if (res.ok) return;
  // 400 with USER_NOT_FOUND in the body == already gone, idempotent OK.
  if (res.status === 400) {
    const txt = await res.text();
    if (txt.includes('USER_NOT_FOUND')) return;
    throw httpError(502, `Identity-Toolkit accounts:delete fehlgeschlagen (HTTP 400).`);
  }
  throw httpError(502, `Identity-Toolkit accounts:delete fehlgeschlagen (HTTP ${res.status}).`);
}

// =============================================================
//  Firestore typed-value marshalling
// =============================================================

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean')        return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') {
    // ISO-Z strings are kept as strings (not auto-converted to Timestamp).
    // The caller uses serverTimestamp() / explicit toFsTimestamp(...) when
    // they want a real Timestamp.
    return { stringValue: v };
  }
  if (v instanceof Date) {
    return { timestampValue: v.toISOString() };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFsValue) } };
  }
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFsValue(val);
    return { mapValue: { fields } };
  }
  // Fallback - stringify whatever it is.
  return { stringValue: String(v) };
}

export function fromFsValue(fv) {
  if (!fv || typeof fv !== 'object') return null;
  if ('nullValue'    in fv) return null;
  if ('booleanValue' in fv) return !!fv.booleanValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue'  in fv) return Number(fv.doubleValue);
  if ('stringValue'  in fv) return fv.stringValue;
  if ('timestampValue' in fv) return fv.timestampValue;  // ISO-Z string
  if ('bytesValue'    in fv) return fv.bytesValue;        // base64
  if ('referenceValue' in fv) return fv.referenceValue;
  if ('geoPointValue' in fv) return fv.geoPointValue;
  if ('arrayValue' in fv) {
    const vs = fv.arrayValue.values || [];
    return vs.map(fromFsValue);
  }
  if ('mapValue' in fv) {
    const out = {};
    const fs = fv.mapValue.fields || {};
    for (const [k, val] of Object.entries(fs)) out[k] = fromFsValue(val);
    return out;
  }
  return null;
}

export function toFsFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[k] = toFsValue(v);
  return out;
}

export function fromFsFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFsValue(v);
  return out;
}

// =============================================================
//  Transform sentinels
// -------------------------------------------------------------
//  Caller writes e.g. { xp: incrementValue(108) } in the `set`
//  arg of firestoreUpdate; the helper splits these out of the
//  PATCH body and emits them as updateTransforms in :commit.
// =============================================================

const _TRANSFORM = Symbol('fs.transform');

export function serverTimestamp() {
  return { [_TRANSFORM]: { setToServerValue: 'REQUEST_TIME' } };
}

export function incrementValue(delta) {
  // delta may be int or float; emit accordingly.
  const operand = Number.isInteger(delta)
    ? { integerValue: String(delta) }
    : { doubleValue: Number(delta) };
  return { [_TRANSFORM]: { increment: operand } };
}

export function arrayUnion(items) {
  const arr = Array.isArray(items) ? items : [items];
  return {
    [_TRANSFORM]: {
      appendMissingElements: { values: arr.map(toFsValue) }
    }
  };
}

export function arrayRemove(items) {
  const arr = Array.isArray(items) ? items : [items];
  return {
    [_TRANSFORM]: {
      removeAllFromArray: { values: arr.map(toFsValue) }
    }
  };
}

function isTransform(v) {
  return v && typeof v === 'object' && _TRANSFORM in v;
}

// =============================================================
//  Firestore REST endpoints
// =============================================================

function docPath(env, path) {
  return `${FS_BASE}/projects/${env.PROJECT_ID}/databases/(default)/documents/${path}`;
}

// GET document. Returns the parsed fields object (JS values), or null on 404.
export async function firestoreGet(env, path) {
  const token = await getAccessToken(env);
  const res = await fetch(docPath(env, path), {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw httpError(502, `Firestore GET ${path} fehlgeschlagen (HTTP ${res.status}).`);
  }
  const doc = await res.json();
  return {
    name:       doc.name,
    fields:     fromFsFields(doc.fields || {}),
    createTime: doc.createTime || null,
    updateTime: doc.updateTime || null
  };
}

// =============================================================
//  firestoreUpdate(path, set, opts?)
// -------------------------------------------------------------
//  Performs a "set with merge" - i.e. PATCH the named doc with
//  an updateMask scoped to exactly the keys in `set`. Plain
//  values go in the document body, transform-sentinels
//  (serverTimestamp / increment / arrayUnion / arrayRemove)
//  go into a :commit body alongside the PATCH-equivalent write.
//
//  Why :commit instead of plain PATCH?
//    - PATCH cannot apply transforms; the REST API only supports
//      transforms via the commit endpoint (which is a batched
//      Write list, of which one Write may be {update,
//      updateMask, updateTransforms}).
//    - Using :commit always (even for transform-less writes) is
//      uniform and lets us batch multiple writes (see
//      firestoreCommit below) when we need them.
//
//  When `set` has NO transforms, we use plain PATCH (cheaper +
//  one round-trip). When it HAS transforms, we build a single
//  Write entry and POST :commit.
// =============================================================
export async function firestoreUpdate(env, path, set) {
  const token = await getAccessToken(env);

  const plain = {};
  const transforms = [];
  for (const [k, v] of Object.entries(set || {})) {
    if (isTransform(v)) {
      transforms.push({ fieldPath: k, ...v[_TRANSFORM] });
    } else {
      plain[k] = v;
    }
  }

  // No transforms - plain PATCH with updateMask (= merge:true).
  if (transforms.length === 0) {
    const fieldPaths = Object.keys(plain);
    if (fieldPaths.length === 0) return;  // nothing to write
    const url = new URL(docPath(env, path));
    for (const fp of fieldPaths) url.searchParams.append('updateMask.fieldPaths', fp);
    const res = await fetch(url.toString(), {
      method:  'PATCH',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: toFsFields(plain) })
    });
    if (!res.ok) {
      throw httpError(502, `Firestore PATCH ${path} fehlgeschlagen (HTTP ${res.status}).`);
    }
    return;
  }

  // Has transforms - go via :commit with a single Write entry.
  const writes = [ buildWrite(env, path, plain, transforms) ];
  await firestoreCommit(env, writes);
}

// Build a single Write entry suitable for the :commit body.
// Plain fields go into the update body + updateMask; transforms get
// their own field on the Write.
function buildWrite(env, path, plain, transforms) {
  const fieldPaths = Object.keys(plain);
  const write = {
    update: {
      name:   `projects/${env.PROJECT_ID}/databases/(default)/documents/${path}`,
      fields: toFsFields(plain)
    },
    updateMask: { fieldPaths }
  };
  // updateTransforms is the FieldTransform[] - add them only if non-empty.
  // Per REST docs, the field paths listed in updateMask MUST cover the keys
  // in `update.fields`, but transform paths live separately and don't need
  // to be in the mask.
  if (transforms.length > 0) {
    write.updateTransforms = transforms;
  }
  return write;
}

// =============================================================
//  firestoreCommit(env, writes)
// -------------------------------------------------------------
//  Direct passthrough to :commit. Caller pre-builds Write entries
//  via buildWriteFor(...) (exported below for the multi-doc batch
//  case in submitTestResult). For simple single-doc writes use
//  firestoreUpdate; this is the escape hatch for batches.
// =============================================================
export async function firestoreCommit(env, writes) {
  if (!Array.isArray(writes) || writes.length === 0) return;
  const token = await getAccessToken(env);
  const url = `${FS_BASE}/projects/${env.PROJECT_ID}/databases/(default):commit`;
  const res = await fetch(url, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ writes })
  });
  if (!res.ok) {
    throw httpError(502, `Firestore :commit fehlgeschlagen (HTTP ${res.status}).`);
  }
  return await res.json();
}

// Public helper for callers building batched writes by hand.
// Same shape as firestoreUpdate's "set" arg: plain + transform sentinels.
// Returns a Write entry ready to feed into firestoreCommit.
export function buildWriteFor(env, path, set) {
  const plain = {};
  const transforms = [];
  for (const [k, v] of Object.entries(set || {})) {
    if (isTransform(v)) transforms.push({ fieldPath: k, ...v[_TRANSFORM] });
    else                plain[k] = v;
  }
  return buildWrite(env, path, plain, transforms);
}

// =============================================================
//  buildDeleteWriteFor(env, path)
// -------------------------------------------------------------
//  Cycle-3 (Marcus, 2026-05-08): hard-delete primitive for the
//  deleteAccount endpoint. The Firestore REST :commit Write
//  proto accepts `{ delete: '<full-resource-name>' }` as one of
//  the oneof variants (alongside `update` / `transform` /
//  `verify`). Returns a Write-entry ready for firestoreCommit.
//
//  Hard-rule-5 note: this primitive is a hard-delete by design.
//  The 5th hard rule forbids the "delete as reset" pattern (race
//  against concurrent reads). The deleteAccount endpoint is the
//  explicit "obliterate the account on user-request" use-case
//  where hard-delete is correct, NOT the forbidden reset-via-
//  delete pattern. New callers must justify their use of this
//  primitive in a code-comment near the call-site.
// =============================================================
export function buildDeleteWriteFor(env, path) {
  return {
    delete: `projects/${env.PROJECT_ID}/databases/(default)/documents/${path}`
  };
}

// Single-doc hard-delete convenience wrapper. Same Hard-rule-5
// caveat as buildDeleteWriteFor — only use this for explicit
// obliterate-the-doc flows, never as a reset-shortcut.
export async function firestoreDelete(env, path) {
  await firestoreCommit(env, [ buildDeleteWriteFor(env, path) ]);
}

// =============================================================
//  firestoreQuery(env, collection, opts)
// -------------------------------------------------------------
//  Minimal :runQuery wrapper for the rate-limit / count use-case
//  in submitTopicForApproval (V-PHASE-E-04). Supports:
//    - opts.where  : Array<[fieldPath, op, value]>
//                    op in 'EQUAL'|'==' (alias), 'NOT_EQUAL'|'!=',
//                    'LESS_THAN'|'<', 'LESS_THAN_OR_EQUAL'|'<=',
//                    'GREATER_THAN'|'>', 'GREATER_THAN_OR_EQUAL'|'>='
//    - opts.limit  : integer (default 100)
//
//  Multiple where-clauses are AND-composed (Firestore default).
//  Returns an array of { name, fields, createTime, updateTime }
//  rows with `fields` already converted to plain JS values.
//
//  For more complex query shapes (orderBy / startAt / cursor /
//  composite filters) extend this helper inline; we deliberately
//  keep the surface small until a second caller needs more.
// =============================================================
const _OP_ALIAS = {
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  '<':  'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>':  'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL'
};
export async function firestoreQuery(env, collection, opts = {}) {
  const token = await getAccessToken(env);
  const where = Array.isArray(opts.where) ? opts.where : [];
  const limit = Number.isInteger(opts.limit) ? opts.limit : 100;

  // Build the structuredQuery body. With a single where-clause we use
  // a fieldFilter; with N>=2 we wrap them in a compositeFilter (AND).
  const fieldFilters = where.map(([fieldPath, op, value]) => {
    const fsOp = _OP_ALIAS[op] || op;
    return {
      fieldFilter: {
        field: { fieldPath },
        op:    fsOp,
        value: toFsValue(value)
      }
    };
  });
  const structuredQuery = {
    from:  [{ collectionId: collection }],
    limit
  };
  if (fieldFilters.length === 1) {
    structuredQuery.where = fieldFilters[0];
  } else if (fieldFilters.length >= 2) {
    structuredQuery.where = {
      compositeFilter: {
        op:      'AND',
        filters: fieldFilters
      }
    };
  }

  // :runQuery is rooted at the parent of the collection; for a
  // top-level collection that's the (default) database root.
  const url = `${FS_BASE}/projects/${env.PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ structuredQuery })
  });
  if (!res.ok) {
    throw httpError(502, `Firestore :runQuery ${collection} fehlgeschlagen (HTTP ${res.status}).`);
  }
  // The response is a JSON array of { document: {name, fields, ...} }
  // wrappers. An empty result-set still returns a single object with
  // no `document` key (the readTime-only marker), filter that out.
  const arr = await res.json();
  const out = [];
  for (const row of arr) {
    if (!row || !row.document) continue;
    out.push({
      name:       row.document.name,
      fields:     fromFsFields(row.document.fields || {}),
      createTime: row.document.createTime || null,
      updateTime: row.document.updateTime || null
    });
  }
  return out;
}

// =============================================================
//  firestoreCreate(env, collection, set)
// -------------------------------------------------------------
//  Create-with-auto-ID for the feed collection (where each test
//  spawns a new doc). Implemented via :createDocument REST endpoint.
//  No transforms support here - feed entries use ISO-string
//  createdAt OR we build a proper Write via firestoreCommit.
// =============================================================
export async function firestoreCreate(env, collection, set) {
  // Use commit with a {update,...} Write where the document name is
  // auto-generated by Firestore. Auto-IDs in REST are NOT supported via
  // the simple PATCH path; the cleanest way is :commit with a name that
  // ends in a generated 20-char ID.
  const autoId = generateAutoId();
  const path = `${collection}/${autoId}`;
  const writes = [ buildWriteFor(env, path, set) ];
  await firestoreCommit(env, writes);
  return autoId;
}

// 20-char alphanumeric auto-ID (matches Firestore client SDK format).
function generateAutoId() {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const buf = new Uint8Array(20);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += ALPHA[buf[i] % ALPHA.length];
  return out;
}
