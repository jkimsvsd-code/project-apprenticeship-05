import { fillCaption, openTool, revealControl } from './ui-controls';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { TemplateBackup } from '@jjal/template-kit';

const fonts = (
  JSON.parse(readFileSync('apps/demo/public/assets/fonts/additional-manifest.json', 'utf8')) as {
    fonts: { family: string; label: string; filename: string }[];
  }
).fonts;
const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const sizes = {
  1080: [
    [1080, 1080],
    [864, 1080],
    [810, 1080],
    [720, 1080],
    [608, 1080],
    [1080, 810],
    [1080, 720],
    [1080, 608],
  ],
  2048: [
    [2048, 2048],
    [1638, 2048],
    [1536, 2048],
    [1365, 2048],
    [1152, 2048],
    [2048, 1536],
    [2048, 1365],
    [2048, 1152],
  ],
};
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const frame = (page: Page) =>
  page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
const select = (page: Page) => page.getByLabel('문구 글꼴', { exact: true });
const png = (page: Page) => page.getByRole('button', { name: 'PNG 다운로드' });
const library = (page: Page) => page.getByRole('region', { name: '내 템플릿' });
const fontUrl = (font: (typeof fonts)[number]) =>
  `**/assets/fonts/${encodeURIComponent(font.filename)}`;
const example = '오늘의 한글 이야기\n가나다 ABC 123';

async function open(page: Page) {
  await page.goto('/');
  await openTool(page, '문구');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  await expect(png(page)).toBeEnabled();
}
async function choose(page: Page, family: string) {
  await openTool(page, '문구');
  await select(page).selectOption(family);
  await expect(select(page)).toHaveValue(family);
  await expect(png(page)).toBeEnabled();
  expect(
    await page.evaluate(
      (name) =>
        [...document.fonts].some(
          (face) => face.family.replaceAll('"', '') === name && face.status === 'loaded',
        ),
      family,
    ),
  ).toBe(true);
}
async function database(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-studio-demo');
    try {
      return (await db.getAll('templates')).sort((a, b) => a.id.localeCompare(b.id));
    } finally {
      db.close();
    }
  });
}
async function save(page: Page, name: string) {
  const before = (await database(page)).length;
  await library(page).getByLabel('템플릿 이름').fill(name);
  await library(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect.poll(async () => (await database(page)).length).toBe(before + 1);
  await expect(library(page).getByRole('status')).toContainText('저장했습니다');
}
async function backup(page: Page, info: TestInfo, filename: string) {
  const pending = page.waitForEvent('download');
  await library(page).getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
  const download = await pending;
  const path = info.outputPath(filename);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  return { path, bytes: await readFile(path) };
}
async function compare(page: Page, info: TestInfo, name: string, expected: number[]) {
  const preview = await frame(page);
  const pending = page.waitForEvent('download');
  await png(page).click();
  const download = await pending;
  const path = info.outputPath(name + '.png');
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(path);
  const result = await page.evaluate(
    async ({ input, output }) => {
      async function pixels(url: string) {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const [a, b] = await Promise.all([pixels(input), pixels(output)]);
      let differentChannels = 0,
        nonOpaquePixels = 0;
      for (let i = 0; i < Math.max(a.data.length, b.data.length); i++)
        if (a.data[i] !== b.data[i]) differentChannels++;
      for (let i = 3; i < b.data.length; i += 4) if (b.data[i] !== 255) nonOpaquePixels++;
      return {
        preview: [a.width, a.height],
        download: [b.width, b.height],
        differentChannels,
        nonOpaquePixels,
        comparedChannels: a.data.length,
      };
    },
    { input: preview, output: 'data:image/png;base64,' + bytes.toString('base64') },
  );
  expect(result.preview).toEqual(expected);
  expect(result.download).toEqual(expected);
  expect(result.differentChannels).toBe(0);
  expect(result.nonOpaquePixels).toBe(0);
  const evidence = {
    ...result,
    previewSha256: hash(Buffer.from(preview.split(',')[1]!, 'base64')),
    downloadSha256: hash(bytes),
  };
  await writeFile(
    info.outputPath(name + '-preview.png'),
    Buffer.from(preview.split(',')[1]!, 'base64'),
  );
  await writeFile(info.outputPath(name + '-comparison.json'), JSON.stringify(evidence, null, 2));
  return evidence;
}

test('추가 10종: 실제 FontFace·8개 비율·두 크기의 PNG 재개방 비교', async ({ page }, info) => {
  test.setTimeout(600_000);
  const requests: { url: string; status: number }[] = [];
  page.on('response', (response) => {
    if (/\.ttf(?:\?|$)/i.test(response.url()))
      requests.push({ url: response.url(), status: response.status() });
  });
  await open(page);
  expect(requests).toHaveLength(3);
  await expect(select(page).locator('option')).toHaveCount(13);
  await fillCaption(page, example);
  await revealControl(page, page.getByLabel('문구 크기', { exact: true }));
  await page.getByLabel('문구 크기', { exact: true }).evaluate((node) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, '38');
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByLabel('문구 크기', { exact: true })).toHaveValue('38');
  const entries = [],
    shapes = [],
    metrics = [];
  const unique = new Set<string>();
  for (const [index, font] of fonts.entries()) {
    await choose(page, font.family);
    await page.getByRole('button', { name: '1:1', exact: true }).click();
    await revealControl(page, page.getByLabel('출력 크기', { exact: true }));
    await page.getByLabel('출력 크기', { exact: true }).selectOption('1080');
    const pixels = await frame(page);
    unique.add(hash(pixels));
    shapes.push({ family: font.family, label: font.label, frameSha256: hash(pixels) });
    metrics.push(
      await page.evaluate((family) => {
        const context = document.createElement('canvas').getContext('2d')!;
        context.font = `400 38px "${family}", "Noto Sans KR"`;
        const text = '가나다 ABC 123';
        const metric = context.measureText(text);
        return {
          family,
          text,
          width: metric.width,
          ascent: metric.actualBoundingBoxAscent,
          descent: metric.actualBoundingBoxDescent,
        };
      }, font.family),
    );
    for (const [ratioIndex, ratio] of ratios.entries()) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      for (const longEdge of [1080, 2048] as const) {
        await revealControl(page, page.getByLabel('출력 크기', { exact: true }));
        await page.getByLabel('출력 크기', { exact: true }).selectOption(String(longEdge));
        entries.push({
          family: font.family,
          label: font.label,
          ratio,
          longEdge,
          ...(await compare(
            page,
            info,
            `additional-${String(index + 1).padStart(2, '0')}-${ratio.replace(':', 'x')}-${longEdge}`,
            sizes[longEdge][ratioIndex]!,
          )),
        });
      }
    }
  }
  expect(unique.size).toBe(10);
  expect(entries).toHaveLength(160);
  expect(requests).toHaveLength(13);
  for (const request of requests) {
    expect(new URL(request.url).origin).toBe(new URL(page.url()).origin);
    expect(request.status).toBe(200);
  }
  await writeFile(info.outputPath('additional-matrix.json'), JSON.stringify(entries, null, 2));
  await writeFile(
    info.outputPath('additional-font-shapes.json'),
    JSON.stringify(
      {
        shapes,
        metrics,
        requests,
        faces: await page.evaluate(() =>
          [...document.fonts].map((face) => ({ family: face.family, status: face.status })),
        ),
        uniqueFrames: unique.size,
        initialRequests: 3,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('additional-font-controls.png'), fullPage: true });
});

test('추가 10종: 저장·JSON·새로고침 후 필요한 글꼴을 다시 준비하고 동일하게 복원', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await open(page);
  await fillCaption(page, example);
  const originals = [];
  for (const [index, font] of fonts.entries()) {
    await choose(page, font.family);
    await save(page, font.label);
    originals.push({ family: font.family, name: font.label, frame: await frame(page) });
    await compare(page, info, `additional-json-source-${index + 1}`, [1080, 1080]);
  }
  const before = await database(page);
  const exported = await backup(page, info, 'additional-fonts-backup.json');
  const data = JSON.parse(exported.bytes.toString('utf8')) as TemplateBackup;
  expect(data.templates).toHaveLength(10);
  expect(data.embeddedAssets).toHaveLength(0);
  await page.reload();
  await openTool(page, '문구');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  expect(await page.evaluate(() => document.fonts.size)).toBe(3);
  const initial = await frame(page);
  await library(page).getByLabel('템플릿 JSON 파일').setInputFiles(exported.path);
  await expect.poll(async () => (await database(page)).length).toBe(20);
  expect(await frame(page)).toBe(initial);
  const oldIds = new Set(before.map((row) => row.id));
  const added = (await database(page)).filter((row) => !oldIds.has(row.id));
  const restored = [];
  for (const row of added) {
    const original = originals.find((item) => item.name === row.name)!;
    await library(page).getByLabel('저장된 템플릿').selectOption(row.id);
    await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
    await expect(select(page)).toHaveValue(original.family);
    await expect.poll(async () => hash(await frame(page))).toBe(hash(original.frame));
    restored.push({
      family: original.family,
      id: row.id,
      frameSha256: hash(original.frame),
      sameFrame: true,
    });
  }
  await writeFile(
    info.outputPath('additional-json-roundtrip.json'),
    JSON.stringify(
      {
        restored,
        sourceIds: before.map((row) => row.id),
        importIds: added.map((row) => row.id),
        backupSha256: hash(exported.bytes),
        fontFilesEmbedded: false,
      },
      null,
      2,
    ),
  );
});

test('추가 글꼴 로드 실패·재시도에서 기존 작업을 보존하고 준비 전 다운로드를 막는다', async ({
  page,
}, info) => {
  await open(page);
  await fillCaption(page, '기존 작업은 그대로');
  const before = await frame(page);
  const font = fonts[0]!;
  await page.route(fontUrl(font), (route) => route.abort('failed'));
  await openTool(page, '문구');
  await select(page).selectOption(font.family);
  await expect(page.getByRole('alert')).toContainText('기존 작업은 그대로');
  await expect(select(page)).toHaveValue('Noto Sans KR');
  expect(await frame(page)).toBe(before);
  await expect(png(page)).toBeEnabled();
  await page.unroute(fontUrl(font));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(fontUrl(font), async (route) => {
    await gate;
    await route.continue();
  });
  await openTool(page, '문구');
  await select(page).selectOption(font.family);
  await expect(png(page)).toBeDisabled();
  expect(await frame(page)).toBe(before);
  release();
  await expect(select(page)).toHaveValue(font.family);
  await expect(png(page)).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await writeFile(
    info.outputPath('additional-font-retry.json'),
    JSON.stringify(
      {
        family: font.family,
        failurePreservedFrame: true,
        retryReady: true,
        blockedWhileLoading: true,
      },
      null,
      2,
    ),
  );
});

test('느린 추가 글꼴은 최신 문구를 보존하고 나중 선택·다른 컷을 덮지 않는다', async ({
  page,
}, info) => {
  await open(page);
  const first = fonts[0]!,
    second = fonts[1]!,
    third = fonts[2]!;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(fontUrl(first), async (route) => {
    await gate;
    await route.continue();
  });
  await openTool(page, '문구');
  await select(page).selectOption(first.family);
  await expect(png(page)).toBeDisabled();
  await fillCaption(page, '불러오는 동안 새로 쓴 문구');
  release();
  await expect(select(page)).toHaveValue(first.family);
  await expect(page.locator('#caption')).toHaveValue('불러오는 동안 새로 쓴 문구');
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  await page.route(fontUrl(second), async (route) => {
    await secondGate;
    await route.continue();
  });
  await openTool(page, '문구');
  await select(page).selectOption(second.family);
  await expect(png(page)).toBeDisabled();
  await choose(page, first.family);
  const selected = await frame(page);
  releaseSecond();
  await expect
    .poll(() =>
      page.evaluate(
        (name) => [...document.fonts].some((face) => face.family.replaceAll('"', '') === name),
        second.family,
      ),
    )
    .toBe(true);
  await expect(select(page)).toHaveValue(first.family);
  expect(await frame(page)).toBe(selected);
  const starters = page.getByRole('region', { name: '기본 템플릿' });
  await starters.getByRole('button', { name: '전후 비교', exact: true }).click();
  await expect(starters.getByRole('status')).toContainText('전후 비교 사본');
  let releaseThird!: () => void;
  const thirdGate = new Promise<void>((resolve) => {
    releaseThird = resolve;
  });
  await page.route(fontUrl(third), async (route) => {
    await thirdGate;
    await route.continue();
  });
  await openTool(page, '문구');
  await select(page).selectOption(third.family);
  await expect(png(page)).toBeDisabled();
  await revealControl(page, page.getByLabel('편집할 컷', { exact: true }));
  await page.getByLabel('편집할 컷', { exact: true }).selectOption({ label: '2컷' });
  const nextCut = await frame(page);
  releaseThird();
  await expect
    .poll(() =>
      page.evaluate(
        (name) => [...document.fonts].some((face) => face.family.replaceAll('"', '') === name),
        third.family,
      ),
    )
    .toBe(true);
  await expect(select(page)).toHaveValue('Noto Sans KR');
  expect(await frame(page)).toBe(nextCut);
  await writeFile(
    info.outputPath('additional-font-races.json'),
    JSON.stringify(
      { latestTextPreserved: true, laterSelectionPreserved: true, newCutNotOverwritten: true },
      null,
      2,
    ),
  );
});

test('JSON 참조 글꼴을 불러오지 못하면 기존 문서·DB를 보존하고 재시도한다', async ({
  page,
}, info) => {
  await open(page);
  const font = fonts[0]!;
  await choose(page, font.family);
  await save(page, '글꼴 포함 템플릿');
  const exported = await backup(page, info, 'font-load-failure-backup.json');
  await page.reload();
  await openTool(page, '문구');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  const before = await database(page),
    beforeFrame = await frame(page);
  await page.route(fontUrl(font), (route) => route.abort('failed'));
  await library(page).getByLabel('템플릿 JSON 파일').setInputFiles(exported.path);
  await expect(library(page).getByRole('alert')).toContainText('기존 작업과 템플릿은 그대로');
  expect(await database(page)).toEqual(before);
  expect(await frame(page)).toBe(beforeFrame);
  await page.unroute(fontUrl(font));
  await library(page).getByLabel('템플릿 JSON 파일').setInputFiles(exported.path);
  await expect.poll(async () => (await database(page)).length).toBe(2);
  expect(await frame(page)).toBe(beforeFrame);
  await writeFile(
    info.outputPath('additional-json-font-failure.json'),
    JSON.stringify(
      {
        family: font.family,
        unchangedOnFailure: true,
        importedAfterRetry: true,
        currentFramePreserved: true,
      },
      null,
      2,
    ),
  );
});
