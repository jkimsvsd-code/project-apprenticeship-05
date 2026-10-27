import type { ResizeCorner, ResizeEdge } from '@jjal/editor-core';
import type { Point } from './transformGeometry';

export type ResizeHandle = ResizeCorner | ResizeEdge;

const directions: Record<ResizeHandle, Point> = {
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  sw: { x: -1, y: 1 },
  se: { x: 1, y: 1 },
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};
const targetSize = 44;
const separation = targetSize + 4;
const centerClearance = targetSize / 2 + 12;
const epsilon = 0.000001;

interface Input {
  /** All coordinates, including the containing stage, are in CSS pixels relative to the canvas. */
  center: Point;
  width: number;
  height: number;
  rotation: number;
  edges: boolean;
  stage: { left: number; top: number; width: number; height: number };
  /** Actual reflected tail location. Its control may move without changing the tail model. */
  tail?: Point;
}

/** Shared deterministic layout for all DOM targets; it never changes artwork or gesture anchors. */
export function editorHandleLayout(input: Input) {
  const { center, stage } = input;
  if (
    ![
      center.x,
      center.y,
      input.width,
      input.height,
      input.rotation,
      stage.left,
      stage.top,
      stage.width,
      stage.height,
      ...(input.tail ? [input.tail.x, input.tail.y] : []),
    ].every(Number.isFinite) ||
    input.width <= 0 ||
    input.height <= 0 ||
    stage.width <= 0 ||
    stage.height <= 0
  )
    throw new Error('조절 손잡이의 표시 영역을 확인해 주세요.');

  const a = (input.rotation * Math.PI) / 180,
    cos = Math.cos(a),
    sin = Math.sin(a);
  const rotate = (x: number, y: number): Point => ({
    x: center.x + x * cos - y * sin,
    y: center.y + x * sin + y * cos,
  });
  const axisBounds = (origin: number, extent: number) =>
    extent < targetSize
      ? [origin + extent / 2, origin + extent / 2]
      : [origin + targetSize / 2, origin + extent - targetSize / 2];
  const [minX, maxX] = axisBounds(stage.left, stage.width),
    [minY, maxY] = axisBounds(stage.top, stage.height);
  const clampX = (x: number) => Math.max(minX!, Math.min(maxX!, x));
  const clampY = (y: number) => Math.max(minY!, Math.min(maxY!, y));
  const occupied: Point[] = [];
  const distance = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const coversCenter = (point: Point) =>
    Math.abs(point.x - center.x) < centerClearance - epsilon &&
    Math.abs(point.y - center.y) < centerClearance - epsilon;
  const collisions = (point: Point) =>
    occupied.filter(
      (other) =>
        Math.abs(point.x - other.x) < separation - epsilon &&
        Math.abs(point.y - other.y) < separation - epsilon,
    ).length;
  function place(preferred: Point): Point {
    const clamped = { x: clampX(preferred.x), y: clampY(preferred.y) };
    if (!coversCenter(clamped) && !collisions(clamped)) {
      occupied.push(clamped);
      return clamped;
    }
    // The nearest free point lies on a target/central-area boundary, a stage
    // boundary, or one of the preferred axes. No DOM measurement feedback loop.
    const xs = [clamped.x, minX!, maxX!, center.x - centerClearance, center.x + centerClearance],
      ys = [clamped.y, minY!, maxY!, center.y - centerClearance, center.y + centerClearance];
    for (const other of occupied) {
      xs.push(other.x - separation, other.x + separation);
      ys.push(other.y - separation, other.y + separation);
    }
    const candidates = [...new Set(xs.map(clampX))].flatMap((x) =>
      [...new Set(ys.map(clampY))].map((y) => ({ x, y })),
    );
    candidates.sort(
      (a, b) =>
        distance(a, preferred) - distance(b, preferred) ||
        distance(b, center) - distance(a, center),
    );
    const free = candidates.find((point) => !coversCenter(point) && !collisions(point));
    // Pathological off-card/undersized stages retain reachable bounded controls;
    // ordinary in-card boxes have ample room for all ten 44px targets.
    const point =
      free ??
      candidates
        .filter((candidate) => !coversCenter(candidate))
        .sort((a, b) => collisions(a) - collisions(b))[0] ??
      clamped;
    occupied.push(point);
    return point;
  }

  // At 45°, adjacent corner/edge targets need >= 44px on one screen axis.
  // 136px also provides a small gap while preserving the central drag area.
  const minimumSpan = input.edges ? 136 : 64;
  const width = Math.max(input.width, minimumSpan),
    height = Math.max(input.height, minimumSpan);
  const resize = {} as Record<ResizeHandle, Point>;
  for (const handle of Object.keys(directions) as ResizeHandle[]) {
    const direction = directions[handle];
    if (!input.edges && handle.length === 1) continue;
    resize[handle] = place(rotate((direction.x * width) / 2, (direction.y * height) / 2));
  }
  const top = rotate(0, -input.height / 2);
  const rotation = place({ x: top.x + sin * 36, y: top.y - cos * 36 });
  const tail = input.tail ? place(input.tail) : undefined;
  return { resize, rotation, tail, top };
}
