import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StudioDocument } from '@jjal/document-model';
import {
  downloadPng,
  frame,
  goPage,
  rail,
  ready,
  restore,
  reveal,
  savedDocument,
  selectedLayer,
} from './sketch-controls';

const inputName = '그룹 선택 일관성 입력';
const text = '그룹 선택 검증 문구';
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;

async function fixture(page: Page, info: TestInfo) {
  const directory = process.env.GROUP_SELECTION_FIXTURE_DIR ?? info.outputDir;
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${info.project.name}-group-selection-input.json`);
  let exists = true;
  try {
    await access(filename);
  } catch {
    exists = false;
  }
  if (!exists) {
    await goPage(page, 'templates');
    await page
      .getByRole('region', { name: '기본 템플릿', exact: true })
      .getByRole('button', { name: '전후 비교', exact: true })
      .click();
    await goPage(page, 'elements');
    await page.getByRole('button', { name: '문구 추가', exact: true }).click();
    await (await reveal(page, '문구', 'text')).fill(text);
    await savedDocument(page, info, '선택 입력 원본');
    const backup = JSON.parse(await readFile(info.outputPath('선택 입력 원본.json'), 'utf8')) as {
      templates: { id: string; name: string; document: StudioDocument }[];
    };
    const template = backup.templates.find((item) => item.name === '선택 입력 원본')!;
    template.name = inputName;
    // This is a valid user JSON layer-order edit, using an actual exported document.
    // No implementation fault or invalid schema value is injected to manufacture failure.
    for (const panel of template.document.panels) {
      const border = template.document.elements.find(
        (element) => element.kind === 'frame' && panel.elementIds.includes(element.id),
      )!;
      panel.elementIds = [...panel.elementIds.filter((id) => id !== border.id), border.id];
    }
    await writeFile(filename, JSON.stringify(backup, null, 2));
  }
  const bytes = await readFile(filename);
  await writeFile(
    info.outputPath('same-input-sha256.json'),
    JSON.stringify({ filename, sha256: digest(bytes), bytes: bytes.length }, null, 2),
  );
  await goPage(page, 'library');
  await page.getByLabel('템플릿 JSON 파일', { exact: true }).setInputFiles(filename);
  await expect(page.getByLabel('저장된 템플릿', { exact: true })).toContainText(inputName);
  await restore(page, inputName);
  return { filename, sha256: digest(bytes) };
}

async function selection(page: Page, stage: string) {
  return rail(page)
    .locator('button')
    .evaluateAll((buttons, stage) => {
      const selected = buttons.filter((button) => button.getAttribute('aria-pressed') === 'true');
      const first = selected[0];
      const panelId = first?.getAttribute('data-panel-id');
      const groupId = first?.getAttribute('data-group-id');
      const expected = groupId
        ? buttons.filter(
            (button) =>
              button.getAttribute('data-panel-id') === panelId &&
              button.getAttribute('data-group-id') === groupId,
          )
        : selected;
      return {
        stage,
        panelId,
        groupId,
        selected: selected.map((button) => button.getAttribute('data-element-id')).sort(),
        expected: expected.map((button) => button.getAttribute('data-element-id')).sort(),
        selectedPanels: [
          ...new Set(selected.map((button) => button.getAttribute('data-panel-id'))),
        ],
      };
    }, stage);
}

test('불러오기·컷 전환·이력 이동에서 그룹 선택을 완전히 확장하고 새 요소·빈 선택·8비율을 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  await ready(page);
  const input = await fixture(page, info);
  const observations: Awaited<ReturnType<typeof selection>>[] = [];
  const verify = async (stage: string) => {
    const snapshot = await selection(page, stage);
    observations.push(snapshot);
    await writeFile(
      info.outputPath('selection-observations.json'),
      JSON.stringify({ input, observations }, null, 2),
    );
    expect.soft(snapshot.expected.length, `${stage}: grouped fixture`).toBeGreaterThanOrEqual(2);
    expect.soft(snapshot.selected, `${stage}: complete group`).toEqual(snapshot.expected);
    expect.soft(snapshot.selectedPanels, `${stage}: one cut only`).toHaveLength(1);
    return snapshot;
  };
  await verify('import/load');
  await goPage(page, 'layout');
  const cut = page.getByLabel('편집할 컷', { exact: true });
  await cut.selectOption({ index: 1 });
  const secondCut = await cut.inputValue();
  expect((await verify('switch to second cut')).panelId).toBe(secondCut);
  await cut.selectOption({ index: 0 });
  const firstCut = await cut.inputValue();
  const first = await verify('switch back to first cut');

  // Explicit clicks already expand groups. Re-grouping and then changing selection before
  // redo exposes history adoption's stale partial selection without changing source code.
  await rail(page).locator(`[data-element-id="${first.expected[0]}"]`).click();
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await rail(page)
    .getByRole('button', { name: new RegExp(`1컷 문구 · ${text}$`) })
    .click();
  await expect(selectedLayer(page)).toHaveCount(3);
  await page.getByRole('button', { name: '그룹 묶기', exact: true }).click();
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '다중 선택', exact: true }).click();
  await rail(page).locator(`[data-element-id="${first.expected[0]}"]`).click();
  await expect(selectedLayer(page)).toHaveCount(2);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  const restoredGroup = await verify('redo grows selected group');
  expect(restoredGroup.expected).toHaveLength(3);
  expect(restoredGroup.panelId).toBe(firstCut);

  const beforeAddition = await savedDocument(page, info, '일관성 그룹 추가 전');
  await goPage(page, 'elements');
  await page.getByRole('button', { name: '문구 추가', exact: true }).click();
  await expect(selectedLayer(page)).toHaveCount(1);
  const addedId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  await expect(selectedLayer(page)).not.toHaveAttribute('data-group-id');
  expect(beforeAddition.elements.some((element) => element.id === addedId)).toBe(false);
  const afterAddition = await savedDocument(page, info, '일관성 그룹 추가 후');
  for (const element of beforeAddition.elements)
    expect(afterAddition.elements.find((item) => item.id === element.id)).toEqual(element);
  for (const layout of beforeAddition.layouts)
    for (const panel of layout.panels)
      for (const placed of panel.elements)
        expect(
          afterAddition.layouts
            .find((item) => item.ratio === layout.ratio)!
            .panels.find((item) => item.panelId === panel.panelId)!
            .elements.find((item) => item.elementId === placed.elementId),
        ).toEqual(placed);

  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 해제', exact: true }).click();
  await expect(selectedLayer(page)).toHaveCount(0);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(selectedLayer(page)).toHaveCount(0);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(selectedLayer(page)).toHaveCount(0);
  const pixels = [];
  for (const ratio of ratios) {
    await goPage(page, 'layout');
    await page
      .getByRole('group', { name: '화면 비율', exact: true })
      .getByRole('button', { name: ratio, exact: true })
      .click();
    await expect(selectedLayer(page)).toHaveCount(0);
    pixels.push({
      ratio,
      comparison: await downloadPng(page, info, `selection-${ratio.replace(':', '-')}`),
    });
  }
  const final = await savedDocument(page, info, '일관성 최종');
  const beforeReload = await frame(page);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '일관성 최종');
  expect(await frame(page)).toBe(beforeReload);
  const afterReload = await savedDocument(page, info, '일관성 복원');
  expect(afterReload.layouts.map((layout) => layout.ratio)).toEqual(
    final.layouts.map((layout) => layout.ratio),
  );
  await writeFile(
    info.outputPath('selection-final.json'),
    JSON.stringify(
      { input, observations, pixels, groupSize: restoredGroup.expected.length, addedId },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('selection-consistency.png'), fullPage: true });
});
