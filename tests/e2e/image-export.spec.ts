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
  await page.getByLabel('파일 형식', { exact: true }).selectOption(format);
  await page.getByLabel('출력 범위', { exact: true }).selectOption(panelId);
  if (format !== 'jpg')
    await page.getByLabel('투명 배경 출력', { exact: true }).setChecked(transparent);
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

for (const config of [
  { count: 2, name: '전후 비교' },
  { count: 4, name: '짧은 이야기' },
]) {
  test(`${config.count}컷: 8비율 PNG/JPG/WebP·투명·개별 컷·저장 복원`, async ({ page }, info) => {
    test.setTimeout(480_000);
    await ready(page);
    const starters = page.getByRole('region', { name: '기본 템플릿' });
    await starters.getByRole('button', { name: config.name, exact: true }).click();
    await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
    await page.getByLabel('이미지 적용 대상').selectOption('background');
    await page
      .getByLabel('이미지 파일')
      .setInputFiles(path.resolve('tests/fixtures/images/transparent.png'));
    await expect(page.locator('.preview-panel [role=status]')).toContainText('transparent.png');
    const doc = await save(page, '출력 원본');
    const count = [];
    const preserved = new Map<string, string>();
    for (const [index, ratio] of ratios.entries()) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      const edges =
        config.count === 4 ? ([1080, 2048] as const) : ([index % 2 === 0 ? 1080 : 2048] as const);
      for (const edge of edges) {
        await page.getByLabel('출력 크기', { exact: true }).selectOption(String(edge));
        const stem = `${ratio.replace(':', 'x')}-${edge}`;
        for (const transparent of [false, true]) {
          await options(page, 'png', transparent);
          count.push(
            (
              await download(
                page,
                info,
                `${stem}-whole-${transparent}`,
                'png',
                sizes[edge][index]!,
                transparent,
                !transparent,
              )
            ).result,
          );
        }
        const cutIds =
          config.count === 4 ? doc.panels.map((panel) => panel.id) : [doc.panels[index % 2]!.id];
        for (const [cutIndex, id] of cutIds.entries()) {
          const rect = doc.layouts
            .find((layout) => layout.ratio === ratio)!
            .panels.find((panel) => panel.panelId === id)!.rect;
          // Independent dimensions from saved layout, not renderer/export helpers.
          const logical = sizes[1080][index]!;
          const w = rect.width * logical[0],
            h = rect.height * logical[1];
          const expected = [
            Math.round((w / Math.max(w, h)) * edge),
            Math.round((h / Math.max(w, h)) * edge),
          ];
          await options(page, 'jpg', false, id);
          count.push(
            (await download(page, info, `${stem}-cut-${cutIndex}-jpg`, 'jpg', expected, false))
              .result,
          );
          if (cutIndex === 0)
            for (const transparent of [false, true]) {
              await options(page, 'webp', transparent, id);
              count.push(
                (
                  await download(
                    page,
                    info,
                    `${stem}-cut-webp-${transparent}`,
                    'webp',
                    expected,
                    transparent,
                  )
                ).result,
              );
            }
        }
      }
      await page.getByLabel('출력 크기', { exact: true }).selectOption('1080');
      preserved.set(ratio, await frame(page));
    }
    await save(page, '출력 후 저장');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
      timeout: 15_000,
    });
    await library(page).getByLabel('저장된 템플릿').selectOption({ label: '출력 후 저장' });
    await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
    await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
    await expect(page.getByLabel('파일 형식', { exact: true })).toHaveValue('png');
    await expect(page.getByLabel('투명 배경 출력', { exact: true })).not.toBeChecked();
    for (const ratio of ratios) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      expect(await frame(page)).toBe(preserved.get(ratio));
    }
    await page.getByText('출력 미리보기', { exact: false }).first().click();
    await page
      .getByRole('region', { name: '이미지 출력' })
      .screenshot({ path: info.outputPath('export-tools.png') });
    await writeFile(
      info.outputPath('export-matrix.json'),
      JSON.stringify(
        {
          count: config.count,
          doc,
          outputs: count.length,
          refreshedAllEightFrames: true,
          exportOptionsSessionOnly: true,
        },
        null,
        2,
      ),
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('투명 출력·컷 경계·JPG 채움의 독립 픽셀과 잘림', async ({ page }, info) => {
  await ready(page);
  await page
    .getByRole('region', { name: '기본 템플릿' })
    .getByRole('button', { name: '전후 비교', exact: true })
    .click();
  const source = await save(page, '픽셀 원본');
  const doc = structuredClone(source);
  doc.assets = [];
  doc.panels.forEach((panel, index) => {
    panel.background = {
      color: index === 0 ? '#00ff00' : '#0000ff',
      imageAssetId: null,
      fit: 'contain',
    };
    panel.elementIds = [`rect-${index}`];
  });
  doc.elements = doc.panels.map((_panel, index) => ({
    id: `rect-${index}`,
    kind: 'bubble',
    hidden: false,
    locked: true,
    text: '',
    shape: 'caption',
    fill: index === 0 ? '#ff0000' : '#ffff00',
    border: '#ff0000',
    borderWidth: 0,
    tail: null,
    style: {
      font: { kind: 'builtin', family: 'Noto Sans KR' },
      fontSize: 20,
      color: '#000000',
      align: 'left',
      lineHeight: 1.25,
      bold: false,
    },
  }));
  doc.layouts.forEach((layout) => {
    layout.panels = doc.panels.map((panel, index) => ({
      panelId: panel.id,
      rect: { x: index * 0.5, y: 0, width: 0.5, height: 1 },
      elements: [
        {
          elementId: `rect-${index}`,
          transform: {
            x: -0.2,
            y: 0.2,
            width: 0.8,
            height: 0.4,
            rotation: 0,
            flipX: false,
            opacity: 0.5,
          },
        },
      ],
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
        name: '픽셀 기준',
        createdAt: now,
        updatedAt: now,
        document: doc,
      },
    ],
    embeddedAssets: [],
  };
  await library(page)
    .getByLabel('템플릿 JSON 파일')
    .setInputFiles({
      name: 'oracle.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await expect(library(page).getByRole('status')).toContainText('가져왔습니다');
  await library(page).getByLabel('저장된 템플릿').selectOption({ label: '픽셀 기준' });
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
  const id = await page.getByLabel('편집할 컷', { exact: true }).inputValue();
  const samples = [];
  for (const format of ['png', 'webp', 'jpg'] as const) {
    await options(page, format, true, id);
    const output = await download(
      page,
      info,
      `oracle-${format}`,
      format,
      [540, 1080],
      format !== 'jpg',
    );
    const pixels = await page.evaluate(
      async ({ data, mime }) => {
        const image = new Image();
        image.src = `data:${mime};base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        const sample = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
        return {
          inside: sample(100, 400),
          outside: sample(450, 800),
          border: sample(0, 800),
          clipped: sample(10, 400),
        };
      },
      {
        data: output.bytes.toString('base64'),
        mime: { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' }[format],
      },
    );
    if (format !== 'jpg') {
      expect(pixels.outside).toEqual([0, 0, 0, 0]);
      expect(pixels.inside[0]).toBeGreaterThanOrEqual(250);
      expect(pixels.inside[1]).toBeLessThanOrEqual(3);
      expect(pixels.inside[3]).toBe(128);
      expect(pixels.clipped[3]).toBe(128);
      expect(pixels.border).toEqual([36, 59, 53, 255]);
    } else {
      expect(pixels.outside[1]).toBeGreaterThanOrEqual(250);
      expect(pixels.outside[0]).toBeLessThanOrEqual(3);
      expect(pixels.outside[3]).toBe(255);
      expect(Math.abs(pixels.inside[0]! - 128)).toBeLessThanOrEqual(4);
      expect(Math.abs(pixels.inside[1]! - 127)).toBeLessThanOrEqual(4);
    }
    samples.push({ format, pixels });
  }
  // Returning to PNG restores its transparency choice; export settings do not mutate artwork.
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await expect(page.getByLabel('투명 배경 출력')).toBeChecked();
  await writeFile(
    info.outputPath('export-pixel-oracle.json'),
    JSON.stringify(
      { samples, knownBounds: true, backgroundRemoved: true, borderRetained: true },
      null,
      2,
    ),
  );
});

test('느린 인코딩·형식 미지원·잘못된 입력 후 최신 출력과 기존 작업 유지', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const encode = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type === 'image/webp') return encode.call(this, callback, 'image/png');
      if (type === 'image/jpeg')
        return encode.call(this, (blob) => setTimeout(() => callback(blob), 700), type, quality);
      return encode.call(this, callback, type, quality);
    };
  });
  await ready(page);
  await page.locator('#caption').fill('보존할 문구');
  const before = await frame(page);
  await page.getByLabel('파일 형식', { exact: true }).selectOption('jpg');
  await page.getByLabel('파일 형식', { exact: true }).selectOption('webp');
  await expect(page.getByRole('alert')).toContainText('지원하지 않습니다');
  await expect(page.getByRole('button', { name: 'WebP 다운로드' })).toBeDisabled();
  expect(await frame(page)).toBe(before);
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await expect(page.getByRole('button', { name: 'PNG 다운로드' })).toBeEnabled();
  await page
    .getByLabel('이미지 파일')
    .setInputFiles(path.resolve('tests/fixtures/images/not-image.txt'));
  await expect(page.getByRole('alert')).toContainText('기존 작업');
  await expect(page.locator('#caption')).toHaveValue('보존할 문구');
  expect(await frame(page)).toBe(before);
  await expect(page.getByRole('button', { name: 'JPG 다운로드' })).toHaveCount(0);
  await download(page, info, 'preserved-latest', 'png', [1080, 1080], false, true);
  await writeFile(
    info.outputPath('export-failure-preservation.json'),
    JSON.stringify(
      {
        simulatedBrowserCapabilityFallback: true,
        delayedJpegMilliseconds: 700,
        invalidImageRejected: true,
        framePreserved: true,
        latestPng: true,
      },
      null,
      2,
    ),
  );
});
