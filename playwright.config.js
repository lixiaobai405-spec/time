const { defineConfig } = require('@playwright/test');

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
    },
  },
});
