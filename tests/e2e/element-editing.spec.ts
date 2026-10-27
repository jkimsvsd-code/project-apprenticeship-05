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
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
}
async function number(page: Page, label: string, value: number) {
  await revealControl(page, page.getByLabel(label, { exact: true }));
  await page.getByLabel(label, { exact: true }).fill(String(value));
  await page.getByLabel(label, { exact: true }).press('Enter');
  await expect(page.getByLabel(label, { exact: true })).toHaveValue(String(value));
}
async function addCharacter(page: Page, id = 'starter-seed-neutral') {
  await openTool(page, '레이어');
  await revealControl(page, page.getByLabel('추가할 캐릭터'));
  await page.getByLabel('추가할 캐릭터').selectOption(id);
  await page.getByRole('button', { name: '캐릭터 추가', exact: true }).click();
  await expect(page.getByRole('button', { name: '캐릭터 추가', exact: true })).toBeEnabled();
  return selectedLayerId(page);
}
async function save(page: Page, name: string) {
  await library(page).getByLabel('템플릿 이름').fill(name);
  await library(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('저장했습니다');
  return page.evaluate(async () => {
    const path = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ path
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-studio-demo');
    try {
      return (await db.getAll('templates')).at(-1)!.document;
    } finally {
      db.close();
    }
  });
}
async function restore(page: Page) {
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('사본을 불러왔습니다');
}
for (const config of [
  { panels: 1, name: null },
  { panels: 2, name: '전후 비교' },
  { panels: 4, name: '짧은 이야기' },
] as const) {
  test(`${config.panels}컷: 자유 요소 8비율·두 해상도 PNG와 배치 저장 복원`, async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    await ready(page);
    if (config.name) {
      const starters = page.getByRole('region', { name: '기본 템플릿' });
      await starters.getByRole('button', { name: config.name, exact: true }).click();
      await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
      await revealControl(page, page.getByLabel('편집할 컷'));
      await page.getByLabel('편집할 컷').selectOption({ index: config.panels - 1 });
    }
    const character = await addCharacter(page);
    await addCharacter(page, 'starter-block-angry');
    for (const shape of ['speech', 'thought', 'shout', 'caption']) {
      await revealControl(page, page.getByLabel('추가할 말풍선'));
      await page.getByLabel('추가할 말풍선').selectOption(shape);
      await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
      await fillCaption(page, `${shape} 대사`);
    }
    await openTool(page, '레이어');
    await page.getByRole('button', { name: '문구 추가', exact: true }).click();
    await fillCaption(page, '새로 만든 장면');
    await selectLayer(page, character);
    const results = [];
    for (const [index, ratio] of ratios.entries()) {
      await page.getByRole('button', { name: ratio, exact: true }).click();
      await number(
        page,
        '요소 가로 위치',
        config.panels === 1 && index === 0 ? -10 : 10 + index * 2,
      );
      await number(page, '요소 세로 위치', 42);
      await number(page, '요소 폭', 36);
      await number(page, '요소 높이', 35);
      await number(page, '요소 회전', -20 + index * 5);
      await page.getByRole('button', { name: '좌우 반전', exact: true }).click();
      await page.getByRole('button', { name: '상하 반전', exact: true }).click();
      if (config.panels === 1 && index === 0)
        await expect(
          page.getByText('선택 요소가 컷 경계를 벗어났습니다.', { exact: false }),
        ).toBeVisible();
      for (const edge of [1080, 2048] as const) {
        await revealControl(page, page.getByLabel('출력 크기'));
        await page.getByLabel('출력 크기').selectOption(String(edge));
        results.push(
          await compareDownload(
            page,
            info,
            `elements-${config.panels}-${ratio.replace(':', 'x')}-${edge}`,
            expectedSizes[edge][ratio],
          ),
        );
      }
    }
    // Overlap is intentional; front/back must change pixels and shared order.
    const behind = await frame(page);
    await page.getByRole('button', { name: '맨 앞으로', exact: true }).click();
    await expect.poll(() => frame(page)).not.toBe(behind);
    await page.getByRole('button', { name: '한 단계 뒤로', exact: true }).click();
    await page.getByRole('button', { name: '한 단계 앞으로', exact: true }).click();
    const doc: StudioDocument = await save(page, `요소 ${config.panels}컷`);
    expect(doc.panels).toHaveLength(config.panels);
    const target = doc.panels[config.panels - 1]!;
    expect(target.elementIds.at(-1)).toBe(character);
    expect(
      doc.elements.filter((item) => target.elementIds.includes(item.id) && item.kind === 'bubble')
        .length,
    ).toBeGreaterThanOrEqual(4);
    for (const [index, ratio] of ratios.entries()) {
      const placed = doc.layouts
        .find((layout) => layout.ratio === ratio)!
        .panels.find((panel) => panel.panelId === target.id)!;
      expect(placed.elements.find((item) => item.elementId === character)!.transform).toMatchObject(
        {
          x: (config.panels === 1 && index === 0 ? -10 : 10 + index * 2) / 100,
          y: 0.42,
          width: 0.36,
          height: 0.35,
          rotation: -20 + index * 5,
          flipX: true,
          flipY: true,
        },
      );
    }
    const before = await frame(page);
    await page.reload();
    await openTool(page, '레이어');
    await library(page)
      .getByLabel('저장된 템플릿')
      .selectOption({ label: `요소 ${config.panels}컷` });
    await restore(page);
    await revealControl(page, page.getByLabel('출력 크기'));
    await page.getByLabel('출력 크기').selectOption('2048');
    expect(await frame(page)).toBe(before);
    await writeFile(
      info.outputPath('element-layouts.json'),
      JSON.stringify(
        { doc, comparisons: results.length, allChannelsEqual: true, restoredFrameEqual: true },
        null,
        2,
      ),
    );
    await page.screenshot({ path: info.outputPath('element-editor.png'), fullPage: true });
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}

test('빈 컷 저장·JSON 복원과 잘못된 수치·캐릭터 한도·소재 실패 보존', async ({ page }, info) => {
  await ready(page);
  await page.getByRole('button', { name: '선택 요소 삭제', exact: true }).click();
  await expect(page.locator('#caption')).toHaveCount(0);
  await save(page, '빈 컷');
  const before = await frame(page);
  await page.reload();
  await openTool(page, '레이어');
  await library(page).getByLabel('저장된 템플릿').selectOption({ label: '빈 컷' });
  await restore(page);
  expect(await frame(page)).toBe(before);
  await library(page).getByLabel('JSON 범위').selectOption('selected');
  const pending = page.waitForEvent('download');
  await library(page).getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
  const backup = await pending;
  await backup.saveAs(info.outputPath('empty.json'));
  await library(page).getByLabel('템플릿 JSON 파일').setInputFiles(info.outputPath('empty.json'));
  await expect(library(page).getByRole('status')).toContainText('가져왔습니다');
  await restore(page);
  expect(await frame(page)).toBe(before);
  for (let count = 0; count < 4; count++) await addCharacter(page);
  const full = await frame(page);
  await addCharacter(page);
  await expect(page.getByRole('alert')).toContainText('최대 4개');
  expect(await frame(page)).toBe(full);
  for (const [label, value] of [
    ['요소 폭', '0'],
    ['요소 회전', '361'],
    ['요소 가로 위치', '301'],
    ['요소 높이', ''],
  ] as const) {
    await revealControl(page, page.getByLabel(label, { exact: true }));
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Enter');
    await expect(page.getByRole('alert')).toContainText('기존 작업');
    expect(await frame(page)).toBe(full);
  }
  while (await page.getByRole('button', { name: '선택 요소 삭제', exact: true }).count())
    await page.getByRole('button', { name: '선택 요소 삭제', exact: true }).click();
  await page.route('**/assets/starter/block-happy.png', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  const empty = await frame(page);
  await addCharacter(page, 'starter-block-happy');
  await expect(page.getByRole('alert')).toContainText('캐릭터를 불러오지 못했습니다');
  expect(await frame(page)).toBe(empty);
  await compareDownload(page, info, 'empty-after-errors', expectedSizes[1080]['1:1']);
  await writeFile(
    info.outputPath('element-preservation.json'),
    JSON.stringify(
      {
        emptyJsonRestored: true,
        invalidNumbersPreserved: 4,
        characterLimitPreserved: true,
        failedAssetPreserved: true,
      },
      null,
      2,
    ),
  );
});

test('포인터 선택·이동은 회전 좌표를 따르고 늦은 소재 응답은 교체한 작품을 덮지 않는다', async ({
  page,
}, info) => {
  await ready(page);
  await addCharacter(page, 'starter-block-happy');
  await number(page, '요소 가로 위치', 25);
  await number(page, '요소 세로 위치', 30);
  await number(page, '요소 폭', 40);
  await number(page, '요소 높이', 40);
  await number(page, '요소 회전', 25);
  await page.locator('canvas').scrollIntoViewIfNeeded();
  const box = (await page.locator('canvas').boundingBox())!;
  const from = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.5 };
  const to = { x: from.x + box.width * 0.1, y: from.y + box.height * 0.08 };
  if (info.project.name.startsWith('mobile')) {
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
  await expect
    .poll(async () => Number(await page.getByLabel('요소 가로 위치', { exact: true }).inputValue()))
    .toBeCloseTo(35, 0);
  await expect
    .poll(async () => Number(await page.getByLabel('요소 세로 위치', { exact: true }).inputValue()))
    .toBeCloseTo(38, 0);
  await compareDownload(page, info, 'dragged-character', expectedSizes[1080]['1:1']);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let arrived!: () => void;
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route('**/assets/starter/seed-neutral.png', async (route) => {
    arrived();
    await hold;
    await route.continue();
  });
  await revealControl(page, page.getByLabel('추가할 캐릭터'));
  await page.getByLabel('추가할 캐릭터').selectOption('starter-seed-neutral');
  await page.getByRole('button', { name: '캐릭터 추가', exact: true }).click();
  await started;
  const starters = page.getByRole('region', { name: '기본 템플릿' });
  await starters.getByRole('button', { name: '상황과 반응', exact: true }).click();
  await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
  const replacement = await frame(page);
  release();
  await expect(page.getByRole('button', { name: '캐릭터 추가', exact: true })).toBeEnabled();
  expect(await frame(page)).toBe(replacement);
  await writeFile(
    info.outputPath('pointer-and-race.json'),
    JSON.stringify(
      {
        pointer: info.project.name.startsWith('mobile') ? 'CDP touch' : 'mouse',
        rotatedDrag: true,
        replacedDocumentPreserved: true,
      },
      null,
      2,
    ),
  );
});

test('독립 색상 기준으로 회전·양방향 반전·레이어의 실제 픽셀을 확인한다', async ({
  page,
}, info) => {
  await ready(page);
  const evidence = await page.evaluate(async () => {
    const modulePath = '/src/composition/rendering.ts';
    const { renderDocument } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/rendering');
    const source = document.createElement('canvas');
    source.width = source.height = 100;
    const ctx = source.getContext('2d')!;
    for (const [x, y, color] of [
      [0, 0, '#ff0000'],
      [50, 0, '#00ff00'],
      [0, 50, '#0000ff'],
      [50, 50, '#ffff00'],
    ] as const) {
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 50, 50);
    }
    const t = {
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
      rotation: 0,
      flipX: false,
      flipY: false,
      opacity: 1,
    };
    const element = {
      id: 'image',
      kind: 'image' as const,
      assetId: 'colors',
      fit: 'contain' as const,
      hidden: false,
      locked: false,
    };
    const doc: StudioDocument = {
      kind: 'jjal-document',
      schemaVersion: 1,
      id: 'oracle',
      title: '색상 기준',
      createdAt: '2026-10-22T00:00:00Z',
      updatedAt: '2026-10-22T00:00:00Z',
      activeRatio: '1:1',
      assets: [],
      elements: [element],
      panels: [
        {
          id: 'panel',
          elementIds: ['image'],
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
              elements: [{ elementId: 'image', transform: t }],
            },
          ],
        },
      ],
    };
    const output = document.createElement('canvas');
    function sample() {
      renderDocument(output, doc, { images: new Map([['colors', source]]) });
      return [
        [300, 300],
        [780, 300],
        [300, 780],
        [780, 780],
      ].map(([x, y]) => [...output.getContext('2d')!.getImageData(x!, y!, 1, 1).data]);
    }
    const normal = sample();
    t.flipX = true;
    const horizontal = sample();
    t.flipX = false;
    t.flipY = true;
    const vertical = sample();
    t.flipY = false;
    t.rotation = 90;
    const rotation = sample();
    t.rotation = 0;
    doc.elements.push({
      id: 'cover',
      kind: 'bubble',
      locked: false,
      hidden: false,
      text: '',
      shape: 'caption',
      fill: '#ff00ff',
      border: '#ff00ff',
      borderWidth: 0,
      tail: null,
      style: {
        font: { kind: 'builtin', family: 'Noto Sans KR' },
        fontSize: 28,
        color: '#000000',
        align: 'left',
        lineHeight: 1,
        bold: false,
      },
    });
    doc.layouts[0]!.panels[0]!.elements.push({ elementId: 'cover', transform: { ...t } });
    doc.panels[0]!.elementIds.push('cover');
    const front = sample();
    doc.panels[0]!.elementIds.reverse();
    const back = sample();
    return { normal, horizontal, vertical, rotation, front, back };
  });
  const R = [255, 0, 0, 255],
    G = [0, 255, 0, 255],
    B = [0, 0, 255, 255],
    Y = [255, 255, 0, 255];
  expect(evidence.normal).toEqual([R, G, B, Y]);
  expect(evidence.horizontal).toEqual([G, R, Y, B]);
  expect(evidence.vertical).toEqual([B, Y, R, G]);
  expect(evidence.rotation).toEqual([B, R, Y, G]);
  expect(evidence.front).toEqual(Array(4).fill([255, 0, 255, 255]));
  expect(evidence.back).toEqual(evidence.normal);
  await writeFile(
    info.outputPath('independent-pixel-oracle.json'),
    JSON.stringify(evidence, null, 2),
  );
});
