// ══════════════════════════════════════════
//  LearningForge — Service Worker (F-11)
// ══════════════════════════════════════════

const CACHE_NAME = 'lf-v38';

// Minimales App-Shell-Precache
const PRECACHE_URLS = ['/', '/index.html', '/manifest.json'];

// Hosts die nie gecacht werden (Firebase, CDNs).
// WICHTIG: googleapis.com pauschal — Firestore-Listen-Channel läuft über
// firestore.googleapis.com und sendet Long-Poll-Streams als GET-Requests.
// Cachen davon korrumpiert den Stream-State → "INTERNAL ASSERTION FAILED".
// Wave-1-Ramsey H-M11: Cloudflare-Worker auch pauschal skippen — POST/GETs
// sind state-mutating (Cosmetic-Unlocks, Test-Account-Marks); Caching wuerde
// stale Antworten ausliefern oder veraltete Auth-Header replayen.
const SKIP_HOSTS = [
  'firebaseio.com', 'googleapis.com',
  'gstatic.com', 'cdnjs.cloudflare.com',
  'fonts.gstatic.com',
  'learning-forge-api.simonkoper27.workers.dev'
];

// ── Install: App-Shell cachen ──────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: alte Caches löschen ─────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: Routing-Strategie ───────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Firebase & CDN — kein Caching, direkt durchleiten
  if (SKIP_HOSTS.some(h => url.hostname.includes(h))) return;

  // GitHub raw (meta.json, questions.json) & API — Network-First mit Cache-Fallback
  if (url.hostname === 'raw.githubusercontent.com' || url.hostname === 'api.github.com') {
    e.respondWith(networkFirst(req));
    return;
  }

  // App-Shell (JS, CSS, HTML, Icons) — Cache-First mit Network-Fallback
  e.respondWith(cacheFirst(req));
});

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || new Response(JSON.stringify({ _offline: true }), {
      headers: { 'Content-Type': 'application/json' }, status: 503
    });
  }
}

async function cacheFirst(req) {
  // Exact-Match: ?v=… Querystring MUSS unterscheiden, sonst liefert lf-v13
  // den alten main.js?v=…c aus dem geerbten Cache obwohl index.html schon
  // ?v=…e anfordert. ignoreSearch nur fuer Navigations-Fallback (s.u.).
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok && res.type !== 'opaque') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    // Navigation-Request → App-Shell ausliefern (hier ignoreSearch ok,
    // weil die Shell selbst keine Versionierung im Querystring hat).
    if (req.mode === 'navigate') {
      const shell = await caches.match('/index.html', { ignoreSearch: true });
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503 });
  }
}
