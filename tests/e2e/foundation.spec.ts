import { test, expect } from '@playwright/test';
import { openTool, revealControl } from './ui-controls';

test('로컬 앱과 Canvas 미리보기 및 비율 선택', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '짤 카드 스튜디오' })).toBeVisible();
  await expect(page.getByLabel('이미지 파일')).toBeVisible();
  await openTool(page, '문구');
  await revealControl(page, page.locator('#caption'));
  await expect(page.getByRole('textbox', { name: '문구', exact: true })).toBeVisible();
  const canvas = page.getByRole('img', { name: '카드 1:1 비율' });
  await expect(canvas).toHaveAttribute('width', '1080');
  const pixel = await canvas.evaluate((node) => [
    ...(node as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1).data,
  ]);
  expect(pixel).toEqual([235, 233, 223, 255]);
  await page.getByRole('button', { name: '9:16', exact: true }).click();
  await expect(page.getByRole('img', { name: '카드 9:16 비율' })).toHaveAttribute('width', '608');
  await expect(page.getByRole('button', { name: '9:16', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('foundation.png'), fullPage: true });
});

test('IndexedDB v3 저장소가 열리고 기록은 새로고침 후 유지된다', async ({ page }) => {
  await page.goto('/');
  const names = await page.evaluate(async () => {
    const modulePath = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-test-foundation');
    await db.put('assets', {
      sha256: 'a'.repeat(64),
      blob: new Blob(['fixture'], { type: 'text/plain' }),
    });
    const stores = [...db.objectStoreNames];
    db.close();
    return stores;
  });
  expect(names).toEqual(['assets', 'drafts', 'resources', 'styles', 'templates']);
  await page.reload();
  const value = await page.evaluate(async () => {
    const modulePath = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-test-foundation');
    const row = await db.get('assets', 'a'.repeat(64));
    db.close();
    return row?.blob.text();
  });
  expect(value).toBe('fixture');
});
