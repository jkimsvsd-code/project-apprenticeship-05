import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fillCaption, layerButtons, openTool, revealControl, selectedLayerId } from './ui-controls';

const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true });
const frame = (page: Page) =>
  page.locator('canvas').evaluate((node) => (node as HTMLCanvasElement).toDataURL('image/png'));
const history = (page: Page) => page.getByRole('region', { name: '현재 세션 편집 이력' });

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true');
  await expect(page.locator('[data-resource-id]')).toHaveCount(12);
  await expect(page.getByRole('tab')).toHaveCount(4);
  await expect(tab(page, '전체')).toHaveCount(0);
}

test('도구 탭: 키보드 탐색·편집 보존·IME 중 전환 차단과 실행 취소', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await expect(tab(page, '이미지')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tool-panel-image')).toBeVisible();
  await expect(page.locator('#tool-panel-text')).toBeHidden();
  const original = await frame(page);
  await tab(page, '이미지').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, '문구')).toBeFocused();
  await expect(tab(page, '문구')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#tool-panel-text .content-tools')).not.toHaveAttribute('open', '');
  await expect(page.locator('#tool-panel-text .precision-tools')).not.toHaveAttribute('open', '');
  await expect(page.locator('#caption')).toBeHidden();
  const edit = page.getByRole('button', { name: '내용 수정', exact: true });
  await edit.focus();
  await page.keyboard.press('Enter');
  const direct = page.getByRole('textbox', { name: '카드 문구 직접 편집', exact: true });
  await expect(direct).toBeFocused();
  await direct.fill('나의 짤 카드\n편집은 그대로');
  expect(await frame(page)).toBe(original);
  await direct.press('Control+Enter');
  await expect(direct).toHaveCount(0);
  const edited = await frame(page);
  expect(edited).not.toBe(original);
  const count = await history(page).innerText();
  for (const name of ['레이어', '스타일', '이미지', '문구']) {
    await tab(page, name).click();
    expect(await frame(page)).toBe(edited);
    expect(await history(page).innerText()).toBe(count);
  }
  await expect(page.locator('#caption')).toHaveValue('나의 짤 카드\n편집은 그대로');
  await tab(page, '문구').focus();
  await page.keyboard.press('End');
  await expect(tab(page, '스타일')).toBeFocused();
  await expect(page.locator('#tool-panel-style')).toBeVisible();
  for (const id of ['image', 'text', 'layers'])
    await expect(page.locator(`#tool-panel-${id}`)).toBeHidden();
  await page.keyboard.press('Home');
  await expect(tab(page, '이미지')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, '스타일')).toBeFocused();
  await tab(page, '문구').click();
  await fillCaption(page, '나의 짤 카드\n편집은 그대로');
  const caption = page.getByRole('textbox', { name: '문구', exact: true });
  await caption.dispatchEvent('compositionstart', { data: '' });
  await caption.fill('조합 중인 한글');
  for (const name of ['이미지', '문구', '레이어', '스타일'])
    await expect(tab(page, name)).toBeDisabled();
  expect(await frame(page)).toBe(edited);
  await caption.dispatchEvent('compositionend', { data: '조합 중인 한글' });
  await expect(tab(page, '이미지')).toBeEnabled();
  await expect(caption).toHaveValue('조합 중인 한글');
  await history(page).getByRole('button', { name: '실행 취소', exact: true }).click();
  await expect(caption).toHaveValue('나의 짤 카드\n편집은 그대로');
  expect(await frame(page)).toBe(edited);
  expect(errors).toEqual([]);
  await writeFile(
    info.outputPath('tool-navigation.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        keyboardNavigation: true,
        viewChangesDoNotEditDocument: true,
        compositionPreserved: true,
        undoPreserved: true,
        collapsedDuplicateControls: true,
        keyboardInlineEntry: true,
        errors,
      },
      null,
      2,
    ),
  );
});

test('통합 레이어 복구와 배경 범위: 접힌 대안 경로와 단일 선택', async ({ page }, info) => {
  test.setTimeout(60_000);
  await ready(page);
  await fillCaption(page, '레이어 복구 확인');
  const edited = await frame(page);
  await openTool(page, '레이어');
  const id = await selectedLayerId(page);
  const layer = page.locator(`.layer-list button[data-element-id="${id}"]`);
  const group = page.getByRole('region', { name: '여러 요소와 컷 편집' });
  await expect(layerButtons(page)).toHaveCount(1);
  await group.getByRole('button', { name: '선택 잠금', exact: true }).click();
  await group.getByRole('button', { name: '선택 해제', exact: true }).click();
  await layer.focus();
  await layer.press('Enter');
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-resize-handle]')).toHaveCount(0);
  await group.getByRole('button', { name: '선택 잠금 해제', exact: true }).click();
  await group.getByRole('button', { name: '선택 숨김', exact: true }).click();
  await group.getByRole('button', { name: '선택 해제', exact: true }).click();
  await layer.focus();
  await layer.press('Enter');
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
  await group.getByRole('button', { name: '선택 숨김 해제', exact: true }).click();
  expect(await frame(page)).toBe(edited);
  const x = page.getByLabel('요소 가로 위치', { exact: true });
  const originalX = await x.inputValue();
  await revealControl(page, x);
  await x.fill('150');
  await x.press('Enter');
  await expect(x).toHaveValue('150');
  await group.getByRole('button', { name: '선택 해제', exact: true }).click();
  await layer.focus();
  await layer.press('Enter');
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-resize-handle]')).toHaveCount(4);
  await revealControl(page, x);
  await x.fill(originalX);
  await x.press('Enter');
  expect(await frame(page)).toBe(edited);
  await openTool(page, '이미지');
  const versions = page.locator('.background-tools .content-tools');
  await expect(versions).not.toHaveAttribute('open', '');
  await page.getByLabel('배경 적용 범위', { exact: true }).selectOption('whole');
  await expect(versions).toHaveAttribute('open', '');
  await expect(page.getByLabel('배경 원본 파일', { exact: true })).toBeVisible();
  await expect(page.getByLabel('이미지 배치', { exact: true })).toHaveCount(0);
  await page.getByLabel('배경 맞춤', { exact: true }).selectOption('contain');
  await expect(page.getByLabel('배경 맞춤', { exact: true })).toHaveValue('contain');
  await page.getByLabel('배경 적용 범위', { exact: true }).selectOption('panel');
  await expect(versions).not.toHaveAttribute('open', '');
  await versions.locator('summary').click();
  await expect(page.getByLabel('배경 원본 파일', { exact: true })).toBeVisible();
  await writeFile(
    info.outputPath('minimal-recovery.json'),
    JSON.stringify(
      {
        profile: info.project.name,
        lockedHiddenAndOffCardLayersRecoverable: true,
        singleLayerList: true,
        precisionAlternative: true,
        backgroundScopeAndVersionsPreserved: true,
      },
      null,
      2,
    ),
  );
});

test('반응형 작업공간: 화면 넘침·터치 영역·작품 우선 배치와 설명 부재', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const observations = [];
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [768, 1024],
    [1280, 900],
    [1440, 1000],
  ] as const) {
    await page.setViewportSize({ width, height });
    await ready(page);
    const layout = await page.evaluate(() => {
      const bounds = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          bottom: rect.bottom,
        };
      };
      const tabs = [...document.querySelectorAll('[role="tab"]')].map((element) => {
        const rect = element.getBoundingClientRect();
        return { name: element.textContent!.trim(), width: rect.width, height: rect.height };
      });
      const tools = document.querySelector('.tools')!;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        documentWidth: document.documentElement.scrollWidth,
        canvas: bounds('canvas'),
        preview: bounds('.preview-panel'),
        tools: bounds('.tools'),
        starter: bounds('.starter-options'),
        tabs,
        toolOverflow: getComputedStyle(tools).overflowY,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(width);
    expect(layout.canvas.width).toBeGreaterThan(100);
    expect(layout.canvas.height).toBeGreaterThan(100);
    expect(layout.tabs).toHaveLength(4);
    for (const target of layout.tabs) {
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
    }
    if (width <= 760) {
      expect(layout.preview.y).toBeLessThan(layout.tools.y);
      expect(layout.starter.height).toBeLessThan(160);
    } else {
      expect(layout.tools.x).toBeLessThan(layout.preview.x);
      expect(layout.toolOverflow).toBe('auto');
    }
    await expect(page.getByRole('button', { name: /PNG 다운로드/ })).toBeVisible();
    await expect(page.getByRole('region', { name: '첫 편집 안내' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '편집 도움말' })).toHaveCount(0);
    await expect(page.getByText('오늘을 한 장으로.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`workspace-${width}.png`), fullPage: true });
    if (width <= 760) {
      await expect(tab(page, '문구')).toBeInViewport();
      await tab(page, '문구').click();
      await expect(page.locator('#caption')).toBeHidden();
      await revealControl(page, page.locator('#caption'));
      await expect(page.getByRole('textbox', { name: '문구', exact: true })).toBeInViewport();
      await page.getByRole('button', { name: '작품 보기', exact: true }).click();
      await expect(page.locator('canvas')).toBeInViewport();
    }
    observations.push(layout);
  }
  await writeFile(
    info.outputPath('responsive-workspace.json'),
    JSON.stringify(
      { profile: info.project.name, realDevice: false, reducedMotion: true, observations },
      null,
      2,
    ),
  );
});
