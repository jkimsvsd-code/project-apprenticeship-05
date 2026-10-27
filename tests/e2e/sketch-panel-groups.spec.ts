import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  downloadPng,
  frame,
  goPage,
  number,
  rail,
  ready,
  restore,
  reveal,
  savedDocument,
  selectedLayer,
  setColor,
} from './sketch-controls';

test('컷 배경·테두리 기본 그룹의 이동·잠금·해제·재그룹·복제와 8비율 저장 출력을 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await ready(page);
  await goPage(page, 'templates');
  await page
    .getByRole('region', { name: '기본 템플릿', exact: true })
    .getByRole('button', { name: '전후 비교', exact: true })
    .click();
  const initial = await savedDocument(page, info, '컷 그룹 시작');
  expect(initial.layeredPanelBackgrounds).toBe(true);
  for (const panel of initial.panels) {
    const background = initial.elements.find(
      (item) => item.kind === 'panel-background' && panel.elementIds.includes(item.id),
    )!;
    const border = initial.elements.find(
      (item) => item.kind === 'frame' && panel.elementIds.includes(item.id),
    )!;
    expect(background.groupId).toBeTruthy();
    expect(border.groupId).toBe(background.groupId);
  }
  const owner = initial.panels[0]!;
  const bg = initial.elements.find(
    (item) => item.kind === 'panel-background' && owner.elementIds.includes(item.id),
  )!;
  const border = initial.elements.find(
    (item) => item.kind === 'frame' && owner.elementIds.includes(item.id),
  )!;
  await rail(page).locator(`[data-element-id="${border.id}"]`).click();
  await expect(selectedLayer(page)).toHaveCount(2);
  await goPage(page, 'layers');
  const beforeMove = await frame(page);
  await number(page, '선택 묶음 가로 이동', 3, 'layers');
  await expect.poll(() => frame(page)).not.toBe(beforeMove);
  const moved = await savedDocument(page, info, '컷 그룹 이동');
  for (const id of [bg.id, border.id]) {
    const start = initial.layouts[0]!.panels[0]!.elements.find(
      (item) => item.elementId === id,
    )!.transform;
    const after = moved.layouts[0]!.panels[0]!.elements.find(
      (item) => item.elementId === id,
    )!.transform;
    expect(after.x - start.x).toBeCloseTo(0.03, 6);
  }
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect.poll(() => frame(page)).toBe(beforeMove);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금', exact: true }).click();
  const locked = await savedDocument(page, info, '컷 그룹 잠금');
  expect(
    locked.elements.filter((item) => item.groupId === bg.groupId).every((item) => item.locked),
  ).toBe(true);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
  await page.getByRole('button', { name: '그룹 해제', exact: true }).click();
  await rail(page).locator(`[data-element-id="${bg.id}"]`).click();
  await expect(selectedLayer(page)).toHaveCount(1);
  await goPage(page, 'background');
  await page.getByLabel('배경 적용 범위', { exact: true }).selectOption('panel');
  const upload = await reveal(page, '배경 원본 파일', 'background');
  await upload.setInputFiles('tests/fixtures/images/portrait.png');
  await expect(upload).toBeEnabled();
  await number(page, '배경 확대', 130, 'background');
  await number(page, '배경 가로 위치', 8, 'background');
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await rail(page).locator(`[data-element-id="${border.id}"]`).click();
  await expect(selectedLayer(page)).toHaveCount(2);
  await page.getByRole('button', { name: '그룹 묶기', exact: true }).click();
  const regrouped = await savedDocument(page, info, '컷 재그룹');
  const originalGroup = regrouped.elements.find((item) => item.id === bg.id)!.groupId;
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 복제', exact: true }).click();
  await expect(selectedLayer(page)).toHaveCount(2);
  const copied = await savedDocument(page, info, '컷 그룹 복제');
  const copies = copied.elements.filter(
    (item) => !regrouped.elements.some((old) => old.id === item.id),
  );
  expect(copies.map((item) => item.kind).sort()).toEqual(['frame', 'panel-background']);
  expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
  expect(copies[0]!.groupId).not.toBe(originalGroup);
  const copyBackground = copies.find((item) => item.kind === 'panel-background')!;
  if (copyBackground.kind !== 'panel-background') throw new Error('Copied background missing');
  expect(copyBackground.background.imageAssetId).toBeTruthy();
  expect(copied.assets.some((asset) => asset.id === copyBackground.background.imageAssetId)).toBe(
    true,
  );
  const originalPlacement = copied.layouts[0]!.panels[0]!.elements.find(
    (item) => item.elementId === bg.id,
  )!;
  const copiedPlacement = copied.layouts[0]!.panels[0]!.elements.find(
    (item) => item.elementId === copyBackground.id,
  )!;
  expect(copiedPlacement.background).toEqual(originalPlacement.background);
  const beforeReload = await frame(page);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '컷 그룹 복제');
  await expect.poll(() => frame(page)).toBe(beforeReload);
  const restored = await savedDocument(page, info, '그룹 새 ID 복원');
  const grouped = restored.elements.filter((item) => item.groupId);
  expect(new Set(grouped.map((item) => item.groupId)).size).toBe(3);
  expect(
    grouped.every((item) => !copied.elements.some((old) => old.groupId === item.groupId)),
  ).toBe(true);
  const pixels = [];
  for (const ratio of ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9']) {
    await goPage(page, 'layout');
    await page
      .getByRole('group', { name: '화면 비율', exact: true })
      .getByRole('button', { name: ratio, exact: true })
      .click();
    pixels.push({
      ratio,
      comparison: await downloadPng(page, info, `panel-group-${ratio.replace(':', '-')}`),
    });
  }
  await writeFile(
    info.outputPath('panel-groups-observations.json'),
    JSON.stringify(
      { groupCount: 3, sourceAsset: copyBackground.background.imageAssetId, pixels },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('panel-groups-restored.png'), fullPage: true });
});

test('기본 배경은 비레이어로 유지하고 컷 배경은 숨김·상속·원본 복귀·삭제 후 명시 재생성한다', async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await ready(page);
  await goPage(page, 'background');
  await page.getByLabel('배경 적용 범위', { exact: true }).selectOption('whole');
  await setColor(page, '배경 색상', '#0047AB', 'background');
  const base = await savedDocument(page, info, '기본 배경');
  expect(base.background?.color).toBe('#0047ab');
  expect(base.elements.filter((item) => item.kind === 'panel-background')).toHaveLength(1);
  const bg = base.elements.find((item) => item.kind === 'panel-background')!;
  if (bg.kind !== 'panel-background') throw new Error('Background missing');
  expect(bg.background.inherit).toBe(true);
  await rail(page).locator(`[data-element-id="${bg.id}"]`).click();
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '그룹 해제', exact: true }).click();
  await rail(page).locator(`[data-element-id="${bg.id}"]`).click();
  await goPage(page, 'background');
  await page.getByLabel('배경 적용 범위', { exact: true }).selectOption('panel');
  await page.getByRole('button', { name: '이 컷에서 독립 편집', exact: true }).click();
  await setColor(page, '배경 색상', '#E6AB5E', 'background');
  const ownFrame = await frame(page);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 숨김', exact: true }).click();
  expect(await frame(page)).not.toBe(ownFrame);
  await page.getByRole('button', { name: '선택 숨김 해제', exact: true }).click();
  expect(await frame(page)).toBe(ownFrame);
  await goPage(page, 'background');
  const upload = await reveal(page, '배경 원본 파일', 'background');
  await upload.setInputFiles('tests/fixtures/images/portrait.png');
  await expect(upload).toBeEnabled();
  const original = await frame(page);
  await upload.setInputFiles({
    name: 'invalid.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('invalid'),
  });
  await expect(page.locator('.studio-error')).toBeVisible();
  expect(await frame(page)).toBe(original);
  await page.getByRole('button', { name: '이 컷에 전체 배경 사용', exact: true }).click();
  expect(await frame(page)).not.toBe(original);
  await page.getByRole('button', { name: '보관된 컷 배경 복원', exact: true }).click();
  expect(await frame(page)).toBe(original);
  await rail(page).locator(`[data-element-id="${bg.id}"]`).click();
  await page.keyboard.press('Delete');
  await expect(rail(page).getByRole('button', { name: /컷 배경/ })).toHaveCount(0);
  const deleted = await savedDocument(page, info, '컷 배경 삭제');
  expect(deleted.layeredPanelBackgrounds).toBe(true);
  expect(deleted.assets).toHaveLength(0);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '컷 배경 삭제');
  await expect(rail(page).getByRole('button', { name: /컷 배경/ })).toHaveCount(0);
  await goPage(page, 'background');
  await page.getByLabel('배경 적용 범위', { exact: true }).selectOption('panel');
  await expect(rail(page).getByRole('button', { name: /컷 배경/ })).toHaveCount(0);
  await setColor(page, '배경 색상', '#D7CEAE', 'background');
  await expect(rail(page).getByRole('button', { name: /컷 배경/ })).toHaveCount(1);
  const recreated = await savedDocument(page, info, '명시 컷 배경 추가');
  expect(
    recreated.elements.find((item) => item.kind === 'panel-background')?.groupId,
  ).toBeUndefined();
  await downloadPng(page, info, 'panel-background-recreated');
});
