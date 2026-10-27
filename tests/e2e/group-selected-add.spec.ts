import { expect, test } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
import {
  card,
  downloadPng,
  frame,
  goPage,
  rail,
  ready,
  reveal,
  restore,
  savedDocument,
  selectedLayer,
} from './sketch-controls';

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const creation = (page: Parameters<typeof goPage>[0], kind: '문구' | '말풍선') =>
  page
    .locator('.element-tools')
    .getByRole('button', { name: `${kind} 추가`, exact: true, includeHidden: true });

test('잠긴 두 번째 컷 그룹에서 문구·말풍선만 새로 선택하고 기존 그룹·8비율·이력·저장을 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await goPage(page, 'templates');
  await page.getByRole('button', { name: '전후 비교', exact: true }).click();
  const initial = await savedDocument(page, info, '그룹 추가 시작');
  const owner = initial.panels[1]!;
  const border = initial.elements.find(
    (item) => item.kind === 'frame' && owner.elementIds.includes(item.id),
  )!;
  const members = initial.elements.filter((item) => item.groupId === border.groupId);
  expect(members).toHaveLength(2);
  await rail(page).locator(`[data-element-id="${border.id}"]`).click();
  await expect(selectedLayer(page)).toHaveCount(2);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금', exact: true }).click();
  const baseline = await savedDocument(page, info, '잠긴 그룹 기준');
  let previous = baseline;
  const added: string[] = [];
  for (const kind of ['문구', '말풍선'] as const) {
    await rail(page).locator(`[data-element-id="${border.id}"]`).click();
    await expect(selectedLayer(page)).toHaveCount(2);
    await goPage(page, 'elements');
    await expect(creation(page, kind)).toBeEnabled();
    await expect(page.getByLabel('요소 회전', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('추가할 캐릭터', { exact: true })).toBeDisabled();
    const before = await frame(page);
    await creation(page, kind).click();
    await expect(selectedLayer(page)).toHaveCount(1);
    const id = (await selectedLayer(page).getAttribute('data-element-id'))!;
    const after = await savedDocument(page, info, `그룹에서 ${kind} 추가`);
    expect(after.elements).toHaveLength(previous.elements.length + 1);
    const next = after.elements.find((item) => item.id === id)!;
    expect(next.kind).toBe(kind === '문구' ? 'text' : 'bubble');
    expect(next.groupId).toBeUndefined();
    expect(next.locked).toBe(false);
    expect(after.panels[1]!.elementIds).toContain(id);
    expect(after.panels[0]!.elementIds).not.toContain(id);
    for (const member of members) {
      expect(after.elements.find((item) => item.id === member.id)).toEqual(
        baseline.elements.find((item) => item.id === member.id),
      );
      for (const layout of baseline.layouts) {
        const placement = layout.panels[1]!.elements.find((item) => item.elementId === member.id);
        expect(
          after.layouts
            .find((item) => item.ratio === layout.ratio)!
            .panels[1]!.elements.find((item) => item.elementId === member.id),
        ).toEqual(placement);
      }
    }
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    await expect(rail(page).locator(`[data-element-id="${id}"]`)).toHaveCount(0);
    expect(await frame(page)).toBe(before);
    await page.getByRole('button', { name: '다시 실행', exact: true }).click();
    await expect(rail(page).locator(`[data-element-id="${id}"]`)).toHaveCount(1);
    previous = after;
    added.push(id);
  }
  const previews = new Map<string, string>();
  for (const ratio of ratios) {
    await goPage(page, 'layout');
    await page.getByRole('button', { name: ratio, exact: true }).click();
    previews.set(ratio, await frame(page));
  }
  const final = await savedDocument(page, info, '그룹 추가 최종');
  expect(final.layouts).toHaveLength(8);
  for (const layout of final.layouts)
    for (const id of added)
      expect(layout.panels[1]!.elements.some((item) => item.elementId === id)).toBe(true);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '그룹 추가 최종');
  const restored = await savedDocument(page, info, '그룹 추가 복원 검증');
  expect(restored.elements.filter((item) => item.groupId && item.locked)).toHaveLength(2);
  expect(
    new Set(restored.elements.filter((item) => item.groupId).map((item) => item.groupId)).size,
  ).toBe(2);
  const pixels = [];
  for (const ratio of ratios) {
    await goPage(page, 'layout');
    await page.getByRole('button', { name: ratio, exact: true }).click();
    expect(await frame(page)).toBe(previews.get(ratio));
    pixels.push({
      ratio,
      comparison: await downloadPng(page, info, `approved-add-${ratio.replace(':', '-')}`),
    });
  }
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('approved-group-add.json'),
    JSON.stringify({ added: 2, groupCount: 2, pixels, errors }, null, 2),
  );
  await page.screenshot({ path: info.outputPath('group-add-restored.png'), fullPage: true });
});

test('비그룹 다중 선택·조합 중·보기 전용의 생성 제한을 유지한다', async ({ page }) => {
  await ready(page);
  const initial = await rail(page)
    .locator('[data-group-id]')
    .first()
    .getAttribute('data-element-id');
  const text = rail(page).getByRole('button', { name: /문구/ }).first();
  await rail(page).locator(`[data-element-id="${initial}"]`).click();
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await text.click();
  await expect(selectedLayer(page)).toHaveCount(3);
  await goPage(page, 'elements');
  await expect(creation(page, '문구')).toBeDisabled();
  await expect(creation(page, '말풍선')).toBeDisabled();
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await text.click();
  await expect(selectedLayer(page)).toHaveCount(1);
  const caption = await reveal(page, '문구', 'text');
  await caption.dispatchEvent('compositionstart', { data: '검' });
  await expect(creation(page, '문구')).toBeDisabled();
  await expect(creation(page, '말풍선')).toBeDisabled();
  await caption.dispatchEvent('compositionend', { data: '' });
  await page.goto('/?view=readonly');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await expect(creation(page, '문구')).toBeDisabled();
  await expect(creation(page, '말풍선')).toBeDisabled();
});

test('컷의 실제 요소 한도에서 추가가 거부돼도 그룹 선택·작업·이력을 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await ready(page);
  await savedDocument(page, info, '한도 기반');
  const backup = JSON.parse(await readFile(info.outputPath('한도 기반.json'), 'utf8')) as {
    templates: { id: string; name: string; document: StudioDocument }[];
  };
  const template = backup.templates[0]!;
  template.id = 'approved-group-add-quota';
  template.name = '요소 한도 기준';
  const doc = template.document;
  const original = doc.elements.find((item) => item.kind === 'text')!;
  const copies = Array.from({ length: 100 }, (_, index) => ({
    ...structuredClone(original),
    id: `quota-text-${index}`,
  }));
  doc.elements = [...doc.elements.filter((item) => item.id !== original.id), ...copies];
  doc.panels[0]!.elementIds = [
    ...doc.panels[0]!.elementIds.filter((id) => id !== original.id),
    ...copies.map((item) => item.id),
  ];
  for (const layout of doc.layouts) {
    const panel = layout.panels[0]!;
    const source = panel.elements.find((item) => item.elementId === original.id)!;
    panel.elements = [
      ...panel.elements.filter((item) => item.elementId !== original.id),
      ...copies.map((item) => ({ ...structuredClone(source), elementId: item.id })),
    ];
  }
  await page.getByLabel('템플릿 JSON 파일', { exact: true }).setInputFiles({
    name: 'valid-quota-template.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByLabel('저장된 템플릿', { exact: true })).toContainText('요소 한도 기준');
  await restore(page, '요소 한도 기준');
  const full = await savedDocument(page, info, '한도 불러오기');
  expect(full.elements).toHaveLength(102);
  const border = full.elements.find((item) => item.kind === 'frame')!;
  await rail(page).locator(`[data-element-id="${border.id}"]`).click();
  const ids = await selectedLayer(page).evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-element-id')),
  );
  expect(ids).toHaveLength(2);
  const before = await frame(page);
  await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled();
  for (const kind of ['문구', '말풍선'] as const) {
    await goPage(page, 'elements');
    await expect(creation(page, kind)).toBeEnabled();
    await creation(page, kind).click();
    await expect(page.locator('.studio-error')).toContainText('기존 작업');
    expect(
      await selectedLayer(page).evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-element-id')),
      ),
    ).toEqual(ids);
    expect(await frame(page)).toBe(before);
    await expect(page.getByRole('button', { name: '실행 취소', exact: true })).toBeDisabled();
    expect(await savedDocument(page, info, `한도 실패 보존 ${kind}`)).toEqual(full);
  }
  await expect(card(page)).toBeVisible();
});
