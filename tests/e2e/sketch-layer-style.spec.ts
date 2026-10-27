import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import {
  card,
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
} from './sketch-controls';

async function hold(page: Page, point: { x: number; y: number }) {
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
}

test('선택 해제·최상단 재선택과 키보드/터치 메뉴 삭제·컷 테두리 복원', async ({ page }, info) => {
  test.setTimeout(90_000);
  await ready(page);
  const layers = rail(page).locator('[data-layer-id]');
  await expect(layers).toHaveCount(3);
  const canvas = card(page);
  await canvas.click({ position: { x: 45, y: 45 } });
  await expect(selectedLayer(page)).toHaveCount(0);
  await rail(page).locator('[data-element-id="line-1"]').click();
  await expect(selectedLayer(page)).toHaveAttribute('data-element-id', 'line-1');
  const resources = page
    .getByRole('region', { name: '자원그룹', exact: true })
    .locator('[data-resource-id]');
  await resources.nth(0).click();
  await resources.nth(1).click();
  await expect(layers).toHaveCount(5);
  const top = (await selectedLayer(page).getAttribute('data-element-id'))!;
  await rail(page).locator('[data-element-id="line-1"]').click();
  const layout = await savedDocument(page, info, '선택 테스트');
  const placed = layout.layouts.find((item) => item.ratio === layout.activeRatio)!.panels[0]!;
  const t = placed.elements.find((item) => item.elementId === top)!.transform;
  await canvas.scrollIntoViewIfNeeded();
  const bounds = (await canvas.boundingBox())!;
  const point = {
    x: bounds.x + (placed.rect.x + (t.x + t.width / 2) * placed.rect.width) * bounds.width,
    y: bounds.y + (placed.rect.y + (t.y + t.height * 0.2) * placed.rect.height) * bounds.height,
  };
  await page.mouse.click(point.x, point.y);
  await expect(selectedLayer(page)).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  await expect(selectedLayer(page)).toHaveAttribute('data-element-id', top);
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금', exact: true }).click();
  await card(page).click({ position: { x: 45, y: 45 } });
  await expect(selectedLayer(page)).toHaveCount(0);
  await card(page).scrollIntoViewIfNeeded();
  const lockedBounds = (await card(page).boundingBox())!;
  const lockedPoint = {
    x: lockedBounds.x + ((point.x - bounds.x) / bounds.width) * lockedBounds.width,
    y: lockedBounds.y + ((point.y - bounds.y) / bounds.height) * lockedBounds.height,
  };
  await page.mouse.click(lockedPoint.x, lockedPoint.y);
  await expect(selectedLayer(page)).toHaveAttribute('data-element-id', top);
  await page.keyboard.press('Delete');
  await expect(layers).toHaveCount(5);
  await expect(page.locator('.studio-error')).toContainText('잠');
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
  await card(page).scrollIntoViewIfNeeded();
  const deletionBounds = (await card(page).boundingBox())!;
  const deletionPoint = {
    x: deletionBounds.x + ((point.x - bounds.x) / bounds.width) * deletionBounds.width,
    y: deletionBounds.y + ((point.y - bounds.y) / bounds.height) * deletionBounds.height,
  };
  if (info.project.name.startsWith('mobile')) {
    await hold(page, deletionPoint);
    const menu = page.getByRole('group', { name: '선택 레이어 메뉴', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: '레이어지우기', exact: true })).toHaveCSS(
      'border-top-width',
      '0px',
    );
    await menu.getByRole('button', { name: '레이어지우기', exact: true }).click();
  } else await page.keyboard.press('Delete');
  await expect(layers).toHaveCount(4);
  await expect(selectedLayer(page)).toHaveCount(0);
  const border = rail(page).getByRole('button', { name: /컷 영역 상자/ });
  await border.click();
  const before = await frame(page);
  if (info.project.name.startsWith('mobile')) {
    const rect = (await border.boundingBox())!;
    await hold(page, { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    await page.getByRole('button', { name: '레이어지우기', exact: true }).click();
  } else await page.keyboard.press('Delete');
  await expect(border).toHaveCount(0);
  await expect.poll(() => frame(page)).not.toBe(before);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(border).toHaveCount(1);
  await expect.poll(() => frame(page)).toBe(before);
  await page.getByRole('button', { name: '다시 실행', exact: true }).click();
  await expect(border).toHaveCount(0);
  const deleted = await savedDocument(page, info, '테두리 삭제');
  expect(deleted.frameLayers).toBe(true);
  expect(deleted.elements.some((element) => element.kind === 'frame')).toBe(false);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '테두리 삭제');
  await expect(rail(page).getByRole('button', { name: /컷 영역 상자/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('deleted-frame-restored.png'), fullPage: true });
});

test('긴 문구 전체·1.5배 상자·8개 비율과 IME 중 가로화면 전환을 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await ready(page);
  const text = '긴 문구의 모든 글자가 보여야 합니다. '.repeat(24) + '\n마지막 줄까지 확인합니다.';
  const input = await reveal(page, '문구', 'text');
  await input.fill(text);
  const document = await savedDocument(page, info, '긴 문구');
  const element = document.elements.find((item) => item.id === 'line-1');
  expect(element?.kind).toBe('text');
  if (element?.kind !== 'text') throw new Error('Text is missing');
  expect(element.text).toBe(text);
  expect(element.boxPaddingRatio).toBe(1 / 6);
  const observations = [];
  for (const ratio of ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9']) {
    await goPage(page, 'layout');
    await page
      .getByRole('group', { name: '화면 비율', exact: true })
      .getByRole('button', { name: ratio, exact: true })
      .click();
    const size = await card(page).evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
    }));
    const placement = document.layouts.find((item) => item.ratio === ratio)!.panels[0]!;
    const t = placement.elements.find((item) => item.elementId === element.id)!.transform;
    const metrics = await page.evaluate(
      ({ element, t, placement, size }) => {
        const ctx = window.document.createElement('canvas').getContext('2d')!;
        const family =
          element.style.font.kind === 'builtin' ? element.style.font.family : 'Noto Sans KR';
        ctx.font = `${element.style.bold ? 700 : 400} ${element.style.fontSize}px "${family}"`;
        ctx.textBaseline = 'top';
        const width = t.width * placement.rect.width * size.width;
        const height = t.height * placement.rect.height * size.height;
        const stroke = Math.ceil((element.contour?.width ?? element.style.outline?.width ?? 0) / 2);
        const availableWidth = (width * 2) / 3 - stroke * 2;
        const availableHeight = (height * 2) / 3 - stroke * 2;
        const lines: string[] = [];
        for (const paragraph of element.text.split('\n')) {
          let line = '';
          for (const { segment } of new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(
            paragraph,
          )) {
            if (line && ctx.measureText(line + segment).width > availableWidth) {
              lines.push(line);
              line = '';
            }
            line += segment;
          }
          lines.push(line);
        }
        const offset = Math.max(
          0,
          ...lines.map((line) => ctx.measureText(line).actualBoundingBoxAscent),
        );
        const maxBottom = Math.max(
          ...lines.map(
            (line, index) =>
              offset +
              index * element.style.fontSize * element.style.lineHeight +
              ctx.measureText(line).actualBoundingBoxDescent,
          ),
        );
        return {
          width,
          height,
          availableWidth,
          availableHeight,
          maxBottom,
          maxAdvance: Math.max(...lines.map((line) => ctx.measureText(line).width)),
          lineCount: lines.length,
          fullContent: lines.join('') === element.text.replaceAll('\n', ''),
          inside: t.x >= 0 && t.y >= 0 && t.x + t.width <= 1.000001 && t.y + t.height <= 1.000001,
        };
      },
      { element, t, placement, size },
    );
    expect(metrics.fullContent).toBe(true);
    expect(metrics.inside).toBe(true);
    expect(metrics.maxAdvance).toBeLessThanOrEqual(metrics.availableWidth + 0.05);
    expect(metrics.maxBottom).toBeLessThanOrEqual(metrics.availableHeight + 0.05);
    const pixels = await downloadPng(page, info, `long-text-${ratio.replace(':', '-')}`);
    observations.push({ ratio, metrics, pixels });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const composing = await reveal(page, '문구', 'text');
  await composing.dispatchEvent('compositionstart');
  await composing.fill('한글 조합 유지');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('.studio-shell')).not.toHaveClass(/is-wide/);
  await expect(composing).toHaveValue('한글 조합 유지');
  await composing.dispatchEvent('compositionend');
  await expect(page.locator('.studio-shell')).toHaveClass(/is-wide/);
  await expect(page.locator('[data-tool-page="text"] #caption')).toHaveValue('한글 조합 유지');
  await writeFile(
    info.outputPath('long-text-observations.json'),
    JSON.stringify(
      { fontSize: element.style.fontSize, observations, compositionPreserved: true },
      null,
      2,
    ),
  );
});

test('텍스트·이미지·캐릭터·말풍선·컷 상자의 세 질감과 HEX·두께·저장·PNG를 검증한다', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await ready(page);
  await page.getByRole('tab', { name: '미분류', exact: true }).click();
  await page
    .getByLabel('자원 이미지 파일', { exact: true })
    .setInputFiles('tests/fixtures/images/portrait.png');
  await page.getByRole('button', { name: 'portrait.png 배치', exact: true }).click();
  await goPage(page, 'elements');
  await page
    .locator('[data-tool-page="elements"] summary')
    .filter({ hasText: /^캐릭터 추가$/ })
    .click();
  await page.getByRole('button', { name: '캐릭터 추가', exact: true }).click();
  await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
  const initial = await savedDocument(page, info, '외곽 시작');
  const evidence = [];
  let corner = 0;
  for (const kind of ['text', 'image', 'character', 'bubble', 'frame']) {
    const element = initial.elements.find((item) => item.kind === kind)!;
    await rail(page).locator(`[data-element-id="${element.id}"]`).click();
    if (kind !== 'frame') {
      await number(page, '요소 가로 위치', corner % 2 ? 60 : 10);
      await number(page, '요소 세로 위치', corner < 2 ? 10 : 60);
      await number(page, '요소 폭', 25);
      await number(page, '요소 높이', 25);
      corner++;
    }
    await goPage(page, 'style');
    const hex = page.getByLabel('외곽 색 (HEX)', { exact: true });
    await hex.fill('#0047AB');
    await hex.press('Enter');
    await number(page, '외곽 두께', 8, 'style');
    const hashes = [];
    for (const texture of ['pen', 'pencil', 'paint']) {
      await goPage(page, 'style');
      await page.getByLabel('외곽 질감', { exact: true }).selectOption(texture);
      hashes.push(await frame(page));
      const pixels = await downloadPng(page, info, `contour-${kind}-${texture}`);
      evidence.push({ kind, texture, pixels });
    }
    expect(new Set(hashes).size).toBe(3);
  }
  await goPage(page, 'style');
  const before = await frame(page);
  const invalid = page.getByLabel('외곽 색 (HEX)', { exact: true });
  await invalid.fill('#ZZZZZZ');
  await invalid.press('Enter');
  await expect(page.locator('.studio-error')).toContainText('6자리 HEX');
  expect(await frame(page)).toBe(before);
  const saved = await savedDocument(page, info, '외곽 저장');
  for (const element of saved.elements.filter((element) => element.kind !== 'panel-background'))
    expect(element.contour).toEqual({ texture: 'paint', color: '#0047AB', width: 8 });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '외곽 저장');
  expect(await frame(page)).toBe(before);
  await page.screenshot({ path: info.outputPath('contour-restored.png'), fullPage: true });
  await writeFile(info.outputPath('contour-observations.json'), JSON.stringify(evidence, null, 2));
});
