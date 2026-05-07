// @ts-check
// Theme-Matrix Visual-Regression Suite
// ─────────────────────────────────────────
// For every theme combination, screenshot every important page and diff it
// against the committed reference in `screenshots/`. First run = baseline
// creation (no diff). Subsequent runs fail on visual change.
//
// IMPORTANT — discrepancy with Adrian's brief:
//   The brief said `localStorage.setItem('lf_theme', name)`. The actual app uses
//   TWO storage layers (verified in assets/js/app.js:209 + cosmetics.js:64-72):
//
//     - `lf_theme`      → COOKIE   → sets <html data-theme="light|dark">
//     - `lf_app_theme`  → localStorage → sets <html data-app-theme="default|ocean|...">
//
//   So we set BOTH below. Switching only `lf_theme` in localStorage would be a no-op.
//
// First-run instructions:
//   1. From repo-root in another terminal: `py -m http.server 8000`
//   2. From this directory: `npm install` (one-time) + `npx playwright install chromium`
//   3. `npx playwright test` — first run creates `screenshots/<theme>-<page>.png` baselines
//   4. Commit the screenshots/ folder.
//   5. Re-run after UI changes; if the diff is intentional: `npx playwright test --update-snapshots`.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// ── Theme matrix ────────────────────────────────────────────
// Mirrors THEMES in assets/js/cosmetics.js (11 entries) crossed with the two
// `data-theme` modes. Total: 22 cells. Default-light + default-dark cover the
// vanilla baseline; cosmetic-light + cosmetic-dark cover every cosmetic theme.
const APP_THEMES = [
  'default', 'ocean', 'forest', 'sunset', 'lavender',
  'crimson', 'mint', 'cherry', 'carbon', 'aurora', 'cyberpunk',
];
const MODES = ['light', 'dark'];

// ── Pages to screenshot ─────────────────────────────────────
// Hash-based router (assets/js/app.js:434). Selectors below are loose —
// the real wait-target is `.app-loaded` (set after route() finishes).
const PAGES = [
  { id: 'dashboard',        hash: '#/' },
  { id: 'profile-overview', hash: '#/profil' },
  { id: 'profile-inventar', hash: '#/profil?tab=inventar' },
  { id: 'leaderboard',      hash: '#/rangliste' },
];

const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Make sure the directory exists before we start writing into it.
test.beforeAll(() => {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
});

/**
 * Switch theme by writing both storage layers BEFORE first navigation,
 * then reload so the app picks them up on boot.
 */
async function applyTheme(page, mode, appTheme) {
  // Cookie for `lf_theme` (light/dark) — must be set on the page's origin.
  await page.context().addCookies([{
    name: 'lf_theme',
    value: mode,
    url: 'http://localhost:8000',
  }]);

  // localStorage for `lf_app_theme` — needs an active page on the right origin.
  // We navigate to about:blank-equivalent first via baseURL '/' and only set
  // storage AFTER the origin exists. addInitScript runs before any app code
  // on every navigation — exactly what we want for a reload-stable preference.
  await page.addInitScript(({ appTheme }) => {
    try { localStorage.setItem('lf_app_theme', appTheme); } catch {}
  }, { appTheme });
}

/**
 * Wait for the app's main render to settle. We don't have a hard "ready" hook,
 * so we wait for the document to attach data-theme + data-app-theme attributes
 * (set by route() → applyTheme()) and for network to be idle.
 */
async function waitForAppReady(page) {
  await page.waitForLoadState('domcontentloaded');
  // Both attrs should exist after app.js boots and applyTheme runs.
  await page.waitForFunction(() => {
    const el = document.documentElement;
    return el.hasAttribute('data-theme') && el.hasAttribute('data-app-theme');
  }, { timeout: 15_000 }).catch(() => { /* tolerate — first paint may race */ });
  await page.waitForLoadState('networkidle').catch(() => {});
  // Small settle for any post-mount animations (XP-bar fill, splash fade, …).
  await page.waitForTimeout(800);
}

for (const mode of MODES) {
  for (const appTheme of APP_THEMES) {
    test.describe(`theme=${appTheme} mode=${mode}`, () => {
      for (const pg of PAGES) {
        test(`${pg.id}`, async ({ page }) => {
          await applyTheme(page, mode, appTheme);
          await page.goto('/' + pg.hash);
          await waitForAppReady(page);

          // Hide cursor / blinking carets / dynamic streak-time-deltas so diffs
          // don't fire on irrelevant frame variation.
          await page.addStyleTag({ content: `
            *, *::before, *::after { caret-color: transparent !important; }
            .nav-streak-chip [data-live="now"] { visibility: hidden !important; }
          `}).catch(() => {});

          const fileName = `${appTheme}-${mode}-${pg.id}.png`;
          await expect(page).toHaveScreenshot(fileName, {
            fullPage: true,
            // Animations off — otherwise the snapshot races the splash fade.
            animations: 'disabled',
          });
        });
      }
    });
  }
}
