/* eslint-disable no-empty -- expected errors and readiness probes */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cases } from '../../tests/acceptance/cases.mjs';
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const phase = arg('--phase', 'prepare'),
  startedAt = new Date().toISOString();
const round = startedAt.replace(/[:.]/g, '-');
const out = path.resolve('evidence/runs/run-001/test-runs', `${phase}-${round}.json`);
const dir = path.resolve('.local/acceptance', `${phase}-${round}`);
await mkdir(dir, { recursive: true });
const python = process.env.PYTHON ?? 'python3';
const report = {
  phase,
  startedAt,
  sourceVersion: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  cases: [],
  fixturePreflight: false,
};
let browser, server;
try {
  if (existsSync('protocol/frozen-files.json'))
    execFileSync(process.execPath, ['tools/integrity/verify.mjs'], { stdio: 'inherit' });
  server = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'apps/demo',
      '--host',
      '127.0.0.1',
      '--port',
      '4175',
      '--strictPort',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let serverLog = '';
  server.stdout.on('data', (b) => (serverLog += b));
  server.stderr.on('data', (b) => (serverLog += b));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch('http://127.0.0.1:4175')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error('Vite startup failed: ' + serverLog);
  browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
    headless: true,
  });
  // Validate the test oracle itself before executing product tests.
  const check = await browser.newPage();
  await check.goto('http://127.0.0.1:4175');
  const fixtureDir = path.resolve('tests/acceptance/fixtures');
  const fixture = {
    document: JSON.parse(await readFile(path.join(fixtureDir, 'document.json'), 'utf8')),
  };
  for (const n of ['sample.ttf', 'sample.otf'])
    fixture[n] = (await readFile(path.join(fixtureDir, n))).toString('base64');
  await check.evaluate(
    async ({ fixture, moduleUrl }) => {
      const { parseDocument } = await import(/* @vite-ignore */ moduleUrl);
      parseDocument(fixture.document);
      for (const n of ['sample.ttf', 'sample.otf']) {
        const b = Uint8Array.from(atob(fixture[n]), (c) => c.charCodeAt(0));
        await new FontFace('Oracle-' + n, b).load();
      }
    },
    { fixture, moduleUrl: '/@fs' + process.cwd() + '/packages/document-model/src/index.ts' },
  );
  report.fixturePreflight = true;
  await check.close();
  if (cases.length !== 10 || new Set(cases.map((c) => c.id)).size !== 10)
    throw new Error('Exactly ten unique cases required');
  for (const item of cases) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    const before = Date.now();
    const row = { id: item.id, input: item.input, expected: item.expected, status: 'FAIL' };
    try {
      await page.goto('http://127.0.0.1:4175');
      await page.locator('canvas').first().waitFor();
      await item.run(page, { dir, id: item.id, python });
      row.status = 'PASS';
    } catch (error) {
      row.error = String(error.message).replaceAll(process.cwd(), '[workspace]').slice(0, 2000);
    }
    row.durationMs = Date.now() - before;
    report.cases.push(row);
    console.log(row.id, row.status, row.error?.split('\n')[0] ?? '');
    await context.close();
  }
  report.passed = report.cases.filter((c) => c.status === 'PASS').length;
  report.failed = 10 - report.passed;
} catch (error) {
  report.infrastructureError = String(error.message);
  console.error(report.infrastructureError);
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
  report.finishedAt = new Date().toISOString();
  report.complete = report.cases.length === 10;
  report.errorRound = report.complete ? report.cases.some((c) => c.status === 'FAIL') : null;
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(out);
}
if (!report.complete || report.failed) process.exitCode = 1;
