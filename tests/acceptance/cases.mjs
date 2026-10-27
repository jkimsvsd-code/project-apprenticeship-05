import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { coreScenario } from './browser-driver.mjs';

const root = process.cwd(),
  fixtureDir = path.join(root, 'tests/acceptance/fixtures');
const fixture = {
  document: JSON.parse(await readFile(path.join(fixtureDir, 'document.json'), 'utf8')),
  templates: JSON.parse(await readFile(path.join(fixtureDir, 'templates-101.json'), 'utf8')),
};
for (const name of ['red.png', 'blue.png', 'green.png', 'sample.ttf', 'sample.otf', 'invalid.ttf'])
  fixture[name] = (await readFile(path.join(fixtureDir, name))).toString('base64');
const apiUrl = '/@fs' + root + '/packages/project-archive/src/index.ts';
async function core(page, scenario) {
  return page.evaluate(coreScenario, { scenario, fixture, apiUrl });
}
async function inspect(file, ctx) {
  return JSON.parse(
    execFileSync(ctx.python, ['tests/acceptance/inspect-zip.py', file], { encoding: 'utf8' }),
  );
}
async function output(page, scenario, ctx) {
  const r = await core(page, scenario);
  assert.equal(r.unchanged, true);
  const file = path.join(ctx.dir, `${ctx.id}.zip`);
  await writeFile(file, Buffer.from(r.base64, 'base64'));
  return { ...(await inspect(file, ctx)), expectedHashes: r.hashes };
}
async function tool(page, id) {
  const panel = page.locator(`[data-tool-page="${id}"]`),
    deck = page.locator('.tool-deck-stacked').filter({ has: panel });
  await deck.locator('.tool-bookmarks').getByRole('tab', { name: '저장', exact: true }).click();
  const sub = deck.locator(`[data-tool-subpage="${id}"]`);
  if (await sub.count()) await sub.click();
  await panel.waitFor({ state: 'visible' });
  return panel;
}
async function download(page, ctx, repeat = false) {
  await tool(page, 'export');
  const pending = page.waitForEvent('download');
  void pending.catch(() => {}); // The button can be absent before implementation.
  const button = page.getByRole('button', { name: '전체 자료 ZIP 다운로드', exact: true });
  if (repeat)
    await button.evaluate((b) => {
      b.click();
      b.click();
      b.click();
    });
  else await button.click();
  const d = await pending;
  const file = path.join(ctx.dir, `${ctx.id}.zip`);
  await d.saveAs(file);
  assert.equal(await d.failure(), null);
  return { ...(await inspect(file, ctx)), file };
}

export const cases = [
  {
    id: 'ZIP-01',
    input: '2 resources / current / 2 templates / TTF+OTF',
    expected: 'all counts, raw hashes and references preserved',
    async run(page, ctx) {
      const r = await output(page, 'all', ctx);
      assert.deepEqual(r.manifest.counts, { resources: 2, templates: 2, fonts: 2, current: 1 });
      for (const hash of r.expectedHashes.filter((_, i) => i !== 1))
        assert.ok(Object.values(r.hashes).includes(hash));
      assert.ok(r.names.includes('creations/current/document.json'));
      assert.equal(r.names.filter((n) => n.startsWith('creations/templates/')).length, 2);
    },
  },
  {
    id: 'ZIP-02',
    input: 'unsaved caption edit, actual UI download',
    expected: 'current JSON and decoded PNG match editor, no template overwrite',
    async run(page, ctx) {
      const caption = page.locator('#caption');
      await page.locator('.tool-bookmarks').getByRole('tab', { name: '문구', exact: true }).click();
      for (const d of await caption.locator('xpath=ancestor::details').all())
        if ((await d.getAttribute('open')) === null) await d.locator(':scope > summary').click();
      await caption.fill('ZIP 미저장 문구');
      const expected = await page
        .locator('canvas')
        .first()
        .evaluate(async (c) => ({
          width: c.width,
          height: c.height,
          pixels: Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                c.getContext('2d').getImageData(0, 0, c.width, c.height).data,
              ),
            ),
          ),
        }));
      const r = await download(page, ctx);
      assert.ok(
        JSON.stringify(r.json['creations/current/document.json']).includes('ZIP 미저장 문구'),
      );
      const png = execFileSync(
        ctx.python,
        [
          '-c',
          'import zipfile,sys,base64; z=zipfile.ZipFile(sys.argv[1]); print(base64.b64encode(z.read("jjal-export/creations/current/preview.png")).decode())',
          r.file,
        ],
        { encoding: 'utf8' },
      ).trim();
      const actual = await page.evaluate(async (b64) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + b64;
        await image.decode();
        const c = document.createElement('canvas');
        c.width = image.width;
        c.height = image.height;
        c.getContext('2d').drawImage(image, 0, 0);
        return {
          width: c.width,
          height: c.height,
          pixels: Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                c.getContext('2d').getImageData(0, 0, c.width, c.height).data,
              ),
            ),
          ),
        };
      }, png);
      assert.deepEqual(actual, expected);
      assert.equal(r.manifest.counts.templates, 0);
    },
  },
  {
    id: 'ZIP-03',
    input: '101 stored template snapshots',
    expected: '101 distinct template JSON entries',
    async run(page, ctx) {
      const r = await output(page, '101', ctx);
      assert.equal(r.manifest.counts.templates, 101);
      const docs = Object.entries(r.json)
        .filter(([n]) => n.startsWith('creations/templates/'))
        .map(([, v]) => v);
      assert.equal(docs.length, 101);
      assert.equal(new Set(docs.map((v) => v.id)).size, 101);
    },
  },
  {
    id: 'ZIP-04',
    input: 'shared red / template-only blue / unused green',
    expected: 'three image bodies, no duplicates, all asset refs resolve',
    async run(page, ctx) {
      const r = await output(page, 'shared', ctx);
      const images = r.names.filter((n) => n.startsWith('assets/images/'));
      assert.equal(images.length, 3);
      for (const hash of r.expectedHashes.slice(0, 3))
        assert.equal(images.filter((n) => r.hashes[n] === hash).length, 1);
      for (const [name, value] of Object.entries(r.json)) {
        if (name === 'creations/current/document.json' || name.startsWith('creations/templates/'))
          for (const a of (value.document ?? value).assets)
            assert.ok(images.some((n) => r.hashes[n] === a.sha256));
      }
    },
  },
  {
    id: 'ZIP-05',
    input: 'TTF+OTF import, apply TTF, save template, reload, load template, ZIP',
    expected: 'font applied and restored, both original fonts exported',
    async run(page, ctx) {
      await tool(page, 'export');
      await page
        .getByLabel('개인 글꼴 파일', { exact: true })
        .setInputFiles([path.join(fixtureDir, 'sample.ttf'), path.join(fixtureDir, 'sample.otf')]);
      await page
        .getByLabel('개인 글꼴 선택', { exact: true })
        .selectOption({ label: 'sample.ttf' });
      await tool(page, 'library');
      await page.getByLabel('템플릿 이름', { exact: true }).fill('개인 글꼴 카드');
      await page.getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '템플릿을 저장했습니다' }).waitFor();
      await page.reload();
      await tool(page, 'library');
      await page
        .getByLabel('저장된 템플릿', { exact: true })
        .selectOption({ label: '개인 글꼴 카드' });
      await page.getByRole('button', { name: '불러오기', exact: true }).click();
      await page.getByRole('status').filter({ hasText: '사본을 불러왔습니다' }).waitFor();
      const r = await download(page, ctx);
      assert.equal(r.manifest.counts.fonts, 2);
      const current = r.json['creations/current/document.json'];
      assert.ok(current.elements.some((e) => e.style?.font.kind === 'uploaded'));
      for (const n of ['sample.ttf', 'sample.otf']) {
        const crypto = await import('node:crypto');
        const h = crypto
          .createHash('sha256')
          .update(await readFile(path.join(fixtureDir, n)))
          .digest('hex');
        assert.ok(r.names.some((p) => p.startsWith('fonts/') && r.hashes[p] === h));
      }
      const loaded = await page.evaluate(() =>
        [...document.fonts].some(
          (f) => f.status === 'loaded' && f.family.includes('jjal-uploaded-'),
        ),
      );
      assert.equal(loaded, true);
    },
  },
  {
    id: 'ZIP-06',
    input: 'text bytes disguised as invalid.ttf',
    expected: 'rejected, font library unchanged',
    async run(page) {
      assert.deepEqual(await core(page, 'invalid-font'), { rejected: true, unchanged: true });
    },
  },
  {
    id: 'ZIP-07',
    input: 'same template names and ../ Korean resource name',
    expected: 'unique safe paths, original names preserved',
    async run(page, ctx) {
      const r = await output(page, 'names', ctx);
      assert.equal(new Set(r.names).size, r.names.length);
      const t = Object.entries(r.json)
        .filter(([n]) => n.startsWith('creations/templates/'))
        .map(([, v]) => v);
      assert.equal(t.filter((v) => v.name === '../같은 이름').length, 2);
      assert.ok(JSON.stringify(r.json['resources/index.json']).includes('../../한글 파일.png'));
    },
  },
  {
    id: 'ZIP-08',
    input: 'missing image then wrong image bytes under original hash',
    expected: 'both reject, no input mutation or partial result',
    async run(page) {
      assert.deepEqual(await core(page, 'missing'), {
        missing: true,
        corrupt: true,
        unchanged: true,
      });
    },
  },
  {
    id: 'ZIP-09',
    input: '10MB font/+1; 100MB sum/+1; actual 11x9.1MB images',
    expected: 'exact limits accepted, over rejected',
    async run(page) {
      assert.deepEqual(await core(page, 'limits'), {
        over: true,
        negative: true,
        largeFont: true,
        archive: true,
      });
    },
  },
  {
    id: 'ZIP-10',
    input: 'empty libraries, current card, triple click',
    expected: 'one actual download and zero optional counts',
    async run(page, ctx) {
      let count = 0;
      page.on('download', () => count++);
      const r = await download(page, ctx, true);
      await page.waitForTimeout(800);
      assert.equal(count, 1);
      assert.deepEqual(r.manifest.counts, { resources: 0, templates: 0, fonts: 0, current: 1 });
      assert.ok(r.names.includes('creations/current/preview.png'));
    },
  },
];
