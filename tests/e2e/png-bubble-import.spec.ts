import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import {
  activate,
  downloadPng,
  frame,
  goPage,
  normalized,
  openResources,
  rail,
  ready,
  resources,
  restore,
  reveal,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

async function pngFixture(page: Page, white: boolean) {
  const data = await page.evaluate((white) => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    if (white) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 100, 100);
    }
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#0B0F2B';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(16, 12);
    ctx.lineTo(84, 12);
    ctx.quadraticCurveTo(90, 12, 90, 18);
    ctx.lineTo(90, 60);
    ctx.quadraticCurveTo(90, 66, 84, 66);
    ctx.lineTo(62, 66);
    ctx.lineTo(45, 88);
    ctx.lineTo(47, 66);
    ctx.lineTo(16, 66);
    ctx.quadraticCurveTo(10, 66, 10, 60);
    ctx.lineTo(10, 18);
    ctx.quadraticCurveTo(10, 12, 16, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return canvas.toDataURL('image/png').split(',')[1]!;
  }, white);
  const buffer = Buffer.from(data, 'base64');
  return {
    name: white ? '흰 배경 말풍선.png' : '투명 배경 말풍선.png',
    mimeType: 'image/png',
    buffer,
  };
}
async function cached(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ id: string; name: string; sha: string; bytes: number; custom: boolean }[]>(
        (resolve, reject) => {
          const request = indexedDB.open('jjal-studio-demo');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const read = db.transaction('resources', 'readonly').objectStore('resources').getAll();
            read.onerror = () => {
              db.close();
              reject(read.error);
            };
            read.onsuccess = () => {
              const values = read.result as {
                id: string;
                name: string;
                asset: { sha256: string };
                blob: Blob;
                customBubble?: unknown;
              }[];
              db.close();
              resolve(
                values
                  .map((value) => ({
                    id: value.id,
                    name: value.name,
                    sha: value.asset.sha256,
                    bytes: value.blob.size,
                    custom: !!value.customBubble,
                  }))
                  .sort((a, b) => a.id.localeCompare(b.id)),
              );
            };
          };
        },
      ),
  );
}
async function bubbleFolder(page: Page) {
  await openResources(page);
  await resources(page).getByRole('tab', { name: '말풍선', exact: true }).click();
  return resources(page).getByLabel('말풍선 PNG 파일', { exact: true });
}
async function configure(page: Page, index: number, side = 'bottom') {
  const dialog = page.getByRole('dialog', { name: 'PNG 말풍선 변환', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('가져올 말풍선 파일', { exact: true }).selectOption(String(index));
  // The source has a connected raster tail. Explicitly crop the body and create an independent vector tail.
  for (const [name, value] of [
    ['왼쪽', '8'],
    ['위', '10'],
    ['폭', '84'],
    ['높이', '58'],
  ])
    await dialog.getByLabel(`말풍선 몸체 ${name}`, { exact: true }).fill(value!);
  await dialog.getByLabel('가져올 말풍선 꼬리', { exact: true }).selectOption(side);
  await expect(dialog.getByRole('img', { name: '변환 미리보기', exact: true })).toBeVisible();
  return dialog;
}

test('PNG 말풍선 미리보기 취소와 유효+잘못된 PNG 묶음은 카드와 원본 캐시를 그대로 보존한다', async ({
  page,
}, info) => {
  await ready(page);
  await openResources(page);
  await expect(
    resources(page).getByRole('button', { name: '미분류 추가', exact: true }),
  ).toBeVisible();
  await resources(page).getByRole('tab', { name: '기본', exact: true }).click();
  await expect(
    resources(page).getByRole('button', { name: '기본 소재 새로고침', exact: true }),
  ).toBeVisible();
  await resources(page).getByRole('button', { name: '자원 폴더 추가', exact: true }).click();
  await resources(page).getByLabel('새 폴더', { exact: true }).fill('PNG 검수');
  await resources(page).getByRole('button', { name: '추가', exact: true }).click();
  await expect(
    resources(page).getByRole('button', { name: 'PNG 검수 추가', exact: true }),
  ).toBeVisible();
  await bubbleFolder(page);
  await expect(
    resources(page).getByRole('button', { name: '말풍선 추가', exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await cached(page)).length).toBeGreaterThanOrEqual(12);
  const original = await cached(page),
    before = await frame(page),
    file = await pngFixture(page, false);
  await (await bubbleFolder(page)).setInputFiles(file);
  const dialog = await configure(page, 0);
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await cached(page)).toEqual(original);
  expect(await frame(page)).toBe(before);
  await (
    await bubbleFolder(page)
  ).setInputFiles([
    file,
    { name: '깨진 말풍선.png', mimeType: 'image/png', buffer: Buffer.from('not a png') },
  ]);
  await expect(resources(page).getByRole('alert')).toBeVisible();
  await expect(resources(page)).toHaveAttribute('aria-busy', 'false');
  await expect(dialog).toHaveCount(0);
  expect(await cached(page)).toEqual(original);
  expect(await frame(page)).toBe(before);
  await writeFile(
    info.outputPath('png-import-cancel-invalid.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        cachedOriginals: original,
        cancelPreserved: true,
        mixedInvalidAtomic: true,
      },
      null,
      2,
    ),
  );
});

test('투명·흰배경 PNG가 실제 편집 말풍선으로 반복 추가되고 문구·꼬리·질감·대표비율 JSON/PNG를 보존한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const files = [await pngFixture(page, false), await pngFixture(page, true)];
  await (await bubbleFolder(page)).setInputFiles(files);
  await configure(page, 0);
  const dialog = await configure(page, 1, 'right');
  await dialog.getByRole('button', { name: '가져오기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(resources(page).locator('[data-bubble-shape="custom"]')).toHaveCount(2);
  const cachedBefore = await cached(page);
  for (const file of files) {
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    expect(cachedBefore.find((item) => item.sha === sha)).toMatchObject({
      custom: true,
      bytes: file.buffer.length,
    });
  }
  // Existing group membership must survive a new imported bubble added while that group is selected.
  const groupIds: string[] = [];
  for (const text of ['PNG 그룹 하나', 'PNG 그룹 둘']) {
    await goPage(page, 'text');
    await activate(page.locator('button.caption-add'), isMobile);
    await (await reveal(page, '문구', 'text')).fill(text);
    groupIds.push((await selectedLayer(page).getAttribute('data-element-id'))!);
  }
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await activate(rail(page).locator(`[data-element-id="${groupIds[0]}"]`), isMobile);
  await page.getByRole('button', { name: '그룹 묶기', exact: true }).click();
  await expect(selectedLayer(page)).toHaveCount(2);
  const ids: string[] = [];
  for (const file of [files[0]!, files[0]!, files[1]!]) {
    await bubbleFolder(page);
    await activate(
      resources(page).getByRole('button', { name: `${file.name} 말풍선 추가`, exact: true }),
      isMobile,
    );
    await expect(selectedLayer(page)).toHaveCount(1);
    ids.push((await selectedLayer(page).getAttribute('data-element-id'))!);
  }
  expect(new Set(ids).size).toBe(3);
  await (await reveal(page, '문구', 'text')).fill('가져온 말풍선의 대사');
  await goPage(page, 'style');
  await expect(page.getByLabel('말풍선 모양', { exact: true })).toHaveValue('custom');
  await expect(page.getByRole('group', { name: '모서리 둥글기', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '상하좌우 가운데 정렬', exact: true }).click();
  for (const side of ['위', '오른쪽', '아래', '왼쪽']) {
    const input = await reveal(page, `말풍선 ${side} 여백`, 'style');
    await input.fill('16');
    await input.press('Enter');
  }
  await (await reveal(page, '꼬리 방향', 'style')).selectOption('left');
  for (const [label, value] of [
    ['꼬리 위치', '40'],
    ['꼬리 길이', '70'],
  ]) {
    const input = await reveal(page, label!, 'style');
    await input.fill(value!);
    await input.press('Enter');
  }
  await (await reveal(page, '외곽 질감', 'style')).selectOption('pencil');
  const width = await reveal(page, '외곽 두께', 'style');
  await width.fill('5');
  await width.press('Enter');
  const saved = await saveDocument(page, info, 'PNG 말풍선 반복 추가');
  for (const id of ids) {
    const bubble = saved.document.elements.find((e) => e.id === id)!;
    expect(bubble.kind).toBe('bubble');
    expect(bubble).toHaveProperty('customShape');
    if (bubble.kind === 'bubble') {
      expect(
        saved.document.assets.find((asset) => asset.id === bubble.customShape!.sourceAssetId)
          ?.mimeType,
      ).toBe('image/png');
    }
  }
  const existingGroups = groupIds.map(
    (id) => saved.document.elements.find((e) => e.id === id)!.groupId,
  );
  expect(existingGroups[0]).toBeTruthy();
  expect(existingGroups[1]).toBe(existingGroups[0]);
  expect(ids.every((id) => !saved.document.elements.find((e) => e.id === id)!.groupId)).toBe(true);
  const edited = saved.document.elements.find((e) => e.id === ids[2])!;
  expect(edited).toMatchObject({
    kind: 'bubble',
    text: '가져온 말풍선의 대사',
    verticalAlign: 'center',
    textPadding: { top: 16, right: 16, bottom: 16, left: 16 },
    contour: { texture: 'pencil', width: 5 },
    tail: { side: 'left' },
  });
  const frames = new Map<string, string>(),
    pixels = [];
  for (const ratio of ['1:1', '9:16', '16:9']) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    frames.set(ratio, await frame(page));
    pixels.push({
      ratio,
      comparison: await downloadPng(page, info, `png-bubble-${ratio.replace(':', '-')}`),
    });
  }
  const final = await saveDocument(page, info, 'PNG 말풍선 대표비율');
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await bubbleFolder(page);
  await expect(resources(page).locator('[data-bubble-shape="custom"]')).toHaveCount(2);
  expect(await cached(page)).toEqual(cachedBefore);
  await restore(page, 'PNG 말풍선 대표비율');
  const restored = (await saveDocument(page, info, 'PNG 복원 확인')).document;
  expect(normalized(restored)).toEqual(normalized(final.document));
  for (const [ratio, expected] of frames) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    expect(await frame(page)).toBe(expected);
  }
  // Template restoration assigns new IDs. Reuse that document's source asset,
  // rather than inserting another asset under the browser cache's canonical ID.
  const sourceSha = createHash('sha256').update(files[0]!.buffer).digest('hex');
  const restoredSource = restored.assets.find((asset) => asset.sha256 === sourceSha)!;
  expect(restoredSource).toBeTruthy();
  const previousIds = new Set(restored.elements.map((element) => element.id));
  await bubbleFolder(page);
  await activate(
    resources(page).getByRole('button', { name: `${files[0]!.name} 말풍선 추가`, exact: true }),
    isMobile,
  );
  await expect(selectedLayer(page)).toHaveCount(1);
  const repeatedId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  expect(previousIds.has(repeatedId)).toBe(false);
  const repeated = (await saveDocument(page, info, 'PNG 복원 후 같은 원본 추가')).document;
  expect(repeated.assets).toEqual(restored.assets);
  expect(repeated.elements).toHaveLength(restored.elements.length + 1);
  expect(repeated.elements.find((element) => element.id === repeatedId)).toMatchObject({
    kind: 'bubble',
    customShape: { sourceAssetId: restoredSource.id },
  });
  expect(repeated.elements.filter((element) => element.id !== repeatedId)).toEqual(
    restored.elements,
  );
  expect(
    repeated.panels.map((panel) => ({
      ...panel,
      elementIds: panel.elementIds.filter((id) => id !== repeatedId),
    })),
  ).toEqual(restored.panels);
  expect(
    repeated.layouts.map((layout) => ({
      ...layout,
      panels: layout.panels.map((panel) => ({
        ...panel,
        elements: panel.elements.filter((element) => element.elementId !== repeatedId),
      })),
    })),
  ).toEqual(restored.layouts);
  expect(await cached(page)).toEqual(cachedBefore);
  const repeatedPng = await downloadPng(page, info, 'png-bubble-restored-shared-source');
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('png-bubble-import-results.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        ids,
        groupIds,
        cached: cachedBefore,
        pixels,
        restored: true,
        restoredSourceReused: {
          sourceId: restoredSource.id,
          elementId: repeatedId,
          assetCountBefore: restored.assets.length,
          assetCountAfter: repeated.assets.length,
          png: repeatedPng,
        },
        errors,
      },
      null,
      2,
    ),
  );
});
