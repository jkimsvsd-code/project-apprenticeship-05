import { test, expect, type CDPSession, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createEditorDocument } from '@jjal/editor-core';
import { inspectImage } from '@jjal/image-io';
import type { Asset, SavedStyle, StudioDocument } from '@jjal/document-model';
import { createSavedTemplate } from '@jjal/template-kit';
import { layerButtons, selectedLayerId } from './ui-controls';

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
const resources = (page: Page) => page.getByRole('region', { name: '자원그룹', exact: true });
const templates = (page: Page) => page.getByRole('region', { name: '내 템플릿', exact: true });
const card = (page: Page) => page.locator('canvas[aria-label^="카드 "]');
const frame = (page: Page) =>
  card(page).evaluate((node) => (node as HTMLCanvasElement).toDataURL('image/png'));

function fixture(file: string) {
  const bytes = readFileSync(`tests/fixtures/images/${file}`);
  const type = file.endsWith('.webp') ? 'image/webp' : 'image/png';
  const header = inspectImage(new Uint8Array(bytes), file, type);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const asset: Asset = {
    id: `fixture-${sha256}`,
    sha256,
    mimeType: header.mimeType,
    byteLength: bytes.length,
    pixelWidth: header.width,
    pixelHeight: header.height,
  };
  return { asset, body: bytes.toString('base64') };
}

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 15_000,
  });
  await expect(resources(page).locator('button[data-resource-id]')).toHaveCount(12);
}

async function upload(page: Page, file = 'portrait.png') {
  await page
    .getByLabel('이미지 파일', { exact: true })
    .setInputFiles(`tests/fixtures/images/${file}`);
  const id = `resource-${fixture(file).asset.sha256}`;
  await expect(resources(page).locator(`[data-resource-id="${id}"]`)).toHaveCount(1);
  return id;
}

async function saveDoc(page: Page, name: string): Promise<StudioDocument> {
  await templates(page).getByLabel('템플릿 이름').fill(name);
  await templates(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(templates(page).getByRole('status')).toContainText(
    `‘${name}’ 템플릿을 저장했습니다`,
  );
  await expect(templates(page)).toHaveAttribute('aria-busy', 'false');
  return page.evaluate(async (name) => {
    const modulePath = '/src/composition/storage.ts';
    const { createTemplateRepository } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const match = (await createTemplateRepository().list()).find(
      (template) => template.name === name,
    );
    if (!match) throw new Error('저장된 문서가 없습니다.');
    return match.document;
  }, name);
}

async function cachedIds(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/composition/storage.ts';
    const { createResourceRepository } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    return (await createResourceRepository().list()).map((resource) => resource.id).sort();
  });
}

function normalized(doc: StudioDocument) {
  const ids = new Map<string, string>([
    [doc.id, 'document'],
    ...doc.assets.map((asset, index) => [asset.id, `asset-${index}`] as const),
    ...doc.panels.map((panel, index) => [panel.id, `panel-${index}`] as const),
    ...doc.elements.map((element, index) => [element.id, `element-${index}`] as const),
  ]);
  return JSON.parse(
    JSON.stringify(doc, (key, value: unknown) => {
      if (key === 'createdAt' || key === 'updatedAt') return '';
      return typeof value === 'string' ? (ids.get(value) ?? value) : value;
    }),
  ) as unknown;
}

function assertImageAspect(doc: StudioDocument, id: string, source: Asset) {
  expect(doc.elements.find((element) => element.id === id)?.kind).toBe('image');
  for (const layout of doc.layouts) {
    const panel = layout.panels.find((panel) =>
      panel.elements.some((element) => element.elementId === id),
    )!;
    const transform = panel.elements.find((element) => element.elementId === id)!.transform;
    const [width, height] = sizes[layout.ratio];
    const aspect =
      (transform.width * panel.rect.width * width) /
      (transform.height * panel.rect.height * height);
    expect(aspect).toBeCloseTo(source.pixelWidth! / source.pixelHeight!, 9);
  }
}

async function dropResource(page: Page, id: string, touch: boolean) {
  const source = resources(page).locator(`[data-resource-id="${id}"]`);
  if (!touch) {
    const bounds = (await card(page).boundingBox())!;
    await source.dragTo(card(page), {
      targetPosition: { x: bounds.width * 0.68, y: bounds.height * 0.5 },
    });
    return { x: 0.68, y: 0.5, input: 'native HTML5 drag' };
  }
  await source.scrollIntoViewIfNeeded();
  await source.evaluate((node) => window.scrollBy(0, node.getBoundingClientRect().top - 72));
  const thumbnail = (await source.boundingBox())!;
  const bounds = (await card(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  const from = { x: thumbnail.x + thumbnail.width / 2, y: thumbnail.y + thumbnail.height / 2 };
  const to = { x: bounds.x + bounds.width * 0.68, y: bounds.y + bounds.height * 0.5 };
  expect(from.y).toBeGreaterThan(0);
  expect(to.y).toBeLessThan(viewport.height - 5);
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...from, id: 1 }],
    });
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
  return { x: 0.68, y: 0.5, input: 'CDP touch drag' };
}

async function comparePng(page: Page, info: TestInfo, ratio: (typeof ratios)[number]) {
  await page.getByRole('button', { name: ratio, exact: true }).click();
  await expect(card(page)).toHaveAttribute('aria-label', `카드 ${ratio} 비율`);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const preview = await frame(page);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /^PNG 다운로드/ }).click();
  const download = await pending;
  const output = info.outputPath(`resource-${ratio.replace(':', 'x')}.png`);
  await download.saveAs(output);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(output);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const result = await page.evaluate(
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
          size: [canvas.width, canvas.height],
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const [a, b] = await Promise.all([pixels(preview), pixels(output)]);
      let differentChannels = 0;
      for (let index = 0; index < Math.max(a.data.length, b.data.length); index++)
        if (a.data[index] !== b.data[index]) differentChannels++;
      return {
        preview: a.size,
        download: b.size,
        differentChannels,
        comparedChannels: a.data.length,
      };
    },
    { preview, output: `data:image/png;base64,${bytes.toString('base64')}` },
  );
  expect(result.preview).toEqual(sizes[ratio]);
  expect(result.download).toEqual(sizes[ratio]);
  expect(result.differentChannels).toBe(0);
  const evidence = {
    ratio,
    ...result,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    suggestedFilename: download.suggestedFilename(),
  };
  await writeFile(
    info.outputPath(`resource-${ratio.replace(':', 'x')}-comparison.json`),
    JSON.stringify(evidence, null, 2),
  );
  return evidence;
}

test('자원: 브라우저 캐시·중복 제거·드래그/클릭 배치·잠금·8비율 PNG·템플릿 독립', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await ready(page);
  const id = await upload(page);
  await upload(page);
  expect(await cachedIds(page)).toHaveLength(13);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  await expect(resources(page).locator('button[data-resource-id]')).toHaveCount(13);
  const item = resources(page).locator(`[data-resource-id="${id}"]`);
  await expect(item).toHaveCount(1);
  const originalIds = await cachedIds(page);
  await item.click();
  await expect(layerButtons(page)).toHaveCount(2);
  const clickedId = await selectedLayerId(page);
  const afterClick = await saveDoc(page, '자원 클릭 배치');
  assertImageAspect(afterClick, clickedId, fixture('portrait.png').asset);
  const pointer = await dropResource(page, id, info.project.name.includes('mobile'));
  await expect(layerButtons(page)).toHaveCount(3);
  const droppedId = await selectedLayerId(page);
  expect(droppedId).not.toBe(clickedId);
  const afterDrop = await saveDoc(page, '자원 드래그 배치');
  assertImageAspect(afterDrop, droppedId, fixture('portrait.png').asset);
  const placed = afterDrop.layouts
    .find((layout) => layout.ratio === '1:1')!
    .panels[0]!.elements.find((element) => element.elementId === droppedId)!.transform;
  expect(placed.x + placed.width / 2).toBeCloseTo(pointer.x, 2);
  expect(placed.y + placed.height / 2).toBeCloseTo(pointer.y, 2);
  await page
    .getByRole('region', { name: '여러 요소와 컷 편집' })
    .getByRole('button', { name: '선택 잠금', exact: true })
    .click();
  for (const label of ['요소 가로 위치', '요소 세로 위치', '요소 폭', '요소 높이', '요소 회전'])
    await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '맨 뒤로', exact: true })).toBeDisabled();
  await expect(page.locator('button[data-resize-handle]')).toHaveCount(0);
  const locked = await saveDoc(page, '자원 잠금');
  await card(page).scrollIntoViewIfNeeded();
  const bounds = (await card(page).boundingBox())!;
  const x = bounds.x + (placed.x + placed.width / 2) * bounds.width;
  const y = bounds.y + (placed.y + placed.height / 2) * bounds.height;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + bounds.width * 0.08, y + bounds.height * 0.05, { steps: 5 });
  await page.mouse.up();
  const attempted = await saveDoc(page, '자원 잠금 이동 시도');
  expect(attempted.panels[0]!.elementIds).toEqual(locked.panels[0]!.elementIds);
  for (const layout of attempted.layouts)
    expect(layout.panels[0]!.elements.find((element) => element.elementId === droppedId)).toEqual(
      locked.layouts
        .find((item) => item.ratio === layout.ratio)!
        .panels[0]!.elements.find((element) => element.elementId === droppedId),
    );
  await page.getByLabel('출력 크기').selectOption('1080');
  const comparisons = [];
  for (const ratio of ratios) comparisons.push(await comparePng(page, info, ratio));
  const persisted = await saveDoc(page, '자원 최종');
  await page.reload();
  await expect(resources(page).locator(`[data-resource-id="${id}"]`)).toHaveCount(1);
  await templates(page).getByLabel('저장된 템플릿').selectOption({ label: '자원 최종' });
  await templates(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(templates(page).getByRole('status')).toContainText('사본을 불러왔습니다');
  const restored = await saveDoc(page, '자원 복원 확인');
  expect(normalized(restored)).toEqual(normalized(persisted));
  for (const name of [
    '자원 클릭 배치',
    '자원 드래그 배치',
    '자원 잠금',
    '자원 잠금 이동 시도',
    '자원 최종',
    '자원 복원 확인',
  ]) {
    await templates(page).getByLabel('저장된 템플릿').selectOption({ label: name });
    page.once('dialog', (dialog) => dialog.accept());
    await templates(page).getByRole('button', { name: '삭제', exact: true }).click();
    await expect(templates(page).getByRole('status')).toContainText('삭제했습니다');
  }
  expect(await cachedIds(page)).toEqual(originalIds);
  await page.reload();
  await expect(resources(page).locator(`[data-resource-id="${id}"]`)).toHaveCount(1);
  await writeFile(
    info.outputPath('resource-flow.json'),
    JSON.stringify(
      {
        pointer,
        cachedIds: originalIds,
        afterDrop,
        locked,
        attempted,
        persisted,
        restored,
        comparisons,
      },
      null,
      2,
    ),
  );
});

test('자원 DB v2→v3: 기존 템플릿·스타일·초안·이미지 원본을 유지한다', async ({
  page,
  context,
}, info) => {
  const image = fixture('portrait.png');
  const doc = createEditorDocument();
  doc.assets = [image.asset];
  doc.panels[0]!.background.imageAssetId = image.asset.id;
  const template = createSavedTemplate('v2 보존 템플릿', doc);
  const text = doc.elements[0]!;
  if (text.kind !== 'text') throw new Error('문구 fixture 오류');
  const style: SavedStyle = {
    kind: 'jjal-style',
    schemaVersion: 1,
    id: 'v2-style',
    name: 'v2 스타일',
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    text: text.style,
  };
  const draft = {
    documentId: doc.id,
    baseRevision: null,
    savedAt: '2026-10-22T00:00:00.000Z',
    document: doc,
  };
  await page.route('**/__resource-v2-seed', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Storage migration fixture</title>',
    }),
  );
  await context.addInitScript(
    ({ template, style, draft, image }) => {
      if (sessionStorage.getItem('resource-v2-seeded')) return;
      const ready = new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('jjal-studio-demo', 2);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore('templates', { keyPath: 'id' });
          db.createObjectStore('styles', { keyPath: 'id' });
          db.createObjectStore('drafts', { keyPath: 'documentId' });
          db.createObjectStore('assets', { keyPath: 'sha256' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['templates', 'styles', 'drafts', 'assets'], 'readwrite');
          tx.objectStore('templates').add(template);
          tx.objectStore('styles').add(style);
          tx.objectStore('drafts').add(draft);
          const bytes = Uint8Array.from(atob(image.body), (character) => character.charCodeAt(0));
          tx.objectStore('assets').add({
            sha256: image.asset.sha256,
            blob: new Blob([bytes], { type: image.asset.mimeType }),
          });
          tx.oncomplete = () => {
            db.close();
            sessionStorage.setItem('resource-v2-seeded', 'true');
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
      Object.assign(window, { __resourceV2SeedReady: ready });
    },
    { template, style, draft, image },
  );
  await page.goto('/__resource-v2-seed');
  await page.evaluate(
    () =>
      (window as typeof window & { __resourceV2SeedReady: Promise<void> }).__resourceV2SeedReady,
  );
  await ready(page);
  const result = await page.evaluate(
    async ({ templateId, sha256 }) => {
      const modulePath = '/src/composition/storage.ts';
      const { openStudioDatabase } = (await import(
        /* @vite-ignore */ modulePath
      )) as typeof import('../../apps/demo/src/composition/storage');
      const db = await openStudioDatabase();
      try {
        const blob = (await db.get('assets', sha256))!.blob;
        const decoded = await createImageBitmap(blob);
        const dimensions = [decoded.width, decoded.height];
        decoded.close();
        const digest = [
          ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
        ]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('');
        return {
          version: db.version,
          stores: [...db.objectStoreNames].sort(),
          template: await db.get('templates', templateId),
          styles: await db.getAll('styles'),
          drafts: await db.getAll('drafts'),
          assetCount: await db.count('assets'),
          resourceCount: await db.count('resources'),
          dimensions,
          digest,
        };
      } finally {
        db.close();
      }
    },
    { templateId: template.id, sha256: image.asset.sha256 },
  );
  expect(result.version).toBe(3);
  expect(result.stores).toEqual(['assets', 'drafts', 'resources', 'styles', 'templates']);
  expect(result.template).toEqual(template);
  expect(result.styles).toEqual([style]);
  expect(result.drafts).toEqual([draft]);
  expect(result.assetCount).toBe(1);
  expect(result.resourceCount).toBe(12);
  expect(result.dimensions).toEqual([image.asset.pixelWidth, image.asset.pixelHeight]);
  expect(result.digest).toBe(image.asset.sha256);
  await writeFile(info.outputPath('resource-v2-upgrade.json'), JSON.stringify(result, null, 2));
});

async function injectQuotaFailure(page: Page, failAt: number) {
  await page.evaluate((failAt) => {
    type QuotaWindow = typeof window & {
      __resourceOriginalAdd?: IDBObjectStore['add'];
      __resourceQuotaCalls?: number;
    };
    const state = window as QuotaWindow;
    const original = state.__resourceOriginalAdd ?? IDBObjectStore.prototype.add;
    state.__resourceOriginalAdd = original;
    state.__resourceQuotaCalls = 0;
    // Simulate browser storage exhaustion only; no application code is changed.
    IDBObjectStore.prototype.add = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (this.name === 'resources') {
        state.__resourceQuotaCalls = (state.__resourceQuotaCalls ?? 0) + 1;
        if (state.__resourceQuotaCalls === failAt)
          throw new DOMException('Test storage quota', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    };
  }, failAt);
}

test('자원 quota: 묶음 저장 취소와 새 이미지 실패가 기존 캐시·작업을 보존한다', async ({
  page,
}, info) => {
  await ready(page);
  const id = await upload(page);
  await resources(page).locator(`[data-resource-id="${id}"]`).click();
  const before = await saveDoc(page, '저장 공간 실패 전');
  const originalIds = await cachedIds(page);
  const originalFrame = await frame(page);
  await injectQuotaFailure(page, 2);
  const batch = await page.evaluate(
    async (images) => {
      const modulePath = '/src/composition/resources.ts';
      const { cacheResourceBlobs } = (await import(
        /* @vite-ignore */ modulePath
      )) as typeof import('../../apps/demo/src/composition/resources');
      const bodies = new Map(
        images.map((image) => [
          image.asset.sha256,
          new Blob([Uint8Array.from(atob(image.body), (character) => character.charCodeAt(0))], {
            type: image.asset.mimeType,
          }),
        ]),
      );
      let message = '';
      try {
        await cacheResourceBlobs(
          images.map((image) => image.asset),
          bodies,
        );
      } catch (cause) {
        message = cause instanceof Error ? cause.message : String(cause);
      }
      return {
        message,
        calls: (window as typeof window & { __resourceQuotaCalls: number }).__resourceQuotaCalls,
      };
    },
    [fixture('transparent.png'), fixture('static.webp')],
  );
  expect(batch.calls).toBe(2);
  expect(batch.message).toContain('브라우저 저장 공간이 부족합니다');
  expect(await cachedIds(page)).toEqual(originalIds);
  await injectQuotaFailure(page, 1);
  await page
    .getByLabel('이미지 파일', { exact: true })
    .setInputFiles('tests/fixtures/images/transparent.png');
  await expect(
    page.getByRole('alert').filter({ hasText: '브라우저 저장 공간이 부족합니다' }),
  ).toBeVisible();
  expect(await frame(page)).toBe(originalFrame);
  expect(await cachedIds(page)).toEqual(originalIds);
  const after = await saveDoc(page, '저장 공간 실패 후');
  expect(normalized(after)).toEqual(normalized(before));
  await page.evaluate(() => {
    const state = window as typeof window & {
      __resourceOriginalAdd?: IDBObjectStore['add'];
      __resourceQuotaCalls?: number;
    };
    IDBObjectStore.prototype.add = state.__resourceOriginalAdd!;
    delete state.__resourceOriginalAdd;
    delete state.__resourceQuotaCalls;
  });
  await writeFile(
    info.outputPath('resource-quota.json'),
    JSON.stringify(
      {
        simulation: 'IDB resources add quota on batch second insert and UI first insert',
        batch,
        originalIds,
        before,
        after,
      },
      null,
      2,
    ),
  );
});
