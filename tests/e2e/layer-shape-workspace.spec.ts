import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  activate,
  card,
  closeMobilePanel,
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

async function dragHandle(page: Page, target: Locator, touch: boolean, dx: number, dy: number) {
  const box = (await target.boundingBox())!;
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...point, id: 1 }],
      });
      await page.waitForTimeout(400);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x + dx, y: point.y + dy, id: 1 }],
      });
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await client.detach();
    }
  } else {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + dx, point.y + dy, { steps: 5 });
    await page.mouse.up();
  }
}

test('그룹 선택에서 문구·도형으로 전환하면 호환 멤버 하나를 편집하고 그룹 데이터는 보존한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(150_000);
  await ready(page);
  await goPage(page, 'text');
  await activate(page.locator('button.caption-add'), isMobile);
  await (await reveal(page, '문구', 'text')).fill('선택 전환 문구');
  const textId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  await goPage(page, 'style');
  await page.getByRole('button', { name: '원 추가', exact: true }).click();
  const shapeId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 해제', exact: true }).click();
  await activate(rail(page).locator(`[data-layer-id="${textId}"]`), isMobile);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await activate(rail(page).locator(`[data-layer-id="${shapeId}"]`), isMobile);
  await page.getByRole('button', { name: '그룹 묶기', exact: true }).click();
  const before = (await saveDocument(page, info, '전환 그룹 기준')).document;
  await goPage(page, 'layers');
  await expect(selectedLayer(page)).toHaveCount(2);
  await goPage(page, 'text');
  await expect(selectedLayer(page)).toHaveCount(1);
  await expect(selectedLayer(page)).toHaveAttribute('data-element-id', textId);
  const text = await reveal(page, '문구', 'text');
  await expect(text).toBeEnabled();
  await text.fill('그룹을 유지한 내용 수정');
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 해제', exact: true }).click();
  await activate(rail(page).locator(`[data-layer-id="${shapeId}"]`), isMobile);
  await goPage(page, 'style');
  await expect(selectedLayer(page)).toHaveCount(1);
  await expect(selectedLayer(page)).toHaveAttribute('data-element-id', shapeId);
  const fill = page.getByLabel('도형 채우기 색 (HEX)', { exact: true });
  await expect(fill).toBeEnabled();
  await fill.fill('#E6AB5E');
  await fill.press('Enter');
  await expect(page.getByRole('tab', { name: '스타일', exact: true })).toHaveCount(0);
  const after = (await saveDocument(page, info, '전환 그룹 수정')).document;
  for (const [index, layout] of after.layouts.entries())
    expect(
      layout.panels.map((panel) => ({
        ...panel,
        elements: panel.elements.filter((item) => item.elementId !== textId),
      })),
    ).toEqual(
      before.layouts[index]!.panels.map((panel) => ({
        ...panel,
        elements: panel.elements.filter((item) => item.elementId !== textId),
      })),
    );
  expect(after.panels).toEqual(before.panels);
  expect(after.elements).toEqual(
    before.elements.map((item) =>
      item.id === textId
        ? { ...item, text: '그룹을 유지한 내용 수정' }
        : item.id === shapeId
          ? { ...item, fill: '#E6AB5E' }
          : item,
    ),
  );
  await goPage(page, 'style');
  const beforeBad = await frame(page);
  await fill.fill('#NOPE');
  await fill.press('Enter');
  await expect(page.getByRole('alert')).toContainText('기존 작업');
  expect(await frame(page)).toBe(beforeBad);
  const stable = (await saveDocument(page, info, '잘못된 도형 색 보존')).document;
  expect(normalized(stable)).toEqual(normalized(after));
  await page.reload();
  await expect(card(page)).toBeVisible();
  await restore(page, '전환 그룹 수정');
  expect(normalized((await saveDocument(page, info, '전환 복원 검증')).document)).toEqual(
    normalized(after),
  );
  await writeFile(
    info.outputPath('tool-selection-result.json'),
    JSON.stringify({ textId, shapeId, groupPreserved: true, invalidHexPreserved: true }, null, 2),
  );
});

test('네 도형을 반복 추가하고 8개 비율에서 실제 핸들 편집·저장 복원·PNG 모든 픽셀을 검증한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const results = [];
  for (const name of ['정사각형', '원', '정삼각형', '마름모', '정사각형']) {
    await goPage(page, 'style');
    await page.getByRole('button', { name: `${name} 추가`, exact: true }).click();
  }
  const ids = await rail(page)
    .locator('[data-layer-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-layer-id')));
  expect(new Set(ids).size).toBe(ids.length);
  await page.getByLabel('외곽 질감', { exact: true }).selectOption('pencil');
  const width = page.getByLabel('외곽 두께', { exact: true });
  await width.fill('5');
  await width.press('Enter');
  for (const ratio of ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9']) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    await goPage(page, 'style');
    await closeMobilePanel(page);
    const before = await frame(page);
    await dragHandle(page, page.locator('[data-resize-handle="se"]'), isMobile, 9, 7);
    expect(await frame(page)).not.toBe(before);
    await dragHandle(
      page,
      page.getByRole('button', { name: '요소 회전 조절', exact: true }),
      isMobile,
      10,
      6,
    );
    await page.screenshot({
      path: info.outputPath(`shape-${ratio.replace(':', '-')}.png`),
      fullPage: true,
    });
    results.push({
      ratio,
      ...(await downloadPng(page, info, `shapes-${ratio.replace(':', '-')}`)),
    });
  }
  const beforeSave = (await saveDocument(page, info, '8비율 도형 저장')).document;
  expect(beforeSave.elements.filter((item) => item.kind === 'shape')).toHaveLength(5);
  await page.reload();
  await expect(card(page)).toBeVisible();
  await restore(page, '8비율 도형 저장');
  expect(normalized((await saveDocument(page, info, '8비율 도형 복원')).document)).toEqual(
    normalized(beforeSave),
  );
  expect(errors).toEqual([]);
  await writeFile(info.outputPath('shape-eight-ratios.json'), JSON.stringify(results, null, 2));
});
