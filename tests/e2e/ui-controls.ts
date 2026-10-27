import { expect, type Locator, type Page } from '@playwright/test';

type Tool = '이미지' | '문구' | '레이어' | '스타일';
const toolNames: Record<string, Tool> = {
  'tool-panel-image': '이미지',
  'tool-panel-text': '문구',
  'tool-panel-layers': '레이어',
  'tool-panel-style': '스타일',
};

export async function openTool(page: Page, name: Tool) {
  const tab = page.getByRole('tab', { name, exact: true });
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/** 실제 탭과 summary를 눌러 숨긴 정밀/내용 입력을 연다. */
export async function revealControl(page: Page, control: Locator) {
  const panel = await control.evaluate((node) => node.closest('[role="tabpanel"]')?.id ?? '');
  if (toolNames[panel]) await openTool(page, toolNames[panel]);
  for (const details of await control.locator('xpath=ancestor::details').all()) {
    if ((await details.getAttribute('open')) === null)
      await details.locator(':scope > summary').click();
  }
}

export async function fillCaption(page: Page, text: string) {
  const input = page.getByRole('textbox', { name: '문구', exact: true });
  // 닫힌 details 안의 textbox는 role 기본 탐색에서 제외된다.
  const attached = page.locator('#caption');
  await revealControl(page, attached);
  await input.fill(text);
}

export const layerButtons = (page: Page) => page.locator('.layer-list button[data-element-id]');

export async function selectedLayerId(page: Page) {
  const selected = page.locator('.layer-list button[data-element-id][aria-pressed="true"]');
  await expect(selected).toHaveCount(1);
  return (await selected.getAttribute('data-element-id'))!;
}

export async function selectLayer(page: Page, id: string) {
  await openTool(page, '레이어');
  // ID는 문서의 검증된 내부 값이며 label의 순서/잘린 문구와 독립적으로 선택한다.
  const row = page.locator(`.layer-list button[data-element-id="${id}"]`);
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
}
