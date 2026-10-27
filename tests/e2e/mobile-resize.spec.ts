import { test, expect, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElementTransform, StudioDocument } from '@jjal/document-model';
import { fillCaption, openTool, revealControl, selectLayer, selectedLayerId } from './ui-controls';

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
type Ratio = (typeof ratios)[number];
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Point = { x: number; y: number };
const corners: Corner[] = ['nw', 'ne', 'sw', 'se'];
const cornerNames = {
  nw: '왼쪽 위',
  ne: '오른쪽 위',
  sw: '왼쪽 아래',
  se: '오른쪽 아래',
} as const;
const signs: Record<Corner, readonly [number, number]> = {
  nw: [-1, -1],
  ne: [1, -1],
  sw: [-1, 1],
  se: [1, 1],
};
// Independent export dimensions: the geometry oracle does not import resize/render helpers.
const dimensions = {
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
const group = (page: Page) => page.getByRole('region', { name: '여러 요소와 컷 편집' });
const history = (page: Page) => page.getByRole('region', { name: '현재 세션 편집 이력' });
const handles = (page: Page) => page.locator('button[data-resize-handle]');
const handle = (page: Page, corner: Corner) =>
  page.getByRole('button', { name: `요소 크기 조절 ${cornerNames[corner]}`, exact: true });
const frame = (page: Page) =>
  page.locator('canvas').evaluate((node) => (node as HTMLCanvasElement).toDataURL('image/png'));

async function ready(page: Page) {
  await page.goto('/');
  await openTool(page, '레이어');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 15_000,
  });
  await expect(page.getByRole('region', { name: '첫 편집 안내', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '편집 도움말', exact: true })).toHaveCount(0);
}
async function field(page: Page, name: string, value: number) {
  const input = page.getByLabel(name, { exact: true });
  await revealControl(page, input);
  await input.fill(String(value));
  await input.press('Enter');
  await expect(input).toHaveValue(String(value));
}
async function setPlacement(page: Page, rotation: number) {
  for (const [name, value] of [
    ['요소 가로 위치', 25],
    ['요소 세로 위치', 25],
    ['요소 폭', 40],
    ['요소 높이', 40],
    ['요소 회전', rotation],
  ] as const)
    await field(page, name, value);
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
  return { ...doc, updatedAt: '', activeRatio: '1:1' };
}
function placement(doc: StudioDocument, ratio: Ratio, id: string) {
  const panel = doc.layouts
    .find((item) => item.ratio === ratio)!
    .panels.find((item) => item.elements.some((element) => element.elementId === id))!;
  return { panel, transform: panel.elements.find((item) => item.elementId === id)!.transform };
}
function rotate(x: number, y: number, angle: number): Point {
  return {
    x: x * Math.cos(angle) - y * Math.sin(angle),
    y: x * Math.sin(angle) + y * Math.cos(angle),
  };
}
function cornerPoint(t: ElementTransform, corner: Corner, pw: number, ph: number): Point {
  const [sx, sy] = signs[corner];
  const v = rotate((sx * t.width * pw) / 2, (sy * t.height * ph) / 2, (t.rotation * Math.PI) / 180);
  return { x: (t.x + t.width / 2) * pw + v.x, y: (t.y + t.height / 2) * ph + v.y };
}
const opposite: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };

function fontSize(doc: StudioDocument, id: string) {
  const element = doc.elements.find((item) => item.id === id)!;
  if (element.kind !== 'text' && element.kind !== 'bubble') throw new Error('문구가 아님');
  return element.style.fontSize;
}
/** Check visible invariants without repeating the production projection algorithm. */
function assertTextScale(before: StudioDocument, after: StudioDocument, ratio: Ratio, id: string) {
  const start = placement(before, ratio, id).transform;
  const end = placement(after, ratio, id).transform;
  const scale = end.width / start.width;
  expect(end.height / start.height).toBeCloseTo(scale, 8);
  expect(fontSize(after, id) / fontSize(before, id)).toBeCloseTo(scale, 8);
  expect(fontSize(after, id)).toBeGreaterThanOrEqual(8 - 1e-9);
  expect(fontSize(after, id)).toBeLessThanOrEqual(300 + 1e-9);
  expect(end.width).toBeLessThanOrEqual(4);
  expect(end.height).toBeLessThanOrEqual(4);
  return { scale, beforeFontSize: fontSize(before, id), afterFontSize: fontSize(after, id) };
}
async function touchClient(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  // Exercise real touch pointer events in both Chromium projects, including the desktop viewport.
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  return client;
}
async function touchStart(client: CDPSession, point: Point) {
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...point, id: 1 }],
  });
}
async function touchEnd(client: CDPSession) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function touchMoves(page: Page, client: CDPSession, from: Point, delta: Point) {
  for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + delta.x * fraction, y: from.y + delta.y * fraction, id: 1 }],
    });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
}
async function geometry(page: Page, doc: StudioDocument, ratio: Ratio, id: string, corner: Corner) {
  await handle(page, corner).scrollIntoViewIfNeeded();
  const canvas = (await page.locator('canvas').boundingBox())!;
  const target = (await handle(page, corner).boundingBox())!;
  const { panel, transform } = placement(doc, ratio, id);
  const [width, height] = dimensions[1080][ratio];
  const pw = panel.rect.width * width;
  const ph = panel.rect.height * height;
  // The visible handle box expands very small elements about their actual
  // center so distinct 44px touch targets remain reachable. Document anchors
  // still use the original rectangle in cornerPoint.
  const [sx, sy] = signs[corner];
  const displayed = rotate(
    (sx * Math.max(transform.width * pw, (64 * width) / canvas.width)) / 2,
    (sy * Math.max(transform.height * ph, (64 * height) / canvas.height)) / 2,
    (transform.rotation * Math.PI) / 180,
  );
  const logical = {
    x: (transform.x + transform.width / 2) * pw + displayed.x,
    y: (transform.y + transform.height / 2) * ph + displayed.y,
  };
  const expected = {
    x:
      canvas.x +
      Math.max(0, Math.min(canvas.width, (panel.rect.x + logical.x / width) * canvas.width)),
    y:
      canvas.y +
      Math.max(0, Math.min(canvas.height, (panel.rect.y + logical.y / height) * canvas.height)),
  };
  const start = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  expect(Math.abs(start.x - expected.x)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(start.y - expected.y)).toBeLessThanOrEqual(1.5);
  for (const point of corners) {
    await expect(handle(page, point)).toHaveAttribute('data-resize-handle', point);
    const hitArea = (await handle(page, point).boundingBox())!;
    expect(hitArea.width).toBeGreaterThanOrEqual(44);
    expect(hitArea.height).toBeGreaterThanOrEqual(44);
  }
  return { canvas, panel, transform, pw, ph, start };
}
function assertAnchor(
  before: ElementTransform,
  after: ElementTransform,
  corner: Corner,
  pw: number,
  ph: number,
) {
  const a = cornerPoint(before, opposite[corner], pw, ph);
  const b = cornerPoint(after, opposite[corner], pw, ph);
  expect(b.x).toBeCloseTo(a.x, 6);
  expect(b.y).toBeCloseTo(a.y, 6);
  expect(after.rotation).toBe(before.rotation);
  expect(after.flipX).toBe(before.flipX);
  expect(after.flipY).toBe(before.flipY);
}
async function compareDownload(
  page: Page,
  info: TestInfo,
  name: string,
  expected: readonly number[],
) {
  await expect(page.getByRole('button', { name: 'PNG 다운로드 ↓', exact: true })).toBeEnabled();
  const preview = await frame(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드 ↓', exact: true }).click();
  const file = await pending;
  const output = info.outputPath(`${name}.png`);
  await file.saveAs(output);
  expect(await file.failure()).toBeNull();
  const bytes = await readFile(output);
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
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const [a, b] = await Promise.all([pixels(preview), pixels(output)]);
      let differentChannels = 0;
      for (let i = 0; i < Math.max(a.data.length, b.data.length); i++)
        if (a.data[i] !== b.data[i]) differentChannels++;
      return {
        preview: [a.width, a.height],
        download: [b.width, b.height],
        differentChannels,
        comparedChannels: a.data.length,
      };
    },
    { preview, output: `data:image/png;base64,${bytes.toString('base64')}` },
  );
  expect(comparison.download).toEqual(expected);
  expect(comparison.preview).toEqual(expected);
  expect(comparison.differentChannels).toBe(0);
  const result = {
    ...comparison,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    suggestedFilename: file.suggestedFilename(),
  };
  await writeFile(info.outputPath(`${name}-comparison.json`), JSON.stringify(result, null, 2));
  return result;
}

test('8비율: 기본·2컷 회전 요소의 네 모서리 터치 크기·한 단계 이력·두 해상도 PNG와 저장 복원', async ({
  page,
}, info) => {
  test.setTimeout(360_000);
  await ready(page);
  const client = await touchClient(page);
  const observations = [];
  const persisted: { name: string; frames: Partial<Record<Ratio, string>> }[] = [];
  try {
    for (const panelCount of [1, 2]) {
      if (panelCount === 2) {
        const starters = page.getByRole('region', { name: '기본 템플릿' });
        await starters.getByRole('button', { name: '전후 비교', exact: true }).click();
        await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
        await page.getByLabel('편집할 컷', { exact: true }).selectOption({ index: 1 });
        await page.getByRole('button', { name: '문구 추가', exact: true }).click();
        await fillCaption(page, '크기를 바꾼 장면');
      }
      const id = await selectedLayerId(page);
      const savedFrames: Partial<Record<Ratio, string>> = {};
      for (const [index, ratio] of ratios.entries()) {
        await page.getByRole('button', { name: ratio, exact: true }).click();
        await page.getByLabel('출력 크기', { exact: true }).selectOption('1080');
        await setPlacement(page, panelCount === 1 ? 27 : -31);
        const name = `resize-${panelCount}cut-${ratio.replace(':', 'x')}`;
        const baseline = await save(page, `${name}-baseline`);
        const before = await frame(page);
        const historyBefore = Number((await history(page).innerText()).match(/취소 (\d+)/)![1]);
        const corner = corners[(index + panelCount - 1) % corners.length]!;
        const g = await geometry(page, baseline, ratio, id, corner);
        const [sx, sy] = signs[corner];
        const delta = rotate(
          sx * g.pw * 0.06,
          sy * g.ph * 0.05,
          (g.transform.rotation * Math.PI) / 180,
        );
        const cssDelta = {
          x: (delta.x * g.canvas.width) / dimensions[1080][ratio][0],
          y: (delta.y * g.canvas.height) / dimensions[1080][ratio][1],
        };
        const scrollBefore = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
        await touchStart(client, g.start);
        await touchMoves(page, client, g.start, cssDelta);
        await touchEnd(client);
        expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scrollBefore);
        await expect(history(page)).toContainText(`취소 ${historyBefore + 1} · 다시 0`);
        const after = await frame(page);
        expect(after).not.toBe(before);
        const edited = await save(page, `${name}-edited`);
        const actual = placement(edited, ratio, id).transform;
        const scaling = assertTextScale(baseline, edited, ratio, id);
        expect(scaling.scale).toBeGreaterThan(1);
        expect(actual.width * g.canvas.width * g.panel.rect.width).toBeGreaterThanOrEqual(
          44 - 0.01,
        );
        expect(actual.height * g.canvas.height * g.panel.rect.height).toBeGreaterThanOrEqual(
          44 - 0.01,
        );
        assertAnchor(g.transform, actual, corner, g.pw, g.ph);
        expect(edited.layouts.filter((item) => item.ratio !== ratio)).toEqual(
          baseline.layouts.filter((item) => item.ratio !== ratio),
        );
        await history(page).getByRole('button', { name: '실행 취소', exact: true }).click();
        expect(await frame(page)).toBe(before);
        expect(content(await save(page, `${name}-undo`))).toEqual(content(baseline));
        await history(page).getByRole('button', { name: '다시 실행', exact: true }).click();
        expect(await frame(page)).toBe(after);
        expect(content(await save(page, `${name}-redo`))).toEqual(content(edited));
        // Removing the UI handles must not alter any artwork pixel.
        await expect(handles(page)).toHaveCount(4);
        await group(page).getByRole('button', { name: '선택 해제', exact: true }).click();
        await expect(handles(page)).toHaveCount(0);
        expect(await frame(page)).toBe(after);
        await selectLayer(page, id);
        await expect(handles(page)).toHaveCount(4);
        await page.getByLabel('파일 형식', { exact: true }).selectOption('png');
        await page.getByLabel('출력 범위', { exact: true }).selectOption('');
        await page.getByLabel('투명 배경 출력', { exact: true }).uncheck();
        for (const edge of [1080, 2048] as const) {
          await page.getByLabel('출력 크기', { exact: true }).selectOption(String(edge));
          await compareDownload(page, info, `${name}-${edge}`, dimensions[edge][ratio]);
        }
        await page.getByLabel('출력 크기', { exact: true }).selectOption('1080');
        observations.push({
          panelCount,
          ratio,
          corner,
          pointer: 'CDP touch',
          pointerMoves: 5,
          logicalPanelSize: [g.pw, g.ph],
          before: g.transform,
          scaling,
          actual,
          oppositeAnchorFixed: true,
          singleUndoStep: true,
          handlesExcludedFromPixels: true,
        });
      }
      // Font size is shared across layouts; capture every final frame after the
      // final resize so reload expectations reflect the stored shared style.
      for (const ratio of ratios) {
        await page.getByRole('button', { name: ratio, exact: true }).click();
        savedFrames[ratio] = await frame(page);
      }
      const name = `resize-${panelCount}cut-all-ratios`;
      await save(page, name);
      persisted.push({ name, frames: savedFrames });
    }
  } finally {
    await client.detach();
  }
  await page.reload();
  await openTool(page, '레이어');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 15_000,
  });
  for (const item of persisted) {
    await restore(page, item.name);
    await expect(
      history(page).getByRole('button', { name: '실행 취소', exact: true }),
    ).toBeDisabled();
    for (const ratio of ratios) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await page.getByLabel('출력 크기', { exact: true }).selectOption('1080');
      expect(await frame(page)).toBe(item.frames[ratio]);
    }
  }
  await page.locator('canvas').scrollIntoViewIfNeeded();
  await page
    .getByRole('region', { name: '카드 미리보기' })
    .screenshot({ path: info.outputPath('resize-handles.png') });
  await writeFile(
    info.outputPath('mobile-resize-matrix.json'),
    JSON.stringify(
      {
        project: info.project.name,
        realDevice: false,
        cases: observations,
        downloads: observations.length * 2,
        refreshAndAllRatioFramesRestored: true,
      },
      null,
      2,
    ),
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('크기 손잡이: 키보드·44px 최소 크기·편집 금지 상태와 오래된 터치 중단', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await ready(page);
  await fillCaption(page, '검증 문구');
  await setPlacement(page, 19);
  const id = await selectedLayerId(page);
  const initial = await save(page, 'resize-keyboard-before');
  const g = await geometry(page, initial, '1:1', id, 'se');
  await handle(page, 'se').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const keyboard = await save(page, 'resize-keyboard-after');
  const resized = placement(keyboard, '1:1', id).transform;
  const keyboardScaling = assertTextScale(initial, keyboard, '1:1', id);
  expect(keyboardScaling.scale).toBeGreaterThan(1);
  assertAnchor(g.transform, resized, 'se', g.pw, g.ph);
  const client = await touchClient(page);
  try {
    const minGeometry = await geometry(page, keyboard, '1:1', id, 'se');
    const fixed = cornerPoint(resized, 'nw', minGeometry.pw, minGeometry.ph);
    const current = cornerPoint(resized, 'se', minGeometry.pw, minGeometry.ph);
    const tiny = rotate(1, 1, (resized.rotation * Math.PI) / 180);
    const minimumDelta = {
      x: ((fixed.x + tiny.x - current.x) * minGeometry.canvas.width) / 1080,
      y: ((fixed.y + tiny.y - current.y) * minGeometry.canvas.height) / 1080,
    };
    await touchStart(client, minGeometry.start);
    await touchMoves(page, client, minGeometry.start, minimumDelta);
    await touchEnd(client);
    const minimum = await save(page, 'resize-touch-minimum');
    const small = placement(minimum, '1:1', id).transform;
    assertTextScale(keyboard, minimum, '1:1', id);
    expect(fontSize(minimum, id)).toBeLessThan(fontSize(keyboard, id));
    expect(small.width * minGeometry.canvas.width).toBeGreaterThanOrEqual(44 - 0.001);
    expect(small.height * minGeometry.canvas.height).toBeGreaterThanOrEqual(44 - 0.001);
    assertAnchor(resized, small, 'se', minGeometry.pw, minGeometry.ph);
    await page.locator('canvas').scrollIntoViewIfNeeded();
    const currentCanvas = (await page.locator('canvas').boundingBox())!;
    const center = {
      x: currentCanvas.x + (small.x + small.width / 2) * currentCanvas.width,
      y: currentCanvas.y + (small.y + small.height / 2) * currentCanvas.height,
    };
    expect(
      await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, center),
    ).toBe('CANVAS');
    await history(page).getByRole('button', { name: '실행 취소', exact: true }).click();
    expect(content(await save(page, 'resize-minimum-undone'))).toEqual(content(keyboard));

    await group(page).getByRole('button', { name: '선택 잠금', exact: true }).click();
    await expect(handles(page)).toHaveCount(0);
    await group(page).getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
    await expect(handles(page)).toHaveCount(4);
    await group(page).getByRole('button', { name: '선택 숨김', exact: true }).click();
    await expect(handles(page)).toHaveCount(0);
    await group(page).getByRole('button', { name: '선택 숨김 해제', exact: true }).click();
    await expect(handles(page)).toHaveCount(4);
    await group(page).getByRole('button', { name: '선택 해제', exact: true }).click();
    await expect(handles(page)).toHaveCount(0);
    await selectLayer(page, id);
    await expect(handles(page)).toHaveCount(4);
    await revealControl(page, page.locator('#caption'));
    await page.locator('#caption').dispatchEvent('compositionstart');
    await expect(handles(page)).toHaveCount(0);
    await page.locator('#caption').dispatchEvent('compositionend', { data: '' });
    await expect(handles(page)).toHaveCount(4);
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '다중 선택', exact: true }).click();
    await expect(handles(page)).toHaveCount(0);
    await group(page).getByRole('button', { name: '다중 선택', exact: true }).click();
    await expect(handles(page)).toHaveCount(4);
    await page.getByRole('button', { name: '문구 추가', exact: true }).click();
    const otherId = await selectedLayerId(page);
    await group(page)
      .getByRole('button', { name: '편집 가능한 요소 전체 선택', exact: true })
      .click();
    await expect(handles(page)).toHaveCount(0);
    await group(page).getByRole('button', { name: '선택 해제', exact: true }).click();
    await selectLayer(page, id);
    await expect(handles(page)).toHaveCount(4);
    const background = page.getByRole('region', { name: '배경 편집' });
    await openTool(page, '이미지');
    await revealControl(page, background.getByLabel('배경 원본 파일', { exact: true }));
    await background
      .getByLabel('배경 원본 파일', { exact: true })
      .setInputFiles(path.resolve('tests/fixtures/images/landscape.jpg'));
    await expect(background.getByRole('status')).toHaveCount(0);
    await background.getByLabel('배경 드래그 모드').check();
    await expect(handles(page)).toHaveCount(0);
    await background.getByLabel('배경 드래그 모드').uncheck();
    await expect(handles(page)).toHaveCount(4);
    await openTool(page, '레이어');

    const beforeLock = await save(page, 'resize-active-lock-before');
    const lockGesture = await geometry(page, beforeLock, '1:1', id, 'se');
    await touchStart(client, lockGesture.start);
    await group(page)
      .getByRole('button', { name: '선택 잠금', exact: true })
      .evaluate((node) => (node as HTMLButtonElement).click());
    await expect(handles(page)).toHaveCount(0);
    await touchMoves(page, client, lockGesture.start, { x: 20, y: 16 });
    await touchEnd(client);
    await group(page).getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
    await expect(handles(page)).toHaveCount(4);
    const afterLock = await save(page, 'resize-active-lock-after');
    expect(content(afterLock)).toEqual(content(beforeLock));
    const nextGesture = await geometry(page, afterLock, '1:1', id, 'se');
    await touchStart(client, nextGesture.start);
    await touchMoves(page, client, nextGesture.start, { x: 12, y: 10 });
    await touchEnd(client);
    const afterNext = await save(page, 'resize-after-active-lock');
    expect(placement(afterNext, '1:1', id).transform.width).toBeGreaterThan(
      placement(afterLock, '1:1', id).transform.width,
    );
    await history(page).getByRole('button', { name: '실행 취소', exact: true }).click();
    expect(content(await save(page, 'resize-active-lock-new-gesture-undone'))).toEqual(
      content(afterLock),
    );

    // No movement precedes invalidation: neither the old nor the new target may change.
    for (const boundary of ['ratio', 'selection', 'document'] as const) {
      await page.getByRole('button', { name: '1:1', exact: true }).click();
      await selectLayer(page, id);
      const before = await save(page, `resize-stale-${boundary}-before`);
      const beforeFrame = await frame(page);
      const stale = await geometry(page, before, '1:1', id, 'se');
      await touchStart(client, stale.start);
      if (boundary === 'ratio')
        await page
          .getByRole('button', { name: '4:5', exact: true })
          .evaluate((node) => (node as HTMLButtonElement).click());
      else if (boundary === 'selection') await selectLayer(page, otherId);
      else {
        const starters = page.getByRole('region', { name: '기본 템플릿' });
        await starters
          .getByRole('button', { name: '상황과 반응', exact: true })
          .evaluate((node) => (node as HTMLButtonElement).click());
        await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
      }
      const replacement = await frame(page);
      await touchMoves(page, client, stale.start, { x: 24, y: 18 });
      await touchEnd(client);
      expect(await frame(page)).toBe(replacement);
      const after = await save(page, `resize-stale-${boundary}-after`);
      if (boundary !== 'document') expect(content(after)).toEqual(content(before));
      else expect(after.id).not.toBe(before.id);
      if (boundary === 'ratio') {
        await page.getByRole('button', { name: '1:1', exact: true }).click();
        expect(await frame(page)).toBe(beforeFrame);
      }
    }
  } finally {
    await client.detach();
  }
  await writeFile(
    info.outputPath('mobile-resize-guards.json'),
    JSON.stringify(
      {
        removedHelpUiAbsent: true,
        keyboardBefore: g.transform,
        keyboardScaling,
        keyboardActual: resized,
        cssKeyboardSteps: [1, 10],
        minimumCssPixels: 44,
        blockedStates: [
          'locked',
          'hidden',
          'no selection',
          'IME',
          'multiple mode',
          'multiple selection',
          'background mode',
        ],
        lockDuringGestureClearsAndNextGestureWorks: true,
        staleBoundaries: ['ratio', 'selection', 'document'],
        allPreserved: true,
      },
      null,
      2,
    ),
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
});
