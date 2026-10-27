import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const working = path.resolve('../local-only/jjal-card-studio-plan/working/S01-022-resource-tools');
const run = process.env.RESOURCE_TOOLS_RUN ?? 'B';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'resource-tools-refinement.spec.ts',
  fullyParallel: true,
  workers: 2,
  globalTimeout: 900_000,
  retries: 0,
  outputDir: path.join(working, `browser-${run}`),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(working, `browser-${run}-results.json`) }],
    ['html', { open: 'never', outputFolder: path.join(working, `browser-${run}-report`) }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4190',
    channel: 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [],
});
