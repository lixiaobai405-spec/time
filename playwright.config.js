const { defineConfig } = require('@playwright/test');
const path = require('node:path');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'frontend.spec.js',
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
      DATABASE_PATH: path.join(__dirname, 'test-results', 'playwright.sqlite'),
      SESSION_SECRET: 'fake-playwright-session-secret-with-at-least-forty-eight-bytes',
      SESSION_COOKIE_SECURE: 'false',
      SESSION_MAX_AGE_MS: '604800000',
    },
  },
});
