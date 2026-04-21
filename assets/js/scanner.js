// ══════════════════════════════════════════
//  LearningForge — GitHub Struktur-Scanner
//  Liest die Fächer/Jahre/Themen-Struktur
//  automatisch aus dem GitHub Repository.
// ══════════════════════════════════════════

import { CONFIG } from './config.js';

const RAW = () =>
  `https://raw.githubusercontent.com/${CONFIG.github.owner}/${CONFIG.github.repo}/${CONFIG.github.branch}`;
const API = () =>
  `https://api.github.com/repos/${CONFIG.github.owner}/${CONFIG.github.repo}`;

const CACHE_KEY     = 'lf_structure_v1';
const CACHE_SHA_KEY = 'lf_structure_sha';

// ── Öffentlicher Einstiegspunkt ─────────
export async function getStructure(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = tryLoadCache();
    if (cached) return cached;
  }

  try {
    // Aktuellsten Commit prüfen (Cache-Invalidierung)
    const shaRes = await fetch(`${API()}/commits/${CONFIG.github.branch}`);
    const shaData = await shaRes.json();
    const currentSha = shaData.sha;

    const cachedSha = sessionStorage.getItem(CACHE_SHA_KEY);
    if (!forceRefresh && cachedSha === currentSha) {
      const cached = tryLoadCache();
      if (cached) return cached;
    }

    // Gesamten Verzeichnisbaum in einem einzigen API-Call laden
    const treeRes = await fetch(`${API()}/git/trees/${CONFIG.github.branch}?recursive=1`);
    const treeData = await treeRes.json();

    if (!treeData.tree) throw new Error('Kein Verzeichnisbaum gefunden.');

    // Fächer-Konfiguration laden (Farben, Icons)
    const subjectsConfig = await fetchSubjectsConfig();

    const structure = buildStructure(treeData.tree, subjectsConfig);

    // Cachen
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(structure));
    sessionStorage.setItem(CACHE_SHA_KEY, currentSha);

    return structure;
  } catch (err) {
    console.warn('[Scanner] Fehler beim Laden:', err);
    // Veralteten Cache als Fallback zurückgeben
    return tryLoadCache() || {};
  }
}

// ── Thema-Metadaten (lazy geladen) ──────
export async function getTopicMeta(subjectId, yearId, topicId) {
  const url = `${RAW()}/Fächer/${subjectId}/${yearId}/${topicId}/meta.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

// ── Fragen für einen Test ───────────────
export async function getTopicQuestions(subjectId, yearId, topicId) {
  const url = `${RAW()}/Fächer/${subjectId}/${yearId}/${topicId}/questions.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.questions || [];
  } catch { return []; }
}

// ── Interne Hilfsfunktionen ─────────────

async function fetchSubjectsConfig() {
  const url = `${RAW()}/Fächer/subjects-config.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

function buildStructure(tree, subjectsConfig) {
  // Nur Ordner innerhalb von Fächer/, max 3 Ebenen tief
  const dirs = tree
    .filter(item => item.type === 'tree' && item.path.startsWith('Fächer/'))
    .map(item => item.path.split('/').slice(1)); // 'Fächer/' entfernen

  const subjects = {};

  for (const parts of dirs) {
    const [subjectId, yearId, topicId] = parts;
    if (!subjectId) continue;

    // Fach initialisieren
    if (!subjects[subjectId]) {
      const cfg = subjectsConfig[subjectId] || {};
      subjects[subjectId] = {
        id:    subjectId,
        name:  cfg.name  || idToName(subjectId),
        color: cfg.color || defaultColor(subjectId),
        icon:  cfg.icon  || '📚',
        years: {}
      };
    }

    if (!yearId) continue;

    // Schuljahr initialisieren
    if (!subjects[subjectId].years[yearId]) {
      subjects[subjectId].years[yearId] = {
        id:     yearId,
        name:   idToName(yearId),
        topics: {}
      };
    }

    if (!topicId) continue;

    // Thema initialisieren
    subjects[subjectId].years[yearId].topics[topicId] = {
      id:   topicId,
      name: idToName(topicId)
    };
  }

  return subjects;
}

function tryLoadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Ordner-ID → Anzeigename: "Zahlen-und-Mengen" → "Zahlen und Mengen"
export function idToName(id) {
  return id.replace(/[-_]/g, ' ');
}

// Stabile Farbe aus dem Fach-Namen ableiten (Fallback)
const FALLBACK_COLORS = [
  '#3b82f6','#ef4444','#8b5cf6','#f59e0b',
  '#10b981','#14b8a6','#6366f1','#84cc16',
  '#06b6d4','#ec4899','#f97316','#eab308'
];
function defaultColor(id) {
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}
