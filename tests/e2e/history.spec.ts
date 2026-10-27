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

const history = (page: Page) => page.getByRole('region', { name: '현재 세션 편집 이력' });
const undo = (page: Page) => history(page).getByRole('button', { name: '실행 취소', exact: true });
const redo = (page: Page) => history(page).getByRole('button', { name: '다시 실행', exact: true });
const group = (page: Page) => page.getByRole('region', { name: '여러 요소와 컷 편집' });
function content(doc: StudioDocument) {
  return { ...doc, updatedAt: '', activeRatio: '1:1' };
}
async function starter(page: Page) {
  const region = page.getByRole('region', { name: '기본 템플릿' });
  await region.getByRole('button', { name: '전후 비교', exact: true }).click();
  await expect(region.getByRole('status')).toContainText('사본을 불러왔습니다');
  await expect(undo(page)).toBeDisabled();
}
async function field(page: Page, name: string, value: number) {
  await revealControl(page, page.getByLabel(name, { exact: true }));
  await page.getByLabel(name, { exact: true }).fill(String(value));
  await page.getByLabel(name, { exact: true }).press('Enter');
}

test('8비율: 이미지·문구·배경·요소·컷 이력 왕복, 전체 상태와 PNG 복구', async ({ page }, info) => {
  test.setTimeout(300_000);
  await ready(page);
  const observations = [];
  for (const [index, ratio] of ratios.entries()) {
    await starter(page);
    await page.getByRole('button', { name: ratio, exact: true }).click();
    const baseline = await save(page, `baseline-${index}`);
    const before = await frame(page);
    await expect(undo(page)).toBeDisabled();
    await revealControl(page, page.getByLabel('이미지 적용 대상', { exact: true }));
    await page.getByLabel('이미지 적용 대상', { exact: true }).selectOption('background');
    await page
      .getByLabel('이미지 파일', { exact: true })
      .setInputFiles(path.resolve('tests/fixtures/images/landscape.jpg'));
    await expect(page.getByRole('status').filter({ hasText: 'landscape.jpg' })).toHaveCount(1);
    await fillCaption(page, `복구 ${ratio}`);
    await number(page, '배경 가로 위치', 18);
    await image(page, true, 'portrait.png');
    await openTool(page, '이미지');
    await bg(page).getByRole('button', { name: '원본 이미지로 복귀', exact: true }).click();
    await openTool(page, '레이어');
    await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
    await field(page, '요소 회전', 23);
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '선택 복제', exact: true }).click();
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '다른 컷으로 복사', exact: true }).click();
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '선택 숨김', exact: true }).click();
    await openTool(page, '레이어');
    await page.getByRole('button', { name: '선택 요소 삭제', exact: true }).click();
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '컷을 이전으로', exact: true }).click();
    const after = await frame(page);
    const edited = await save(page, `edited-${index}`);
    expect(after).not.toBe(before);
    let steps = 0;
    while (await undo(page).isEnabled()) {
      await undo(page).click();
      steps++;
      expect(steps).toBeLessThan(25);
    }
    expect(steps).toBe(12);
    await expect(page.getByRole('button', { name: ratio, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(content(await save(page, `undone-${index}`))).toEqual(content(baseline));
    expect(await frame(page)).toBe(before);
    await options(page, 'png', false);
    await download(page, info, `undo-${index}`, 'png', sizes[1080][index]!, false, true);
    for (let i = 0; i < steps; i++) await redo(page).click();
    await expect(redo(page)).toBeDisabled();
    expect(content(await save(page, `redone-${index}`))).toEqual(content(edited));
    expect(await frame(page)).toBe(after);
    await options(page, 'png', false);
    await download(page, info, `redo-${index}`, 'png', sizes[1080][index]!, false, true);
    observations.push({ ratio, steps, entireDocumentRestored: true, frameRestored: true });
  }
  await writeFile(info.outputPath('history-matrix.json'), JSON.stringify(observations, null, 2));
});

test('세션 경계·저장 유지·분기·잘못된 입력·IME·단축키·비동기 이미지 취소', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await ready(page);
  await fillCaption(page, '첫 번째');
  await page.locator('#caption').pressSequentially(' 연속');
  await save(page, '세션 유지');
  await expect(history(page)).toContainText('취소 1 · 다시 0');
  await undo(page).click();
  await expect(page.locator('#caption')).not.toHaveValue('첫 번째 연속');
  await redo(page).click();
  await expect(page.locator('#caption')).toHaveValue('첫 번째 연속');
  // View and export settings do not branch or consume history.
  await undo(page).click();
  await page.getByRole('button', { name: '16:9', exact: true }).click();
  await revealControl(page, page.getByLabel('출력 크기'));
  await page.getByLabel('출력 크기').selectOption('2048');
  await expect(history(page)).toContainText('취소 0 · 다시 1');
  await page
    .getByLabel('이미지 파일', { exact: true })
    .setInputFiles(path.resolve('tests/fixtures/images/not-image.txt'));
  await expect(page.getByRole('alert')).toContainText('기존 작업');
  await expect(redo(page)).toBeEnabled();
  await redo(page).focus();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#caption')).toHaveValue('첫 번째 연속');
  await expect(page.getByLabel('출력 크기')).toHaveValue('2048');
  await page.locator('#caption').dispatchEvent('compositionstart');
  await fillCaption(page, '조합 중');
  await expect(undo(page)).toBeDisabled();
  await page.locator('#caption').dispatchEvent('compositionend', { data: '조합 중' });
  await undo(page).click();
  await expect(page.locator('#caption')).toHaveValue('첫 번째 연속');
  await fillCaption(page, '새 분기');
  await save(page, '새 분기 저장');
  await expect(redo(page)).toBeDisabled();
  // Gate the real Blob decoder to prove a pending result cannot reapply after undo/redo ABA.
  await page.evaluate(() => {
    const original = window.createImageBitmap.bind(window);
    window.createImageBitmap = (async (...args: Parameters<typeof createImageBitmap>) => {
      if (args[0] instanceof Blob) {
        document.body.dataset.decoderHeld = 'true';
        await new Promise<void>((resolve) =>
          window.addEventListener('release-decoder', () => resolve(), { once: true }),
        );
      }
      const result = await original(...args);
      document.body.dataset.decoderDone = 'true';
      return result;
    }) as typeof createImageBitmap;
  });
  await page
    .getByLabel('이미지 파일', { exact: true })
    .setInputFiles(path.resolve('tests/fixtures/images/portrait.png'));
  await expect(page.locator('body')).toHaveAttribute('data-decoder-held', 'true');
  await undo(page).click();
  await redo(page).click();
  const before = await frame(page);
  await page.evaluate(() => window.dispatchEvent(new Event('release-decoder')));
  await expect(page.locator('body')).toHaveAttribute('data-decoder-done', 'true');
  await expect(page.getByRole('button', { name: 'PNG 다운로드 ↓', exact: true })).toBeEnabled();
  expect(await frame(page)).toBe(before);
  await restore(page, '세션 유지');
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeDisabled();
  await fillCaption(page, '새 세션 변경');
  await expect(undo(page)).toBeEnabled();
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  await expect(undo(page)).toBeDisabled();
  await expect(redo(page)).toBeDisabled();
  await writeFile(
    info.outputPath('session-boundaries.json'),
    JSON.stringify(
      {
        saveRetainsHistory: true,
        navigationRetainsRedo: true,
        invalidInputRetainsRedo: true,
        imeGuard: true,
        branchClearsRedo: true,
        asyncABARejected: true,
        templateResets: true,
        reloadResets: true,
      },
      null,
      2,
    ),
  );
});

test('8비율: 여러 pointermove를 한 드래그 단계로 묶고 취소·재실행한다', async ({ page }, info) => {
  test.setTimeout(180_000);
  await ready(page);
  await image(page, false, 'landscape.jpg');
  const observations = [];
  for (const [index, ratio] of ratios.entries()) {
    await openTool(page, '이미지');
    await bg(page).getByLabel('배경 드래그 모드').uncheck();
    await page.getByRole('button', { name: ratio, exact: true }).click();
    const doc = await save(page, `drag-${index}`);
    const layout = doc.layouts.find((item) => item.ratio === ratio)!;
    const panel = layout.panels[0]!;
    const t = panel.elements[0]!.transform;
    const canvas = page.locator('canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    const x = box.x + (panel.rect.x + (t.x + t.width / 2) * panel.rect.width) * box.width;
    const y = box.y + (panel.rect.y + (t.y + t.height / 2) * panel.rect.height) * box.height;
    const before = await frame(page);
    const count = Number((await history(page).innerText()).match(/취소 (\d+)/)![1]);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + box.width * 0.05, y + box.height * 0.03, { steps: 6 });
    await page.mouse.up();
    const after = await frame(page);
    expect(after).not.toBe(before);
    await expect(history(page)).toContainText(`취소 ${count + 1} · 다시 0`);
    // Body focus exercises the global keyboard handler.
    await page.locator('body').evaluate((node) => {
      node.tabIndex = -1;
      node.focus();
    });
    await page.keyboard.press('Control+z');
    expect(await frame(page)).toBe(before);
    await page.keyboard.press('Control+y');
    expect(await frame(page)).toBe(after);
    await openTool(page, '이미지');
    await bg(page).getByLabel('배경 드래그 모드').check();
    await canvas.scrollIntoViewIfNeeded();
    const bgBox = (await canvas.boundingBox())!;
    const bgBefore = await frame(page);
    await page.mouse.move(bgBox.x + bgBox.width / 2, bgBox.y + bgBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(bgBox.x + bgBox.width * 0.57, bgBox.y + bgBox.height * 0.55, {
      steps: 6,
    });
    await page.mouse.up();
    const bgAfter = await frame(page);
    expect(bgAfter).not.toBe(bgBefore);
    await expect(history(page)).toContainText(`취소 ${count + 2} · 다시 0`);
    await undo(page).click();
    expect(await frame(page)).toBe(bgBefore);
    await redo(page).click();
    expect(await frame(page)).toBe(bgAfter);
    observations.push({
      ratio,
      pointerMoves: 6,
      elementSingleStep: true,
      backgroundSingleStep: true,
      roundTrip: true,
    });
  }
  await writeFile(info.outputPath('drag-history.json'), JSON.stringify(observations, null, 2));
});

test('8비율: 저장은 이력 유지, 불러오기와 새로고침은 새 세션', async ({ page }, info) => {
  test.setTimeout(180_000);
  await ready(page);
  const observations = [];
  for (const [index, ratio] of ratios.entries()) {
    await page.getByRole('button', { name: ratio, exact: true }).click();
    await fillCaption(page, `세션 경계 ${ratio}`);
    await save(page, `boundary-${index}`);
    await expect(history(page)).toContainText('취소 1 · 다시 0');
    await restore(page, `boundary-${index}`);
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: ratio, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await fillCaption(page, '새 세션의 변경');
    await expect(undo(page)).toBeEnabled();
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
    await expect(undo(page)).toBeDisabled();
    await expect(redo(page)).toBeDisabled();
    observations.push({
      ratio,
      saveRetainsHistory: true,
      loadStartsSession: true,
      reloadStartsSession: true,
    });
  }
  await writeFile(
    info.outputPath('session-boundary-matrix.json'),
    JSON.stringify(observations, null, 2),
  );
});
