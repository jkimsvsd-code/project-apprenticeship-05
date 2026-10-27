import { fillCaption, openTool, revealControl, selectedLayerId } from './ui-controls';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
const frame = (page: Page) =>
  page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
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

const library = (page: Page) => page.getByRole('region', { name: '내 템플릿' });
async function ready(page: Page) {
  await page.goto('/');
  await openTool(page, '레이어');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
}
async function number(page: Page, label: string, value: number) {
  await revealControl(page, page.getByLabel(label, { exact: true }));
  await page.getByLabel(label, { exact: true }).fill(String(value));
  await page.getByLabel(label, { exact: true }).press('Enter');
  await expect(page.getByLabel(label, { exact: true })).toHaveValue(String(value));
}
async function save(page: Page, name: string) {
  await library(page).getByLabel('템플릿 이름').fill(name);
  await library(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('저장했습니다');
  return page.evaluate(async () => {
    const path = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ path
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-studio-demo');
    try {
      return (await db.getAll('templates')).at(-1)!.document;
    } finally {
      db.close();
    }
  });
}
async function restore(page: Page) {
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
}

for (const config of [
  { panels: 1, name: null },
  { panels: 2, name: '전후 비교' },
  { panels: 4, name: '짧은 이야기' },
] as const) {
  test(`${config.panels}컷: 회전 정렬 8비율·두 해상도 PNG·저장 복원`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await ready(page);
    if (config.name) {
      const starters = page.getByRole('region', { name: '기본 템플릿' });
      await starters.getByRole('button', { name: config.name, exact: true }).click();
      await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
      await revealControl(page, page.getByLabel('편집할 컷'));
      await page.getByLabel('편집할 컷').selectOption({ index: config.panels - 1 });
    }
    await page.getByRole('button', { name: '문구 추가', exact: true }).click();
    await fillCaption(page, '정렬된 장면');
    const selected = await selectedLayerId(page);
    for (const ratio of ratios) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await number(page, '요소 폭', 25);
      await number(page, '요소 높이', 18);
      await number(page, '요소 회전', 90);
      await page.getByRole('button', { name: '오른쪽 정렬', exact: true }).click();
      await page.getByRole('button', { name: '세로 가운데', exact: true }).click();
      for (const edge of [1080, 2048] as const) {
        await revealControl(page, page.getByLabel('출력 크기'));
        await page.getByLabel('출력 크기').selectOption(String(edge));
        await compareDownload(
          page,
          info,
          `alignment-${config.panels}-${ratio.replace(':', 'x')}-${edge}`,
          expectedSizes[edge][ratio],
        );
      }
    }
    const doc: StudioDocument = await save(page, `정렬 ${config.panels}컷`);
    for (const layout of doc.layouts) {
      const placed = layout.panels[config.panels - 1]!;
      const t = placed.elements.find((item) => item.elementId === selected)!.transform;
      const [w, h] = expectedSizes[1080][layout.ratio];
      const pw = w * placed.rect.width,
        ph = h * placed.rect.height;
      // At 90 degrees the visible right edge uses the original height in pixels.
      expect(t.x + t.width / 2 + (t.height * ph) / pw / 2).toBeCloseTo(1, 9);
      expect(t.y + t.height / 2).toBeCloseTo(0.5, 9);
    }
    const before = await frame(page);
    await page.reload();
    await openTool(page, '레이어');
    await library(page)
      .getByLabel('저장된 템플릿')
      .selectOption({ label: `정렬 ${config.panels}컷` });
    await restore(page);
    await revealControl(page, page.getByLabel('출력 크기'));
    await page.getByLabel('출력 크기').selectOption('2048');
    expect(await frame(page)).toBe(before);
    await writeFile(
      info.outputPath('alignment-layouts.json'),
      JSON.stringify({ doc, restoredFrameEqual: true, independentRotatedEdges: true }, null, 2),
    );
    await page.screenshot({ path: info.outputPath('alignment-editor.png'), fullPage: true });
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('마우스/터치 자동 맞춤·끄기·화면 전용 정렬선과 취소', async ({ page }, info) => {
  await ready(page);
  await page.getByRole('button', { name: '선택 요소 삭제', exact: true }).click();
  await revealControl(page, page.getByLabel('추가할 말풍선'));
  await page.getByLabel('추가할 말풍선').selectOption('caption');
  await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
  await fillCaption(page, '맞춤');
  await number(page, '요소 폭', 20);
  await number(page, '요소 높이', 20);
  const client = info.project.name.startsWith('mobile')
    ? await page.context().newCDPSession(page)
    : null;
  const observations = [];
  for (const enabled of [true, false]) {
    await revealControl(page, page.getByLabel('정렬선과 자동 맞춤', { exact: true }));
    await page.getByLabel('정렬선과 자동 맞춤', { exact: true }).setChecked(enabled);
    await number(page, '요소 가로 위치', 20);
    await number(page, '요소 세로 위치', 20);
    await page.locator('canvas').scrollIntoViewIfNeeded();
    const box = (await page.locator('canvas').boundingBox())!;
    const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    const to = { x: box.x + box.width * 0.495, y: box.y + box.height * 0.495 };
    if (client) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
    }
    await expect
      .poll(async () =>
        Number(await page.getByLabel('요소 가로 위치', { exact: true }).inputValue()),
      )
      .toBeCloseTo(enabled ? 40 : 39.5, 0);
    const lines = page.getByTestId('alignment-guides').locator('line');
    await expect(lines).toHaveCount(enabled ? 2 : 0);
    const positions = await lines.evaluateAll((nodes) =>
      nodes.map((node) => ({
        axis: node.getAttribute('data-axis'),
        position: Number(node.getAttribute('data-position')),
      })),
    );
    if (enabled) {
      expect(positions).toEqual([
        { axis: 'x', position: 0.5 },
        { axis: 'y', position: 0.5 },
      ]);
      const overlay = (await page.getByTestId('alignment-guides').boundingBox())!;
      expect(overlay.x).toBeCloseTo(box.x, 0);
      expect(overlay.y).toBeCloseTo(box.y, 0);
      expect(overlay.width).toBeCloseTo(box.width, 0);
      expect(overlay.height).toBeCloseTo(box.height, 0);
      await page.screenshot({ path: info.outputPath('active-guides.png') });
    }
    const during = await frame(page);
    if (client)
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    else await page.mouse.up();
    await expect(page.getByTestId('alignment-guides')).toHaveCount(0);
    expect(await frame(page)).toBe(during);
    await compareDownload(
      page,
      info,
      enabled ? 'snapped-without-guides' : 'free-drag',
      expectedSizes[1080]['1:1'],
    );
    observations.push({
      enabled,
      positions,
      frameUnchangedAfterGuideRemoval: true,
      pointer: client ? 'CDP touch' : 'mouse',
    });
  }
  await revealControl(page, page.getByLabel('정렬선과 자동 맞춤', { exact: true }));
  await page.getByLabel('정렬선과 자동 맞춤', { exact: true }).check();
  await number(page, '요소 가로 위치', 20);
  await number(page, '요소 세로 위치', 20);
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('canvas').boundingBox())!;
  const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
  const to = { x: box.x + box.width * 0.495, y: box.y + box.height * 0.495 };
  if (client) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y);
  }
  await expect(page.getByTestId('alignment-guides').locator('line')).toHaveCount(2);
  const beforeCancel = await frame(page);
  if (client)
    await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  else {
    await page.locator('canvas').dispatchEvent('pointercancel', { pointerId: 1 });
    await page.mouse.up();
  }
  await expect(page.getByTestId('alignment-guides')).toHaveCount(0);
  expect(await frame(page)).toBe(beforeCancel);
  await client?.detach();
  await writeFile(
    info.outputPath('alignment-pointer.json'),
    JSON.stringify(
      { observations, pointerCancelClearedGuides: true, cancelledFramePreserved: true },
      null,
      2,
    ),
  );
});
