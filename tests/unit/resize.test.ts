import { describe, expect, it } from 'vitest';
import { TransformSchema, type ElementTransform, type StudioDocument } from '@jjal/document-model';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import { addElement, createEditorDocument, EditHistory, setElementFlags } from '@jjal/editor-core';
import {
  resizeDocumentElementFromCorner,
  resizeElementFromCorner,
  type ResizeCorner,
  type ResizeCornerInput,
} from '../../packages/editor-core/src/resize';

const corners: ResizeCorner[] = ['nw', 'ne', 'sw', 'se'];
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

function input(patch: Partial<ResizeCornerInput> = {}): ResizeCornerInput {
  return {
    transform,
    corner: 'se',
    dx: 28,
    dy: 13,
    panelWidth: 340,
    panelHeight: 180,
    minWidth: 24,
    minHeight: 24,
    ...patch,
  };
}

// Independent rendering oracle: build the corner from center plus a rotated offset.
function cornerPoint(t: ElementTransform, corner: ResizeCorner, width: number, height: number) {
  const horizontal = corner.endsWith('e') ? 1 : -1;
  const vertical = corner.startsWith('s') ? 1 : -1;
  const angle = (t.rotation * Math.PI) / 180;
  const x = (horizontal * t.width * width) / 2;
  const y = (vertical * t.height * height) / 2;
  return {
    x: (t.x + t.width / 2) * width + x * Math.cos(angle) - y * Math.sin(angle),
    y: (t.y + t.height / 2) * height + x * Math.sin(angle) + y * Math.cos(angle),
  };
}

function opposite(corner: ResizeCorner): ResizeCorner {
  return ({ nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' } as const)[corner];
}

describe('회전 모서리 손잡이 크기 조절', () => {
  it.each(ASPECT_RATIOS)(
    '%s의 비정방 컷에서 네 손잡이가 포인터를 따라가고 반대 모서리를 고정한다',
    (ratio) => {
      const size = canvasSize(ratio);
      const panelWidth = size.width * 0.47;
      const panelHeight = size.height * 0.31;
      const before = structuredClone(transform);
      for (const corner of corners) {
        const result = resizeElementFromCorner(
          input({ corner, panelWidth, panelHeight, dx: 19, dy: -11 }),
        );
        const fixedBefore = cornerPoint(transform, opposite(corner), panelWidth, panelHeight);
        const fixedAfter = cornerPoint(result, opposite(corner), panelWidth, panelHeight);
        expect(fixedAfter.x).toBeCloseTo(fixedBefore.x, 9);
        expect(fixedAfter.y).toBeCloseTo(fixedBefore.y, 9);
        const draggedBefore = cornerPoint(transform, corner, panelWidth, panelHeight);
        const draggedAfter = cornerPoint(result, corner, panelWidth, panelHeight);
        expect(draggedAfter.x).toBeCloseTo(draggedBefore.x + 19, 9);
        expect(draggedAfter.y).toBeCloseTo(draggedBefore.y - 11, 9);
        expect(result).toMatchObject({
          rotation: 37,
          flipX: true,
          flipY: true,
          opacity: 0.6,
        });
        expect(TransformSchema.safeParse(result).success).toBe(true);
      }
      expect(transform).toEqual(before);
    },
  );

  it.each(corners)(
    '%s의 반대편을 지나쳐도 축별 최소 24픽셀에서 멈추며 뒤집히지 않는다',
    (corner) => {
      const horizontal = corner.endsWith('e') ? 1 : -1;
      const vertical = corner.startsWith('s') ? 1 : -1;
      const angle = (transform.rotation * Math.PI) / 180;
      const localX = -horizontal * 1000;
      const localY = -vertical * 1000;
      const request = input({
        corner,
        dx: localX * Math.cos(angle) - localY * Math.sin(angle),
        dy: localX * Math.sin(angle) + localY * Math.cos(angle),
      });
      const result = resizeElementFromCorner(request);
      expect(result.width * request.panelWidth).toBeCloseTo(24, 10);
      expect(result.height * request.panelHeight).toBeCloseTo(24, 10);
      const fixedBefore = cornerPoint(transform, opposite(corner), 340, 180);
      const fixedAfter = cornerPoint(result, opposite(corner), 340, 180);
      expect(fixedAfter.x).toBeCloseTo(fixedBefore.x, 10);
      expect(fixedAfter.y).toBeCloseTo(fixedBefore.y, 10);
      expect(result.flipX).toBe(true);
      expect(result.flipY).toBe(true);
    },
  );

  it('90도 회전에서는 화면의 세로 이동이 가로 크기를 바꾸며 반전은 계산을 바꾸지 않는다', () => {
    const rotated = { ...transform, rotation: 90 };
    const result = resizeElementFromCorner(input({ transform: rotated, dx: 0, dy: 34 }));
    expect(result.width).toBeCloseTo(rotated.width + 0.1, 12);
    expect(result.height).toBeCloseTo(rotated.height, 12);
    const plain = resizeElementFromCorner(
      input({ transform: { ...rotated, flipX: false, flipY: false }, dx: 0, dy: 34 }),
    );
    expect({ ...plain, flipX: true, flipY: true }).toEqual(result);
  });

  it('한 축의 최소 크기에 도달해도 다른 축의 이동은 독립적으로 이어진다', () => {
    const unrotated = { ...transform, rotation: 0 };
    const result = resizeElementFromCorner(input({ transform: unrotated, dx: -1000, dy: 18 }));
    expect(result.width).toBeCloseTo(24 / 340, 12);
    expect(result.height).toBeCloseTo(unrotated.height + 0.1, 12);
    expect(result.x).toBeCloseTo(unrotated.x, 12);
    expect(result.y).toBeCloseTo(unrotated.y, 12);
  });

  it('24 CSS픽셀의 최소 크기는 동일 단위 환산 시 화면 배율과 무관하다', () => {
    const request = input({ dx: -2000, dy: -2000, transform: { ...transform, rotation: 0 } });
    const screen = resizeElementFromCorner(request);
    const render = resizeElementFromCorner({
      ...request,
      dx: request.dx * 3.5,
      dy: request.dy * 3.5,
      panelWidth: request.panelWidth * 3.5,
      panelHeight: request.panelHeight * 3.5,
      minWidth: 24 * 3.5,
      minHeight: 24 * 3.5,
    });
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(render[key]).toBeCloseTo(screen[key], 12);
  });

  it('pointer-down snapshot의 절대 이동량이어서 중간 호출 횟수에 따른 누적 오차가 없다', () => {
    const request = input();
    const before = structuredClone(request);
    resizeElementFromCorner({ ...request, dx: 1, dy: 1 });
    resizeElementFromCorner({ ...request, dx: 10, dy: 4 });
    const final = resizeElementFromCorner(request);
    expect(resizeElementFromCorner(request)).toEqual(final);
    expect(request).toEqual(before);
    const start = cornerPoint(transform, 'se', 340, 180);
    const end = cornerPoint(final, 'se', 340, 180);
    expect(end.x).toBeCloseTo(start.x + request.dx, 10);
    expect(end.y).toBeCloseTo(start.y + request.dy, 10);
  });

  it('이동이 없으면 경계의 정규화 좌표도 반올림 변경 없이 유지한다', () => {
    const original = { ...transform, x: 3, y: -2 };
    expect(resizeElementFromCorner(input({ transform: original, dx: 0, dy: 0 }))).toEqual(original);
  });

  it('크기 400%에서 멈추고 컷 밖의 유효한 배치는 그대로 보존한다', () => {
    const original = { ...transform, x: -1, y: -0.8, rotation: 0 };
    const result = resizeElementFromCorner(input({ transform: original, dx: 5000, dy: 5000 }));
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.x).toBeCloseTo(-1, 12);
    expect(result.y).toBeCloseTo(-0.8, 12);
  });

  it('고정 모서리를 보존하며 위치 한도를 넘는 요청은 원본을 변경하지 않고 거부한다', () => {
    const original = { ...transform, x: -1.9, y: -1.9, rotation: 0 };
    const request = input({ transform: original, corner: 'nw', dx: -200, dy: -100 });
    const before = structuredClone(request);
    expect(() => resizeElementFromCorner(request)).toThrow('위치');
    expect(request).toEqual(before);
  });

  it('잘못된 방향·비유한 이동·0인 컷·실현 불가능한 최소 크기·잘못된 시작 배치를 거부한다', () => {
    const invalid: Partial<ResizeCornerInput>[] = [
      { corner: 'center' as ResizeCorner },
      { dx: NaN },
      { dy: Infinity },
      { panelWidth: 0 },
      { panelHeight: -1 },
      { panelWidth: Number.MAX_VALUE },
      { minWidth: 0 },
      { minHeight: 721 },
      { minWidth: 1361 },
      { transform: { ...transform, width: 0 } },
    ];
    for (const patch of invalid) {
      const request = input(patch);
      const before = structuredClone(request);
      expect(() => resizeElementFromCorner(request)).toThrow();
      expect(request).toEqual(before);
    }
  });
});

function textDocument(ratio: StudioDocument['activeRatio'] = '1:1', bubble = false) {
  let doc = createEditorDocument();
  let id = doc.elements[0]!.id;
  if (bubble) {
    const added = addElement(doc, doc.panels[0]!.id, { kind: 'bubble', shape: 'speech' });
    doc = added.document;
    id = added.elementId;
  }
  doc.activeRatio = ratio;
  const element = doc.elements.find((item) => item.id === id)!;
  if (element.kind === 'text' || element.kind === 'bubble') element.style.fontSize = 40;
  for (const layout of doc.layouts) {
    const placed = layout.panels
      .flatMap((panel) => panel.elements)
      .find((item) => item.elementId === id)!;
    placed.transform = { ...transform };
  }
  return { doc, id };
}

function uniformInput(doc: StudioDocument, id: string, scale: number, corner: ResizeCorner = 'se') {
  const placed = doc.layouts.find((layout) => layout.ratio === doc.activeRatio)!;
  const panel = placed.panels.find((panel) =>
    panel.elements.some((item) => item.elementId === id),
  )!;
  const start = panel.elements.find((item) => item.elementId === id)!.transform;
  const size = canvasSize(doc.activeRatio, 1080);
  const panelWidth = size.width * panel.rect.width;
  const panelHeight = size.height * panel.rect.height;
  const angle = (start.rotation * Math.PI) / 180;
  const x = (corner.endsWith('e') ? 1 : -1) * start.width * panelWidth * (scale - 1);
  const y = (corner.startsWith('s') ? 1 : -1) * start.height * panelHeight * (scale - 1);
  return input({
    transform: start,
    corner,
    panelWidth,
    panelHeight,
    dx: x * Math.cos(angle) - y * Math.sin(angle),
    dy: x * Math.sin(angle) + y * Math.cos(angle),
    minWidth: 1,
    minHeight: 1,
  });
}

function textSize(doc: StudioDocument, id: string) {
  const target = doc.elements.find((item) => item.id === id)!;
  if (target.kind !== 'text' && target.kind !== 'bubble') throw new Error('문구가 아님');
  return target.style.fontSize;
}

function placement(doc: StudioDocument, id: string) {
  return doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)!
    .panels.flatMap((panel) => panel.elements)
    .find((item) => item.elementId === id)!.transform;
}

describe('글자 모서리 손잡이의 글꼴·배치 동시 조절', () => {
  it.each(ASPECT_RATIOS)('%s의 회전·반전된 네 모서리가 동일 비율로 글자를 확대한다', (ratio) => {
    for (const bubble of [false, true]) {
      const { doc, id } = textDocument(ratio, bubble);
      const before = structuredClone(doc);
      for (const corner of corners) {
        const request = uniformInput(doc, id, 1.5, corner);
        const after = resizeDocumentElementFromCorner(doc, id, ratio, { ...request, fontSize: 40 });
        const result = placement(after, id);
        expect(result.width).toBeCloseTo(transform.width * 1.5, 12);
        expect(result.height).toBeCloseTo(transform.height * 1.5, 12);
        expect(textSize(after, id)).toBeCloseTo(60, 10);
        expect(result).toMatchObject({ rotation: 37, flipX: true, flipY: true, opacity: 0.6 });
        const anchor = cornerPoint(
          transform,
          opposite(corner),
          request.panelWidth,
          request.panelHeight,
        );
        const resizedAnchor = cornerPoint(
          result,
          opposite(corner),
          request.panelWidth,
          request.panelHeight,
        );
        expect(resizedAnchor.x).toBeCloseTo(anchor.x, 9);
        expect(resizedAnchor.y).toBeCloseTo(anchor.y, 9);
        expect(after.layouts.filter((layout) => layout.ratio !== ratio)).toEqual(
          doc.layouts.filter((layout) => layout.ratio !== ratio),
        );
      }
      expect(doc).toEqual(before);
    }
  });

  it('가로 한 방향 드래그도 폭 재배치에 그치지 않고 글자와 높이를 함께 바꾼다', () => {
    const { doc, id } = textDocument();
    const request = uniformInput(doc, id, 1);
    const result = resizeDocumentElementFromCorner(doc, id, doc.activeRatio, {
      ...request,
      transform: { ...request.transform, rotation: 0 },
      dx: 100,
      dy: 0,
      fontSize: 40,
    });
    expect(textSize(result, id)).toBeGreaterThan(40);
    const after = placement(result, id);
    expect(after.width / request.transform.width).toBeCloseTo(
      after.height / request.transform.height,
      12,
    );
  });

  it('글꼴 8~300 경계에서 글자·상자 배율이 함께 멈추고 고정 모서리를 유지한다', () => {
    const { doc, id } = textDocument();
    for (const [scale, expected] of [
      [100, 300],
      [-100, 8],
    ] as const) {
      const request = uniformInput(doc, id, scale);
      const result = resizeDocumentElementFromCorner(doc, id, doc.activeRatio, {
        ...request,
        fontSize: 40,
      });
      const after = placement(result, id);
      expect(textSize(result, id)).toBeCloseTo(expected, 12);
      expect(after.width / request.transform.width).toBeCloseTo(expected / 40, 12);
      expect(after.height / request.transform.height).toBeCloseTo(expected / 40, 12);
      const anchor = cornerPoint(request.transform, 'nw', request.panelWidth, request.panelHeight);
      const end = cornerPoint(after, 'nw', request.panelWidth, request.panelHeight);
      expect(end.x).toBeCloseTo(anchor.x, 9);
      expect(end.y).toBeCloseTo(anchor.y, 9);
    }
  });

  it('400% 크기 한도에서도 두 축과 글꼴 배율이 동일하다', () => {
    const { doc, id } = textDocument();
    const request = uniformInput(doc, id, 10);
    const result = resizeDocumentElementFromCorner(doc, id, doc.activeRatio, {
      ...request,
      transform: { ...request.transform, width: 2, height: 1, rotation: 0 },
      dx: 100000,
      dy: 100000,
      fontSize: 40,
    });
    expect(placement(result, id)).toMatchObject({ width: 4, height: 2 });
    expect(textSize(result, id)).toBe(80);
  });

  it('최소 화면 상자 크기를 만족시키며 가로·세로의 비율은 보존한다', () => {
    const { doc, id } = textDocument();
    const request = { ...uniformInput(doc, id, -10), minWidth: 44, minHeight: 100 };
    const result = resizeDocumentElementFromCorner(doc, id, doc.activeRatio, {
      ...request,
      fontSize: 40,
    });
    const after = placement(result, id);
    expect(after.height * request.panelHeight).toBeCloseTo(100, 10);
    expect(after.width * request.panelWidth).toBeGreaterThan(44);
    expect(after.width / request.transform.width).toBeCloseTo(
      after.height / request.transform.height,
      12,
    );
    expect(textSize(result, id)).toBeCloseTo((40 * after.width) / request.transform.width, 12);
  });

  it('화면 배율과 무관하게 같은 논리 이동은 동일한 글자 크기를 만든다', () => {
    const { doc, id } = textDocument();
    const request = uniformInput(doc, id, 1.3);
    const after = resizeDocumentElementFromCorner(doc, id, doc.activeRatio, {
      ...request,
      fontSize: 40,
    });
    const scaled = resizeDocumentElementFromCorner(doc, id, doc.activeRatio, {
      ...request,
      dx: request.dx * 3,
      dy: request.dy * 3,
      panelWidth: request.panelWidth * 3,
      panelHeight: request.panelHeight * 3,
      minWidth: request.minWidth * 3,
      minHeight: request.minHeight * 3,
      fontSize: 40,
    });
    expect(textSize(scaled, id)).toBeCloseTo(textSize(after, id), 12);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(placement(scaled, id)[key]).toBeCloseTo(placement(after, id)[key], 12);
  });

  it('사진·캐릭터의 모서리는 기존처럼 두 축을 독립 조절하며 문구 스타일은 보존한다', () => {
    const { doc, id: textId } = textDocument();
    const added = addElement(doc, doc.panels[0]!.id, {
      kind: 'character',
      characterId: 'cached-image',
      asset: {
        id: 'cached-image',
        mimeType: 'image/png',
        sha256: '0'.repeat(64),
        byteLength: 128,
        pixelWidth: 32,
        pixelHeight: 32,
      },
    });
    const request = uniformInput(added.document, added.elementId, 1);
    const result = resizeDocumentElementFromCorner(
      added.document,
      added.elementId,
      doc.activeRatio,
      {
        ...request,
        transform: { ...request.transform, rotation: 0 },
        dx: 108,
        dy: 0,
      },
    );
    expect(placement(result, added.elementId).width).toBeCloseTo(request.transform.width + 0.1, 12);
    expect(placement(result, added.elementId).height).toBe(request.transform.height);
    expect(result.elements.find((element) => element.id === textId)).toEqual(
      doc.elements.find((element) => element.id === textId),
    );
  });

  it('드래그 시작 글꼴에서 매번 계산하고 한 제스처는 글꼴과 배치를 한 번에 실행 취소한다', () => {
    const { doc, id } = textDocument();
    const history = new EditHistory<StudioDocument>(
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );
    const group = Symbol('resize');
    let current = doc;
    for (const scale of [1.1, 1.2, 1.5]) {
      const result = resizeDocumentElementFromCorner(current, id, doc.activeRatio, {
        ...uniformInput(doc, id, scale),
        fontSize: 40,
      });
      history.record(current, result, group);
      current = result;
      expect(textSize(current, id)).toBeCloseTo(40 * scale, 10);
    }
    expect(history.undoCount).toBe(1);
    expect(history.undo(current)).toEqual(doc);
    expect(history.redo(doc)).toEqual(current);
  });

  it('잠금·숨김·비유한 글꼴·범위를 벗어난 배치를 거부하며 원본의 스타일과 위치를 모두 보존한다', () => {
    const { doc, id } = textDocument();
    for (const flags of [{ locked: true }, { hidden: true }]) {
      const flagged = setElementFlags(doc, [id], flags);
      const before = structuredClone(flagged);
      expect(() =>
        resizeDocumentElementFromCorner(
          flagged,
          id,
          flagged.activeRatio,
          uniformInput(doc, id, 1.2),
        ),
      ).toThrow();
      expect(flagged).toEqual(before);
    }
    const before = structuredClone(doc);
    for (const fontSize of [0, 7, 301, NaN, Infinity])
      expect(() =>
        resizeDocumentElementFromCorner(doc, id, doc.activeRatio, {
          ...uniformInput(doc, id, 1.2),
          fontSize,
        }),
      ).toThrow();
    const request = uniformInput(doc, id, 2, 'nw');
    expect(() =>
      resizeDocumentElementFromCorner(doc, id, doc.activeRatio, {
        ...request,
        transform: { ...request.transform, x: -1.99, y: -1.99, rotation: 0 },
        dx: -500,
        dy: -500,
        fontSize: 40,
      }),
    ).toThrow();
    expect(doc).toEqual(before);
  });
});
