import { describe, expect, it } from 'vitest';
import { type ElementTransform } from '@jjal/document-model';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import {
  addElement,
  createEditorDocument,
  EditHistory,
  resizeDocumentElementFromEdge,
  resizeElementFromEdge,
  setElementFlags,
  type ResizeEdge,
  type ResizeEdgeInput,
} from '@jjal/editor-core';

const edges: ResizeEdge[] = ['n', 'e', 's', 'w'];
const transform: ElementTransform = {
  x: 0.28,
  y: 0.24,
  width: 0.35,
  height: 0.27,
  rotation: 37,
  flipX: true,
  flipY: true,
  opacity: 0.6,
};
function input(patch: Partial<ResizeEdgeInput> = {}): ResizeEdgeInput {
  return {
    transform,
    edge: 'e',
    dx: 19,
    dy: -11,
    panelWidth: 340,
    panelHeight: 180,
    minWidth: 24,
    minHeight: 24,
    ...patch,
  };
}

// Independent renderer-space edge endpoints, not the implementation's center update.
function endpoints(t: ElementTransform, edge: ResizeEdge, width: number, height: number) {
  const vertices = {
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
  return vertices[edge].map(([sx, sy]) => ({
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
const opposite = (edge: ResizeEdge) => (({ n: 's', e: 'w', s: 'n', w: 'e' }) as const)[edge];

describe('말풍선 독립 가로·세로 손잡이 기하', () => {
  it.each(ASPECT_RATIOS)(
    '%s 비정방 컷·회전·모든 반전에서 다른 축과 반대 변의 두 끝을 고정한다',
    (ratio) => {
      const size = canvasSize(ratio);
      const pw = size.width * 0.47,
        ph = size.height * 0.31;
      for (const edge of edges)
        for (const [flipX, flipY] of [
          [false, false],
          [true, false],
          [false, true],
          [true, true],
        ]) {
          const start = { ...transform, flipX: flipX!, flipY: flipY! };
          const result = resizeElementFromEdge(
            input({ transform: start, edge, panelWidth: pw, panelHeight: ph }),
          );
          const fixedBefore = endpoints(start, opposite(edge), pw, ph);
          const fixedAfter = endpoints(result, opposite(edge), pw, ph);
          fixedBefore.forEach((point, i) => {
            expect(fixedAfter[i]!.x).toBeCloseTo(point.x, 9);
            expect(fixedAfter[i]!.y).toBeCloseTo(point.y, 9);
          });
          const horizontal = edge === 'e' || edge === 'w';
          expect(horizontal ? result.height : result.width).toBe(
            horizontal ? start.height : start.width,
          );
          const angle = (start.rotation * Math.PI) / 180;
          const projection = horizontal
            ? 19 * Math.cos(angle) - 11 * Math.sin(angle)
            : -19 * Math.sin(angle) - 11 * Math.cos(angle);
          const expectedX = (horizontal ? Math.cos(angle) : -Math.sin(angle)) * projection;
          const expectedY = (horizontal ? Math.sin(angle) : Math.cos(angle)) * projection;
          const movedBefore = endpoints(start, edge, pw, ph);
          const movedAfter = endpoints(result, edge, pw, ph);
          movedBefore.forEach((point, i) => {
            expect(movedAfter[i]!.x).toBeCloseTo(point.x + expectedX, 9);
            expect(movedAfter[i]!.y).toBeCloseTo(point.y + expectedY, 9);
          });
          expect(result).toMatchObject({ rotation: 37, flipX, flipY, opacity: 0.6 });
        }
    },
  );

  it.each(edges)(
    '%s 손잡이는 최소/400%% 한도에서 멈추며 다른 축은 수동 크기 그대로 보존한다',
    (edge) => {
      const horizontal = edge === 'e' || edge === 'w';
      const sign = edge === 'e' || edge === 's' ? 1 : -1;
      const start = { ...transform, x: 1.8, y: 1.8, rotation: 0 };
      const small = resizeElementFromEdge(
        input({
          transform: start,
          edge,
          dx: horizontal ? -sign * 5000 : 0,
          dy: horizontal ? 0 : -sign * 5000,
        }),
      );
      expect(horizontal ? small.width * 340 : small.height * 180).toBeCloseTo(24, 10);
      const large = resizeElementFromEdge(
        input({
          transform: start,
          edge,
          dx: horizontal ? sign * 5000 : 0,
          dy: horizontal ? 0 : sign * 5000,
        }),
      );
      expect(horizontal ? large.width : large.height).toBe(4);
      expect(horizontal ? small.height : small.width).toBe(horizontal ? start.height : start.width);
      expect(horizontal ? large.height : large.width).toBe(horizontal ? start.height : start.width);
    },
  );

  it('90도 회전한 폭 조절은 화면의 세로 이동만 따르고 직교 이동과 제로 이동은 원본을 유지한다', () => {
    const rotated = { ...transform, rotation: 90 };
    const resized = resizeElementFromEdge(input({ transform: rotated, dx: 0, dy: 34 }));
    expect(resized.width).toBeCloseTo(rotated.width + 0.1, 12);
    expect(resized.height).toBe(rotated.height);
    const zero = input({ transform: { ...transform, rotation: 0 }, dx: 0, dy: 0 });
    expect(resizeElementFromEdge(zero)).toEqual(zero.transform);
    expect(resizeElementFromEdge({ ...zero, dy: 20 })).toEqual(zero.transform);
  });

  it('화면 단위 변환과 절대 pointer-down 이동은 중간 이벤트 횟수에 의존하지 않는다', () => {
    const request = input();
    const before = structuredClone(request);
    resizeElementFromEdge({ ...request, dx: 1, dy: -2 });
    resizeElementFromEdge({ ...request, dx: 8, dy: -5 });
    const direct = resizeElementFromEdge(request);
    const scaled = resizeElementFromEdge({
      ...request,
      dx: request.dx * 3,
      dy: request.dy * 3,
      panelWidth: request.panelWidth * 3,
      panelHeight: request.panelHeight * 3,
      minWidth: request.minWidth * 3,
      minHeight: request.minHeight * 3,
    });
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(scaled[key]).toBeCloseTo(direct[key], 12);
    expect(request).toEqual(before);
  });

  it('잘못된 입력과 위치 한도 초과는 원본 변형 없이 거부한다', () => {
    for (const patch of [
      { edge: 'center' as ResizeEdge },
      { dx: NaN },
      { dy: Infinity },
      { panelWidth: 0 },
      { panelHeight: -1 },
      { minWidth: 0 },
      { minHeight: 721 },
      { panelWidth: Number.MAX_VALUE },
      { transform: { ...transform, width: 0 } },
      { transform: { ...transform, x: -1.9, rotation: 0 }, edge: 'w' as const, dx: -200, dy: 0 },
    ]) {
      const request = input(patch);
      const before = structuredClone(request);
      expect(() => resizeElementFromEdge(request)).toThrow();
      expect(request).toEqual(before);
    }
  });
});

describe('말풍선 축 조절의 문서·이력 보존', () => {
  it.each(ASPECT_RATIOS)(
    '%s의 선택 말풍선 배치만 바꾸고 글꼴/스타일·다른 요소·다른 비율을 보존한다',
    (ratio) => {
      const created = addElement(createEditorDocument(), 'panel-1', {
        kind: 'bubble',
        shape: 'speech',
      });
      const before = structuredClone(created.document);
      const layout = before.layouts.find((item) => item.ratio === ratio)!;
      const start = layout.panels[0]!.elements.find(
        (item) => item.elementId === created.elementId,
      )!.transform;
      const size = canvasSize(ratio);
      for (const edge of edges) {
        const resized = resizeDocumentElementFromEdge(
          before,
          created.elementId,
          ratio,
          input({
            transform: start,
            edge,
            panelWidth: size.width,
            panelHeight: size.height,
          }),
        );
        expect(resized.elements).toEqual(before.elements);
        for (const other of resized.layouts.filter((item) => item.ratio !== ratio))
          expect(other).toEqual(before.layouts.find((item) => item.ratio === other.ratio));
        expect(
          resized.layouts.find((item) => item.ratio === ratio)!.panels[0]!.elements[0],
        ).toEqual(layout.panels[0]!.elements[0]);
      }
      expect(created.document).toEqual(before);
    },
  );

  it.each(['locked', 'hidden'] as const)(
    '%s 말풍선은 기존 작품과 스타일을 바꾸지 않는다',
    (flag) => {
      const created = addElement(createEditorDocument(), 'panel-1', {
        kind: 'bubble',
        shape: 'thought',
      });
      const doc = setElementFlags(created.document, [created.elementId], { [flag]: true });
      const before = structuredClone(doc);
      expect(() => resizeDocumentElementFromEdge(doc, created.elementId, '1:1', input())).toThrow();
      expect(doc).toEqual(before);
    },
  );

  it('문구·없는 요소·없는 비율에는 말풍선 독립 조절을 적용하지 않는다', () => {
    const doc = createEditorDocument();
    const before = structuredClone(doc);
    expect(() => resizeDocumentElementFromEdge(doc, 'line-1', '1:1', input())).toThrow('말풍선');
    expect(() => resizeDocumentElementFromEdge(doc, 'absent', '1:1', input())).toThrow();
    const bubble = addElement(doc, 'panel-1', { kind: 'bubble', shape: 'caption' });
    expect(() =>
      resizeDocumentElementFromEdge(bubble.document, bubble.elementId, '2:7' as never, input()),
    ).toThrow();
    expect(doc).toEqual(before);
  });

  it('연속 포인터 이동을 한 이력으로 묶고 실행 취소·다시 실행은 크기와 글꼴을 정확히 복구한다', () => {
    const created = addElement(createEditorDocument(), 'panel-1', {
      kind: 'bubble',
      shape: 'shout',
    });
    const source = created.document;
    const start = source.layouts[0]!.panels[0]!.elements.find(
      (item) => item.elementId === created.elementId,
    )!.transform;
    const history = new EditHistory<typeof source>(
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );
    const group = Symbol('edge-resize');
    let current = source;
    for (const dx of [4, 12, 24]) {
      const next = resizeDocumentElementFromEdge(
        current,
        created.elementId,
        '1:1',
        input({
          transform: start,
          dx,
          dy: 0,
          panelWidth: 1080,
          panelHeight: 1080,
        }),
      );
      history.record(current, next, group);
      current = next;
    }
    const final = current;
    expect(history.undoCount).toBe(1);
    expect(history.undo(final)).toEqual(source);
    expect(history.redo(source)).toEqual(final);
    expect(final.elements).toEqual(source.elements);
  });
});
