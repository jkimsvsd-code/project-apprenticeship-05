import { fillCaption, openTool, revealControl, selectLayer, selectedLayerId } from './ui-controls';
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
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 15_000,
  });
}
async function number(page: Page, label: string, value: number) {
  await revealControl(page, page.getByLabel(label, { exact: true }));
  await page.getByLabel(label, { exact: true }).fill(String(value));
  await page.getByLabel(label, { exact: true }).press('Enter');
  await expect(page.getByLabel(label, { exact: true })).toHaveValue(String(value));
}

const group = (page: Page) => page.getByRole('region', { name: '여러 요소와 컷 편집' });
const checks = (page: Page) => group(page).locator('.layer-list [data-element-id]');
async function chooseIds(page: Page, ids: string[]) {
  await openTool(page, '레이어');
  const multiple = group(page).getByRole('button', { name: '다중 선택', exact: true });
  const wasMultiple = (await multiple.getAttribute('aria-pressed')) === 'true';
  if (!wasMultiple) await multiple.click();
  await group(page).getByRole('button', { name: '선택 해제', exact: true }).click();
  for (const id of ids) await group(page).locator(`input[data-element-id="${id}"]`).check();
  if (!wasMultiple) await multiple.click();
}
async function selectedIds(page: Page) {
  return checks(page).evaluateAll((nodes) =>
    nodes
      .filter((node) =>
        node instanceof HTMLInputElement
          ? node.checked
          : node.getAttribute('aria-pressed') === 'true',
      )
      .map((node) => node.getAttribute('data-element-id')!),
  );
}
async function delta(page: Page, label: string, value: number) {
  await revealControl(page, page.getByLabel(label, { exact: true }));
  await page.getByLabel(label, { exact: true }).fill(String(value));
  await page.getByLabel(label, { exact: true }).press('Enter');
  await expect(page.getByLabel(label, { exact: true })).toHaveValue(
    label.includes('배율') ? '100' : '0',
  );
}
async function saveDoc(page: Page, name: string): Promise<StudioDocument> {
  await library(page).getByLabel('템플릿 이름').fill(name);
  await library(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('저장했습니다');
  return page.evaluate(async (name) => {
    const path = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ path
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-studio-demo');
    try {
      return (await db.getAll('templates')).find((item) => item.name === name)!.document;
    } finally {
      db.close();
    }
  }, name);
}
async function restore(page: Page) {
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
}
for (const config of [
  { count: 2, name: '전후 비교' },
  { count: 4, name: '짧은 이야기' },
]) {
  test(`${config.count}컷: 잠금·숨김·묶음·복제·컷 복사/순서·8비율 PNG와 저장 복원`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await ready(page);
    const starters = page.getByRole('region', { name: '기본 템플릿' });
    await starters.getByRole('button', { name: config.name, exact: true }).click();
    await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
    const sourcePanel = await page.getByLabel('편집할 컷', { exact: true }).inputValue();
    const initial = await saveDoc(page, '처음');
    const sourceIds = initial.panels[0]!.elementIds;
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '편집 가능한 요소 전체 선택' }).click();
    expect((await selectedIds(page)).sort()).toEqual([...sourceIds].sort());
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '선택 복제', exact: true }).click();
    const duplicates = await selectedIds(page);
    expect(duplicates).toHaveLength(sourceIds.length);
    expect(duplicates.every((id) => !sourceIds.includes(id))).toBe(true);
    for (const ratio of ratios) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await delta(page, '선택 묶음 가로 이동', 2);
      await delta(page, '선택 묶음 배율', 90);
    }
    const beforeCopy = await saveDoc(page, '복제 편집');
    const targetPanel = initial.panels[1]!.id;
    await openTool(page, '레이어');
    await group(page).getByLabel('복사할 컷', { exact: true }).selectOption(targetPanel);
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '다른 컷으로 복사', exact: true }).click();
    await expect(page.getByLabel('편집할 컷', { exact: true })).toHaveValue(targetPanel);
    const copies = await selectedIds(page);
    expect(copies).toHaveLength(sourceIds.length);
    const afterCopy = await saveDoc(page, '컷 복사');
    const sourceByKind = sourceIds.map((id) => initial.elements.find((item) => item.id === id)!);
    for (const layout of afterCopy.layouts) {
      const from = beforeCopy.layouts
        .find((item) => item.ratio === layout.ratio)!
        .panels.find((item) => item.panelId === sourcePanel)!;
      const to = layout.panels.find((item) => item.panelId === targetPanel)!;
      const sourceOrder = beforeCopy.panels[0]!.elementIds.filter((id) => duplicates.includes(id));
      const copyOrder = afterCopy.panels[1]!.elementIds.filter((id) => copies.includes(id));
      copyOrder.forEach((id, index) => {
        const a = from.elements.find((item) => item.elementId === sourceOrder[index])!.transform;
        const b = to.elements.find((item) => item.elementId === id)!.transform;
        expect(b.width * to.rect.width).toBeCloseTo(a.width * from.rect.width, 10);
        expect(b.height * to.rect.height).toBeCloseTo(a.height * from.rect.height, 10);
      });
    }
    // Editing the original text after copying cannot alter the copies.
    const originalText = sourceByKind.find((item) => item.kind === 'text')!;
    await revealControl(page, page.getByLabel('편집할 컷', { exact: true }));
    await page.getByLabel('편집할 컷', { exact: true }).selectOption(sourcePanel);
    await selectLayer(page, originalText.id);
    await fillCaption(page, '원본만 바꾼 문구');
    await revealControl(page, page.getByLabel('편집할 컷', { exact: true }));
    await page.getByLabel('편집할 컷', { exact: true }).selectOption(targetPanel);
    await chooseIds(page, copies);
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '컷을 이전으로', exact: true }).click();
    const hiddenFrames: Record<string, string> = {};
    for (const [index, ratio] of ratios.entries()) {
      if (index) {
        await openTool(page, '레이어');
        await group(page).getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
        await openTool(page, '레이어');
        await group(page).getByRole('button', { name: '선택 숨김 해제', exact: true }).click();
      }
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await delta(page, '선택 묶음 가로 이동', -1 - index * 0.2);
      await delta(page, '선택 묶음 세로 이동', 1);
      await delta(page, '선택 묶음 배율', 95);
      await revealControl(page, page.getByLabel('출력 크기'));
      await page.getByLabel('출력 크기').selectOption('1080');
      await compareDownload(
        page,
        info,
        `group-${config.count}-${ratio.replace(':', 'x')}-visible-1080`,
        expectedSizes[1080][ratio],
      );
      const visible = await frame(page);
      await openTool(page, '레이어');
      await group(page).getByRole('button', { name: '선택 잠금', exact: true }).click();
      await expect(page.getByLabel('선택 묶음 배율', { exact: true })).toBeDisabled();
      await expect(
        group(page).getByRole('button', { name: '선택 복제', exact: true }),
      ).toBeDisabled();
      await openTool(page, '레이어');
      await group(page).getByRole('button', { name: '선택 숨김', exact: true }).click();
      expect(await frame(page)).not.toBe(visible);
      await expect(page.locator('.selection-overlay rect')).toHaveCount(0);
      await revealControl(page, page.getByLabel('출력 크기'));
      await page.getByLabel('출력 크기').selectOption('2048');
      await compareDownload(
        page,
        info,
        `group-${config.count}-${ratio.replace(':', 'x')}-hidden-2048`,
        expectedSizes[2048][ratio],
      );
      hiddenFrames[ratio] = await frame(page);
    }
    const final = await saveDoc(page, '완성');
    expect(final.panels.map((item) => item.id)).toEqual([
      targetPanel,
      sourcePanel,
      ...initial.panels.slice(2).map((item) => item.id),
    ]);
    expect(final.panels[0]!.background).toEqual(initial.panels[1]!.background);
    for (const [index, layout] of final.layouts.entries())
      expect(layout.panels.map((item) => item.rect)).toEqual(
        initial.layouts[index]!.panels.map((item) => item.rect),
      );
    expect(
      final.elements
        .filter((item) => copies.includes(item.id))
        .every((item) => item.locked && item.hidden),
    ).toBe(true);
    expect(final.elements.find((item) => item.id === originalText.id)).toMatchObject({
      text: '원본만 바꾼 문구',
    });
    for (const item of final.elements.filter(
      (item) => copies.includes(item.id) && item.kind === 'text',
    ))
      expect(item).toMatchObject({ text: 'text' in originalText ? originalText.text : '' });
    expect(final.assets).toEqual(initial.assets);
    await page.reload();
    await openTool(page, '레이어');
    await library(page).getByLabel('저장된 템플릿').selectOption({ label: '완성' });
    await restore(page);
    await revealControl(page, page.getByLabel('출력 크기'));
    await page.getByLabel('출력 크기').selectOption('2048');
    for (const ratio of ratios) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      expect(await frame(page)).toBe(hiddenFrames[ratio]);
    }
    await library(page).getByLabel('JSON 범위').selectOption('selected');
    const pending = page.waitForEvent('download');
    await library(page).getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
    const backup = await pending;
    await backup.saveAs(info.outputPath('group.json'));
    await library(page).getByLabel('템플릿 JSON 파일').setInputFiles(info.outputPath('group.json'));
    await expect(library(page).getByRole('status')).toContainText('가져왔습니다');
    await restore(page);
    expect(await frame(page)).toBe(hiddenFrames['16:9']);
    await writeFile(
      info.outputPath('group-lifecycle.json'),
      JSON.stringify(
        {
          initial,
          beforeCopy,
          afterCopy,
          final,
          originalIndependent: true,
          allEightFramesRestored: true,
          jsonRestored: true,
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: info.outputPath('group-editor.png'), fullPage: true });
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('Shift/터치 다중 선택·묶음 끌기와 잘못된 입력/복제 한도 보존', async ({ page }, info) => {
  test.setTimeout(90_000);
  await ready(page);
  await page.getByRole('button', { name: '선택 요소 삭제', exact: true }).click();
  await revealControl(page, page.getByLabel('추가할 말풍선'));
  await page.getByLabel('추가할 말풍선').selectOption('caption');
  const ids: string[] = [];
  for (const x of [10, 60]) {
    await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
    ids.push(await selectedLayerId(page));
    await fillCaption(page, '묶음');
    for (const [label, value] of [
      ['요소 가로 위치', x],
      ['요소 세로 위치', 30],
      ['요소 폭', 20],
      ['요소 높이', 20],
    ] as const)
      await number(page, label, value);
  }
  await openTool(page, '레이어');
  await group(page).getByRole('button', { name: '선택 해제', exact: true }).click();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('canvas').boundingBox())!;
  const mobile = info.project.name.startsWith('mobile');
  const a = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.4 };
  const b = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.4 };
  if (mobile) {
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '다중 선택', exact: true }).click();
    await page.locator('canvas').scrollIntoViewIfNeeded();
    const mobileBox = (await page.locator('canvas').boundingBox())!;
    await page.touchscreen.tap(
      mobileBox.x + mobileBox.width * 0.2,
      mobileBox.y + mobileBox.height * 0.4,
    );
    await page.touchscreen.tap(
      mobileBox.x + mobileBox.width * 0.7,
      mobileBox.y + mobileBox.height * 0.4,
    );
    await openTool(page, '레이어');
    await group(page).getByRole('button', { name: '다중 선택', exact: true }).click();
  } else {
    await page.keyboard.down('Shift');
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Shift');
  }
  expect((await selectedIds(page)).sort()).toEqual([...ids].sort());
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const currentBox = (await page.locator('canvas').boundingBox())!;
  const from = {
    x: currentBox.x + currentBox.width * 0.2,
    y: currentBox.y + currentBox.height * 0.4,
  };
  const to = { x: from.x + currentBox.width * 0.05, y: from.y + currentBox.height * 0.06 };
  if (mobile) {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
  }
  const moved = await saveDoc(page, '묶음 이동');
  const poses = moved.layouts[0]!.panels[0]!.elements.filter((item) =>
    ids.includes(item.elementId),
  );
  expect(poses[0]!.transform.x).toBeCloseTo(0.15, 2);
  expect(poses[1]!.transform.x).toBeCloseTo(0.65, 2);
  expect(poses.every((item) => Math.abs(item.transform.y - 0.36) < 0.005)).toBe(true);
  const before = await frame(page);
  for (const [label, value] of [
    ['선택 묶음 가로 이동', 500],
    ['선택 묶음 배율', 0],
  ] as const) {
    await revealControl(page, page.getByLabel(label, { exact: true }));
    await page.getByLabel(label, { exact: true }).fill(String(value));
    await page.getByLabel(label, { exact: true }).press('Enter');
    await expect(page.getByRole('alert')).toContainText('기존 작업');
    expect(await frame(page)).toBe(before);
  }
  await compareDownload(page, info, 'group-pointer', expectedSizes[1080]['1:1']);
  await writeFile(
    info.outputPath('group-pointer.json'),
    JSON.stringify(
      {
        moved,
        pointer: mobile ? 'CDP touch / touch mode' : 'Shift mouse',
        invalidChangesPreserved: true,
      },
      null,
      2,
    ),
  );
  await openTool(page, '레이어');
  await group(page).getByRole('button', { name: '선택 해제', exact: true }).click();
  await revealControl(page, page.getByLabel('추가할 캐릭터'));
  for (let count = 0; count < 4; count++) {
    await page.getByRole('button', { name: '캐릭터 추가', exact: true }).click();
    await expect(page.getByRole('button', { name: '캐릭터 추가', exact: true })).toBeEnabled();
  }
  await openTool(page, '레이어');
  await group(page).getByRole('button', { name: '편집 가능한 요소 전체 선택' }).click();
  const full = await frame(page);
  const chosen = await selectedIds(page);
  await openTool(page, '레이어');
  await group(page).getByRole('button', { name: '선택 복제', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('최대 4개');
  expect(await frame(page)).toBe(full);
  expect(await selectedIds(page)).toEqual(chosen);
  const preserved = await saveDoc(page, '한도 보존');
  expect(preserved.elements.filter((item) => item.kind === 'character')).toHaveLength(4);
  await writeFile(
    info.outputPath('group-limit.json'),
    JSON.stringify({ preserved, selectionPreserved: true, framePreserved: true }, null, 2),
  );
});

test('숨김은 실제 출력의 색상에서도 제외되며 잠금은 포인터와 문구 편집을 막는다', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  await ready(page);
  await page.getByRole('button', { name: '선택 요소 삭제', exact: true }).click();
  const empty = await frame(page);
  await revealControl(page, page.getByLabel('추가할 말풍선'));
  await page.getByLabel('추가할 말풍선').selectOption('caption');
  await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
  await fillCaption(page, '');
  for (const [label, value] of [
    ['요소 가로 위치', 20],
    ['요소 세로 위치', 20],
    ['요소 폭', 40],
    ['요소 높이', 40],
  ] as const)
    await number(page, label, value);
  await revealControl(page, page.getByLabel('말풍선 채우기 색', { exact: true }));
  await page.getByLabel('말풍선 채우기 색', { exact: true }).evaluate((node) => {
    const input = node as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      '#ff0000',
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const pixel = () =>
    page
      .locator('canvas')
      .evaluate((node) => [
        ...(node as HTMLCanvasElement).getContext('2d')!.getImageData(432, 432, 1, 1).data,
      ]);
  expect(await pixel()).toEqual([255, 0, 0, 255]);
  const red = await frame(page);
  await openTool(page, '레이어');
  await group(page).getByRole('button', { name: '선택 잠금', exact: true }).click();
  await expect(page.locator('#caption')).toBeDisabled();
  await expect(page.getByLabel('요소 가로 위치', { exact: true })).toBeDisabled();
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.mouse.up();
  expect(await frame(page)).toBe(red);
  await openTool(page, '레이어');
  await group(page).getByRole('button', { name: '선택 숨김', exact: true }).click();
  expect(await frame(page)).toBe(empty);
  await compareDownload(page, info, 'hidden-independent-background', expectedSizes[1080]['1:1']);
  await openTool(page, '레이어');
  await group(page).getByRole('button', { name: '선택 숨김 해제', exact: true }).click();
  expect(await frame(page)).toBe(red);
  await openTool(page, '레이어');
  await group(page).getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
  await expect(page.locator('#caption')).toBeEnabled();
  await compareDownload(page, info, 'shown-independent-red', expectedSizes[1080]['1:1']);
  await writeFile(
    info.outputPath('group-pixel-oracle.json'),
    JSON.stringify(
      {
        expectedVisiblePixel: [255, 0, 0, 255],
        hiddenEqualsOriginalBackground: true,
        shownFrameRestored: true,
        lockedPointerPreserved: true,
      },
      null,
      2,
    ),
  );
});
