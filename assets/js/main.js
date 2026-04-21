// ══════════════════════════════════════════
//  LearningForge — Einstiegspunkt
// ══════════════════════════════════════════

import { initTheme, startApp } from './app.js';
import { initFirebase }        from './auth.js';

// Theme sofort aus Cookie laden (verhindert Flackern)
initTheme();

// Firebase initialisieren
initFirebase();

// App starten (Auth-Listener + Routing)
startApp();
