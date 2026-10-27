import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  activate,
  downloadPng,
  frame,
  goPage,
  rail,
  ready,
  reveal,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

const badge = (page: Page, id: string) => page.locator(`[data-layer-status-for="${id}"]`);
const selected = async (page: Page) =>
  (
    await selectedLayer(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-element-id')),
    )
  ).sort();

async function textGroup(page: Page, touch: boolean, info: TestInfo) {
  await ready(page);
  const ids: string[] = [];
  for (const text of ['배지 그룹 하나', '배지 그룹 둘']) {
    await goPage(page, 'text');
    await activate(page.locator('button.caption-add'), touch);
    await (await reveal(page, '문구', 'text')).fill(text);
    ids.push((await selectedLayer(page).getAttribute('data-element-id'))!);
  }
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await activate(rail(page).locator(`[data-element-id="${ids[0]}"]`), touch);
  await expect(selectedLayer(page)).toHaveCount(2);
  await page.getByRole('button', { name: '그룹 묶기', exact: true }).click();
  const saved = await saveDocument(page, info, '배지 그룹 기준');
  const groupIds = ids.map(
    (id) => saved.document.elements.find((element) => element.id === id)!.groupId,
  );
  expect(groupIds[0]).toBeTruthy();
  expect(groupIds[1]).toBe(groupIds[0]);
  const unrelated = saved.document.elements.find(
    (element) => element.kind === 'text' && !ids.includes(element.id),
  )!;
  expect(unrelated).toBeTruthy();
  return { ids, unrelated: unrelated.id };
}

async function selectUnrelated(page: Page, id: string, touch: boolean) {
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 해제', exact: true }).click();
  await activate(rail(page).locator(`[data-element-id="${id}"]`), touch);
  await expect(selectedLayer(page)).toHaveCount(1);
  expect(await selected(page)).toEqual([id]);
}

async function editStatus(page: Page, id: string, touch: boolean) {
  if (touch) {
    await activate(badge(page, id), true);
    const details = page.getByRole('dialog', { name: '레이어 상태 상세', exact: true });
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: '상태 편집', exact: true }).tap();
  } else await badge(page, id).click({ button: 'right' });
  const dialog = page.getByRole('dialog', { name: '레이어 상태 편집', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('잠금·숨김·그룹 배지를 각각 확인하고 선택·배치 보존 하에 전체 그룹 상태를 편집한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const { ids, unrelated } = await textGroup(page, isMobile, info);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금', exact: true }).click();
  await page.getByRole('button', { name: '선택 숨김', exact: true }).click();
  const baseline = (await saveDocument(page, info, '세 상태 배지 원본')).document;
  await selectUnrelated(page, unrelated, isMobile);
  const originalSelection = await selected(page),
    originalFrame = await frame(page);
  for (const id of ids)
    expect(
      await badge(page, id)
        .locator('[data-layer-badge]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-layer-badge'))),
    ).toEqual(['locked', 'hidden', 'group']);
  await badge(page, ids[0]!).scrollIntoViewIfNeeded();
  const targets = await badge(page, ids[0]!).evaluate((node) => {
    const circle = node.parentElement!.querySelector('.layer-circle')!;
    const measure = (target: Element) => {
      const b = target.getBoundingClientRect();
      return {
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        hit:
          document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') ===
          target,
      };
    };
    return { badge: measure(node), circle: measure(circle) };
  });
  for (const target of Object.values(targets)) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.hit).toBe(true);
  }
  expect(
    Math.min(targets.badge.x + targets.badge.width, targets.circle.x + targets.circle.width) -
      Math.max(targets.badge.x, targets.circle.x),
  ).toBeLessThanOrEqual(0);
  await activate(badge(page, ids[0]!), isMobile);
  const details = page.getByRole('dialog', { name: '레이어 상태 상세', exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByText('2개 중 2개 잠김', { exact: true })).toBeVisible();
  await expect(details.getByText('2개 중 2개 숨김', { exact: true })).toBeVisible();
  await expect(details.getByText('2개 묶음', { exact: true })).toBeVisible();
  expect(await selected(page)).toEqual(originalSelection);
  expect(await frame(page)).toBe(originalFrame);
  await page.screenshot({ path: info.outputPath('layer-badge-details.png'), fullPage: true });
  await details.getByRole('button', { name: '상태 편집', exact: true }).click();
  let editor = page.getByRole('dialog', { name: '레이어 상태 편집', exact: true });
  await expect(editor.getByRole('button', { name: '그룹 해제', exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(await selected(page)).toEqual(originalSelection);
  expect(await frame(page)).toBe(originalFrame);
  const unlocked = (await saveDocument(page, info, '배지 잠금 해제')).document;
  expect(unlocked.layouts).toEqual(baseline.layouts);
  expect(unlocked.elements).toEqual(
    baseline.elements.map((element) =>
      ids.includes(element.id) ? { ...element, locked: false } : element,
    ),
  );
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(badge(page, ids[0]!).locator('[data-layer-badge="locked"]')).toHaveCount(1);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(badge(page, ids[0]!).locator('[data-layer-badge="locked"]')).toHaveCount(0);
  editor = await editStatus(page, ids[0]!, isMobile);
  await editor.getByRole('button', { name: '숨김 해제', exact: true }).click();
  expect(await selected(page)).toEqual(originalSelection);
  const visibleFrame = await frame(page);
  expect(visibleFrame).not.toBe(originalFrame);
  const visible = (await saveDocument(page, info, '배지 숨김 해제')).document;
  expect(visible.layouts).toEqual(baseline.layouts);
  expect(visible.elements).toEqual(
    baseline.elements.map((element) =>
      ids.includes(element.id) ? { ...element, locked: false, hidden: false } : element,
    ),
  );
  editor = await editStatus(page, ids[0]!, isMobile);
  await expect(editor.getByRole('button', { name: '그룹 해제', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: '그룹 해제', exact: true }).click();
  expect(await selected(page)).toEqual(originalSelection);
  expect(await frame(page)).toBe(visibleFrame);
  for (const id of ids) await expect(badge(page, id)).toHaveCount(0);
  const ungrouped = (await saveDocument(page, info, '배지 그룹 해제')).document;
  expect(ungrouped.layouts).toEqual(baseline.layouts);
  expect(ungrouped.elements).toEqual(
    visible.elements.map((element) => {
      if (!ids.includes(element.id)) return element;
      const { groupId: removed, ...rest } = element;
      expect(removed).toBeTruthy();
      return rest;
    }),
  );
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  for (const id of ids)
    await expect(badge(page, id).locator('[data-layer-badge="group"]')).toHaveCount(1);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  for (const id of ids) await expect(badge(page, id)).toHaveCount(0);
  const pixels = await downloadPng(page, info, 'layer-badges-export');
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('layer-state-badges.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        ids,
        unrelated,
        targets,
        selectionPreserved: true,
        exactLayoutsPreserved: true,
        history: true,
        pixels,
        errors,
      },
      null,
      2,
    ),
  );
});

test('배지 상세 닫기·키보드 및 모바일 접근과 IME·보기 전용 가드를 보존한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(120_000);
  const { ids, unrelated } = await textGroup(page, isMobile, info);
  await selectUnrelated(page, unrelated, isMobile);
  const originalSelection = await selected(page),
    originalFrame = await frame(page);
  await activate(badge(page, ids[0]!), isMobile);
  await expect(page.getByRole('dialog', { name: '레이어 상태 상세', exact: true })).toBeVisible();
  if (isMobile) await page.getByRole('button', { name: '레이어 상태 닫기', exact: true }).tap();
  else await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await selected(page)).toEqual(originalSelection);
  expect(await frame(page)).toBe(originalFrame);
  if (!isMobile) {
    await badge(page, ids[0]!).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: '레이어 상태 상세', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '상태 편집', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '레이어 상태 편집', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  }
  const caption = await reveal(page, '문구', 'text');
  await caption.dispatchEvent('compositionstart', { data: '조' });
  for (const id of ids) await expect(badge(page, id)).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await frame(page)).toBe(originalFrame);
  expect(await selected(page)).toEqual(originalSelection);
  await caption.dispatchEvent('compositionend', { data: '' });
  for (const id of ids) await expect(badge(page, id)).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await frame(page)).toBe(originalFrame);
  await ready(page, '/?view=readonly');
  const readonlyBadges = page.locator('[data-layer-status-for]');
  expect(await readonlyBadges.count()).toBeGreaterThan(0);
  for (const item of await readonlyBadges.all()) await expect(item).toBeDisabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('layer-badges-readonly.png'), fullPage: true });
  await writeFile(
    info.outputPath('layer-badge-guards.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        ids,
        unrelated,
        closePreservesSelectionAndCanvas: true,
        keyboard: !isMobile,
        imeBlocksBadges: true,
        readonlyBadges: await readonlyBadges.count(),
      },
      null,
      2,
    ),
  );
});
