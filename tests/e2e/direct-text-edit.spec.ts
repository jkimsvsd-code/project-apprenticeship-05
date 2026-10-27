import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
import { openTool } from './ui-controls';

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const dimensions = {
  '1:1': [1080, 1080],
  '4:5': [864, 1080],
  '3:4': [810, 1080],
  '2:3': [720, 1080],
  '9:16': [608, 1080],
  '4:3': [1080, 810],
  '3:2': [1080, 720],
  '16:9': [1080, 608],
} as const;
const direct = (page: Page) =>
  page.getByRole('textbox', { name: '카드 문구 직접 편집', exact: true });
const inline = (page: Page) => page.getByRole('group', { name: '카드 문구 편집', exact: true });
const history = (page: Page) => page.getByRole('region', { name: '현재 세션 편집 이력' });
const library = (page: Page) => page.getByRole('region', { name: '내 템플릿' });
const group = (page: Page) => page.getByRole('region', { name: '여러 요소와 컷 편집' });
const frame = (page: Page) =>
  page.locator('canvas').evaluate((node) => (node as HTMLCanvasElement).toDataURL('image/png'));
const undoCount = async (page: Page) =>
  Number((await history(page).innerText()).match(/취소 (\d+)/)![1]);
// Range inputs quantize their DOM value to their step; the visible output keeps
// the actual fractional font size produced by a proportional resize.
const displayedFontSize = async (page: Page) =>
  Number(
    (await page
      .getByLabel('문구 크기', { exact: true })
      .locator('..')
      .locator('output')
      .textContent())!
      .replace('px', '')
      .trim(),
  );

async function ready(page: Page) {
  await page.goto('/');
  await openTool(page, '레이어');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 15_000,
  });
  await expect(page.getByText('작은 장면, 나만의 이야기', { exact: true })).toHaveCount(0);
  await expect(page.getByText('오늘을 한 장으로.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '첫 편집 안내' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '편집 도움말', exact: true })).toHaveCount(0);
}

async function center(page: Page) {
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('canvas').boundingBox())!;
  const [x, y, width, height] = await Promise.all(
    ['요소 가로 위치', '요소 세로 위치', '요소 폭', '요소 높이'].map(
      async (label) => Number(await page.getByLabel(label, { exact: true }).inputValue()) / 100,
    ),
  );
  return { x: box.x + (x! + width! / 2) * box.width, y: box.y + (y! + height! / 2) * box.height };
}

async function touchHold(page: Page, point: { x: number; y: number }, move = false) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...point, id: 1 }],
    });
    if (move) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x + 30, y: point.y + 20, id: 1 }],
      });
    }
    await page.waitForTimeout(650);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

async function openText(page: Page, isMobile: boolean) {
  const point = await center(page);
  if (isMobile) await touchHold(page, point);
  else await page.mouse.dblclick(point.x, point.y);
  await expect(direct(page)).toBeVisible();
  await expect(direct(page)).toBeFocused();
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

async function restore(page: Page, name: string) {
  await library(page).getByLabel('저장된 템플릿').selectOption({ label: name });
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText(`‘${name}’ 사본을 불러왔습니다`);
  await expect(library(page)).toHaveAttribute('aria-busy', 'false');
}

function content(doc: StudioDocument) {
  return { ...doc, updatedAt: '' };
}

/** A loaded template is a new work; preserve every content field and reference. */
function clonedContent(doc: StudioDocument) {
  const assets = new Map(doc.assets.map((asset, index) => [asset.id, `asset-${index}`]));
  const panels = new Map(doc.panels.map((panel, index) => [panel.id, `panel-${index}`]));
  const elements = new Map(doc.elements.map((element, index) => [element.id, `element-${index}`]));
  const remap = (map: ReadonlyMap<string, string>, id: string) => {
    const normalized = map.get(id);
    if (!normalized) throw new Error(`문서 내부 참조가 없습니다: ${id}`);
    return normalized;
  };
  const result = structuredClone(doc);
  result.id = 'document';
  result.createdAt = result.updatedAt = '';
  for (const asset of result.assets) asset.id = remap(assets, asset.id);
  for (const element of result.elements) {
    element.id = remap(elements, element.id);
    if ('assetId' in element) element.assetId = remap(assets, element.assetId);
    if ('style' in element && element.style.font.kind === 'uploaded')
      element.style.font.assetId = remap(assets, element.style.font.assetId);
  }
  for (const background of [result.background, ...result.panels.map((panel) => panel.background)]) {
    if (!background) continue;
    for (const key of ['imageAssetId', 'originalImageAssetId', 'resultImageAssetId'] as const)
      if (background[key]) background[key] = remap(assets, background[key]);
  }
  for (const panel of result.panels) {
    panel.id = remap(panels, panel.id);
    panel.elementIds = panel.elementIds.map((id) => remap(elements, id));
  }
  for (const layout of result.layouts)
    for (const panel of layout.panels) {
      panel.panelId = remap(panels, panel.panelId);
      for (const placement of panel.elements)
        placement.elementId = remap(elements, placement.elementId);
    }
  return result;
}

async function download(page: Page, info: TestInfo, name: string, expected: readonly number[]) {
  const preview = await frame(page);
  await expect(page.getByRole('button', { name: 'PNG 다운로드 ↓', exact: true })).toBeEnabled();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드 ↓', exact: true }).click();
  const file = await pending;
  const output = info.outputPath(`${name}.png`);
  await file.saveAs(output);
  expect(await file.failure()).toBeNull();
  const bytes = await readFile(output);
  const comparison = await page.evaluate(
    async ({ preview, output }) => {
      const decode = async (url: string) => {
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
      };
      const [a, b] = await Promise.all([decode(preview), decode(output)]);
      let differentChannels = 0;
      for (let index = 0; index < Math.max(a.data.length, b.data.length); index++)
        if (a.data[index] !== b.data[index]) differentChannels++;
      return {
        preview: [a.width, a.height],
        download: [b.width, b.height],
        comparedChannels: a.data.length,
        differentChannels,
      };
    },
    { preview, output: `data:image/png;base64,${bytes.toString('base64')}` },
  );
  expect(comparison.preview).toEqual(expected);
  expect(comparison.download).toEqual(expected);
  expect(comparison.differentChannels).toBe(0);
  const result = { ...comparison, sha256: createHash('sha256').update(bytes).digest('hex') };
  await writeFile(info.outputPath(`${name}-comparison.json`), JSON.stringify(result, null, 2));
  return result;
}

test('화면 문구 직접 편집: 더블클릭·길게 누르기, 한 단계 저장·실행 취소·다시 실행·취소', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(90_000);
  await ready(page);
  const before = await frame(page);
  const initial = await save(page, 'direct-edit-before');
  const count = await undoCount(page);
  await openText(page, isMobile);
  await direct(page).fill('첫 번째 장면');
  await direct(page).fill('직접 고친 문구\n다음 줄도 유지');
  expect(await frame(page)).toBe(before);
  expect(await undoCount(page)).toBe(count);
  await inline(page).getByRole('button', { name: '완료', exact: true }).click();
  await expect(direct(page)).toHaveCount(0);
  await expect(page.locator('#caption')).toHaveValue('직접 고친 문구\n다음 줄도 유지');
  expect(await undoCount(page)).toBe(count + 1);
  const after = await frame(page);
  expect(after).not.toBe(before);
  await history(page).getByRole('button', { name: '실행 취소', exact: true }).click();
  expect(await frame(page)).toBe(before);
  expect(content(await save(page, 'direct-edit-undone'))).toEqual(content(initial));
  await history(page).getByRole('button', { name: '다시 실행', exact: true }).click();
  expect(await frame(page)).toBe(after);
  const countAfter = await undoCount(page);
  await openText(page, isMobile);
  await direct(page).fill('취소할 변경');
  await direct(page).press('Escape');
  await expect(direct(page)).toHaveCount(0);
  expect(await frame(page)).toBe(after);
  expect(await undoCount(page)).toBe(countAfter);
  await openText(page, isMobile);
  await direct(page).fill('버튼으로 취소할 변경');
  await inline(page).getByRole('button', { name: '취소', exact: true }).click();
  expect(await frame(page)).toBe(after);
  expect(await undoCount(page)).toBe(countAfter);
  await writeFile(
    info.outputPath('direct-edit-history.json'),
    JSON.stringify(
      {
        browserProfile: info.project.name,
        realDevice: false,
        entry: isMobile ? 'touch hold 650ms (threshold 550ms)' : 'mouse double click',
        oneUndoStep: true,
        canceledDraftsPreserved: true,
      },
      null,
      2,
    ),
  );
});

test('화면 문구 직접 편집: IME 조합 중 저장 방지·1001 코드포인트 거부와 원본 보존', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(90_000);
  await ready(page);
  const before = await frame(page);
  const count = await undoCount(page);
  await openText(page, isMobile);
  await direct(page).dispatchEvent('compositionstart');
  await direct(page).fill('조합 중인 문구');
  await expect(inline(page).getByRole('button', { name: '완료', exact: true })).toBeDisabled();
  await direct(page).press('Control+Enter');
  await expect(direct(page)).toBeVisible();
  expect(await frame(page)).toBe(before);
  expect(await undoCount(page)).toBe(count);
  await direct(page).dispatchEvent('compositionend', { data: '조합 중인 문구' });
  await expect(inline(page).getByRole('button', { name: '완료', exact: true })).toBeEnabled();
  await direct(page).fill('가'.repeat(1001));
  await inline(page).getByRole('button', { name: '완료', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1,000');
  await expect(direct(page)).toBeVisible();
  expect(await frame(page)).toBe(before);
  expect(await undoCount(page)).toBe(count);
  await direct(page).fill('정상 문구');
  await inline(page).getByRole('button', { name: '완료', exact: true }).click();
  await expect(page.locator('#caption')).toHaveValue('정상 문구');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await undoCount(page)).toBe(count + 1);
  await writeFile(
    info.outputPath('direct-edit-validation.json'),
    JSON.stringify(
      {
        browserProfile: info.project.name,
        realDevice: false,
        composingBlocked: true,
        rejectedCodePoints: 1001,
        originalPreserved: true,
        validRetrySucceeded: true,
      },
      null,
      2,
    ),
  );
});

test('화면 문구 직접 편집: 잠금·숨김 차단과 이동한 터치의 길게 누르기 취소', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await ready(page);
  const point = await center(page);
  await group(page).getByRole('button', { name: '선택 잠금', exact: true }).click();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const lockedPoint = await center(page);
  await page.mouse.dblclick(lockedPoint.x, lockedPoint.y);
  await touchHold(page, lockedPoint);
  await expect(direct(page)).toHaveCount(0);
  await group(page).getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
  await group(page).getByRole('button', { name: '선택 숨김', exact: true }).click();
  const hiddenPoint = await center(page);
  await page.mouse.dblclick(hiddenPoint.x, hiddenPoint.y);
  await touchHold(page, hiddenPoint);
  await expect(direct(page)).toHaveCount(0);
  await group(page).getByRole('button', { name: '선택 숨김 해제', exact: true }).click();
  const count = await undoCount(page);
  const before = await frame(page);
  await touchHold(page, await center(page), true);
  await expect(direct(page)).toHaveCount(0);
  expect(await frame(page)).not.toBe(before);
  expect(await undoCount(page)).toBe(count + 1);
  await writeFile(
    info.outputPath('direct-edit-guards.json'),
    JSON.stringify(
      {
        browserProfile: info.project.name,
        realDevice: false,
        originalPoint: point,
        lockedBlocked: true,
        hiddenBlocked: true,
        movedTouchCancelsLongPress: true,
        dragStillWorks: true,
      },
      null,
      2,
    ),
  );
});

test('8비율: 직접 편집·손잡이 글꼴 확대·저장 새로고침 복원·다운로드 전체 RGBA 일치', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(180_000);
  await ready(page);
  await page.getByLabel('출력 크기', { exact: true }).selectOption('1080');
  await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
  const observations = [];
  for (const [index, ratio] of ratios.entries()) {
    await page.getByRole('button', { name: ratio, exact: true }).click();
    await openText(page, isMobile);
    await direct(page).fill(`화면에서 편집 ${index + 1}`);
    await inline(page).getByRole('button', { name: '완료', exact: true }).click();
    const beforeFont = await displayedFontSize(page);
    const beforeWidth = Number(await page.getByLabel('요소 폭', { exact: true }).inputValue());
    const beforeHeight = Number(await page.getByLabel('요소 높이', { exact: true }).inputValue());
    const handle = page.getByRole('button', { name: '요소 크기 조절 오른쪽 아래', exact: true });
    await handle.scrollIntoViewIfNeeded();
    await handle.focus();
    await page.keyboard.press('Shift+ArrowRight');
    const afterFont = await displayedFontSize(page);
    const afterWidth = Number(await page.getByLabel('요소 폭', { exact: true }).inputValue());
    const afterHeight = Number(await page.getByLabel('요소 높이', { exact: true }).inputValue());
    expect(afterFont).toBeGreaterThan(beforeFont);
    // Numeric placement controls display percentages rounded to two decimals.
    expect(afterWidth / beforeWidth).toBeCloseTo(afterHeight / beforeHeight, 3);
    expect(afterFont / beforeFont).toBeCloseTo(afterWidth / beforeWidth, 2);
    const name = `direct-ratio-${index}`;
    const stored = await save(page, name);
    const savedFrame = await frame(page);
    await page.reload();
    await openTool(page, '레이어');
    await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
      timeout: 15_000,
    });
    await restore(page, name);
    expect(await frame(page)).toBe(savedFrame);
    const restored = await save(page, `${name}-restored`);
    expect(restored.id).not.toBe(stored.id);
    expect(clonedContent(restored)).toEqual(clonedContent(stored));
    await expect(
      history(page).getByRole('button', { name: '실행 취소', exact: true }),
    ).toBeDisabled();
    const png = await download(page, info, name, dimensions[ratio]);
    observations.push({
      ratio,
      beforeFont,
      afterFont,
      widthScale: afterWidth / beforeWidth,
      heightScale: afterHeight / beforeHeight,
      png,
    });
  }
  await writeFile(
    info.outputPath('direct-text-ratio-matrix.json'),
    JSON.stringify({ project: info.project.name, realDevice: false, cases: observations }, null, 2),
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
});
