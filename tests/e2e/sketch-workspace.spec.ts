import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { frame, goPage, rail, ready, restore, savedDocument } from './sketch-controls';

const resources = (page: Page) => page.getByRole('region', { name: '자원그룹', exact: true });
const folder = (page: Page, name: string) =>
  resources(page).getByRole('tab', { name, exact: true });
const items = (page: Page) => resources(page).locator('[data-resource-id]');
const layerIds = (page: Page) =>
  rail(page)
    .locator('[data-layer-id]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.layerId));

async function dragResource(
  page: Page,
  source: ReturnType<typeof items>,
  target: ReturnType<typeof rail>,
  mobile: boolean,
) {
  await source.scrollIntoViewIfNeeded();
  if (!mobile) {
    await source.dragTo(target, { targetPosition: { x: 3, y: 24 } });
    return;
  }
  const a = (await source.boundingBox())!,
    b = (await target.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  try {
    const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
    const end = { x: b.x + 3, y: b.y + b.height / 2 };
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...start, id: 1 }],
    });
    await page.waitForTimeout(400);
    for (let i = 1; i <= 6; i++)
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: start.x + ((end.x - start.x) * i) / 6,
            y: start.y + ((end.y - start.y) * i) / 6,
            id: 1,
          },
        ],
      });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

test('스케치 작업공간: 위아래 구성·7북마크·10페이지·반응형 상태 보존', async ({ page }, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const observations = [];
  for (const [width, height] of [
    [390, 844],
    [768, 1024],
    [1440, 1000],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await ready(page);
    await expect(items(page)).toHaveCount(12);
    await expect(page.locator('.tool-bookmarks').getByRole('tab')).toHaveCount(7);
    await expect(page.locator('[data-tool-page]')).toHaveCount(10);
    const original = await frame(page);
    for (const id of [
      'templates',
      'layout',
      'image',
      'text',
      'background',
      'layers',
      'elements',
      'style',
      'library',
      'export',
    ]) {
      await goPage(page, id);
      await expect(page.locator(`[data-tool-page="${id}"]`)).toHaveAttribute(
        'aria-hidden',
        'false',
      );
      expect(await frame(page)).toBe(original);
    }
    const bounds = await page.evaluate(() => {
      const box = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { y: r.top + scrollY, bottom: r.bottom + scrollY };
      };
      return {
        resource: box('.top-resource-area'),
        layers: box('.layer-rail'),
        card: box('.canvas-stage'),
        bookmarks: box('.tool-bookmarks'),
        pages: box('.tool-pages'),
        overflow: document.documentElement.scrollWidth - innerWidth,
        wide: document.querySelector('.studio-shell')!.classList.contains('is-wide'),
        sidebar: box('.studio-sidebar'),
        workspace: box('.card-workspace'),
      };
    });
    expect(bounds.overflow).toBeLessThanOrEqual(1);
    if (bounds.wide) {
      expect(bounds.layers.bottom).toBeLessThanOrEqual(bounds.sidebar.y + 2);
      expect(bounds.layers.bottom).toBeLessThanOrEqual(bounds.workspace.y + 2);
      expect(bounds.resource.bottom).toBeLessThanOrEqual(bounds.bookmarks.y + 2);
    } else {
      expect(bounds.resource.bottom).toBeLessThanOrEqual(bounds.layers.y + 2);
      expect(bounds.layers.bottom).toBeLessThanOrEqual(bounds.card.y + 50);
      expect(bounds.card.bottom).toBeLessThanOrEqual(bounds.bookmarks.y + 2);
      expect(bounds.bookmarks.bottom).toBeLessThanOrEqual(bounds.pages.y + 50);
    }
    observations.push({ width, height, bounds });
    await page.screenshot({ path: info.outputPath(`sketch-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('layout-and-navigation.json'),
    JSON.stringify({ observations, errors }, null, 2),
  );
});

test('보기 전용 표시: 정확한 배너와 편집 차단·요청 미연동 안내', async ({ page }, info) => {
  await ready(page, '/?view=readonly');
  const original = await frame(page);
  const banner = resources(page).getByRole('button', {
    name: '현재 보기만 가능한 상태입니다. 편집권한을 가져오려면 눌러주세요.',
    exact: true,
  });
  await expect(banner).toBeVisible();
  expect(await banner.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(
    'rgba(11, 15, 43, 0.5)',
  );
  expect(await banner.evaluate((node) => getComputedStyle(node).color)).toBe('rgb(248, 249, 250)');
  await expect(items(page)).toHaveCount(0);
  await expect(rail(page).getByRole('button').first()).toBeDisabled();
  await expect(page.locator('[data-transform-handle], [data-resize-handle]')).toHaveCount(0);
  await goPage(page, 'text');
  await expect(page.getByLabel('문구 글꼴', { exact: true })).toBeDisabled();
  await banner.click();
  await expect(page.locator('.studio-status')).toHaveText('편집 권한 요청 기능은 준비 중입니다.');
  expect(await frame(page)).toBe(original);
  await page.screenshot({ path: info.outputPath('view-only.png'), fullPage: true });
});

test('자원 폴더: 다중 분류·잘못된 입력 보존·새로고침·기본 목록 새로 확인', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await ready(page);
  await expect(items(page)).toHaveCount(12);
  await folder(page, '미분류').click();
  const input = resources(page).getByLabel('자원 이미지 파일', { exact: true });
  await input.setInputFiles('tests/fixtures/images/portrait.png');
  await expect(items(page)).toHaveCount(1);
  const original = await frame(page);
  await input.setInputFiles([
    { name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') },
  ]);
  await expect(resources(page).getByRole('alert')).toBeVisible();
  await expect(items(page)).toHaveCount(1);
  expect(await frame(page)).toBe(original);
  for (const name of ['사진', '스티커']) {
    await resources(page).getByRole('button', { name: '자원 폴더 추가', exact: true }).click();
    await resources(page).getByLabel('새 폴더', { exact: true }).fill(name);
    await resources(page).getByRole('button', { name: '추가', exact: true }).click();
    await expect(folder(page, name)).toHaveAttribute('aria-selected', 'true');
    await input.setInputFiles('tests/fixtures/images/portrait.png');
    await expect(items(page)).toHaveCount(1);
  }
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  const ids = [];
  for (const name of ['사진', '스티커']) {
    await folder(page, name).click();
    await expect(items(page)).toHaveCount(1);
    ids.push(await items(page).first().getAttribute('data-resource-id'));
  }
  expect(ids[0]).toBe(ids[1]);
  const catalog = JSON.parse(
    await readFile('apps/demo/public/assets/resource-catalog.json', 'utf8'),
  ) as { assets: unknown[] };
  const bytes = await readFile('tests/fixtures/images/portrait.png');
  const hash = createHash('sha256').update(bytes).digest('hex');
  catalog.assets.push({
    asset: {
      id: 'new-catalog-photo',
      mimeType: 'image/png',
      byteLength: bytes.length,
      sha256: hash,
      pixelWidth: bytes.readUInt32BE(16),
      pixelHeight: bytes.readUInt32BE(20),
    },
    url: './assets/starter/new-catalog-photo.png',
    label: '새 기본 이미지',
    category: 'character',
  });
  let refreshes = 0;
  await page.route('**/assets/resource-catalog.json', async (route) => {
    refreshes++;
    await route.fulfill({ json: catalog });
  });
  await folder(page, '기본').click();
  await resources(page).getByRole('button', { name: '기본 불러오기', exact: true }).click();
  await expect(items(page)).toHaveCount(13);
  expect(refreshes).toBe(1);
  await folder(page, '사진').click();
  await expect(items(page)).toHaveCount(1);
  await writeFile(
    info.outputPath('folders.json'),
    JSON.stringify(
      { sameHashBothFolders: ids[0], invalidPreserved: true, newBuiltinCount: 13, refreshes },
      null,
      2,
    ),
  );
});

test('자원→원하는 레이어 위치 삽입·저장 복원과 직접 문구 IME 보존', async ({ page }, info) => {
  test.setTimeout(120_000);
  await ready(page);
  await expect(items(page)).toHaveCount(12);
  await items(page).nth(0).click();
  await expect(rail(page).locator('[data-layer-id]')).toHaveCount(4);
  const first = (await layerIds(page))[0];
  const bottom = rail(page).locator('[data-layer-id="line-1"]');
  await dragResource(page, items(page).nth(1), bottom, info.project.name.startsWith('mobile'));
  await expect(rail(page).locator('[data-layer-id]')).toHaveCount(5);
  const order = await layerIds(page);
  expect(order[0]).toBe(first);
  expect(order[2]).toBe('line-1');
  const document = await savedDocument(page, info, '레이어 순서');
  expect([...document.panels[0]!.elementIds].reverse()).toEqual(order);
  const original = await frame(page);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '레이어 순서');
  expect(await frame(page)).toBe(original);
  await rail(page).getByRole('button', { name: /문구/ }).click();
  await page.getByRole('button', { name: '내용 수정', exact: true }).click();
  const direct = page.getByRole('textbox', { name: '카드 문구 직접 편집', exact: true });
  await direct.dispatchEvent('compositionstart');
  await direct.fill('조합 중');
  const before = await frame(page);
  await direct.press('Control+Enter');
  await expect(direct).toBeVisible();
  expect(await frame(page)).toBe(before);
  await direct.dispatchEvent('compositionend');
  await direct.press('Control+Enter');
  await expect(direct).toHaveCount(0);
  const committed = await frame(page);
  expect(committed).not.toBe(before);
  await page.getByRole('button', { name: '내용 수정', exact: true }).click();
  await direct.fill('가'.repeat(1001));
  await direct.press('Control+Enter');
  await expect(direct).toBeVisible();
  expect(await frame(page)).toBe(committed);
  await direct.press('Escape');
  await expect(direct).toHaveCount(0);
  await writeFile(
    info.outputPath('layer-insertion-ime.json'),
    JSON.stringify(
      {
        order,
        storedOrder: [...document.panels[0]!.elementIds].reverse(),
        imeAndInvalidInputPreserved: true,
        touchHold: info.project.name.startsWith('mobile'),
      },
      null,
      2,
    ),
  );
});

test('여러 컷 레이어를 모두 표시하고 두 번째 컷의 원하는 순서에 자원을 삽입한다', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await ready(page);
  await goPage(page, 'templates');
  await page
    .getByRole('region', { name: '기본 템플릿', exact: true })
    .getByRole('button', { name: '전후 비교', exact: true })
    .click();
  await expect(page.getByLabel('편집할 컷', { exact: true }).locator('option')).toHaveCount(2);
  const before = await savedDocument(page, info, '두 컷 시작');
  await expect(rail(page).locator('[data-layer-id]')).toHaveCount(before.elements.length);
  const second = before.panels[1]!;
  const target = rail(page).locator(`[data-panel-id="${second.id}"]`).first();
  await target.scrollIntoViewIfNeeded();
  await dragResource(page, items(page).first(), target, info.project.name.startsWith('mobile'));
  await expect(rail(page).locator('[data-layer-id]')).toHaveCount(before.elements.length + 1);
  const after = await savedDocument(page, info, '두 컷 삽입');
  expect(after.panels[0]!.elementIds).toEqual(before.panels[0]!.elementIds);
  expect(after.panels[1]!.elementIds).toHaveLength(second.elementIds.length + 1);
  expect([...after.panels[1]!.elementIds].reverse().slice(1)).toEqual(
    [...second.elementIds].reverse(),
  );
  await writeFile(
    info.outputPath('multicut-layers.json'),
    JSON.stringify({ before, after }, null, 2),
  );
});
