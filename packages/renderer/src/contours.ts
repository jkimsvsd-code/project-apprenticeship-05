import type { Contour, StudioElement } from '@jjal/document-model';

/** Missing optional values retain the original schema-v1 outline semantics. */
export function effectiveContour(element: StudioElement): Contour {
  if (element.contour) return element.contour;
  if (element.kind === 'bubble')
    return { texture: 'pen', color: element.border, width: element.borderWidth };
  if (element.kind === 'text')
    return {
      texture: 'pen',
      color: element.style.outline?.color ?? '#0B0F2B',
      width: element.style.outline?.width ?? 0,
    };
  return { texture: 'pen', color: '#0B0F2B', width: element.kind === 'frame' ? 2 : 0 };
}

/** Stable local grain; no random values or frame-time state enter exported artwork. */
export function contourInkAlpha(texture: Contour['texture'], x: number, y: number): number {
  if (texture === 'pen') return 255;
  const noise = (Math.imul((x | 0) + 17, 374761393) ^ Math.imul((y | 0) + 31, 668265263)) >>> 0;
  const grain = ((noise ^ (noise >>> 13)) >>> 0) % 256;
  if (texture === 'pencil') return grain < 42 ? 0 : 90 + (grain % 140);
  const ridge = (((y + Math.floor(x / 7)) % 5) + 5) % 5;
  return ridge === 0 ? 145 + (grain % 55) : 210 + (grain % 46);
}

function extremeAxis(
  input: Uint8Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
  maximum: boolean,
) {
  const result = new Uint8Array(input.length);
  const length = horizontal ? width : height,
    lines = horizontal ? height : width;
  const deque = new Int32Array(length + 2 * radius + 1);
  for (let line = 0; line < lines; line++) {
    let head = 0,
      tail = 0;
    const value = (coordinate: number) =>
      coordinate < 0 || coordinate >= length
        ? 0
        : input[horizontal ? line * width + coordinate : coordinate * width + line]!;
    for (let index = -radius; index < length + radius; index++) {
      while (head < tail && deque[head]! < index - 2 * radius) head++;
      while (
        head < tail &&
        (maximum
          ? value(deque[tail - 1]!) <= value(index)
          : value(deque[tail - 1]!) >= value(index))
      )
        tail--;
      deque[tail++] = index;
      const coordinate = index - radius;
      if (coordinate >= 0 && coordinate < length)
        result[horizontal ? line * width + coordinate : coordinate * width + line] = value(
          deque[head]!,
        );
    }
  }
  return result;
}

/** Alpha silhouette boundary: transparent holes count as boundaries, RGB never does. */
export function alphaContourBand(
  alpha: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    alpha.length !== width * height ||
    !Number.isInteger(radius) ||
    radius < 1 ||
    radius > 64
  )
    throw new Error('외곽선 이미지의 크기를 확인해 주세요.');
  const silhouette = Uint8Array.from(alpha, (value) => (value >= 16 ? 255 : 0));
  const dilated = extremeAxis(
    extremeAxis(silhouette, width, height, radius, true, true),
    width,
    height,
    radius,
    false,
    true,
  );
  const eroded = extremeAxis(
    extremeAxis(silhouette, width, height, radius, true, false),
    width,
    height,
    radius,
    false,
    false,
  );
  return Uint8Array.from(dilated, (value, index) => value - eroded[index]!);
}

const tiles = new WeakMap<Document, Map<string, HTMLCanvasElement>>();
export function contourPaint(
  ctx: CanvasRenderingContext2D,
  owner: Document,
  contour: Contour,
): string | CanvasPattern {
  if (contour.texture === 'pen') return contour.color;
  const key = `${contour.texture}:${contour.color}`;
  let cache = tiles.get(owner);
  if (!cache) {
    cache = new Map();
    tiles.set(owner, cache);
  }
  let tile = cache.get(key);
  if (!tile) {
    tile = owner.createElement('canvas');
    tile.width = tile.height = 32;
    const context = tile.getContext('2d');
    if (!context) throw new Error('외곽선 질감을 만들 수 없습니다.');
    const pixels = context.createImageData(32, 32);
    const rgb = [1, 3, 5].map((offset) =>
      Number.parseInt(contour.color.slice(offset, offset + 2), 16),
    );
    for (let index = 0; index < 32 * 32; index++) {
      pixels.data[index * 4] = rgb[0]!;
      pixels.data[index * 4 + 1] = rgb[1]!;
      pixels.data[index * 4 + 2] = rgb[2]!;
      pixels.data[index * 4 + 3] = contourInkAlpha(
        contour.texture,
        index % 32,
        Math.floor(index / 32),
      );
    }
    context.putImageData(pixels, 0, 0);
    cache.set(key, tile);
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) throw new Error('외곽선 질감을 적용할 수 없습니다.');
  return pattern;
}

interface RasterContour {
  canvas: HTMLCanvasElement;
  pad: number;
  scale: number;
}
const rasterCache = new WeakMap<HTMLCanvasElement, Map<string, RasterContour>>();

/** Contours are generated from a fitted, clipped alpha mask, then overlaid on the photo. */
export function paintImageContour(
  ctx: CanvasRenderingContext2D,
  owner: Document,
  image: HTMLCanvasElement,
  fitted: { x: number; y: number; width: number; height: number },
  width: number,
  height: number,
  contour: Contour,
) {
  if (contour.width <= 0) return;
  const key = `${image.width}:${image.height}:${width}:${height}:${JSON.stringify(fitted)}:${JSON.stringify(contour)}`;
  let cache = rasterCache.get(image);
  if (!cache) {
    cache = new Map();
    rasterCache.set(image, cache);
  }
  let raster = cache.get(key);
  if (!raster) {
    const scale = Math.min(
      1,
      2048 / Math.max(width, height),
      Math.sqrt(4_000_000 / (width * height)),
    );
    const radius = Math.max(1, Math.ceil((contour.width * scale) / 2)),
      pad = radius + 1;
    const layer = owner.createElement('canvas');
    layer.width = Math.max(1, Math.ceil(width * scale)) + pad * 2;
    layer.height = Math.max(1, Math.ceil(height * scale)) + pad * 2;
    const context = layer.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('이미지 외곽선을 만들 수 없습니다.');
    context.save();
    context.translate(pad, pad);
    context.scale(scale, scale);
    context.beginPath();
    context.rect(0, 0, width, height);
    context.clip();
    context.drawImage(image, fitted.x, fitted.y, fitted.width, fitted.height);
    context.restore();
    const pixels = context.getImageData(0, 0, layer.width, layer.height);
    const alpha = new Uint8Array(layer.width * layer.height);
    for (let index = 0; index < alpha.length; index++) alpha[index] = pixels.data[index * 4 + 3]!;
    const band = alphaContourBand(alpha, layer.width, layer.height, radius);
    const rgb = [1, 3, 5].map((offset) =>
      Number.parseInt(contour.color.slice(offset, offset + 2), 16),
    );
    const coverage = Math.min(1, (contour.width * scale) / (2 * radius));
    for (let index = 0; index < band.length; index++) {
      pixels.data[index * 4] = rgb[0]!;
      pixels.data[index * 4 + 1] = rgb[1]!;
      pixels.data[index * 4 + 2] = rgb[2]!;
      pixels.data[index * 4 + 3] = Math.round(
        (band[index]! *
          coverage *
          contourInkAlpha(
            contour.texture,
            ((index % layer.width) - pad) / scale,
            (Math.floor(index / layer.width) - pad) / scale,
          )) /
          255,
      );
    }
    context.putImageData(pixels, 0, 0);
    raster = { canvas: layer, pad, scale };
    cache.set(key, raster);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
  }
  ctx.drawImage(
    raster.canvas,
    -raster.pad / raster.scale,
    -raster.pad / raster.scale,
    raster.canvas.width / raster.scale,
    raster.canvas.height / raster.scale,
  );
}
