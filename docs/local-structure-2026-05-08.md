# LearningForge — Local Repository Structure

**Stand:** 2026-05-08 (nach Mega-Cycle-Push, Commit `141a4aa`, Branch `master`)
**Pfad:** `C:\Users\simon\Storage\AI\LearningForge\`
**Typ:** Statische PWA (kein Build-Step) + Cloudflare-Worker-Backend
**Live-URL:** https://learning-forge.simonsstudios.de/
**Cache-Version:** `lf-v32` (siehe `sw.js`)

> Diese Doku spiegelt den **lokalen** Repository-Stand wider — nicht den GitHub-Stand.
> Ausgeschlossen sind: `node_modules/`, `.git/`, `workers/.wrangler-dryrun/`, `.tools/node/`,
> `functions/node_modules/` und ähnliche Build-Caches.

---

## Top-Level

| File | Größe | Beschreibung |
|---|---:|---|
| `index.html` | 3.5 KB | App-Entry-Point — Splash + Container, lädt `main.js` + 3 CSS-Files |
| `sw.js` | 3.8 KB | Service-Worker, App-Shell-Cache (`lf-v32`), `SKIP_HOSTS` für Firebase + Worker |
| `manifest.json` | 571 B | PWA-Manifest (Name, Icons, Display-Mode, Theme-Color) |
| `firebase.json` | 314 B | Firebase-Config (hosting + functions config) |
| `firestore.rules` | 66 KB | Firestore-Security-Rules (komplette Auth- & Schreib-Logik) |
| `firestore.indexes.json` | 519 B | Composite-Indexes für Firestore-Queries |
| `.firebaserc` | 61 B | Firebase-Projekt-Alias (`learningforge-app`) |
| `changelog.json` | 3.0 KB | "Was ist neu?"-Feed, gerendert auf Dashboard |
| `CNAME` | 31 B | GitHub-Pages-Domain (`learning-forge.simonsstudios.de`) |
| `.gitignore` | — | Git-Ignore-Patterns |
| `.nojekyll` | — | Disabled Jekyll-Build auf GitHub-Pages |
| `keystore.jks` | 2.7 KB | Android-Signing-Keystore (TWA, `android/`) |
| `generate-keystore.bat` | 1.2 KB | Helper-Skript zum Re-Generieren des Keystores |
| `ROADMAP.md` | 27 KB | Projekt-Roadmap (Missionen, Phasen, Vision) |
| `TEAM.md` | 10 KB | Anvil-Labs-Team + Org-Struktur |
| `Projektideen_Zukunft.md` | 3.6 KB | Brainstorm-File für zukünftige Features |

---

## assets/

### assets/css/
| File | Größe | Beschreibung |
|---|---:|---|
| `main.css` | 217 KB | App-CSS — Layout, Komponenten, Themes (~7000 Zeilen) |
| `cosmetics.css` | 27 KB | 11 Cosmetic-Themes (zusätzliche Skins über `main.css`) |
| `subject-tokens.css` | 19 KB | Per-Subject Layer-2-Tokens (Subject-spezifische Farben/Variablen) |

### assets/js/
| File | Größe | Beschreibung |
|---|---:|---|
| `main.js` | 762 B | Bootstrap — registriert SW, started App |
| `app.js` | 660 KB | Haupt-App: Router, alle Page-Renderer (~17000 Zeilen) |
| `auth.js` | 67 KB | Firebase-Auth + Firestore-Wrapper (set/merge, source:server) |
| `scanner.js` | 6.2 KB | GitHub-Tree-API-Fetch + Topic-JSON-Lader (raw-CDN, cache-busting) |
| `test-engine.js` | 21 KB | Question-Selection, Grading, Gemini-Integration |
| `config.js` | 2.1 KB | GitHub-Owner/Repo + Firebase-Config + Gemini-Key-Wiring |
| `cf.js` | 12 KB | Cloudflare-Worker-Client (Wrapper für Worker-Endpoints) |
| `cosmetics.js` | 6.9 KB | Cosmetic-System (Themes, Avatare, Unlock-Logik) |
| `achievements.js` | 20 KB | Achievement-System (Trigger, Counters, Badge-Display) |
| `daily-challenges-config.js` | 12 KB | Config für Daily-Challenge-Pool (Mission 9) |
| `physik-sim.js` | 27 KB | Interaktive Physik-Simulationen (Superpositionsprinzip etc.) |
| `icons.js` | 47 KB | Lucide-Icon-Map + Renderer-Wrapper (`lfIcon`, `lfFlag`) |

### assets/icons/
- `icon.svg` (218 B) — App-Icon (Browser-Tab, PWA)
- `icon-maskable.svg` (211 B) — Maskable-Variante (Android-Adaptive-Icon)

### assets/img/icons/lucide/
- ~100 SVG-Icons aus Lucide (lokal gehostet, keine CDN-Latenz)
- Beispiele: `atom`, `book-open-text`, `brain`, `calculator`, `flask-conical`, `landmark`,
  `leaf`, `palette`, `rocket`, `sigma`, `trophy`, `users`, …
- Mission 8 — Migration von Emoji zu Lucide-Icons

### assets/img/icons/flags/
- `gb.svg` (504 B) — UK-Flagge für Englisch-Subject (lipis/flag-icons MIT)

---

## Fächer/

**Truth-Source für Subject-Metadaten:** `Fächer/subjects-config.json`

### subjects-config.json
- 14 Fächer konfiguriert: Mathematik, Deutsch, Englisch, Geschichte, Biologie, Latein,
  Chemie, Physik, Geographie, Informatik, Musik, Kunst, Sport
- Pro Fach: `name`, `color` (hex), `icon` (Lucide-Name), `iconType` (`lucide`/`flag`),
  optional `tools` (calculator/tafelwerk)

### Topics (lokal vorhandene Inhalte)

| Subject | Klasse | Topic | Files |
|---|---|---|---|
| Englisch | Klasse-9 | Australia | `meta.json`, `questions.json` |
| Geschichte | Klasse-9 | Erster-Weltkrieg | `meta.json`, `questions.json` |
| Latein | Grammatik | Verben | `meta.json`, `questions.json` |
| Mathematik | Klasse-9 | Potenzgleichungen | `meta.json`, `questions.json` |
| Physik | Klasse-9 | Superpositionsprinzip | `meta.json`, `questions.json` |

**Hinweis:** Topic-Inhalt liegt in `meta.json` (entweder `content`-String oder
`subtopics`-Array). `questions.json` enthält die statischen Fragen, gemischt mit
Gemini-generierten zur Test-Zeit.

---

## workers/ (Cloudflare-Worker — Backend)

### workers/ (Top-Level)
- `wrangler.toml` — Wrangler-Config (Worker-Name, Account-ID, Bindings)
- `package.json` — Worker-Dependencies (wrangler, jose für JWT)
- `package-lock.json`
- `.gitignore` — Skipped: `node_modules/`, `.wrangler/`

### workers/src/
- `index.js` — Router, dispatcht 10 Endpoints per URL-Path, CORS-Handling

### workers/src/endpoints/
| File | Auth | Beschreibung |
|---|---|---|
| `submitTestResult.js` | required | Test-Ergebnis speichern (XP, Streak, Grade) |
| `unlockCosmetic.js` | required | Cosmetic-Unlock per Konditions-Check |
| `getParentShareReport.js` | UNAUTH | Public-Share-Link für Eltern-Report |
| `markTestAccount.js` | required | Test-Account-Marker (Dev/QA) |
| `submitDailyChallenge.js` | required | Daily-Challenge-Submission (Mission 9) |
| `submitTopicForApproval.js` | required | Custom-Topic in Approval-Queue (Phase 3c) |
| `approveTopicForPublic.js` | admin only | Admin approved Custom-Topic für Public |
| `aiCall.js` | required | Gemini-Proxy (Mission 12) |
| `listCustomTopics.js` | required | List Custom-Topics (admin: pending; user: own) |
| `deleteAccount.js` | required | Account-Löschung (Cycle-3-Settings-Refactor) |

### workers/src/lib/
| File | Beschreibung |
|---|---|
| `auth.js` | Firebase-JWT-Verification (`requireAuth()`) |
| `firestore.js` | Firestore-REST-Wrapper (read/write/merge) |
| `http.js` | JSON-Response-Helpers, CORS, Error-Response |
| `achievements.js` | Server-side Achievement-Trigger-Logik |
| `cosmetics.js` | Cosmetic-Unlock-Konditions-Check |
| `daily-challenges.js` | Daily-Challenge-Validation + Reward |
| `evaluation.js` | Grade-Berechnung (Punkte → Note) |
| `distractor-balance.js` | Question-Distractor-Balance-Heuristik |

---

## functions/ (Legacy — Firebase Cloud Functions)

- `package-lock.json` — Nur Lockfile übrig
- `node_modules/` — vorhanden, aber **ausgeschlossen** in dieser Doku
- **Status:** Migriert zu Cloudflare-Workers (Mission 6, Commit `630038b`).
  Kein aktiver Source-Code mehr in diesem Folder.

---

## .claude/ (Anvil-Labs-Workspace + Memory)

### .claude/ (Root)
- `CLAUDE.md` — Workspace-Rules, Hard-Rules (z.B. nie `enablePersistence`, JSON-Encoding)
- `structure.md` — Living Architecture-Map
- `conversation.md` — Append-only Session-Log
- `dc_log.md` — Discord-Bridge-Log (`## IN -` / `## OUT -` Einträge)
- `dc_ping.ps1` — Ping-Helper für Discord-Notifications

### .claude/agents/ (9 Personas — Anvil Labs Team)
- `maya-chen.md` — Designer / UX
- `ethan-walker.md` — Frontend-Dev
- `marcus-hayes.md` — Backend-Dev
- `casey-lane.md` — Pädagogin / Content
- `jake-morrison.md` — QA / Test
- `priya-patel.md` — Data / Analytics
- `ramsey-cole.md` — DevOps / Infra
- `sophie-bennett.md` — Product / Strategy
- `herr-mueller.md` — Lehrer-Persona (Curriculum-Validation)

### .claude/company/

#### company/COMPANY.md
- Org-Struktur, Team, Workflow-Pointer (Anvil Labs, gegründet 2026-05-07)

#### company/assets/
- `LOGO.md` — Logo-Spec
- `logo.png` — Anvil-Labs-Logo

#### company/decisions/ (ADRs)
- `0001-firma-gruendung.md` — Anvil-Labs-Founding
- `0002-subtopic-schema.md` — Subtopic-JSON-Schema
- `0003-brilliant-inspiration-and-divergence.md` — Brilliant-Inspiration & Differenzierung

#### company/playbooks/
- `bug-hunt.md` — Bug-Hunt-Workflow
- `deploy.md` — Deploy-Workflow
- `feature-overhaul.md` — Feature-Overhaul-Pattern
- `local-dev.md` — Local-Dev-Setup
- `playwright-qa.md` — QA-Workflow

#### company/meetings/2026-05-07-budget-zero/
- `ethan-walker.md`, `jake-ramsey-casey.md`, `marcus-hayes.md`,
  `maya-chen.md`, `sophie-bennett.md`

#### company/reports/
- `2026-05-07-day-1-summary.md`

#### company/specs/ (~40 Specs)
**Cycle-Specs:**
- `cycle-1-improvements-maya.md`
- `cycle-2-casey-top3-implementation.md`
- `cycle-4-mueller-feature-ideas.md`
- `cycle-5-spec-audio-modus.md`
- `cycle-5-spec-klausur-bereitschaft.md`
- `cycle-5-spec-konfidenz-verlauf.md`
- `cycle-8-spec-predict-reveal-widget.md`
- `cycle-feature-discovery-maya-2026-05-08.md`
- `cycle-features-2026-05-08.md`

**Mission-Specs:**
- `mission-01-overhaul.md`
- `mission-04-app-tour.md`
- `mission-07-cosmetic-rework.md`
- `mission-08-icon-migration.md`
- `mission-08-phase-1-icon-gen.md`
- `mission-bug-cycle-2026-05-08.md`
- `mission-bug-cycle-2026-05-08-uxspecs.md`

**Wave-Specs (Bug-Fixes):**
- `wave-1-ethan-fixes-2026-05-08.md`
- `wave-1-marcus-fixes-2026-05-08.md`
- `wave-2-ethan-fixes-2026-05-08.md`
- `wave-3-ethan-fixes-2026-05-08.md`
- `wave-4-ethan-fixes-2026-05-08.md`
- `wave-5b-ethan-fixes-2026-05-08.md`

**Strategy-Specs:**
- `audit-2026-05-08-marcus-backend.md`
- `backend-klassen-rangleichne.md`
- `ceo-decisions-2026-05-08.md`
- `curriculum-strategy-9-brandenburg.md`
- `curriculum-widget-catalog-2026-05-08.md`
- `curriculum-widget-catalog-2026-05-08-v2.md`
- `dc-post-drafts-meeting.md`
- `ghost-code-cycle-1.md`
- `lernplan-decision-2026-05-08.md`
- `meeting-2026-05-08-phase-2-vision.md`
- `meeting-cycle-01-2026-05-08.md`
- `meeting-cycle-02-2026-05-08.md`
- `meeting-cycle-03-2026-05-08.md`
- `meeting-cycle-07-2026-05-08.md`
- `meeting-cycle-08-2026-05-08.md`
- `per-subject-design-tokens.md`
- `per-subject-design-tokens-v2.md`
- `phase-2-vision-presentation.html`
- `phase-2-vision-roadmap.md`
- `phase-2-vision-roadmap-v3.md`
- `polish-cycle-2026-05-08-pre-specs.md`
- `red-team-cycle-1.md`
- `red-team-cycle-2-quickscan.md`
- `settings-page-refactor-implementation.md`
- `test-cycle-1.md`
- `theme-audit-cycle-1.md`
- `themes-sand-schiefer-refinement-2026-05-08.md`

#### company/tools/ (Build-Skripts)
- `batch-generate-icons.py` — Lucide-Icon-Bulk-Download
- `build-icons-js.py` — Generiert `assets/js/icons.js` aus SVGs
- `deploy-worker.py` — Wrangler-Deploy-Wrapper
- `download-flag-icons.py` — Flag-Icons-Downloader
- `download-lucide-icons.py` — Lucide-Icons-Downloader
- `generate-logo.py` — Logo-Generator
- `icons-mission-8-phase-1-subjects.json` — Subject-Icon-Map (Mission 8 Input)

### .claude/tmp/
- `app_diff.patch` — Working-Diff (debugging)
- `read-bugs.js`, `resolve-bugs.js` — Bug-Triage-Helper-Skripts

---

## docs/

- `anvil-labs-logo.png` (74 KB) — Brand-Logo
- `local-structure-2026-05-08.md` — **diese Doku**

---

## android/ (TWA-Wrapper)

Trusted-Web-Activity-Wrapper, signiert mit `keystore.jks` (Root):

- `build.gradle`, `settings.gradle`, `gradle.properties`
- `app/build.gradle`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/res/drawable/ic_launcher_{background,foreground}.xml`
- `app/src/main/res/mipmap-anydpi-v26/ic_launcher{,_round}.xml`
- `app/src/main/res/values/{colors,strings}.xml`

---

## tests/playwright/

- `package.json`, `package-lock.json` (in `node_modules/`, ausgeschlossen)
- `playwright.config.js` — Playwright-Config
- `theme-matrix.spec.js` — Theme-Matrix-Tests
- `README.md` — Test-Setup-Anleitung
- `screenshots/.gitkeep` — Screenshot-Output-Folder
- `.gitignore` — Skipped: `node_modules/`, `playwright-report/`

---

## tools/

- `check-distractor-bias.py` — CLI-Skript: prüft Question-Distractor-Bias über alle Topics

---

## Agent-Docs/ (Legacy — Pre-Anvil-Labs-Doku)

- `ADDING_TOPICS.md` — Anleitung für Topic-JSON-Format
- `CLAUDE.md` — Alte Workspace-Notes (überholt durch `.claude/CLAUDE.md`)

---

## .github/

- `workflows/android-release.yml` — GitHub-Action: Android-APK-Build + Sign

---

## .well-known/

- `assetlinks.json` — Digital-Asset-Links für TWA (verifies App ↔ Domain)

---

## Ausgeschlossene Folders/Files

Folgende existieren lokal, sind aber bewusst **nicht** in dieser Doku enthalten
(Build-Caches, Dependencies, Generated):

- `.git/` — Git-Repo-Metadata
- `.tools/node/` — Lokale Node.js-Installation
- `node_modules/` (überall) — npm-Dependencies
- `workers/.wrangler-dryrun/` — Wrangler-Build-Cache
- `functions/node_modules/` — Legacy-Functions-Dependencies
- `tests/playwright/node_modules/` — Playwright-Dependencies
- `.claude/company/tools/__pycache__/` — Python-Bytecode-Cache
