import { describe, expect, it } from 'vitest';
import type { ElementTransform, StudioDocument } from '@jjal/document-model';
import { ASPECT_RATIOS, canvasSize, type AspectRatio } from '@jjal/policies';
import {
  addElement,
  createEditorDocument,
  resizeDocumentElementFromCorner,
  resizeDocumentElementFromEdge,
  setElementFlags,
  type ResizeEdge,
  type ResizeEdgeInput,
} from '@jjal/editor-core';

const shapes = ['rect', 'ellipse', 'triangle', 'diamond'] as const;
const edges: ResizeEdge[] = ['n', 'e', 's', 'w'];
const opposites: Record<ResizeEdge, ResizeEdge> = { n: 's', e: 'w', s: 'n', w: 'e' };
const start: ElementTransform = {
  x: 0.31,
  y: 0.28,
  width: 0.3,
  height: 0.25,
  rotation: 37,
  flipX: false,
  flipY: false,
  opacity: 0.63,
};

function shapeDocument(shape: (typeof shapes)[number], ratio: AspectRatio = '1:1') {
  const added = addElement(createEditorDocument(), 'panel-1', { kind: 'shape', shape });
  const other = addElement(added.document, 'panel-1', { kind: 'shape', shape: 'diamond' });
  const doc = other.document;
  doc.activeRatio = ratio;
  const owner = doc.layouts.find((layout) => layout.ratio === ratio)!.panels[0]!;
  owner.elements.find((item) => item.elementId === added.elementId)!.transform = { ...start };
  return { doc, id: added.elementId };
}

function placed(doc: StudioDocument, id: string, ratio: AspectRatio = doc.activeRatio) {
  const panel = doc.layouts
    .find((layout) => layout.ratio === ratio)!
    .panels.find((owner) => owner.elements.some((item) => item.elementId === id))!;
  return { panel, transform: panel.elements.find((item) => item.elementId === id)!.transform };
}

function request(doc: StudioDocument, id: string, edge: ResizeEdge): ResizeEdgeInput {
  const { panel, transform } = placed(doc, id);
  const size = canvasSize(doc.activeRatio);
  return {
    transform,
    edge,
    dx: 19,
    dy: -11,
    panelWidth: size.width * panel.rect.width,
    panelHeight: size.height * panel.rect.height,
    minWidth: 20,
    minHeight: 20,
  };
}

// Renderer-space endpoints provide a fixed-edge invariant independent of the resize update.
function endpoints(t: ElementTransform, edge: ResizeEdge, width: number, height: number) {
  const sides = {
    n: [
      [-1, -1],
      [1, -1],
    ],
    e: [
      [1, -1],
      [1, 1],
    ],
    s: [
      [-1, 1],
      [1, 1],
    ],
    w: [
      [-1, -1],
      [-1, 1],
    ],
  } as const;
  const angle = (t.rotation * Math.PI) / 180;
  return sides[edge].map(([sx, sy]) => ({
    x:
      (t.x + t.width / 2) * width +
      ((sx * t.width * width) / 2) * Math.cos(angle) -
      ((sy * t.height * height) / 2) * Math.sin(angle),
    y:
      (t.y + t.height / 2) * height +
      ((sx * t.width * width) / 2) * Math.sin(angle) +
      ((sy * t.height * height) / 2) * Math.cos(angle),
  }));
}

describe.each(shapes)('%s 도형의 독립 가로·세로 크기 조절', (shape) => {
  it.each(ASPECT_RATIOS)('%s에서 회전·반전·네 변의 반대 변과 다른 축을 보존한다', (ratio) => {
    const { doc, id } = shapeDocument(shape, ratio);
    for (const edge of edges) {
      for (const [flipX, flipY] of [
        [false, false],
        [true, false],
        [false, true],
        [true, true],
      ]) {
        placed(doc, id).transform.flipX = flipX!;
        placed(doc, id).transform.flipY = flipY!;
        const before = structuredClone(doc);
        const input = request(doc, id, edge);
        const result = resizeDocumentElementFromEdge(doc, id, ratio, input);
        const resized = placed(result, id).transform;
        const horizontal = edge === 'e' || edge === 'w';
        expect(horizontal ? resized.height : resized.width).toBe(
          horizontal ? input.transform.height : input.transform.width,
        );
        expect(horizontal ? resized.width : resized.height).not.toBe(
          horizontal ? input.transform.width : input.transform.height,
        );
        const beforeEdge = endpoints(
          input.transform,
          opposites[edge],
          input.panelWidth,
          input.panelHeight,
        );
        const afterEdge = endpoints(resized, opposites[edge], input.panelWidth, input.panelHeight);
        beforeEdge.forEach((point, index) => {
          expect(afterEdge[index]!.x).toBeCloseTo(point.x, 9);
          expect(afterEdge[index]!.y).toBeCloseTo(point.y, 9);
        });
        expect(resized).toMatchObject({
          rotation: start.rotation,
          flipX,
          flipY,
          opacity: start.opacity,
        });
        expect(result.elements).toEqual(before.elements);
        expect(result.assets).toEqual(before.assets);
        expect(result.panels).toEqual(before.panels);
        expect(result.layouts.filter((layout) => layout.ratio !== ratio)).toEqual(
          before.layouts.filter((layout) => layout.ratio !== ratio),
        );
        const otherPlaced = placed(result, id).panel.elements.filter(
          (item) => item.elementId !== id,
        );
        expect(otherPlaced).toEqual(
          placed(before, id).panel.elements.filter((item) => item.elementId !== id),
        );
        expect(doc).toEqual(before);
      }
    }
  });

  it.each(['locked', 'hidden'] as const)('%s 도형은 원본을 바꾸지 않고 거부한다', (flag) => {
    const added = shapeDocument(shape);
    const doc = setElementFlags(added.doc, [added.id], { [flag]: true });
    const before = structuredClone(doc);
    expect(() =>
      resizeDocumentElementFromEdge(doc, added.id, '1:1', request(doc, added.id, 'e')),
    ).toThrow('잠기거나 숨긴');
    expect(doc).toEqual(before);
  });

  it('잘못된 변·이동·치수·배치는 적용 전에 거부하고 원본을 보존한다', () => {
    const { doc, id } = shapeDocument(shape);
    const original = structuredClone(doc);
    const input = request(doc, id, 'e');
    for (const patch of [
      { edge: 'center' as ResizeEdge },
      { dx: NaN },
      { dy: Infinity },
      { panelWidth: 0 },
      { panelHeight: -1 },
      { minWidth: 0 },
      { minHeight: input.panelHeight * 4 + 1 },
      { transform: { ...input.transform, width: 0 } },
      { transform: { ...input.transform, x: -1.99, rotation: 0 }, edge: 'w' as const, dx: -200 },
    ]) {
      const bad = { ...input, ...patch };
      const badBefore = structuredClone(bad);
      expect(() => resizeDocumentElementFromEdge(doc, id, '1:1', bad)).toThrow();
      expect(doc).toEqual(original);
      expect(bad).toEqual(badBefore);
    }
    expect(() => resizeDocumentElementFromEdge(doc, 'missing', '1:1', input)).toThrow('없습니다');
    expect(() => resizeDocumentElementFromEdge(doc, id, '2:7' as AspectRatio, input)).toThrow(
      '배치',
    );
    expect(doc).toEqual(original);
  });
});

it('도형 모서리의 한 축 이동은 다른 축이나 종횡비를 강제로 바꾸지 않는다', () => {
  const { doc, id } = shapeDocument('rect');
  placed(doc, id).transform.rotation = 0;
  const input = request(doc, id, 'e');
  const before = structuredClone(doc);
  const result = resizeDocumentElementFromCorner(doc, id, '1:1', {
    ...input,
    corner: 'se',
    dx: 48,
    dy: 0,
  });
  const t = placed(result, id).transform;
  expect(t.width).toBeCloseTo(input.transform.width + 48 / input.panelWidth, 12);
  expect(t.height).toBe(input.transform.height);
  expect(t.x).toBeCloseTo(input.transform.x, 12);
  expect(t.y).toBeCloseTo(input.transform.y, 12);
  expect(result.elements).toEqual(before.elements);
  expect(doc).toEqual(before);
});
