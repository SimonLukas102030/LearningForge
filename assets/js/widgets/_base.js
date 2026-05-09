// ══════════════════════════════════════════
//  LearningForge — Widget-Plugin-Basis
//  Shared Helpers für alle Widget-Module
//  (siehe .claude/company/specs/2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════

// ── Theme-Helper ──────────────────────────────────────────
// Liest eine CSS-Variable von :root. Canvas-Widgets rufen das pro Frame —
// getComputedStyle auf documentElement ist read-only auf Custom-Props,
// löst kein Layout-Thrashing aus (Spec R-2).
//
// Hinweis: nicht 1:1 identisch mit physik-sim.js theme() — dort wird
// '--sim-' prefixed. Hier nimmt der Caller den vollen Var-Namen ohne
// führendes '--'. physik-sim.js wird in Commit 10 migriert.
export function lfWidgetTheme(varName) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue('--' + varName).trim();
  return v || '#888';
}

// ── Reduce-Motion ─────────────────────────────────────────
// Pattern im Widget:
//   if (lfWidgetReducedMotion()) { /* End-State zeichnen */ }
//   else { /* RAF-Loop */ }
export function lfWidgetReducedMotion() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

// ── Slot-Stub-Generator ───────────────────────────────────
// Erzeugt das Skeleton-DOM, das renderBlock() für type:"widget" einsetzt.
// Mount läuft async im Hintergrund — erst Skeleton, dann Widget.
//
// JSON-Config wird mit escapeAttr in das data-Attribut eingebettet, damit
// Anführungszeichen (", ') das HTML-Attribut nicht brechen.
export function lfWidgetSlot(widgetType, config) {
  const cfgJson = JSON.stringify(config == null ? {} : config);
  return (
    '<div class="lf-widget-slot" ' +
      'data-lf-widget="' + escapeAttr(widgetType) + '" ' +
      'data-lf-config="' + escapeAttr(cfgJson) + '" ' +
      'aria-label="Aufgabe wird geladen" ' +
      'role="region">' +
      '<div class="lf-widget-skeleton" aria-hidden="true">' +
        '<div class="lf-widget-skeleton-bar"></div>' +
        '<div class="lf-widget-skeleton-bar"></div>' +
        '<div class="lf-widget-skeleton-bar"></div>' +
      '</div>' +
    '</div>'
  );
}

// HTML-Attribut-Escape (& " ' < >). Pflicht für Slot-Generation, weil
// Config-JSON enthält " und kann von Müller mit < > beliefert werden.
function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Theme-MutationObserver ────────────────────────────────
// Genau EIN Observer für die ganze App (gemeinsam für alle Widgets).
// Lazy initialisiert beim ersten Register-Call. Beobachtet body.class
// (Theme-Toggle setzt body.className) PLUS documentElement[data-theme]
// und [data-app-theme] für Cosmetics-Themes.
//
// Bei Mutation: alle registrierten Callbacks feuern. _loader.js registriert
// pro Widget-Instance einen Callback, der instance.onTheme?() ruft.

const _themeCallbacks = new Set();
let _themeObserver = null;

function _ensureThemeObserver() {
  if (_themeObserver) return;
  _themeObserver = new MutationObserver(() => {
    // Alle Callbacks abfeuern. try/catch pro Callback, damit ein
    // crashendes Widget die anderen nicht killt.
    _themeCallbacks.forEach(cb => {
      try { cb(); } catch (e) { console.warn('[widget-theme]', e); }
    });
  });
  // body — Theme-Toggle setzt body.className (light/dark/aurora etc.)
  _themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-app-theme'],
  });
  // documentElement — manche Cosmetics setzen [data-theme] auf <html>
  _themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-app-theme'],
  });
}

export function lfWidgetRegisterThemeCb(cb) {
  if (typeof cb !== 'function') return;
  _ensureThemeObserver();
  _themeCallbacks.add(cb);
}

export function lfWidgetUnregisterThemeCb(cb) {
  _themeCallbacks.delete(cb);
}
