import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { frame, ready, savedDocument } from './sketch-controls';

const resources = (page: Page) => page.getByRole('region', { name: '자원그룹', exact: true });
const tabs = (page: Page) => resources(page).getByRole('tablist', { name: '자원 폴더' });
const folder = (page: Page, name: string) => tabs(page).getByRole('tab', { name, exact: true });

async function seedFolders(page: Page) {
  const folders = Array.from({ length: 14 }, (_, i) => ({
    id: `folder-seeded-${i}`,
    // Keep the native classification select's intrinsic width stable during the long-name case.
    name: i === 13 ? '끝' : i === 12 ? '긴'.repeat(30) : `보관함 ${String(i + 1).padStart(2, '0')}`,
  }));
  await page.addInitScript((initial) => {
    const key = 'jjal-resource-folders-v1';
    if (!localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ version: 1, folders: initial, memberships: {} }));
  }, folders);
  return folders;
}

async function revealState(page: Page) {
  return tabs(page).evaluate((node) => {
    const bar = node as HTMLElement;
    const selected = bar.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
    const box = bar.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    const style = getComputedStyle(bar);
    const left = box.left + Number.parseFloat(style.borderLeftWidth);
    const right = Math.min(
      left + bar.clientWidth,
      box.right - Number.parseFloat(style.borderRightWidth),
    );
    const available = right - left;
    return {
      selected: selected.textContent!.trim(),
      fullyVisible:
        item.width <= available + 0.75
          ? item.left >= left - 0.75 && item.right <= right + 0.75
          : item.left <= left + 0.75 && item.right >= right - 0.75,
      scrollLeft: bar.scrollLeft,
      maximum: Math.max(0, bar.scrollWidth - bar.clientWidth),
      windowX: window.scrollX,
      windowY: window.scrollY,
      order: [...bar.querySelectorAll('[role="tab"]')].map((tab) => tab.id),
      bounds: { left, right, itemLeft: item.left, itemRight: item.right },
    };
  });
}

async function expectRevealed(page: Page, name: string) {
  await expect(folder(page, name)).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await revealState(page)).fullyVisible).toBe(true);
  const state = await revealState(page);
  expect(state.scrollLeft).toBeGreaterThanOrEqual(-1);
  expect(state.scrollLeft).toBeLessThanOrEqual(state.maximum + 1);
  return state;
}

async function selectWithoutBrowserAutoScroll(page: Page, name: string) {
  await folder(page, name).evaluate((button) => button.focus({ preventScroll: true }));
  const before = await revealState(page);
  await page.keyboard.press('Enter');
  const after = await expectRevealed(page, name);
  await expect(folder(page, name)).toBeFocused();
  expect(after.windowX).toBe(before.windowX);
  expect(after.windowY).toBe(before.windowY);
  return after;
}

test('새 폴더와 이름 변경은 선택·순서·입력 포커스·문서·세로 위치를 보존하며 활성 탭만 노출한다', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await seedFolders(page);
  await ready(page);
  await expectRevealed(page, '기본');
  const beforeDocument = await savedDocument(page, info, '폴더 노출 전');
  const beforeFrame = await frame(page);
  const history = await page.locator('.toolbar-history-count').textContent();
  const beforeOrder = (await revealState(page)).order;
  // The legacy custom-folder form changes page height when leaving the builtin tab.
  // Open that existing layout before isolating the new hook's horizontal scrolling.
  await folder(page, seeded[0]!.name).click();
  await expectRevealed(page, seeded[0]!.name);
  await resources(page).getByRole('button', { name: '자원 폴더 추가', exact: true }).click();
  const input = resources(page).getByLabel('새 폴더', { exact: true });
  const observations = [];
  for (const name of ['새 폴더 하나', '새 폴더 둘', '아주 긴 이름을 가진 마지막 보관 폴더']) {
    await input.fill(name);
    await input.evaluate((node) => node.focus({ preventScroll: true }));
    await page.evaluate(() =>
      window.scrollTo({
        top: Math.min(60, document.documentElement.scrollHeight - innerHeight),
        behavior: 'instant',
      }),
    );
    const before = await revealState(page);
    await page.keyboard.press('Enter');
    const after = await expectRevealed(page, name);
    await expect(input).toBeFocused();
    expect(after.windowX).toBe(before.windowX);
    expect(after.windowY).toBe(before.windowY);
    expect(after.order.slice(0, before.order.length)).toEqual(before.order);
    expect(after.order).toHaveLength(before.order.length + 1);
    observations.push({ name, before, after });
  }
  const activeBeforeRename = (await revealState(page)).order;
  const rename = resources(page).getByLabel('폴더 이름', { exact: true });
  await rename.fill('짧음');
  const beforeRename = await revealState(page);
  await page.keyboard.press('Enter');
  const renamed = await expectRevealed(page, '짧음');
  await expect(rename).toBeFocused();
  expect(renamed.order).toEqual(activeBeforeRename);
  expect(renamed.windowY).toBe(beforeRename.windowY);
  expect(renamed.order.slice(0, beforeOrder.length)).toEqual(beforeOrder);
  expect(await frame(page)).toBe(beforeFrame);
  expect(await page.locator('.toolbar-history-count').textContent()).toBe(history);
  expect(await savedDocument(page, info, '폴더 노출 후')).toEqual(beforeDocument);
  const metadata = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem('jjal-resource-folders-v1')!) as {
        folders: { id: string; name: string }[];
      },
  );
  expect(metadata.folders.slice(0, seeded.length)).toEqual(seeded);
  expect(metadata.folders.at(-1)!.name).toBe('짧음');
  await writeFile(
    info.outputPath('new-folder-and-rename.json'),
    JSON.stringify({ observations, renamed, documentUnchanged: true, metadata }, null, 2),
  );
});

test('처음·끝 폴더의 최소 수평 노출과 390↔1440 전환·읽기 전용 재진입은 순서와 문서를 바꾸지 않는다', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  const seeded = await seedFolders(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await expectRevealed(page, '기본');
  const original = await frame(page);
  const order = (await revealState(page)).order;
  const end = seeded.at(-1)!.name;
  const observations = [await selectWithoutBrowserAutoScroll(page, end)];
  expect(observations[0]!.scrollLeft).toBeGreaterThan(0);
  await tabs(page).evaluate((bar) => {
    bar.scrollLeft = 0;
  });
  observations.push(await selectWithoutBrowserAutoScroll(page, end));
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const state = await expectRevealed(page, end);
    expect(state.order).toEqual(order);
    expect(await frame(page)).toBe(original);
    observations.push(state);
  }
  const start = await selectWithoutBrowserAutoScroll(page, '미분류');
  expect(start.scrollLeft).toBeLessThanOrEqual(1);
  expect(start.order).toEqual(order);
  await page.goto('/?view=readonly');
  await expect(resources(page).locator('.resource-readonly-banner')).toBeVisible();
  await expect(resources(page).getByRole('tablist')).toHaveCount(0);
  await ready(page);
  const returned = await expectRevealed(page, '기본');
  expect(returned.order).toEqual(order);
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('resize-remount-readonly.json'),
    JSON.stringify({ observations, start, returned, errors }, null, 2),
  );
});
