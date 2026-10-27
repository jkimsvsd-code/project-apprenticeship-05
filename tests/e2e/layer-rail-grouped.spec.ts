import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  activate,
  downloadPng,
  frame,
  goPage,
  normalized,
  rail,
  ready,
  restore,
  reveal,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

const layer = (page: Page, id: string) => rail(page).locator(`[data-layer-id="${id}"]`);
const menu = (page: Page) => page.getByRole('group', { name: '선택 레이어 메뉴', exact: true });
const count = (page: Page) => page.getByRole('status', { name: '전체 레이어 수', exact: true });

async function createGroup(page: Page, touch: boolean, info: TestInfo) {
  await ready(page);
  const ids: string[] = [];
  for (const text of ['스택 첫 문구', '스택 둘 문구', '독립 문구']) {
    await goPage(page, 'text');
    await activate(page.locator('button.caption-add'), touch);
    await (await reveal(page, '문구', 'text')).fill(text);
    ids.push((await selectedLayer(page).getAttribute('data-element-id'))!);
  }
  const before = (await saveDocument(page, info, '스택 묶기 전')).document;
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 해제', exact: true }).click();
  await activate(layer(page, ids[0]!), touch);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await activate(layer(page, ids[1]!), touch);
  await expect(selectedLayer(page)).toHaveCount(2);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '그룹 묶기', exact: true }).click();
  const document = (await saveDocument(page, info, '스택 그룹 기준')).document;
  const groupId = document.elements.find((element) => element.id === ids[0])!.groupId;
  expect(groupId).toBeTruthy();
  expect(document.elements.find((element) => element.id === ids[1])!.groupId).toBe(groupId);
  expect(document.layouts).toEqual(before.layouts);
  expect(document.panels).toEqual(before.panels);
  expect(document.elements).toEqual(
    before.elements.map((element) =>
      ids.slice(0, 2).includes(element.id) ? { ...element, groupId } : element,
    ),
  );
  return { ids, document };
}

async function contextMenu(page: Page, id: string, touch: boolean) {
  const target = layer(page, id);
  await target.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'center' }));
  const box = (await target.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('[data-layer-id]')?.getAttribute('data-layer-id'),
      point,
    ),
  ).toBe(id);
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...point, id: 1 }],
      });
      await page.waitForTimeout(620);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await client.detach();
    }
  } else await target.click({ button: 'right' });
  await expect(menu(page)).toBeVisible();
  return menu(page);
}

test('총 레이어 수와 원형 그룹 스택을 데이터 변경 없이 표시하고 우클릭·긴 누름 메뉴로 상세·상태를 편집한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { ids, document } = await createGroup(page, isMobile, info);
  await expect(count(page)).toHaveText(`레이어 ${document.elements.length}개`);
  expect(await rail(page).locator('[data-layer-id]').count()).toBe(document.elements.length);
  expect(
    await rail(page)
      .locator('[data-layer-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-layer-id'))),
  ).toEqual(document.panels.flatMap((panel) => [...panel.elementIds].reverse()));
  await expect(page.locator('.layer-status-badges,[data-layer-status-for]')).toHaveCount(0);
  await layer(page, ids[0]!).evaluate((node) =>
    node.scrollIntoView({ block: 'nearest', inline: 'center' }),
  );
  const boxes = await rail(page).evaluate(
    (node, groupIds) =>
      groupIds.map((id) => {
        const button = node.querySelector<HTMLElement>(`[data-layer-id="${id}"]`)!;
        const box = button.getBoundingClientRect();
        return {
          id,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          run: button.parentElement!.dataset.groupRun,
        };
      }),
    ids.slice(0, 2),
  );
  for (const box of boxes) {
    expect(box.width).toBe(44);
    expect(box.height).toBe(44);
  }
  expect(
    Math.abs(Math.min(boxes[0]!.x + 44, boxes[1]!.x + 44) - Math.max(boxes[0]!.x, boxes[1]!.x) - 6),
  ).toBeLessThan(0.1);
  expect(boxes.map((box) => box.run).sort()).toEqual(['end', 'start']);
  const originalFrame = await frame(page);
  let popup = await contextMenu(page, ids[0]!, isMobile);
  await expect(popup.getByRole('button', { name: '상세 보기', exact: true })).toBeEnabled();
  await expect(popup.getByRole('button', { name: '상태 편집', exact: true })).toBeEnabled();
  await expect(popup.getByRole('button', { name: '레이어지우기', exact: true })).toBeEnabled();
  await expect(selectedLayer(page)).toHaveCount(2);
  await popup.getByRole('button', { name: '상세 보기', exact: true }).click();
  const details = page.getByRole('dialog', { name: '레이어 상태 상세', exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByText('2개 묶음', { exact: true })).toBeVisible();
  expect(await frame(page)).toBe(originalFrame);
  await page.screenshot({ path: info.outputPath('grouped-layer-details.png'), fullPage: true });
  await details.getByRole('button', { name: '레이어 상태 닫기', exact: true }).click();
  popup = await contextMenu(page, ids[0]!, isMobile);
  await popup.getByRole('button', { name: '상태 편집', exact: true }).click();
  await page
    .getByRole('dialog', { name: '레이어 상태 편집', exact: true })
    .getByRole('button', { name: '잠금', exact: true })
    .click();
  const locked = (await saveDocument(page, info, '원형 메뉴 그룹 잠금')).document;
  expect(locked.elements).toEqual(
    document.elements.map((element) =>
      ids.slice(0, 2).includes(element.id) ? { ...element, locked: true } : element,
    ),
  );
  expect(locked.layouts).toEqual(document.layouts);
  expect(locked.panels).toEqual(document.panels);
  popup = await contextMenu(page, ids[0]!, isMobile);
  await expect(popup.getByRole('button', { name: '레이어지우기', exact: true })).toBeDisabled();
  for (const edit of await popup.getByRole('button', { name: '내용 수정', exact: true }).all())
    await expect(edit).toBeDisabled();
  await popup.getByRole('button', { name: '상태 편집', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '레이어 상태 편집', exact: true });
  await expect(editor.getByRole('button', { name: '그룹 해제', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: '잠금 해제', exact: true }).click();
  expect(await frame(page)).toBe(originalFrame);
  await expect(count(page)).toHaveText(`레이어 ${document.elements.length}개`);
  const final = (await saveDocument(page, info, '원형 메뉴 상태 복구')).document;
  expect(final.elements).toEqual(document.elements);
  expect(final.layouts).toEqual(document.layouts);
  expect(final.panels).toEqual(document.panels);
  const pixels = await downloadPng(page, info, 'grouped-layer-preview');
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('grouped-layer-menu.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        ids,
        layerCount: document.elements.length,
        boxes,
        exactDataPreserved: true,
        pixels,
        errors,
      },
      null,
      2,
    ),
  );
});

test('원형 그룹의 실제 드래그 순서·실행 취소·JSON 복원과 IME·보기 전용 제한을 보존한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(180_000);
  const { ids, document } = await createGroup(page, isMobile, info);
  const source = layer(page, ids[0]!),
    target = layer(page, ids[2]!);
  await rail(page).evaluate((node) => node.scrollTo({ left: 0, behavior: 'instant' }));
  const startBox = (await source.boundingBox())!,
    targetBox = (await target.boundingBox())!;
  const start = { x: startBox.x + startBox.width / 2, y: startBox.y + startBox.height / 2 };
  const end = { x: targetBox.x + 8, y: targetBox.y + targetBox.height / 2 };
  for (const [point, id] of [
    [start, ids[0]],
    [end, ids[2]],
  ] as const)
    expect(
      await page.evaluate(
        ({ x, y }) =>
          window.document
            .elementFromPoint(x, y)
            ?.closest('[data-layer-id]')
            ?.getAttribute('data-layer-id'),
        point,
      ),
    ).toBe(id);
  const beforeFrame = await frame(page);
  if (isMobile) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      await page.waitForTimeout(400);
      for (const fraction of [0.25, 0.5, 0.75, 1]) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: start.x + (end.x - start.x) * fraction,
              y: start.y + (end.y - start.y) * fraction,
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
  } else await source.dragTo(target, { targetPosition: { x: 8, y: targetBox.height / 2 } });
  const moved = (await saveDocument(page, info, '그룹 순서 이동')).document;
  const owner = document.panels.find((panel) => panel.elementIds.includes(ids[0]!))!;
  const originalDisplay = [...owner.elementIds].reverse();
  const moving = originalDisplay.filter((id) => ids.slice(0, 2).includes(id));
  const expectedDisplay = originalDisplay.filter((id) => !moving.includes(id));
  expectedDisplay.splice(expectedDisplay.indexOf(ids[2]!), 0, ...moving);
  expect(moved.panels).toEqual(
    document.panels.map((panel) =>
      panel.id === owner.id ? { ...panel, elementIds: [...expectedDisplay].reverse() } : panel,
    ),
  );
  expect(moved.elements).toEqual(document.elements);
  expect(moved.layouts).toEqual(document.layouts);
  await expect(count(page)).toHaveText(`레이어 ${document.elements.length}개`);
  const movedFrame = await frame(page);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  expect(await frame(page)).toBe(beforeFrame);
  expect((await saveDocument(page, info, '그룹 이동 취소')).document.panels).toEqual(
    document.panels,
  );
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  expect(await frame(page)).toBe(movedFrame);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '그룹 순서 이동');
  const restored = (await saveDocument(page, info, '그룹 순서 복원')).document;
  expect(normalized(restored)).toEqual(normalized(moved));
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 해제', exact: true }).click();
  const independent = restored.elements.find(
    (element) => element.kind === 'text' && element.text === '독립 문구',
  )!;
  await activate(layer(page, independent.id), isMobile);
  const caption = await reveal(page, '문구', 'text');
  const guardFrame = await frame(page);
  await caption.dispatchEvent('compositionstart', { data: '조' });
  for (const item of await rail(page).locator('[data-layer-id]').all())
    await expect(item).toBeDisabled();
  await expect(menu(page)).toHaveCount(0);
  expect(await frame(page)).toBe(guardFrame);
  await caption.dispatchEvent('compositionend', { data: '' });
  await expect(layer(page, independent.id)).toBeEnabled();
  await ready(page, '/?view=readonly');
  expect(await rail(page).locator('[data-layer-id]').count()).toBeGreaterThan(0);
  for (const item of await rail(page).locator('[data-layer-id]').all())
    await expect(item).toBeDisabled();
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await writeFile(
    info.outputPath('grouped-layer-order-guards.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        ids,
        start,
        end,
        expectedDisplay,
        groupMoveKeepsElementsAndLayouts: true,
        history: true,
        restore: true,
        ime: true,
        readonly: true,
      },
      null,
      2,
    ),
  );
});
