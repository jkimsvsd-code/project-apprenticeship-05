import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { StudioDocument } from '@jjal/document-model';
import { canvasSize } from '@jjal/policies';
import {
  activate,
  card,
  closeMobilePanel,
  downloadPng,
  frame,
  goPage,
  normalized,
  number,
  openResources,
  rail,
  ready,
  resources,
  restore,
  reveal,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

const working = path.resolve('../local-only/jjal-card-studio-plan/working/S01-023-section-tools');
const before = process.env.SECTION_TOOLS_PHASE === 'before';

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector<HTMLElement>(selector),
        rect = node?.getBoundingClientRect();
      return rect
        ? {
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height,
            scrollHeight: node!.scrollHeight,
            clientHeight: node!.clientHeight,
            overflowY: getComputedStyle(node!).overflowY,
          }
        : null;
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      canvas: box('canvas[aria-label^="카드 "]'),
      editor: box('.preview-panel'),
      stage: box('.canvas-stage'),
      tools: box('.studio-direct'),
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        scrollY,
      },
    };
  });
}

test(
  '원본과 동일한 PC·가로·모바일 화면에서 편집 도구 높이와 중앙 배치를 기록한다',
  { tag: '@layout' },
  async ({ page }, info) => {
    test.setTimeout(90_000);
    await ready(page);
    const baseline = path.join(working, 'geometry-baseline');
    await mkdir(baseline, { recursive: true });
    const filename = path.join(baseline, `${info.project.name}.json`);
    const measurements = [];
    for (const ratio of ['1:1', '9:16', '16:9']) {
      await (
        await goPage(page, 'layout')
      )
        .getByRole('button', { name: ratio, exact: true })
        .click();
      await goPage(page, 'text');
      await expect(card(page)).toHaveAttribute('aria-label', `카드 ${ratio} 비율`);
      const current = await geometry(page);
      measurements.push({ ratio, ...current });
      await page.screenshot({
        path: info.outputPath(`tools-${ratio.replace(':', '-')}.png`),
        fullPage: true,
      });
    }
    if (before) await writeFile(filename, JSON.stringify(measurements, null, 2));
    else {
      const originals = JSON.parse(await readFile(filename, 'utf8')) as typeof measurements;
      for (const current of measurements) {
        const original = originals.find((item) => item.ratio === current.ratio)!;
        expect(current.viewport).toEqual(original.viewport);
        expect(current.tools).not.toBeNull();
        expect(current.tools!.height).toBeGreaterThan(0);
        if (info.project.name === 'landscape-chromium') {
          expect(current.tools!.top).toBeGreaterThanOrEqual(current.stage!.top - 1);
          expect(current.tools!.bottom).toBeLessThanOrEqual(current.stage!.bottom + 1);
          expect(
            Math.abs(
              (current.tools!.top + current.tools!.bottom) / 2 -
                (current.stage!.top + current.stage!.bottom) / 2,
            ),
          ).toBeLessThanOrEqual(1);
        }
      }
    }
    await writeFile(
      info.outputPath('section-tools-geometry.json'),
      JSON.stringify({ phase: before ? 'before' : 'after', measurements }, null, 2),
    );
  },
);

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const categories = ['문구', '배경', '레이어', '스타일', '템플릿', '저장'];
const addText = (page: Page) =>
  page.getByRole('button', { name: '문구 추가', exact: true }).and(page.locator('.caption-add'));

test(
  '단일 도구 분류·빈 선택 안내·섹션 하단 문구 추가와 보기 전용 경계를 유지한다',
  { tag: '@layout' },
  async ({ page, isMobile }, info) => {
    test.skip(before, 'The before phase captures existing geometry only.');
    test.setTimeout(120_000);
    await ready(page);
    await goPage(page, 'text');
    await expect(page.locator('.tool-deck-stacked')).toHaveCount(1);
    await expect(page.getByRole('region', { name: '편집 도구 상세', exact: true })).toHaveCount(1);
    expect(await page.locator('.tool-bookmarks [role="tab"]').allTextContents()).toEqual(
      categories,
    );
    await expect(page.locator('[data-tool-page="image"]')).toHaveCount(0);
    await expect(addText(page)).toBeEnabled();
    await expect(
      addText(page).locator('xpath=ancestor::fieldset[contains(@class,"caption-fields")]'),
    ).toHaveCount(0);
    expect(
      await page.locator('[data-tool-page="text"]').evaluate((section) => {
        const fields = section.querySelector('.caption-fields')!.getBoundingClientRect();
        const action = section.querySelector('.caption-add')!.getBoundingClientRect();
        return action.top >= fields.bottom - 1;
      }),
    ).toBe(true);
    await goPage(page, 'layers');
    await page.getByRole('button', { name: '선택 해제', exact: true }).click();
    await expect(selectedLayer(page)).toHaveCount(0);
    await goPage(page, 'style');
    await expect(page.getByText('조정할 요소를 선택해주세요.', { exact: true })).toBeVisible();
    await goPage(page, 'text');
    await expect(page.locator('[data-tool-page="text"] .caption-fields')).toHaveCount(0);
    await expect(addText(page)).toBeEnabled();
    const ids: string[] = [];
    for (const text of ['빈 선택에서 추가', '선택한 문구 아래 추가']) {
      await activate(addText(page), isMobile);
      await (await reveal(page, '문구', 'text')).fill(text);
      ids.push((await selectedLayer(page).getAttribute('data-element-id'))!);
      await expect(addText(page)).toBeEnabled();
    }
    expect(new Set(ids).size).toBe(2);
    const saved = await saveDocument(page, info, '섹션 문구 추가');
    for (const id of ids)
      expect(saved.document.elements.find((element) => element.id === id)?.kind).toBe('text');
    await goPage(page, 'text');
    const caption = await reveal(page, '문구', 'text');
    const beforeComposition = await frame(page);
    await caption.dispatchEvent('compositionstart', { data: '조' });
    await expect(addText(page)).toBeDisabled();
    expect(await frame(page)).toBe(beforeComposition);
    await caption.dispatchEvent('compositionend', { data: '' });
    await ready(page, '/?view=readonly');
    await goPage(page, 'text');
    await expect(addText(page)).toBeDisabled();
    await expect(await reveal(page, '문구', 'text')).toBeDisabled();
    await writeFile(
      info.outputPath('unified-section-controls.json'),
      JSON.stringify(
        {
          profile: info.project.name,
          categories,
          ids,
          emptyStyleMessage: true,
          addOutsideSelectedFieldset: true,
          imeAndReadonlyGuard: true,
        },
        null,
        2,
      ),
    );
  },
);

function placement(doc: StudioDocument, id: string) {
  const layout = doc.layouts.find((layout) => layout.ratio === doc.activeRatio)!;
  const panel = layout.panels.find((panel) =>
    panel.elements.some((item) => item.elementId === id),
  )!;
  return { panel, transform: panel.elements.find((item) => item.elementId === id)!.transform };
}

function oppositeAnchor(doc: StudioDocument, id: string, edge: 'e' | 's') {
  const { panel, transform: t } = placement(doc, id),
    size = canvasSize(doc.activeRatio, 1080);
  const pw = panel.rect.width * size.width,
    ph = panel.rect.height * size.height;
  const cx = (panel.rect.x + (t.x + t.width / 2) * panel.rect.width) * size.width;
  const cy = (panel.rect.y + (t.y + t.height / 2) * panel.rect.height) * size.height;
  const x = edge === 'e' ? (-t.width * pw) / 2 : 0,
    y = edge === 's' ? (-t.height * ph) / 2 : 0;
  const angle = (t.rotation * Math.PI) / 180;
  return {
    x: cx + x * Math.cos(angle) - y * Math.sin(angle),
    y: cy + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

async function resize(
  page: Page,
  touch: boolean,
  doc: StudioDocument,
  id: string,
  edge: 'e' | 's',
) {
  const handle = page.locator(`[data-resize-edge="${edge}"]`);
  await handle.scrollIntoViewIfNeeded();
  await expect(handle).toBeEnabled();
  const bounds = (await handle.boundingBox())!,
    canvas = (await card(page).boundingBox())!;
  const start = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const angle = (placement(doc, id).transform.rotation * Math.PI) / 180;
  const delta =
    edge === 'e'
      ? { x: 14 * Math.cos(angle), y: 14 * Math.sin(angle) }
      : { x: -14 * Math.sin(angle), y: 14 * Math.cos(angle) };
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest('[data-resize-edge]')
          ?.getAttribute('data-resize-edge'),
      start,
    ),
  ).toBe(edge);
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      await page.waitForTimeout(400);
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
    await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 5 });
    await page.mouse.up();
  }
  return {
    edge,
    input: touch ? 'trusted CDP touch / 400ms hold' : 'mouse drag',
    expectedNormalizedDelta: 14 / (edge === 'e' ? canvas.width : canvas.height),
    tolerance: 1 / (edge === 'e' ? canvas.width : canvas.height) + 0.0001,
  };
}

function assertIndependentResize(
  beforeDoc: StudioDocument,
  afterDoc: StudioDocument,
  id: string,
  edge: 'e' | 's',
  delta: Awaited<ReturnType<typeof resize>>,
) {
  const beforeT = placement(beforeDoc, id).transform,
    afterT = placement(afterDoc, id).transform;
  const changed = edge === 'e' ? 'width' : 'height',
    fixed = edge === 'e' ? 'height' : 'width';
  expect(afterT[changed]).toBeGreaterThan(beforeT[changed]);
  expect(Math.abs(afterT[changed] - beforeT[changed] - delta.expectedNormalizedDelta)).toBeLessThan(
    delta.tolerance,
  );
  expect(afterT[fixed]).toBe(beforeT[fixed]);
  expect(afterT.rotation).toBe(beforeT.rotation);
  expect(afterDoc.elements).toEqual(beforeDoc.elements);
  const anchorBefore = oppositeAnchor(beforeDoc, id, edge),
    anchorAfter = oppositeAnchor(afterDoc, id, edge);
  expect(anchorAfter.x).toBeCloseTo(anchorBefore.x, 7);
  expect(anchorAfter.y).toBeCloseTo(anchorBefore.y, 7);
  for (const layout of beforeDoc.layouts)
    for (const panel of layout.panels)
      for (const element of panel.elements)
        if (layout.ratio !== beforeDoc.activeRatio || element.elementId !== id)
          expect(
            afterDoc.layouts
              .find((item) => item.ratio === layout.ratio)!
              .panels.find((item) => item.panelId === panel.panelId)!
              .elements.find((item) => item.elementId === element.elementId),
          ).toEqual(element);
}

async function handleCenters(page: Page) {
  await card(page).scrollIntoViewIfNeeded();
  const hits = await page.evaluate(() => {
    const key = (node: Element | null | undefined) =>
      node?.hasAttribute('data-resize-edge')
        ? `edge:${node.getAttribute('data-resize-edge')}`
        : node?.hasAttribute('data-transform-handle')
          ? `transform:${node.getAttribute('data-transform-handle')}`
          : null;
    return [
      ...document.querySelectorAll('button[data-resize-edge],button[data-transform-handle]'),
    ].map((button) => {
      const box = button.getBoundingClientRect();
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const hit = document.elementFromPoint(center.x, center.y)?.closest('button');
      return {
        expected: key(button),
        actual: key(hit),
        center,
        width: box.width,
        height: box.height,
      };
    });
  });
  expect(hits.map((hit) => hit.expected).sort()).toEqual([
    'edge:e',
    'edge:n',
    'edge:s',
    'edge:w',
    'transform:rotation',
    'transform:tail',
  ]);
  for (const hit of hits) {
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
    expect(hit.actual, JSON.stringify(hit)).toBe(hit.expected);
  }
  return hits;
}

async function smallTransformDrag(
  page: Page,
  touch: boolean,
  start: { x: number; y: number },
  delta: { x: number; y: number },
  unchangedFrame: string,
) {
  if (touch) {
    const client = await page.context().newCDPSession(page);
    try {
      await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      await page.waitForTimeout(400);
      expect(await frame(page)).toBe(unchangedFrame);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x + delta.x, y: start.y + delta.y, id: 1 }],
      });
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } finally {
      await client.detach();
    }
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    expect(await frame(page)).toBe(unchangedFrame);
    await page.mouse.move(start.x + delta.x, start.y + delta.y);
    await page.mouse.up();
  }
}

async function firstTransformSteps(
  page: Page,
  touch: boolean,
  info: TestInfo,
  doc: StudioDocument,
  id: string,
) {
  const measurements = [];
  let previous = doc;
  for (const kind of ['rotation', 'tail'] as const) {
    const hits = await handleCenters(page);
    const start = hits.find((hit) => hit.expected === `transform:${kind}`)!.center;
    const canvas = (await card(page).boundingBox())!;
    const { panel, transform: t } = placement(previous, id);
    const angle = (t.rotation * Math.PI) / 180;
    const center = {
      x: canvas.x + (panel.rect.x + (t.x + t.width / 2) * panel.rect.width) * canvas.width,
      y: canvas.y + (panel.rect.y + (t.y + t.height / 2) * panel.rect.height) * canvas.height,
    };
    const radius = Math.hypot(start.x - center.x, start.y - center.y);
    const delta =
      kind === 'rotation'
        ? { x: (-4 * (start.y - center.y)) / radius, y: (4 * (start.x - center.x)) / radius }
        : { x: 4 * Math.sin(angle), y: -4 * Math.cos(angle) };
    const beforeFrame = await frame(page);
    await smallTransformDrag(page, touch, start, delta, beforeFrame);
    const after = (await saveDocument(page, info, `첫 이동 ${kind}`)).document;
    const afterT = placement(after, id).transform;
    let expected: number, actual: number, tolerance: number;
    if (kind === 'rotation') {
      expected = (Math.atan2(4, radius) * 180) / Math.PI;
      actual = ((afterT.rotation - t.rotation + 540) % 360) - 180;
      // Client coordinates can quantize by one CSS pixel per endpoint.
      tolerance = (Math.atan2(1.5, radius) * 180) / Math.PI + 0.01;
      expect(actual).toBeGreaterThan(0.05);
      expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
      expect({ ...afterT, rotation: t.rotation }).toEqual(t);
      expect(after.elements).toEqual(previous.elements);
      const expectedLayouts = structuredClone(previous.layouts);
      expectedLayouts
        .find((layout) => layout.ratio === previous.activeRatio)!
        .panels.find((item) => item.panelId === panel.panelId)!
        .elements.find((item) => item.elementId === id)!.transform.rotation = afterT.rotation;
      expect(after.layouts).toEqual(expectedLayouts);
    } else {
      const oldBubble = previous.elements.find((element) => element.id === id)!;
      const newBubble = after.elements.find((element) => element.id === id)!;
      expect(oldBubble.kind).toBe('bubble');
      expect(newBubble.kind).toBe('bubble');
      if (oldBubble.kind !== 'bubble' || newBubble.kind !== 'bubble')
        throw new Error('Expected bubble');
      expect(oldBubble.tail?.side ?? 'bottom').toBe('bottom');
      expect(newBubble.tail?.side).toBe('bottom');
      expected = -4 / (t.height * panel.rect.height * canvas.height);
      actual = newBubble.tail!.y - oldBubble.tail!.y;
      tolerance = 1 / (t.height * panel.rect.height * canvas.height) + 0.0001;
      expect(actual).toBeLessThan(0);
      expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
      expect(Math.abs(newBubble.tail!.x - oldBubble.tail!.x)).toBeLessThan(
        1 / (t.width * panel.rect.width * canvas.width) + 0.0001,
      );
      expect(after.elements).toEqual(
        previous.elements.map((element) =>
          element.id === id ? { ...element, tail: newBubble.tail } : element,
        ),
      );
      expect(after.layouts).toEqual(previous.layouts);
    }
    const afterFrame = await frame(page);
    expect(afterFrame).not.toBe(beforeFrame);
    await page.getByRole('button', { name: '실행 취소', exact: true }).click();
    expect(await frame(page)).toBe(beforeFrame);
    await page.getByRole('button', { name: '다시 실행', exact: true }).click();
    expect(await frame(page)).toBe(afterFrame);
    measurements.push({
      kind,
      start,
      delta,
      expected,
      actual,
      tolerance,
      frameUnchangedUntilMove: true,
    });
    previous = after;
  }
  return measurements;
}

test('8비율에서 여러 문구·이미지와 말풍선의 가로·세로 직접 조절을 독립 보존하고 저장 복원·PNG를 일치시킨다', async ({
  page,
  isMobile,
}, info) => {
  test.skip(before, 'Before phase captures original geometry only.');
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const textIds: string[] = [];
  for (const text of ['문구 하나', '문구 둘', '문구 셋']) {
    await goPage(page, 'text');
    await activate(addText(page), isMobile);
    await (await reveal(page, '문구', 'text')).fill(text);
    textIds.push((await selectedLayer(page).getAttribute('data-element-id'))!);
  }
  expect(new Set(textIds).size).toBe(3);
  await openResources(page);
  await resources(page).getByRole('tab', { name: '미분류', exact: true }).click();
  const files = ['portrait.png', 'landscape.jpg'];
  const resourceIds = [];
  for (const file of files)
    resourceIds.push(
      `resource-${createHash('sha256')
        .update(await readFile(`tests/fixtures/images/${file}`))
        .digest('hex')}`,
    );
  await resources(page)
    .getByLabel('자원 이미지 파일', { exact: true })
    .setInputFiles(files.map((file) => `tests/fixtures/images/${file}`));
  await expect(resources(page).locator('[data-resource-id]')).toHaveCount(2);
  const imageIds: string[] = [];
  for (const id of [resourceIds[0]!, resourceIds[1]!, resourceIds[0]!]) {
    await openResources(page);
    const previous = await selectedLayer(page).getAttribute('data-element-id');
    await activate(resources(page).locator(`[data-resource-id="${id}"]`), isMobile);
    await expect.poll(() => selectedLayer(page).getAttribute('data-element-id')).not.toBe(previous);
    imageIds.push((await selectedLayer(page).getAttribute('data-element-id'))!);
  }
  expect(new Set(imageIds).size).toBe(3);
  await openResources(page);
  await resources(page).getByRole('tab', { name: '말풍선', exact: true }).click();
  await activate(resources(page).locator('[data-bubble-shape="speech"]'), isMobile);
  await expect(selectedLayer(page)).toHaveAttribute('aria-label', /말풍선/);
  const bubbleId = (await selectedLayer(page).getAttribute('data-element-id'))!;
  await (await reveal(page, '문구', 'text')).fill('가로와 세로 독립');
  const matrix = [],
    hitChecks = [],
    firstSteps = [],
    frames = new Map<string, string>();
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    await rail(page).locator(`[data-element-id="${bubbleId}"]`).click();
    for (const [label, value] of [
      ['요소 폭', 38],
      ['요소 높이', 22],
      ['요소 가로 위치', 25],
      ['요소 세로 위치', 35],
      ['요소 회전', 23],
    ] as const)
      await number(page, label, value);
    let previous = (await saveDocument(page, info, `독립 축 기준 ${ratio.replace(':', '-')}`))
      .document;
    hitChecks.push({ ratio, state: 'initial', hits: await handleCenters(page) });
    for (const edge of ['e', 's'] as const) {
      const beforeFrame = await frame(page);
      const delta = await resize(page, isMobile, previous, bubbleId, edge);
      const after = (await saveDocument(page, info, `독립 축 ${ratio.replace(':', '-')}-${edge}`))
        .document;
      assertIndependentResize(previous, after, bubbleId, edge, delta);
      const afterFrame = await frame(page);
      await page.getByRole('button', { name: '실행 취소', exact: true }).click();
      expect(await frame(page)).toBe(beforeFrame);
      await page.getByRole('button', { name: '다시 실행', exact: true }).click();
      expect(await frame(page)).toBe(afterFrame);
      matrix.push({
        ratio,
        ...delta,
        before: placement(previous, bubbleId).transform,
        after: placement(after, bubbleId).transform,
      });
      previous = after;
      hitChecks.push({ ratio, state: `after-${edge}`, hits: await handleCenters(page) });
    }
    if (ratio === '1:1')
      firstSteps.push(...(await firstTransformSteps(page, isMobile, info, previous, bubbleId)));
    frames.set(ratio, await frame(page));
  }
  const final = await saveDocument(page, info, '독립 축 8비율 완성');
  const bubble = final.document.elements.find((element) => element.id === bubbleId)!;
  await goPage(page, 'layers');
  await page.getByRole('button', { name: '선택 잠금', exact: true }).click();
  await expect(page.locator('[data-resize-edge]')).toHaveCount(0);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('[data-resize-edge]')).toHaveCount(4);
  await page.getByRole('button', { name: '선택 숨김', exact: true }).click();
  await expect(page.locator('[data-resize-edge]')).toHaveCount(0);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(page.locator('[data-resize-edge]')).toHaveCount(4);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '독립 축 8비율 완성');
  const restored = await saveDocument(page, info, '독립 축 복원 확인');
  expect(normalized(restored.document)).toEqual(normalized(final.document));
  const restoredBubble = restored.document.elements.find((element) => element.kind === 'bubble')!;
  expect(restoredBubble).toEqual({ ...bubble, id: restoredBubble.id });
  const pixels = [];
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    expect(await frame(page)).toBe(frames.get(ratio));
    pixels.push({
      ratio,
      comparison: await downloadPng(page, info, `section-tools-${ratio.replace(':', '-')}`),
    });
  }
  expect(errors).toEqual([]);
  await closeMobilePanel(page);
  await writeFile(
    info.outputPath('independent-bubble-axes.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        textIds,
        imageIds,
        bubbleId,
        matrix,
        hitChecks,
        firstSteps,
        templateRestore: true,
        pixels,
        errors,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('section-tools-final.png'), fullPage: true });
});
