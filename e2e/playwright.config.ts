import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  testMatch: /.*\.spec\.ts/,
  timeout: 30000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5180',
    trace: {
      mode: 'retain-on-failure',
      screenshots: false,
      snapshots: false,
      sources: true,
    },
    screenshot: 'on',
    launchOptions: {
      args: [
        '--enable-unsafe-swiftshader',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @gev/server start',
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: false,
      timeout: 20000,
    },
    {
      command: 'pnpm --filter @gev/web preview --port 5180',
      url: 'http://localhost:5180',
      reuseExistingServer: false,
      timeout: 20000,
    },
  ],
});
