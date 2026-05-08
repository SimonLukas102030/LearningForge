// ══════════════════════════════════════════
//  LearningForge — Konfiguration
//  Trage hier deine eigenen Werte ein.
// ══════════════════════════════════════════

export const CONFIG = {

  // ── GitHub ─────────────────────────────
  // Dein GitHub-Benutzername und Repository-Name
  github: {
    owner:  'SimonLukas102030',
    repo:   'LearningForge',
    branch: 'master'
  },

  // ── Firebase ───────────────────────────
  // Kopiere diese Werte aus deiner Firebase Console:
  // Project Settings → Your apps → Firebase SDK snippet → Config
  firebase: {
    apiKey: "AIzaSyCnKKCqpyffKqI8Env0BiJBwOy6MJBcAeY",
    authDomain: "learningforge-e995e.firebaseapp.com",
    projectId: "learningforge-e995e",
    storageBucket: "learningforge-e995e.firebasestorage.app",
    messagingSenderId: "174451084007",
    appId: "1:174451084007:web:9d00a9ffa304de4513f042",
    measurementId: "G-YDH9P8MXMW"
  },

  // ── Groq KI (Worker-Proxy) ──────────────
  // Mission-12 (2026-05-08): Key NICHT mehr im Frontend — liegt als
  // Wrangler-Secret GROQ_API_KEY im Cloudflare Worker. Frontend ruft
  // /aiCall via cf.aiCall() auf, Worker macht den Groq-Request.
  // Leerer String hier damit `CONFIG.groq?.apiKey`-Reads in Legacy-
  // Code (z.B. test-engine.js) nicht crashen — sie liefern dann
  // einfach falsy. Migration-Pfad: alle direct-fetch Stellen auf
  // cf.aiCall() umstellen, dann diese Felder ganz raus.
  groq: {
    apiKey: ''
  },

  // ── Gemini KI (Worker-Proxy) ────────────
  // Mission-12 (2026-05-08): Key NICHT mehr im Frontend — liegt als
  // Wrangler-Secret GEMINI_API_KEY im Cloudflare Worker (Fallback,
  // wenn Groq down ist). Siehe groq-Block oben.
  gemini: {
    apiKey: ''
  }

};
