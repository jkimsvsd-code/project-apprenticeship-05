import type { BubbleAppearance, ElementTransform } from '@jjal/document-model';

export interface Point {
  x: number;
  y: number;
}

export interface ElementFrame {
  transform: ElementTransform;
  panel: { x: number; y: number; width: number; height: number };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function validateFrame(frame: ElementFrame) {
  const { transform: t, panel: p } = frame;
  if (
    ![p.x, p.y, p.width, p.height, t.x, t.y, t.width, t.height, t.rotation].every(
      Number.isFinite,
    ) ||
    p.width <= 0 ||
    p.height <= 0 ||
    t.width <= 0 ||
    t.height <= 0
  )
    throw new Error('요소의 배치 크기를 확인해 주세요.');
}

/** Renderer order: panel placement, element centre, rotation, then local reflection. */
export function elementPointToCanvas(frame: ElementFrame, point: Point): Point {
  validateFrame(frame);
  const { transform: t, panel: p } = frame;
  const x = (point.x - 0.5) * t.width * p.width * (t.flipX ? -1 : 1);
  const y = (point.y - 0.5) * t.height * p.height * (t.flipY ? -1 : 1);
  const a = (t.rotation * Math.PI) / 180;
  return {
    x: p.x + (t.x + t.width / 2) * p.width + x * Math.cos(a) - y * Math.sin(a),
    y: p.y + (t.y + t.height / 2) * p.height + x * Math.sin(a) + y * Math.cos(a),
  };
}

export function canvasPointToElement(frame: ElementFrame, point: Point): Point {
  validateFrame(frame);
  const { transform: t, panel: p } = frame;
  const x = point.x - p.x - (t.x + t.width / 2) * p.width;
  const y = point.y - p.y - (t.y + t.height / 2) * p.height;
  const a = (-t.rotation * Math.PI) / 180;
  return {
    x: 0.5 + ((x * Math.cos(a) - y * Math.sin(a)) * (t.flipX ? -1 : 1)) / (t.width * p.width),
    y: 0.5 + ((x * Math.sin(a) + y * Math.cos(a)) * (t.flipY ? -1 : 1)) / (t.height * p.height),
  };
}

/** Smallest signed angular movement; crossing -180/180 does not cause a full turn. */
export function pointerAngleDelta(center: Point, previous: Point, next: Point): number {
  if (![center.x, center.y, previous.x, previous.y, next.x, next.y].every(Number.isFinite))
    throw new Error('회전 위치를 확인해 주세요.');
  if (
    Math.hypot(previous.x - center.x, previous.y - center.y) < 0.001 ||
    Math.hypot(next.x - center.x, next.y - center.y) < 0.001
  )
    return 0;
  const delta =
    ((Math.atan2(next.y - center.y, next.x - center.x) -
      Math.atan2(previous.y - center.y, previous.x - center.x)) *
      180) /
    Math.PI;
  return ((delta + 540) % 360) - 180;
}

export function normalizeRotation(value: number): number {
  if (!Number.isFinite(value)) throw new Error('회전 값을 확인해 주세요.');
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

/** The tip stays within the same 18% tail band exposed by the numeric style tools. */
export function tailFromElementPoint(point: Point): NonNullable<BubbleAppearance['tail']> {
  if (![point.x, point.y].every(Number.isFinite)) throw new Error('꼬리 위치를 확인해 주세요.');
  const dx = point.x - 0.5,
    dy = point.y - 0.5;
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0
      ? { side: 'left', x: clamp(point.x, 0, 0.18), y: clamp(point.y, 0, 1) }
      : { side: 'right', x: clamp(point.x, 0.82, 1), y: clamp(point.y, 0, 1) };
  }
  return dy < 0
    ? { side: 'top', x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 0.18) }
    : { side: 'bottom', x: clamp(point.x, 0, 1), y: clamp(point.y, 0.82, 1) };
}
