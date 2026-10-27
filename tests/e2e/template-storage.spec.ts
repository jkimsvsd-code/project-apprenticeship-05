import { test, expect } from '@playwright/test';
import { createSampleDocument } from '@jjal/content';
import type { SavedTemplate } from '@jjal/template-kit';

const templateFixture = (id: string): SavedTemplate => ({
  kind: 'jjal-template',
  schemaVersion: 1,
  id,
  name: '저장소 시험',
  createdAt: '2026-10-21T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z',
  document: createSampleDocument(),
});

test('템플릿과 이미지 Blob은 새로고침 후 유지되고 수정·삭제된다', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async (template) => {
    const modulePath = '/src/composition/storage.ts';
    const { createTemplateRepository } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    canvas.getContext('2d')!.fillRect(0, 0, 2, 2);
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!)));
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    ]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    template.document.assets = [
      {
        id: 'image-1',
        mimeType: 'image/png',
        byteLength: blob.size,
        sha256,
        pixelWidth: 2,
        pixelHeight: 2,
      },
    ];
    template.document.panels[0]!.background.imageAssetId = 'image-1';
    await createTemplateRepository('jjal-test-template-crud').save(
      template,
      new Map([[sha256, blob]]),
      'create',
    );
  }, templateFixture('template-1'));
  await page.reload();
  const result = await page.evaluate(async () => {
    const modulePath = '/src/composition/storage.ts';
    const { createTemplateRepository, openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const repository = createTemplateRepository('jjal-test-template-crud');
    const before = await repository.read('template-1');
    const body = before.assets.values().next().value!;
    const decoded = await createImageBitmap(body);
    const dimensions = [decoded.width, decoded.height];
    decoded.close();
    const initialCount = (await repository.list()).length;
    before.template.name = '수정된 이름';
    const text = before.template.document.elements[0]!;
    if (text.kind === 'text') text.text = '수정된 문구';
    await repository.save(before.template, before.assets, 'update');
    const after = await repository.read('template-1');
    const editedText = after.template.document.elements[0]!;
    await repository.remove('template-1');
    const db = await openStudioDatabase('jjal-test-template-crud');
    const remainingAssets = await db.count('assets');
    db.close();
    return {
      initialCount,
      dimensions,
      name: after.template.name,
      text: editedText.kind === 'text' ? editedText.text : null,
      finalCount: (await repository.list()).length,
      remainingAssets,
    };
  });
  expect(result).toEqual({
    initialCount: 1,
    dimensions: [2, 2],
    name: '수정된 이름',
    text: '수정된 문구',
    finalCount: 0,
    remainingAssets: 0,
  });
});

test('다른 템플릿과 작업 초안이 참조하는 공유 소재를 보존한다', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (base) => {
    const modulePath = '/src/composition/storage.ts';
    const { createTemplateRepository, openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const repository = createTemplateRepository('jjal-test-template-gc');
    const blob = new Blob(['shared bytes'], { type: 'image/png' });
    const sha256 = 'a'.repeat(64);
    base.document.assets = [
      {
        id: 'image-1',
        mimeType: 'image/png',
        byteLength: blob.size,
        sha256,
        pixelWidth: 2,
        pixelHeight: 2,
      },
    ];
    base.document.panels[0]!.background.imageAssetId = 'image-1';
    const second = structuredClone(base);
    second.id = 'template-2';
    await repository.addMany([base, second], new Map([[sha256, blob]]));
    await repository.remove(base.id);
    const preservedByTemplate = (await repository.read(second.id)).assets.size;
    const db = await openStudioDatabase('jjal-test-template-gc');
    await db.put('drafts', {
      documentId: base.document.id,
      baseRevision: null,
      savedAt: base.updatedAt,
      document: base.document,
    });
    db.close();
    await repository.remove(second.id);
    const afterDelete = await openStudioDatabase('jjal-test-template-gc');
    const preservedByDraft = await afterDelete.count('assets');
    await afterDelete.delete('drafts', base.document.id);
    afterDelete.close();
    const empty = structuredClone(base);
    empty.id = 'empty-template';
    empty.document.assets = [];
    empty.document.panels[0]!.background.imageAssetId = null;
    await repository.save(empty, new Map(), 'create');
    await repository.remove(empty.id);
    const final = await openStudioDatabase('jjal-test-template-gc');
    const unreferencedCount = await final.count('assets');
    final.close();
    return { preservedByTemplate, preservedByDraft, unreferencedCount };
  }, templateFixture('template-1'));
  expect(result).toEqual({ preservedByTemplate: 1, preservedByDraft: 1, unreferencedCount: 0 });
});

test('중복·없는 대상·소재 오류와 실제 트랜잭션 취소에서 부분 저장이 없다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const result = await page.evaluate(async (base) => {
    const modulePath = '/src/composition/storage.ts';
    const { createTemplateRepository, openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const repository = createTemplateRepository('jjal-test-template-rollback');
    await repository.save(base, new Map(), 'create');
    const messages: string[] = [];
    async function rejected(action: () => Promise<void>) {
      try {
        await action();
        messages.push('예상하지 못한 성공');
      } catch (error) {
        messages.push(error instanceof Error ? error.message : String(error));
      }
    }
    const next = structuredClone(base);
    next.id = 'new-template';
    await rejected(() => repository.addMany([next, base], new Map()));
    await rejected(() => repository.save(next, new Map(), 'update'));
    await rejected(() => repository.remove('missing-template'));
    const bad = structuredClone(base);
    const blob = new Blob(['valid metadata only'], { type: 'image/png' });
    const sha256 = 'b'.repeat(64);
    bad.document.assets = [
      {
        id: 'image-1',
        mimeType: 'image/png',
        byteLength: blob.size,
        sha256,
        pixelWidth: 2,
        pixelHeight: 2,
      },
    ];
    bad.document.panels[0]!.background.imageAssetId = 'image-1';
    await rejected(() => repository.save(bad, new Map([[sha256, new Blob(['bad'])]]), 'update'));

    // 저장 경계에서 요청 오류를 흉내 내어 첫 쓰기 이후의 원자적 취소를 검사한다.
    // 이 검사는 실제 제품 결함 증거로 분류하지 않는다.
    const second = structuredClone(bad);
    second.id = 'transaction-fault';
    bad.id = 'first-write';
    const originalAdd = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'templates' && value.id === 'transaction-fault')
        throw new DOMException('검사용 저장 경계 오류', 'AbortError');
      return originalAdd.call(this, value, key);
    };
    try {
      await rejected(() => repository.addMany([bad, second], new Map([[sha256, blob]])));
    } finally {
      IDBObjectStore.prototype.add = originalAdd;
    }
    const db = await openStudioDatabase('jjal-test-template-rollback');
    const assetCount = await db.count('assets');
    db.close();
    return {
      messages,
      ids: (await repository.list()).map((template) => template.id),
      assetCount,
      name: (await repository.read(base.id)).template.name,
    };
  }, templateFixture('existing-template'));
  expect(result.messages).toHaveLength(5);
  expect(result.messages[0]).toContain('이미 있습니다');
  expect(result.messages[1]).toContain('수정할 템플릿');
  expect(result.messages[2]).toContain('삭제할 템플릿');
  expect(result.messages[3]).toContain('크기 또는 형식');
  expect(result.messages[4]).toContain('기존 템플릿은 유지');
  expect(result.ids).toEqual(['existing-template']);
  expect(result.assetCount).toBe(0);
  expect(result.name).toBe('저장소 시험');
  expect(errors).toEqual([]);
});
