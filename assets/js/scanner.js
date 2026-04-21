// ══════════════════════════════════════════
//  LearningForge — GitHub Struktur-Scanner
// ══════════════════════════════════════════

import { CONFIG } from './config.js';

const RAW = () =>
  `https://raw.githubusercontent.com/${CONFIG.github.owner}/${CONFIG.github.repo}/${CONFIG.github.branch}`;
const API = () =>
  `https://api.github.com/repos/${CONFIG.github.owner}/${CONFIG.github.repo}`;

const CACHE_KEY     = 'lf_structure_v3';
const CACHE_SHA_KEY = 'lf_structure_sha_v3';

export async function getStructure(forceRefresh = false) {
  if (CONFIG.github.owner === 'DEIN_GITHUB_USERNAME') {
    return { _configError: 'GitHub owner nicht konfiguriert.' };
  }

  if (!forceRefresh) {
    const cached = tryLoadCache();
    if (cached && !cached._configError) return cached;
  }

  try {
    // Aktuellsten Commit für Cache-Invalidierung
    let currentSha = null;
    try {
      const shaRes  = await fetch(`${API()}/commits/${CONFIG.github.branch}`);
      const shaData = await shaRes.json();
      currentSha = shaData.sha || null;
    } catch { /* ignore — SHA-Check optional */ }

    const cachedSha = sessionStorage.getItem(CACHE_SHA_KEY);
    if (!forceRefresh && currentSha && cachedSha === currentSha) {
      const cached = tryLoadCache();
      if (cached) return cached;
    }

    // Gesamten Baum in einem Call laden
    const treeRes  = await fetch(`${API()}/git/trees/${CONFIG.github.branch}?recursive=1`);
    const treeData = await treeRes.json();

    if (!treeData.tree) {
      console.error('[Scanner] Kein Tree gefunden. Branch korrekt?', CONFIG.github.branch);
      return { _configError: `Branch "${CONFIG.github.branch}" nicht gefunden.` };
    }

    const subjectsConfig = await fetchSubjectsConfig();
    const structure      = buildStructure(treeData.tree, subjectsConfig);

    sessionStorage.setItem(CACHE_KEY, JSON.stringify(structure));
    if (currentSha) sessionStorage.setItem(CACHE_SHA_KEY, currentSha);

    return structure;
  } catch (err) {
    console.error('[Scanner] Fehler:', err);
    return tryLoadCache() || { _configError: err.message };
  }
}

export async function getTopicMeta(subjectId, yearId, topicId) {
  try {
    const res = await fetch(`${RAW()}/F%C3%A4cher/${subjectId}/${yearId}/${topicId}/meta.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

export async function getTopicQuestions(subjectId, yearId, topicId) {
  try {
    const res = await fetch(`${RAW()}/F%C3%A4cher/${subjectId}/${yearId}/${topicId}/questions.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return data.questions || [];
  } catch { return []; }
}

async function fetchSubjectsConfig() {
  try {
    const res = await fetch(`${RAW()}/F%C3%A4cher/subjects-config.json`);
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

function buildStructure(tree, subjectsConfig) {
  // GitHub gibt Pfade mit ä als UTF-8-Zeichen zurück
  // Beide Varianten abfangen: direkt und URL-kodiert
  const isFaecher = (path) =>
    path.startsWith('Fächer/') ||
    path.startsWith('F\u00e4cher/') ||
    path.startsWith('F%C3%A4cher/');

  const stripPrefix = (path) =>
    path.replace(/^F(%C3%A4|\u00e4|ä)cher\//, '');

  const dirs = tree
    .filter(item => item.type === 'tree' && isFaecher(item.path))
    .map(item => stripPrefix(item.path).split('/'));

  const subjects = {};

  for (const parts of dirs) {
    const [subjectId, yearId, topicId] = parts;
    if (!subjectId) continue;

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

    if (!subjects[subjectId].years[yearId]) {
      subjects[subjectId].years[yearId] = { id: yearId, name: idToName(yearId), topics: {} };
    }
    if (!topicId) continue;

    subjects[subjectId].years[yearId].topics[topicId] = {
      id: topicId, name: idToName(topicId)
    };
  }

  // Leere Jahre und Fächer entfernen (z.B. nach gelöschten Ordnern)
  for (const s of Object.values(subjects)) {
    for (const [yid, year] of Object.entries(s.years)) {
      if (Object.keys(year.topics).length === 0) delete s.years[yid];
    }
  }
  for (const [sid, s] of Object.entries(subjects)) {
    if (Object.keys(s.years).length === 0) delete subjects[sid];
  }

  return subjects;
}

function tryLoadCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function idToName(id) {
  return decodeURIComponent(id).replace(/[-_]/g, ' ');
}

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
