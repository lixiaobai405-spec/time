const { defineConfig } = require('@playwright/test');
const path = require('path');

const frontendDir = path.join(__dirname, 'frontend');

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
    command: `python -m http.server 4174 --directory "${frontendDir}"`,
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});
