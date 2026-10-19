import { defineConfig, devices } from '@playwright/test';
const library = `work/e2e-${Date.now()}-${process.pid}`;
export default defineConfig({
  testDir: './e2e', timeout: 45000, expect: { timeout: 10000 },
  fullyParallel: false, workers: 1, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:19843', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'unit', testDir: './e2e/unit' },
    { name: 'chromium', testIgnore: 'unit/**', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testIgnore: 'unit/**', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: 'unit/**', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: `cargo run -- serve --port 19843 --data-dir ${library}`,
    url: 'http://127.0.0.1:19843', reuseExistingServer: false, timeout: 120000,
  },
});
