import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
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

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
type Point = { x: number; y: number };
type Placement = { x: number; y: number; width: number; height: number; rotation: number };
const rotationHandle = (page: Page) =>
  page.getByRole('button', { name: '요소 회전 조절', exact: true });
const tailHandle = (page: Page) =>
  page.getByRole('button', { name: '말풍선 꼬리 조절', exact: true });

async function middle(locator: Locator): Promise<Point> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('Visible gesture target has no bounds');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Real mouse / CDP touch input. A 380ms hold exercises the production 350ms gate. */
async function driver(page: Page, mobile: boolean) {
  const client: CDPSession | undefined = mobile
    ? await page.context().newCDPSession(page)
    : undefined;
  if (client)
    await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  return {
    async drag(from: Point, to: Point, hold: boolean | number = true) {
      if (client) {
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...from, id: 1 }],
        });
        const duration = typeof hold === 'number' ? hold : hold ? 380 : 0;
        if (duration) await page.waitForTimeout(duration);
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
          await page.evaluate(
            () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
          );
        }
        await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 5 });
        await page.mouse.up();
      }
    },
    async stationary(point: Point) {
      if (!client) throw new Error('Stationary hold requires the real touch driver');
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...point, id: 1 }],
      });
      await page.waitForTimeout(600);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    },
    async close() {
      await client?.detach();
    },
  };
}
type Driver = Awaited<ReturnType<typeof driver>>;

async function placement(page: Page): Promise<Placement> {
  await reveal(page, '요소 가로 위치');
  const values: number[] = [];
  for (const name of ['요소 가로 위치', '요소 세로 위치', '요소 폭', '요소 높이', '요소 회전'])
    values.push(Number(await page.getByLabel(name, { exact: true }).inputValue()));
  return {
    x: values[0]! / 100,
    y: values[1]! / 100,
    width: values[2]! / 100,
    height: values[3]! / 100,
    rotation: values[4]!,
  };
}

async function atLocal(page: Page, placed: Placement, local: Point): Promise<Point> {
  await card(page).scrollIntoViewIfNeeded();
  const box = (await card(page).boundingBox())!;
  const radians = (placed.rotation * Math.PI) / 180;
  const x = (local.x - 0.5) * placed.width * box.width;
  const y = (local.y - 0.5) * placed.height * box.height;
  return {
    x:
      box.x +
      (placed.x + placed.width / 2) * box.width +
      x * Math.cos(radians) -
      y * Math.sin(radians),
    y:
      box.y +
      (placed.y + placed.height / 2) * box.height +
      x * Math.sin(radians) +
      y * Math.cos(radians),
  };
}

async function rotate(page: Page, input: Driver, degrees: number) {
  const before = await placement(page);
  const center = await atLocal(page, before, { x: 0.5, y: 0.5 });
  const from = await middle(rotationHandle(page));
  const radians = (degrees * Math.PI) / 180;
  const x = from.x - center.x,
    y = from.y - center.y;
  await input.drag(from, {
    x: center.x + x * Math.cos(radians) - y * Math.sin(radians),
    y: center.y + x * Math.sin(radians) + y * Math.cos(radians),
  });
  const after = await placement(page);
  expect(Math.abs(after.rotation - before.rotation - degrees)).toBeLessThan(1);
  expect(after.x).toBe(before.x);
  expect(after.y).toBe(before.y);
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  return { before, after };
}

async function move(page: Page, input: Driver) {
  const before = await placement(page);
  const from = await atLocal(page, before, { x: 0.5, y: 0.5 });
  const box = (await card(page).boundingBox())!;
  await input.drag(from, { x: from.x + 12, y: from.y + 8 }, 600);
  await expect(page.getByRole('textbox', { name: '카드 문구 직접 편집', exact: true })).toHaveCount(
    0,
  );
  const after = await placement(page);
  expect(Math.abs(after.x - before.x - 12 / box.width)).toBeLessThan(0.002);
  expect(Math.abs(after.y - before.y - 8 / box.height)).toBeLessThan(0.002);
  expect(after.rotation).toBe(before.rotation);
  return { before, after };
}

async function addBubble(page: Page) {
  await goPage(page, 'elements');
  await page.getByRole('button', { name: '말풍선 추가', exact: true }).click();
  await expect(selectedLayer(page)).toHaveAttribute('aria-label', /말풍선/);
}

async function setSquare(page: Page) {
  await reveal(page, '요소 가로 위치');
  for (const [label, value] of [
    ['요소 가로 위치', 25],
    ['요소 세로 위치', 25],
    ['요소 폭', 50],
    ['요소 높이', 50],
    ['요소 회전', 0],
  ] as const) {
    const input = page.getByLabel(label, { exact: true });
    await input.fill(String(value));
    await input.press('Enter');
  }
  await page.getByRole('checkbox', { name: '정렬선과 자동 맞춤', exact: true }).uncheck();
}

async function undoCount(page: Page) {
  const text = await page.locator('.toolbar-history-count').textContent();
  const match = /취소 (\d+)/.exec(text ?? '');
  if (!match) throw new Error('History count unavailable');
  return Number(match[1]);
}

async function tailState(page: Page) {
  await goPage(page, 'style');
  return {
    side: await page.getByLabel('꼬리 방향', { exact: true }).inputValue(),
    length: Number(await page.getByLabel('꼬리 길이', { exact: true }).inputValue()),
    position: Number(await page.getByLabel('꼬리 위치', { exact: true }).inputValue()),
  };
}

async function dragTail(page: Page, input: Driver, side: 'bottom' | 'top' | 'left' | 'right') {
  const placed = await placement(page);
  const destination = {
    bottom: { x: 0.5, y: 0.95 },
    top: { x: 0.5, y: 0.05 },
    left: { x: 0.05, y: 0.5 },
    right: { x: 0.95, y: 0.5 },
  }[side];
  const to = await atLocal(page, placed, destination);
  const from = await middle(tailHandle(page));
  await input.drag(from, to);
  const result = await tailState(page);
  expect(result.side).toBe(side);
  // Quantized pointer coordinates are judged in physical CSS pixels. One pixel
  // exceeds 5% of the 18% tail band on small portrait layouts.
  const bounds = (await card(page).boundingBox())!;
  const vertical = side === 'top' || side === 'bottom';
  const lengthAxis = vertical ? bounds.height * placed.height : bounds.width * placed.width;
  const positionAxis = vertical ? bounds.width * placed.width : bounds.height * placed.height;
  const lengthErrorCssPixels = (Math.abs(result.length - 72.222222) / 100) * 0.18 * lengthAxis;
  const positionErrorCssPixels = (Math.abs(result.position - 50) / 100) * positionAxis;
  expect(lengthErrorCssPixels).toBeLessThanOrEqual(2);
  expect(positionErrorCssPixels).toBeLessThanOrEqual(2);
  return { ...result, lengthErrorCssPixels, positionErrorCssPixels };
}

test('네 요소 유형의 실제 회전·이동, 작은 문구 크기와 길게 누르기·잠금·숨김을 검증한다', async ({
  page,
}, info) => {
  test.setTimeout(150_000); // Interaction matrix budget, not a product performance assertion.
  await ready(page);
  const mobile = info.project.name.startsWith('mobile'),
    input = await driver(page, mobile);
  const evidence: unknown[] = [];
  try {
    const original = await placement(page);
    const fontInput = await reveal(page, '문구 크기', 'text');
    const beforeFont = Number.parseFloat(
      (await fontInput.locator('xpath=..').locator('output').textContent())!,
    );
    if (mobile) {
      const untouched = await frame(page);
      await input.stationary(await atLocal(page, original, { x: 0.5, y: 0.5 }));
      await expect(page.getByRole('button', { name: '레이어지우기', exact: true })).toBeVisible();
      await page
        .getByRole('group', { name: '선택 레이어 메뉴', exact: true })
        .getByRole('button', { name: '내용 수정', exact: true })
        .click();
      await expect(
        page.getByRole('textbox', { name: '카드 문구 직접 편집', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('group', { name: '카드 문구 편집', exact: true })
        .getByRole('button', { name: '취소', exact: true })
        .click();
      expect(await frame(page)).toBe(untouched);
      const early = await middle(
        page.getByRole('button', { name: '요소 크기 조절 오른쪽 아래', exact: true }),
      );
      await input.drag(early, { x: early.x + 20, y: early.y + 20 }, false);
      expect(await placement(page)).toEqual(original);
      expect(await frame(page)).toBe(untouched);
    }
    const small = await middle(
      page.getByRole('button', { name: '요소 크기 조절 오른쪽 아래', exact: true }),
    );
    await input.drag(small, { x: small.x + 1, y: small.y + 1 });
    const changedFontInput = await reveal(page, '문구 크기', 'text');
    const afterFont = Number.parseFloat(
      (await changedFontInput.locator('xpath=..').locator('output').textContent())!,
    );
    expect(afterFont).toBeGreaterThan(beforeFont);
    expect(afterFont / beforeFont).toBeLessThan(1.25);
    evidence.push({ check: 'small-text-first-resize', original, beforeFont, afterFont });

    for (const kind of ['text', 'image', 'character', 'bubble'] as const) {
      if (kind === 'image') {
        await page.getByRole('tab', { name: '미분류', exact: true }).click();
        await page
          .getByLabel('자원 이미지 파일', { exact: true })
          .setInputFiles('tests/fixtures/images/portrait.png');
        const resource = page.getByRole('button', { name: 'portrait.png 배치', exact: true });
        await expect(resource).toBeEnabled();
        await resource.click();
        await expect(selectedLayer(page)).toHaveAttribute('aria-label', /이미지/);
      } else if (kind === 'character') {
        await goPage(page, 'elements');
        await page
          .locator('[data-tool-page="elements"] summary')
          .filter({ hasText: /^캐릭터 추가$/ })
          .click();
        await page.getByRole('button', { name: '캐릭터 추가', exact: true }).click();
        await expect(selectedLayer(page)).toHaveAttribute('aria-label', /캐릭터/);
      } else if (kind === 'bubble') await addBubble(page);
      if (kind !== 'text') await setSquare(page);
      else {
        await goPage(page, 'elements');
        await page.getByRole('checkbox', { name: '정렬선과 자동 맞춤', exact: true }).uncheck();
      }
      const beforeFrame = await frame(page),
        count = await undoCount(page);
      const rotation = await rotate(page, input, 30);
      await expect.poll(() => frame(page)).not.toBe(beforeFrame);
      const rotatedFrame = await frame(page);
      expect(await undoCount(page)).toBe(count + 1);
      await page.getByRole('button', { name: '실행 취소', exact: true }).click();
      await expect.poll(() => frame(page)).toBe(beforeFrame);
      await page.getByRole('button', { name: '다시 실행', exact: true }).click();
      await expect.poll(() => frame(page)).toBe(rotatedFrame);
      if (mobile) {
        const before = await placement(page),
          from = await atLocal(page, before, { x: 0.5, y: 0.5 });
        const untouched = await frame(page);
        await input.drag(from, { x: from.x + 24, y: from.y + 12 }, false);
        expect(await placement(page)).toEqual(before);
        expect(await frame(page)).toBe(untouched);
      }
      const moved = await move(page, input);
      evidence.push({
        kind,
        layerId: await selectedLayer(page).getAttribute('data-element-id'),
        rotation,
        moved,
      });
    }
    await goPage(page, 'layers');
    await page.getByRole('button', { name: '선택 잠금', exact: true }).click();
    await expect(rotationHandle(page)).toHaveCount(0);
    await expect(tailHandle(page)).toHaveCount(0);
    await expect(page.locator('button[data-resize-handle]')).toHaveCount(0);
    await goPage(page, 'elements');
    await expect(page.getByLabel('요소 회전', { exact: true })).toBeDisabled();
    await goPage(page, 'layers');
    await page.getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
    await page.getByRole('button', { name: '선택 숨김', exact: true }).click();
    await expect(rotationHandle(page)).toHaveCount(0);
    await expect(tailHandle(page)).toHaveCount(0);
    await expect(page.locator('button[data-resize-handle]')).toHaveCount(0);
    await page.getByRole('button', { name: '선택 숨김 해제', exact: true }).click();
    await expect(rotationHandle(page)).toBeVisible();
    await expect(tailHandle(page)).toBeVisible();
    const saved = await savedDocument(page, info, 'transform-types');
    expect(new Set(saved.elements.map((element) => element.kind))).toEqual(
      new Set(['text', 'image', 'character', 'bubble', 'frame', 'panel-background']),
    );
    await writeFile(
      info.outputPath('transform-types-observations.json'),
      JSON.stringify(evidence, null, 2),
    );
  } finally {
    await input.close();
  }
});

test('말풍선 꼬리를 네 방향으로 직접 끌어 길이를 바꾸고 키보드 조정도 보존한다', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await ready(page);
  await addBubble(page);
  await setSquare(page);
  const input = await driver(page, info.project.name.startsWith('mobile'));
  try {
    const observations = [];
    if (info.project.name.startsWith('mobile')) {
      const before = await tailState(page),
        unchanged = await frame(page),
        placed = await placement(page);
      const to = await atLocal(page, placed, { x: 0.95, y: 0.5 }),
        from = await middle(tailHandle(page));
      await input.drag(from, to, false);
      expect(await tailState(page)).toEqual(before);
      expect(await frame(page)).toBe(unchanged);
    }
    for (const side of ['bottom', 'top', 'left', 'right'] as const)
      observations.push(await dragTail(page, input, side));
    const before = await placement(page);
    await rotationHandle(page).press('ArrowRight');
    expect((await placement(page)).rotation).toBeCloseTo(before.rotation + 1, 2);
    await rotationHandle(page).press('Shift+ArrowLeft');
    expect((await placement(page)).rotation).toBeCloseTo(before.rotation - 14, 2);
    const beforeTailKey = await tailState(page);
    await tailHandle(page).press('ArrowDown');
    const tail = await tailState(page);
    expect(tail.side).toBe('right');
    expect(tail.position - beforeTailKey.position).toBeCloseTo(1, 1);
    await writeFile(
      info.outputPath('tail-directions-observations.json'),
      JSON.stringify(
        { pointer: observations, keyboard: { rotation: (await placement(page)).rotation, tail } },
        null,
        2,
      ),
    );
  } finally {
    await input.close();
  }
});

test('8개 비율에서 회전·이동·꼬리 변경을 저장 복원하고 실제 PNG 전 RGBA가 미리보기와 같다', async ({
  page,
}, info) => {
  test.setTimeout(180_000); // Eight real downloads/reloads; this is not a timing benchmark.
  await ready(page);
  await addBubble(page);
  const input = await driver(page, info.project.name.startsWith('mobile'));
  const observations = [];
  try {
    for (const ratio of ratios) {
      await goPage(page, 'layout');
      await page
        .getByRole('group', { name: '화면 비율', exact: true })
        .getByRole('button', { name: ratio, exact: true })
        .click();
      await expect(card(page)).toHaveAttribute('aria-label', `카드 ${ratio} 비율`);
      await setSquare(page);
      await goPage(page, 'style');
      await page.getByLabel('꼬리 방향', { exact: true }).selectOption('bottom');
      await number(page, '꼬리 길이', 100, 'style');
      await number(page, '꼬리 위치', 50, 'style');
      const rotated = await rotate(page, input, 20),
        moved = await move(page, input),
        tail = await dragTail(page, input, 'right');
      const before = await frame(page),
        layerId = await selectedLayer(page).getAttribute('data-element-id');
      const name = `transforms-${ratio.replace(':', '-')}`;
      const document = await savedDocument(page, info, name);
      const element = document.elements.find((item) => item.id === layerId);
      expect(element?.kind).toBe('bubble');
      if (element?.kind !== 'bubble') throw new Error('Saved bubble missing');
      expect(element.tail?.side).toBe('right');
      const placed = document.layouts
        .find((layout) => layout.ratio === ratio)!
        .panels.flatMap((panel) => panel.elements)
        .find((item) => item.elementId === layerId)!;
      expect(Math.abs(placed.transform.rotation - 20)).toBeLessThan(1);
      await page.reload();
      await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
        timeout: 20_000,
      });
      await restore(page, name);
      await expect(card(page)).toHaveAttribute('aria-label', `카드 ${ratio} 비율`);
      await expect.poll(() => frame(page)).toBe(before);
      await expect(rail(page).getByRole('button', { name: /말풍선/ })).toHaveCount(1);
      const pixels = await downloadPng(page, info, name);
      observations.push({ ratio, rotated, moved, tail, pixels });
    }
    await writeFile(
      info.outputPath('eight-ratios-transform-observations.json'),
      JSON.stringify(observations, null, 2),
    );
  } finally {
    await input.close();
  }
});
