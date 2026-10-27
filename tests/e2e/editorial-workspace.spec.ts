import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
import {
  activate,
  card,
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

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const sizes = {
  '1:1': [1080, 1080],
  '4:5': [864, 1080],
  '3:4': [810, 1080],
  '2:3': [720, 1080],
  '9:16': [608, 1080],
  '4:3': [1080, 810],
  '3:2': [1080, 720],
  '16:9': [1080, 608],
} as const;
const quickAdd = (page: Page, kind: '문구' | '말풍선') =>
  page.locator('.quick-add-bar').getByRole('button', { name: `${kind} 추가`, exact: true });
const resourceItems = (page: Page) => resources(page).locator('button[data-resource-id]');
const selectedIds = (page: Page) =>
  selectedLayer(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-element-id')),
  );

async function addText(page: Page, touch: boolean, text: string) {
  const previous = await selectedIds(page);
  await activate(quickAdd(page, '문구'), touch);
  await expect(selectedLayer(page)).toHaveCount(1);
  await expect(selectedLayer(page)).toHaveAttribute('aria-label', /문구/);
  const id = (await selectedLayer(page).getAttribute('data-element-id'))!;
  expect(previous).not.toContain(id);
  await (await reveal(page, '문구', 'text')).fill(text);
  await expect(rail(page).locator(`[data-element-id="${id}"]`)).toHaveAttribute(
    'aria-label',
    new RegExp(text),
  );
  return id;
}

async function placeResource(page: Page, touch: boolean, resourceId: string) {
  await openResources(page);
  const previous = await selectedIds(page);
  await activate(
    resourceItems(page).and(page.locator(`[data-resource-id="${resourceId}"]`)),
    touch,
  );
  await expect(selectedLayer(page)).toHaveCount(1);
  await expect(selectedLayer(page)).toHaveAttribute('aria-label', /이미지/);
  // Placement is asynchronous: the previous selected image must not satisfy the assertion.
  await expect
    .poll(async () => {
      const current = await selectedIds(page);
      return current.length === 1 && !previous.includes(current[0]!);
    })
    .toBe(true);
  return (await selectedLayer(page).getAttribute('data-element-id'))!;
}

async function uploadFixtures(page: Page) {
  await openResources(page);
  await resources(page).getByRole('tab', { name: '미분류', exact: true }).click();
  const files = ['portrait.png', 'landscape.jpg'];
  const ids: string[] = [];
  for (const file of files) {
    const bytes = await readFile(`tests/fixtures/images/${file}`);
    ids.push(`resource-${createHash('sha256').update(bytes).digest('hex')}`);
  }
  await resources(page)
    .getByLabel('자원 이미지 파일', { exact: true })
    .setInputFiles(files.map((file) => `tests/fixtures/images/${file}`));
  await expect(resources(page)).toHaveAttribute('aria-busy', 'false');
  await expect(resourceItems(page)).toHaveCount(2);
  for (const id of ids)
    await expect(resourceItems(page).and(page.locator(`[data-resource-id="${id}"]`))).toHaveCount(
      1,
    );
  return ids;
}

async function setPosition(page: Page, x: number, y: number, width?: number, height?: number) {
  if (width !== undefined) await number(page, '요소 폭', width);
  if (height !== undefined) await number(page, '요소 높이', height);
  await number(page, '요소 가로 위치', x);
  await number(page, '요소 세로 위치', y);
}

function assertOthersUnchanged(before: StudioDocument, after: StudioDocument, changed: string[]) {
  for (const element of before.elements) {
    if (changed.includes(element.id)) continue;
    expect(after.elements.find((item) => item.id === element.id)).toEqual(element);
    for (const layout of before.layouts)
      for (const panel of layout.panels) {
        const original = panel.elements.find((item) => item.elementId === element.id);
        if (!original) continue;
        expect(
          after.layouts
            .find((item) => item.ratio === layout.ratio)!
            .panels.find((item) => item.panelId === panel.panelId)!
            .elements.find((item) => item.elementId === element.id),
        ).toEqual(original);
      }
  }
}

/** Actual mouse or trusted CDP touch input, including the production long-press gate. */
async function dragSelectedImage(page: Page, touch: boolean) {
  await goPage(page, 'elements');
  await page.getByRole('checkbox', { name: '정렬선과 자동 맞춤', exact: true }).uncheck();
  const x = Number(await (await reveal(page, '요소 가로 위치')).inputValue()) / 100;
  const y = Number(await (await reveal(page, '요소 세로 위치')).inputValue()) / 100;
  const width = Number(await (await reveal(page, '요소 폭')).inputValue()) / 100;
  const height = Number(await (await reveal(page, '요소 높이')).inputValue()) / 100;
  await card(page).scrollIntoViewIfNeeded();
  const bounds = (await card(page).boundingBox())!;
  const from = {
    x: bounds.x + (x + width / 2) * bounds.width,
    y: bounds.y + (y + height / 2) * bounds.height,
  };
  const to = { x: from.x + 15, y: from.y + 11 };
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...from, id: 1 }],
      });
      // A deliberate gesture hold, rather than a render/performance waiting budget.
      await page.waitForTimeout(600);
      for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: from.x + (to.x - from.x) * fraction,
              y: from.y + (to.y - from.y) * fraction,
              id: 1,
            },
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
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 5 });
    await page.mouse.up();
  }
  const actualX = Number(await (await reveal(page, '요소 가로 위치')).inputValue()) / 100;
  const actualY = Number(await (await reveal(page, '요소 세로 위치')).inputValue()) / 100;
  // Numeric controls round to 0.01%; actual pointer positions may round by one CSS pixel.
  expect(Math.abs(actualX - x - 15 / bounds.width)).toBeLessThan(1 / bounds.width + 0.0001);
  expect(Math.abs(actualY - y - 11 / bounds.height)).toBeLessThan(1 / bounds.height + 0.0001);
  expect(Math.hypot(actualX - x, actualY - y)).toBeGreaterThan(0.01);
  return {
    input: touch ? 'trusted CDP touch / 600ms hold' : 'mouse drag',
    before: { x, y },
    after: { x: actualX, y: actualY },
    cssDelta: { x: 15, y: 11 },
  };
}

test('편집 작업대: 문구 3개·두 이미지 자원 3개 독립 추가와 편집, 그룹·캐시·저장·JSON·8비율 PNG', async ({
  page,
  isMobile,
}, info) => {
  // Functional matrix budget: includes real PNG/JSON downloads, IndexedDB and 8 ratio renders.
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await expect(page.locator('.studio-shell')).toHaveClass(/editorial-workspace/);
  await expect(page.locator('.tool-deck-stacked')).toHaveCount(2);
  const baseline = (await saveDocument(page, info, '작업대 시작')).document;
  const border = baseline.elements.find((element) => element.kind === 'frame')!;
  const groupIds = baseline.elements
    .filter((element) => element.groupId === border.groupId)
    .map((element) => element.id);
  expect(groupIds).toHaveLength(2);

  const textIds: string[] = [];
  textIds.push(await addText(page, isMobile, '첫 번째 문구'));
  await setPosition(page, 8, 8);
  await goPage(page, 'layers');
  await page
    .getByRole('region', { name: '여러 요소와 컷 편집', exact: true })
    .getByRole('button', { name: '선택 해제', exact: true })
    .click();
  await expect(selectedLayer(page)).toHaveCount(0);
  textIds.push(await addText(page, isMobile, '두 번째 문구'));
  await setPosition(page, 42, 20);
  await rail(page).locator(`[data-element-id="${border.id}"]`).click();
  await expect(selectedLayer(page)).toHaveCount(2);
  textIds.push(await addText(page, isMobile, '세 번째 문구'));
  await setPosition(page, 8, 72);
  expect(new Set(textIds).size).toBe(3);
  const textsAdded = (await saveDocument(page, info, '문구 세 개')).document;
  expect(textsAdded.elements.filter((element) => element.kind === 'text')).toHaveLength(
    baseline.elements.filter((element) => element.kind === 'text').length + 3,
  );
  assertOthersUnchanged(baseline, textsAdded, []);
  for (const id of textIds)
    expect(textsAdded.elements.find((element) => element.id === id)?.groupId).toBeUndefined();

  await rail(page).locator(`[data-element-id="${textIds[1]}"]`).click();
  await (await reveal(page, '문구', 'text')).fill('두 번째만 수정');
  await number(page, '요소 회전', 13);
  await setPosition(page, 44, 24);
  const textEdited = (await saveDocument(page, info, '문구 독립 편집')).document;
  assertOthersUnchanged(textsAdded, textEdited, [textIds[1]!]);
  expect(textEdited.elements.find((element) => element.id === textIds[1])).toMatchObject({
    text: '두 번째만 수정',
  });
  expect(
    textEdited.layouts
      .find((layout) => layout.ratio === '1:1')!
      .panels[0]!.elements.find((element) => element.elementId === textIds[1])!.transform,
  ).toMatchObject({
    x: 0.44,
    y: 0.24,
    rotation: 13,
  });

  const resourceIds = await uploadFixtures(page);
  await goPage(page, 'layers');
  await page
    .getByRole('region', { name: '여러 요소와 컷 편집', exact: true })
    .getByRole('button', { name: '선택 해제', exact: true })
    .click();
  const imageIds: string[] = [];
  imageIds.push(await placeResource(page, isMobile, resourceIds[0]!));
  await setPosition(page, 8, 43, 22, 20);
  imageIds.push(await placeResource(page, isMobile, resourceIds[1]!));
  await setPosition(page, 35, 43, 22, 20);
  await rail(page).locator(`[data-element-id="${border.id}"]`).click();
  await expect(selectedLayer(page)).toHaveCount(2);
  imageIds.push(await placeResource(page, isMobile, resourceIds[0]!));
  await setPosition(page, 66, 68, 20, 20);
  expect(new Set(imageIds).size).toBe(3);
  const imagesAdded = (await saveDocument(page, info, '자원 세 개')).document;
  assertOthersUnchanged(textEdited, imagesAdded, []);
  const images = imageIds.map((id) => imagesAdded.elements.find((element) => element.id === id)!);
  expect(images.every((element) => element.kind === 'image' && !element.groupId)).toBe(true);
  const assetIds = images.map((element) => (element.kind === 'image' ? element.assetId : ''));
  expect(assetIds[0]).toBe(assetIds[2]);
  expect(assetIds[0]).not.toBe(assetIds[1]);
  expect(new Set(assetIds).size).toBe(2);

  await rail(page).locator(`[data-element-id="${imageIds[0]}"]`).click();
  await number(page, '요소 회전', -17);
  await (
    await goPage(page, 'elements')
  )
    .getByRole('button', { name: '좌우 반전', exact: true })
    .click();
  await setPosition(page, 9, 44);
  const imageEdited = (await saveDocument(page, info, '이미지 독립 편집')).document;
  assertOthersUnchanged(imagesAdded, imageEdited, [imageIds[0]!]);
  expect(
    imageEdited.layouts
      .find((layout) => layout.ratio === '1:1')!
      .panels[0]!.elements.find((element) => element.elementId === imageIds[0])!.transform,
  ).toMatchObject({
    x: 0.09,
    y: 0.44,
    rotation: -17,
    flipX: true,
  });
  await rail(page).locator(`[data-element-id="${imageIds[2]}"]`).click();
  const movement = await dragSelectedImage(page, isMobile);
  const moved = (await saveDocument(page, info, '직접 이동 검증')).document;
  assertOthersUnchanged(imageEdited, moved, [imageIds[2]!]);
  for (const layout of moved.layouts)
    for (const id of [...textIds, ...imageIds])
      expect(layout.panels[0]!.elements.some((element) => element.elementId === id)).toBe(true);

  const previews = new Map<string, string>();
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    await expect(card(page)).toHaveAttribute('aria-label', `카드 ${ratio} 비율`);
    previews.set(ratio, await frame(page));
  }
  const final = await saveDocument(page, info, '작업대 완성');
  expect(final.backup.embeddedAssets).toHaveLength(2);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await openResources(page);
  await resources(page).getByRole('tab', { name: '미분류', exact: true }).click();
  await expect(resourceItems(page)).toHaveCount(2);
  for (const resourceId of resourceIds)
    await expect(
      resourceItems(page).and(page.locator(`[data-resource-id="${resourceId}"]`)),
    ).toHaveCount(1);
  for (const image of await resourceItems(page).locator('img').all())
    expect(
      await image.evaluate(async (node) => {
        await (node as HTMLImageElement).decode();
        return (node as HTMLImageElement).naturalWidth;
      }),
    ).toBeGreaterThan(0);
  const cachedPlacementId = await placeResource(page, isMobile, resourceIds[0]!);
  const cached = (await saveDocument(page, info, '새로고침 캐시 재배치')).document;
  const cachedElement = cached.elements.find((element) => element.id === cachedPlacementId)!;
  expect(cachedElement.kind).toBe('image');
  if (cachedElement.kind !== 'image') throw new Error('Cached placement did not create an image');
  const cachedAsset = cached.assets.find((asset) => asset.id === cachedElement.assetId)!;
  expect(cachedAsset.sha256).toBe(
    final.document.assets.find((asset) => asset.id === assetIds[0])!.sha256,
  );
  await restore(page, '작업대 완성');
  const restored = await saveDocument(page, info, '작업대 복원 확인');
  expect(normalized(restored.document)).toEqual(normalized(final.document));
  expect(restored.document.id).not.toBe(final.document.id);
  expect(
    restored.document.elements.some((element) => [...textIds, ...imageIds].includes(element.id)),
  ).toBe(false);

  // Import the actual exported file. Importing adds a copy and leaves the open card untouched.
  const optionsBefore = await library(page)
    .getByLabel('저장된 템플릿', { exact: true })
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const beforeImport = await frame(page);
  await library(page).getByLabel('템플릿 JSON 파일', { exact: true }).setInputFiles(final.path);
  await expect(library(page).getByRole('status')).toContainText('새 사본으로 가져왔습니다');
  expect(await frame(page)).toBe(beforeImport);
  const optionsAfter = await library(page)
    .getByLabel('저장된 템플릿', { exact: true })
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const imported = optionsAfter.filter((id) => id && !optionsBefore.includes(id));
  expect(imported).toHaveLength(1);
  await library(page).getByLabel('저장된 템플릿', { exact: true }).selectOption(imported[0]!);
  await loadSelected(page);
  const roundTrip = await saveDocument(page, info, 'JSON 왕복 확인');
  expect(normalized(roundTrip.document)).toEqual(normalized(final.document));
  const pixels = [];
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    expect(await frame(page)).toBe(previews.get(ratio));
    const comparison = await downloadPng(page, info, `editorial-${ratio.replace(':', '-')}`);
    expect(comparison.preview).toEqual(sizes[ratio]);
    pixels.push({ ratio, ...comparison });
  }
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('editorial-workspace-evidence.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        textIds,
        imageIds,
        resourceIds,
        groupIds,
        assetIds,
        independentTextEdit: true,
        independentImageEdit: true,
        movement,
        templateRestore: true,
        jsonRoundTrip: true,
        cachedResourcesAfterReload: 2,
        cachedPlacementId,
        pixels,
        errors,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('editorial-workspace.png'), fullPage: true });
});

test('편집 작업대: 잘못된 이미지 묶음·JSON은 작업과 캐시를 보존하고 보기 전용에서는 추가하지 못한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await addText(page, isMobile, '실패해도 보존할 문구');
  await openResources(page);
  await resources(page).getByRole('tab', { name: '미분류', exact: true }).click();
  await resources(page)
    .getByLabel('자원 이미지 파일', { exact: true })
    .setInputFiles('tests/fixtures/images/portrait.png');
  await expect(resourceItems(page)).toHaveCount(1);
  const resourceId = (await resourceItems(page).getAttribute('data-resource-id'))!;
  await placeResource(page, isMobile, resourceId);
  await openResources(page);
  await expect(resourceItems(page)).toHaveCount(1);
  const cacheBefore = await resourceItems(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-resource-id')),
  );
  const baseline = await saveDocument(page, info, '잘못된 입력 기준');
  const selection = await selectedIds(page);
  const before = await frame(page);
  const templatesBefore = await library(page)
    .getByLabel('저장된 템플릿', { exact: true })
    .locator('option')
    .allTextContents();

  await openResources(page);
  await resources(page)
    .getByLabel('자원 이미지 파일', { exact: true })
    .setInputFiles(['tests/fixtures/images/landscape.jpg', 'tests/fixtures/images/not-image.txt']);
  await expect(resources(page).getByRole('alert')).toBeVisible();
  await expect(resources(page)).toHaveAttribute('aria-busy', 'false');
  expect(
    await resourceItems(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-resource-id')),
    ),
  ).toEqual(cacheBefore);
  expect(await frame(page)).toBe(before);
  expect(await selectedIds(page)).toEqual(selection);
  await goPage(page, 'library');
  expect(
    await library(page)
      .getByLabel('저장된 템플릿', { exact: true })
      .locator('option')
      .allTextContents(),
  ).toEqual(templatesBefore);
  const afterImageFailure = await saveDocument(page, info, '잘못된 이미지 후');
  expect(afterImageFailure.document).toEqual(baseline.document);

  for (const [name, body] of [
    ['문법 오류', '{invalid'],
    ['스키마 오류', '{"kind":"jjal-template-backup","schemaVersion":999}'],
  ] as const) {
    const options = await library(page)
      .getByLabel('저장된 템플릿', { exact: true })
      .locator('option')
      .allTextContents();
    await library(page)
      .getByLabel('템플릿 JSON 파일', { exact: true })
      .setInputFiles({
        name: `${name}.json`,
        mimeType: 'application/json',
        buffer: Buffer.from(body),
      });
    await expect(library(page).getByRole('alert')).toContainText(
      '기존 작업과 템플릿은 그대로 유지됩니다',
    );
    expect(
      await library(page)
        .getByLabel('저장된 템플릿', { exact: true })
        .locator('option')
        .allTextContents(),
    ).toEqual(options);
    expect(await selectedIds(page)).toEqual(selection);
    expect(await frame(page)).toBe(before);
    const afterJsonFailure = await saveDocument(page, info, name);
    expect(afterJsonFailure.document).toEqual(baseline.document);
  }

  await ready(page, '/?view=readonly');
  await openResources(page);
  const readonlyFrame = await frame(page);
  const readonlyLayers = await rail(page)
    .locator('[data-element-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-element-id')));
  await expect(quickAdd(page, '문구')).toBeDisabled();
  await expect(quickAdd(page, '말풍선')).toBeDisabled();
  await expect(resources(page).locator('.resource-readonly-banner')).toBeVisible();
  await expect(resourceItems(page)).toHaveCount(0);
  await expect(resources(page).getByLabel('자원 이미지 파일', { exact: true })).toHaveCount(0);
  await expect(
    page
      .locator('[data-tool-page="elements"]')
      .getByRole('button', { name: '문구 추가', exact: true, includeHidden: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator('[data-tool-page="elements"]')
      .getByRole('button', { name: '말풍선 추가', exact: true, includeHidden: true }),
  ).toBeDisabled();
  // Native disabled controls cannot dispatch their click handler, even via HTMLElement.click().
  await page
    .locator('.quick-add-bar button')
    .evaluateAll((buttons) => buttons.forEach((button) => (button as HTMLButtonElement).click()));
  expect(await frame(page)).toBe(readonlyFrame);
  expect(
    await rail(page)
      .locator('[data-element-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-element-id'))),
  ).toEqual(readonlyLayers);
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('editorial-invalid-input-evidence.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        invalidImageBatchAtomic: true,
        invalidJsonCases: 2,
        preservedSelection: selection,
        preservedCachedIds: cacheBefore,
        readonlyAddBlocked: true,
        errors,
      },
      null,
      2,
    ),
  );
});
