import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
import {
  card,
  downloadPng,
  frame,
  goPage,
  rail,
  ready,
  restore,
  savedDocument,
} from './sketch-controls';

type Point = { x: number; y: number };
type InputAudit = { type: string; trusted: boolean; pointerType?: string };
type AuditWindow = Window & { __dropInputAudit?: InputAudit[] };
const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const preview = (page: Page) => page.locator('.resource-drop-preview');
const edges = (page: Page) => rail(page).locator('.layer-circle[data-drop-edge]');
const resource = (page: Page) => page.locator('.resource-item[data-resource-id]').first();
const layer = (page: Page, id: string) => rail(page).locator(`[data-layer-id="${id}"]`);
const nextFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

async function setup(page: Page) {
  await ready(page);
  await expect(page.locator('.resource-item[data-resource-id]')).toHaveCount(12);
  await goPage(page, 'templates');
  await page
    .getByRole('region', { name: '기본 템플릿', exact: true })
    .getByRole('button', { name: '전후 비교', exact: true })
    .click();
  await page.evaluate(() => {
    const audit: InputAudit[] = [];
    (window as AuditWindow).__dropInputAudit = audit;
    document.addEventListener('dragstart', (event) =>
      audit.push({ type: event.type, trusted: event.isTrusted }),
    );
    for (const name of ['pointerdown', 'pointercancel'] as const)
      document.addEventListener(name, (event) =>
        audit.push({ type: event.type, trusted: event.isTrusted, pointerType: event.pointerType }),
      );
  });
}

async function middle(page: Page, target: Locator, edge?: 'before' | 'after'): Promise<Point> {
  await target.scrollIntoViewIfNeeded();
  // Test preparation: keep the resource strip, rail and 1:1 card in the same viewport.
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = (await target.boundingBox())!;
  expect(box).toBeTruthy();
  const point = {
    x: box.x + box.width * (edge === 'before' ? 0.22 : edge === 'after' ? 0.78 : 0.5),
    y: box.y + box.height / 2,
  };
  const viewport = page.viewportSize()!;
  expect(point.x).toBeGreaterThan(2);
  expect(point.x).toBeLessThan(viewport.width - 2);
  expect(point.y).toBeGreaterThan(2);
  expect(point.y).toBeLessThan(viewport.height - 2);
  return point;
}

async function pair(page: Page, sourceId: string, targetId: string, edge: 'before' | 'after') {
  await rail(page).evaluate(
    (strip, { sourceId, targetId }) => {
      const a = strip.querySelector<HTMLElement>(`[data-layer-id="${sourceId}"]`)!;
      const b = strip.querySelector<HTMLElement>(`[data-layer-id="${targetId}"]`)!;
      const outer = strip.getBoundingClientRect();
      const boxes = [a.getBoundingClientRect(), b.getBoundingClientRect()];
      const left = Math.min(...boxes.map((box) => box.left - outer.left + strip.scrollLeft));
      const right = Math.max(...boxes.map((box) => box.right - outer.left + strip.scrollLeft));
      if (right - left > strip.clientWidth - 12)
        throw new Error('Gesture endpoints cannot both fit inside the layer rail');
      strip.scrollLeft = Math.max(0, (left + right - strip.clientWidth) / 2);
    },
    { sourceId, targetId },
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  const source = (await layer(page, sourceId).boundingBox())!;
  const target = (await layer(page, targetId).boundingBox())!;
  return {
    from: { x: source.x + source.width / 2, y: source.y + source.height / 2 },
    to: {
      x: target.x + target.width * (edge === 'before' ? 0.22 : 0.78),
      y: target.y + target.height / 2,
    },
  };
}

async function destination(page: Page, doc: StudioDocument, panelIndex = 1): Promise<Point> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = (await card(page).boundingBox())!;
  const rect = doc.layouts.find((layout) => layout.ratio === '1:1')!.panels[panelIndex]!.rect;
  const result = {
    x: box.x + (rect.x + rect.width * 0.68) * box.width,
    y: box.y + (rect.y + rect.height * 0.6) * box.height,
  };
  expect(result.y).toBeLessThan(page.viewportSize()!.height - 3);
  return result;
}

/** Real native mouse drag or trusted CDP touch; no dispatchEvent drag approximation. */
async function driver(page: Page, touch: boolean) {
  const client: CDPSession | undefined = touch
    ? await page.context().newCDPSession(page)
    : undefined;
  if (client)
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  let held = false;
  let position: Point = { x: 0, y: 0 };
  return {
    async begin(from: Point, hold = true) {
      held = true;
      position = from;
      if (client) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...from, id: 1 }],
        });
        if (hold) await page.waitForTimeout(380);
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 10, from.y + 1, { steps: 3 });
      }
    },
    async move(to: Point) {
      if (client) {
        const from = position;
        for (const fraction of [0.2, 0.4, 0.6, 0.8, 1]) {
          await client.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              {
                x: from.x + (to.x - from.x) * fraction,
                y: from.y + (to.y - from.y) * fraction,
                id: 1,
              },
            ],
          });
          await nextFrame(page);
        }
      } else {
        await page.mouse.move(to.x, to.y, { steps: 8 });
        // A second actual movement makes native dragover observable in Chromium.
        await page.mouse.move(to.x + 0.2, to.y, { steps: 1 });
      }
      position = to;
      await nextFrame(page);
    },
    async end(cancel = false) {
      if (!held) return;
      held = false;
      if (client)
        await client.send('Input.dispatchTouchEvent', {
          type: cancel ? 'touchCancel' : 'touchEnd',
          touchPoints: [],
        });
      else {
        if (cancel) await page.keyboard.press('Escape');
        await page.mouse.up();
      }
      await nextFrame(page);
    },
    async close() {
      if (held) {
        if (client)
          await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        else {
          await page.keyboard.press('Escape');
          await page.mouse.up();
        }
      }
      await client?.detach();
    },
  };
}

async function clearFeedback(page: Page) {
  await expect(preview(page)).toHaveCount(0);
  await expect(edges(page)).toHaveCount(0);
  await expect(rail(page)).not.toHaveAttribute('data-drop-active', 'true');
  await expect(page.locator('.resource-drag-ghost')).toHaveCount(0);
}

function preserved(doc: StudioDocument) {
  return { panels: doc.panels, elements: doc.elements, layouts: doc.layouts, assets: doc.assets };
}

function canonical(doc: StudioDocument) {
  const groups = [...new Set(doc.elements.flatMap((element) => element.groupId ?? []))];
  const ids = new Map<string, string>([
    [doc.id, 'document'],
    ...doc.panels.map((panel, index) => [panel.id, `panel-${index}`] as const),
    ...doc.elements.map((element, index) => [element.id, `element-${index}`] as const),
    ...doc.assets.map((asset, index) => [asset.id, `asset-${index}`] as const),
    ...groups.map((id, index) => [id, `group-${index}`] as const),
  ]);
  return JSON.parse(
    JSON.stringify(doc, (key, value: unknown) =>
      key === 'createdAt' || key === 'updatedAt'
        ? ''
        : typeof value === 'string'
          ? (ids.get(value) ?? value)
          : value,
    ),
  ) as unknown;
}

function unchangedPlacements(before: StudioDocument, after: StudioDocument) {
  for (const element of before.elements)
    expect(after.elements.find((item) => item.id === element.id)).toEqual(element);
  for (const layout of before.layouts)
    for (const panel of layout.panels)
      for (const element of panel.elements)
        expect(
          after.layouts
            .find((item) => item.ratio === layout.ratio)!
            .panels.find((item) => item.panelId === panel.panelId)!
            .elements.find((item) => item.elementId === element.elementId),
        ).toEqual(element);
}

test('자원 드롭의 컷·삽입선 예고와 실제 순서·저장 복원·8비율 PNG를 일치시킨다', async ({
  page,
}, info) => {
  test.setTimeout(240_000);
  const touch = info.project.name.includes('mobile');
  await setup(page);
  const initial = await savedDocument(page, info, '드롭 전 원본');
  const input = await driver(page, touch);
  const observations: unknown[] = [];
  try {
    const from = await middle(page, resource(page));
    const to = await destination(page, initial);
    const before = await frame(page);
    await input.begin(from);
    await input.move(to);
    const overlay = preview(page);
    await expect(overlay).toHaveAttribute('data-drop-panel', initial.panels[1]!.id);
    await expect(overlay).toBeVisible();
    await expect(edges(page)).toHaveCount(0);
    expect(await overlay.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
    const rect = initial.layouts.find((layout) => layout.ratio === '1:1')!.panels[1]!.rect;
    const actual = await overlay.locator('rect').evaluate((node) => ({
      x: Number(node.getAttribute('x')),
      y: Number(node.getAttribute('y')),
      width: Number(node.getAttribute('width')),
      height: Number(node.getAttribute('height')),
    }));
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(actual[key]).toBeCloseTo(rect[key] * 100, 6);
    expect(await frame(page)).toBe(before);
    if (touch) await expect(page.locator('.resource-drag-ghost')).toBeVisible();
    await page.screenshot({ path: info.outputPath('resource-cut-preview.png') });
    await input.end();
    await clearFeedback(page);
    await expect(rail(page).locator('[data-layer-id]')).toHaveCount(initial.elements.length + 1);
    const canvasDrop = await savedDocument(page, info, '두 번째 컷 드롭');
    const first = canvasDrop.elements.filter(
      (element) => !initial.elements.some((old) => old.id === element.id),
    );
    expect(first).toHaveLength(1);
    expect(first[0]!.kind).toBe('image');
    expect(canvasDrop.panels[1]!.elementIds).toContain(first[0]!.id);
    expect(canvasDrop.panels[0]!.elementIds).toEqual(initial.panels[0]!.elementIds);
    unchangedPlacements(initial, canvasDrop);
    observations.push({
      target: initial.panels[1]!.id,
      from,
      to,
      overlay: actual,
      added: first[0]!.id,
    });

    let current = canvasDrop;
    const targetId = initial.panels[0]!.elementIds.find(
      (id) => initial.elements.find((element) => element.id === id)?.kind === 'character',
    )!;
    expect(targetId).toBeTruthy();
    for (const edge of ['before', 'after'] as const) {
      const destination = await middle(page, layer(page, targetId), edge);
      const origin = await middle(page, resource(page));
      const pixels = await frame(page);
      await input.begin(origin);
      await input.move(destination);
      await expect(layer(page, targetId)).toHaveAttribute('data-drop-edge', edge);
      await expect(rail(page)).toHaveAttribute('data-drop-active', 'true');
      await expect(edges(page)).toHaveCount(1);
      await expect(preview(page)).toHaveCount(0);
      expect(await frame(page)).toBe(pixels);
      await input.end();
      await clearFeedback(page);
      await expect(rail(page).locator('[data-layer-id]')).toHaveCount(current.elements.length + 1);
      const after = await savedDocument(page, info, `레이어 ${edge} 드롭`);
      const added = after.elements.filter(
        (element) => !current.elements.some((old) => old.id === element.id),
      );
      expect(added).toHaveLength(1);
      const display = [...current.panels[0]!.elementIds].reverse();
      display.splice(display.indexOf(targetId) + (edge === 'after' ? 1 : 0), 0, added[0]!.id);
      expect([...after.panels[0]!.elementIds].reverse()).toEqual(display);
      expect(after.panels[1]).toEqual(current.panels[1]);
      unchangedPlacements(current, after);
      observations.push({ targetId, edge, added: added[0]!.id, display });
      current = after;
    }
    const audit = await page.evaluate(() => (window as AuditWindow).__dropInputAudit ?? []);
    expect(
      audit.some(
        (event) =>
          event.trusted &&
          (touch
            ? event.type === 'pointerdown' && event.pointerType === 'touch'
            : event.type === 'dragstart'),
      ),
    ).toBe(true);
    const beforeReload = await frame(page);
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
    await restore(page, '레이어 after 드롭');
    await expect.poll(() => frame(page)).toBe(beforeReload);
    const restored = await savedDocument(page, info, '드롭 복원 확인');
    expect(canonical(restored)).toEqual(canonical(current));
    const pixels = [];
    for (const ratio of ratios) {
      await goPage(page, 'layout');
      await page
        .getByRole('group', { name: '화면 비율', exact: true })
        .getByRole('button', { name: ratio, exact: true })
        .click();
      pixels.push({
        ratio,
        comparison: await downloadPng(page, info, `drop-${ratio.replace(':', '-')}`),
      });
    }
    await writeFile(
      info.outputPath('drop-feedback-observations.json'),
      JSON.stringify({ touch, audit, observations, pixels }, null, 2),
    );
  } finally {
    await input.close();
  }
});

test('레이어 재정렬 예고는 실제 순서와 맞고 자기 그룹·다른 컷·잠긴 그룹은 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await setup(page);
  const input = await driver(page, info.project.name.includes('mobile'));
  try {
    const initial = await savedDocument(page, info, '레이어 순서 원본');
    const first = initial.panels[0]!;
    const find = (kind: string, index = 0) =>
      initial.elements.find(
        (element) =>
          element.kind === kind && initial.panels[index]!.elementIds.includes(element.id),
      )!.id;
    const sourceId = find('text');
    const targetId = find('character');
    const points = await pair(page, sourceId, targetId, 'after');
    const before = await frame(page);
    await input.begin(points.from);
    await input.move(points.to);
    await expect(layer(page, targetId)).toHaveAttribute('data-drop-edge', 'after');
    await expect(edges(page)).toHaveCount(1);
    expect(await frame(page)).toBe(before);
    await input.end();
    await clearFeedback(page);
    const moved = await savedDocument(page, info, '레이어 순서 이동');
    const display = [...first.elementIds].reverse().filter((id) => id !== sourceId);
    display.splice(display.indexOf(targetId) + 1, 0, sourceId);
    expect([...moved.panels[0]!.elementIds].reverse()).toEqual(display);
    expect(moved.panels[1]).toEqual(initial.panels[1]);
    expect(moved.elements).toEqual(initial.elements);
    expect(moved.layouts).toEqual(initial.layouts);

    const invalid = [
      { label: '자기 그룹', source: find('frame'), target: find('panel-background') },
      { label: '다른 컷', source: find('bubble'), target: find('text', 1) },
    ];
    for (const item of invalid) {
      const endpoints = await pair(page, item.source, item.target, 'before');
      const pixels = await frame(page);
      await input.begin(endpoints.from);
      await input.move(endpoints.to);
      await expect(edges(page)).toHaveCount(0);
      await expect(rail(page)).not.toHaveAttribute('data-drop-active', 'true');
      expect(await frame(page)).toBe(pixels);
      await input.end();
      await clearFeedback(page);
      expect(preserved(await savedDocument(page, info, `${item.label} 보존`))).toEqual(
        preserved(moved),
      );
    }
    await layer(page, find('frame')).click();
    await goPage(page, 'layers');
    await page.getByRole('button', { name: '선택 잠금', exact: true }).click();
    const locked = await savedDocument(page, info, '잠긴 그룹 원본');
    const endpoints = await pair(page, find('frame'), targetId, 'before');
    await input.begin(endpoints.from);
    await input.move(endpoints.to);
    await expect(edges(page)).toHaveCount(0);
    await expect(rail(page)).not.toHaveAttribute('data-drop-active', 'true');
    await input.end();
    await clearFeedback(page);
    expect(preserved(await savedDocument(page, info, '잠긴 그룹 이동 거부'))).toEqual(
      preserved(locked),
    );
  } finally {
    await input.close();
  }
});

test('드롭 이탈·취소·Escape·리사이즈·읽기 전용과 준비 전 터치에서 잔류 안내와 변경이 없다', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  await setup(page);
  const touch = info.project.name.includes('mobile');
  const initial = await savedDocument(page, info, '취소 전 원본');
  const input = await driver(page, touch);
  const completed: string[] = [];
  try {
    if (touch) {
      const from = await middle(page, resource(page));
      await input.begin(from, false);
      await input.move({ x: from.x - 30, y: from.y });
      await clearFeedback(page);
      await input.end();
      completed.push('350ms 이전 터치 이동');
    }
    for (const mode of ['leave', 'cancel', 'escape', 'resize'] as const) {
      const from = await middle(page, resource(page));
      const to = await destination(page, initial);
      const before = await frame(page);
      await input.begin(from);
      await input.move(to);
      await expect(preview(page)).toHaveAttribute('data-drop-panel', initial.panels[1]!.id);
      expect(await frame(page)).toBe(before);
      if (mode === 'leave') {
        await input.move({ x: page.viewportSize()!.width - 3, y: 3 });
        await expect(preview(page)).toHaveCount(0);
        await input.end();
      } else if (mode === 'cancel') await input.end(true);
      else if (mode === 'escape') {
        await page.keyboard.press('Escape');
        await expect(preview(page)).toHaveCount(0);
        await input.end();
      } else {
        const size = page.viewportSize()!;
        await page.setViewportSize({ width: size.width + 18, height: size.height });
        await expect(preview(page)).toHaveCount(0);
        await input.end();
        await page.setViewportSize(size);
      }
      await clearFeedback(page);
      expect(await frame(page)).toBe(before);
      completed.push(mode);
    }
    expect(preserved(await savedDocument(page, info, '드롭 취소 보존'))).toEqual(
      preserved(initial),
    );
    await ready(page, '/?view=readonly');
    await expect(page.locator('.resource-readonly-banner')).toBeVisible();
    await expect(page.locator('.resource-item')).toHaveCount(0);
    for (const button of await rail(page).locator('button').all())
      await expect(button).toBeDisabled();
    await clearFeedback(page);
    const readonlyFrame = await frame(page);
    await page.keyboard.press('Escape');
    const size = page.viewportSize()!;
    await page.setViewportSize({ width: size.width + 18, height: size.height });
    await clearFeedback(page);
    expect(await frame(page)).toBe(readonlyFrame);
    completed.push('readonly');
    await writeFile(
      info.outputPath('drop-cancellation-observations.json'),
      JSON.stringify({ touch, completed }, null, 2),
    );
  } finally {
    await input.close();
  }
});
