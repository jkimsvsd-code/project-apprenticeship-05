import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';
import type { TemplateBackup } from '@jjal/template-kit';
import { card, frame, rail, ready, selectedLayer } from './sketch-controls';

export { card, frame, rail, ready, selectedLayer };

const category: Record<string, string> = {
  templates: '템플릿',
  layout: '템플릿',
  image: '이미지',
  text: '문구',
  background: '배경',
  layers: '레이어',
  elements: '레이어',
  style: '도형',
  library: '저장',
  export: '저장',
};

/** The editorial workspace has two independent, stacked tool decks. */
export async function goPage(page: Page, id: string) {
  const name = category[id];
  if (!name) throw new Error(`Unknown editorial tool page: ${id}`);
  const panel = page.locator(`[data-tool-page="${id}"]`);
  const deck = page.locator('.tool-deck-stacked').filter({ has: panel });
  await expect(deck).toHaveCount(1);
  const dock = page.locator('.mobile-tool-dock');
  if (await dock.isVisible()) {
    const button = dock.getByRole('button', { name, exact: true });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(page.locator('.studio-shell')).toHaveAttribute('data-mobile-panel', 'tools');
  } else await deck.locator('.tool-bookmarks').getByRole('tab', { name, exact: true }).click();
  const subpage = deck.locator(`[data-tool-subpage="${id}"]`);
  // Single-page categories do not require an extra subpage control.
  if (await subpage.count()) await subpage.click();
  await expect(panel).toHaveAttribute('aria-hidden', 'false');
  await expect(panel).toBeVisible();
  return panel;
}

export async function reveal(page: Page, label: string, pageId = 'elements') {
  const panel = await goPage(page, pageId);
  const input = panel.getByLabel(label, { exact: true });
  for (const details of await input.locator('xpath=ancestor::details').all())
    if ((await details.getAttribute('open')) === null)
      await details.locator(':scope > summary').click();
  return input;
}

export async function number(page: Page, label: string, value: number, pageId = 'elements') {
  const input = await reveal(page, label, pageId);
  await input.fill(String(value));
  await input.press('Enter');
}

export async function activate(target: Locator, touch: boolean) {
  if (touch) await target.tap();
  else await target.click();
}

export const library = (page: Page) => page.getByRole('region', { name: '내 템플릿', exact: true });
export const resources = (page: Page) =>
  page.getByRole('region', { name: '자원그룹', exact: true });

export async function openResources(page: Page) {
  const dock = page.locator('.mobile-tool-dock');
  if (await dock.isVisible()) {
    const button = dock.getByRole('button', { name: '자원', exact: true });
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
    await expect(page.locator('.studio-shell')).toHaveAttribute('data-mobile-panel', 'resources');
  }
  await expect(resources(page)).toBeVisible();
}

export async function closeMobilePanel(page: Page) {
  const dock = page.locator('.mobile-tool-dock');
  if (!(await dock.isVisible())) return;
  const open = dock.locator('button[aria-expanded="true"]');
  if (await open.count()) await open.click();
  await expect(page.locator('.studio-shell')).toHaveAttribute('data-mobile-panel', 'closed');
}

export async function saveDocument(page: Page, info: TestInfo, name: string) {
  await goPage(page, 'library');
  const region = library(page);
  await region.getByLabel('템플릿 이름', { exact: true }).fill(name);
  await region.getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(region.getByRole('status')).toContainText(`‘${name}’ 템플릿을 저장했습니다`);
  await expect(region).toHaveAttribute('aria-busy', 'false');
  await region.getByLabel('JSON 범위', { exact: true }).selectOption('selected');
  const pending = page.waitForEvent('download');
  await region.getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
  const download = await pending;
  const path = info.outputPath(`${name}.json`);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const backup = JSON.parse(await readFile(path, 'utf8')) as TemplateBackup;
  expect(backup.templates).toHaveLength(1);
  const template = backup.templates[0]!;
  expect(template.name).toBe(name);
  return { document: template.document, backup, path };
}

export async function restore(page: Page, name: string) {
  await goPage(page, 'library');
  await library(page).getByLabel('저장된 템플릿', { exact: true }).selectOption({ label: name });
  await loadSelected(page);
}

export async function loadSelected(page: Page) {
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('불러왔습니다');
  await expect(library(page)).toHaveAttribute('aria-busy', 'false');
}

/** Restoring templates intentionally assigns fresh document, asset, group and element IDs. */
export function normalized(document: StudioDocument) {
  const ids = new Map<string, string>([
    [document.id, 'document'],
    ...document.assets.map((asset, index) => [asset.id, `asset-${index}`] as const),
    ...document.panels.map((panel, index) => [panel.id, `panel-${index}`] as const),
    ...document.elements.map((element, index) => [element.id, `element-${index}`] as const),
  ]);
  for (const element of document.elements)
    if (element.groupId && !ids.has(element.groupId)) ids.set(element.groupId, `group-${ids.size}`);
  return JSON.parse(
    JSON.stringify(document, (key, value: unknown) => {
      if (key === 'createdAt' || key === 'updatedAt') return '';
      return typeof value === 'string' ? (ids.get(value) ?? value) : value;
    }),
  ) as unknown;
}

/** Compare every RGBA channel from an actual downloaded PNG, using the shared canvas oracle. */
export async function downloadPng(page: Page, info: TestInfo, name: string) {
  const preview = await frame(page);
  const output = await goPage(page, 'export');
  await output.getByLabel('파일 형식', { exact: true }).selectOption('png');
  await output.getByLabel('출력 크기', { exact: true }).selectOption('1080');
  await output.getByLabel('출력 범위', { exact: true }).selectOption('');
  await output.getByLabel('투명 배경 출력', { exact: true }).uncheck();
  const pending = page.waitForEvent('download');
  await output.getByRole('button', { name: 'PNG 저장', exact: true }).click();
  const download = await pending;
  const path = info.outputPath(`${name}.png`);
  await download.saveAs(path);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(path);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const comparison = await page.evaluate(
    async ({ preview, downloaded }) => {
      async function decode(src: string) {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          size: [canvas.width, canvas.height],
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const [a, b] = await Promise.all([decode(preview), decode(downloaded)]);
      let differentChannels = 0;
      for (let index = 0; index < Math.max(a.pixels.length, b.pixels.length); index++)
        if (a.pixels[index] !== b.pixels[index]) differentChannels++;
      return {
        preview: a.size,
        download: b.size,
        comparedChannels: a.pixels.length,
        differentChannels,
      };
    },
    { preview, downloaded: `data:image/png;base64,${bytes.toString('base64')}` },
  );
  expect(comparison.download).toEqual(comparison.preview);
  expect(comparison.differentChannels).toBe(0);
  await writeFile(info.outputPath(`${name}-pixels.json`), JSON.stringify(comparison, null, 2));
  return comparison;
}
