import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const working = path.resolve(
  '../local-only/jjal-card-studio-plan/working/S01-024-browser-comments',
);
const run = process.env.BROWSER_COMMENTS_RUN ?? 'B';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['browser-comments-refinement.spec.ts', 'layer-state-badges.spec.ts'],
  fullyParallel: true,
  workers: 2,
  retries: 0,
  globalTimeout: 900_000,
  outputDir: path.join(working, `browser-${run}`),
  reporter: [['list'], ['json', { outputFile: path.join(working, `browser-${run}-results.json`) }]],
  use: {
    baseURL: 'http://127.0.0.1:4190',
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1610, height: 892 } },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    {
      name: 'landscape-chromium',
      grep: /@layout/,
      use: { ...devices['Pixel 7'], viewport: { width: 932, height: 430 } },
    },
  ],
  webServer: [],
});
