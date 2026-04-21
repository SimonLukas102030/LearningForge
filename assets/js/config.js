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

  // ── Gemini KI (optional) ───────────────
  // Kostenloser API-Key: https://aistudio.google.com/app/apikey
  // Ohne Key: automatische Keyword-Auswertung als Fallback
  gemini: {
    apiKey: ''   // ← optional eintragen
  }

};
