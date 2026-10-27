import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StudioDocument } from '@jjal/document-model';
import {
  activate,
  card,
  closeMobilePanel,
  downloadPng,
  frame,
  goPage,
  library,
  loadSelected,
  normalized,
  number,
  openResources,
  rail,
  ready,
  resources,
  restore,
  reveal,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

const working = path.resolve('../local-only/jjal-card-studio-plan/working/S01-022-resource-tools');
const before = process.env.RESOURCE_TOOLS_PHASE === 'before';
const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;

async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      const box = element?.getBoundingClientRect();
      return box
        ? {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            top: box.top,
            bottom: box.bottom,
          }
        : null;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      canvas: rect('canvas[aria-label^="카드 "]'),
      stage: rect('.canvas-stage'),
      workspace: rect('.card-workspace'),
      quickBar: rect('.quick-add-bar'),
      context: rect('.canvas-contextbar'),
    };
  });
}

test('같은 화면·8비율에서 직접 추가 줄을 제거한 캔버스 높이를 원본과 비교한다', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await ready(page);
  const directory = path.join(working, 'geometry-baseline');
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${info.project.name}.json`);
  const measurements = [];
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    await closeMobilePanel(page);
    await expect(card(page)).toHaveAttribute('aria-label', `카드 ${ratio} 비율`);
    const current = await geometry(page);
    measurements.push({ ratio, ...current });
    await page.screenshot({
      path: info.outputPath(`canvas-${ratio.replace(':', '-')}.png`),
      fullPage: true,
    });
  }
  if (before) await writeFile(filename, JSON.stringify(measurements, null, 2));
  else {
    const baseline = JSON.parse(await readFile(filename, 'utf8')) as typeof measurements;
    for (const current of measurements) {
      const original = baseline.find((item) => item.ratio === current.ratio)!;
      expect(current.viewport).toEqual(original.viewport);
      expect(current.quickBar).toBeNull();
      expect(current.stage!.height).toBeGreaterThan(original.stage!.height);
      expect(current.canvas!.height).toBeGreaterThanOrEqual(original.canvas!.height - 1);
    }
    const tall = measurements.find((item) => item.ratio === '9:16')!;
    expect(tall.canvas!.height).toBeGreaterThan(
      baseline.find((item) => item.ratio === '9:16')!.canvas!.height,
    );
  }
  await writeFile(
    info.outputPath('canvas-height-comparison.json'),
    JSON.stringify({ phase: before ? 'before' : 'after', measurements }, null, 2),
  );
});

const bubbleShapes = [
  { shape: 'speech', label: '대화 말풍선 추가' },
  { shape: 'thought', label: '생각 말풍선 추가' },
  { shape: 'shout', label: '외침 말풍선 추가' },
  { shape: 'caption', label: '설명 상자 추가' },
] as const;

async function assertRemovedControls(page: Page) {
  await expect(page.locator('[data-tool-page="image"]')).toHaveCount(0);
  await expect(
    page
      .locator('.tool-bookmarks')
      .getByRole('tab', { name: '이미지', exact: true, includeHidden: true }),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.mobile-tool-dock')
      .getByRole('button', { name: '이미지', exact: true, includeHidden: true }),
  ).toHaveCount(0);
  for (const name of ['문구 추가', '말풍선 추가'])
    await expect(page.getByRole('button', { name, exact: true, includeHidden: true })).toHaveCount(
      0,
    );
  await expect(page.locator('.quick-add-bar')).toHaveCount(0);
}

async function bubbleFolder(page: Page) {
  await openResources(page);
  const tab = resources(page).getByRole('tab', { name: '말풍선', exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(tab).toHaveAttribute('id', 'resource-folder-builtin-bubbles');
  await expect(resources(page).locator('[data-bubble-shape]')).toHaveCount(4);
  await expect(resources(page).locator('.resource-import')).toBeHidden();
}

async function addBubble(page: Page, touch: boolean, shape: (typeof bubbleShapes)[number]) {
  await bubbleFolder(page);
  const previous = await selectedLayer(page).getAttribute('data-element-id');
  const tile = resources(page).locator(`[data-bubble-shape="${shape.shape}"]`);
  await expect(tile).toHaveAccessibleName(shape.label);
  await activate(tile, touch);
  await expect(selectedLayer(page)).toHaveCount(1);
  await expect(selectedLayer(page)).toHaveAttribute('aria-label', /말풍선/);
  const id = (await selectedLayer(page).getAttribute('data-element-id'))!;
  expect(id).not.toBe(previous);
  return id;
}

function assertUnchanged(beforeDoc: StudioDocument, afterDoc: StudioDocument) {
  for (const element of beforeDoc.elements) {
    expect(afterDoc.elements.find((item) => item.id === element.id)).toEqual(element);
    for (const layout of beforeDoc.layouts)
      for (const panel of layout.panels) {
        const placement = panel.elements.find((item) => item.elementId === element.id);
        if (placement)
          expect(
            afterDoc.layouts
              .find((item) => item.ratio === layout.ratio)!
              .panels.find((item) => item.panelId === panel.panelId)!
              .elements.find((item) => item.elementId === element.id),
          ).toEqual(placement);
      }
  }
}

async function placeImage(page: Page, touch: boolean, resourceId: string) {
  await openResources(page);
  await resources(page).getByRole('tab', { name: '미분류', exact: true }).click();
  const previous = await selectedLayer(page).getAttribute('data-element-id');
  await activate(resources(page).locator(`[data-resource-id="${resourceId}"]`), touch);
  await expect.poll(() => selectedLayer(page).getAttribute('data-element-id')).not.toBe(previous);
  await expect(selectedLayer(page)).toHaveCount(1);
  await expect(selectedLayer(page)).toHaveAttribute('aria-label', /이미지/);
  return (await selectedLayer(page).getAttribute('data-element-id'))!;
}

test('말풍선 고정 폴더의 4종을 각각 두 번 추가하고 텍스트·이미지·캐시·JSON·8비율 PNG를 보존한다', async ({
  page,
  isMobile,
}, info) => {
  test.skip(before, 'Before phase records original geometry without asserting the new UI exists.');
  test.setTimeout(360_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await assertRemovedControls(page);
  const initial = (await saveDocument(page, info, '도구 정리 시작')).document;
  const initialText = initial.elements.find((element) => element.kind === 'text')!;
  await rail(page).locator(`[data-element-id="${initialText.id}"]`).click();
  await (await reveal(page, '문구', 'text')).fill('남아 있는 문구 편집');
  const edited = (await saveDocument(page, info, '기존 문구 편집')).document;
  expect(edited.elements.find((element) => element.id === initialText.id)).toMatchObject({
    text: '남아 있는 문구 편집',
  });
  expect(edited.elements).toHaveLength(initial.elements.length);

  await openResources(page);
  await resources(page).getByRole('tab', { name: '미분류', exact: true }).click();
  const files = ['portrait.png', 'landscape.jpg'];
  const resourceIds = [];
  for (const file of files)
    resourceIds.push(
      `resource-${createHash('sha256')
        .update(await readFile(`tests/fixtures/images/${file}`))
        .digest('hex')}`,
    );
  await resources(page)
    .getByLabel('자원 이미지 파일', { exact: true })
    .setInputFiles(files.map((file) => `tests/fixtures/images/${file}`));
  await expect(resources(page).locator('[data-resource-id]')).toHaveCount(2);
  const imageIds: string[] = [];
  for (const [index, resourceId] of [resourceIds[0]!, resourceIds[1]!, resourceIds[0]!].entries()) {
    imageIds.push(await placeImage(page, isMobile, resourceId));
    for (const [label, value] of [
      ['요소 폭', 18],
      ['요소 높이', 20],
      ['요소 가로 위치', 8 + index * 28],
      ['요소 세로 위치', 70],
    ] as const)
      await number(page, label, value);
  }
  const images = (await saveDocument(page, info, '이미지 세 개 유지')).document;
  assertUnchanged(edited, images);
  expect(new Set(imageIds).size).toBe(3);
  const imageAssetIds = imageIds.map((id) => {
    const element = images.elements.find((element) => element.id === id)!;
    if (element.kind !== 'image')
      throw new Error('Image resource did not create an independent image');
    return element.assetId;
  });
  expect(imageAssetIds[0]).toBe(imageAssetIds[2]);
  expect(imageAssetIds[0]).not.toBe(imageAssetIds[1]);

  const bubbleIds: string[] = [];
  for (const [index, shape] of bubbleShapes.entries())
    for (let repeat = 0; repeat < 2; repeat++) {
      const beforeAdd = await frame(page);
      const id = await addBubble(page, isMobile, shape);
      bubbleIds.push(id);
      if (index === 0 && repeat === 0) {
        await page.getByRole('button', { name: '실행 취소', exact: true }).click();
        await expect(rail(page).locator(`[data-element-id="${id}"]`)).toHaveCount(0);
        expect(await frame(page)).toBe(beforeAdd);
        await page.getByRole('button', { name: '다시 실행', exact: true }).click();
        await expect(rail(page).locator(`[data-element-id="${id}"]`)).toHaveCount(1);
        await rail(page).locator(`[data-element-id="${id}"]`).click();
      }
      await (await reveal(page, '문구', 'text')).fill(`${shape.shape} ${repeat + 1}`);
      for (const [label, value] of [
        ['요소 폭', 34],
        ['요소 높이', 18],
        ['요소 가로 위치', repeat ? 58 : 8],
        ['요소 세로 위치', 4 + index * 22],
      ] as const)
        await number(page, label, value);
    }
  const created = await saveDocument(page, info, '말풍선 여덟 개');
  expect(new Set(bubbleIds).size).toBe(8);
  expect(created.document.elements).toHaveLength(initial.elements.length + 11);
  assertUnchanged(images, created.document);
  for (const shape of bubbleShapes) {
    const bubbles = created.document.elements.filter(
      (element) => element.kind === 'bubble' && element.shape === shape.shape,
    );
    expect(bubbles).toHaveLength(2);
    for (const bubble of bubbles) expect(bubble).toMatchObject({ locked: false, hidden: false });
  }
  for (const layout of created.document.layouts)
    for (const id of [...bubbleIds, ...imageIds])
      expect(layout.panels[0]!.elements.some((element) => element.elementId === id)).toBe(true);
  const previews = new Map<string, string>();
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    previews.set(ratio, await frame(page));
  }
  const final = await saveDocument(page, info, '말풍선 폴더 최종');
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await assertRemovedControls(page);
  await bubbleFolder(page);
  await resources(page).getByRole('tab', { name: '미분류', exact: true }).click();
  await expect(resources(page).locator('[data-resource-id]')).toHaveCount(2);
  for (const image of await resources(page).locator('[data-resource-id] img').all())
    expect(
      await image.evaluate(async (node) => {
        await (node as HTMLImageElement).decode();
        return (node as HTMLImageElement).naturalWidth;
      }),
    ).toBeGreaterThan(0);
  const cachedId = await placeImage(page, isMobile, resourceIds[0]!);
  await expect(rail(page).locator(`[data-element-id="${cachedId}"]`)).toHaveCount(1);
  await restore(page, '말풍선 폴더 최종');
  const restored = await saveDocument(page, info, '말풍선 폴더 복원');
  expect(normalized(restored.document)).toEqual(normalized(final.document));
  const optionsBefore = await library(page)
    .getByLabel('저장된 템플릿', { exact: true })
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  const currentFrame = await frame(page);
  await library(page).getByLabel('템플릿 JSON 파일', { exact: true }).setInputFiles(final.path);
  await expect(library(page).getByRole('status')).toContainText('새 사본으로 가져왔습니다');
  expect(await frame(page)).toBe(currentFrame);
  const optionsAfter = await library(page)
    .getByLabel('저장된 템플릿', { exact: true })
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  const imported = optionsAfter.filter((id) => id && !optionsBefore.includes(id));
  expect(imported).toHaveLength(1);
  await library(page).getByLabel('저장된 템플릿', { exact: true }).selectOption(imported[0]!);
  await loadSelected(page);
  expect(normalized((await saveDocument(page, info, '말풍선 JSON 왕복')).document)).toEqual(
    normalized(final.document),
  );
  const pixels = [];
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    expect(await frame(page)).toBe(previews.get(ratio));
    pixels.push({
      ratio,
      comparison: await downloadPng(page, info, `resource-bubbles-${ratio.replace(':', '-')}`),
    });
  }
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('resource-tools-evidence.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        bubbleIds,
        imageIds,
        imageAssetIds,
        resourceIds,
        cachedId,
        templateRestore: true,
        jsonRoundTrip: true,
        pixels,
        errors,
      },
      null,
      2,
    ),
  );
  await closeMobilePanel(page);
  await page.screenshot({ path: info.outputPath('resource-tools-final.png'), fullPage: true });
});

test('보기 전용은 이미지 탭과 직접 추가 버튼 없이 자원·말풍선 추가 및 기존 문구 편집을 막는다', async ({
  page,
}, info) => {
  test.skip(before, 'Before phase records original geometry only.');
  await ready(page, '/?view=readonly');
  await assertRemovedControls(page);
  const originalFrame = await frame(page);
  const originalIds = await rail(page)
    .locator('[data-element-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-element-id')));
  await openResources(page);
  await expect(resources(page).locator('.resource-readonly-banner')).toBeVisible();
  await expect(resources(page).getByRole('tab', { name: '말풍선', exact: true })).toHaveCount(0);
  await expect(resources(page).locator('[data-bubble-shape], [data-resource-id]')).toHaveCount(0);
  await expect(resources(page).getByLabel('자원 이미지 파일', { exact: true })).toHaveCount(0);
  await goPage(page, 'text');
  await expect(await reveal(page, '문구', 'text')).toBeDisabled();
  await expect(
    page.locator('.canvas-contextbar').getByRole('button', { name: '내용 수정', exact: true }),
  ).toBeDisabled();
  expect(await frame(page)).toBe(originalFrame);
  expect(
    await rail(page)
      .locator('[data-element-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-element-id'))),
  ).toEqual(originalIds);
  await writeFile(
    info.outputPath('resource-tools-readonly.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        removedDirectControls: true,
        bubbleTilesAbsent: true,
        resourceTilesAbsent: true,
        textEditDisabled: true,
        originalIds,
        frameUnchanged: true,
      },
      null,
      2,
    ),
  );
});

async function dragTile(
  page: Page,
  touch: boolean,
  source: Locator,
  target: Locator,
  local: { x: number; y: number },
) {
  if (!touch) {
    await page.bringToFront();
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await source.scrollIntoViewIfNeeded();
  // Native HTML5 drag must not scroll the document between down and its first move.
  await expect(source).toBeInViewport({ ratio: 1 });
  await expect(target).toBeInViewport({ ratio: 1 });
  const destination = (await target.boundingBox())!;
  const to = {
    x: destination.x + destination.width * local.x,
    y: destination.y + destination.height * local.y,
  };
  if (!touch) {
    const scrollBefore = await page.evaluate(() => scrollY);
    await source.dragTo(target, {
      targetPosition: { x: destination.width * local.x, y: destination.height * local.y },
    });
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
    return { input: 'native HTML5 drag', to, viewport: page.viewportSize(), scrollBefore };
  }
  const origin = (await source.boundingBox())!;
  const from = { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 };
  for (const point of [from, to]) {
    expect(point.x).toBeGreaterThan(0);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(page.viewportSize()!.height);
  }
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...from, id: 1 }],
    });
    // Real input crosses the app's 350ms long-press threshold.
    await page.waitForTimeout(400);
    for (const fraction of [0.15, 0.3, 0.5, 0.7, 0.85, 1]) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction, id: 1 },
        ],
      });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
  return { input: 'trusted CDP touch / 400ms hold-drag', from, to };
}

test('말풍선 자원을 실제 드래그해 카드 위치와 레이어 삽입 순서를 지정한다', async ({
  page,
  isMobile,
}, info) => {
  test.skip(before, 'Before phase records original geometry only.');
  test.setTimeout(120_000);
  // This case verifies the native drag/drop handlers with both surfaces fully visible.
  // The separate 1440x900 geometry matrix retains the original production-sized viewport.
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 1800 });
  await ready(page);
  const original = (await saveDocument(page, info, '말풍선 드래그 시작')).document;
  const text = original.elements.find((element) => element.kind === 'text')!;
  await bubbleFolder(page);
  const canvasDrop = await dragTile(
    page,
    isMobile,
    resources(page).locator('[data-bubble-shape="speech"]'),
    card(page),
    { x: 0.55, y: 0.45 },
  );
  await expect(selectedLayer(page)).toHaveAttribute('aria-label', /말풍선/);
  const canvasId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  const placed = (await saveDocument(page, info, '카드 위 말풍선 드래그')).document;
  expect(placed.elements.find((element) => element.id === canvasId)).toMatchObject({
    kind: 'bubble',
    shape: 'speech',
  });
  const placement = placed.layouts
    .find((layout) => layout.ratio === '1:1')!
    .panels[0]!.elements.find((element) => element.elementId === canvasId)!.transform;
  expect(placement.x + placement.width / 2).toBeCloseTo(0.55, 2);
  expect(placement.y + placement.height / 2).toBeCloseTo(0.45, 2);
  assertUnchanged(original, placed);

  await bubbleFolder(page);
  const target = rail(page).locator(`[data-element-id="${text.id}"]`);
  await target.scrollIntoViewIfNeeded();
  const layerDrop = await dragTile(
    page,
    isMobile,
    resources(page).locator('[data-bubble-shape="caption"]'),
    target,
    { x: 0.2, y: 0.5 },
  );
  await expect(selectedLayer(page)).toHaveCount(1);
  const layerId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  expect(layerId).not.toBe(canvasId);
  const inserted = (await saveDocument(page, info, '레이어 사이 말풍선 드래그')).document;
  expect(inserted.elements.find((element) => element.id === layerId)).toMatchObject({
    kind: 'bubble',
    shape: 'caption',
  });
  expect(inserted.panels[0]!.elementIds.indexOf(layerId)).toBe(
    inserted.panels[0]!.elementIds.indexOf(text.id) + 1,
  );
  expect(inserted.elements).toHaveLength(original.elements.length + 2);
  assertUnchanged(placed, inserted);
  const shown = await rail(page)
    .locator('[data-element-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-element-id')));
  expect(shown.indexOf(layerId) + 1).toBe(shown.indexOf(text.id));
  await downloadPng(page, info, 'bubble-drag-final');
  await writeFile(
    info.outputPath('bubble-native-drag.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        canvasId,
        layerId,
        canvasDrop,
        layerDrop,
        placement,
        displayOrder: shown,
      },
      null,
      2,
    ),
  );
});
