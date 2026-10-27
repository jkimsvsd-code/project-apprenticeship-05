import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StudioDocument } from '@jjal/document-model';
import {
  activate,
  card,
  frame,
  goPage,
  library,
  loadSelected,
  number,
  openResources,
  rail,
  ready,
  resources,
  reveal,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

const captionText = '선택 전환 문구';
const addText = (page: Page) =>
  page.locator('.quick-add-bar').getByRole('button', { name: '문구 추가', exact: true });
const rotation = (page: Page) => page.getByRole('button', { name: '요소 회전 조절', exact: true });

/** Reuse the actual exported JSON file across the before/after runs when a fixture dir is supplied. */
async function fixture(page: Page, info: TestInfo, kind: 'text' | 'image') {
  const directory =
    process.env.EDITORIAL_SELECTION_FIXTURE_DIR ?? info.outputPath('selection-inputs');
  await mkdir(directory, { recursive: true });
  const filename = path.join(directory, `${info.project.name}-${kind}.json`);
  let exists = true;
  try {
    await access(filename);
  } catch {
    exists = false;
  }
  if (!exists) {
    await activate(addText(page), info.project.use.isMobile === true);
    await (await reveal(page, '문구', 'text')).fill(captionText);
    for (const [label, value] of [
      ['요소 폭', 30],
      ['요소 높이', 18],
      ['요소 가로 위치', 10],
      ['요소 세로 위치', 10],
    ] as const)
      await number(page, label, value);
    await openResources(page);
    await resources(page).getByRole('tab', { name: '미분류', exact: true }).click();
    await resources(page)
      .getByLabel('자원 이미지 파일', { exact: true })
      .setInputFiles('tests/fixtures/images/portrait.png');
    const resource = resources(page).locator('button[data-resource-id]');
    await expect(resource).toHaveCount(1);
    await activate(resource, info.project.use.isMobile === true);
    await expect(selectedLayer(page)).toHaveAttribute('aria-label', /이미지/);
    for (const [label, value] of [
      ['요소 폭', 25],
      ['요소 높이', 25],
      ['요소 가로 위치', 55],
      ['요소 세로 위치', 55],
    ] as const)
      await number(page, label, value);
    await (
      await reveal(page, '배경 원본 파일', 'background')
    ).setInputFiles('tests/fixtures/images/landscape.jpg');
    await expect(page.getByLabel('배경 드래그 모드', { exact: true })).toBeEnabled();
    await number(page, '배경 확대', 170, 'background');
    const exported = await saveDocument(page, info, `선택 전환 입력 ${kind}`);
    await copyFile(exported.path, filename);
  }
  const bytes = await readFile(filename);
  await writeFile(
    info.outputPath('selection-input-sha256.json'),
    JSON.stringify(
      {
        filename,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      null,
      2,
    ),
  );
  await goPage(page, 'library');
  const select = library(page).getByLabel('저장된 템플릿', { exact: true });
  const before = await select
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  await library(page).getByLabel('템플릿 JSON 파일', { exact: true }).setInputFiles(filename);
  await expect(library(page).getByRole('status')).toContainText('새 사본으로 가져왔습니다');
  const after = await select
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  const imported = after.filter((id) => id && !before.includes(id));
  expect(imported).toHaveLength(1);
  await select.selectOption(imported[0]!);
  await loadSelected(page);
  return (await saveDocument(page, info, `선택 전환 준비 ${kind}`)).document;
}

async function drag(page: Page, touch: boolean, doc: StudioDocument, id: string) {
  const placement = doc.layouts
    .find((layout) => layout.ratio === '1:1')!
    .panels[0]!.elements.find((element) => element.elementId === id)!.transform;
  await card(page).scrollIntoViewIfNeeded();
  const box = (await card(page).boundingBox())!;
  const start = {
    x: box.x + (placement.x + placement.width / 2) * box.width,
    y: box.y + (placement.y + placement.height / 2) * box.height,
  };
  const end = { x: start.x + 14, y: start.y + 12 };
  const hit = await page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return { tag: element?.tagName, label: element?.getAttribute('aria-label') };
  }, start);
  expect(hit).toEqual({ tag: 'CANVAS', label: '카드 1:1 비율' });
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      await page.waitForTimeout(600);
      for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: start.x + 14 * fraction, y: start.y + 12 * fraction, id: 1 }],
        });
        await page.evaluate(
          () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        );
      }
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await client.detach();
    }
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 5 });
    await page.mouse.up();
  }
  return {
    x: 14 / box.width,
    y: 12 / box.height,
    cssPixelTolerance: 1 / Math.min(box.width, box.height) + 0.0001,
  };
}

for (const kind of ['text', 'image'] as const)
  test(`배경 드래그 후 ${kind} 레이어 선택은 일반 편집을 복구하고 배경 대신 선택 요소만 이동한다`, async ({
    page,
    isMobile,
  }, info) => {
    test.setTimeout(120_000);
    await ready(page);
    const baseline = await fixture(page, info, kind);
    const target = baseline.elements.find((element) =>
      kind === 'text'
        ? element.kind === 'text' && element.text === captionText
        : element.kind === 'image',
    )!;
    expect(target).toBeDefined();
    await rail(page).locator(`[data-element-id="${target.id}"]`).click();
    await goPage(page, 'elements');
    await page.getByRole('checkbox', { name: '정렬선과 자동 맞춤', exact: true }).uncheck();
    const mode = await reveal(page, '배경 드래그 모드', 'background');
    await mode.check();
    await expect(mode).toBeChecked();
    await rail(page).locator(`[data-element-id="${target.id}"]`).click();
    await expect(selectedLayer(page)).toHaveAttribute('data-element-id', target.id);
    await expect(
      page.locator(`[data-tool-page="${kind === 'text' ? 'text' : 'elements'}"]`),
    ).toHaveAttribute('aria-hidden', 'false');
    // Assertion intentionally runs before navigation: opening another tool must not mask stale mode.
    await expect(mode).not.toBeChecked();
    await expect(rotation(page)).toBeEnabled();
    await expect(page.getByRole('button', { name: /^요소 크기 조절 / })).toHaveCount(4);
    const before = await frame(page);
    const delta = await drag(page, isMobile, baseline, target.id);
    const moved = (await saveDocument(page, info, `선택 후 이동 ${kind}`)).document;
    const beforePlacement = baseline.layouts
      .find((layout) => layout.ratio === '1:1')!
      .panels[0]!.elements.find((element) => element.elementId === target.id)!.transform;
    const afterPlacement = moved.layouts
      .find((layout) => layout.ratio === '1:1')!
      .panels[0]!.elements.find((element) => element.elementId === target.id)!.transform;
    expect(Math.abs(afterPlacement.x - beforePlacement.x - delta.x)).toBeLessThan(
      delta.cssPixelTolerance,
    );
    expect(Math.abs(afterPlacement.y - beforePlacement.y - delta.y)).toBeLessThan(
      delta.cssPixelTolerance,
    );
    expect(
      Math.hypot(afterPlacement.x - beforePlacement.x, afterPlacement.y - beforePlacement.y),
    ).toBeGreaterThan(0.01);
    for (const layout of baseline.layouts) {
      const actual = moved.layouts.find((item) => item.ratio === layout.ratio)!;
      expect(actual.background).toEqual(layout.background);
      for (const panel of layout.panels) {
        const nextPanel = actual.panels.find((item) => item.panelId === panel.panelId)!;
        expect(nextPanel.background).toEqual(panel.background);
        for (const element of panel.elements)
          if (element.elementId !== target.id || layout.ratio !== '1:1')
            expect(nextPanel.elements.find((item) => item.elementId === element.elementId)).toEqual(
              element,
            );
      }
    }
    expect(moved.elements).toEqual(baseline.elements);
    expect(moved.background).toEqual(baseline.background);
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    expect(await frame(page)).toBe(before);
    await page.getByRole('button', { name: '다시 실행', exact: true }).click();
    const redone = (await saveDocument(page, info, `선택 이동 다시 실행 ${kind}`)).document;
    expect(redone).toEqual(moved);
    await writeFile(
      info.outputPath(`selection-guard-${kind}.json`),
      JSON.stringify(
        {
          kind,
          targetId: target.id,
          backgroundModeCleared: true,
          otherPlacementsPreserved: true,
          oneGestureUndoRedo: true,
          delta,
        },
        null,
        2,
      ),
    );
  });

test('직접 문구 편집·조합 중에는 빠른 추가를 차단하고 취소 및 추가 실행 취소가 기존 작업을 보존한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(90_000);
  await ready(page);
  await activate(addText(page), isMobile);
  await (await reveal(page, '문구', 'text')).fill('직접 편집 보호 문구');
  const baseline = (await saveDocument(page, info, '직접 편집 보호 기준')).document;
  const before = await frame(page);
  const ids = await rail(page)
    .locator('[data-element-id]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-element-id')));
  await page
    .locator('.canvas-contextbar')
    .getByRole('button', { name: '내용 수정', exact: true })
    .click();
  const input = page.getByRole('textbox', { name: '카드 문구 직접 편집', exact: true });
  await expect(input).toBeVisible();
  await input.dispatchEvent('compositionstart', { data: '조' });
  await input.fill('조합 중 임시 문구');
  await expect(input).toHaveValue('조합 중 임시 문구');
  await expect(addText(page)).toBeDisabled();
  await expect(
    page.locator('.quick-add-bar').getByRole('button', { name: '말풍선 추가', exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator('.inline-edit-actions').getByRole('button', { name: '완료', exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator('.inline-edit-actions').getByRole('button', { name: '취소', exact: true }),
  ).toBeDisabled();
  await addText(page).evaluate((button) => (button as HTMLButtonElement).click());
  expect(
    await rail(page)
      .locator('[data-element-id]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-element-id'))),
  ).toEqual(ids);
  expect(await frame(page)).toBe(before);
  await input.dispatchEvent('compositionend', { data: '문구' });
  await page
    .locator('.inline-edit-actions')
    .getByRole('button', { name: '취소', exact: true })
    .click();
  await expect(input).toHaveCount(0);
  expect((await saveDocument(page, info, '직접 편집 취소 확인')).document).toEqual(baseline);
  await activate(addText(page), isMobile);
  const newId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  expect(ids).not.toContain(newId);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(rail(page).locator(`[data-element-id="${newId}"]`)).toHaveCount(0);
  expect(await frame(page)).toBe(before);
  expect((await saveDocument(page, info, '빠른 추가 실행 취소 확인')).document).toEqual(baseline);
});
