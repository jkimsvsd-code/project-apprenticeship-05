// The resource tile and the editable balloon share this 64×40 cloud outline.
const curves = [
  [4, 34, 3, 27, 6, 23],
  [0, 18, 5, 10, 12, 11],
  [14, 3, 24, 2, 29, 7],
  [35, 1, 45, 4, 46, 9],
  [56, 5, 64, 14, 58, 22],
  [64, 30, 54, 39, 47, 35],
  [42, 42, 31, 39, 29, 35],
  [24, 40, 17, 39, 13, 34],
] as const;

export const THOUGHT_CLOUD_SVG_PATH = `M13 34${curves.map((c) => `C${c.join(' ')}`).join('')}Z`;

export function traceThoughtCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sx = width / 64;
  const sy = height / 40;
  ctx.moveTo(x + 13 * sx, y + 34 * sy);
  for (const [ax, ay, bx, by, cx, cy] of curves)
    ctx.bezierCurveTo(x + ax * sx, y + ay * sy, x + bx * sx, y + by * sy, x + cx * sx, y + cy * sy);
  ctx.closePath();
}
