import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
import {
  activate,
  card,
  closeMobilePanel,
  downloadPng,
  frame,
  goPage,
  normalized,
  rail,
  ready,
  restore,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const labels = ['정사각형', '원', '정삼각형', '마름모'];
const shapes = ['rect', 'ellipse', 'triangle', 'diamond'];

function placement(doc: StudioDocument, id: string) {
  const layout = doc.layouts.find((item) => item.ratio === doc.activeRatio)!;
  const panel = layout.panels.find((item) => item.elements.some((item) => item.elementId === id))!;
  return { panel, transform: panel.elements.find((item) => item.elementId === id)!.transform };
}

function oppositeAnchor(doc: StudioDocument, id: string, edge: 'e' | 's') {
  const { panel, transform: t } = placement(doc, id);
  const [rw, rh] = doc.activeRatio.split(':').map(Number) as [number, number];
  const scale = 1080 / Math.max(rw, rh);
  const pw = panel.rect.width * Math.round(rw * scale);
  const ph = panel.rect.height * Math.round(rh * scale);
  const x = edge === 'e' ? (-t.width * pw) / 2 : 0;
  const y = edge === 's' ? (-t.height * ph) / 2 : 0;
  const angle = (t.rotation * Math.PI) / 180;
  return {
    x: (t.x + t.width / 2) * pw + x * Math.cos(angle) - y * Math.sin(angle),
    y: (t.y + t.height / 2) * ph + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

async function gesture(
  page: Page,
  target: Locator,
  touch: boolean,
  delta: { x: number; y: number },
) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeEnabled();
  const box = (await target.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  expect(
    await page.evaluate(
      ({ start, marker }) =>
        document.elementFromPoint(start.x, start.y)?.closest('button')?.getAttribute(marker),
      {
        start,
        marker: (await target.getAttribute('data-resize-edge'))
          ? 'data-resize-edge'
          : 'data-transform-handle',
      },
    ),
  ).toBe(
    (await target.getAttribute('data-resize-edge')) ??
      (await target.getAttribute('data-transform-handle')),
  );
  const before = await frame(page);
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      await page.waitForTimeout(400);
      expect(await frame(page)).toBe(before);
      for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: start.x + delta.x * fraction, y: start.y + delta.y * fraction, id: 1 },
          ],
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
    expect(await frame(page)).toBe(before);
    await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 5 });
    await page.mouse.up();
  }
}

async function handleCenters(page: Page) {
  const hits = await page.evaluate(() => {
    const key = (node: Element | null | undefined) =>
      node?.getAttribute('data-resize-edge') ??
      node?.getAttribute('data-resize-handle') ??
      node?.getAttribute('data-transform-handle');
    return [
      ...document.querySelectorAll(
        'button[data-resize-edge],button[data-resize-handle],button[data-transform-handle]',
      ),
    ].map((button) => {
      const box = button.getBoundingClientRect();
      return {
        expected: key(button),
        actual: key(
          document
            .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
            ?.closest('button'),
        ),
        width: box.width,
        height: box.height,
      };
    });
  });
  expect(hits.map((hit) => hit.expected).sort()).toEqual([
    'e',
    'n',
    'ne',
    'nw',
    'rotation',
    's',
    'se',
    'sw',
    'w',
  ]);
  for (const hit of hits) {
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
    expect(hit.actual, JSON.stringify(hit)).toBe(hit.expected);
  }
  return hits;
}

function assertIndependent(
  before: StudioDocument,
  after: StudioDocument,
  id: string,
  edge: 'e' | 's',
  expectedDelta: number,
  tolerance: number,
) {
  const a = placement(before, id).transform;
  const b = placement(after, id).transform;
  const changed = edge === 'e' ? 'width' : 'height';
  const fixed = edge === 'e' ? 'height' : 'width';
  expect(b[changed]).toBeGreaterThan(a[changed]);
  expect(Math.abs(b[changed] - a[changed] - expectedDelta)).toBeLessThan(tolerance);
  expect(b[fixed]).toBe(a[fixed]);
  expect(b.rotation).toBe(a.rotation);
  expect(after.elements).toEqual(before.elements);
  const anchorA = oppositeAnchor(before, id, edge);
  const anchorB = oppositeAnchor(after, id, edge);
  expect(anchorB.x).toBeCloseTo(anchorA.x, 7);
  expect(anchorB.y).toBeCloseTo(anchorA.y, 7);
  for (const layout of before.layouts)
    for (const panel of layout.panels)
      for (const element of panel.elements)
        if (layout.ratio !== before.activeRatio || element.elementId !== id)
          expect(
            after.layouts
              .find((item) => item.ratio === layout.ratio)!
              .panels.find((item) => item.panelId === panel.panelId)!
              .elements.find((item) => item.elementId === element.elementId),
          ).toEqual(element);
}

test('정규 도형 4종의 기본 형태와 8비율 축별 조절·회전·저장 복원·PNG를 검증한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const ids: string[] = [];
  for (const [index, label] of labels.entries()) {
    await goPage(page, 'style');
    await activate(page.getByRole('button', { name: `${label} 추가`, exact: true }), isMobile);
    await expect(selectedLayer(page)).toHaveCount(1);
    ids.push((await selectedLayer(page).getAttribute('data-element-id'))!);
    await closeMobilePanel(page);
    await handleCenters(page);
    await page.screenshot({
      path: info.outputPath(`default-${shapes[index]}.png`),
      fullPage: true,
    });
  }
  expect(new Set(ids).size).toBe(4);
  const defaults = (await saveDocument(page, info, '정규 도형 기본값')).document;
  const defaultGeometry = [];
  for (const layout of defaults.layouts) {
    const [rw, rh] = layout.ratio.split(':').map(Number) as [number, number];
    const scale = 1080 / Math.max(rw, rh);
    for (const [index, id] of ids.entries()) {
      const element = defaults.elements.find((item) => item.id === id)!;
      expect(element).toMatchObject({ kind: 'shape', shape: shapes[index] });
      const panel = layout.panels.find((item) =>
        item.elements.some((item) => item.elementId === id),
      )!;
      const t = panel.elements.find((item) => item.elementId === id)!.transform;
      const width = t.width * panel.rect.width * Math.round(rw * scale);
      const height = t.height * panel.rect.height * Math.round(rh * scale);
      if (index === 2) {
        // Independently measure the three painted vertices inside the 2px stroke.
        const base = width - 3;
        const side = Math.hypot(base / 2, height - 3);
        expect(side).toBeCloseTo(base, 7);
      } else expect(width).toBeCloseTo(height, 7);
      defaultGeometry.push({ ratio: layout.ratio, shape: shapes[index], width, height });
    }
  }
  const observations = [];
  for (const [index, ratio] of ratios.entries()) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    const id = ids[index % 4]!;
    await activate(rail(page).locator(`button[data-layer-id="${id}"]`), isMobile);
    await closeMobilePanel(page);
    await expect(selectedLayer(page)).toHaveAttribute('data-element-id', id);
    const hits = await handleCenters(page);
    let before = (await saveDocument(page, info, `조절 전 ${index}`)).document;
    if (index < 2) {
      await closeMobilePanel(page);
      const canvas = (await card(page).boundingBox())!;
      const { panel, transform: t } = placement(before, id);
      const target = page.locator('[data-transform-handle="rotation"]');
      const box = (await target.boundingBox())!;
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const center = {
        x: canvas.x + (panel.rect.x + (t.x + t.width / 2) * panel.rect.width) * canvas.width,
        y: canvas.y + (panel.rect.y + (t.y + t.height / 2) * panel.rect.height) * canvas.height,
      };
      const angle = (12 * Math.PI) / 180;
      const x = start.x - center.x,
        y = start.y - center.y;
      await gesture(page, target, isMobile, {
        x: x * Math.cos(angle) - y * Math.sin(angle) - x,
        y: x * Math.sin(angle) + y * Math.cos(angle) - y,
      });
      const after = (await saveDocument(page, info, `회전 후 ${index}`)).document;
      const afterT = placement(after, id).transform;
      expect(Math.abs(afterT.rotation - t.rotation - 12)).toBeLessThan(2);
      expect({ ...afterT, rotation: t.rotation }).toEqual(t);
      expect(after.elements).toEqual(before.elements);
      before = after;
    }
    const axes = [];
    for (const edge of ['e', 's'] as const) {
      await closeMobilePanel(page);
      const canvas = (await card(page).boundingBox())!;
      const { panel, transform: t } = placement(before, id);
      const angle = (t.rotation * Math.PI) / 180;
      const delta =
        edge === 'e'
          ? { x: 14 * Math.cos(angle), y: 14 * Math.sin(angle) }
          : { x: -14 * Math.sin(angle), y: 14 * Math.cos(angle) };
      await gesture(page, page.locator(`[data-resize-edge="${edge}"]`), isMobile, delta);
      const after = (await saveDocument(page, info, `${ratio.replace(':', '-')} ${edge} 독립 조절`))
        .document;
      const axis =
        edge === 'e' ? canvas.width * panel.rect.width : canvas.height * panel.rect.height;
      assertIndependent(before, after, id, edge, 14 / axis, 1.5 / axis + 0.0001);
      axes.push({
        edge,
        expectedNormalizedDelta: 14 / axis,
        before: t,
        after: placement(after, id).transform,
      });
      before = after;
    }
    await closeMobilePanel(page);
    await handleCenters(page);
    await page.screenshot({
      path: info.outputPath(`resized-${ratio.replace(':', '-')}.png`),
      fullPage: true,
    });
    observations.push({
      ratio,
      id,
      shape: shapes[index % 4],
      input: isMobile ? 'CDP touch / 400ms hold' : 'mouse drag',
      hits,
      axes,
      pixels: await downloadPng(page, info, `proportions-${ratio.replace(':', '-')}`),
    });
  }
  const saved = (await saveDocument(page, info, '정규 도형 최종 저장')).document;
  await page.reload();
  await expect(card(page)).toBeVisible();
  await restore(page, '정규 도형 최종 저장');
  expect(normalized((await saveDocument(page, info, '정규 도형 새로고침 복원')).document)).toEqual(
    normalized(saved),
  );
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('shape-proportions-observations.json'),
    JSON.stringify({ ids, defaultGeometry, observations, errors }, null, 2),
  );
});
