import { fillCaption, openTool, revealControl } from './ui-controls';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const fixture = (name: string) => path.resolve('tests/fixtures/images', name);
const snapshot = (page: Page) =>
  page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
const caption = (page: Page) => page.locator('#caption');
async function control(page: Page, label: string, value: string) {
  await revealControl(page, page.getByLabel(label, { exact: true }));
  await page.getByLabel(label, { exact: true }).evaluate((node, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, next);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
}
async function load(page: Page, name = 'portrait.png') {
  await openTool(page, '이미지');
  await page.getByLabel('이미지 파일').setInputFiles(fixture(name));
  await expect(page.getByRole('button', { name: 'PNG 다운로드' })).toBeEnabled();
  await expect(
    page.getByRole('region', { name: '카드 미리보기' }).locator('p[role=status]'),
  ).toContainText(name);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function compareDownload(page: Page, info: TestInfo, name: string) {
  const before = await snapshot(page);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드' }).click();
  const download = await downloaded;
  const filePath = info.outputPath(`${name}.png`);
  await download.saveAs(filePath);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(filePath);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const comparison = await page.evaluate(
    async ({ preview, output }) => {
      async function pixels(url: string) {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          bytes: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const [a, b] = await Promise.all([pixels(preview), pixels(output)]);
      let differentChannels = 0;
      for (let i = 0; i < Math.max(a.bytes.length, b.bytes.length); i++)
        if (a.bytes[i] !== b.bytes[i]) differentChannels++;
      return {
        preview: { width: a.width, height: a.height },
        download: { width: b.width, height: b.height },
        differentChannels,
        comparedChannels: a.bytes.length,
      };
    },
    { preview: before, output: `data:image/png;base64,${bytes.toString('base64')}` },
  );
  const previewBytes = Buffer.from(before.split(',')[1]!, 'base64');
  await writeFile(info.outputPath(`${name}-preview.png`), previewBytes);
  await writeFile(
    info.outputPath(`${name}-comparison.json`),
    JSON.stringify(
      {
        ...comparison,
        suggestedFilename: download.suggestedFilename(),
        previewSha256: createHash('sha256').update(previewBytes).digest('hex'),
        downloadSha256: createHash('sha256').update(bytes).digest('hex'),
      },
      null,
      2,
    ),
  );
  expect(comparison.download).toEqual(comparison.preview);
  expect(comparison.differentChannels).toBe(0);
}

test('문구 위치·크기·색이 즉시 반영되고 비율별 위치가 유지된다', async ({ page }) => {
  await page.goto('/');
  await load(page);
  await fillCaption(page, '즉시 반영\nLive 123');
  for (const [label, value] of [
    ['문구 크기', '76'],
    ['문구 색상', '#ffffff'],
    ['문구 가로 위치', '25'],
    ['문구 세로 위치', '60'],
    ['문구 폭', '50'],
  ]) {
    const before = await snapshot(page);
    await control(page, label!, value!);
    await expect.poll(() => snapshot(page)).not.toBe(before);
  }
  await page.getByRole('button', { name: '4:5', exact: true }).click();
  await expect(page.getByLabel('문구 가로 위치')).toHaveValue('10');
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  await expect(page.getByLabel('문구 가로 위치')).toHaveValue('25');
});

for (const ratio of ['1:1', '4:5', '9:16']) {
  test(`${ratio}: 잘림·줄바꿈이 있는 실제 PNG 다운로드 재개방 비교`, async ({ page }, info) => {
    await page.goto('/');
    await load(page, 'landscape.jpg');
    await page.getByRole('button', { name: ratio, exact: true }).click();
    await caption(page).fill(
      '내가 만든 오늘의 장면 🌿\n긴 문구가 카드의 폭에 맞춰 같은 위치에서 줄바꿈됩니다.\n\nLast line 123',
    );
    await control(page, '문구 크기', '62');
    await control(page, '문구 색상', '#ffffff');
    await control(page, '문구 세로 위치', '18');
    await control(page, '문구 폭', '65');
    await compareDownload(page, info, '1080-cover');
    await revealControl(page, page.getByLabel('배경 맞춤'));
    await page.getByLabel('배경 맞춤').selectOption('contain');
    await revealControl(page, page.getByLabel('출력 크기'));
    await page.getByLabel('출력 크기').selectOption('2048');
    await compareDownload(page, info, '2048-contain');
    await page.screenshot({ path: info.outputPath('editor.png'), fullPage: true });
  });
}

test('극단 입력 E01~E12와 1001자 거부 후 기존 작업 유지', async ({ page }, info) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await load(page);
  const cases = [
    ['E01', '가'.repeat(1000)],
    ['E02', '한글 English 123 !? 混合'],
    ['E03', '첫 줄\n\n마지막 줄\n'],
    ['E04', '👨‍👩‍👧‍👦 👍🏽 🇰🇷 🌿'],
    ['E05', ''],
    ['E06', 'abcdefghijklmnopqrstuvwxyz'.repeat(38)],
  ];
  const results: { id: string; result: string }[] = [];
  for (const [id, text] of cases) {
    await test.step(id!, async () => {
      await fillCaption(page, text!);
      await expect(caption(page)).toHaveValue(text!);
      await compareDownload(page, info, id!);
      results.push({ id: id!, result: 'PASS' });
    });
  }
  await fillCaption(page, '보존할 문구');
  const before = await snapshot(page);
  await fillCaption(page, '가'.repeat(1001));
  await expect(page.getByRole('alert')).toContainText('1,000');
  await expect(caption(page)).toHaveValue('보존할 문구');
  expect(await snapshot(page)).toBe(before);
  for (const [id, name] of [
    ['E07', 'portrait.png'],
    ['E08', 'landscape.jpg'],
    ['E09', 'transparent.png'],
  ]) {
    await load(page, name!);
    await compareDownload(page, info, id!);
    results.push({ id: id!, result: 'PASS' });
  }
  for (const [id, name, reason] of [
    ['E10', 'not-image.txt', '지원하지 않는'],
    ['E11', 'signature-only.png', '손상'],
  ]) {
    const preserved = await snapshot(page);
    await page.getByLabel('이미지 파일').setInputFiles(fixture(name!));
    await expect(page.getByRole('alert')).toContainText(reason!);
    await expect(caption(page)).toHaveValue('보존할 문구');
    expect(await snapshot(page)).toBe(preserved);
    await compareDownload(page, info, id!);
    results.push({ id: id!, result: 'PASS' });
  }
  await control(page, '문구 크기', '300');
  await control(page, '문구 가로 위치', '0');
  await control(page, '문구 세로 위치', '100');
  await compareDownload(page, info, 'E12');
  // y=100%는 문구 전체가 컷 밖: 빈 문구 출력과 일치해야 한다.
  const clipped = await snapshot(page);
  await fillCaption(page, '');
  expect(await snapshot(page)).toBe(clipped);
  results.push({ id: 'E12', result: 'PASS' });
  await writeFile(info.outputPath('extreme-results.json'), JSON.stringify(results, null, 2));
});

test('손상·위장·용량·픽셀·움직이는 이미지 거부 후 기존 파일 재선택', async ({ page }) => {
  await page.goto('/');
  await load(page);
  await fillCaption(page, '내 작업을 유지해 주세요');
  const before = await snapshot(page);
  const invalid = [
    { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) },
    { name: 'too-big.png', mimeType: 'image/png', buffer: Buffer.alloc(10_000_001) },
    { name: 'fake.jpg', mimeType: 'image/jpeg', buffer: await readFile(fixture('portrait.png')) },
    ...(await Promise.all(
      ['too-many-pixels.png', 'bad-compression.png', 'animated.png', 'animated.webp'].map(
        async (name) => ({
          name,
          mimeType: name.endsWith('webp') ? 'image/webp' : 'image/png',
          buffer: await readFile(fixture(name)),
        }),
      ),
    )),
  ];
  for (const file of invalid) {
    await page.getByLabel('이미지 파일').setInputFiles(file);
    await expect(page.getByRole('alert')).toContainText('기존 작업은 그대로');
    expect(await snapshot(page)).toBe(before);
    await expect(caption(page)).toHaveValue('내 작업을 유지해 주세요');
  }
  await load(page);
  expect(await snapshot(page)).toBe(before);
});

test('WebP·투명도·EXIF 방향·2048 축소 안내', async ({ page }) => {
  await page.goto('/');
  for (const name of ['static.webp', 'lossy.webp', 'alpha.webp', 'transparent.png'])
    await load(page, name);
  await fillCaption(page, '');
  const corner = await page
    .locator('canvas')
    .evaluate((node) => [
      ...(node as HTMLCanvasElement).getContext('2d')!.getImageData(300, 50, 1, 1).data,
    ]);
  expect(corner).toEqual([235, 233, 223, 255]);
  await load(page, 'rotated.jpg');
  await expect(
    page.getByRole('region', { name: '카드 미리보기' }).locator('p[role=status]'),
  ).toContainText('400 × 1200');
  await load(page, 'large.png');
  await expect(
    page.getByRole('region', { name: '카드 미리보기' }).locator('p[role=status]'),
  ).toContainText('2,048px로 줄였습니다');
});

test('늦게 완료된 이전 이미지가 새 요청을 덮지 않고 디코딩 중 문구 편집을 보존한다', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    Object.defineProperty(window, '__imageGate', {
      value: { hold: false, started: 0, finished: 0, release: () => {} },
      configurable: true,
    });
    const gate = (
      window as unknown as {
        __imageGate: { hold: boolean; started: number; finished: number; release: () => void };
      }
    ).__imageGate;
    window.createImageBitmap = (async (...args: Parameters<typeof original>) => {
      gate.started++;
      if (gate.hold)
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      try {
        return await original(...args);
      } finally {
        gate.finished++;
      }
    }) as typeof original;
  });
  await page.goto('/');
  await load(page);
  const before = await snapshot(page);
  const count = (key: 'started' | 'finished') =>
    page.evaluate(
      (field) =>
        (window as unknown as { __imageGate: { started: number; finished: number } }).__imageGate[
          field
        ],
      key,
    );
  const hold = () =>
    page.evaluate(() => {
      (window as unknown as { __imageGate: { hold: boolean } }).__imageGate.hold = true;
    });
  const release = () =>
    page.evaluate(() => {
      const gate = (window as unknown as { __imageGate: { hold: boolean; release: () => void } })
        .__imageGate;
      gate.hold = false;
      gate.release();
    });
  await hold();
  await page.getByLabel('이미지 파일').setInputFiles(fixture('landscape.jpg'));
  await expect.poll(() => count('started')).toBe(2);
  await page.getByLabel('이미지 파일').setInputFiles(fixture('not-image.txt'));
  await expect(page.getByRole('alert')).toContainText('지원하지 않는');
  await release();
  await expect.poll(() => count('finished')).toBe(2);
  expect(await snapshot(page)).toBe(before);
  await hold();
  await page.getByLabel('이미지 파일').setInputFiles(fixture('landscape.jpg'));
  await expect.poll(() => count('started')).toBe(3);
  await fillCaption(page, '이미지를 기다리며 편집한 문구');
  await release();
  await expect(
    page.getByRole('region', { name: '카드 미리보기' }).locator('p[role=status]'),
  ).toContainText('landscape.jpg');
  await expect(caption(page)).toHaveValue('이미지를 기다리며 편집한 문구');
});
