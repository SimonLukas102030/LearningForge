// =============================================================
//  LearningForge Worker - Firebase ID token verification
// -------------------------------------------------------------
//  Verifies Firebase Auth ID tokens (RS256 JWT) by:
//    1. Parsing header.kid
//    2. Fetching Google's public x509 cert set (cached ~1h via
//       caches.default + Cache-Control headers)
//    3. Importing the matching cert as a CryptoKey
//    4. crypto.subtle.verify on (header + '.' + payload)
//    5. Validating standard claims (iss/aud/exp/iat/sub)
//
//  No Node deps - pure Web Crypto / fetch / atob.
// =============================================================

import { httpError } from './http.js';

// Google's Firebase Auth ID-token cert endpoint (x509-PEM map).
const JWKS_URL_PEM =
  'https://www.googleapis.com/robotservices/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// In-memory cache (per isolate). Not strictly required since we also
// hit the edge cache, but spares us a round-trip on warm invocations.
let _certCache = { fetchedAt: 0, certs: null, maxAgeMs: 0 };

// -----------------------------------------------------------
//  Base64URL helpers (Web-Crypto safe)
// -----------------------------------------------------------
function b64urlToBytes(b64url) {
  // pad + URL-decode
  const pad = b64url.length % 4;
  const b64 = (b64url + '='.repeat(pad ? 4 - pad : 0))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToString(bytes) {
  return new TextDecoder().decode(bytes);
}

function parseJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw httpError(401, 'ID-Token: ungueltiges Format.');
  let header, payload;
  try {
    header  = JSON.parse(bytesToString(b64urlToBytes(parts[0])));
    payload = JSON.parse(bytesToString(b64urlToBytes(parts[1])));
  } catch {
    throw httpError(401, 'ID-Token: Header/Payload nicht parsebar.');
  }
  return { header, payload, signedDataB64: `${parts[0]}.${parts[1]}`, sigB64: parts[2] };
}

// -----------------------------------------------------------
//  Google x509 cert fetch + parse to CryptoKey
// -----------------------------------------------------------
async function fetchGoogleCerts() {
  const now = Date.now();
  if (_certCache.certs && (now - _certCache.fetchedAt) < _certCache.maxAgeMs) {
    return _certCache.certs;
  }

  // Try the edge cache first (caches.default is Cloudflare's per-zone cache).
  const cacheKey = new Request(JWKS_URL_PEM, { method: 'GET' });
  let res = await caches.default.match(cacheKey);
  if (!res) {
    res = await fetch(JWKS_URL_PEM, { cf: { cacheEverything: true, cacheTtl: 3600 } });
    if (!res.ok) throw httpError(503, 'Google JWKs unreachable.');
    // Clone with explicit Cache-Control so caches.default keeps it.
    const body = await res.clone().text();
    const cached = new Response(body, {
      status:  200,
      headers: {
        'Content-Type':  'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
    await caches.default.put(cacheKey, cached.clone());
    res = cached;
  }

  const certMap = await res.json();   // { kid: '-----BEGIN CERTIFICATE-----...' }
  const out = {};
  for (const [kid, pem] of Object.entries(certMap)) {
    out[kid] = await pemCertToPublicKey(pem);
  }
  _certCache = { fetchedAt: now, certs: out, maxAgeMs: 60 * 60 * 1000 };
  return out;
}

// Strips the PEM cert wrapper, base64-decodes the DER, then extracts the
// SubjectPublicKeyInfo (SPKI) bytes from the X.509 structure. Web Crypto's
// importKey accepts SPKI directly for RSA public keys.
async function pemCertToPublicKey(pem) {
  const b64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g,   '')
    .replace(/\s+/g, '');
  const der = b64ToBytes(b64);
  const spki = extractSpkiFromX509(der);
  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Minimal ASN.1 walker: X.509 Certificate is a SEQUENCE whose first element
// (tbsCertificate) is itself a SEQUENCE; inside tbsCertificate the SPKI is
// the field after version/serial/sigAlg/issuer/validity/subject. The SPKI
// itself is the 7th SEQUENCE child (index varies if v3 extensions appear
// later, but the SPKI is always the FIRST SEQUENCE following the subject).
//
// Practical shortcut: scan for the AlgorithmIdentifier OID for rsaEncryption
// (1.2.840.113549.1.1.1) and walk back to the enclosing SEQUENCE. That
// SEQUENCE is the SPKI.
function extractSpkiFromX509(der) {
  // OID rsaEncryption: 06 09 2A 86 48 86 F7 0D 01 01 01
  const RSA_OID = [0x06, 0x09, 0x2A, 0x86, 0x48, 0x86, 0xF7, 0x0D, 0x01, 0x01, 0x01];
  let oidPos = -1;
  outer: for (let i = 0; i < der.length - RSA_OID.length; i++) {
    for (let j = 0; j < RSA_OID.length; j++) {
      if (der[i + j] !== RSA_OID[j]) continue outer;
    }
    oidPos = i;
    break;
  }
  if (oidPos === -1) throw httpError(500, 'X.509 cert: rsaEncryption OID nicht gefunden.');

  // Walk backwards: find the SEQUENCE (0x30) whose declared length encloses
  // both the AlgorithmIdentifier SEQUENCE and the BIT STRING that follows.
  // The enclosing SPKI SEQUENCE starts a few bytes before oidPos.
  // Strategy: try positions from oidPos-1 backwards, parse a SEQUENCE there,
  // and check its length covers oidPos + the trailing BIT STRING.
  for (let i = oidPos - 1; i >= 0; i--) {
    if (der[i] !== 0x30) continue;
    const { length, headerLen } = readDerLength(der, i + 1);
    if (headerLen < 0) continue;
    const totalLen = 1 + headerLen + length;  // tag + length-bytes + content
    const end = i + totalLen;
    if (end <= der.length && oidPos < end && oidPos > i) {
      // Confirm this SEQUENCE is exactly the SPKI by checking that it
      // starts with another SEQUENCE (AlgorithmIdentifier) at i+1+headerLen.
      const inner = i + 1 + headerLen;
      if (der[inner] !== 0x30) continue;
      return der.slice(i, end);
    }
  }
  throw httpError(500, 'X.509 cert: SPKI-Sequenz nicht gefunden.');
}

// Reads a DER length prefix at offset `pos`. Returns {length, headerLen}
// where headerLen is the number of bytes consumed by the length field (1
// for short form, 2..5 for long form). On error returns {length:0, headerLen:-1}.
function readDerLength(buf, pos) {
  if (pos >= buf.length) return { length: 0, headerLen: -1 };
  const first = buf[pos];
  if (first < 0x80) return { length: first, headerLen: 1 };
  const n = first & 0x7F;
  if (n === 0 || n > 4 || pos + n >= buf.length) return { length: 0, headerLen: -1 };
  let len = 0;
  for (let i = 0; i < n; i++) len = (len << 8) | buf[pos + 1 + i];
  return { length: len, headerLen: 1 + n };
}

// -----------------------------------------------------------
//  Public API
// -----------------------------------------------------------
export async function verifyFirebaseIdToken(idToken, env) {
  if (!idToken || typeof idToken !== 'string') {
    throw httpError(401, 'ID-Token fehlt.');
  }

  const { header, payload, signedDataB64, sigB64 } = parseJwt(idToken);

  if (header.alg !== 'RS256') throw httpError(401, 'ID-Token: alg muss RS256 sein.');
  if (!header.kid)             throw httpError(401, 'ID-Token: kid fehlt.');

  const projectId = env.PROJECT_ID;
  if (!projectId) throw httpError(500, 'PROJECT_ID nicht konfiguriert.');

  const now = Math.floor(Date.now() / 1000);
  const skew = 30;  // seconds tolerance for clock drift

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw httpError(401, 'ID-Token: iss falsch.');
  }
  if (payload.aud !== projectId) {
    throw httpError(401, 'ID-Token: aud falsch.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= now) {
    throw httpError(401, 'ID-Token: abgelaufen.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > now + skew) {
    throw httpError(401, 'ID-Token: iat in der Zukunft.');
  }
  if (typeof payload.auth_time === 'number' && payload.auth_time > now + skew) {
    throw httpError(401, 'ID-Token: auth_time in der Zukunft.');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw httpError(401, 'ID-Token: sub fehlt.');
  }

  const certs = await fetchGoogleCerts();
  const key = certs[header.kid];
  if (!key) throw httpError(401, 'ID-Token: kid unbekannt.');

  const sig = b64urlToBytes(sigB64);
  const data = new TextEncoder().encode(signedDataB64);
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    sig,
    data
  );
  if (!ok) throw httpError(401, 'ID-Token: Signatur ungueltig.');

  return {
    uid:            payload.sub,
    email:          payload.email || null,
    email_verified: !!payload.email_verified,
    claims:         payload
  };
}

// Helper: extract Bearer token from a Request's Authorization header.
// Returns null if missing (caller decides whether that's an error).
export function extractBearer(request) {
  const h = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

// Convenience: verify the request's bearer or throw 401.
export async function requireAuth(request, env) {
  const token = extractBearer(request);
  if (!token) throw httpError(401, 'Authorization-Header fehlt.');
  return await verifyFirebaseIdToken(token, env);
}
