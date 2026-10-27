import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
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

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const padding = { top: 18, right: 24, bottom: 46, left: 70 };
const corners = { topLeft: 3, topRight: 17, bottomRight: 31, bottomLeft: 45 };
const styles = (page: Page) =>
  page.getByRole('region', { name: '말풍선과 내 스타일', exact: true });

/** Native color input events exercise the same React control as the system color picker. */
async function color(page: Page, label: string, value: string, pageId: string) {
  const input = await reveal(page, label, pageId);
  await input.evaluate((node, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, next);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(input).toHaveValue(value);
}

function bubble(document: StudioDocument, id: string) {
  const result = document.elements.find((item) => item.id === id);
  if (result?.kind !== 'bubble') throw new Error('Saved bubble is missing');
  return result;
}

test('말풍선 기본 가운데·네 여백·모서리·뾰족함·스타일 재사용과 8비율 실제 PNG', async ({
  page,
}, info) => {
  // Eight full-image decodes, real downloads, JSON backup and reload are a functional matrix,
  // rather than the product's performance benchmark.
  test.setTimeout(180_000);
  await ready(page);
  await goPage(page, 'elements');
  await page.getByLabel('추가할 말풍선', { exact: true }).selectOption('speech');
  await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
  const id = (await selectedLayer(page).getAttribute('data-element-id'))!;
  expect(id).toBeTruthy();
  const defaults = bubble(await savedDocument(page, info, '말풍선 기본 배치'), id);
  expect(defaults).toMatchObject({
    verticalAlign: 'center',
    style: { align: 'center' },
    textPadding: { top: 12, right: 12, bottom: 12, left: 12 },
  });

  // A repeated symmetric glyph keeps the independent pixel-centre check free of advance/
  // overhang asymmetry. The two-line block still tests actual font ink, not line-box height.
  await (await reveal(page, '문구', 'text')).fill('HHHH\nHHHH');
  await color(page, '문구 색상', '#0b0f2b', 'text');
  await goPage(page, 'style');
  await page.getByLabel('말풍선 모양', { exact: true }).selectOption('caption');
  await styles(page).getByRole('button', { name: '상하좌우 가운데 정렬', exact: true }).click();
  await color(page, '말풍선 채우기 색', '#f8f9fa', 'style');
  await number(page, '외곽 두께', 0, 'style');
  await number(page, '문구 외곽선 두께', 0, 'style');
  for (const [label, value] of [
    ['말풍선 위 여백', padding.top],
    ['말풍선 오른쪽 여백', padding.right],
    ['말풍선 아래 여백', padding.bottom],
    ['말풍선 왼쪽 여백', padding.left],
    ['왼쪽 위 모서리 둥글기', corners.topLeft],
    ['오른쪽 위 모서리 둥글기', corners.topRight],
    ['오른쪽 아래 모서리 둥글기', corners.bottomRight],
    ['왼쪽 아래 모서리 둥글기', corners.bottomLeft],
  ] as const)
    await number(page, label, value, 'style');
  const appearance = await savedDocument(page, info, '말풍선 개별 여백과 모서리');
  expect(bubble(appearance, id)).toMatchObject({
    shape: 'caption',
    verticalAlign: 'center',
    textPadding: padding,
    corners,
    contour: { width: 0 },
    style: { color: '#0b0f2b', align: 'center' },
  });
  // An omitted outline is the renderer's valid zero-width default; an unchanged 0 field
  // does not introduce an explicit outline object on blur.
  expect(bubble(appearance, id).style.outline?.width ?? 0).toBe(0);

  const observations = [];
  for (const ratio of ratios) {
    await goPage(page, 'layout');
    await page
      .getByRole('group', { name: '화면 비율', exact: true })
      .getByRole('button', { name: ratio, exact: true })
      .click();
    await number(page, '요소 가로 위치', 10);
    await number(page, '요소 세로 위치', 15);
    await number(page, '요소 폭', 80);
    await number(page, '요소 높이', 55);
    const panel = appearance.layouts.find((item) => item.ratio === ratio)!.panels[0]!.rect;
    const ink = await card(page).evaluate(
      (node, { panel, padding }) => {
        const canvas = node as HTMLCanvasElement;
        const context = canvas.getContext('2d')!;
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const pw = panel.width * canvas.width;
        const ph = panel.height * canvas.height;
        const content = {
          x: panel.x * canvas.width + pw * 0.1 + padding.left,
          y: panel.y * canvas.height + ph * 0.15 + padding.top,
          width: pw * 0.8 - padding.left - padding.right,
          height: ph * 0.55 - padding.top - padding.bottom,
        };
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        let count = 0;
        for (let y = Math.floor(content.y); y < Math.ceil(content.y + content.height); y++) {
          for (let x = Math.floor(content.x); x < Math.ceil(content.x + content.width); x++) {
            const index = (y * canvas.width + x) * 4;
            if (
              Math.abs(pixels[index]! - 11) <= 4 &&
              Math.abs(pixels[index + 1]! - 15) <= 4 &&
              Math.abs(pixels[index + 2]! - 43) <= 4 &&
              pixels[index + 3]! >= 240
            ) {
              count++;
              left = Math.min(left, x);
              right = Math.max(right, x + 1);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y + 1);
            }
          }
        }
        return {
          count,
          content,
          bounds: { left, right, top, bottom },
          horizontalOffset: (left + right) / 2 - (content.x + content.width / 2),
          verticalOffset: (top + bottom) / 2 - (content.y + content.height / 2),
        };
      },
      { panel, padding },
    );
    expect(ink.count).toBeGreaterThan(100);
    // At 1080 logical pixels, rasterisation may move an antialiased edge by one pixel.
    // Two pixels also cover the font's symmetric H side-bearing quantisation.
    expect(Math.abs(ink.horizontalOffset)).toBeLessThanOrEqual(2);
    expect(Math.abs(ink.verticalOffset)).toBeLessThanOrEqual(2);
    expect(ink.bounds.left).toBeGreaterThanOrEqual(ink.content.x - 1);
    expect(ink.bounds.right).toBeLessThanOrEqual(ink.content.x + ink.content.width + 1);
    expect(ink.bounds.top).toBeGreaterThanOrEqual(ink.content.y - 1);
    expect(ink.bounds.bottom).toBeLessThanOrEqual(ink.content.y + ink.content.height + 1);
    const pixels = await downloadPng(page, info, `bubble-centred-${ratio.replace(':', '-')}`);
    observations.push({ ratio, ink, pixels });
  }
  const matrixDocument = await savedDocument(page, info, '말풍선 8비율 배치');
  for (const layout of matrixDocument.layouts)
    expect(
      layout.panels[0]!.elements.find((item) => item.elementId === id)?.transform,
    ).toMatchObject({
      x: 0.1,
      y: 0.15,
      width: 0.8,
      height: 0.55,
    });

  await goPage(page, 'style');
  await page.getByLabel('말풍선 모양', { exact: true }).selectOption('shout');
  await number(page, '뾰족한 정도', 0, 'style');
  const soft = await frame(page);
  await number(page, '뾰족한 정도', 100, 'style');
  expect(await frame(page)).not.toBe(soft);
  await downloadPng(page, info, 'bubble-sharpness-100');
  await number(page, '뾰족한 정도', 50, 'style');
  const styleName = '네 여백과 뾰족함';
  await styles(page).getByLabel('스타일 이름', { exact: true }).fill(styleName);
  await styles(page).getByRole('button', { name: '새 스타일 저장', exact: true }).click();
  await expect(styles(page).getByRole('status')).toContainText('저장했습니다');
  const original = await savedDocument(page, info, '말풍선 뾰족함 50');
  expect(bubble(original, id)).toMatchObject({ spikeSharpness: 50, textPadding: padding, corners });

  await goPage(page, 'elements');
  await page.getByLabel('추가할 말풍선', { exact: true }).selectOption('speech');
  await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
  const reusedId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  expect(reusedId).not.toBe(id);
  await goPage(page, 'style');
  await styles(page)
    .getByLabel('저장된 스타일', { exact: true })
    .selectOption({ label: `${styleName} · 말풍선+문구` });
  await styles(page).getByRole('button', { name: '스타일 적용', exact: true }).click();
  await expect(styles(page).getByRole('status')).toContainText('적용했습니다');
  const reused = await savedDocument(page, info, '말풍선 스타일 재사용');
  expect(bubble(reused, reusedId)).toMatchObject({
    shape: 'shout',
    text: '새 대사',
    verticalAlign: 'center',
    textPadding: padding,
    corners,
    spikeSharpness: 50,
    style: { color: '#0b0f2b', align: 'center' },
  });
  const beforeReload = await frame(page);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '말풍선 스타일 재사용');
  expect(await frame(page)).toBe(beforeReload);
  // Loading creates a fresh document and fresh element IDs; identify the retained content.
  await rail(page)
    .getByRole('button', { name: /말풍선 · 새 대사$/ })
    .click();
  await goPage(page, 'style');
  await expect(styles(page).getByLabel('저장된 스타일', { exact: true })).toContainText(styleName);
  await expect(page.getByLabel('뾰족한 정도', { exact: true })).toHaveValue('50');
  await page.screenshot({
    path: info.outputPath('bubble-appearance-restored.png'),
    fullPage: true,
  });
  await writeFile(
    info.outputPath('bubble-appearance-matrix.json'),
    JSON.stringify(observations, null, 2),
  );
});
