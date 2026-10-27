import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import {
  activate,
  card,
  closeMobilePanel,
  downloadPng,
  frame,
  goPage,
  library,
  loadSelected,
  normalized,
  openResources,
  ready,
  resources,
  restore,
  reveal,
  saveDocument,
  selectedLayer,
} from './editorial-controls';

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const categories = ['템플릿', '이미지', '문구', '배경', '레이어', '스타일', '저장'] as const;
const addText = (page: Page) =>
  page.locator('.quick-add-bar').getByRole('button', { name: '문구 추가', exact: true });

async function alpha(page: Page) {
  return card(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0,
      opaque = 0,
      partial = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] === 0) transparent++;
      else if (pixels[index] === 255) opaque++;
      else partial++;
    }
    return { width: canvas.width, height: canvas.height, transparent, opaque, partial };
  });
}

test('편집 배경색 없음은 템플릿·새로고침·JSON 왕복 후에도 유지되고 8비율 PNG 알파가 캔버스와 같다', async ({
  page,
}, info) => {
  // Eight real PNG files plus template/JSON round trips; this is a functional test budget.
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  expect((await alpha(page)).transparent).toBe(0);
  const scope = await reveal(page, '배경 적용 범위', 'background');
  await scope.selectOption('whole');
  const noColor = page.getByLabel('배경색 없음', { exact: true });
  await expect(noColor).not.toBeChecked();
  const originalColor = await page.getByLabel('배경 색상', { exact: true }).inputValue();
  await noColor.check();
  await expect(page.getByLabel('배경 색상', { exact: true })).toHaveValue(originalColor);
  await scope.selectOption('panel');
  const independent = page.getByRole('button', { name: '이 컷에서 독립 편집', exact: true });
  if (await independent.count()) await independent.click();
  await noColor.check();
  expect((await alpha(page)).transparent).toBeGreaterThan(0);
  const transparentFrame = await frame(page);
  await noColor.uncheck();
  expect((await alpha(page)).transparent).toBe(0);
  await page.getByRole('button', { name: '실행 취소', exact: true }).click();
  expect(await frame(page)).toBe(transparentFrame);
  await expect(noColor).toBeChecked();

  const previews = new Map<string, string>();
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    previews.set(ratio, await frame(page));
    expect((await alpha(page)).transparent).toBeGreaterThan(0);
  }
  const original = await saveDocument(page, info, '편집 투명 배경');
  expect(original.document.background).toMatchObject({ transparent: true });
  const backdrop = original.document.elements.find(
    (element) => element.kind === 'panel-background',
  );
  expect(backdrop).toMatchObject({ background: { transparent: true, inherit: false } });
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await restore(page, '편집 투명 배경');
  const restored = await saveDocument(page, info, '투명 배경 복원');
  expect(normalized(restored.document)).toEqual(normalized(original.document));
  const before = await frame(page);
  const optionsBefore = await library(page)
    .getByLabel('저장된 템플릿', { exact: true })
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  await library(page).getByLabel('템플릿 JSON 파일', { exact: true }).setInputFiles(original.path);
  await expect(library(page).getByRole('status')).toContainText('새 사본으로 가져왔습니다');
  expect(await frame(page)).toBe(before);
  const optionsAfter = await library(page)
    .getByLabel('저장된 템플릿', { exact: true })
    .locator('option')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLOptionElement).value));
  const imported = optionsAfter.filter((id) => id && !optionsBefore.includes(id));
  expect(imported).toHaveLength(1);
  await library(page).getByLabel('저장된 템플릿', { exact: true }).selectOption(imported[0]!);
  await loadSelected(page);
  expect(normalized((await saveDocument(page, info, '투명 배경 JSON 왕복')).document)).toEqual(
    normalized(original.document),
  );
  const pixels = [];
  for (const ratio of ratios) {
    await (await goPage(page, 'layout')).getByRole('button', { name: ratio, exact: true }).click();
    expect(await frame(page)).toBe(previews.get(ratio));
    const statistics = await alpha(page);
    expect(statistics.transparent).toBeGreaterThan(0);
    expect(statistics.opaque).toBeGreaterThan(0);
    pixels.push({
      ratio,
      alpha: statistics,
      comparison: await downloadPng(page, info, `transparent-${ratio.replace(':', '-')}`),
    });
  }
  const blankPixel = await card(page).evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let y = 32; y < canvas.height - 32; y += 32)
      for (let x = 32; x < canvas.width - 32; x += 32) {
        let blank = true;
        for (let dy = -16; dy <= 16 && blank; dy++)
          for (let dx = -16; dx <= 16; dx++)
            if (data[((y + dy) * canvas.width + x + dx) * 4 + 3] !== 0) {
              blank = false;
              break;
            }
        if (blank) return { x, y };
      }
    throw new Error('No transparent interior region to verify JPG background flattening');
  });
  const output = await goPage(page, 'export');
  await output.getByLabel('파일 형식', { exact: true }).selectOption('jpg');
  const pendingJpg = page.waitForEvent('download');
  await output.getByRole('button', { name: 'JPG 저장', exact: true }).click();
  const jpg = await pendingJpg;
  const jpgPath = info.outputPath('transparent-background-white.jpg');
  await jpg.saveAs(jpgPath);
  const jpgBytes = await readFile(jpgPath);
  expect([...jpgBytes.subarray(0, 2)]).toEqual([255, 216]);
  const flattened = await page.evaluate(
    async ({ source, point }) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return [...context.getImageData(point.x, point.y, 1, 1).data];
    },
    { source: `data:image/jpeg;base64,${jpgBytes.toString('base64')}`, point: blankPixel },
  );
  // JPG is lossy; a transparent interior must become opaque white, not implicit black.
  for (const channel of flattened.slice(0, 3)) expect(channel).toBeGreaterThanOrEqual(250);
  expect(flattened[3]).toBe(255);
  expect(await frame(page)).toBe(previews.get('16:9'));
  await output.getByLabel('파일 형식', { exact: true }).selectOption('webp');
  await expect(output.getByRole('button', { name: 'WebP 저장', exact: true })).toBeEnabled();
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('editorial-transparency.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        legacyDefaultOpaque: true,
        undoRestoresTransparency: true,
        templateRestore: true,
        jsonRoundTrip: true,
        pixels,
        jpgWhiteFlatten: { blankPixel, actual: flattened },
        errors,
      },
      null,
      2,
    ),
  );
});

async function mobileGeometry(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector<HTMLCanvasElement>('canvas[aria-label^="카드 "]')!;
    const box = card.getBoundingClientRect();
    const dock = document.querySelector<HTMLElement>('.mobile-tool-dock')!.getBoundingClientRect();
    const active = [...document.querySelectorAll<HTMLElement>('[data-mobile-active="true"]')]
      .filter(
        (element) =>
          element.getBoundingClientRect().width && element.getBoundingClientRect().height,
      )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: element.className,
          top: rect.top,
          bottom: rect.bottom,
          height: rect.height,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowY: getComputedStyle(element).overflowY,
        };
      });
    return {
      viewport: { width: innerWidth, height: innerHeight },
      card: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      },
      dock: { top: dock.top, bottom: dock.bottom },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        scrollY,
      },
      active,
    };
  });
}

test('저장 동선을 줄이고 모바일 도구를 제목으로 열고 닫아도 카드·복수 문구·템플릿을 보존한다', async ({
  page,
  isMobile,
}, info) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const shell = page.locator('.studio-shell');
  const dock = page.locator('.mobile-tool-dock');
  const geometry = [];
  if (isMobile) {
    await expect(dock).toBeVisible();
    await expect(shell).toHaveAttribute('data-mobile-panel', 'closed');
    const closed = await mobileGeometry(page);
    for (const name of [...categories, '자원']) {
      const button = dock.getByRole('button', { name, exact: true });
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await button.tap();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(shell).toHaveAttribute(
        'data-mobile-panel',
        name === '자원' ? 'resources' : 'tools',
      );
      const open = await mobileGeometry(page);
      expect(open.card.left).toBeGreaterThanOrEqual(-1);
      expect(open.card.right).toBeLessThanOrEqual(open.viewport.width + 1);
      expect(open.card.top).toBeGreaterThanOrEqual(-1);
      expect(open.card.bottom).toBeLessThanOrEqual(open.viewport.height + 1);
      expect(open.card.bottom).toBeLessThanOrEqual(open.dock.top + 1);
      expect(open.document.width).toBeLessThanOrEqual(open.viewport.width + 1);
      expect(open.document.height).toBeLessThanOrEqual(closed.document.height + 1);
      expect(open.document.scrollY).toBe(closed.document.scrollY);
      expect(open.active.length).toBeGreaterThan(0);
      for (const panel of open.active) {
        expect(panel.top).toBeGreaterThanOrEqual(-1);
        expect(panel.top).toBeGreaterThanOrEqual(open.dock.bottom - 1);
        expect(panel.bottom).toBeLessThanOrEqual(open.viewport.height + 1);
        expect(panel.height).toBeLessThan(open.viewport.height);
        expect(open.card.bottom).toBeLessThanOrEqual(panel.top + 1);
      }
      geometry.push({ name, ...open });
      await button.tap();
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(shell).toHaveAttribute('data-mobile-panel', 'closed');
    }
    await goPage(page, 'elements');
    // Long content must scroll inside its bounded tool surface rather than extend the document.
    const active = page.locator('.studio-direct[data-mobile-active="true"]');
    const scrolling = await active.evaluate((element) => {
      const candidates = [element, ...element.querySelectorAll<HTMLElement>('*')].filter((node) => {
        const style = getComputedStyle(node);
        return (
          ['auto', 'scroll'].includes(style.overflowY) && node.scrollHeight > node.clientHeight + 1
        );
      });
      const target = candidates[0];
      if (!target) return { found: false, changed: false };
      const before = target.scrollTop;
      target.scrollTop = target.scrollHeight;
      return { found: true, changed: target.scrollTop > before };
    });
    expect(scrolling).toEqual({ found: true, changed: true });
    expect((await mobileGeometry(page)).document.height).toBeLessThanOrEqual(
      closed.document.height + 1,
    );
    await closeMobilePanel(page);
  } else {
    await expect(dock).toBeHidden();
    await page
      .locator('.studio-header-actions')
      .getByRole('button', { name: '저장', exact: true })
      .click();
    await expect(page.locator('[data-tool-page="export"]')).toBeVisible();
    await expect(page.locator('[data-tool-subpage="export"]')).toHaveText('이미지');
    await expect(page.getByRole('button', { name: 'PNG 저장', exact: true })).toBeEnabled();
  }
  const textIds: string[] = [];
  for (const text of ['모바일 첫 문구', '모바일 둘째 문구', '모바일 셋째 문구']) {
    await activate(addText(page), isMobile);
    await (await reveal(page, '문구', 'text')).fill(text);
    textIds.push((await selectedLayer(page).getAttribute('data-element-id'))!);
    await closeMobilePanel(page);
  }
  expect(new Set(textIds).size).toBe(3);
  const before = await frame(page);
  const saved = await saveDocument(page, info, '모바일 도구와 복수 문구');
  await expect(
    library(page).getByRole('button', { name: 'JSON 내보내기', exact: true }),
  ).toBeVisible();
  await restore(page, '모바일 도구와 복수 문구');
  expect(await frame(page)).toBe(before);
  expect(normalized((await saveDocument(page, info, '모바일 도구 복원')).document)).toEqual(
    normalized(saved.document),
  );
  await downloadPng(page, info, 'mobile-dock-multiple-text');
  await openResources(page);
  await expect(resources(page)).toBeVisible();
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('editorial-mobile-tools.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        categoryToggleCount: isMobile ? 8 : 0,
        textIds,
        storedAndRestored: true,
        geometry,
        errors,
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: info.outputPath('editorial-mobile-tools.png'), fullPage: true });
});
