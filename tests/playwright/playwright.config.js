// @ts-check
// Playwright config — local visual-regression snapshots for LearningForge.
// CI integration is intentionally OUT-OF-SCOPE (Mission-10 / Jake's GitHub Actions).
// For now: Simon runs `py -m http.server 8000` from repo-root in one terminal,
// `npx playwright test` from this directory in another.

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.js$/,

  // No parallelism — we want stable, deterministic screenshots and the
  // local http.server is single-threaded anyway.
  fullyParallel: false,
  workers: 1,

  // No retries locally — a flaky snapshot is a real signal, not noise.
  retries: 0,

  // Where committed reference snapshots live. Resolved relative to the spec file.
  // Naming: `<theme>-<page>.png` is produced manually in the test (see spec)
  // since we want one clean file per matrix cell, not Playwright's auto-naming
  // (which appends platform/browser suffixes).
  snapshotDir: './screenshots',

  // Generous timeouts because the app boots Firebase + service worker on first hit.
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // Allow 1% pixel drift — antialiasing on text is the usual culprit.
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },

  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: 'http://localhost:8000',
    headless: true,
    viewport: { width: 1280, height: 800 },
    // Trace on first retry — disabled because retries:0, but kept declarative.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  // Single browser: chromium only. Firefox/WebKit skipped for speed —
  // Simon's audience is desktop-Chrome and the Android TWA (also Chromium).
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
