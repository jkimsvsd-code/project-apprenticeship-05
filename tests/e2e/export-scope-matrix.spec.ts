import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { StudioDocument } from '@jjal/document-model';

const ratios = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
const sizes = {
  1080: [
    [1080, 1080],
    [864, 1080],
    [810, 1080],
    [720, 1080],
    [608, 1080],
    [1080, 810],
    [1080, 720],
    [1080, 608],
  ],
  2048: [
    [2048, 2048],
    [1638, 2048],
    [1536, 2048],
    [1365, 2048],
    [1152, 2048],
    [2048, 1536],
    [2048, 1365],
    [2048, 1152],
  ],
} as const;

test('8비율에서 PNG 개별 컷·JPG 전체·WebP 전체 출력 조합을 대조한다', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-fonts-ready', 'true', {
    timeout: 15_000,
  });
  const starters = page.getByRole('region', { name: '기본 템플릿' });
  await starters.getByRole('button', { name: '짧은 이야기', exact: true }).click();
  await expect(starters.getByRole('status')).toContainText('사본을 불러왔습니다');
  const library = page.getByRole('region', { name: '내 템플릿' });
  await library.getByLabel('템플릿 이름').fill('출력 조합');
  await library.getByRole('button', { name: '새 템플릿 저장', exact: true }).click();
  await expect(library.getByRole('status')).toContainText('저장했습니다');
  const doc: StudioDocument = await page.evaluate(async () => {
    const modulePath = '/src/composition/storage.ts';
    const { openStudioDatabase } = (await import(
      /* @vite-ignore */ modulePath
    )) as typeof import('../../apps/demo/src/composition/storage');
    const db = await openStudioDatabase('jjal-studio-demo');
    try {
      return (await db.getAll('templates')).find((row) => row.name === '출력 조합')!.document;
    } finally {
      db.close();
    }
  });
  for (const [index, ratio] of ratios.entries()) {
    await page.getByRole('button', { name: ratio, exact: true }).click();
    const edge = index % 2 === 0 ? 1080 : 2048;
    await page.getByLabel('출력 크기', { exact: true }).selectOption(String(edge));
    for (const format of ['png', 'jpg', 'webp'] as const) {
      await page.getByLabel('파일 형식', { exact: true }).selectOption(format);
      const id = format === 'png' ? doc.panels[index % 4]!.id : '';
      await page.getByLabel('출력 범위', { exact: true }).selectOption(id);
      if (format !== 'jpg') await page.getByLabel('투명 배경 출력', { exact: true }).check();
      const button = page.getByRole('button', {
        name: `${format === 'webp' ? 'WebP' : format.toUpperCase()} 다운로드`,
      });
      await expect(button).toBeEnabled();
      const preview = await page
        .getByAltText('실제 다운로드 파일 미리보기')
        .evaluate(async (node) =>
          Array.from(
            new Uint8Array(await (await fetch((node as HTMLImageElement).src)).arrayBuffer()),
          ),
        );
      const pending = page.waitForEvent('download');
      await button.click();
      const file = await pending;
      const stem = `scope-${ratio.replace(':', 'x')}-${edge}-${format}`;
      const output = info.outputPath(`${stem}.${format}`);
      await file.saveAs(output);
      expect(await file.failure()).toBeNull();
      const bytes = await readFile(output);
      const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
      expect(hash(bytes)).toBe(hash(Uint8Array.from(preview)));
      if (format === 'png')
        expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      if (format === 'jpg') expect([...bytes.subarray(0, 3)]).toEqual([255, 216, 255]);
      if (format === 'webp') {
        expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
        expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
      }
      const pixels = await page.evaluate(
        async ({ data, mime }) => {
          const image = new Image();
          image.src = `data:${mime};base64,${data}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(image, 0, 0);
          const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let transparentPixels = 0,
            partialPixels = 0;
          for (let i = 3; i < rgba.length; i += 4) {
            if (rgba[i] === 0) transparentPixels++;
            else if (rgba[i] !== 255) partialPixels++;
          }
          return { width: canvas.width, height: canvas.height, transparentPixels, partialPixels };
        },
        {
          data: bytes.toString('base64'),
          mime: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' }[format],
        },
      );
      let expected: readonly number[] = sizes[edge][index]!;
      if (format === 'png') {
        const rect = doc.layouts
          .find((l) => l.ratio === ratio)!
          .panels.find((p) => p.panelId === id)!.rect;
        const logical = sizes[1080][index]!;
        const w = rect.width * logical[0],
          h = rect.height * logical[1];
        expected = [
          Math.round((w / Math.max(w, h)) * edge),
          Math.round((h / Math.max(w, h)) * edge),
        ];
      }
      expect([pixels.width, pixels.height]).toEqual(expected);
      if (format === 'jpg') {
        expect(pixels.transparentPixels).toBe(0);
        expect(pixels.partialPixels).toBe(0);
      } else expect(pixels.transparentPixels).toBeGreaterThan(0);
      const result = {
        format,
        ratio,
        edge,
        panelId: id,
        transparent: format !== 'jpg',
        ...pixels,
        previewSha256: hash(Uint8Array.from(preview)),
        downloadSha256: hash(bytes),
        editorDifferentChannels: null,
        suggestedFilename: file.suggestedFilename(),
      };
      await writeFile(info.outputPath(`${stem}-comparison.json`), JSON.stringify(result, null, 2));
    }
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
});
