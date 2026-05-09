// ══════════════════════════════════════════
//  LearningForge — Widget: map-layer-toggle
//  Welle 4.1 — SVG-Karte mit Layer-Toggles
//  (Plan Z.205 — Geo/Englisch)
// ══════════════════════════════════════════
//
// Schematische SVG-Karte (6-8 Polygone) mit klickbaren Regionen.
// Toggle-Buttons wechseln das aktive Thema-Layer (Klima / BIP /
// Bevölkerungsdichte / etc.). Regionclick → Popup mit Wert aus
// aktivem Layer. Legende unten.
//
// Config-Schema:
//   label       — Karte-Titel (HTML-string, entity-encoded)
//   regions[]   — { id, label, path }   path = SVG-path-d-String
//   layers[]    — { id, label, regionData: { [regionId]: { value, color } } }
//   defaultLayer — id des Start-Layers
//
// Hard-Rule #3: label-Strings aus Config gehen via innerHTML (author-encoded).
// User-supplied Werte (value) in regionData gehen via innerHTML (author-encoded).
// Nur Attribut-Werte (id, href, src) via _escapeAttr.
//
// A11y: SVG-Regionen als role=button + tabindex=0. Enter/Space löst Click aus.
//        Layer-Toggle-Buttons sind native <button>.
//
// State: { activeLayerId (string), selectedRegionId (string|null) }
// pause/resume: no-ops.

import { lfWidgetReducedMotion, lfWidgetRegisterThemeCb, lfWidgetUnregisterThemeCb } from './_base.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let _SLOT_SEQ = 0;
function _nextSlotId() {
  _SLOT_SEQ += 1;
  return 'lf-ml-' + Date.now().toString(36) + '-' + _SLOT_SEQ;
}

function _escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Config-Normalisierung ─────────────────────────────────
function _normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const regions = Array.isArray(raw.regions) ? raw.regions : [];
  const layers  = Array.isArray(raw.layers)  ? raw.layers  : [];
  if (regions.length < 1 || layers.length < 1) return null;

  // Validate + normalize regions
  const normRegions = [];
  const regionIds = new Set();
  for (const r of regions) {
    if (!r || typeof r !== 'object') continue;
    const id    = typeof r.id    === 'string' ? r.id.trim()    : '';
    const label = typeof r.label === 'string' ? r.label        : id;
    const path  = typeof r.path  === 'string' ? r.path.trim()  : '';
    if (!id || regionIds.has(id) || !path) continue;
    regionIds.add(id);
    normRegions.push({ id, label, path });
  }
  if (normRegions.length < 1) return null;

  // Validate + normalize layers
  const normLayers = [];
  const layerIds = new Set();
  for (const l of layers) {
    if (!l || typeof l !== 'object') continue;
    const id    = typeof l.id    === 'string' ? l.id.trim() : '';
    const label = typeof l.label === 'string' ? l.label     : id;
    const rdata = (l.regionData && typeof l.regionData === 'object') ? l.regionData : {};
    if (!id || layerIds.has(id)) continue;
    layerIds.add(id);
    normLayers.push({ id, label, regionData: rdata });
  }
  if (normLayers.length < 1) return null;

  const defaultLayer =
    (typeof raw.defaultLayer === 'string' && layerIds.has(raw.defaultLayer))
      ? raw.defaultLayer
      : normLayers[0].id;

  const mapLabel = typeof raw.label === 'string' ? raw.label : '';

  return { label: mapLabel, regions: normRegions, layers: normLayers, defaultLayer };
}

// ── Layer-Lookup-Helper ───────────────────────────────────
function _findLayer(layers, id) {
  for (const l of layers) { if (l.id === id) return l; }
  return layers[0];
}

// ── SVG aufbauen (DOM-API, kein innerHTML für SVG) ────────
function _buildSvg(norm, slotId) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 300');
  svg.setAttribute('class', 'lf-ml-svg');
  svg.setAttribute('role', 'presentation');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('id', slotId + '-svg');

  // Region-Paths
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'lf-ml-regions');
  for (const r of norm.regions) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', r.path);
    path.setAttribute('class', 'lf-ml-region');
    path.setAttribute('data-ml-id', r.id);
    path.setAttribute('data-ml-slot', slotId);
    path.setAttribute('role', 'button');
    path.setAttribute('tabindex', '0');
    path.setAttribute('aria-label', r.label + ' auswählen');
    path.setAttribute('aria-pressed', 'false');
    // stroke via CSS var, fill set in applyLayer
    path.setAttribute('fill', 'var(--lf-ml-region)');
    path.setAttribute('stroke', 'var(--lf-ml-border)');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    path.style.cursor = 'pointer';
    g.appendChild(path);
  }
  svg.appendChild(g);

  return svg;
}

// ── HTML-Skeleton (Layer-Buttons + SVG-Container + Popup + Legende) ──
function _renderHtml(norm, slotId) {
  const titleHtml = norm.label
    ? '<h4 class="lf-ml-title">' + norm.label + '</h4>'
    : '';

  const layerBtns = norm.layers.map(l =>
    '<button type="button" class="lf-ml-layer-btn" '
    + 'data-ml-action="set-layer" data-ml-layer="' + _escapeAttr(l.id) + '" '
    + 'data-ml-slot="' + _escapeAttr(slotId) + '" '
    + 'aria-pressed="false">'
    + l.label
    + '</button>'
  ).join('');

  return (
    '<div class="lf-widget-map-layer-toggle" id="' + _escapeAttr(slotId) + '">'
    + titleHtml
    + '<div class="lf-ml-layer-bar" role="group" aria-label="Layer auswählen">'
    +   layerBtns
    + '</div>'
    + '<div class="lf-ml-map-wrap">'
    +   '<!-- SVG injected via DOM API -->'
    + '</div>'
    + '<div class="lf-ml-popup" id="' + _escapeAttr(slotId) + '-popup" hidden '
    +   'role="status" aria-live="polite">'
    +   '<div class="lf-ml-popup-inner">'
    +     '<span class="lf-ml-popup-region" id="' + _escapeAttr(slotId) + '-popup-region"></span>'
    +     '<span class="lf-ml-popup-layer" id="' + _escapeAttr(slotId) + '-popup-layer"></span>'
    +     '<span class="lf-ml-popup-value" id="' + _escapeAttr(slotId) + '-popup-value"></span>'
    +     '<button type="button" class="lf-ml-popup-close" '
    +       'data-ml-action="close-popup" data-ml-slot="' + _escapeAttr(slotId) + '" '
    +       'aria-label="Popup schließen">&times;</button>'
    +   '</div>'
    + '</div>'
    + '<div class="lf-ml-legend" id="' + _escapeAttr(slotId) + '-legend" aria-label="Legende"></div>'
    + '</div>'
  );
}

// ── mount() ──────────────────────────────────────────────
function mount(container, config) {
  if (!container || !(container instanceof HTMLElement)) return _emptyInstance();

  const norm = _normalizeConfig(config);
  const slotId = _nextSlotId();

  if (!norm) {
    container.innerHTML =
      '<div class="lf-widget-map-layer-toggle lf-ml-empty">'
      + 'Diese Karte ist noch nicht konfiguriert.</div>';
    return _emptyInstance();
  }

  const state = {
    activeLayerId:    norm.defaultLayer,
    selectedRegionId: null
  };
  let unmounted = false;

  // Render HTML skeleton
  container.innerHTML = _renderHtml(norm, slotId);
  const root = container.querySelector('#' + CSS.escape(slotId));

  // Inject SVG via DOM API (so attributes like filter-id are safe)
  const mapWrap = root.querySelector('.lf-ml-map-wrap');
  const svgEl   = _buildSvg(norm, slotId);
  mapWrap.innerHTML = '';
  mapWrap.appendChild(svgEl);

  // Reduce-Motion
  const reducedMotion = lfWidgetReducedMotion();
  if (reducedMotion) root.classList.add('lf-ml-reduced-motion');

  // ── applyLayer: Regionen einfärben + Buttons + Legende ──
  function applyLayer() {
    if (unmounted || !root) return;
    const layer = _findLayer(norm.layers, state.activeLayerId);

    // Layer-Buttons
    root.querySelectorAll('.lf-ml-layer-btn').forEach(btn => {
      const active = btn.getAttribute('data-ml-layer') === layer.id;
      btn.classList.toggle('lf-ml-layer-btn-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    // Region-Fills
    const paths = root.querySelectorAll('.lf-ml-region');
    paths.forEach(path => {
      const rid  = path.getAttribute('data-ml-id');
      const rdat = layer.regionData[rid];
      const fill = (rdat && rdat.color) ? rdat.color : 'var(--lf-ml-region)';
      path.setAttribute('fill', fill);
      path.setAttribute('data-ml-color', fill);

      // aria-label aktualisieren (Layer-Kontext)
      const region = norm.regions.find(r => r.id === rid);
      const regionLabel = region ? region.label : rid;
      const valueText = (rdat && rdat.value) ? ': ' + rdat.value : '';
      path.setAttribute('aria-label', regionLabel + valueText + ' — ' + layer.label + ' anzeigen');

      // Selected-Marker
      const sel = state.selectedRegionId === rid;
      path.classList.toggle('lf-ml-region-selected', sel);
      path.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });

    // Legende
    const legend = root.querySelector('#' + CSS.escape(slotId) + '-legend');
    if (legend) {
      // Welche regionData-Einträge haben eindeutige Farben?
      const seen = new Map(); // color → first-encountered value label
      for (const r of norm.regions) {
        const rdat = layer.regionData[r.id];
        if (!rdat) continue;
        if (!seen.has(rdat.color)) seen.set(rdat.color, rdat.value);
      }
      if (seen.size > 0) {
        let html = '<span class="lf-ml-legend-label">' + layer.label + ':</span>';
        seen.forEach((value, color) => {
          html += '<span class="lf-ml-legend-item">'
            + '<span class="lf-ml-legend-swatch" style="background:' + _escapeAttr(color) + '"></span>'
            + '<span class="lf-ml-legend-text">' + value + '</span>'
            + '</span>';
        });
        legend.innerHTML = html;
        legend.hidden = false;
      } else {
        legend.hidden = true;
      }
    }

    // Popup aktualisieren (falls eine Region selektiert)
    if (state.selectedRegionId) {
      _showPopup(state.selectedRegionId, false);
    }
  }

  // ── Popup anzeigen ────────────────────────────────────
  function _showPopup(regionId, animate) {
    if (unmounted || !root) return;
    const popup       = root.querySelector('#' + CSS.escape(slotId) + '-popup');
    const regionEl    = root.querySelector('#' + CSS.escape(slotId) + '-popup-region');
    const layerEl     = root.querySelector('#' + CSS.escape(slotId) + '-popup-layer');
    const valueEl     = root.querySelector('#' + CSS.escape(slotId) + '-popup-value');
    if (!popup) return;

    const layer  = _findLayer(norm.layers, state.activeLayerId);
    const region = norm.regions.find(r => r.id === regionId);
    const rdat   = layer.regionData[regionId];

    if (regionEl) regionEl.textContent = region ? region.label : regionId;
    if (layerEl)  layerEl.textContent  = layer.label;
    if (valueEl)  {
      valueEl.textContent = (rdat && rdat.value) ? rdat.value : '—';
    }

    popup.hidden = false;
    if (animate && !reducedMotion) {
      popup.classList.remove('lf-ml-popup-in');
      // Force reflow
      void popup.offsetWidth;
      popup.classList.add('lf-ml-popup-in');
    }
  }

  function _hidePopup() {
    if (unmounted || !root) return;
    const popup = root.querySelector('#' + CSS.escape(slotId) + '-popup');
    if (popup) popup.hidden = true;
    state.selectedRegionId = null;
    // Deselect SVG paths
    root.querySelectorAll('.lf-ml-region').forEach(p => {
      p.classList.remove('lf-ml-region-selected');
      p.setAttribute('aria-pressed', 'false');
    });
  }

  // ── Click + Keyboard Handler ──────────────────────────
  function onClick(ev) {
    if (unmounted) return;
    const t  = ev.target;
    if (!t || !t.closest) return;
    const el = t.closest('[data-ml-action], .lf-ml-region');
    if (!el || !root.contains(el)) return;

    // Layer-Button
    const action = el.getAttribute('data-ml-action');
    if (action === 'set-layer') {
      const newLayer = el.getAttribute('data-ml-layer');
      if (newLayer && newLayer !== state.activeLayerId) {
        state.activeLayerId = newLayer;
        applyLayer();
      }
      return;
    }
    if (action === 'close-popup') {
      _hidePopup();
      return;
    }

    // Region-Path click
    const rid = el.getAttribute('data-ml-id');
    if (rid) {
      if (state.selectedRegionId === rid) {
        _hidePopup();
      } else {
        state.selectedRegionId = rid;
        _showPopup(rid, true);
        // Update selected visual
        root.querySelectorAll('.lf-ml-region').forEach(p => {
          const sel = p.getAttribute('data-ml-id') === rid;
          p.classList.toggle('lf-ml-region-selected', sel);
          p.setAttribute('aria-pressed', sel ? 'true' : 'false');
        });
      }
    }
  }

  function onKeydown(ev) {
    if (unmounted) return;
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const t = ev.target;
    if (!t) return;
    const rid = t.getAttribute('data-ml-id');
    if (rid) {
      ev.preventDefault();
      onClick({ target: t });
    }
  }

  if (root) {
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
  }

  // Theme-Callback — onTheme ist no-op für reine CSS-Var-Widgets,
  // aber registriert damit der Loader keine Warnung loggt.
  function onThemeCb() { /* CSS-Vars ziehen automatisch durch */ }
  lfWidgetRegisterThemeCb(onThemeCb);

  // Initial render
  applyLayer();

  // ── Instance ──────────────────────────────────────────
  return {
    widgetType: 'map-layer-toggle',

    unmount() {
      if (unmounted) return;
      unmounted = true;
      lfWidgetUnregisterThemeCb(onThemeCb);
      if (root) {
        try { root.removeEventListener('click', onClick); } catch (e) {}
        try { root.removeEventListener('keydown', onKeydown); } catch (e) {}
      }
    },

    onAnswer() { /* Map hat kein Scoring */ },

    pause()  { /* no-op */ },
    resume() { /* no-op */ },

    onTheme() { /* CSS-Vars update automatisch */ },

    getState() {
      return {
        activeLayerId:    state.activeLayerId,
        selectedRegionId: state.selectedRegionId
      };
    },

    setState(s) {
      if (!s || typeof s !== 'object') return;
      if (typeof s.activeLayerId === 'string') {
        const exists = norm.layers.some(l => l.id === s.activeLayerId);
        if (exists) state.activeLayerId = s.activeLayerId;
      }
      if (s.selectedRegionId === null || s.selectedRegionId === undefined) {
        state.selectedRegionId = null;
      } else if (typeof s.selectedRegionId === 'string') {
        const exists = norm.regions.some(r => r.id === s.selectedRegionId);
        state.selectedRegionId = exists ? s.selectedRegionId : null;
      }
      applyLayer();
      if (state.selectedRegionId) {
        _showPopup(state.selectedRegionId, false);
      } else {
        const popup = root && root.querySelector('#' + CSS.escape(slotId) + '-popup');
        if (popup) popup.hidden = true;
      }
    }
  };
}

function _emptyInstance() {
  return {
    widgetType: 'map-layer-toggle',
    unmount()   {},
    onAnswer()  {},
    pause()     {},
    resume()    {},
    onTheme()   {},
    getState()  { return {}; },
    setState()  {}
  };
}

export default { widgetType: 'map-layer-toggle', mount };
export { mount };
