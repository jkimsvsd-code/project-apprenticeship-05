import { describe, expect, it } from 'vitest';
import { createBuiltinDocument } from '@jjal/content';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import {
  addElement,
  alignElement,
  createEditorDocument,
  elementBounds,
  snapElementPosition,
  transformElement,
} from '@jjal/editor-core';

describe('정렬과 자동 맞춤', () => {
  it.each(ASPECT_RATIOS)(
    '%s의 회전 상자를 여섯 방향에 맞추고 다른 컷/비율/서식은 보존한다',
    (ratio) => {
      let doc = createBuiltinDocument('builtin-story');
      const id = doc.panels[2]!.elementIds[0]!;
      doc = transformElement(doc, id, ratio, {
        x: 0.2,
        y: 0.25,
        width: 0.22,
        height: 0.3,
        rotation: 37,
      });
      const original = structuredClone(doc);
      for (const alignment of ['left', 'center', 'right', 'top', 'middle', 'bottom'] as const) {
        const result = alignElement(doc, id, ratio, alignment);
        const placed = result.layouts.find((layout) => layout.ratio === ratio)!.panels[2]!;
        const t = placed.elements.find((item) => item.elementId === id)!.transform;
        const size = canvasSize(ratio);
        // Independent corner rotation, using actual panel pixel dimensions.
        const pw = placed.rect.width * size.width,
          ph = placed.rect.height * size.height;
        const angle = (37 * Math.PI) / 180;
        const corners = [-1, 1].flatMap((x) =>
          [-1, 1].map((y) => ({
            x:
              (t.x + t.width / 2) * pw +
              ((x * t.width * pw) / 2) * Math.cos(angle) -
              ((y * t.height * ph) / 2) * Math.sin(angle),
            y:
              (t.y + t.height / 2) * ph +
              ((x * t.width * pw) / 2) * Math.sin(angle) +
              ((y * t.height * ph) / 2) * Math.cos(angle),
          })),
        );
        const xs = corners.map((p) => p.x / pw),
          ys = corners.map((p) => p.y / ph);
        const actual = {
          left: Math.min(...xs),
          right: Math.max(...xs),
          center: (Math.min(...xs) + Math.max(...xs)) / 2,
          top: Math.min(...ys),
          bottom: Math.max(...ys),
          middle: (Math.min(...ys) + Math.max(...ys)) / 2,
        };
        expect(actual[alignment]).toBeCloseTo(
          alignment === 'center' || alignment === 'middle'
            ? 0.5
            : alignment === 'right' || alignment === 'bottom'
              ? 1
              : 0,
          9,
        );
        expect(result.layouts.filter((layout) => layout.ratio !== ratio)).toEqual(
          doc.layouts.filter((layout) => layout.ratio !== ratio),
        );
        expect(result.layouts.find((layout) => layout.ratio === ratio)!.panels[0]).toEqual(
          doc.layouts.find((layout) => layout.ratio === ratio)!.panels[0],
        );
        expect(result.elements).toEqual(doc.elements);
      }
      expect(doc).toEqual(original);
    },
  );
  it('90도 회전은 세로/가로 픽셀 비율을 바꾸고 반전은 상자에 영향을 주지 않는다', () => {
    const t = {
      x: 0.2,
      y: 0.3,
      width: 0.4,
      height: 0.2,
      rotation: 90,
      flipX: true,
      flipY: true,
      opacity: 1,
    };
    expect(elementBounds(t, 200, 400)).toMatchObject({
      left: 0.2,
      right: 0.6000000000000001,
      top: 0.30000000000000004,
      bottom: 0.5,
    });
    expect(elementBounds(t, 200, 400)).toEqual(
      elementBounds({ ...t, flipX: false, flipY: false }, 200, 400),
    );
  });
  it('가장 가까운 경계/중심을 선택하고 한도 밖에는 맞추지 않는다', () => {
    let doc = createEditorDocument();
    doc = transformElement(doc, 'line-1', '1:1', { width: 0.2, height: 0.2, x: 0.1, y: 0.1 });
    const before = structuredClone(doc);
    expect(
      snapElementPosition(doc, 'line-1', '1:1', { x: 0.397, y: 0.795 }, { x: 0.01, y: 0.01 }),
    ).toEqual({
      position: { x: 0.4, y: 0.8 },
      guides: [
        { axis: 'x', position: 0.5, source: 'panel' },
        { axis: 'y', position: 1, source: 'panel' },
      ],
    });
    expect(
      snapElementPosition(doc, 'line-1', '1:1', { x: 0.37, y: 0.77 }, { x: 0.01, y: 0.01 }).guides,
    ).toEqual([]);
    expect(doc).toEqual(before);
  });
  it('같은 컷의 보이는 잠긴 요소도 기준이 되며 숨김/투명/다른 컷은 제외한다', () => {
    let doc = createBuiltinDocument('builtin-story');
    const result = addElement(doc, doc.panels[0]!.id, { kind: 'text' });
    doc = result.document;
    const target = doc.panels[0]!.elementIds[0]!;
    doc = transformElement(doc, target, '1:1', { x: 0.23, y: 0.31, width: 0.2, height: 0.2 });
    doc = transformElement(doc, result.elementId, '1:1', { width: 0.1, height: 0.1 });
    for (const element of doc.elements)
      element.hidden = element.id !== target && element.id !== result.elementId;
    doc.elements.find((item) => item.id === target)!.locked = true;
    const snap = () =>
      snapElementPosition(
        doc,
        result.elementId,
        '1:1',
        { x: 0.231, y: 0.311 },
        { x: 0.002, y: 0.002 },
      );
    expect(snap().guides.map(({ axis, source }) => ({ axis, source }))).toEqual([
      { axis: 'x', source: 'element' },
      { axis: 'y', source: 'element' },
    ]);
    expect(snap().guides[0]!.position).toBeCloseTo(0.23, 12);
    expect(snap().guides[1]!.position).toBeCloseTo(0.31, 12);
    doc.elements.find((item) => item.id === target)!.hidden = true;
    expect(snap().guides).toEqual([]);
    doc.elements.find((item) => item.id === target)!.hidden = false;
    doc.layouts[0]!.panels[0]!.elements.find(
      (item) => item.elementId === target,
    )!.transform.opacity = 0;
    expect(snap().guides).toEqual([]);
  });
  it('컷 밖으로 완전히 잘린 요소는 다른 축의 정렬 기준에서도 제외한다', () => {
    let doc = createEditorDocument();
    const added = addElement(doc, doc.panels[0]!.id, { kind: 'text' });
    doc = transformElement(added.document, 'line-1', '1:1', {
      x: 0.23,
      y: 2,
      width: 0.2,
      height: 0.2,
    });
    doc = transformElement(doc, added.elementId, '1:1', { width: 0.1, height: 0.1 });
    expect(
      snapElementPosition(
        doc,
        added.elementId,
        '1:1',
        { x: 0.231, y: 0.311 },
        { x: 0.002, y: 0.002 },
      ).guides,
    ).toEqual([]);
  });
  it('잘못된 좌표/없는 대상/잠금/모델 한도 초과는 원본을 유지하며 거부한다', () => {
    const doc = createEditorDocument(),
      before = structuredClone(doc);
    for (const value of [NaN, Infinity, -Infinity])
      expect(() =>
        snapElementPosition(doc, 'line-1', '1:1', { x: value, y: 0 }, { x: 0.01, y: 0.01 }),
      ).toThrow();
    expect(() =>
      snapElementPosition(doc, 'line-1', '1:1', { x: 0, y: 0 }, { x: -1, y: 0 }),
    ).toThrow();
    expect(() => alignElement(doc, 'missing', '1:1', 'left')).toThrow();
    expect(doc).toEqual(before);
    doc.elements[0]!.locked = true;
    expect(() => alignElement(doc, 'line-1', '1:1', 'left')).toThrow('잠긴');
    expect(() =>
      snapElementPosition(doc, 'line-1', '1:1', { x: 0, y: 0 }, { x: 0.1, y: 0.1 }),
    ).toThrow('잠긴');
    doc.elements[0]!.locked = false;
    const wide = transformElement(doc, 'line-1', '9:16', { width: 4, height: 4, rotation: 45 });
    const snapshot = structuredClone(wide);
    expect(() => alignElement(wide, 'line-1', '9:16', 'right')).toThrow();
    expect(wide).toEqual(snapshot);
  });
});
