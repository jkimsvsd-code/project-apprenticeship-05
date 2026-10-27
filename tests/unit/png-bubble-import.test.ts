import { describe, it, expect } from 'vitest';
import {
  CustomBubbleShapeSchema,
  parseDocument,
  referencedAssetIds,
  type Asset,
} from '@jjal/document-model';
import {
  addCustomBubble,
  addElement,
  changeElementStyle,
  changeElementContour,
  copyElements,
  createEditorDocument,
  deleteElements,
  captureStyle,
} from '@jjal/editor-core';
import { cloneTemplateDocument } from '@jjal/template-kit';
import {
  bubbleMaskFromPixels,
  bubbleOutline,
  customBubbleFromCandidate,
  initialBubbleBounds,
} from '../../apps/demo/src/composition/png-bubble-import';
import {
  customBubbleResourceId,
  customBubbleSourceId,
} from '../../apps/demo/src/composition/bubble-resources';
import { parseCachedResourceMetadata } from '@jjal/persistence/browser';

const asset: Asset = {
  id: `resource-${'a'.repeat(64)}`,
  sha256: 'a'.repeat(64),
  mimeType: 'image/png',
  byteLength: 300,
  pixelWidth: 24,
  pixelHeight: 20,
};
function pixels(white = false, outline = false) {
  const w = 24,
    h = 20,
    data = new Uint8ClampedArray(w * h * 4);
  if (white) data.fill(255);
  for (let y = 3; y < 16; y++)
    for (let x = 4; x < 20; x++) {
      const i = (y * w + x) * 4;
      if (outline && x > 4 && x < 19 && y > 3 && y < 15) continue;
      data.set([0, 0, 0, 255], i);
    }
  return data;
}
function converted() {
  const mask = bubbleMaskFromPixels(24, 20, pixels());
  return customBubbleFromCandidate({
    mask,
    bounds: initialBubbleBounds(mask),
    side: 'bottom',
    image: { asset } as never,
  });
}

describe('PNG 말풍선의 실제 벡터 변환과 원본 참조', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])('투명/흰 외부와 닫힌 링은 본체와 내부를 찾는다 %j', (white, outline) => {
    const data = pixels(white, outline),
      before = new Uint8ClampedArray(data),
      mask = bubbleMaskFromPixels(24, 20, data),
      bounds = initialBubbleBounds(mask),
      points = bubbleOutline(mask, bounds);
    expect(mask.pixels[8 * 24 + 10]).toBe(1);
    expect(mask.pixels[0]).toBe(0);
    expect(points).toHaveLength(4);
    expect(points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
    expect(data).toEqual(before);
  });
  it('몸체 crop과 꼬리 방향은 독립적인 기하로 변환하고 캐시 원본을 변경하지 않는다', () => {
    const mask = bubbleMaskFromPixels(24, 20, pixels()),
      bounds = initialBubbleBounds(mask),
      image = { asset } as never;
    const bodyOnly = customBubbleFromCandidate({ mask, bounds, side: 'none', image });
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const result = customBubbleFromCandidate({ mask, bounds, side, image });
      expect(result.customShape.bodyOutline).toEqual(bodyOnly.customShape.bodyOutline);
      expect(result.tail?.side).toBe(side);
    }
    const cropped = customBubbleFromCandidate({
      mask,
      bounds: { ...bounds, height: bounds.height * 0.8 },
      side: 'bottom',
      image,
    });
    expect(cropped.customShape.sourceAssetId).toBe(asset.id);
    expect(cropped.customShape.textRect).toEqual({ x: 0.08, y: 0.08, width: 0.84, height: 0.84 });
    expect(bodyOnly.tail).toBeNull();
  });
  it.each([new Uint8ClampedArray(24 * 20 * 4), new Uint8ClampedArray(24 * 20 * 4).fill(255)])(
    '비어있거나 외곽이 없는 PNG는 변환 전에 거부한다',
    (data) => expect(() => bubbleMaskFromPixels(24, 20, data)).toThrow(),
  );
  it('색 배경·잘못된 crop·면적없는 윤곽·몸체 밖 문구영역은 거부한다', () => {
    const colored = pixels();
    for (let i = 0; i < colored.length; i += 4) colored.set([1, 2, 3, 255], i);
    expect(() => bubbleMaskFromPixels(24, 20, colored)).toThrow('투명');
    const mask = bubbleMaskFromPixels(24, 20, pixels());
    expect(() => bubbleOutline(mask, { x: 0.8, y: 0, width: 0.5, height: 1 })).toThrow('범위');
    expect(() =>
      CustomBubbleShapeSchema.parse({
        ...converted().customShape,
        bodyOutline: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 1, y: 1 },
        ],
      }),
    ).toThrow('면적');
    expect(() =>
      CustomBubbleShapeSchema.parse({
        ...converted().customShape,
        textRect: { x: 0.8, y: 0, width: 0.5, height: 1 },
      }),
    ).toThrow('문구 영역');
  });
  it('같은 PNG를 반복 추가하면 독립 bubble ID/8비율 배치와 공유 원본 참조를 갖는다', () => {
    const source = createEditorDocument(),
      first = addCustomBubble(source, 'panel-1', asset, converted()),
      second = addCustomBubble(first.document, 'panel-1', asset, converted());
    expect(first.elementId).not.toBe(second.elementId);
    expect(second.document.assets).toHaveLength(1);
    for (const id of [first.elementId, second.elementId]) {
      expect(second.document.elements.find((e) => e.id === id)).toMatchObject({
        kind: 'bubble',
        shape: 'speech',
        customShape: { sourceAssetId: asset.id },
        verticalAlign: 'center',
        textPadding: { top: 12, right: 12, bottom: 12, left: 12 },
      });
      expect(
        second.document.layouts.every((l) => l.panels[0]!.elements.some((e) => e.elementId === id)),
      ).toBe(true);
    }
    expect(referencedAssetIds(second.document).has(asset.id)).toBe(true);
    expect(source.assets).toHaveLength(0);
  });
  it('문구·여백·꼬리·contour 변경과 스타일 캡처는 기하/원본을 보존하며 builtin shape 선택만 custom을 지운다', () => {
    const added = addCustomBubble(createEditorDocument(), 'panel-1', asset, converted());
    let doc = changeElementStyle(added.document, added.elementId, {
      bubble: {
        textPadding: { top: 10, right: 20, bottom: 30, left: 40 },
        verticalAlign: 'bottom',
        tail: { side: 'right', x: 1, y: 0.4 },
      },
    });
    doc = changeElementContour(doc, added.elementId, {
      texture: 'pencil',
      width: 8,
      color: '#0047AB',
    });
    expect(doc.elements.find((e) => e.id === added.elementId)).toMatchObject({
      customShape: converted().customShape,
      contour: { texture: 'pencil', width: 8 },
    });
    expect(captureStyle(doc, added.elementId, '내말풍선').bubble).not.toHaveProperty('customShape');
    expect(
      changeElementStyle(doc, added.elementId, { bubble: { shape: 'thought' } }).elements.find(
        (e) => e.id === added.elementId,
      ),
    ).not.toHaveProperty('customShape');
  });
  it('템플릿 새 ID 재연결·JSON·삭제·복제는 PNG 참조를 보존하고 마지막 요소 삭제에서 정리한다', () => {
    const added = addCustomBubble(createEditorDocument(), 'panel-1', asset, converted());
    const parsed = parseDocument(JSON.parse(JSON.stringify(added.document))),
      copy = cloneTemplateDocument(parsed),
      bubble = copy.elements.find((e) => e.kind === 'bubble')!;
    expect(bubble.kind === 'bubble' && bubble.customShape?.sourceAssetId).toBe(copy.assets[0]!.id);
    expect(copy.assets[0]!.id).not.toBe(asset.id);
    const duplicated = copyElements(parsed, [added.elementId], 'panel-1');
    expect(duplicated.document.elements.filter((e) => e.kind === 'bubble')).toHaveLength(2);
    const remaining = deleteElements(duplicated.document, [added.elementId]);
    expect(referencedAssetIds(remaining).has(asset.id)).toBe(true);
    const last = remaining.elements.find((e) => e.kind === 'bubble')!;
    expect(deleteElements(remaining, [last.id]).assets).toHaveLength(0);
  });
  it('잘못된 PNG 참조·중복 ID 충돌은 기존 문서를 변경하지 않고 거부한다', () => {
    const source = createEditorDocument(),
      before = structuredClone(source);
    expect(() =>
      addCustomBubble(source, 'panel-1', asset, {
        ...converted(),
        customShape: { ...converted().customShape, sourceAssetId: 'absent' },
      }),
    ).toThrow('원본');
    const added = addCustomBubble(source, 'panel-1', asset, converted());
    const broken = structuredClone(added.document);
    broken.assets = [];
    expect(() => parseDocument(broken)).toThrow('참조');
    expect(source).toEqual(before);
  });
  it.each(['rect', 'ellipse', 'triangle', 'diamond'] as const)(
    '기본 도형 %s도 기존 콘텐츠·배치 검증을 공유한다',
    (shape) => {
      const added = addElement(createEditorDocument(), 'panel-1', { kind: 'shape', shape });
      expect(added.document.elements.find((e) => e.id === added.elementId)).toMatchObject({
        kind: 'shape',
        shape,
        fill: '#F8F9FA',
      });
      expect(added.document.layouts).toHaveLength(8);
    },
  );
  it('custom drag ID와 메타 참조는 엄격하며 일반 이미지 cache ID와 구분한다', () => {
    const id = customBubbleResourceId(asset.id);
    expect(customBubbleSourceId(id)).toBe(asset.id);
    expect(customBubbleSourceId('custom-bubble:../../bad')).toBeNull();
    expect(customBubbleSourceId(asset.id)).toBeNull();
    const metadata = {
      id: asset.id,
      name: '나의 말풍선.png',
      origin: 'user',
      category: 'image',
      createdAt: '2026-10-24T00:00:00.000Z',
      asset,
      customBubble: converted(),
    };
    expect(parseCachedResourceMetadata(metadata).customBubble).toEqual(converted());
    expect(() =>
      parseCachedResourceMetadata({
        ...metadata,
        customBubble: {
          ...converted(),
          customShape: { ...converted().customShape, sourceAssetId: 'absent' },
        },
      }),
    ).toThrow('원본');
  });
});
