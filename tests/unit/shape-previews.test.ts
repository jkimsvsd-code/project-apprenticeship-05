import { describe, expect, it } from 'vitest';
import {
  addElement,
  createEditorDocument,
  newElementDimensions,
  shapeAppearance,
} from '@jjal/editor-core';
import { renderDocument, renderShapePreview } from '@jjal/renderer';
import { canvasSize } from '@jjal/policies';
import { recordingCanvas, type PaintCall } from './renderer-recording';

/** Ignore the document's panel/element clips; keep the shape's entire painted path and ink. */
function shapePaint(calls: PaintCall[]) {
  const fill = calls.findIndex((call) => call.operation === 'fill' && call.fill === '#F8F9FA');
  expect(fill).toBeGreaterThanOrEqual(0);
  let start = fill;
  while (start > 0 && calls[start]!.operation !== 'beginPath') start--;
  return calls.slice(start, fill + 2);
}

describe('도형 선택기의 실제 삽입 기하 공유', () => {
  it('새 도형은 정방형이고 기존 다른 요소의 초기 치수를 유지한다', () => {
    expect(newElementDimensions('shape', 1080, 1080)).toEqual({ width: 0.5, height: 0.5 });
    expect(newElementDimensions('text', 600, 400)).toEqual({ width: 0.8, height: 0.25 });
    expect(newElementDimensions('bubble', 600, 400)).toEqual({ width: 0.8, height: 0.3 });
    expect(newElementDimensions('shape', 1080, 120)).toEqual({ width: 60 / 1080, height: 0.5 });
    expect(newElementDimensions('character', 600, 400)).toEqual({ width: 1 / 3, height: 0.5 });
    expect(newElementDimensions('character', 200, 800)).toEqual({ width: 0.55, height: 0.1375 });
    expect(newElementDimensions('frame', 200, 800)).toEqual({ width: 1, height: 1 });
  });

  it.each(['rect', 'ellipse', 'triangle', 'diamond'] as const)(
    '%s 선택기와 삽입 요소의 기본 잉크·8비율 경로가 일치한다',
    (shape) => {
      const initial = createEditorDocument();
      const added = addElement(initial, initial.panels[0]!.id, { kind: 'shape', shape });
      const doc = added.document;
      const element = doc.elements.find((item) => item.id === added.elementId)!;
      expect(element).toEqual({
        id: added.elementId,
        locked: false,
        hidden: false,
        kind: 'shape',
        shape,
        fill: '#F8F9FA',
        contour: { texture: 'pen', color: '#0B0F2B', width: 2 },
      });
      expect(shapeAppearance(shape)).toEqual({
        kind: 'shape',
        shape,
        fill: '#F8F9FA',
        contour: { texture: 'pen', color: '#0B0F2B', width: 2 },
      });
      if (element.kind !== 'shape') throw new Error('도형 요소가 필요합니다.');
      doc.elements = [element];
      doc.panels[0]!.elementIds = [added.elementId];
      for (const layout of doc.layouts) {
        const panel = layout.panels[0]!;
        panel.elements = panel.elements.filter((item) => item.elementId === added.elementId);
        const size = canvasSize(layout.ratio);
        const pw = size.width * panel.rect.width,
          ph = size.height * panel.rect.height;
        const transform = panel.elements[0]!.transform;
        expect({ width: transform.width, height: transform.height }).toEqual(
          newElementDimensions('shape', pw, ph, shape),
        );
        expect(transform).toMatchObject({ rotation: 0, flipX: false });
        const actual = recordingCanvas(),
          preview = recordingCanvas();
        renderDocument(actual.canvas, doc, { ratio: layout.ratio });
        renderShapePreview(preview.canvas, element, transform.width * pw, transform.height * ph);
        expect(shapePaint(preview.calls)).toEqual(shapePaint(actual.calls));
        expect([preview.canvas.width, preview.canvas.height]).toEqual([
          Math.round(transform.width * pw),
          Math.round(transform.height * ph),
        ]);
      }
    },
  );

  it('잘못된 미리보기 치수는 기존 화면을 바꾸기 전에 거부한다', () => {
    const { canvas, calls } = recordingCanvas();
    const element = {
      id: 'preview',
      locked: false,
      hidden: false,
      ...shapeAppearance('rect'),
    };
    for (const [width, height] of [
      [0, 100],
      [100, -1],
      [NaN, 100],
      [100, Infinity],
    ]) {
      expect(() => renderShapePreview(canvas, element, width!, height!)).toThrow('크기');
      expect([canvas.width, canvas.height]).toEqual([88, 99]);
      expect(calls).toHaveLength(0);
      expect(() => newElementDimensions('shape', width!, height!)).toThrow('크기');
    }
  });

  it('임시 프레임을 만들 수 없으면 대상 캔버스는 보존된다', () => {
    const { canvas } = recordingCanvas();
    canvas.ownerDocument.createElement = (() => ({
      getContext: () => null,
    })) as unknown as Document['createElement'];
    expect(() =>
      renderShapePreview(
        canvas,
        { id: 'preview', locked: false, hidden: false, ...shapeAppearance('ellipse') },
        200,
        100,
      ),
    ).toThrow('캔버스');
    expect([canvas.width, canvas.height]).toEqual([88, 99]);
  });
});
