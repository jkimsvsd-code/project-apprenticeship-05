import { expect, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import type { StudioDocument } from '@jjal/document-model';

const pages = [
  'templates',
  'layout',
  'image',
  'text',
  'background',
  'layers',
  'elements',
  'style',
  'library',
  'export',
];
const category: Record<string, string> = {
  templates: '템플릿',
  layout: '템플릿',
  image: '이미지',
  text: '문구',
  background: '배경',
  layers: '레이어',
  elements: '레이어',
  style: '스타일',
  library: '저장·출력',
  export: '저장·출력',
};
export const card = (page: Page) => page.locator('canvas[aria-label^="카드 "]');
export const rail = (page: Page) => page.locator('.layer-rail');
export const frame = (page: Page) =>
  card(page).evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png'));
export const selectedLayer = (page: Page) => rail(page).locator('button[aria-pressed="true"]');
export async function ready(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 20_000,
  });
  await expect(card(page)).toBeVisible();
}
export async function goPage(page: Page, id: string) {
  const label = category[id];
  if (!label) throw new Error(`Unknown tool page ${id}`);
  const deck = page.locator('.tool-deck').filter({ has: page.locator(`[data-tool-page="${id}"]`) });
  await deck.locator('.tool-bookmarks').getByRole('tab', { name: label, exact: true }).click();
  const start = pages.findIndex((item) => category[item] === label);
  await expect(page.locator(`[data-tool-page="${pages[start]}"]`)).toHaveAttribute(
    'aria-hidden',
    'false',
  );
  for (let index = start; index < pages.indexOf(id); index++) {
    await deck.getByRole('button', { name: '다음 도구 페이지', exact: true }).click();
    await expect(page.locator(`[data-tool-page="${pages[index + 1]}"]`)).toHaveAttribute(
      'aria-hidden',
      'false',
    );
  }
}
export async function reveal(page: Page, label: string, pageId = 'elements') {
  await goPage(page, pageId);
  const input = page.getByLabel(label, { exact: true });
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
export async function setColor(page: Page, label: string, value: string, pageId: string) {
  const input = await reveal(page, label, pageId);
  await input.evaluate((node, color) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, color);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(input).toHaveValue(value.toLowerCase());
}
export async function savedDocument(
  page: Page,
  info: TestInfo,
  name: string,
): Promise<StudioDocument> {
  await goPage(page, 'library');
  const library = page.getByRole('region', { name: '내 템플릿', exact: true });
  await library.getByLabel('템플릿 이름').fill(name);
  await library.getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(library.getByRole('status')).toContainText('저장했습니다');
  const pending = page.waitForEvent('download');
  await library.getByRole('button', { name: 'JSON 내보내기', exact: true }).click();
  const download = await pending;
  const path = info.outputPath(`${name}.json`);
  await download.saveAs(path);
  const backup = JSON.parse(await readFile(path, 'utf8')) as {
    templates: { name: string; document: StudioDocument }[];
  };
  const template = backup.templates.find((item) => item.name === name);
  if (!template) throw new Error('Saved template missing from actual JSON download');
  return template.document;
}
export async function restore(page: Page, name: string) {
  await goPage(page, 'library');
  const library = page.getByRole('region', { name: '내 템플릿', exact: true });
  await library.getByLabel('저장된 템플릿').selectOption({ label: name });
  await library.getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(library.getByRole('status')).toContainText('불러왔습니다');
}
export async function downloadPng(page: Page, info: TestInfo, name: string) {
  const preview = await frame(page);
  await goPage(page, 'export');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드 ↓', exact: true }).click();
  const download = await pending;
  const path = info.outputPath(`${name}.png`);
  await download.saveAs(path);
  const bytes = await readFile(path);
  expect(await download.failure()).toBeNull();
  const comparison = await page.evaluate(
    async ({ a, b }) => {
      async function decode(src: string) {
        const image = new Image();
        image.src = src;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      }
      const [x, y] = await Promise.all([decode(a), decode(b)]);
      let difference = 0;
      for (let i = 0; i < Math.max(x.data.length, y.data.length); i++)
        if (x.data[i] !== y.data[i]) difference++;
      return {
        preview: [x.width, x.height],
        download: [y.width, y.height],
        comparedChannels: x.data.length,
        differentChannels: difference,
      };
    },
    { a: preview, b: `data:image/png;base64,${bytes.toString('base64')}` },
  );
  expect(comparison.download).toEqual(comparison.preview);
  expect(comparison.differentChannels).toBe(0);
  await writeFile(info.outputPath(`${name}-pixels.json`), JSON.stringify(comparison, null, 2));
  return comparison;
}
