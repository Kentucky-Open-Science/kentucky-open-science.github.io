// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.PORT || 4173);

// Locally you can point at an already-installed Chromium instead of downloading one:
//   PW_CHROMIUM_PATH=/path/to/chrome npm test
const launchOptions = process.env.PW_CHROMIUM_PATH
  ? { executablePath: process.env.PW_CHROMIUM_PATH }
  : {};

module.exports = defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js/,
  // Tests are cheap and idempotent; retries would only hide flakiness.
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  fullyParallel: false,
  reporter: process.env.CI
    ? [['list'], ['json', { outputFile: 'reports/playwright.json' }]]
    : [['line'], ['json', { outputFile: 'reports/playwright.json' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}/`,
    launchOptions,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node tests/serve.js',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
