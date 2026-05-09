// ══════════════════════════════════════════
//  LearningForge — Widget-Registry
//  Single Source of Truth: widgetType → Lazy-Loader-Modul
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md, "Plugin-Registry")
// ══════════════════════════════════════════

// Cache-Bust-Version. Jake bumpt zentral, sobald ein Widget-File geändert
// wurde. ESM-Imports mit ?v=… ergeben separate Module-Instanzen pro URL —
// gewollt: bei Bump werden alle Widgets neu geladen (gleiches Verhalten
// wie ?v= an main.js in index.html).
//
// Format: 'YYYYMMDDx' analog zur index.html-?v=-Konvention.
export const WIDGET_VERSION = '1';

// Statische Module-Map. Pfade sind hardgecodete Strings (kein
// Konkat-Konstruieren), damit der Browser-Module-Resolver vorab weiß,
// was es gibt — wichtig für SW-Precache (Marcus erweitert PRECACHE_URLS
// in einem späteren Commit).
//
// TODO: Files in <name>.js werden in Commits 4-10 erstellt. Bis dahin
// schlägt Lazy-Import fehl mit klar-erkennbarem Error — _loader.js
// fängt das ab und zeigt die Error-Card aus Mayas Wireframe State 3.
export const WIDGET_REGISTRY = {
  'predict-reveal': () => import('./predict-reveal.js?v=' + WIDGET_VERSION),
  'drag-sort':      () => import('./drag-sort.js?v=' + WIDGET_VERSION),
  'drag-match':     () => import('./drag-match.js?v=' + WIDGET_VERSION),
  'number-slider':  () => import('./number-slider.js?v=' + WIDGET_VERSION),
  'hot-spot':       () => import('./hot-spot.js?v=' + WIDGET_VERSION),
  'fill-blanks':    () => import('./fill-blanks.js?v=' + WIDGET_VERSION),
  'physics-throw':  () => import('./physics-throw.js?v=' + WIDGET_VERSION),
  'force-arrow-anim': () => import('./force-arrow-anim.js?v=' + WIDGET_VERSION),
  'function-plotter': () => import('./function-plotter.js?v=' + WIDGET_VERSION),
  'wave-superposition': () => import('./wave-superposition.js?v=' + WIDGET_VERSION),
  'pendulum-sim':     () => import('./pendulum-sim.js?v=' + WIDGET_VERSION),
  'timeline-drop':    () => import('./timeline-drop.js?v=' + WIDGET_VERSION),
  'process-flow-anim': () => import('./process-flow-anim.js?v=' + WIDGET_VERSION),
  'phase-stepper':    () => import('./phase-stepper.js?v=' + WIDGET_VERSION),
  'ph-titration':     () => import('./ph-titration.js?v=' + WIDGET_VERSION),
  'stoichiometry-balancer': () => import('./stoichiometry-balancer.js?v=' + WIDGET_VERSION),
  'tangent-visualizer': () => import('./tangent-visualizer.js?v=' + WIDGET_VERSION),
  'unit-circle-sync': () => import('./unit-circle-sync.js?v=' + WIDGET_VERSION),
  'vector-arrow':     () => import('./vector-arrow.js?v=' + WIDGET_VERSION),
};

// Whitelist-Funktion: der Registry-Schlüsselsatz IST die Whitelist.
// Kein zweites _LF_WIDGET_WHITELIST-Set mehr (wird in Commit 11 aus
// app.js gelöscht).
export function isKnownWidget(widgetType) {
  return Object.prototype.hasOwnProperty.call(WIDGET_REGISTRY, widgetType);
}
