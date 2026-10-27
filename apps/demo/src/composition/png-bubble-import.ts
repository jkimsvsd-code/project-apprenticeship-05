import { CustomBubbleResourceSchema, type CustomBubbleResource } from '@jjal/document-model';
import { prepareImage, type PreparedImage } from '@jjal/image-io';

export interface BubbleMask {
  width: number;
  height: number;
  pixels: Uint8Array;
}
export interface BodyBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type TailSide = 'none' | 'top' | 'right' | 'bottom' | 'left';
export interface BubbleImportCandidate {
  image: PreparedImage;
  mask: BubbleMask;
  bounds: BodyBounds;
  side: TailSide;
  url: string;
}
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Transparent outside or connected white outside is removed; enclosed interiors stay solid. */
export function bubbleMaskFromPixels(
  width: number,
  height: number,
  rgba: Uint8ClampedArray,
): BubbleMask {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 3 ||
    height < 3 ||
    width > 256 ||
    height > 256 ||
    rgba.length !== width * height * 4
  )
    throw new Error('PNG 말풍선 크기를 확인해 주세요.');
  const count = width * height,
    raw = new Uint8Array(count),
    outside = new Uint8Array(count),
    queue = new Int32Array(count);
  let transparent = false;
  for (let i = 3; i < rgba.length; i += 4)
    if (rgba[i]! < 32) {
      transparent = true;
      break;
    }
  if (!transparent) {
    const corners = [0, width - 1, (height - 1) * width, count - 1];
    if (corners.some((i) => Math.min(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!) < 235))
      throw new Error('투명 배경 또는 흰 배경의 PNG 말풍선을 선택해 주세요.');
  }
  for (let i = 0; i < count; i++)
    raw[i] = transparent
      ? Number(rgba[i * 4 + 3]! >= 32)
      : Number(Math.min(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!) < 235);
  let head = 0,
    tail = 0;
  const visit = (i: number) => {
    if (!raw[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const i = queue[head++]!,
      x = i % width,
      y = Math.floor(i / width);
    if (x) visit(i - 1);
    if (x + 1 < width) visit(i + 1);
    if (y) visit(i - width);
    if (y + 1 < height) visit(i + width);
  }
  const solid = outside.map((v) => 1 - v),
    seen = new Uint8Array(count);
  let largest: number[] = [];
  for (let start = 0; start < count; start++)
    if (solid[start] && !seen[start]) {
      const component: number[] = [];
      head = 0;
      tail = 0;
      queue[tail++] = start;
      seen[start] = 1;
      while (head < tail) {
        const i = queue[head++]!;
        component.push(i);
        const x = i % width,
          y = Math.floor(i / width);
        for (const next of [
          x ? i - 1 : -1,
          x + 1 < width ? i + 1 : -1,
          y ? i - width : -1,
          y + 1 < height ? i + width : -1,
        ])
          if (next >= 0 && solid[next] && !seen[next]) {
            seen[next] = 1;
            queue[tail++] = next;
          }
      }
      if (component.length > largest.length) largest = component;
    }
  if (largest.length < 16 || largest.length > count * 0.97)
    throw new Error('말풍선 본체 윤곽을 찾지 못했습니다. 투명 여백이 있는 PNG를 선택해 주세요.');
  const pixels = new Uint8Array(count);
  for (const i of largest) pixels[i] = 1;
  return { width, height, pixels };
}

export function initialBubbleBounds(mask: BubbleMask): BodyBounds {
  let left = mask.width,
    top = mask.height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < mask.height; y++)
    for (let x = 0; x < mask.width; x++)
      if (mask.pixels[y * mask.width + x]) {
        left = Math.min(left, x);
        right = Math.max(right, x + 1);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y + 1);
      }
  return {
    x: left / mask.width,
    y: top / mask.height,
    width: (right - left) / mask.width,
    height: (bottom - top) / mask.height,
  };
}

/** Crop explicitly selected by the user; no claim that PNG pixels reveal semantic tails. */
export function bubbleOutline(mask: BubbleMask, bounds: BodyBounds) {
  if (
    !Object.values(bounds).every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x + bounds.width > 1.000001 ||
    bounds.y + bounds.height > 1.000001
  )
    throw new Error('말풍선 본체 범위를 이미지 안으로 지정해 주세요.');
  const left = clamp(Math.round(bounds.x * mask.width), 0, mask.width - 1),
    top = clamp(Math.round(bounds.y * mask.height), 0, mask.height - 1);
  const right = clamp(Math.round((bounds.x + bounds.width) * mask.width), left + 1, mask.width),
    bottom = clamp(Math.round((bounds.y + bounds.height) * mask.height), top + 1, mask.height);
  const w = right - left,
    h = bottom - top;
  const inside = (x: number, y: number) =>
    x >= left && x < right && y >= top && y < bottom && !!mask.pixels[y * mask.width + x];
  const edges = new Map<string, [number, number][]>();
  const add = (x: number, y: number, nx: number, ny: number) => {
    const key = `${x},${y}`;
    edges.set(key, [...(edges.get(key) ?? []), [nx, ny]]);
  };
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++)
      if (inside(x, y)) {
        if (!inside(x, y - 1)) add(x, y, x + 1, y);
        if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
        if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
        if (!inside(x - 1, y)) add(x, y + 1, x, y);
      }
  let best: [number, number][] = [],
    bestArea = 0;
  while (edges.size) {
    const start = edges.keys().next().value!;
    let key = start;
    const points: [number, number][] = [];
    for (let steps = 0; steps <= mask.width * mask.height * 4; steps++) {
      const [x, y] = key.split(',').map(Number);
      points.push([x!, y!]);
      const next = edges.get(key)?.pop();
      if (!edges.get(key)?.length) edges.delete(key);
      if (!next) break;
      key = next.join(',');
      if (key === start) break;
    }
    const area = Math.abs(
      points.reduce((sum, p, i) => {
        const n = points[(i + 1) % points.length]!;
        return sum + p[0] * n[1] - n[0] * p[1];
      }, 0),
    );
    if (area > bestArea) {
      bestArea = area;
      best = points;
    }
  }
  // Remove pixel-run vertices first, then bound the serialized path cost.
  best = best.filter((p, i) => {
    const a = best[(i + best.length - 1) % best.length]!,
      b = best[(i + 1) % best.length]!;
    return (p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0]);
  });
  if (best.length > 256)
    best = Array.from({ length: 256 }, (_, i) => best[Math.floor((i * best.length) / 256)]!);
  return best.map(([x, y]) => ({ x: (x - left) / w, y: (y - top) / h }));
}

export function customBubbleFromCandidate(
  candidate: Pick<BubbleImportCandidate, 'image' | 'mask' | 'bounds' | 'side'>,
): CustomBubbleResource {
  const side = candidate.side;
  return CustomBubbleResourceSchema.parse({
    customShape: {
      sourceAssetId: `resource-${candidate.image.asset.sha256}`,
      bodyOutline: bubbleOutline(candidate.mask, candidate.bounds),
      textRect: { x: 0.08, y: 0.08, width: 0.84, height: 0.84 },
    },
    tail:
      side === 'none'
        ? null
        : {
            side,
            x: side === 'left' ? 0 : side === 'right' ? 1 : 0.5,
            y: side === 'top' ? 0 : side === 'bottom' ? 1 : 0.5,
          },
    fill: '#FFFFFF',
    border: '#0B0F2B',
    borderWidth: 2,
  });
}

export async function prepareBubbleFiles(files: readonly File[]): Promise<BubbleImportCandidate[]> {
  const candidates: BubbleImportCandidate[] = [];
  try {
    for (const file of files) {
      const image = await prepareImage(file);
      try {
        if (image.asset.mimeType !== 'image/png')
          throw new Error('말풍선 파일은 PNG만 지원합니다.');
        const scale = Math.min(1, 256 / image.source.width, 256 / image.source.height),
          width = Math.max(3, Math.round(image.source.width * scale)),
          height = Math.max(3, Math.round(image.source.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image.source, 0, 0, width, height);
        const mask = bubbleMaskFromPixels(
          width,
          height,
          context.getImageData(0, 0, width, height).data,
        );
        canvas.width = canvas.height = 0;
        const candidate = {
          image,
          mask,
          bounds: initialBubbleBounds(mask),
          side: 'none' as const,
          url: URL.createObjectURL(image.original),
        };
        try {
          customBubbleFromCandidate(candidate);
        } catch (cause) {
          URL.revokeObjectURL(candidate.url);
          throw cause;
        }
        candidates.push(candidate);
      } finally {
        image.source.width = image.source.height = 0;
      }
    }
    return candidates;
  } catch (cause) {
    for (const candidate of candidates) URL.revokeObjectURL(candidate.url);
    throw cause;
  }
}
