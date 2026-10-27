import { describe, expect, it } from 'vitest';
import { imageBlob, pngBlob, type ExportFormat } from '@jjal/image-io';
import { renderDocument } from '@jjal/renderer';
import { createSampleDocument } from '@jjal/content';

describe('형식별 출력 실패 보호', () => {
  it.each([
    ['png', 'image/png'],
    ['jpg', 'image/jpeg'],
    ['webp', 'image/webp'],
  ] as const)('%s는 실제 MIME과 인코더 옵션을 확인한다', async (format, mime) => {
    let quality: number | undefined;
    const canvas = {
      toBlob: (callback: BlobCallback, type: string, q?: number) => {
        expect(type).toBe(mime);
        quality = q;
        callback(new Blob(['output'], { type }));
      },
    } as HTMLCanvasElement;
    expect((await imageBlob(canvas, format)).type).toBe(mime);
    expect(quality).toBe(format === 'jpg' ? 0.92 : 1);
  });
  it.each([
    null,
    new Blob([], { type: 'image/webp' }),
    new Blob(['fallback'], { type: 'image/png' }),
  ])('실패·빈 파일·PNG 대체를 WebP로 저장하지 않는다: %s', async (blob) => {
    const canvas = { toBlob: (callback: BlobCallback) => callback(blob) } as HTMLCanvasElement;
    await expect(imageBlob(canvas, 'webp')).rejects.toThrow();
  });
  it('지원하지 않는 형식과 보안 예외도 실패로 돌려준다', async () => {
    const canvas = {
      toBlob: () => {
        throw new Error('tainted');
      },
    } as unknown as HTMLCanvasElement;
    await expect(pngBlob(canvas)).rejects.toThrow('tainted');
    await expect(imageBlob(canvas, 'gif' as ExportFormat)).rejects.toThrow('지원하지');
  });
});

describe('개별 컷·투명 렌더링 경계', () => {
  function fixture() {
    const calls: { operation: string; args: unknown[] }[] = [];
    const context = new Proxy(
      {},
      {
        get:
          (_target, key) =>
          (...args: unknown[]) =>
            calls.push({ operation: String(key), args }),
      },
    );
    const create = (): HTMLCanvasElement =>
      ({
        width: 88,
        height: 99,
        getContext: () => context,
        ownerDocument: { createElement: create },
      }) as unknown as HTMLCanvasElement;
    return { canvas: create(), calls };
  }
  function document() {
    const doc = createSampleDocument();
    doc.elements = [];
    doc.panels[0]!.elementIds = [];
    doc.panels[0]!.background.imageAssetId = 'missing-background';
    doc.layouts.forEach((layout) => {
      layout.panels[0]!.elements = [];
      layout.panels[0]!.rect = { x: 0.1, y: 0.2, width: 0.4, height: 0.2 };
    });
    return doc;
  }
  it('배경만 빠진 데이터도 투명으로 출력하며 문서를 변경하지 않는다', () => {
    const doc = document();
    const before = JSON.stringify(doc);
    const f = fixture();
    renderDocument(f.canvas, doc, { transparent: true, panelId: 'panel-1', longEdge: 2048 });
    expect([f.canvas.width, f.canvas.height]).toEqual([2048, 1024]);
    expect(f.calls.filter((call) => call.operation === 'fillRect')).toHaveLength(0);
    expect(
      f.calls.some(
        (call) => call.operation === 'translate' && call.args[0] === -108 && call.args[1] === -216,
      ),
    ).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it.each([{ panelId: 'absent' }, { panelId: '' }, { longEdge: 0 as 1080 }])(
    '무효 출력 옵션 %j는 기존 화면 치수를 유지한다',
    (options) => {
      const f = fixture();
      expect(() => renderDocument(f.canvas, document(), options)).toThrow();
      expect([f.canvas.width, f.canvas.height]).toEqual([88, 99]);
    },
  );
  it('불투명 출력에 필요한 이미지가 없으면 기존 화면을 보존한다', () => {
    const f = fixture();
    expect(() => renderDocument(f.canvas, document())).toThrow('이미지');
    expect([f.canvas.width, f.canvas.height]).toEqual([88, 99]);
    expect(f.calls.filter((call) => call.operation === 'drawImage')).toHaveLength(0);
  });
});
