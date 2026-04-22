// ══════════════════════════════════════════
//  LearningForge — Einstiegspunkt
// ══════════════════════════════════════════

import { initTheme, startApp } from './app.js';
import { initFirebase }        from './auth.js';

// Theme sofort aus Cookie laden (verhindert Flackern)
initTheme();

// Firebase initialisieren
initFirebase();

// Service Worker registrieren (F-11)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(err =>
    console.warn('[SW] Registrierung fehlgeschlagen:', err)
  );
}

// App starten (Auth-Listener + Routing)
startApp();
