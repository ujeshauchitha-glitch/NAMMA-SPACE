import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // Parallel browsers saturate the vite dev server's on-demand transforms and
  // software-WebGL contexts, starving scene loads past the ready timeouts.
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5183',
    browserName: 'chromium',
    headless: true,
    ...devices['Desktop Chrome'],
    launchOptions: {
      args: ['--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
    },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5183 --strictPort',
    url: 'http://127.0.0.1:5183/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
