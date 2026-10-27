import { describe, expect, it } from 'vitest';
import { editorHandleLayout } from '../../apps/demo/src/composition/editorHandleLayout';

const angles = [0, 23, 45, 90, 135, 180, -23, -90];
const profiles = [
  {
    name: 'PC',
    stage: { left: -34, top: -34, width: 630, height: 630 },
    center: { x: 281, y: 281 },
    sizes: [
      [214, 124],
      [45, 34],
    ],
  },
  {
    name: 'phone',
    stage: { left: -18, top: -18, width: 390, height: 390 },
    center: { x: 177, y: 177 },
    sizes: [
      [135, 78],
      [28, 21],
    ],
  },
  {
    name: 'landscape',
    stage: { left: -20, top: -20, width: 492, height: 294 },
    center: { x: 226, y: 127 },
    sizes: [
      [172, 56],
      [36, 15],
    ],
  },
];

function checkLayout(input: Parameters<typeof editorHandleLayout>[0]) {
  const result = editorHandleLayout(input);
  const points = [
    ...Object.values(result.resize),
    result.rotation,
    ...(result.tail ? [result.tail] : []),
  ];
  expect(points).toHaveLength(input.tail ? 10 : 9);
  for (const point of points) {
    expect(point.x - 22).toBeGreaterThanOrEqual(input.stage.left - 0.000001);
    expect(point.y - 22).toBeGreaterThanOrEqual(input.stage.top - 0.000001);
    expect(point.x + 22).toBeLessThanOrEqual(input.stage.left + input.stage.width + 0.000001);
    expect(point.y + 22).toBeLessThanOrEqual(input.stage.top + input.stage.height + 0.000001);
    expect(
      Math.abs(point.x - input.center.x) >= 34 - 0.000001 ||
        Math.abs(point.y - input.center.y) >= 34 - 0.000001,
    ).toBe(true);
  }
  for (let a = 0; a < points.length; a++)
    for (let b = a + 1; b < points.length; b++) {
      expect(
        Math.abs(points[a]!.x - points[b]!.x) >= 44 - 0.000001 ||
          Math.abs(points[a]!.y - points[b]!.y) >= 44 - 0.000001,
      ).toBe(true);
    }
  return result;
}

describe('bubble DOM target layout', () => {
  for (const profile of profiles) {
    it(`${profile.name}: small/default boxes preserve all 44px targets, the central 24px drag area, and stage bounds at rotated angles`, () => {
      for (const [width, height] of profile.sizes)
        for (const rotation of angles) {
          const a = (rotation * Math.PI) / 180;
          for (const [x, y] of [
            [0, 0.5],
            [0.5, 0],
            [1, 0.5],
            [0.5, 1],
          ]) {
            const dx = (x! - 0.5) * width!,
              dy = (y! - 0.5) * height!;
            const input = {
              center: profile.center,
              width: width!,
              height: height!,
              rotation,
              edges: true,
              stage: profile.stage,
              tail: {
                x: profile.center.x + dx * Math.cos(a) - dy * Math.sin(a),
                y: profile.center.y + dx * Math.sin(a) + dy * Math.cos(a),
              },
            };
            const original = structuredClone(input);
            const result = checkLayout(input);
            expect(input).toEqual(original);
            expect(editorHandleLayout(input)).toEqual(result);
          }
          checkLayout({
            center: profile.center,
            width: width!,
            height: height!,
            rotation,
            edges: true,
            stage: profile.stage,
          });
        }
    });
  }
  it('uses the same resize target locations with or without a tail; the actual tail is unchanged', () => {
    const input = {
      center: { x: 281, y: 281 },
      width: 214,
      height: 124,
      rotation: 23,
      edges: true,
      stage: profiles[0]!.stage,
    };
    const plain = editorHandleLayout(input);
    const tail = { ...plain.resize.s };
    const withTail = checkLayout({ ...input, tail });
    expect(withTail.resize).toEqual(plain.resize);
    expect(withTail.rotation).toEqual(plain.rotation);
    expect(withTail.tail).not.toEqual(tail);
    expect(tail).toEqual(plain.resize.s);
  });
  it('keeps ordinary edge targets on their geometric edges when there is room', () => {
    const layout = editorHandleLayout({
      center: { x: 281, y: 281 },
      width: 214,
      height: 160,
      rotation: 0,
      edges: true,
      stage: profiles[0]!.stage,
    });
    expect(layout.resize.n).toEqual({ x: 281, y: 201 });
    expect(layout.resize.e).toEqual({ x: 388, y: 281 });
    expect(layout.resize.s).toEqual({ x: 281, y: 361 });
    expect(layout.resize.w).toEqual({ x: 174, y: 281 });
  });
  it('keeps bounded controls separate for ordinary bubbles near stage corners', () => {
    for (const center of [
      { x: 70, y: 70 },
      { x: 284, y: 70 },
      { x: 70, y: 284 },
      { x: 284, y: 284 },
    ])
      for (const rotation of [0, 23, 45, 90])
        checkLayout({
          center,
          width: 28,
          height: 21,
          rotation,
          edges: true,
          stage: profiles[1]!.stage,
          tail: { x: center.x, y: center.y + 10.5 },
        });
  });
  it('rejects nonfinite geometry without changing its input', () => {
    const input = {
      center: { x: 281, y: 281 },
      width: 45,
      height: 34,
      rotation: Number.NaN,
      edges: true,
      stage: profiles[0]!.stage,
    };
    expect(() => editorHandleLayout(input)).toThrow('표시 영역');
    expect(input.width).toBe(45);
  });
});
