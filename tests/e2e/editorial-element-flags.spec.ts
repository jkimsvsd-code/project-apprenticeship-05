import { expect, test } from '@playwright/test';
import {
  activate,
  frame,
  goPage,
  rail,
  ready,
  reveal,
  saveDocument,
  selectedLayer,
  downloadPng,
} from './editorial-controls';

test('잠긴 문구 옆에 새 문구를 추가하고 숨김·해제·한 단계 실행 취소/다시 실행과 PNG를 보존한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(120_000);
  await ready(page);
  const add = page
    .locator('.quick-add-bar')
    .getByRole('button', { name: '문구 추가', exact: true });
  await activate(add, isMobile);
  await (await reveal(page, '문구', 'text')).fill('잠금과 숨김 검수');
  const id = (await selectedLayer(page).getAttribute('data-element-id'))!;
  const initial = (await saveDocument(page, info, '잠금 전')).document;
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금', exact: true }).click();
  await goPage(page, 'text');
  await expect(
    page.locator('.canvas-contextbar').getByRole('button', { name: '내용 수정', exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel('문구 글꼴', { exact: true })).toBeDisabled();
  await expect(add).toBeEnabled();
  await activate(add, isMobile);
  const addedId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  expect(addedId).not.toBe(id);
  const locked = (await saveDocument(page, info, '잠금 중 새 문구')).document;
  expect(locked.elements).toHaveLength(initial.elements.length + 1);
  expect(locked.elements.find((element) => element.id === id)).toEqual({
    ...initial.elements.find((element) => element.id === id)!,
    locked: true,
  });
  expect(locked.elements.find((element) => element.id === addedId)).toMatchObject({
    kind: 'text',
    locked: false,
    hidden: false,
  });
  await rail(page).locator(`[data-element-id="${id}"]`).click();
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
  const visible = await frame(page);
  await page.getByRole('button', { name: '선택 숨김', exact: true }).click();
  const hidden = await frame(page);
  expect(hidden).not.toBe(visible);
  await expect(page.locator('[data-resize-handle], [data-transform-handle]')).toHaveCount(0);
  const hiddenDoc = (await saveDocument(page, info, '숨김 상태')).document;
  expect(hiddenDoc.elements.find((element) => element.id === id)).toMatchObject({
    locked: false,
    hidden: true,
  });
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  expect(await frame(page)).toBe(visible);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  expect(await frame(page)).toBe(hidden);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 숨김 해제', exact: true }).click();
  expect(await frame(page)).toBe(visible);
  const final = (await saveDocument(page, info, '잠금 숨김 최종')).document;
  expect(final.elements.find((element) => element.id === id)).toMatchObject({
    locked: false,
    hidden: false,
  });
  expect(final.elements.find((element) => element.id === addedId)).toEqual(
    locked.elements.find((element) => element.id === addedId),
  );
  await downloadPng(page, info, 'flags-final');
});
