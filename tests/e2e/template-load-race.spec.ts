import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fillCaption, openTool } from './ui-controls';

interface DecodeGate {
  started: number;
  finishedDigests: number;
  release: (() => void)[];
}
type ControlledWindow = Window & { templateDecodeGate?: DecodeGate };
const library = (page: Page) => page.getByRole('region', { name: '내 템플릿' });
const caption = (page: Page) => page.locator('#caption');
const frame = (page: Page) =>
  page.locator('canvas').evaluate((element) => (element as HTMLCanvasElement).toDataURL());
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function image(page: Page, name: string) {
  await openTool(page, '이미지');
  await page.getByLabel('이미지 파일').setInputFiles(path.resolve('tests/fixtures/images', name));
  await expect(page.locator('.preview-panel [role=status]')).toContainText(name);
  await expect(page.getByRole('button', { name: 'PNG 다운로드' })).toBeEnabled();
}

async function setup(page: Page) {
  await page.goto('/');
  await image(page, 'portrait.png');
  await fillCaption(page, '템플릿에 저장된 문구');
  await library(page).getByLabel('템플릿 이름').fill('느리게 불러올 템플릿');
  await library(page).getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(library(page).getByRole('status')).toContainText('저장했습니다');
  await fillCaption(page, '현재 편집 중인 문구');
}

async function installGate(page: Page) {
  await page.evaluate(() => {
    const controlled = window as ControlledWindow;
    const gate: DecodeGate = { started: 0, finishedDigests: 0, release: [] };
    controlled.templateDecodeGate = gate;
    const originalBitmap = window.createImageBitmap;
    // 실제 디코더 결과는 그대로 사용하고 완료 시점만 직접 제어한다.
    window.createImageBitmap = (async (...args: unknown[]) => {
      const index = gate.started++;
      await new Promise<void>((resolve) => {
        gate.release[index] = resolve;
      });
      return Reflect.apply(originalBitmap, window, args) as Promise<ImageBitmap>;
    }) as typeof createImageBitmap;
    const originalDigest = crypto.subtle.digest;
    crypto.subtle.digest = (async (...args: unknown[]) => {
      const result = (await Reflect.apply(originalDigest, crypto.subtle, args)) as ArrayBuffer;
      gate.finishedDigests++;
      return result;
    }) as typeof crypto.subtle.digest;
  });
}

async function waitForDecodes(page: Page, total: number) {
  await page.waitForFunction(
    (expected) => (window as ControlledWindow).templateDecodeGate?.started === expected,
    total,
  );
}

async function releaseDecode(page: Page, index: number) {
  await page.evaluate((entry) => {
    const gate = (window as ControlledWindow).templateDecodeGate;
    if (!gate?.release[entry]) throw new Error('시험 디코딩 대기 항목 없음');
    gate.release[entry]();
  }, index);
}

async function savePng(info: TestInfo, name: string, dataUrl: string) {
  await writeFile(info.outputPath(name), Buffer.from(dataUrl.split(',')[1]!, 'base64'));
}

test('느린 템플릿 불러오기 중 시작한 한글 조합을 보존한다', async ({ page }, info) => {
  await setup(page);
  const before = await frame(page);
  await savePng(info, 'ime-before.png', before);
  await installGate(page);
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await waitForDecodes(page, 1);

  const draft = '현재 편집 중인 문구에 새로 조합하는 한글';
  await caption(page).dispatchEvent('compositionstart', { data: '' });
  await caption(page).fill(draft);
  await expect(caption(page)).toHaveValue(draft);
  await releaseDecode(page, 0);
  await expect(library(page)).toHaveAttribute('aria-busy', 'false');
  const observed = await caption(page).inputValue();
  const after = await frame(page);
  await savePng(info, 'ime-after.png', after);
  await writeFile(
    info.outputPath('ime-load-race.json'),
    JSON.stringify(
      {
        scenario: 'template decode started → IME composition started → original decode released',
        expectedDraft: draft,
        observedDraft: observed,
        beforeFrameSha256: hash(before),
        afterFrameSha256: hash(after),
        alert: await library(page).getByRole('alert').allTextContents(),
      },
      null,
      2,
    ),
  );
  expect(observed).toBe(draft);
  expect(after).toBe(before);
  await expect(library(page).getByRole('alert')).toBeVisible();
  await caption(page).dispatchEvent('compositionend', { data: draft });
  await expect(caption(page)).toHaveValue(draft);
});

test('느린 템플릿 불러오기보다 나중에 선택한 이미지 입력을 보존한다', async ({ page }, info) => {
  await setup(page);
  const currentText = await caption(page).inputValue();
  // 같은 실제 입력이 정상 완료됐을 때의 프레임을 비교 기준으로 먼저 확보한다.
  await image(page, 'landscape.jpg');
  const expected = await frame(page);
  await image(page, 'portrait.png');
  const before = await frame(page);
  await savePng(info, 'image-before.png', before);
  await savePng(info, 'image-expected.png', expected);
  await installGate(page);
  await library(page).getByRole('button', { name: '불러오기', exact: true }).click();
  await waitForDecodes(page, 1);
  await page
    .getByLabel('이미지 파일')
    .setInputFiles(path.resolve('tests/fixtures/images/landscape.jpg'));
  await waitForDecodes(page, 2);

  await releaseDecode(page, 0);
  await expect(library(page)).toHaveAttribute('aria-busy', 'false');
  const afterOldLoadText = await caption(page).inputValue();
  await releaseDecode(page, 1);
  // Cache validation also hashes original bytes. Wait for the actual newer input,
  // rather than assuming a fixed number of internal digest calls.
  await expect(page.locator('.preview-panel [role=status]')).toContainText('landscape.jpg');
  await expect(page.locator('.upload-control')).not.toContainText('확인하는 중');
  const observedText = await caption(page).inputValue();
  const after = await frame(page);
  await savePng(info, 'image-after.png', after);
  await writeFile(
    info.outputPath('image-load-race.json'),
    JSON.stringify(
      {
        scenario:
          'template decode started → newer image selected → template decode released → newer image decode released',
        expectedCaption: currentText,
        captionAfterOldLoad: afterOldLoadText,
        observedCaption: observedText,
        beforeFrameSha256: hash(before),
        expectedFrameSha256: hash(expected),
        afterFrameSha256: hash(after),
        imageNotice: await page.locator('.preview-panel [role=status]').innerText(),
        alert: await library(page).getByRole('alert').allTextContents(),
      },
      null,
      2,
    ),
  );
  expect(afterOldLoadText).toBe(currentText);
  expect(observedText).toBe(currentText);
  expect(after).toBe(expected);
  await expect(page.locator('.preview-panel [role=status]')).toContainText('landscape.jpg');
  await expect(library(page).getByRole('alert')).toBeVisible();
});
