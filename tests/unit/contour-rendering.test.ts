import { describe, expect, it } from 'vitest';
import { createEditorDocument, deleteElement } from '@jjal/editor-core';
import { renderDocument, textContentRect } from '@jjal/renderer';
import type { StudioDocument } from '@jjal/document-model';
import { ensurePanelFrameLayers } from '../../apps/demo/src/composition/panelFrames';

function fixture() {
  const calls: { operation: string; args: unknown[]; width: unknown; color: unknown }[] = [];
  const owner = { createElement: () => create() } as unknown as Document;
  function create(): HTMLCanvasElement {
    const state: Record<string, unknown> = {
      measureText: (text: string) => ({
        width: text.length * 20,
        actualBoundingBoxAscent: 2,
        actualBoundingBoxDescent: 20,
      }),
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      createPattern: () => ({ texturePattern: true }),
    };
    const context = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[String(key)];
        return (...args: unknown[]) =>
          calls.push({
            operation: String(key),
            args,
            width: state.lineWidth,
            color: state.strokeStyle,
          });
      },
    });
    const canvas = {
      width: 88,
      height: 99,
      ownerDocument: owner,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    state.canvas = canvas;
    return canvas;
  }
  return { canvas: create(), calls };
}

function twoPanels(): StudioDocument {
  const doc = createEditorDocument();
  doc.panels.push({
    id: 'panel-2',
    elementIds: [],
    background: { color: '#F8F9FA', imageAssetId: null, fit: 'cover' },
  });
  for (const layout of doc.layouts) {
    layout.panels[0]!.rect = { x: 0, y: 0, width: 0.5, height: 1 };
    layout.panels.push({
      panelId: 'panel-2',
      rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
      elements: [],
    });
  }
  return doc;
}

describe('공통 Canvas 외곽선과 레이어 테두리 렌더링', () => {
  it.each(['pen', 'pencil', 'paint'] as const)(
    '%s 외곽선은 문구의 실제 glyph stroke에 적용되고 기존 outline 값을 대체한다',
    (texture) => {
      const doc = createEditorDocument(),
        text = doc.elements[0]!;
      if (text.kind !== 'text') throw new Error('test text');
      text.style.outline = { color: '#111111', width: 3 };
      text.contour = { texture, color: '#0047AB', width: 12 };
      const f = fixture();
      renderDocument(f.canvas, doc);
      const strokes = f.calls.filter((call) => call.operation === 'strokeText');
      expect(strokes.length).toBeGreaterThan(0);
      expect(strokes.every((call) => call.width === 12)).toBe(true);
      expect(strokes[0]!.color).toEqual(texture === 'pen' ? '#0047AB' : { texturePattern: true });
      const withContour = textContentRect(text, 300, 100);
      expect(withContour.x).toBe(6);
      expect(withContour.width).toBe(288);
      text.contour.width = 0;
      const zero = fixture();
      renderDocument(zero.canvas, doc);
      expect(zero.calls.some((call) => call.operation === 'strokeText')).toBe(false);
    },
  );

  it('새 문구의 glyph overhang은 내부 내용 영역에서 잘리지 않고 사방 padding까지 그릴 수 있다', () => {
    const doc = createEditorDocument(),
      text = doc.elements[0]!;
    if (text.kind !== 'text') throw new Error('test text');
    text.boxPaddingRatio = 1 / 6;
    text.contour = { texture: 'pen', color: '#0B0F2B', width: 10 };
    const f = fixture();
    renderDocument(f.canvas, doc);
    const boxes = f.calls.filter((call) => call.operation === 'rect');
    const last = boxes.at(-1)!;
    expect(last.args).toEqual([0, 0, 864, 702]);
  });

  it('프레임은 독립 stroke layer이며 숨김·삭제 뒤에는 implicit 테두리가 재등장하지 않는다', () => {
    const legacy = twoPanels(),
      before = structuredClone(legacy),
      old = fixture();
    renderDocument(old.canvas, legacy);
    expect(old.calls.filter((call) => call.operation === 'strokeRect')).toHaveLength(2);
    let doc = ensurePanelFrameLayers(legacy);
    const ids = doc.elements
      .filter((element) => element.kind === 'frame')
      .map((element) => element.id);
    const normal = fixture();
    renderDocument(normal.canvas, doc);
    const strokes = normal.calls.filter((call) => call.operation === 'strokeRect');
    expect(strokes).toHaveLength(2);
    expect(strokes.every((call) => call.width === 2 && call.color === '#0B0F2B')).toBe(true);
    for (const id of ids) doc = deleteElement(doc, id);
    const removed = fixture();
    renderDocument(removed.canvas, doc);
    expect(removed.calls.filter((call) => call.operation === 'strokeRect')).toHaveLength(0);
    expect(legacy).toEqual(before);
  });
});
