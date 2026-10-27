import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { THOUGHT_CLOUD_SVG_PATH } from '@jjal/renderer';
import {
  activate,
  card,
  downloadPng,
  frame,
  goPage,
  normalized,
  openResources,
  rail,
  ready,
  resources,
  restore,
  reveal,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

test(
  '비율 간격·전체 도구 가시성과 선택 해제·한 컷 범위를 확인한다',
  { tag: '@layout' },
  async ({ page, isMobile }, info) => {
    await ready(page);
    await expect(page.locator('[data-tool-page="elements"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '요소 · 배치', exact: true })).toHaveCount(0);
    await goPage(page, 'layout');
    const layout = await page.locator('.studio-shell').evaluate((root) => {
      const bar = root.querySelector<HTMLElement>('.tool-bookmarks')!;
      const box = bar.getBoundingClientRect();
      const ratio = root.querySelector<HTMLElement>('.ratio-options')!;
      const buttons = [...ratio.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      return {
        wide: root.classList.contains('is-wide'),
        barVisible: box.height > 0,
        columns: getComputedStyle(ratio).gridTemplateColumns,
        buttons,
        categories: [...bar.querySelectorAll('button')].map((b) => {
          const r = b.getBoundingClientRect();
          return {
            text: b.textContent?.trim(),
            inside:
              r.left >= box.left - 1 &&
              r.right <= box.right + 1 &&
              r.top >= box.top - 1 &&
              r.bottom <= box.bottom + 1,
          };
        }),
      };
    });
    expect(layout.buttons).toHaveLength(8);
    expect(new Set(layout.buttons.map((b) => Math.round(b.y))).size).toBe(2);
    for (const b of layout.buttons) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    if (layout.wide) {
      expect(layout.categories).toHaveLength(6);
      expect(layout.categories.every((c) => c.inside)).toBe(true);
    }
    await goPage(page, 'layers');
    await page.getByRole('button', { name: '다중 선택', exact: true }).click();
    await expect(page.getByRole('button', { name: '다중 선택', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '편집 가능한 요소 전체 선택', exact: true }).click();
    expect(await selectedLayer(page).count()).toBeGreaterThan(1);
    await page.getByRole('button', { name: '선택 해제', exact: true }).click();
    await expect(selectedLayer(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: '다중 선택', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await activate(rail(page).locator('.layer-circle').first(), isMobile);
    await expect(selectedLayer(page)).toHaveCount(1);
    await goPage(page, 'background');
    await expect(page.getByLabel('배경 적용 범위', { exact: true })).toHaveValue('none');
    await expect(page.getByLabel('배경 적용 범위', { exact: true })).toBeDisabled();
    await expect(page.getByLabel('배경 색상', { exact: true })).toBeEnabled();
    await writeFile(
      info.outputPath('comments-layout.json'),
      JSON.stringify(
        {
          profile: info.project.name,
          ...layout,
          multiSelectionCleared: true,
          singleCutNotApplicable: true,
        },
        null,
        2,
      ),
    );
    await page.screenshot({ path: info.outputPath('comments-layout.png'), fullPage: true });
  },
);

test('구름 모양 생각 말풍선을 8비율에서 저장 복원하고 PNG와 일치시킨다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(240_000);
  await ready(page);
  await goPage(page, 'background');
  await page.getByLabel('배경색 없음', { exact: true }).check();
  await openResources(page);
  await resources(page).getByRole('tab', { name: '말풍선', exact: true }).click();
  const tile = resources(page).locator('[data-bubble-shape="thought"]');
  expect(await tile.locator('svg path').getAttribute('d')).toBe(THOUGHT_CLOUD_SVG_PATH);
  await activate(tile, isMobile);
  const id = (await selectedLayer(page).getAttribute('data-element-id'))!;
  await (await reveal(page, '문구', 'text')).fill('');
  const initial = (await saveDocument(page, info, '구름 모양 기준')).document;
  expect(initial.elements.find((e) => e.id === id)).toMatchObject({
    kind: 'bubble',
    shape: 'thought',
  });
  const silhouettes = [],
    pixels = [],
    frames = new Map<string, string>();
  const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    const placed = initial.layouts
      .find((l) => l.ratio === ratio)!
      .panels.find((p) => p.elements.some((e) => e.elementId === id))!;
    const t = placed.elements.find((e) => e.elementId === id)!.transform;
    const alpha = await card(page).evaluate(
      (node, { rect, t }) => {
        const canvas = node as HTMLCanvasElement,
          ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        const width = t.width * rect.width * canvas.width,
          height = t.height * rect.height * canvas.height;
        const x = (rect.x + t.x * rect.width) * canvas.width,
          y = (rect.y + t.y * rect.height) * canvas.height;
        const sample = (u: number, v: number) =>
          ctx.getImageData(Math.round(x + u * width), Math.round(y + v * height * 0.82), 1, 1)
            .data[3];
        return { cloudInterior: sample(0.5, 0.45), cloudScallopNotEllipse: sample(0.03, 0.45) };
      },
      { rect: placed.rect, t },
    );
    expect(alpha.cloudInterior).toBe(255);
    expect(alpha.cloudScallopNotEllipse).toBe(0);
    silhouettes.push({ ratio, alpha });
    frames.set(ratio, await frame(page));
    pixels.push({
      ratio,
      comparison: await downloadPng(page, info, `thought-cloud-${ratio.replace(':', '-')}`),
    });
  }
  const final = await saveDocument(page, info, '구름 말풍선 8비율');
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '구름 말풍선 8비율');
  expect(normalized((await saveDocument(page, info, '구름 복원 확인')).document)).toEqual(
    normalized(final.document),
  );
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    expect(await frame(page)).toBe(frames.get(ratio));
  }
  await writeFile(
    info.outputPath('thought-cloud-results.json'),
    JSON.stringify({ profile: info.project.name, silhouettes, pixels, restored: true }, null, 2),
  );
  await page.screenshot({ path: info.outputPath('thought-cloud-final.png'), fullPage: true });
});
