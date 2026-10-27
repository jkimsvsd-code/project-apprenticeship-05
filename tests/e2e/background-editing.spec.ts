import { fillCaption, openTool, revealControl } from './ui-controls';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { StudioDocument } from '@jjal/document-model';

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
} as const;
type Format = 'png' | 'jpg' | 'webp';
const label = (format: Format) => `${format === 'webp' ? 'WebP' : format.toUpperCase()} 다운로드`;
const library = (page: Page) => page.getByRole('region', { name: '내 템플릿' });
const frame = (page: Page) =>
  page.locator('canvas').evaluate((node) => (node as HTMLCanvasElement).toDataURL());
async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 15_000,
  });
}
async function save(page: Page, name: string): Promise<StudioDocument> {
  await library(page).getByLabel('템플릿 이름').fill(name);
  await library(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('저장했습니다');
  return page.evaluate(async (name) => {
    const modulePath = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-studio-demo');
    try {
      return (await db.getAll('templates')).find((row) => row.name === name)!.document;
    } finally {
      db.close();
    }
  }, name);
}
async function options(page: Page, format: Format, transparent: boolean, panelId = '') {
  await revealControl(page, page.getByLabel('파일 형식', { exact: true }));
  await page.getByLabel('파일 형식', { exact: true }).selectOption(format);
  await revealControl(page, page.getByLabel('출력 범위', { exact: true }));
  await page.getByLabel('출력 범위', { exact: true }).selectOption(panelId);
  if (format !== 'jpg') {
    await revealControl(page, page.getByLabel('투명 배경 출력', { exact: true }));
    await page.getByLabel('투명 배경 출력', { exact: true }).setChecked(transparent);
  }
  await expect(page.getByRole('button', { name: label(format) })).toBeEnabled();
}
async function download(
  page: Page,
  info: TestInfo,
  name: string,
  format: Format,
  expected: readonly number[],
  transparent: boolean,
  compareEditor = false,
) {
  const preview = await page.getByAltText('실제 다운로드 파일 미리보기').evaluate(async (node) => {
    const blob = await (await fetch((node as HTMLImageElement).src)).blob();
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: label(format) }).click();
  const file = await pending;
  const output = info.outputPath(`${name}.${format}`);
  await file.saveAs(output);
  expect(await file.failure()).toBeNull();
  const bytes = await readFile(output);
  const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
  expect(hash(bytes)).toBe(hash(Uint8Array.from(preview)));
  if (format === 'png')
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  if (format === 'jpg') expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
  if (format === 'webp') {
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
    expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
  }
  expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${format}$`));
  const comparison = await page.evaluate(
    async ({ data, mime, compareEditor }) => {
      const image = new Image();
      image.src = `data:${mime};base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let transparentPixels = 0,
        partialPixels = 0,
        opaquePixels = 0,
        differentChannels = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) transparentPixels++;
        else if (pixels[i] === 255) opaquePixels++;
        else partialPixels++;
      }
      if (compareEditor) {
        const source = document.querySelector('canvas')!;
        const editor = source
          .getContext('2d')!
          .getImageData(0, 0, source.width, source.height).data;
        for (let i = 0; i < Math.max(editor.length, pixels.length); i++)
          if (editor[i] !== pixels[i]) differentChannels++;
      }
      return {
        width: canvas.width,
        height: canvas.height,
        transparentPixels,
        partialPixels,
        opaquePixels,
        editorDifferentChannels: compareEditor ? differentChannels : null,
      };
    },
    {
      data: bytes.toString('base64'),
      mime: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format],
      compareEditor,
    },
  );
  expect([comparison.width, comparison.height]).toEqual(expected);
  if (transparent) expect(comparison.transparentPixels).toBeGreaterThan(0);
  else {
    expect(comparison.transparentPixels).toBe(0);
    expect(comparison.partialPixels).toBe(0);
  }
  expect(comparison.opaquePixels).toBeGreaterThan(0);
  if (compareEditor) expect(comparison.editorDifferentChannels).toBe(0);
  const result = {
    name,
    format,
    transparent,
    ...comparison,
    previewSha256: hash(Uint8Array.from(preview)),
    downloadSha256: hash(bytes),
    suggestedFilename: file.suggestedFilename(),
    bytes: bytes.length,
  };
  await writeFile(info.outputPath(`${name}-comparison.json`), JSON.stringify(result, null, 2));
  return { result, bytes };
}

const bg = (page: Page) => page.getByRole('region', { name: '배경 편집' });
async function number(page: Page, name: string, value: number) {
  await revealControl(page, bg(page).getByLabel(name, { exact: true }));
  await openTool(page, '이미지');
  await bg(page).getByLabel(name, { exact: true }).fill(String(value));
  await openTool(page, '이미지');
  await bg(page).getByLabel(name, { exact: true }).press('Enter');
  await expect(bg(page).getByLabel(name, { exact: true })).toHaveValue(String(value));
}
async function image(page: Page, result: boolean, name: string) {
  await revealControl(page, bg(page).getByLabel(result ? '배경 보정 결과 파일' : '배경 원본 파일'));
  await openTool(page, '이미지');
  await bg(page)
    .getByLabel(result ? '배경 보정 결과 파일' : '배경 원본 파일')
    .setInputFiles(path.resolve('tests/fixtures/images', name));
  await expect(bg(page).getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}
async function restore(page: Page, name: string) {
  await library(page).getByLabel('저장된 템플릿').selectOption({ label: name });
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
}
for (const config of [
  { count: 2, name: '전후 비교' },
  { count: 4, name: '짧은 이야기' },
]) {
  test(`${config.count}컷 배경: 전체/컷별 8비율·원본/결과·저장/JSON·출력`, async ({
    page,
  }, info) => {
    test.setTimeout(360_000);
    await ready(page);
    const starters = page.getByRole('region', { name: '기본 템플릿' });
    await starters.getByRole('button', { name: config.name, exact: true }).click();
    await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
    await openTool(page, '이미지');
    await bg(page).getByLabel('배경 적용 범위').selectOption('whole');
    await image(page, false, 'landscape.jpg');
    const original = await frame(page);
    await image(page, true, 'transparent.png');
    const result = await frame(page);
    expect(result).not.toBe(original);
    await openTool(page, '이미지');
    await bg(page).getByRole('button', { name: '원본 이미지로 복귀', exact: true }).click();
    expect(await frame(page)).toBe(original);
    await openTool(page, '이미지');
    await bg(page).getByRole('button', { name: '보정 결과 다시 보기', exact: true }).click();
    expect(await frame(page)).toBe(result);
    await openTool(page, '이미지');
    await bg(page).getByRole('button', { name: '원본 이미지로 복귀', exact: true }).click();
    await openTool(page, '이미지');
    await bg(page).getByLabel('배경 맞춤').selectOption('contain');
    const wholeFrames: Record<string, string> = {};
    for (const [index, ratio] of ratios.entries()) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await number(page, '배경 가로 위치', 5 + index);
      await number(page, '배경 세로 위치', -4 - index);
      await number(page, '배경 확대', 110 + index * 5);
      await options(page, 'png', false);
      await download(
        page,
        info,
        `whole-${ratio.replace(':', 'x')}`,
        'png',
        sizes[1080][index]!,
        false,
        true,
      );
      wholeFrames[ratio] = await frame(page);
    }
    const whole = await save(page, '전체 배경');
    expect(whole.background!.imageAssetId).toBe(whole.background!.originalImageAssetId);
    expect(whole.background!.resultImageAssetId).toBeTruthy();
    expect(whole.panels.every((panel) => panel.background.inherit)).toBe(true);
    await revealControl(page, page.getByLabel('편집할 컷', { exact: true }));
    await page.getByLabel('편집할 컷', { exact: true }).selectOption(whole.panels[1]!.id);
    await openTool(page, '이미지');
    await bg(page).getByLabel('배경 적용 범위').selectOption('panel');
    await image(page, false, 'portrait.png');
    await image(page, true, 'static.webp');
    await openTool(page, '이미지');
    await bg(page).getByLabel('배경 맞춤').selectOption('cover');
    const finalFrames: Record<string, string> = {};
    for (const [index, ratio] of ratios.entries()) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await number(page, '배경 가로 위치', -10 - index);
      await number(page, '배경 세로 위치', 6 + index);
      await number(page, '배경 확대', 150 + index * 5);
      const rect = whole.layouts.find((layout) => layout.ratio === ratio)!.panels[1]!.rect;
      // Independently compare every pixel outside the edited panel at the same resolution.
      const outside = await page.evaluate(
        async ({ before, rect }) => {
          const image = new Image();
          image.src = before;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          const a = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const b = document
            .querySelector('canvas')!
            .getContext('2d')!
            .getImageData(0, 0, canvas.width, canvas.height).data;
          let differences = 0;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
              if (
                x >= Math.floor(rect.x * canvas.width) - 1 &&
                x <= Math.ceil((rect.x + rect.width) * canvas.width) + 1 &&
                y >= Math.floor(rect.y * canvas.height) - 1 &&
                y <= Math.ceil((rect.y + rect.height) * canvas.height) + 1
              )
                continue;
              const p = (y * canvas.width + x) * 4;
              for (let c = 0; c < 4; c++) if (a[p + c] !== b[p + c]) differences++;
            }
          return differences;
        },
        { before: wholeFrames[ratio]!, rect },
      );
      expect(outside).toBe(0);
      await revealControl(page, page.getByLabel('출력 크기', { exact: true }));
      await page.getByLabel('출력 크기', { exact: true }).selectOption('2048');
      await options(page, 'png', false);
      await download(
        page,
        info,
        `panel-${ratio.replace(':', 'x')}`,
        'png',
        sizes[2048][index]!,
        false,
        true,
      );
      finalFrames[ratio] = await frame(page);
      await revealControl(page, page.getByLabel('출력 크기', { exact: true }));
      await page.getByLabel('출력 크기', { exact: true }).selectOption('1080');
    }
    const saved = await save(page, '컷별 배경');
    expect(saved.background).toEqual(whole.background);
    expect(saved.elements).toEqual(whole.elements);
    expect(saved.panels[0]!.background.inherit).toBe(true);
    expect(saved.panels[1]!.background.inherit).toBe(false);
    expect(
      saved.assets.filter((asset) =>
        [
          saved.background!.originalImageAssetId,
          saved.background!.resultImageAssetId,
          saved.panels[1]!.background.originalImageAssetId,
          saved.panels[1]!.background.resultImageAssetId,
        ].includes(asset.id),
      ),
    ).toHaveLength(4);
    for (const [index, ratio] of ratios.entries()) {
      const layout = saved.layouts.find((layout) => layout.ratio === ratio)!;
      expect(layout.background!.x).toBeCloseTo((5 + index) / 100);
      expect(layout.panels[1]!.background!.x).toBeCloseTo((-10 - index) / 100);
    }
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
      timeout: 15_000,
    });
    await restore(page, '컷별 배경');
    await revealControl(page, page.getByLabel('출력 크기', { exact: true }));
    await page.getByLabel('출력 크기', { exact: true }).selectOption('2048');
    for (const ratio of ratios) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      expect(await frame(page)).toBe(finalFrames[ratio]);
    }
    await library(page).getByLabel('JSON 범위').selectOption('selected');
    const pending = page.waitForEvent('download');
    await library(page).getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
    const jsonPath = info.outputPath('background-backup.json');
    await (await pending).saveAs(jsonPath);
    const ids = await library(page)
      .getByLabel('저장된 템플릿')
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    await library(page).getByLabel('템플릿 JSON 파일').setInputFiles(jsonPath);
    await expect(library(page).getByRole('status')).toContainText('가져왔습니다');
    const imported = await library(page)
      .getByLabel('저장된 템플릿')
      .locator('option')
      .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
    const id = imported.find((id) => !ids.includes(id))!;
    await library(page).getByLabel('저장된 템플릿').selectOption(id);
    await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
    await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
    for (const ratio of ratios) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      expect(await frame(page)).toBe(finalFrames[ratio]);
    }
    await revealControl(page, page.getByLabel('편집할 컷', { exact: true }));
    await page.getByLabel('편집할 컷', { exact: true }).selectOption({ index: 1 });
    await openTool(page, '이미지');
    await bg(page).getByRole('button', { name: '원본 이미지로 복귀', exact: true }).click();
    const originalAgain = await frame(page);
    expect(originalAgain).not.toBe(finalFrames['16:9']);
    await openTool(page, '이미지');
    await bg(page).getByRole('button', { name: '보정 결과 다시 보기', exact: true }).click();
    expect(await frame(page)).toBe(finalFrames['16:9']);
    await openTool(page, '이미지');
    await bg(page).getByRole('button', { name: '이 컷에 전체 배경 사용', exact: true }).click();
    await revealControl(page, page.getByLabel('출력 크기', { exact: true }));
    await page.getByLabel('출력 크기', { exact: true }).selectOption('1080');
    expect(await frame(page)).toBe(wholeFrames['16:9']);
    await openTool(page, '이미지');
    await bg(page).screenshot({ path: info.outputPath('background-tools.png') });
    await writeFile(
      info.outputPath('background-lifecycle.json'),
      JSON.stringify(
        {
          whole,
          saved,
          originalResultRoundTrip: true,
          allEightRefreshAndJsonFramesEqual: true,
          outsidePanelRgbaDifferences: 0,
        },
        null,
        2,
      ),
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('배경 마우스/터치 이동·잘못된 입력·늦은 이미지가 기존 작업을 보존한다', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    Object.defineProperty(window, 'createImageBitmap', {
      value: async (input: ImageBitmapSource, options?: ImageBitmapOptions) => {
        if (input instanceof Blob && document.documentElement.dataset.delayBackground === 'armed') {
          delete document.documentElement.dataset.delayBackground;
          document.documentElement.dataset.slowBitmap = 'pending';
          await new Promise<void>((resolve) =>
            window.addEventListener('release-slow-background', () => resolve(), { once: true }),
          );
          document.documentElement.dataset.slowBitmap = 'done';
        }
        return original(input, options);
      },
    });
  });
  await ready(page);
  await openTool(page, '이미지');
  await bg(page).getByLabel('배경 적용 범위').selectOption('whole');
  await image(page, false, 'portrait.png');
  await openTool(page, '이미지');
  await bg(page).getByLabel('배경 드래그 모드').check();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('canvas').boundingBox())!;
  const from = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.4 };
  const to = { x: from.x + box.width * 0.1, y: from.y + box.height * 0.07 };
  if (info.project.name === 'mobile-chromium') {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
  }
  const moved = await save(page, '드래그');
  expect(moved.layouts[0]!.background!.x).toBeCloseTo(0.1, 2);
  expect(moved.layouts[0]!.background!.y).toBeCloseTo(0.07, 2);
  const before = await frame(page);
  for (const [label, value] of [
    ['배경 가로 위치', 201],
    ['배경 확대', 0],
  ] as const) {
    await openTool(page, '이미지');
    await revealControl(page, bg(page).getByLabel(label));
    await bg(page).getByLabel(label).fill(String(value));
    await openTool(page, '이미지');
    await bg(page).getByLabel(label).press('Enter');
    await expect(page.getByRole('alert')).toContainText('기존 작업');
    expect(await frame(page)).toBe(before);
  }
  await openTool(page, '이미지');
  await bg(page)
    .getByLabel('배경 보정 결과 파일')
    .setInputFiles(path.resolve('tests/fixtures/images/not-image.txt'));
  await expect(page.getByRole('alert')).toContainText('기존 작업');
  expect(await frame(page)).toBe(before);
  await openTool(page, '이미지');
  await bg(page).getByRole('button', { name: '현재 비율 배경 배치 초기화' }).click();
  await expect(bg(page).getByLabel('배경 가로 위치', { exact: true })).toHaveValue('0');
  const buffer = await readFile(path.resolve('tests/fixtures/images/transparent.png'));
  await page.evaluate(() => {
    document.documentElement.dataset.delayBackground = 'armed';
  });
  await openTool(page, '이미지');
  await bg(page)
    .getByLabel('배경 원본 파일')
    .setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer });
  await expect(page.locator('html')).toHaveAttribute('data-slow-bitmap', 'pending');
  await fillCaption(page, '배경 입력 중 최신 문구');
  await page.evaluate(() => window.dispatchEvent(new Event('release-slow-background')));
  await expect(bg(page).getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('바뀌었습니다');
  const preserved = await save(page, '보존');
  expect(preserved.background!.imageAssetId).toBe(moved.background!.imageAssetId);
  expect(
    preserved.elements.some(
      (element) => 'text' in element && element.text === '배경 입력 중 최신 문구',
    ),
  ).toBe(true);
  await page.evaluate(() => {
    document.documentElement.dataset.delayBackground = 'armed';
  });
  await revealControl(page, page.getByLabel('이미지 적용 대상'));
  await page.getByLabel('이미지 적용 대상').selectOption('background');
  await page
    .getByLabel('이미지 파일', { exact: true })
    .setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer });
  await expect(page.locator('html')).toHaveAttribute('data-slow-bitmap', 'pending');
  await image(page, false, 'landscape.jpg');
  const newest = await frame(page);
  await page.evaluate(() => window.dispatchEvent(new Event('release-slow-background')));
  await expect(page.locator('html')).toHaveAttribute('data-slow-bitmap', 'done');
  expect(await frame(page)).toBe(newest);
  await openTool(page, '이미지');
  await bg(page).getByLabel('배경 적용 범위').selectOption('panel');
  await openTool(page, '이미지');
  await bg(page).getByRole('button', { name: '이 컷에서 독립 편집', exact: true }).click();
  await openTool(page, '이미지');
  await bg(page).getByLabel('배경 드래그 모드').check();
  await openTool(page, '이미지');
  await bg(page).getByRole('button', { name: '이 컷에 전체 배경 사용', exact: true }).click();
  await expect(bg(page).getByLabel('배경 드래그 모드')).toBeEnabled();
  await openTool(page, '이미지');
  await bg(page).getByLabel('배경 드래그 모드').uncheck();
  await options(page, 'png', false);
  await download(page, info, 'background-preserved', 'png', [1080, 1080], false, true);
  await writeFile(
    info.outputPath('background-pointer-preservation.json'),
    JSON.stringify(
      {
        moved,
        preserved,
        invalidChangesPreserved: true,
        lateBackgroundRejected: true,
        pointer: info.project.name,
      },
      null,
      2,
    ),
  );
});

test('독립 픽셀로 전체 배경의 연속성·개별 컷·보정/원본·투명 출력을 검증한다', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await ready(page);
  await page
    .getByRole('region', { name: '기본 템플릿' })
    .getByRole('button', { name: '전후 비교', exact: true })
    .click();
  await openTool(page, '이미지');
  await bg(page).getByLabel('배경 적용 범위').selectOption('whole');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 120, 120);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(120, 0, 120, 120);
    return canvas.toDataURL().split(',')[1]!;
  });
  await openTool(page, '이미지');
  await bg(page)
    .getByLabel('배경 원본 파일')
    .setInputFiles({
      name: 'oracle.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
  await expect(bg(page).getByRole('status')).toHaveCount(0);
  const doc = await save(page, '연속 배경');
  const original = doc.assets.find((asset) => asset.id === doc.background!.imageAssetId)!;
  doc.assets = [original];
  doc.elements = [];
  doc.background!.color = '#00ff00';
  doc.background!.fit = 'contain';
  doc.panels.forEach((panel) => {
    panel.elementIds = [];
    panel.background = { color: '#00ff00', imageAssetId: null, fit: 'contain', inherit: true };
  });
  doc.layouts.forEach((layout) => {
    layout.panels = doc.panels.map((panel, index) => ({
      panelId: panel.id,
      rect: { x: index * 0.5, y: 0, width: 0.5, height: 1 },
      elements: [],
    }));
  });
  const now = new Date().toISOString();
  const backup = {
    kind: 'jjal-template-backup',
    schemaVersion: 1,
    exportedAt: now,
    templates: [
      {
        kind: 'jjal-template',
        schemaVersion: 1,
        id: 'oracle',
        name: '연속 픽셀',
        createdAt: now,
        updatedAt: now,
        document: doc,
      },
    ],
    embeddedAssets: [{ sha256: original.sha256, base64: png }],
  };
  await library(page)
    .getByLabel('템플릿 JSON 파일')
    .setInputFiles({
      name: 'oracle.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await expect(library(page).getByRole('status')).toContainText('가져왔습니다');
  await restore(page, '연속 픽셀');
  const pixel = (x: number, y: number) =>
    page
      .locator('canvas')
      .evaluate(
        (node, { x, y }) => [
          ...(node as HTMLCanvasElement).getContext('2d')!.getImageData(x, y, 1, 1).data,
        ],
        { x, y },
      );
  expect(await pixel(270, 540)).toEqual([255, 0, 0, 255]);
  expect(await pixel(810, 540)).toEqual([0, 0, 255, 255]);
  expect(await pixel(270, 100)).toEqual([0, 255, 0, 255]);
  const panels = await page
    .getByLabel('편집할 컷', { exact: true })
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  for (const [index, id] of panels.entries()) {
    await options(page, 'png', false, id);
    const file = await download(page, info, `continuous-cut-${index}`, 'png', [540, 1080], false);
    const sample = await page.evaluate(async (data) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 540;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      return [...ctx.getImageData(270, 540, 1, 1).data];
    }, file.bytes.toString('base64'));
    expect(sample).toEqual(index === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
  }
  await options(page, 'png', true);
  const transparent = await download(
    page,
    info,
    'continuous-transparent',
    'png',
    [1080, 1080],
    true,
  );
  await openTool(page, '이미지');
  await bg(page).getByLabel('배경 적용 범위').selectOption('whole');
  await number(page, '배경 가로 위치', 100);
  expect(await pixel(270, 540)).toEqual([0, 255, 0, 255]);
  await number(page, '배경 가로 위치', 0);
  await number(page, '배경 확대', 200);
  expect(await pixel(270, 100)).toEqual([255, 0, 0, 255]);
  await openTool(page, '이미지');
  await bg(page).getByRole('button', { name: '현재 비율 배경 배치 초기화' }).click();
  const transformed = await page.evaluate(
    (base64) =>
      new Promise<string>((resolve, reject) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        image.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 240;
          canvas.height = 120;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          ctx.clearRect(80, 40, 80, 40);
          resolve(canvas.toDataURL().split(',')[1]!);
        };
        image.onerror = () => reject(new Error('fixture decode'));
      }),
    png,
  );
  await openTool(page, '이미지');
  await bg(page)
    .getByLabel('배경 보정 결과 파일')
    .setInputFiles({
      name: 'oracle-result.png',
      mimeType: 'image/png',
      buffer: Buffer.from(transformed, 'base64'),
    });
  await expect(bg(page).getByRole('status')).toHaveCount(0);
  expect(await pixel(530, 540)).toEqual([0, 255, 0, 255]);
  await options(page, 'jpg', false);
  await download(page, info, 'continuous-result-jpg', 'jpg', [1080, 1080], false);
  await openTool(page, '이미지');
  await bg(page).getByRole('button', { name: '원본 이미지로 복귀', exact: true }).click();
  expect(await pixel(530, 540)).toEqual([255, 0, 0, 255]);
  const final = await save(page, '원본 복귀');
  expect(final.background!.resultImageAssetId).toBeTruthy();
  await writeFile(
    info.outputPath('background-pixel-oracle.json'),
    JSON.stringify(
      {
        final,
        continuousCutCenterColors: [
          [255, 0, 0, 255],
          [0, 0, 255, 255],
        ],
        uncoveredGreen: true,
        removedBackgroundAlphaPixels: transparent.result.transparentPixels,
        movedAndZoomedPixels: true,
        originalRestoredWithResultRetained: true,
      },
      null,
      2,
    ),
  );
});
