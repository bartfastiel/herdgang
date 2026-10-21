import { defineConfig, devices } from '@playwright/test';

// E2E against the real backend serving dist/ itself (STATIC_DIR, same CSP as Caddy), with an empty database, a
// virtual passkey and the Pixel 6 Pro format (412 px).
const pixel6pro = { ...devices['Pixel 7'], viewport: { width: 412, height: 892 }, screen: { width: 412, height: 892 }, deviceScaleFactor: 3.5 };

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/pw',
  timeout: 90000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'test-results/report' }]] : 'list',
  use: {
    ...pixel6pro,
    baseURL: 'http://localhost:4175/',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    acceptDownloads: true,
  },
  webServer: {
    command: 'node tools/e2e-server.mjs',
    url: 'http://localhost:4175/api/health',
    reuseExistingServer: false,
    env: { PORT: '4175', ORIGIN: 'http://localhost:4175', STATIC_DIR: 'dist', DATA_DIR: 'test-results/e2e-data', PUSH: '0' },
  },
});
