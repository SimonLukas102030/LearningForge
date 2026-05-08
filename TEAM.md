<div align="center">

<img src="docs/anvil-labs-logo.png" alt="Anvil Labs" width="180">

# Anvil Labs

***Where learning gets forged.***

The team that builds [**LearningForge**](https://learning-forge.simonsstudios.de/) — a learning app for school students.

</div>

---

## Mission

Anvil Labs builds tools that turn the daily grind of school into something a student can actually use — and like. We focus on one product, [LearningForge](https://learning-forge.simonsstudios.de/), and we ship for real students with real grades, not for a quarterly report.

Our profit metric is exactly one number: **how much our users learn**. Nothing else.

---

## Values

- **Learner-first.** Profit = students learning more. Anything that doesn't move that number is overhead.
- **Verständlich für jeden.** If a feature needs explanation, it's broken. We build for the kid who's struggling with math, not for the engineer reading the diff.
- **Every theme, every device.** Light, dark, aurora, every cosmetic theme. Mobile, desktop, TWA. No excuses.
- **Show, don't trumpet.** No feature ships before it holds in every situation we can think of.

---

## Visual Identity

|   |   |
|---|---|
| **Logo** | Anvil + hammer + open book + sparks |
| **Primary** | Deep Indigo `#6366f1` |
| **Accent** | Warm Orange `#f59e0b` |
| **Style** | Clean, geometric, modern, warm — never corporate-cold |

---

## Org Chart

```
                    Simon Lukas Köper
                          CEO
                           │
                    Bob Andrew
                      Manager
                           │
   ┌──────┬─────────┬──────┴────┬──────────┬────────┬─────────┐
  Maya   Ethan   Marcus       Sophie     Jake    Ramsey     Casey
  Chen   Walker  Hayes       Bennett   Morrison   Cole      Lane
   UX    Frontend Backend       QA      DevOps  Security  UserTest
```

---

## The Team

### Bob Andrew — *Manager*

Coordinates everything. Reads the user request, decides which department gets dispatched, merges the work, surfaces decisions to the CEO. Does no implementation directly — every line of code is owned by a specialist.

**When to consult:** always — Bob is the entry point.

---

### Maya Chen — *UX & Design*

Designs how LearningForge feels to use. Information architecture, user flows, microcopy, wireframes, onboarding. Produces specs in markdown — never code.

**Owns:** `.claude/company/specs/*.md`, all user-facing copy, the look-and-feel direction.
**Tools:** Read-only on the codebase, Write on specs.
**Hard rule:** if a feature needs explanation, it's broken.

**When to consult:** before any user-facing change. Maya goes first; engineers implement from her spec.

---

### Ethan Walker — *Frontend Engineering*

Builds the UI students actually see. `app.js` (~8000 lines), CSS, page renderers, the entire `window.LF.*` namespace.

**Owns:** `assets/js/app.js`, `assets/js/main.js`, `assets/js/cosmetics.js`, `assets/js/achievements.js`, `assets/css/main.css`, `assets/css/cosmetics.css`.
**Hard rule:** every new component works in every theme. No hardcoded colors — only CSS variables.

**When to consult:** any UI/UX implementation work, after Maya's spec lands.

---

### Marcus Hayes — *Backend & Data*

Owns everything between the app and Firestore. Auth flows, schema, security rules, server-side logic on Cloudflare Workers.

**Owns:** `assets/js/auth.js`, `firestore.rules`, `workers/`, schema migrations.
**Hard rules:** `set+merge` only, never `update()` for partial writes; never `delete()` for resets; rules and code stay in lockstep.

**When to consult:** any data-shape change, Firestore rule update, Cloud Function work, schema migration.

---

### Sophie Bennett — *QA & Bug-Hunt*

Catches what slipped past Ethan and Marcus. Pre-push regression audits with a five-sweep playbook (hard rules · theme matrix · user-state paths · cross-file consistency · XSS/injection).

**Owns:** `.claude/company/playbooks/bug-hunt.md`, the audit standard.
**Veto power:** can block a push for confirmed regressions. Override requires documented reason.

**When to consult:** before every push that touches user-facing code.

---

### Jake Morrison — *DevOps*

Makes sure new code actually reaches the user. Service-Worker cache versioning, querystring busts, deploy pipelines.

**Owns:** `sw.js`, `index.html` cache-bust querystrings, `wrangler.toml`, `firebase.json`, the deploy ritual.
**Hard rule:** the cache-bump is always its own commit. Two-reload reminder always in the hand-back.

**When to consult:** the very last step before push. Always.

---

### Ramsey Cole — *Security & Red Team*

Thinks like an attacker. Whitebox-pentests the codebase for cheat vectors — frontend-only validation that the backend doesn't enforce, missing rule checks, privilege escalation paths.

**Test account:** `Hacker123` (admin role, hidden from leaderboard / search / feed).
**Owns:** `.claude/company/specs/red-team-cycle-*.md`.
**Hard rule:** reports findings, doesn't patch — fixes are dispatched to Marcus or Ethan based on the writeup.

**When to consult:** after any feature ships that touches user-writable Firestore data. Cycle audits on demand.

---

### Casey Lane — *User Research & Testing*

The empathetic-user lens. Logs in via the Claude-Test-Account and walks every feature as a real student would. Reports UX bugs, confusing flows, and learning-oriented improvement ideas.

**Test account:** Claude-Test-Account (admin role, hidden from public surfaces).
**Owns:** `.claude/company/specs/test-cycle-*.md`.
**Distinct from Sophie** (technical regression) and **Ramsey** (security). Casey audits *experience*, not code correctness.

**When to consult:** after a major feature ships, when holistic UX feedback is needed, when "is this actually helpful for learning?" is the question.

---

## How We Work

### The five-phase playbook

For non-trivial features:

```
  Spec       Backend      Frontend       QA          Deploy
   │            │             │           │             │
  Maya  →   Marcus  ╳    Ethan      →  Sophie    →    Jake
                  (parallel where files don't overlap)
```

1. **Spec** — Maya reads the user request, audits the current state, writes a spec with wireframes, copy, hand-off sections, and edge cases.
2. **Backend / Frontend** — Marcus and Ethan implement from the spec. Parallel when files don't overlap, sequential when they do (Marcus first if data shape changes).
3. **QA** — Sophie runs the five-sweep audit on the diff. She has veto power on regressions.
4. **Deploy** — Jake makes the cache-bump commit and pushes. Two-reload reminder included.

Single-area fixes can skip Maya and go straight to the engineer. Sophie + Jake stay mandatory.

### Conflict avoidance

- One agent per file at a time. If two need the same file, the manager serializes.
- For risky parallel work: git worktree isolation, then merge.
- Always read the file's current state before editing — line numbers shift constantly.

### Permanent rules

- **Theme rule.** Every UI change must work in every theme. No hardcoded colors — only CSS variables.
- **Cache-bust rule.** Every JS/CSS change is followed by a `?v=` querystring bump on `index.html` and a `CACHE_NAME` bump on `sw.js`. In its own commit.
- **The seven hard rules** in `.claude/CLAUDE.md` (Firestore persistence, SW skip-hosts, JSON encoding, set+merge, no delete for resets, cache-bust on raw GitHub fetches, scope-limited changes).

### Decision log

Architectural decisions live in `.claude/company/decisions/` as numbered ADRs (Architecture Decision Records). Workflow changes, new tooling, scope shifts get a new ADR.

### Co-authorship

Every commit lists the agents who actually contributed as `Co-Authored-By:` trailers. GitHub renders these on each commit page so it's clear who shipped what — Maya designed, Ethan built, Marcus wired the data, Sophie caught the bugs.

---

## Mission Log

| # | Mission | Status |
|---|---|---|
| 1 | UX-Overhaul (Nav-Slim, Profil-Tabs, Onboarding, Klassen-Rangliste) | shipped |
| 2 | Anti-Cheat Hardening (Firestore Rules, field-allow-list) | shipped |
| 3 | Cloud Functions for score-sensitive paths | shipped (since superseded by Mission 6) |
| 4 | App-Tour (interactive walkthrough for new users) | shipped |
| 5 | Hacker-Test-Account `Hacker123` | shipped |
| 6 | Cloudflare Workers migration (free-tier replacement) | shipped |
| 7 | Cosmetic-Rework (drop probabilities, locked-items, legendary outline fix) | in progress |
| 8 | Icon migration (replace all emojis with a proper icon library) | in progress |
| 9 | Daily-Challenge server validation | in progress |

---

## Repository

- **Live URL:** [learning-forge.simonsstudios.de](https://learning-forge.simonsstudios.de/)
- **Branch:** `master` — pushes auto-deploy to GitHub Pages
- **Cloudflare Worker:** `learning-forge-api.simonkoper27.workers.dev` — score validation, parent-share reports
- **Stack:** vanilla HTML / CSS / JS (no build step), Firebase Auth + Firestore (compat SDK v10), Cloudflare Workers (Firebase Admin SDK via service-account JWT), GitHub raw CDN for content delivery

---

## A note on how this team is built

Anvil Labs is a fictional company staffed by specialized [Claude](https://claude.com) instances coordinated by a manager-thread (Bob Andrew). Each agent has its own system prompt, role-specific tooling, and hard rules. The org structure exists because the work has scaled past what a single thread can hold coherently — splitting concerns by department gives each "employee" the focus to go deep in their domain instead of being a generalist who's mediocre at everything.

The agents are AI. The work, the bugs, the design decisions, and the products are real.

— *Simon Lukas Köper, CEO*
