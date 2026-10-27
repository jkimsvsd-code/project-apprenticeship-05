import { fillCaption, selectLayer, openTool, revealControl } from './ui-controls';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
import type { TemplateBackup } from '@jjal/template-kit';

const starters = [
  { name: '감정 한마디', slug: 'emotion', panels: 1 },
  { name: '두 캐릭터 대화', slug: 'conversation', panels: 1 },
  { name: '전후 비교', slug: 'before-after', panels: 2 },
  { name: '상황과 반응', slug: 'situation-reaction', panels: 2 },
  { name: '짧은 이야기', slug: 'short-story', panels: 4 },
  { name: '대화와 반전', slug: 'conversation-twist', panels: 4 },
] as const;
const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const fonts = ['Noto Sans KR', 'Noto Serif KR', 'Jua'] as const;
const expectedSizes = {
  1080: {
    '1:1': [1080, 1080],
    '4:5': [864, 1080],
    '3:4': [810, 1080],
    '2:3': [720, 1080],
    '9:16': [608, 1080],
    '4:3': [1080, 810],
    '3:2': [1080, 720],
    '16:9': [1080, 608],
  },
  2048: {
    '1:1': [2048, 2048],
    '4:5': [1638, 2048],
    '3:4': [1536, 2048],
    '2:3': [1365, 2048],
    '9:16': [1152, 2048],
    '4:3': [2048, 1536],
    '3:2': [2048, 1365],
    '16:9': [2048, 1152],
  },
} as const;

const library = (page: Page) => page.getByRole('region', { name: '내 템플릿' });
const caption = (page: Page) => page.locator('#caption');
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const frame = (page: Page) =>
  page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));

async function database(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-studio-demo');
    try {
      const templates = (await db.getAll('templates')).sort((a, b) => a.id.localeCompare(b.id));
      const assets = await Promise.all(
        (await db.getAll('assets')).map(async ({ sha256, blob }) => ({
          sha256,
          byteLength: blob.size,
          actualSha256: Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
            (value) => value.toString(16).padStart(2, '0'),
          ).join(''),
        })),
      );
      return { templates, assets: assets.sort((a, b) => a.sha256.localeCompare(b.sha256)) };
    } finally {
      db.close();
    }
  });
}

async function save(page: Page, name: string) {
  const previous = new Set((await database(page)).templates.map((row) => row.id));
  await library(page).getByLabel('템플릿 이름').fill(name);
  await library(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect
    .poll(
      async () => (await database(page)).templates.filter((row) => !previous.has(row.id)).length,
    )
    .toBe(1);
  await expect(library(page).getByRole('alert')).toHaveCount(0);
  return (await database(page)).templates.find((row) => !previous.has(row.id))!;
}

async function chooseStarter(page: Page, name: string) {
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  const section = page.getByRole('region', { name: '기본 템플릿' });
  await section.getByRole('button', { name, exact: true }).click();
  await expect(section).toHaveAttribute('aria-busy', 'false');
  await expect(section.getByRole('status')).toContainText(`${name} 사본을 불러왔습니다`);
  await expect(page.getByRole('button', { name: 'PNG 다운로드' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

function observeFontRequests(page: Page) {
  const requests: { url: string; status: number }[] = [];
  page.on('response', (response) => {
    if (/\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(response.url()))
      requests.push({ url: response.url(), status: response.status() });
  });
  return requests;
}

async function localFontEvidence(
  page: Page,
  info: TestInfo,
  requests: ReturnType<typeof observeFontRequests>,
) {
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].map((font) => ({
      family: font.family.replace(/["']/g, ''),
      status: font.status,
    }));
  });
  for (const font of fonts)
    expect(faces.some((face) => face.family === font && face.status === 'loaded')).toBe(true);
  expect(requests.length).toBeGreaterThanOrEqual(3);
  for (const request of requests) {
    expect(new URL(request.url).origin).toBe(new URL(page.url()).origin);
    expect(request.status).toBe(200);
  }
  const evidence = { faces, requests, allThreeFamiliesLoaded: true, externalFontRequests: 0 };
  await writeFile(info.outputPath('local-fonts.json'), JSON.stringify(evidence, null, 2));
  return evidence;
}

/** 독립적인 치수표와 실제 다운로드 파일 재개방으로 출력 결과를 확인한다. */
async function compareDownload(
  page: Page,
  info: TestInfo,
  name: string,
  expected?: readonly number[],
) {
  const preview = await frame(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드' }).click();
  const downloaded = await pending;
  const outputPath = info.outputPath(`${name}.png`);
  await downloaded.saveAs(outputPath);
  expect(await downloaded.failure()).toBeNull();
  const bytes = await readFile(outputPath);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const comparison = await page.evaluate(
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
          bytes: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const [a, b] = await Promise.all([pixels(input), pixels(output)]);
      let differentChannels = 0;
      let visiblePixels = 0;
      let translucentPixels = 0;
      for (let index = 0; index < Math.max(a.bytes.length, b.bytes.length); index++)
        if (a.bytes[index] !== b.bytes[index]) differentChannels++;
      for (let index = 3; index < a.bytes.length; index += 4) {
        if (a.bytes[index]! > 0) visiblePixels++;
        if (a.bytes[index] !== 255) translucentPixels++;
      }
      return {
        preview: { width: a.width, height: a.height },
        download: { width: b.width, height: b.height },
        differentChannels,
        comparedChannels: a.bytes.length,
        visiblePixels,
        translucentPixels,
      };
    },
    { input: preview, output: `data:image/png;base64,${bytes.toString('base64')}` },
  );
  const previewBytes = Buffer.from(preview.split(',')[1]!, 'base64');
  const result = {
    ...comparison,
    suggestedFilename: downloaded.suggestedFilename(),
    previewSha256: digest(previewBytes),
    downloadSha256: digest(bytes),
  };
  await writeFile(info.outputPath(`${name}-preview.png`), previewBytes);
  await writeFile(info.outputPath(`${name}-comparison.json`), JSON.stringify(result, null, 2));
  expect(comparison.download).toEqual(comparison.preview);
  if (expected) expect([comparison.download.width, comparison.download.height]).toEqual(expected);
  expect(comparison.differentChannels).toBe(0);
  expect(comparison.visiblePixels).toBeGreaterThan(0);
  expect(comparison.translucentPixels).toBe(0);
  return result;
}

function inspectLayout(doc: StudioDocument, panels: number) {
  expect(doc.panels).toHaveLength(panels);
  expect(doc.layouts.map((layout) => layout.ratio).sort()).toEqual([...ratios].sort());
  expect(doc.elements.some((element) => element.kind === 'character')).toBe(true);
  expect(doc.elements.some((element) => element.kind === 'bubble')).toBe(true);
  expect(doc.assets.length).toBeGreaterThan(0);
  for (const layout of doc.layouts) {
    expect(layout.panels).toHaveLength(panels);
    for (const panel of layout.panels) {
      const rect = panel.rect;
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1.000001);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1.000001);
      for (const { transform } of panel.elements) {
        expect(transform.x).toBeGreaterThanOrEqual(0);
        expect(transform.y).toBeGreaterThanOrEqual(0);
        expect(transform.x + transform.width).toBeLessThanOrEqual(1.000001);
        expect(transform.y + transform.height).toBeLessThanOrEqual(1.000001);
      }
    }
    for (let first = 0; first < layout.panels.length; first++)
      for (let second = first + 1; second < layout.panels.length; second++) {
        const a = layout.panels[first]!.rect;
        const b = layout.panels[second]!.rect;
        const overlapWidth = Math.max(
          0,
          Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
        );
        const overlapHeight = Math.max(
          0,
          Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
        );
        expect(overlapWidth * overlapHeight).toBeLessThanOrEqual(0.000001);
      }
  }
}

async function inspectTypography(page: Page, info: TestInfo, doc: StudioDocument) {
  const rendererPath = '/src/composition/rendering.ts';
  const measurements = await page.evaluate(
    async ({ document: source, path: modulePath, sizes }) => {
      const { canvasFont, textContentRect, textDrawingOffset, wrapText } = (await import(
        /* @vite-ignore */ modulePath
      )) as typeof import('../../packages/renderer/src/index');
      const context = document.createElement('canvas').getContext('2d')!;
      context.textBaseline = 'top';
      return source.layouts.flatMap((layout) => {
        const [width, height] = sizes[layout.ratio];
        return layout.panels.flatMap((panel) =>
          panel.elements.flatMap((placement) => {
            const element = source.elements.find((item) => item.id === placement.elementId)!;
            if (element.hidden || (element.kind !== 'text' && element.kind !== 'bubble')) return [];
            const content = textContentRect(
              element,
              placement.transform.width * panel.rect.width * width,
              placement.transform.height * panel.rect.height * height,
            );
            context.font = canvasFont(element.style);
            const lines = wrapText(
              element.text,
              content.width,
              (text) => context.measureText(text).width,
            );
            const drawingOffset = textDrawingOffset(context, lines);
            const ink = lines.map((line, index) => {
              const measure = context.measureText(line);
              return {
                width: measure.width,
                top:
                  drawingOffset +
                  index * element.style.fontSize * element.style.lineHeight -
                  measure.actualBoundingBoxAscent,
                bottom:
                  drawingOffset +
                  index * element.style.fontSize * element.style.lineHeight +
                  measure.actualBoundingBoxDescent,
              };
            });
            const maximumLineWidth = Math.max(0, ...ink.map((line) => line.width));
            const inkBottom = Math.max(0, ...ink.map((line) => line.bottom));
            const inkTop = Math.min(...ink.map((line) => line.top));
            const lineBoxHeight =
              drawingOffset + lines.length * element.style.fontSize * element.style.lineHeight;
            return [
              {
                ratio: layout.ratio,
                panelId: panel.panelId,
                elementId: element.id,
                kind: element.kind,
                text: element.text,
                font: context.font,
                contentWidth: content.width,
                contentHeight: content.height,
                lines,
                maximumLineWidth,
                drawingOffset,
                inkTop,
                inkBottom,
                lineBoxHeight,
                clipped:
                  maximumLineWidth > content.width + 0.75 ||
                  inkBottom > content.height + 0.75 ||
                  inkTop < -0.75 ||
                  lineBoxHeight > content.height + 0.75,
              },
            ];
          }),
        );
      });
    },
    { document: doc, path: rendererPath, sizes: expectedSizes[1080] },
  );
  await writeFile(
    info.outputPath('starter-typography.json'),
    JSON.stringify(measurements, null, 2),
  );
  expect(measurements.length).toBeGreaterThan(0);
  expect(measurements.filter((measurement) => measurement.clipped)).toEqual([]);
}

for (const starter of starters) {
  test(`${starter.name}: 8개 비율·두 출력 크기의 배치와 실제 PNG 재개방 비교`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const requests = observeFontRequests(page);
    await page.goto('/');
    await chooseStarter(page, starter.name);
    const original = await save(page, `${starter.name} 배치 검사`);
    inspectLayout(original.document, starter.panels);
    await writeFile(
      info.outputPath('starter-layout.json'),
      JSON.stringify(original.document, null, 2),
    );
    await inspectTypography(page, info, original.document);
    const matrix = [];
    for (const ratio of ratios) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await expect(
        page.getByRole('img', { name: `카드 ${ratio} 비율`, exact: true }),
      ).toBeVisible();
      for (const longEdge of [1080, 2048] as const) {
        await revealControl(page, page.getByLabel('출력 크기', { exact: true }));
        await page.getByLabel('출력 크기', { exact: true }).selectOption(String(longEdge));
        const comparison = await compareDownload(
          page,
          info,
          `starter-${starter.slug}-${ratio.replace(':', 'x')}-${longEdge}`,
          expectedSizes[longEdge][ratio],
        );
        matrix.push({
          template: starter.name,
          panelCount: starter.panels,
          ratio,
          longEdge,
          ...comparison,
          result: 'PASS',
        });
      }
      if (ratio === '9:16' || ratio === '16:9')
        await page.getByRole('region', { name: '카드 미리보기' }).screenshot({
          path: info.outputPath(`starter-${starter.slug}-${ratio.replace(':', 'x')}-screen.png`),
        });
    }
    await localFontEvidence(page, info, requests);
    await writeFile(info.outputPath('starter-matrix.json'), JSON.stringify(matrix, null, 2));
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test('기본 글꼴 3종이 실제 한글 모양에 적용되고 다운로드 결과가 일치한다', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const requests = observeFontRequests(page);
  await page.goto('/');
  await chooseStarter(page, starters[0].name);
  await fillCaption(page, '한글 글꼴의 차이를 읽어요\n가나다 ABC 123');
  const results = [];
  const distinct = new Set<string>();
  for (const font of fonts) {
    await revealControl(page, page.getByLabel('문구 글꼴', { exact: true }));
    await page.getByLabel('문구 글꼴', { exact: true }).selectOption({ label: font });
    await expect(page.getByLabel('문구 글꼴', { exact: true })).toHaveValue(font);
    const current = await frame(page);
    distinct.add(digest(current));
    results.push({
      family: font,
      ...(await compareDownload(page, info, `font-${font.replaceAll(' ', '-').toLowerCase()}`)),
    });
  }
  expect(distinct.size).toBe(3);
  const metrics = await page.evaluate((families) => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    return families.map((family) => {
      ctx.font = `400 48px "${family}"`;
      return { family, width: ctx.measureText('가나다라마바사 ABC 123').width };
    });
  }, fonts);
  expect(new Set(metrics.map((metric) => metric.width)).size).toBe(3);
  const source = await save(page, '기본 글꼴 적용 확인');
  expect(
    source.document.elements
      .filter((element) => 'text' in element)
      .some(
        (element) =>
          'style' in element &&
          element.style.font.kind === 'builtin' &&
          element.style.font.family === 'Jua',
      ),
  ).toBe(true);
  await localFontEvidence(page, info, requests);
  await writeFile(
    info.outputPath('font-application.json'),
    JSON.stringify({ results, metrics, uniqueFrames: distinct.size }, null, 2),
  );
  await page.screenshot({ path: info.outputPath('font-controls.png'), fullPage: true });
});

test('기본 글꼴 로딩 실패를 안내하고 준비 전 편집·PNG 다운로드를 막는다', async ({
  page,
}, info) => {
  await page.route('**/assets/fonts/jua/Jua-Regular.ttf', (route) => route.abort('failed'));
  await page.goto('/');
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Jua');
  await expect(page.getByRole('button', { name: 'PNG 다운로드' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '카드 편집 도구' })).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-fonts-ready', 'true');
  const before = await alert.innerText();
  await page.screenshot({ path: info.outputPath('font-load-error.png'), fullPage: true });
  await page.unroute('**/assets/fonts/jua/Jua-Regular.ttf');
  await page.getByRole('button', { name: '글꼴 다시 불러오기', exact: true }).click();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  await expect(page.getByRole('button', { name: 'PNG 다운로드' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await writeFile(
    info.outputPath('font-load-recovery.json'),
    JSON.stringify(
      {
        simulatedUnavailableFont: 'Jua',
        downloadBlockedBeforeReady: true,
        noFallbackCanvas: true,
        error: before,
        recoveredAfterReload: true,
      },
      null,
      2,
    ),
  );
});

test('기본 6종의 모든 컷을 편집·저장하고 이미지 포함 JSON으로 옮겨 새로고침 후 복원한다', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await page.goto('/');
  const originals: { id: string; name: string; text: string[]; preview: string }[] = [];
  for (const [index, starter] of starters.entries()) {
    await chooseStarter(page, starter.name);
    const cutValues = await page
      .getByLabel('편집할 컷', { exact: true })
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(cutValues).toHaveLength(starter.panels);
    const edited: string[] = [];
    for (const [cut, value] of cutValues.entries()) {
      await revealControl(page, page.getByLabel('편집할 컷', { exact: true }));
      await page.getByLabel('편집할 컷', { exact: true }).selectOption(value);
      await openTool(page, '레이어');
      const phrase = await page
        .getByRole('button', { name: /^레이어 선택 \d+: (문구|말풍선)/ })
        .last()
        .getAttribute('data-element-id');
      expect(phrase).toBeTruthy();
      await selectLayer(page, phrase!);
      const text = `${starter.name} ${cut + 1}번째 컷\n직접 바꾼 이야기 ${index + 1}`;
      edited.push(text);
      await fillCaption(page, text);
      await revealControl(page, page.getByLabel('문구 글꼴', { exact: true }));
      await page
        .getByLabel('문구 글꼴', { exact: true })
        .selectOption({ label: fonts[cut % fonts.length]! });
    }
    await page.getByRole('button', { name: ratios[index]!, exact: true }).click();
    const saved = await save(page, `편집한 ${starter.name}`);
    inspectLayout(saved.document, starter.panels);
    originals.push({ id: saved.id, name: saved.name, text: edited, preview: await frame(page) });
    await compareDownload(page, info, `roundtrip-source-${starter.slug}`);
  }
  const before = await database(page);
  expect(before.templates).toHaveLength(6);
  expect(before.assets.every((asset) => asset.actualSha256 === asset.sha256)).toBe(true);
  const pending = page.waitForEvent('download');
  await library(page).getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
  const download = await pending;
  const output = info.outputPath('six-starter-templates-backup.json');
  await download.saveAs(output);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(output);
  const backup = JSON.parse(bytes.toString('utf8')) as TemplateBackup;
  expect(backup.templates).toHaveLength(6);
  expect(backup.embeddedAssets.length).toBe(before.assets.length);
  for (const asset of backup.embeddedAssets)
    expect(digest(Buffer.from(asset.base64, 'base64'))).toBe(asset.sha256);
  const working = await frame(page);
  await library(page).getByLabel('템플릿 JSON 파일').setInputFiles(output);
  await expect.poll(async () => (await database(page)).templates.length).toBe(12);
  expect(await frame(page)).toBe(working);
  const after = await database(page);
  expect(after.assets).toEqual(before.assets);
  const oldIds = new Set(before.templates.map((row) => row.id));
  const added = after.templates.filter((row) => !oldIds.has(row.id));
  expect(added).toHaveLength(6);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  await expect.poll(async () => (await database(page)).templates.length).toBe(12);
  const restoration = [];
  for (const imported of added) {
    const original = originals.find((row) => row.name === imported.name)!;
    await library(page).getByLabel('저장된 템플릿').selectOption(imported.id);
    await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
    await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
    await expect.poll(async () => digest(await frame(page))).toBe(digest(original.preview));
    await expect(page.getByRole('alert')).toHaveCount(0);
    const cuts = await page
      .getByLabel('편집할 컷', { exact: true })
      .locator('option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(cuts).toHaveLength(original.text.length);
    for (const [cut, value] of cuts.entries()) {
      await revealControl(page, page.getByLabel('편집할 컷', { exact: true }));
      await page.getByLabel('편집할 컷', { exact: true }).selectOption(value);
      await openTool(page, '레이어');
      const phrase = await page
        .getByRole('button', { name: /^레이어 선택 \d+: (문구|말풍선)/ })
        .last()
        .getAttribute('data-element-id');
      await selectLayer(page, phrase!);
      await expect(caption(page)).toHaveValue(original.text[cut]!);
      await expect(page.getByLabel('문구 글꼴', { exact: true })).toHaveValue(
        fonts[cut % fonts.length]!,
      );
    }
    restoration.push({
      name: original.name,
      sourceId: original.id,
      importedId: imported.id,
      panelCount: cuts.length,
      previewSha256: digest(original.preview),
      samePixelsAfterReload: true,
    });
  }
  await writeFile(
    info.outputPath('starter-json-roundtrip.json'),
    JSON.stringify(
      {
        backupSha256: digest(bytes),
        before,
        after,
        restoration,
        importingPreservedCurrentFrame: true,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('starter-restored.png'), fullPage: true });
});
