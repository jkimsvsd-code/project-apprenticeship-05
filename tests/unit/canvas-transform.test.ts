import { describe, expect, it } from 'vitest';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import { BubbleTailSchema, type ElementTransform } from '@jjal/document-model';
import { createEditorDocument, EditHistory, transformElement } from '@jjal/editor-core';
import {
  canvasPointToElement,
  elementPointToCanvas,
  normalizeRotation,
  pointerAngleDelta,
  tailFromElementPoint,
  type ElementFrame,
} from '../../apps/demo/src/composition/transformGeometry';

const transform: ElementTransform = {
  x: 0.14,
  y: -0.06,
  width: 0.64,
  height: 0.48,
  rotation: 37,
  flipX: false,
  flipY: false,
  opacity: 0.8,
};
describe('Canvas 회전과 말풍선 꼬리 좌표', () => {
  it.each(ASPECT_RATIOS)(
    '%s 비정방 다중 컷의 회전·반전을 렌더러와 같은 순서로 계산한다',
    (ratio) => {
      const size = canvasSize(ratio, 1080);
      for (const flipX of [false, true])
        for (const flipY of [false, true])
          for (const rotation of [-179, -90, 0, 37, 180]) {
            const frame: ElementFrame = {
              transform: { ...transform, flipX, flipY, rotation },
              panel: {
                x: size.width * 0.51,
                y: size.height * 0.02,
                width: size.width * 0.47,
                height: size.height * 0.46,
              },
            };
            for (const local of [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
              { x: 0.5, y: 0.5 },
              { x: 0.3, y: 0.95 },
            ]) {
              const x = (local.x - 0.5) * transform.width * frame.panel.width * (flipX ? -1 : 1);
              const y = (local.y - 0.5) * transform.height * frame.panel.height * (flipY ? -1 : 1);
              const radians = (rotation * Math.PI) / 180;
              const expected = {
                x:
                  frame.panel.x +
                  (transform.x + transform.width / 2) * frame.panel.width +
                  x * Math.cos(radians) -
                  y * Math.sin(radians),
                y:
                  frame.panel.y +
                  (transform.y + transform.height / 2) * frame.panel.height +
                  x * Math.sin(radians) +
                  y * Math.cos(radians),
              };
              const rendered = elementPointToCanvas(frame, local);
              expect(rendered.x).toBeCloseTo(expected.x, 10);
              expect(rendered.y).toBeCloseTo(expected.y, 10);
              const recovered = canvasPointToElement(frame, rendered);
              expect(recovered.x).toBeCloseTo(local.x, 12);
              expect(recovered.y).toBeCloseTo(local.y, 12);
            }
          }
    },
  );

  it('각도 경계를 왕복해도 ±358도 점프 없이 2도씩 회전하고 중심은 무시한다', () => {
    const point = (degrees: number) => ({
      x: Math.cos((degrees * Math.PI) / 180) * 60 + 120,
      y: Math.sin((degrees * Math.PI) / 180) * 60 + 90,
    });
    const center = { x: 120, y: 90 };
    expect(pointerAngleDelta(center, point(179), point(-179))).toBeCloseTo(2, 12);
    expect(pointerAngleDelta(center, point(-179), point(179))).toBeCloseTo(-2, 12);
    expect(pointerAngleDelta(center, center, point(120))).toBe(0);
    expect(normalizeRotation(-721)).toBe(-1);
    expect(normalizeRotation(721)).toBe(1);
  });

  it('한 번의 회전 드래그는 위치·크기·반전을 유지하며 이력 한 건으로 복구된다', () => {
    let current = createEditorDocument();
    const before = structuredClone(current),
      id = current.elements[0]!.id;
    const history = new EditHistory<typeof current>(
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );
    const group = Symbol('rotate');
    for (const rotation of [12, 39, 98]) {
      const next = transformElement(current, id, current.activeRatio, { rotation });
      history.record(current, next, group);
      current = next;
    }
    expect(history.undoCount).toBe(1);
    const oldPlacement = before.layouts.find((layout) => layout.ratio === before.activeRatio)!
      .panels[0]!.elements[0]!.transform;
    expect(current.layouts[0]!.panels[0]!.elements[0]!.transform).toEqual({
      ...oldPlacement,
      rotation: 98,
    });
    expect(current.layouts.slice(1)).toEqual(before.layouts.slice(1));
    expect(history.undo(current)).toEqual(before);
    expect(history.redo(before)).toEqual(current);
  });

  it.each([
    [
      { x: 0.35, y: 0.95 },
      { side: 'bottom', x: 0.35, y: 0.95 },
    ],
    [
      { x: 0.4, y: 0.09 },
      { side: 'top', x: 0.4, y: 0.09 },
    ],
    [
      { x: 0.07, y: 0.6 },
      { side: 'left', x: 0.07, y: 0.6 },
    ],
    [
      { x: 0.93, y: 0.4 },
      { side: 'right', x: 0.93, y: 0.4 },
    ],
    [
      { x: 0.5, y: 0.6 },
      { side: 'bottom', x: 0.5, y: 0.82 },
    ],
    [
      { x: -2, y: -1 },
      { side: 'left', x: 0, y: 0 },
    ],
    [
      { x: 1.8, y: 3 },
      { side: 'bottom', x: 1, y: 1 },
    ],
  ])('꼬리 tip %j는 방향·길이의 유효 범위 %j가 된다', (point, expected) => {
    expect(tailFromElementPoint(point)).toEqual(expected);
    expect(BubbleTailSchema.safeParse(tailFromElementPoint(point)).success).toBe(true);
  });

  it('잘못된 좌표와 크기는 원본 프레임을 변경하지 않고 거부한다', () => {
    const frame = { transform, panel: { x: 0, y: 0, width: 500, height: 0 } };
    const before = structuredClone(frame);
    expect(() => elementPointToCanvas(frame, { x: 0, y: 0 })).toThrow();
    expect(() => pointerAngleDelta({ x: NaN, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 })).toThrow();
    expect(() => tailFromElementPoint({ x: Infinity, y: 0 })).toThrow();
    expect(() => normalizeRotation(NaN)).toThrow();
    expect(frame).toEqual(before);
  });
});
