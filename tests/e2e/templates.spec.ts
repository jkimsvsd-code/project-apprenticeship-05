import { fillCaption, openTool, revealControl } from './ui-controls';
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TemplateBackup } from '@jjal/template-kit';

const fixture = (name: string) => path.resolve('tests/fixtures/images', name);
const templates = (page: Page) => page.getByRole('region', { name: '내 템플릿' });
const choices = (page: Page) => templates(page).getByLabel('저장된 템플릿');
const caption = (page: Page) => page.locator('#caption');
const frame = (page: Page) =>
  page.locator('canvas').evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function expectFrame(page: Page, expected: string) {
  await expect.poll(async () => digest(await frame(page))).toBe(digest(expected));
}

async function recordFrame(info: TestInfo, name: string, dataUrl: string) {
  await writeFile(info.outputPath(name), Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

async function setControl(page: Page, label: string, value: string) {
  await revealControl(page, page.getByLabel(label, { exact: true }));
  await page.getByLabel(label, { exact: true }).evaluate((element, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, next);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
}

async function image(page: Page, name: string) {
  await openTool(page, '이미지');
  await page.getByLabel('이미지 파일').setInputFiles(fixture(name));
  await expect(page.locator('.preview-panel [role=status]')).toContainText(name);
  await expect(page.getByRole('button', { name: 'PNG 다운로드' })).toBeEnabled();
}

async function database(page: Page) {
  return page.evaluate(async () => {
    const modulePath = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-studio-demo');
    try {
      const rows = (await db.getAll('templates')).sort((a, b) => a.id.localeCompare(b.id));
      const blobs = await db.getAll('assets');
      const assets = await Promise.all(
        blobs.map(async ({ sha256, blob }) => ({
          sha256,
          byteLength: blob.size,
          mime: blob.type,
          actualSha256: Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
            (byte) => byte.toString(16).padStart(2, '0'),
          ).join(''),
        })),
      );
      return { templates: rows, assets: assets.sort((a, b) => a.sha256.localeCompare(b.sha256)) };
    } finally {
      db.close();
    }
  });
}

async function count(page: Page, total: number) {
  await expect.poll(async () => (await database(page)).templates.length).toBe(total);
  await expect
    .poll(() =>
      choices(page)
        .locator('option')
        .evaluateAll((items) => items.filter((i) => (i as HTMLOptionElement).value !== '').length),
    )
    .toBe(total);
}

async function save(page: Page, name: string, total: number) {
  const previous = new Set((await database(page)).templates.map((row) => row.id));
  await templates(page).getByLabel('템플릿 이름').fill(name);
  await templates(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await count(page, total);
  await expect(templates(page).getByRole('alert')).toHaveCount(0);
  const added = (await database(page)).templates.find((row) => !previous.has(row.id));
  expect(added?.name).toBe(name);
  return added!.id;
}

async function restore(page: Page, id: string, text: string) {
  await choices(page).selectOption(id);
  await templates(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(caption(page)).toHaveValue(text);
  await expect(templates(page).getByRole('alert')).toHaveCount(0);
}

async function exported(page: Page, info: TestInfo, name: string) {
  const pending = page.waitForEvent('download');
  await templates(page).getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
  const download = await pending;
  const file = info.outputPath(name);
  await download.saveAs(file);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(file);
  const backup = JSON.parse(bytes.toString('utf8')) as TemplateBackup;
  expect(backup.kind).toBe('jjal-template-backup');
  expect(backup.schemaVersion).toBe(1);
  return { file, bytes, backup, suggestedFilename: download.suggestedFilename() };
}

test('템플릿 3개 저장·새로고침·독립 불러오기·명시 수정·삭제 취소와 삭제 지속', async ({
  page,
}, info) => {
  await page.goto('/');
  await image(page, 'portrait.png');
  const originalText = '저장할 첫 번째 문구\n원본의 이미지와 위치';
  await fillCaption(page, originalText);
  await setControl(page, '문구 크기', '67');
  await setControl(page, '문구 색상', '#ffffff');
  await setControl(page, '문구 폭', '55');
  await setControl(page, '문구 가로 위치', '25');
  await setControl(page, '문구 세로 위치', '63');
  await page.getByRole('button', { name: '4:5', exact: true }).click();
  await setControl(page, '문구 가로 위치', '17');
  await setControl(page, '문구 세로 위치', '42');
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await setControl(page, '문구 가로 위치', '31');
  await setControl(page, '문구 세로 위치', '58');
  await revealControl(page, page.getByLabel('배경 맞춤'));
  await page.getByLabel('배경 맞춤').selectOption('contain');
  const firstFrame = await frame(page);
  await recordFrame(info, 'first-saved-preview.png', firstFrame);
  const first = await save(page, '첫 번째 세로 카드', 1);
  await image(page, 'landscape.jpg');
  await fillCaption(page, '두 번째 문구');
  await page.getByRole('button', { name: '1:1', exact: true }).click();
  const second = await save(page, '두 번째 가로 이미지', 2);
  await fillCaption(page, '세 번째 문구');
  await save(page, '세 번째 카드', 3);
  const saved = await database(page);
  expect(saved.assets).toHaveLength(2);
  expect(saved.assets.every((asset) => asset.sha256 === asset.actualSha256)).toBe(true);

  await page.reload();
  await count(page, 3);
  await restore(page, first, originalText);
  await expectFrame(page, firstFrame);
  await expect(page.getByRole('button', { name: '9:16', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByLabel('문구 크기')).toHaveValue('67');
  await expect(page.getByLabel('문구 색상')).toHaveValue('#ffffff');
  await expect(page.getByLabel('배경 맞춤')).toHaveValue('contain');
  await expect(page.getByLabel('문구 가로 위치')).toHaveValue('31');
  await expect(page.getByLabel('문구 세로 위치')).toHaveValue('58');
  for (const [ratio, x, y] of [
    ['4:5', '17', '42'],
    ['1:1', '25', '63'],
  ]) {
    await page.getByRole('button', { name: ratio!, exact: true }).click();
    await expect(page.getByLabel('문구 가로 위치')).toHaveValue(x!);
    await expect(page.getByLabel('문구 세로 위치')).toHaveValue(y!);
  }

  await fillCaption(page, '아직 저장하지 않은 독립 편집');
  expect(
    (await database(page)).templates.find((row) => row.id === first)!.document.elements[0],
  ).toMatchObject({ text: originalText });
  await page.reload();
  await count(page, 3);
  await restore(page, first, originalText);
  await expectFrame(page, firstFrame);

  const revisedText = '명시적으로 수정한 카드';
  await fillCaption(page, revisedText);
  await templates(page).getByLabel('템플릿 이름').fill('이름도 수정한 카드');
  const revisedFrame = await frame(page);
  await recordFrame(info, 'revised-saved-preview.png', revisedFrame);
  await templates(page).getByRole('button', { name: '선택 템플릿 수정', exact: true }).click();
  await expect
    .poll(async () => (await database(page)).templates.find((row) => row.id === first)?.name)
    .toBe('이름도 수정한 카드');
  await count(page, 3);
  await page.reload();
  await count(page, 3);
  await restore(page, first, revisedText);
  await expectFrame(page, revisedFrame);

  const beforeCancel = await database(page);
  page.once('dialog', (dialog) => dialog.dismiss());
  await templates(page).getByRole('button', { name: '삭제', exact: true }).click();
  expect(await database(page)).toEqual(beforeCancel);
  await expectFrame(page, revisedFrame);
  page.once('dialog', (dialog) => dialog.accept());
  await templates(page).getByRole('button', { name: '삭제', exact: true }).click();
  await count(page, 2);
  await expectFrame(page, revisedFrame);
  await page.reload();
  await count(page, 2);
  expect((await database(page)).templates.some((row) => row.id === first)).toBe(false);
  await restore(page, second, '두 번째 문구');
  await writeFile(
    info.outputPath('template-crud.json'),
    JSON.stringify(
      {
        saved,
        afterDelete: await database(page),
        firstFrameSha256: digest(firstFrame),
        revisedFrameSha256: digest(revisedFrame),
        independentLoad: true,
        cancelPreserved: true,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('templates.png'), fullPage: true });
});

test('실제 JSON 다운로드에 원본 이미지가 포함되고 중복 가져오기는 새 ID로 추가된다', async ({
  page,
}, info) => {
  await page.goto('/');
  const previews = new Map<string, string>();
  const sources = ['portrait.png', 'landscape.jpg', 'large.png', 'rotated.jpg'];
  for (const [index, name] of sources.entries()) {
    await image(page, name);
    await fillCaption(page, `백업 복원 문구 ${index + 1}`);
    await page.getByRole('button', { name: index === 0 ? '4:5' : '9:16', exact: true }).click();
    const label = `백업 카드 ${index + 1}`;
    await save(page, label, index + 1);
    previews.set(label, await frame(page));
    await recordFrame(info, `backup-source-${index + 1}.png`, previews.get(label)!);
  }
  const before = await database(page);
  const output = await exported(page, info, 'actual-template-backup.json');
  expect(output.backup.templates).toHaveLength(sources.length);
  expect(output.backup.embeddedAssets).toHaveLength(sources.length);
  const fixtureHashes = await Promise.all(
    sources.map(async (name) => digest(await readFile(fixture(name)))),
  );
  expect(output.backup.embeddedAssets.map((asset) => asset.sha256).sort()).toEqual(
    fixtureHashes.sort(),
  );
  for (const asset of output.backup.embeddedAssets)
    expect(digest(Buffer.from(asset.base64, 'base64'))).toBe(asset.sha256);

  await fillCaption(page, '가져오기 중에도 유지할 현재 작업');
  const currentFrame = await frame(page);
  await templates(page).getByLabel('템플릿 JSON 파일').setInputFiles(output.file);
  await count(page, sources.length * 2);
  await expectFrame(page, currentFrame);
  await expect(caption(page)).toHaveValue('가져오기 중에도 유지할 현재 작업');
  const after = await database(page);
  const oldIds = new Set(before.templates.map((row) => row.id));
  const added = after.templates.filter((row) => !oldIds.has(row.id));
  expect(added).toHaveLength(sources.length);
  expect(new Set(after.templates.map((row) => row.id)).size).toBe(sources.length * 2);
  expect(after.templates.filter((row) => oldIds.has(row.id))).toEqual(before.templates);
  expect(after.assets).toEqual(before.assets);
  await page.reload();
  await count(page, sources.length * 2);
  for (const imported of added) {
    const source = output.backup.templates.find((row) => row.name === imported.name)!;
    const text = source.document.elements[0]!;
    if (text.kind !== 'text') throw new Error('테스트 원본 문구 오류');
    await restore(page, imported.id, text.text);
    await expectFrame(page, previews.get(imported.name)!);
  }
  await writeFile(
    info.outputPath('json-roundtrip.json'),
    JSON.stringify(
      {
        backupSha256: digest(output.bytes),
        suggestedFilename: output.suggestedFilename,
        originalTemplateIds: [...oldIds],
        appendedTemplateIds: added.map((row) => row.id),
        embeddedOriginalImageHashes: fixtureHashes,
        canvasPreservedDuringImport: true,
        appendedRestoredPixels: true,
        afterImport: after,
      },
      null,
      2,
    ),
  );
});

test('잘못된 JSON·해시·Base64·이미지·지원 범위·초과 용량에도 기존 작업과 DB를 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await image(page, 'portrait.png');
  const text = '잘못된 JSON에도 보존할 현재 작업';
  await fillCaption(page, text);
  await page.getByRole('button', { name: '4:5', exact: true }).click();
  await setControl(page, '문구 크기', '73');
  await setControl(page, '문구 세로 위치', '57');
  const id = await save(page, '보존할 템플릿', 1);
  const before = await database(page);
  const beforeFrame = await frame(page);
  await recordFrame(info, 'invalid-json-preserved-preview.png', beforeFrame);
  const backup = (await exported(page, info, 'invalid-cases-baseline.json')).backup;
  const json = (edit: (copy: TemplateBackup) => void) => {
    const copy = structuredClone(backup);
    edit(copy);
    return Buffer.from(JSON.stringify(copy));
  };
  const missing = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
  delete missing.templates;
  const version = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>;
  version.schemaVersion = 999;
  const corrupt = Buffer.alloc(Buffer.from(backup.embeddedAssets[0]!.base64, 'base64').length);
  const corruptHash = digest(corrupt);
  const cases = [
    { id: 'J01-malformed', buffer: Buffer.from('{broken') },
    { id: 'J02-missing-required', buffer: Buffer.from(JSON.stringify(missing)) },
    { id: 'J03-unknown-version', buffer: Buffer.from(JSON.stringify(version)) },
    {
      id: 'J04-missing-asset',
      buffer: json((copy) => {
        copy.embeddedAssets = [];
      }),
    },
    {
      id: 'J05-hash-mismatch',
      buffer: json((copy) => {
        copy.embeddedAssets[0]!.sha256 = '0'.repeat(64);
        copy.templates[0]!.document.assets[0]!.sha256 = '0'.repeat(64);
      }),
    },
    {
      id: 'J06-invalid-base64',
      buffer: json((copy) => {
        copy.embeddedAssets[0]!.base64 = '@@@';
      }),
    },
    {
      id: 'J07-corrupt-image',
      buffer: json((copy) => {
        copy.embeddedAssets[0] = { sha256: corruptHash, base64: corrupt.toString('base64') };
        copy.templates[0]!.document.assets[0]!.sha256 = corruptHash;
      }),
    },
    {
      id: 'J08-missing-active-layout',
      buffer: json((copy) => {
        const doc = copy.templates[0]!.document;
        doc.layouts = doc.layouts.filter((layout) => layout.ratio !== doc.activeRatio);
      }),
    },
    {
      id: 'J09-unknown-element-kind',
      buffer: json((copy) => {
        const doc = copy.templates[0]!.document;
        (doc.elements[0]! as unknown as Record<string, unknown>).kind = 'video';
      }),
    },
    { id: 'J10-over-25MB', buffer: Buffer.alloc(25_000_001) },
    {
      id: 'J11-mixed-batch-atomicity',
      buffer: json((copy) => {
        const bad = structuredClone(copy.templates[0]!);
        bad.id = 'second-template-bad-image';
        bad.document.assets[0]!.sha256 = corruptHash;
        copy.templates.push(bad);
        copy.embeddedAssets.push({ sha256: corruptHash, base64: corrupt.toString('base64') });
      }),
    },
    {
      id: 'J12-shared-hash-conflicting-dimensions',
      buffer: json((copy) => {
        const bad = structuredClone(copy.templates[0]!);
        bad.id = 'second-template-bad-dimensions';
        const asset = bad.document.assets[0]!;
        asset.pixelWidth = asset.pixelWidth! + 1;
        copy.templates.push(bad);
      }),
    },
  ];
  const results: {
    id: string;
    inputSha256: string;
    bytes: number;
    error: string;
    frameSha256: string;
    databaseSha256: string;
    result: string;
  }[] = [];
  for (const entry of cases) {
    await test.step(entry.id, async () => {
      // 새로 연 화면에서 검사해 이전 오류를 다음 입력의 결과로 오인하지 않는다.
      await page.reload();
      await count(page, 1);
      await restore(page, id, text);
      await expectFrame(page, beforeFrame);
      await expect(templates(page).getByRole('alert')).toHaveCount(0);
      await templates(page)
        .getByLabel('템플릿 JSON 파일')
        .setInputFiles({
          name: `${entry.id}.json`,
          mimeType: 'application/json',
          buffer: entry.buffer,
        });
      const alert = templates(page).getByRole('alert');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText('기존 작업');
      await expect(caption(page)).toHaveValue(text);
      await expectFrame(page, beforeFrame);
      const preserved = await database(page);
      expect(preserved).toEqual(before);
      results.push({
        id: entry.id,
        inputSha256: digest(entry.buffer),
        bytes: entry.buffer.length,
        error: await alert.innerText(),
        frameSha256: digest(beforeFrame),
        databaseSha256: digest(JSON.stringify(preserved)),
        result: 'PASS',
      });
    });
  }
  await page.reload();
  await count(page, 1);
  await restore(page, id, text);
  await expectFrame(page, beforeFrame);
  await writeFile(
    info.outputPath('invalid-json-preservation.json'),
    JSON.stringify(results, null, 2),
  );
  await page.screenshot({
    path: info.outputPath('preserved-after-invalid-json.png'),
    fullPage: true,
  });
});
