import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const run = process.env.EDITORIAL_TEST_RUN ?? 'A';

export default defineConfig({
  ...base,
  testMatch: ['editorial-*.spec.ts'],
  outputDir: `../local-only/jjal-card-studio-plan/working/S01-021-editorial-workspace/browser-${run}`,
  reporter: [
    ['list'],
    [
      'json',
      {
        outputFile: `../local-only/jjal-card-studio-plan/working/S01-021-editorial-workspace/browser-${run}-results.json`,
      },
    ],
  ],
  use: { ...base.use, baseURL: 'http://127.0.0.1:4190', channel: 'msedge' },
  webServer: [],
});
