// ══════════════════════════════════════════
//  LearningForge — Konfiguration
//  Trage hier deine eigenen Werte ein.
// ══════════════════════════════════════════

export const CONFIG = {

  // ── GitHub ─────────────────────────────
  // Dein GitHub-Benutzername und Repository-Name
  github: {
    owner:  'DEIN_GITHUB_USERNAME',   // ← ändern
    repo:   'LearningForge',
    branch: 'main'
  },

  // ── Firebase ───────────────────────────
  // Kopiere diese Werte aus deiner Firebase Console:
  // Project Settings → Your apps → Firebase SDK snippet → Config
  firebase: {
    apiKey:            'DEIN_API_KEY',
    authDomain:        'DEIN_PROJEKT.firebaseapp.com',
    projectId:         'DEIN_PROJEKT_ID',
    storageBucket:     'DEIN_PROJEKT.appspot.com',
    messagingSenderId: 'DEINE_SENDER_ID',
    appId:             'DEINE_APP_ID'
  },

  // ── Gemini KI (optional) ───────────────
  // Kostenloser API-Key: https://aistudio.google.com/app/apikey
  // Ohne Key: automatische Keyword-Auswertung als Fallback
  gemini: {
    apiKey: ''   // ← optional eintragen
  }

};
