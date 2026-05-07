# LearningForge — Playwright Theme-Matrix Suite

Local-only visual-regression-tests for the full theme matrix
(11 cosmetic themes x light/dark x 4 pages = **88 snapshots**).

> **No CI yet.** Mission-10 (Jake's GitHub-Actions) wires this into a workflow.
> For now this is a manual pre-push gate Sophie runs.

## Quick start

In **terminal 1** (from repo-root, NOT this directory):

```bash
py -m http.server 8000
```

In **terminal 2** (from this directory, `tests/playwright/`):

```bash
npm install                        # one-time — installs @playwright/test
npx playwright install chromium    # one-time — downloads the browser binary
npx playwright test                # run the suite
```

**First run = baseline creation.** Playwright will report every test as
"missing snapshot" and write the references into `screenshots/`. Commit them.
Subsequent runs diff against that baseline and fail on any visual change.

## When the UI legitimately changes

The committed PNGs in `screenshots/` are the source of truth. After a confirmed
intentional UI change:

```bash
npx playwright test --update-snapshots
git add screenshots/
git commit -m "chore(qa): refresh theme-matrix baselines"
```

## When a test fails

```bash
npx playwright show-report
```

opens the HTML report with side-by-side `expected / actual / diff` thumbnails.
The diff PNG lives under `test-results/<test-id>/`.

## Adding a new page to the matrix

Edit `theme-matrix.spec.js`, append to the `PAGES` array:

```js
{ id: 'meine-inhalte', hash: '#/meine-inhalte' },
```

Re-run with `--update-snapshots` so a baseline gets generated for every theme.

## Adding a new spec

Drop a `*.spec.js` file in this directory; Playwright picks it up via the
`testMatch` pattern in `playwright.config.js`. Template:

```js
const { test, expect } = require('@playwright/test');

test('my new check', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveScreenshot('my-check.png');
});
```

## Limitations

- **Localhost only.** Hits `http://localhost:8000` — relies on Simon's running
  `py -m http.server`. No remote target.
- **Cached production Firebase auth.** The test browser inherits whatever auth
  state exists in its profile. Snapshots assume a *signed-out* state by default —
  cleaner. For signed-in flows, populate cookies/storage in a `beforeEach`.
- **No write-path coverage.** Anything that needs Firestore writes (bug-report
  submission, group create, friend request, etc.) is out of scope here. Use
  Marcus's parallel **Firestore Emulator** setup once that lands.
- **Service worker quirk.** First run may register the SW and cache assets, so
  re-runs are faster. If you see stale-asset diffs, clear the test-results dir
  and re-run; if it persists, bump `sw.js` cache version.
- **Single browser.** Chromium only. Firefox/WebKit skipped because the real
  audience is desktop-Chrome plus the Android TWA (also Chromium-based).

## Files

| File | What |
|---|---|
| `package.json` | dev-dep on `@playwright/test`; npm scripts |
| `playwright.config.js` | base URL, snapshot dir, single chromium project |
| `theme-matrix.spec.js` | the matrix loop — themes x modes x pages |
| `screenshots/` | committed reference PNGs (baseline) |
| `test-results/` | gitignored; per-run diffs + traces |
| `playwright-report/` | gitignored; HTML report |
