import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { downloadPng, frame, ready, restore, savedDocument } from './sketch-controls';

const resourceArea = (page: Page) => page.getByRole('region', { name: '자원그룹', exact: true });
const folderTabs = (page: Page) => resourceArea(page).getByRole('tablist', { name: '자원 폴더' });
const folder = (page: Page, name: string) =>
  folderTabs(page).getByRole('tab', { name, exact: true });
const names = ['새 폴더 하나', '새 폴더 둘', '아주 긴 이름을 가진 마지막 보관 폴더'];

async function settleLayout(page: Page) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

async function layout(page: Page) {
  return resourceArea(page).evaluate((area) => {
    const management = area.querySelector<HTMLElement>('.resource-management')!;
    const bounds = management.getBoundingClientRect();
    const children = [...management.querySelectorAll<HTMLElement>('label,input,select')].map(
      (node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          left: rect.left,
          right: rect.right,
          width: rect.width,
          height: rect.height,
        };
      },
    );
    return {
      documentHeight: document.documentElement.scrollHeight,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      managementHeight: bounds.height,
      classificationHeight: management
        .querySelector('.resource-classification')!
        .getBoundingClientRect().height,
      left: bounds.left,
      right: bounds.right,
      windowX: scrollX,
      windowY: scrollY,
      children,
      order: [...area.querySelectorAll('[role="tab"]')].map((node) => node.id),
    };
  });
}

async function positionWithoutFocusScroll(page: Page) {
  await page.evaluate(() =>
    window.scrollTo({
      top: Math.min(60, Math.max(0, document.documentElement.scrollHeight - innerHeight)),
      behavior: 'instant',
    }),
  );
  await settleLayout(page);
}

function expectUnchangedLayout(before: Awaited<ReturnType<typeof layout>>, after: typeof before) {
  expect
    .soft(after.documentHeight, 'folder name must not change document height')
    .toBe(before.documentHeight);
  expect
    .soft(after.managementHeight, 'folder name must not reflow management forms')
    .toBe(before.managementHeight);
  expect
    .soft(after.classificationHeight, 'native option width must not wrap its label')
    .toBe(before.classificationHeight);
  expect.soft(after.windowY, 'no extra vertical page movement').toBe(before.windowY);
  expect.soft(after.windowX).toBe(before.windowX);
  expect.soft(after.documentOverflow).toBeLessThanOrEqual(1);
  for (const child of after.children) {
    expect.soft(child.left, `${child.tag} left edge`).toBeGreaterThanOrEqual(after.left - 0.5);
    expect.soft(child.right, `${child.tag} right edge`).toBeLessThanOrEqual(after.right + 0.5);
  }
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 360, height: 800 },
  { width: 1440, height: 1000 },
  { width: 844, height: 390 },
]) {
  test(`긴 폴더명 관리 폼 ${viewport.width}×${viewport.height}: 세 번 생성·이름 변경의 높이/포커스/보관/출력 보존`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const seeded = Array.from({ length: 14 }, (_, i) => ({
      id: `folder-layout-${i}`,
      name: i === 13 ? '끝' : `보관함 ${String(i + 1).padStart(2, '0')}`,
    }));
    await page.addInitScript((initial) => {
      const key = 'jjal-resource-folders-v1';
      if (!localStorage.getItem(key))
        localStorage.setItem(
          key,
          JSON.stringify({ version: 1, folders: initial, memberships: {} }),
        );
    }, seeded);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await ready(page);
    const original = await savedDocument(page, info, '긴 폴더명 전');
    const pixels = await frame(page);
    const history = await page.locator('.toolbar-history-count').textContent();
    await folder(page, seeded[0]!.name).click();
    await resourceArea(page).getByRole('button', { name: '자원 폴더 추가', exact: true }).click();
    const input = resourceArea(page).getByLabel('새 폴더', { exact: true });
    const target = resourceArea(page).getByLabel('이동할 폴더', { exact: true });
    const observations = [];
    for (const name of names) {
      await input.fill(name);
      await input.evaluate((node) => node.focus({ preventScroll: true }));
      await positionWithoutFocusScroll(page);
      const before = await layout(page);
      await page.keyboard.press('Enter');
      await expect(folder(page, name)).toHaveAttribute('aria-selected', 'true');
      await settleLayout(page);
      const after = await layout(page);
      observations.push({ operation: 'create', name, before, after });
      expectUnchangedLayout(before, after);
      await expect(input).toBeFocused();
      expect(after.order.slice(0, before.order.length)).toEqual(before.order);
      expect(after.order).toHaveLength(before.order.length + 1);
      await expect(
        target.getByRole('option', { name, exact: true, includeHidden: true }),
      ).toHaveCount(1);
      await target.selectOption({ label: name });
      await expect(target.locator('option:checked')).toHaveText(name);
      expect(await frame(page)).toBe(pixels);
      expect(await page.locator('.toolbar-history-count').textContent()).toBe(history);
    }
    const beforeRenameOrder = (await layout(page)).order;
    const rename = resourceArea(page).getByLabel('폴더 이름', { exact: true });
    await rename.fill('짧음');
    await rename.evaluate((node) => node.focus({ preventScroll: true }));
    await positionWithoutFocusScroll(page);
    const beforeRename = await layout(page);
    await page.keyboard.press('Enter');
    await expect(folder(page, '짧음')).toHaveAttribute('aria-selected', 'true');
    await settleLayout(page);
    const afterRename = await layout(page);
    observations.push({
      operation: 'rename',
      name: '짧음',
      before: beforeRename,
      after: afterRename,
    });
    expectUnchangedLayout(beforeRename, afterRename);
    await expect(rename).toBeFocused();
    expect(afterRename.order).toEqual(beforeRenameOrder);
    await expect(target.locator('option:checked')).toHaveText('짧음');
    const metadata = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('jjal-resource-folders-v1')!) as {
          folders: { id: string; name: string }[];
          memberships: Record<string, string[]>;
        },
    );
    expect(metadata.folders.slice(0, seeded.length)).toEqual(seeded);
    expect(metadata.folders.slice(seeded.length).map(({ name }) => name)).toEqual([
      names[0],
      names[1],
      '짧음',
    ]);
    expect(metadata.memberships).toEqual({});
    expect(await frame(page)).toBe(pixels);
    expect(await page.locator('.toolbar-history-count').textContent()).toBe(history);
    const stored = await savedDocument(page, info, '긴 폴더명 후');
    expect(stored).toEqual(original);
    const output = await downloadPng(page, info, '긴 폴더명 출력');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
      timeout: 20_000,
    });
    await restore(page, '긴 폴더명 후');
    expect(await frame(page)).toBe(pixels);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem('jjal-resource-folders-v1')!)),
    ).toEqual({ version: 1, ...metadata });
    expect(errors).toEqual([]);
    await writeFile(
      info.outputPath('folder-layout-observations.json'),
      JSON.stringify({ viewport, observations, metadata, output, errors }, null, 2),
    );
  });
}
