import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import type { CachedResource } from '@jjal/persistence/browser';
import { frame, openResources, rail, ready, resources, saveDocument } from './editorial-controls';

const items = (page: Page) => resources(page).locator('button[data-resource-id]');

/** Each PNG has valid CRCs, identical small pixels and distinct original bytes. */
async function batchFiles(count: number) {
  const bytes = await readFile('tests/fixtures/images/transparent.png');
  return Array.from({ length: count }, (_, index) => {
    const text = Buffer.from(`Batch\0${index}`);
    const chunk = Buffer.alloc(text.length + 12);
    chunk.writeUInt32BE(text.length, 0);
    chunk.write('tEXt', 4);
    text.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    const buffer = Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]);
    return {
      name: `소재 ${index + 1}.png`,
      mimeType: 'image/png',
      buffer,
    };
  });
}

/** Inspect actual IndexedDB records without changing storage or calling application mutators. */
async function cachedResources(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('jjal-studio-demo');
      request.onupgradeneeded = () => request.transaction?.abort();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const records = await new Promise<CachedResource[]>((resolve, reject) => {
        const request = database
          .transaction('resources', 'readonly')
          .objectStore('resources')
          .getAll();
        request.onsuccess = () => resolve(request.result as CachedResource[]);
        request.onerror = () => reject(request.error);
      });
      const checked = await Promise.all(
        records.map(async ({ blob, ...metadata }) => ({
          ...metadata,
          blobBytes: blob.size,
          blobType: blob.type,
          blobSha256: [
            ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
          ]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join(''),
        })),
      );
      return checked.sort((left, right) => left.id.localeCompare(right.id));
    } finally {
      database.close();
    }
  });
}

async function visibleResourceIds(page: Page) {
  return items(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-resource-id')!).sort(),
  );
}

test('51개 파일을 한 번에 캐시하고 새로고침 후 유지하며 손상된 마지막 파일은 캐시·카드를 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await openResources(page);
  await expect(resources(page).getByRole('tab', { name: '미분류', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(resources(page)).toHaveAttribute('aria-busy', 'false');
  await expect(items(page)).toHaveCount(0);
  // Wait for the existing builtin bootstrap so its independent insertion cannot mask a change.
  await expect
    .poll(
      async () => (await cachedResources(page)).filter((item) => item.origin === 'builtin').length,
    )
    .toBe(12);
  const originals = await cachedResources(page);
  const cardBeforeImport = await frame(page);
  const files = await batchFiles(51);
  const manifest = files.map((file) => ({
    name: file.name,
    bytes: file.buffer.length,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
  }));
  const ids = manifest.map((file) => `resource-${file.sha256}`).sort();
  expect(new Set(ids).size).toBe(51);

  await resources(page).getByLabel('자원 이미지 파일', { exact: true }).setInputFiles(files);
  await expect(items(page)).toHaveCount(51);
  await expect(resources(page)).toHaveAttribute('aria-busy', 'false');
  await expect(resources(page).getByRole('alert')).toHaveCount(0);
  expect(await visibleResourceIds(page)).toEqual(ids);
  expect(await frame(page)).toBe(cardBeforeImport);
  const imported = await cachedResources(page);
  const users = imported.filter((item) => item.origin === 'user');
  expect(users.map((item) => item.id)).toEqual(ids);
  expect(imported.filter((item) => item.origin === 'builtin')).toEqual(originals);
  for (const item of users) {
    const source = manifest.find((file) => file.sha256 === item.asset.sha256)!;
    expect(item.name).toBe(source.name);
    expect(item.blobSha256).toBe(source.sha256);
    expect(item.blobBytes).toBe(source.bytes);
    expect(item.blobType).toBe('image/png');
  }

  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await openResources(page);
  await expect(resources(page).getByRole('tab', { name: '미분류', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(items(page)).toHaveCount(51);
  await expect(resources(page)).toHaveAttribute('aria-busy', 'false');
  expect(await visibleResourceIds(page)).toEqual(ids);
  expect(await cachedResources(page)).toEqual(imported);

  const baseline = await saveDocument(page, info, '51개 자원 오류 전 카드');
  const beforeFailure = await frame(page);
  const history = await page.locator('.toolbar-history-count').textContent();
  const layers = await rail(page)
    .locator('[data-element-id]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute('data-element-id'),
        label: node.getAttribute('aria-label'),
        selected: node.getAttribute('aria-pressed'),
      })),
    );
  const cacheBeforeFailure = await cachedResources(page);
  await openResources(page);
  await resources(page)
    .getByLabel('자원 이미지 파일', { exact: true })
    .setInputFiles([
      ...files,
      { name: '손상된 마지막.png', mimeType: 'image/png', buffer: Buffer.from('broken') },
    ]);
  await expect(resources(page).getByRole('alert')).toContainText('지원하지 않는 파일');
  await expect(resources(page)).toHaveAttribute('aria-busy', 'false');
  await expect(items(page)).toHaveCount(51);
  expect(await visibleResourceIds(page)).toEqual(ids);
  expect(await cachedResources(page)).toEqual(cacheBeforeFailure);
  expect(await frame(page)).toBe(beforeFailure);
  expect(await page.locator('.toolbar-history-count').textContent()).toBe(history);
  expect(
    await rail(page)
      .locator('[data-element-id]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          id: node.getAttribute('data-element-id'),
          label: node.getAttribute('aria-label'),
          selected: node.getAttribute('aria-pressed'),
        })),
      ),
  ).toEqual(layers);
  const afterFailure = await saveDocument(page, info, '51개 자원 오류 후 카드');
  expect(afterFailure.document).toEqual(baseline.document);
  await openResources(page);
  await expect(items(page)).toHaveCount(51);
  expect(await visibleResourceIds(page)).toEqual(ids);
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('51-resource-batch.json'),
    JSON.stringify(
      {
        manifest,
        originalCount: originals.length,
        imported,
        cacheAfterRejectedBatch: await cachedResources(page),
        visibleResourceIds: await visibleResourceIds(page),
        cardUnchanged: true,
        documentUnchanged: true,
        errors,
      },
      null,
      2,
    ),
  );
});
