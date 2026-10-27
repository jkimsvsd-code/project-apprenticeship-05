import { fillCaption, openTool, revealControl, selectedLayerId } from './ui-controls';
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

const styles = (page: Page) =>
  page.getByRole('region', { name: '말풍선과 내 스타일', exact: true });
const library = (page: Page) => page.getByRole('region', { name: '내 템플릿', exact: true });
async function ready(page: Page) {
  await page.goto('/');
  await openTool(page, '스타일');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  await expect(
    styles(page).getByRole('button', { name: '새 스타일 저장', exact: true }),
  ).toBeEnabled();
}
async function number(page: Page, label: string, value: number) {
  const input = page.getByLabel(label, { exact: true });
  await revealControl(page, input);
  await input.fill(String(value));
  await input.press('Enter');
  await expect(input).toHaveValue(String(value));
}
async function color(page: Page, label: string, value: string) {
  await revealControl(page, page.getByLabel(label, { exact: true }));
  await page.getByLabel(label, { exact: true }).evaluate((input, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
}
async function saveStyle(page: Page, name: string) {
  await openTool(page, '스타일');
  await styles(page).getByLabel('스타일 이름', { exact: true }).fill(name);
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '새 스타일 저장', exact: true }).click();
  await expect(styles(page).getByRole('status')).toContainText('저장했습니다');
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
    const db = await openStudioDatabase();
    try {
      return (await db.getAll('templates')).find((row) => row.name === name)!.document;
    } finally {
      db.close();
    }
  }, name);
}
async function addBubble(page: Page, shape = 'speech') {
  await openTool(page, '레이어');
  await revealControl(page, page.getByLabel('추가할 말풍선', { exact: true }));
  await page.getByLabel('추가할 말풍선', { exact: true }).selectOption(shape);
  await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
  await fillCaption(page, '다른 내용도 유지합니다');
  return selectedLayerId(page);
}
for (const shape of ['speech', 'thought', 'shout', 'caption'] as const) {
  test(`${shape}: 꼬리·채우기·테두리·정렬·외곽선 8비율 실제 PNG`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await ready(page);
    const id = await addBubble(page, shape);
    await number(page, '요소 가로 위치', 8);
    await number(page, '요소 세로 위치', 15);
    await number(page, '요소 폭', 84);
    await number(page, '요소 높이', 65);
    await color(page, '문구 색상', '#ffffff');
    const summary = [];
    for (const [index, ratio] of ratios.entries()) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await number(page, '요소 가로 위치', 8);
      await number(page, '요소 세로 위치', 15);
      await number(page, '요소 폭', 84);
      await number(page, '요소 높이', 65);
      await color(page, '말풍선 채우기 색', index % 2 ? '#dce8d1' : '#e8d5bc');
      await color(page, '말풍선 테두리 색', '#304a40');
      await number(page, '말풍선 테두리 두께', index === 7 ? 30 : 8);
      await revealControl(page, page.getByLabel('문구 정렬', { exact: true }));
      await page
        .getByLabel('문구 정렬', { exact: true })
        .selectOption((['left', 'center', 'right'] as const)[index % 3]!);
      await color(page, '문구 외곽선 색', '#234c79');
      await number(page, '문구 외곽선 두께', index === 7 ? 20 : 6);
      if (shape !== 'caption') {
        await revealControl(page, page.getByLabel('꼬리 방향', { exact: true }));
        await page
          .getByLabel('꼬리 방향', { exact: true })
          .selectOption((['bottom', 'top', 'left', 'right'] as const)[index % 4]!);
        await number(page, '꼬리 위치', 25 + index * 5);
        await number(page, '꼬리 길이', 80);
      }
      for (const edge of [1080, 2048] as const) {
        await revealControl(page, page.getByLabel('출력 크기'));
        await page.getByLabel('출력 크기').selectOption(String(edge));
        summary.push(
          await compareDownload(
            page,
            info,
            `style-${shape}-${ratio.replace(':', 'x')}-${edge}`,
            expectedSizes[edge][ratio],
          ),
        );
      }
    }
    const doc = await saveDoc(page, `${shape} 서식`);
    expect(doc.elements.find((element) => element.id === id)).toMatchObject({
      shape,
      borderWidth: 30,
      style: { outline: { width: 20, color: '#234c79' } },
    });
    const before = await frame(page);
    await library(page).getByLabel('JSON 범위').selectOption('selected');
    const pending = page.waitForEvent('download');
    await library(page).getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
    await (await pending).saveAs(info.outputPath('styled-template.json'));
    await library(page)
      .getByLabel('템플릿 JSON 파일')
      .setInputFiles(info.outputPath('styled-template.json'));
    await expect(library(page).getByRole('status')).toContainText('가져왔습니다');
    await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
    await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
    expect(await frame(page)).toBe(before);
    await page.screenshot({ path: info.outputPath('style-editor.png'), fullPage: true });
    await writeFile(
      info.outputPath('style-matrix.json'),
      JSON.stringify(
        { shape, doc, comparisons: summary.length, jsonRestoredSameFrame: true },
        null,
        2,
      ),
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('내 스타일 저장·새로고침·다른 종류 적용·수정·삭제에서 내용과 배치 유지', async ({
  page,
}, info) => {
  await ready(page);
  await addBubble(page);
  await color(page, '말풍선 채우기 색', '#dd99aa');
  await number(page, '말풍선 테두리 두께', 7);
  await revealControl(page, page.getByLabel('꼬리 방향'));
  await page.getByLabel('꼬리 방향').selectOption('left');
  await number(page, '꼬리 위치', 70);
  await revealControl(page, page.getByLabel('문구 정렬', { exact: true }));
  await page.getByLabel('문구 정렬', { exact: true }).selectOption('right');
  await number(page, '문구 외곽선 두께', 5);
  await saveStyle(page, '나의 대화');
  const savedId = await styles(page).getByLabel('저장된 스타일').inputValue();
  await page.reload();
  await openTool(page, '스타일');
  await expect(
    styles(page).getByRole('button', { name: '새 스타일 저장', exact: true }),
  ).toBeEnabled();
  await openTool(page, '스타일');
  await styles(page).getByLabel('저장된 스타일').selectOption(savedId);
  await fillCaption(page, '글자 내용은 유지');
  const plainFrame = await frame(page);
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '스타일 적용', exact: true }).click();
  await expect(styles(page).getByRole('status')).toContainText('적용했습니다');
  await expect(page.locator('#caption')).toHaveValue('글자 내용은 유지');
  expect(await frame(page)).not.toBe(plainFrame);
  await expect(page.getByLabel('문구 가로 위치')).toHaveValue('10');
  await addBubble(page, 'thought');
  const before = await saveDoc(page, '적용 전');
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '스타일 적용', exact: true }).click();
  await expect(styles(page).getByRole('status')).toContainText('적용했습니다');
  await expect(page.locator('#caption')).toHaveValue('다른 내용도 유지합니다');
  await expect(page.getByLabel('말풍선 모양', { exact: true })).toHaveValue('speech');
  const after = await saveDoc(page, '적용 후');
  expect(after.layouts).toEqual(before.layouts);
  await openTool(page, '스타일');
  await styles(page).getByLabel('스타일 이름').fill('수정한 대화');
  await number(page, '말풍선 테두리 두께', 12);
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '선택 스타일 수정', exact: true }).click();
  await expect(styles(page).getByRole('status')).toContainText('수정했습니다');
  const applied = await frame(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '선택 스타일 삭제', exact: true }).click();
  await expect(styles(page).getByLabel('저장된 스타일')).toHaveValue(savedId);
  page.once('dialog', (dialog) => dialog.accept());
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '선택 스타일 삭제', exact: true }).click();
  await expect(styles(page).getByRole('status')).toContainText('삭제했습니다');
  expect(await frame(page)).toBe(applied);
  await compareDownload(page, info, 'style-lifecycle', expectedSizes[1080]['1:1']);
  await page.reload();
  await openTool(page, '스타일');
  await expect(styles(page).getByLabel('저장된 스타일').locator('option')).toHaveCount(1);
  await writeFile(
    info.outputPath('style-lifecycle.json'),
    JSON.stringify(
      {
        savedId,
        reloaded: true,
        textAndLayoutPreserved: true,
        explicitUpdate: true,
        deleteCancelAndConfirm: true,
      },
      null,
      2,
    ),
  );
});

test('기존 v1 데이터 이관과 잘못된 스타일·중복·취소 트랜잭션·100개 한도 보존', async ({
  page,
}, info) => {
  await ready(page);
  await saveDoc(page, '이관 원본');
  const result = await page.evaluate(async () => {
    const path = '/src/composition/storage.ts';
    const { openStudioDatabase, createStyleRepository } = (await import(
      /* @vite-ignore */ path
    )) as typeof import('../../apps/demo/src/composition/storage');
    const current = await openStudioDatabase();
    const original = (await current.getAll('templates'))[0]!;
    current.close();
    const legacyName = 'style-migration-fixture';
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(legacyName, 1);
      request.onupgradeneeded = () => {
        for (const [name, key] of [
          ['templates', 'id'],
          ['drafts', 'documentId'],
          ['assets', 'sha256'],
        ])
          request.result.createObjectStore(name!, { keyPath: key! });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('templates', 'readwrite');
        tx.objectStore('templates').add(original);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    const upgraded = await openStudioDatabase(legacyName);
    const migrated = await upgraded.get('templates', original.id);
    const version = upgraded.version;
    const now = new Date().toISOString();
    const base = {
      kind: 'jjal-style' as const,
      schemaVersion: 1 as const,
      id: 'style-valid',
      name: '저장',
      createdAt: now,
      updatedAt: now,
      text: original.document.elements.find((item) => item.kind === 'text')!.style,
    };
    const repo = createStyleRepository(legacyName);
    await repo.save(base);
    const before = await repo.list();
    const failures = [];
    for (const [value, mode] of [
      [base, 'create'],
      [{ ...base, id: 'missing' }, 'update'],
      [
        {
          ...base,
          id: 'invalid',
          text: { ...base.text, outline: { width: 21, color: '#ffffff' } },
        },
        'create',
      ],
    ] as const) {
      try {
        await repo.save(value, mode);
      } catch {
        failures.push(true);
      }
    }
    const transaction = upgraded.transaction('styles', 'readwrite');
    void transaction.done.catch(() => undefined);
    const added = transaction.store.add({ ...base, id: 'aborted' });
    void added.catch(() => undefined);
    transaction.abort();
    await transaction.done.catch(() => undefined);
    const after = await repo.list();
    const seed = upgraded.transaction('styles', 'readwrite');
    for (let index = 1; index < 100; index++)
      await seed.store.add({ ...base, id: `style-${index}` });
    await seed.done;
    let limited = false;
    try {
      await repo.save({ ...base, id: 'overflow' });
    } catch {
      limited = true;
    }
    const count = await upgraded.count('styles');
    const unchanged =
      JSON.stringify(await upgraded.get('templates', original.id)) === JSON.stringify(original);
    upgraded.close();
    return {
      version,
      migratedUnchanged: JSON.stringify(migrated) === JSON.stringify(original),
      failedWrites: failures.length,
      stylesUnchanged: JSON.stringify(before) === JSON.stringify(after),
      limited,
      count,
      templateUnchanged: unchanged,
    };
  });
  expect(result).toEqual({
    version: 2,
    migratedUnchanged: true,
    failedWrites: 3,
    stylesUnchanged: true,
    limited: true,
    count: 100,
    templateUnchanged: true,
  });
  const snapshot = await frame(page);
  for (const [label, value] of [['문구 외곽선 두께', '21']] as const) {
    await revealControl(page, page.getByLabel(label, { exact: true }));
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Enter');
    await expect(page.getByRole('alert')).toContainText('기존 작업');
    expect(await frame(page)).toBe(snapshot);
  }
  await openTool(page, '스타일');
  await styles(page).getByLabel('스타일 이름').fill(' ');
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '새 스타일 저장', exact: true }).click();
  await expect(styles(page).getByRole('alert')).toContainText('기존 작업');
  expect(await frame(page)).toBe(snapshot);
  await writeFile(
    info.outputPath('style-storage-preservation.json'),
    JSON.stringify(result, null, 2),
  );
});

test('스타일 글꼴 준비 실패와 늦은 적용은 최신 편집을 보존한다', async ({ page }, info) => {
  await ready(page);
  const family = 'Ownglyph Hyunja';
  const preset = await page.evaluate(async (family) => {
    const path = '/src/composition/storage.ts';
    const { createStyleRepository } = (await import(
      /* @vite-ignore */ path
    )) as typeof import('../../apps/demo/src/composition/storage');
    const now = new Date().toISOString();
    const style = {
      kind: 'jjal-style' as const,
      schemaVersion: 1 as const,
      id: 'lazy-font-style',
      name: '느린 글꼴',
      createdAt: now,
      updatedAt: now,
      text: {
        font: {
          kind: 'builtin' as const,
          family: family as import('@jjal/document-model').BuiltinFontFamily,
        },
        fontSize: 48,
        color: '#123456',
        align: 'right' as const,
        lineHeight: 1.25,
        bold: false,
        outline: { width: 5, color: '#ffffff' },
      },
    };
    await createStyleRepository().save(style);
    return style;
  }, family);
  await page.reload();
  await openTool(page, '스타일');
  await styles(page).getByLabel('저장된 스타일').selectOption(preset.id);
  const before = await frame(page);
  await page.route('**/assets/fonts/**', (route) => route.abort());
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '스타일 적용', exact: true }).click();
  await expect(styles(page).getByRole('alert')).toContainText('불러오지 못했습니다');
  expect(await frame(page)).toBe(before);
  await page.unroute('**/assets/fonts/**');
  let release!: () => void, arrive!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  await page.route('**/assets/fonts/**', async (route) => {
    arrive();
    await hold;
    await route.continue();
  });
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '스타일 적용', exact: true }).click();
  await requested;
  await expect(page.getByRole('button', { name: 'PNG 다운로드' })).toBeDisabled();
  await fillCaption(page, '늦은 적용보다 새로운 내용');
  const edited = await frame(page);
  release();
  await expect(styles(page).getByRole('alert')).toContainText('준비 중 편집 내용이 바뀌어');
  expect(await frame(page)).toBe(edited);
  await expect(page.getByLabel('문구 정렬', { exact: true })).toHaveValue('center');
  await page.unroute('**/assets/fonts/**');
  await openTool(page, '스타일');
  await styles(page).getByRole('button', { name: '스타일 적용', exact: true }).click();
  await expect(styles(page).getByRole('status')).toContainText('적용했습니다');
  await expect(page.locator('#caption')).toHaveValue('늦은 적용보다 새로운 내용');
  await expect(page.getByLabel('문구 정렬', { exact: true })).toHaveValue('right');
  await writeFile(
    info.outputPath('style-font-races.json'),
    JSON.stringify(
      {
        failedFontPreserved: true,
        pendingDownloadBlocked: true,
        lateStyleCancelled: true,
        retryApplied: true,
        textPreserved: true,
      },
      null,
      2,
    ),
  );
});

test('독립 픽셀 측정으로 꼬리 방향·채우기·테두리·정렬·외곽선을 확인한다', async ({
  page,
}, info) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const modulePath = '/src/composition/rendering.ts';
    const { renderDocument } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/rendering');
    const element: Extract<import('@jjal/document-model').StudioElement, { kind: 'bubble' }> = {
      id: 'bubble',
      kind: 'bubble',
      text: '',
      hidden: false,
      locked: false,
      shape: 'speech',
      fill: '#ff0000',
      border: '#0000ff',
      borderWidth: 12,
      tail: { side: 'bottom', x: 0.5, y: 1 },
      style: {
        font: { kind: 'builtin', family: 'Noto Sans KR' },
        fontSize: 100,
        color: '#000000',
        align: 'left',
        lineHeight: 1.25,
        bold: false,
      },
    };
    const doc: StudioDocument = {
      kind: 'jjal-document',
      schemaVersion: 1,
      id: 'oracle',
      title: '서식 기준',
      createdAt: '2026-10-22T00:00:00Z',
      updatedAt: '2026-10-22T00:00:00Z',
      activeRatio: '1:1',
      assets: [],
      elements: [element],
      panels: [
        {
          id: 'panel',
          elementIds: ['bubble'],
          background: { color: '#ffffff', imageAssetId: null, fit: 'cover' },
        },
      ],
      layouts: [
        {
          ratio: '1:1',
          panels: [
            {
              panelId: 'panel',
              rect: { x: 0, y: 0, width: 1, height: 1 },
              elements: [
                {
                  elementId: 'bubble',
                  transform: {
                    x: 0.1,
                    y: 0.1,
                    width: 0.8,
                    height: 0.8,
                    rotation: 0,
                    flipX: false,
                    opacity: 1,
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    const tails = [];
    for (const side of ['bottom', 'top', 'left', 'right'] as const) {
      element.tail = {
        side,
        x: side === 'left' ? 0 : side === 'right' ? 1 : 0.5,
        y: side === 'top' ? 0 : side === 'bottom' ? 1 : 0.5,
      };
      renderDocument(canvas, doc);
      const point =
        side === 'bottom'
          ? [540, 870]
          : side === 'top'
            ? [540, 210]
            : side === 'left'
              ? [210, 540]
              : [870, 540];
      tails.push({ side, tip: pixel(point[0]!, point[1]!), center: pixel(540, 540) });
    }
    element.shape = 'shout';
    element.tail = { x: 0.5, y: 1 };
    renderDocument(canvas, doc);
    const defaultShoutTail = pixel(540, 870);
    element.tail = null;
    element.shape = 'caption';
    renderDocument(canvas, doc);
    const border = pixel(115, 540),
      fill = pixel(540, 540);
    const text: Extract<import('@jjal/document-model').StudioElement, { kind: 'text' }> = {
      id: 'bubble',
      kind: 'text',
      text: '가나다',
      locked: false,
      hidden: false,
      style: { ...element.style },
    };
    doc.elements = [text];
    const bounds = [];
    for (const align of ['left', 'center', 'right'] as const) {
      text.style.align = align;
      renderDocument(canvas, doc);
      const bytes = ctx.getImageData(0, 0, 1080, 1080).data;
      let min = 1080,
        max = 0;
      for (let y = 100; y < 400; y++)
        for (let x = 100; x < 980; x++) {
          const i = (y * 1080 + x) * 4;
          if (bytes[i]! < 30 && bytes[i + 1]! < 30 && bytes[i + 2]! < 30) {
            min = Math.min(min, x);
            max = Math.max(max, x);
          }
        }
      bounds.push({ align, min, max });
    }
    text.style.align = 'center';
    text.style.outline = { width: 12, color: '#00ff00' };
    renderDocument(canvas, doc);
    const bytes = ctx.getImageData(0, 0, 1080, 1080).data;
    let outlinePixels = 0,
      fillPixels = 0;
    for (let i = 0; i < bytes.length; i += 4) {
      if (bytes[i]! < 40 && bytes[i + 1]! > 220 && bytes[i + 2]! < 40) outlinePixels++;
      if (bytes[i]! < 30 && bytes[i + 1]! < 30 && bytes[i + 2]! < 30) fillPixels++;
    }
    return { tails, defaultShoutTail, border, fill, bounds, outlinePixels, fillPixels };
  });
  for (const tail of result.tails) {
    expect(tail.tip).toEqual([255, 0, 0, 255]);
    expect(tail.center).toEqual([255, 0, 0, 255]);
  }
  expect(result.border).toEqual([0, 0, 255, 255]);
  expect(result.defaultShoutTail).toEqual([255, 0, 0, 255]);
  expect(result.fill).toEqual([255, 0, 0, 255]);
  expect(result.bounds[0]!.min).toBeLessThan(result.bounds[1]!.min);
  expect(result.bounds[1]!.min).toBeLessThan(result.bounds[2]!.min);
  expect((result.bounds[1]!.min + result.bounds[1]!.max) / 2).toBeCloseTo(540, -1);
  expect(result.outlinePixels).toBeGreaterThan(500);
  expect(result.fillPixels).toBeGreaterThan(500);
  await writeFile(
    info.outputPath('style-independent-pixels.json'),
    JSON.stringify(result, null, 2),
  );
});
