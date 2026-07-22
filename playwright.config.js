const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const databasePath = path.join(os.tmpdir(), 'time-management-playwright.sqlite');
const databaseFiles = ['', '-wal', '-shm', '-journal'].map(suffix => `${databasePath}${suffix}`);
function cleanupDatabase() {
  for (const filename of databaseFiles) fs.rmSync(filename, { force: true });
}
if (process.env.TEST_WORKER_INDEX === undefined) {
  cleanupDatabase();
  process.once('exit', () => {
    try {
      cleanupDatabase();
    } catch {
      // The runner still reports test results; a locked temp file is checked after the run.
    }
  });
}

module.exports = defineConfig({
  testDir: './tests',
  testMatch: ['reference-five-step.spec.js', 'reference-auth-history.spec.js'],
  timeout: 25_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm.cmd run dev',
    url: 'http://127.0.0.1:4174/api/health',
    reuseExistingServer: false,
    env: {
      MODEL_API_BASE_URL: 'http://127.0.0.1:4999/v1',
      MODEL_API_KEY: 'fake-key',
      MODEL_NAME: 'fake-model',
      DATABASE_PATH: databasePath,
      SESSION_SECRET: 'fake-playwright-session-secret-with-at-least-forty-eight-bytes',
      SESSION_COOKIE_SECURE: 'false',
      SESSION_MAX_AGE_MS: '604800000',
    },
  },
});
