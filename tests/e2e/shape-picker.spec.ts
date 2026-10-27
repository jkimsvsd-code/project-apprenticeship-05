import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { canvasSize } from '@jjal/policies';
import {
  activate,
  card,
  downloadPng,
  goPage,
  normalized,
  ready,
  restore,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

test(
  '모양 전용 추가 버튼이 도구 표면과 일치하고 8비율의 실제 추가 치수·잉크를 보여준다',
  { tag: '@layout' },
  async ({ page, isMobile }, info) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await ready(page);
    const labels = ['정사각형', '원', '정삼각형', '마름모'];
    const shapes = ['rect', 'ellipse', 'triangle', 'diamond'];
    const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
    const observations = [];
    for (const [index, ratio] of ratios.entries()) {
      await (
        await goPage(page, 'layout')
      )
        .getByRole('button', { name: ratio, exact: true })
        .click();
      await goPage(page, 'style');
      const picker = page.locator('.shape-options');
      await expect(picker.locator('button')).toHaveCount(4);
      const style = await picker.evaluate((node) => {
        const fieldset = node.closest('fieldset')!;
        const legend = fieldset.querySelector('legend')!;
        const contourLegend = document.querySelector('.contour-tools legend')!;
        return {
          border: getComputedStyle(fieldset).borderWidth,
          padding: getComputedStyle(fieldset).padding,
          legend: getComputedStyle(legend).fontSize,
          otherLegend: getComputedStyle(contourLegend).fontSize,
          columns: getComputedStyle(node).gridTemplateColumns.split(' ').length,
        };
      });
      expect(style).toEqual({
        border: '0px',
        padding: '0px',
        legend: style.otherLegend,
        otherLegend: style.otherLegend,
        columns: 2,
      });
      const previews = [];
      for (const [i, name] of labels.entries()) {
        const button = picker.getByRole('button', { name: `${name} 추가`, exact: true });
        await expect(button).toHaveText('');
        const preview = await button.evaluate((node) => {
          const box = node.getBoundingClientRect(),
            canvas = node.querySelector('canvas')!;
          const context = canvas.getContext('2d', { willReadFrequently: true })!;
          const rgba = [
            ...context.getImageData(
              Math.floor(canvas.width / 2),
              Math.floor(canvas.height / 2),
              1,
              1,
            ).data,
          ];
          return {
            width: box.width,
            height: box.height,
            svg: node.querySelectorAll('svg').length,
            shape: canvas.dataset.shapePreview,
            logicalWidth: Number(canvas.dataset.logicalWidth),
            logicalHeight: Number(canvas.dataset.logicalHeight),
            bitmap: [canvas.width, canvas.height],
            objectFit: getComputedStyle(canvas).objectFit,
            rgba,
          };
        });
        expect(preview.width).toBeGreaterThanOrEqual(44);
        expect(preview.height).toBeGreaterThanOrEqual(64);
        expect(preview.svg).toBe(0);
        expect(preview.objectFit).toBe('contain');
        expect(preview.shape).toBe(shapes[i]);
        expect(preview.rgba).toEqual([248, 249, 250, 255]);
        expect(preview.bitmap).toEqual([
          Math.round(preview.logicalWidth),
          Math.round(preview.logicalHeight),
        ]);
        previews.push(preview);
      }
      const button = picker.getByRole('button', { name: `${labels[index % 4]} 추가`, exact: true });
      await activate(button, isMobile);
      await expect(selectedLayer(page)).toHaveCount(1);
      const id = (await selectedLayer(page).getAttribute('data-element-id'))!;
      observations.push({ ratio, id, previews });
      if (index === 0 || index === 7)
        await page.screenshot({
          path: info.outputPath(`picker-${ratio.replace(':', '-')}.png`),
          fullPage: true,
        });
    }
    const saved = (await saveDocument(page, info, '모양 전용 도형')).document;
    for (const observation of observations) {
      const element = saved.elements.find((item) => item.id === observation.id)!;
      expect(element).toMatchObject({
        kind: 'shape',
        fill: '#F8F9FA',
        contour: { texture: 'pen', color: '#0B0F2B', width: 2 },
      });
      const panel = saved.layouts
        .find((item) => item.ratio === observation.ratio)!
        .panels.find((item) => item.elements.some((item) => item.elementId === element.id))!;
      const transform = panel.elements.find((item) => item.elementId === element.id)!.transform;
      const size = canvasSize(observation.ratio);
      for (const preview of observation.previews.filter(
        (preview) => element.kind === 'shape' && preview.shape === element.shape,
      )) {
        expect(preview.logicalWidth).toBeCloseTo(
          transform.width * panel.rect.width * size.width,
          8,
        );
        expect(preview.logicalHeight).toBeCloseTo(
          transform.height * panel.rect.height * size.height,
          8,
        );
      }
    }
    await page.reload();
    await expect(card(page)).toBeVisible();
    await restore(page, '모양 전용 도형');
    expect(normalized((await saveDocument(page, info, '모양 전용 도형 복원')).document)).toEqual(
      normalized(saved),
    );
    await downloadPng(page, info, 'shape-picker-restored');
    expect(errors).toEqual([]);
    await writeFile(
      info.outputPath('shape-picker-observations.json'),
      JSON.stringify({ observations, errors }, null, 2),
    );
  },
);
