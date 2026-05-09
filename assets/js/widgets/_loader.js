// ══════════════════════════════════════════
//  LearningForge — Widget-Loader
//  Public-API: mountWidget / mountAllWidgets / unmountAllIn
//  (siehe Spec 2026-05-09-widget-plugin-architecture.md)
// ══════════════════════════════════════════

import { WIDGET_REGISTRY, isKnownWidget } from './_registry.js';
import { lfWidgetRegisterThemeCb, lfWidgetUnregisterThemeCb } from './_base.js';

// ── Instance-Tracking ─────────────────────────────────────
// WeakMap statt Map, damit GC die Slot-Elemente einsammeln kann sobald
// ihr DOM-Subtree weggeschmissen wird (closeSubtopic → grid.innerHTML='').
// FU-5-Fix gegen die monoton wachsenden _LF_*_STATE-Maps in app.js.
const WIDGET_INSTANCES = new WeakMap(); // slotEl → instance
// Zweites Set hält starke Refs, damit visibilitychange-Listener iterieren
// kann (WeakMap ist nicht iterierbar). unmount entfernt aus beidem.
const _instanceSet = new Set();         // Set<instance>
// Cache pro Widget-Type, damit zweiter Mount kein Re-Fetch macht.
const _moduleCache = new Map();         // widgetType → Promise<Module>

// ── Module-Lazy-Import mit Cache ──────────────────────────
function _loadModule(widgetType) {
  if (_moduleCache.has(widgetType)) return _moduleCache.get(widgetType);
  const loader = WIDGET_REGISTRY[widgetType];
  if (!loader) {
    return Promise.reject(new Error('unknown widgetType: ' + widgetType));
  }
  const p = loader().catch(err => {
    // Bei Fehler: Cache invalidieren, damit Reload-Button funktionieren kann.
    _moduleCache.delete(widgetType);
    throw err;
  });
  _moduleCache.set(widgetType, p);
  return p;
}

// ── Slot → Widget-Mount ───────────────────────────────────
// Liest data-lf-widget + data-lf-config aus dem Slot, ruft Module.mount.
// Bei Erfolg: Instance in WeakMap registrieren, Slot ist gemounted.
// Bei Fehler: Error-Card in Slot rendern (Mayas Wireframe State 3).
export async function mountWidget(slot) {
  if (!slot || !(slot instanceof HTMLElement)) return null;
  // Idempotenz: schon gemounted? → skip.
  if (WIDGET_INSTANCES.has(slot)) return WIDGET_INSTANCES.get(slot);

  const widgetType = slot.getAttribute('data-lf-widget');
  if (!widgetType || !isKnownWidget(widgetType)) {
    // Pending-Block bleibt Job von renderBlock(); _loader rührt ihn nicht an.
    return null;
  }

  // Config aus data-Attribut JSON-parsen. Bei kaputtem JSON: leeres Config.
  let config = {};
  try {
    const raw = slot.getAttribute('data-lf-config') || '{}';
    config = JSON.parse(raw);
  } catch (e) {
    console.warn('[widget-loader] config parse failed for', widgetType, e);
    config = {};
  }

  try {
    const mod = await _loadModule(widgetType);
    // Konvention: jedes Widget exportiert default = { mount, ... } ODER
    // direkt eine mount-Funktion. Spec schreibt Module.mount(...) — wir
    // akzeptieren beide Formen, damit Ethan flexibel ist.
    const mountFn = (mod.default && typeof mod.default.mount === 'function')
      ? mod.default.mount
      : (typeof mod.mount === 'function' ? mod.mount : null);
    if (!mountFn) {
      throw new Error('widget module has no mount(): ' + widgetType);
    }
    const instance = await mountFn(slot, config);
    if (!instance || typeof instance.unmount !== 'function') {
      throw new Error('widget mount() returned invalid instance: ' + widgetType);
    }

    WIDGET_INSTANCES.set(slot, instance);
    _instanceSet.add(instance);

    // Theme-Hook registrieren, falls Widget einen onTheme()-Hook hat.
    if (typeof instance.onTheme === 'function') {
      const themeCb = () => {
        try { instance.onTheme(); } catch (e) { console.warn('[widget-onTheme]', e); }
      };
      // Cb-Ref am Instance hinterlegen, damit unmount sie unregistrieren kann.
      instance.__lfThemeCb = themeCb;
      lfWidgetRegisterThemeCb(themeCb);
    }

    // Skeleton entfernen (war nur Loading-Placeholder).
    const skel = slot.querySelector(':scope > .lf-widget-skeleton');
    if (skel) skel.remove();

    return instance;
  } catch (err) {
    console.error('[widget-loader] mount failed for', widgetType, err);
    _renderErrorCard(slot);
    return null;
  }
}

// ── Bulk-Mount für openSubtopic ───────────────────────────
// Sammelt alle [data-lf-widget]-Slots im Container, mountet parallel.
// Promise.allSettled: ein crashendes Widget killt nicht die anderen.
export function mountAllWidgets(container) {
  _ensureVisibilityListener();
  if (!container) return Promise.resolve([]);
  const slots = container.querySelectorAll('[data-lf-widget]');
  const tasks = [];
  slots.forEach(slot => tasks.push(mountWidget(slot)));
  return Promise.allSettled(tasks);
}

// ── Cleanup für closeSubtopic ─────────────────────────────
// Iteriert alle [data-lf-widget]-Slots im Container, ruft instance.unmount,
// räumt WeakMap-Eintrag + data-Attribut weg (Idempotenz: zweiter Aufruf
// findet keine Instance mehr und no-op't).
export function unmountAllIn(container) {
  if (!container) return;
  const slots = container.querySelectorAll('[data-lf-widget]');
  slots.forEach(slot => {
    const instance = WIDGET_INSTANCES.get(slot);
    if (!instance) return;
    try {
      // Theme-Cb unregistrieren falls registriert.
      if (instance.__lfThemeCb) {
        lfWidgetUnregisterThemeCb(instance.__lfThemeCb);
        instance.__lfThemeCb = null;
      }
      instance.unmount();
    } catch (e) {
      console.warn('[widget-unmount]', e);
    }
    WIDGET_INSTANCES.delete(slot);
    _instanceSet.delete(instance);
    // data-Attribut entfernen, damit ein erneutes mountAllWidgets diesen
    // Slot nicht doppelt aufgreift (er ist gleich weg, weil innerHTML='',
    // aber sicher ist sicher).
    slot.removeAttribute('data-lf-widget');
  });
}

// ── Visibility-Pause ──────────────────────────────────────
// EIN gemeinsamer Listener für die ganze App. Lazy initialisiert beim
// ersten mountAllWidgets-Call. Bei document.hidden → instance.pause()
// auf allen RAF-Widgets. Bei wieder visible → resume(). Widgets ohne
// pause/resume werden geskippt.
let _visibilityBound = false;
function _ensureVisibilityListener() {
  if (_visibilityBound) return;
  _visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    const hidden = document.hidden;
    _instanceSet.forEach(instance => {
      try {
        if (hidden && typeof instance.pause === 'function') instance.pause();
        else if (!hidden && typeof instance.resume === 'function') instance.resume();
      } catch (e) {
        console.warn('[widget-visibility]', e);
      }
    });
  });
}

// ── Error-Card ────────────────────────────────────────────
// Mayas Wireframe State 3. Strings aus Spec-Sektion "Copy".
function _renderErrorCard(slot) {
  // Slot leeren — Skeleton oder partial mount weg.
  slot.innerHTML = '';
  slot.setAttribute('aria-label', 'Konnte nicht laden');
  const card = document.createElement('div');
  card.className = 'lf-widget-error';
  card.setAttribute('role', 'alert');
  card.innerHTML =
    '<div class="lf-widget-error-icon" aria-hidden="true">&#9888;</div>' +
    '<div class="lf-widget-error-headline">Konnte nicht laden</div>' +
    '<div class="lf-widget-error-body">Pr&uuml;f deine Verbindung und versuch es nochmal.</div>' +
    '<button type="button" class="lf-widget-error-btn">Nochmal laden</button>';
  // onclick programmatisch — kein inline-onclick (window.LF-Konvention,
  // siehe CLAUDE.md): wir wollen keinen reload-Handler im LF-Namespace
  // pollen. location.reload() ist hier sauberer als ein LF-Eintrag,
  // weil das Widget-System self-contained ist.
  card.querySelector('.lf-widget-error-btn').addEventListener('click', () => {
    try { location.reload(); } catch (e) {}
  });
  slot.appendChild(card);
}
