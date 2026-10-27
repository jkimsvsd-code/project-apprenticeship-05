import type {
  Background,
  BackgroundPlacement,
  StudioDocument,
  StudioElement,
  TextStyle,
  Contour,
} from '@jjal/document-model';
import { fontDefinition } from '@jjal/document-model';
import { traceThoughtCloud } from './bubbleGeometry';
export { THOUGHT_CLOUD_SVG_PATH } from './bubbleGeometry';
export { ensureBuiltinFonts, ensureFont, ensureDocumentFonts, isFontReady } from './fonts';
import { canvasSize, type AspectRatio } from '@jjal/policies';
import { contourPaint, effectiveContour, paintImageContour } from './contours';
export { effectiveContour, alphaContourBand, contourInkAlpha } from './contours';

export function wrapText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let current = '';
    for (const { segment } of segmenter.segment(paragraph)) {
      if (current && measure(current + segment) > maxWidth) {
        lines.push(current);
        current = '';
      }
      current += segment;
    }
    lines.push(current);
    return lines;
  });
}

export function fittedRect(
  sw: number,
  sh: number,
  width: number,
  height: number,
  fit: 'cover' | 'contain',
) {
  const scale =
    fit === 'cover' ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh);
  return {
    x: (width - sw * scale) / 2,
    y: (height - sh * scale) / 2,
    width: sw * scale,
    height: sh * scale,
  };
}

export function backgroundImageRect(
  sw: number,
  sh: number,
  width: number,
  height: number,
  fit: 'cover' | 'contain',
  placement?: BackgroundPlacement,
) {
  const base = fittedRect(sw, sh, width, height, fit);
  const { x, y, zoom } = placement ?? { x: 0, y: 0, zoom: 1 };
  const w = base.width * zoom,
    h = base.height * zoom;
  return { x: (width - w) / 2 + x * width, y: (height - h) / 2 + y * height, width: w, height: h };
}

function paintBackground(
  ctx: CanvasRenderingContext2D,
  background: Background,
  x: number,
  y: number,
  width: number,
  height: number,
  placement: BackgroundPlacement | undefined,
  images: RenderOptions['images'],
) {
  if (!background.transparent) {
    ctx.fillStyle = background.color;
    ctx.fillRect(x, y, width, height);
  }
  if (!background.imageAssetId) return;
  const image = images?.get(background.imageAssetId);
  if (!image) throw new Error('이미지 데이터를 찾을 수 없습니다. 기존 화면은 유지됩니다.');
  const rect = backgroundImageRect(
    image.width,
    image.height,
    width,
    height,
    background.fit,
    placement,
  );
  ctx.drawImage(image, x + rect.x, y + rect.y, rect.width, rect.height);
}

export interface RenderOptions {
  ratio?: AspectRatio;
  longEdge?: 1080 | 2048;
  images?: ReadonlyMap<string, HTMLCanvasElement>;
  transparent?: boolean;
  panelId?: string;
}

/** Clear only the global underlay, before any panel content is painted. */
function clearTransparentPanelUnderlays(
  ctx: CanvasRenderingContext2D,
  document: StudioDocument,
  panels: StudioDocument['layouts'][number]['panels'],
  logical: { width: number; height: number },
) {
  for (const placed of panels) {
    const panel = document.panels.find((item) => item.id === placed.panelId);
    if (!panel) throw new Error('컷 배치 참조 오류');
    const px = placed.rect.x * logical.width;
    const py = placed.rect.y * logical.height;
    const pw = placed.rect.width * logical.width;
    const ph = placed.rect.height * logical.height;
    if (!document.layeredPanelBackgrounds) {
      if (!panel.background.inherit && panel.background.transparent) ctx.clearRect(px, py, pw, ph);
      continue;
    }
    for (const id of panel.elementIds) {
      const element = document.elements.find((item) => item.id === id);
      if (
        element?.kind !== 'panel-background' ||
        element.hidden ||
        element.background.inherit ||
        !element.background.transparent
      )
        continue;
      const transform = placed.elements.find((item) => item.elementId === id)?.transform;
      if (!transform) throw new Error('요소 배치 참조 오류');
      if (transform.opacity === 0) continue;
      const width = transform.width * pw;
      const height = transform.height * ph;
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, pw, ph);
      ctx.clip();
      ctx.translate(px + transform.x * pw + width / 2, py + transform.y * ph + height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
      ctx.translate(-width / 2, -height / 2);
      ctx.clearRect(0, 0, width, height);
      ctx.restore();
    }
  }
}

type TextElement = Extract<StudioElement, { kind: 'text' | 'bubble' }>;
type BubbleElement = Extract<StudioElement, { kind: 'bubble' }>;
function customBodyRect(element: BubbleElement, width: number, height: number) {
  const side = element.tail ? (element.tail.side ?? 'bottom') : 'none';
  return {
    x: side === 'left' ? width * 0.18 : 0,
    y: side === 'top' ? height * 0.18 : 0,
    width: side === 'left' || side === 'right' ? width * 0.82 : width,
    height: side === 'top' || side === 'bottom' ? height * 0.82 : height,
  };
}
function glyphContour(element: TextElement): Contour {
  return element.kind === 'text'
    ? effectiveContour(element)
    : {
        texture: 'pen',
        color: element.style.outline?.color ?? '#0B0F2B',
        width: element.style.outline?.width ?? 0,
      };
}

/** Regular-only original faces never request synthetic bold; missing glyphs use local Sans. */
export function canvasFont(style: TextStyle): string {
  if (style.font.kind !== 'builtin')
    throw new Error('업로드 글꼴 렌더링은 아직 지원하지 않습니다. 기본 글꼴을 선택해주세요.');
  const definition = fontDefinition(style.font.family);
  const weight = definition.boldAvailable && style.bold ? 700 : 400;
  const family = definition.boldAvailable
    ? `"${style.font.family}"`
    : `"${style.font.family}", "Noto Sans KR"`;
  return `${weight} ${style.fontSize}px ${family}`;
}

/** The same interior box is used for line wrapping, paint and overflow diagnostics. */
export function textContentRect(element: TextElement, width: number, height: number) {
  const pad = Math.ceil(glyphContour(element).width / 2);
  const shrink = (box: { x: number; y: number; width: number; height: number }) => ({
    x: box.x + pad,
    y: box.y + pad,
    width: Math.max(1, box.width - pad * 2),
    height: Math.max(1, box.height - pad * 2),
  });
  if (element.kind === 'text') {
    const inset = element.boxPaddingRatio ?? 0;
    return shrink({
      x: width * inset,
      y: height * inset,
      width: width * (1 - 2 * inset),
      height: height * (1 - 2 * inset),
    });
  }
  if (element.customShape) {
    const body = customBodyRect(element, width, height);
    const region = element.customShape.textRect;
    const padding = element.textPadding ?? { top: 12, right: 12, bottom: 12, left: 12 };
    const border = effectiveContour(element).width;
    const inset = border > 0 ? border + 0.5 : 0;
    return shrink({
      x: body.x + region.x * body.width + inset + padding.left,
      y: body.y + region.y * body.height + inset + padding.top,
      width: Math.max(1, region.width * body.width - inset * 2 - padding.left - padding.right),
      height: Math.max(1, region.height * body.height - inset * 2 - padding.top - padding.bottom),
    });
  }
  if (element.textPadding) {
    const side = element.shape === 'caption' ? 'none' : (element.tail?.side ?? 'bottom');
    const body = {
      x: side === 'left' ? width * 0.18 : 0,
      y: side === 'top' ? height * 0.18 : 0,
      width: side === 'left' || side === 'right' ? width * 0.82 : width,
      height: side === 'top' || side === 'bottom' ? height * 0.82 : height,
    };
    const padding = element.textPadding;
    // The shape path is inset by stroke/2 + .5, so its inner stroke edge is
    // stroke + .5 from the body's outer box. User padding starts at that edge.
    const stroke = effectiveContour(element).width;
    const borderInset = stroke > 0 ? stroke + 0.5 : 0;
    return shrink({
      x: body.x + borderInset + padding.left,
      y: body.y + borderInset + padding.top,
      width: Math.max(1, body.width - borderInset * 2 - padding.left - padding.right),
      height: Math.max(1, body.height - borderInset * 2 - padding.top - padding.bottom),
    });
  }
  const side = element.tail?.side ?? 'bottom';
  if (element.shape !== 'caption' && side !== 'bottom') {
    const vertical = side === 'top';
    const body = {
      x: side === 'left' ? width * 0.18 : 0,
      y: vertical ? height * 0.18 : 0,
      width: vertical ? width : width * 0.82,
      height: vertical ? height * 0.82 : height,
    };
    const insetX = Math.min(36, body.width * (element.shape === 'shout' ? 0.2 : 0.12));
    const insetY = Math.min(26, body.height * 0.16);
    return shrink({
      x: body.x + insetX,
      y: body.y + insetY,
      width: Math.max(1, body.width - insetX * 2),
      height: Math.max(1, body.height - insetY * 2),
    });
  }
  const bodyHeight = element.shape === 'caption' ? height : height * 0.82;
  const insetX = Math.min(36, width * (element.shape === 'shout' ? 0.2 : 0.12));
  const insetY = Math.min(26, bodyHeight * 0.16);
  return shrink({
    x: insetX,
    y: insetY,
    width: Math.max(1, width - insetX * 2),
    height: Math.max(1, bodyHeight - insetY * 2),
  });
}

/** Top-baseline ink can extend above y=0, notably in Jua; protect its actual outline. */
export function textDrawingOffset(
  context: Pick<CanvasRenderingContext2D, 'measureText'>,
  lines: readonly string[],
): number {
  return Math.ceil(
    lines.reduce(
      (maximum, line) => Math.max(maximum, context.measureText(line).actualBoundingBoxAscent),
      0,
    ),
  );
}

/** First-line baseline offset shared by painted and direct-edit text. Absent alignment is legacy top. */
export function textBlockVerticalOffset(
  context: Pick<CanvasRenderingContext2D, 'measureText'>,
  element: TextElement,
  lines: readonly string[],
  contentHeight: number,
): number {
  if (element.kind !== 'bubble' || !element.verticalAlign || element.verticalAlign === 'top')
    return textDrawingOffset(context, lines);
  if (!lines.length) return 0;
  const pitch = element.style.fontSize * element.style.lineHeight;
  const metrics = lines.map((line, index) => {
    const measured = context.measureText(line);
    const ascent = Number.isFinite(measured.actualBoundingBoxAscent)
      ? measured.actualBoundingBoxAscent
      : 0;
    const descent =
      line && Number.isFinite(measured.actualBoundingBoxDescent)
        ? measured.actualBoundingBoxDescent
        : element.style.fontSize;
    return { top: index * pitch - ascent, bottom: index * pitch + descent };
  });
  const top = Math.min(...metrics.map((line) => line.top));
  const bottom = Math.max(...metrics.map((line) => line.bottom));
  const remaining = contentHeight - (bottom - top);
  return (element.verticalAlign === 'center' ? remaining / 2 : remaining) - top;
}

function remapCorners(
  corners: NonNullable<Extract<StudioElement, { kind: 'bubble' }>['corners']>,
  side: 'top' | 'left' | 'right',
) {
  const { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl } = corners;
  const values =
    side === 'top' ? [br, bl, tl, tr] : side === 'left' ? [tr, br, bl, tl] : [bl, tl, tr, br];
  return {
    topLeft: values[0]!,
    topRight: values[1]!,
    bottomRight: values[2]!,
    bottomLeft: values[3]!,
  };
}

function paintBubble(
  ctx: CanvasRenderingContext2D,
  element: Extract<StudioElement, { kind: 'bubble' }>,
  width: number,
  height: number,
  owner: Document,
) {
  if (element.customShape) {
    paintCustomBubble(ctx, element, width, height, owner);
    return;
  }
  const side = element.shape === 'caption' ? 'bottom' : (element.tail?.side ?? 'bottom');
  if (side !== 'bottom' && element.tail) {
    ctx.save();
    const tip = element.tail;
    let mapped: { x: number; y: number; side: 'bottom' };
    if (side === 'top') {
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      mapped = { x: 1 - tip.x, y: 1 - tip.y, side: 'bottom' };
    } else if (side === 'left') {
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
      mapped = { x: tip.y, y: 1 - tip.x, side: 'bottom' };
    } else {
      ctx.translate(0, height);
      ctx.rotate(-Math.PI / 2);
      mapped = { x: 1 - tip.y, y: tip.x, side: 'bottom' };
    }
    paintBubble(
      ctx,
      {
        ...element,
        tail: mapped,
        ...(element.corners ? { corners: remapCorners(element.corners, side) } : {}),
      },
      side === 'top' ? width : height,
      side === 'top' ? height : width,
      owner,
    );
    ctx.restore();
    return;
  }
  const contour = effectiveContour(element);
  const stroke = contour.width;
  const inset = stroke / 2 + 0.5;
  const bodyHeight = element.shape === 'caption' ? height : height * 0.82;
  const right = width - inset;
  const bottom = bodyHeight - inset;
  const centerX = width / 2;
  const centerY = bodyHeight / 2;
  const tail = element.tail ?? { x: 0.3, y: 1 };
  const tailX = Math.max(inset, Math.min(right, tail.x * width));
  const tailY = Math.max(inset, Math.min(height - inset, tail.y * height));
  ctx.fillStyle = element.fill;
  ctx.strokeStyle = contourPaint(ctx, owner, contour);
  ctx.lineWidth = stroke;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (element.shape === 'thought') {
    traceThoughtCloud(
      ctx,
      inset,
      inset,
      Math.max(1, width - inset * 2),
      Math.max(1, bodyHeight - inset * 2),
    );
  } else if (element.shape === 'shout') {
    for (let i = 0; i < 28; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 28;
      const radius = i % 2 === 0 ? 1 : 1 - (0.4 * (element.spikeSharpness ?? 40)) / 100;
      const x = centerX + Math.cos(angle) * (centerX - inset) * radius;
      const y = centerY + Math.sin(angle) * (centerY - inset) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else {
    ctx.roundRect(
      inset,
      inset,
      Math.max(1, width - inset * 2),
      Math.max(1, bodyHeight - inset * 2),
      element.corners
        ? [
            element.corners.topLeft,
            element.corners.topRight,
            element.corners.bottomRight,
            element.corners.bottomLeft,
          ].map(
            (percent) =>
              (Math.min(Math.max(1, width - inset * 2), Math.max(1, bodyHeight - inset * 2)) *
                percent) /
              100,
          )
        : Math.min(24, height * 0.1, width * 0.1),
    );
  }
  ctx.fill();
  if (stroke > 0) ctx.stroke();
  if ((element.shape === 'speech' || element.shape === 'shout') && element.tail) {
    const baseX = Math.max(inset + width * 0.1, Math.min(right - width * 0.1, tailX));
    const baseHalf = Math.min(width * 0.06, 20);
    ctx.beginPath();
    ctx.moveTo(baseX - baseHalf, bottom - stroke);
    ctx.lineTo(tailX, tailY);
    ctx.lineTo(baseX + baseHalf, bottom - stroke);
    ctx.fill();
    if (stroke > 0) ctx.stroke();
    // Repaint the tail's open connection to keep a continuous filled balloon.
    ctx.beginPath();
    ctx.moveTo(baseX - baseHalf + stroke / 2, bottom - stroke);
    ctx.lineTo(baseX + baseHalf - stroke / 2, bottom - stroke);
    ctx.lineWidth = stroke + 2;
    ctx.strokeStyle = element.fill;
    ctx.stroke();
  } else if (element.shape === 'thought' && element.tail) {
    for (const [fraction, radius] of [
      [0.45, 0.055],
      [0.8, 0.035],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(
        centerX + (tailX - centerX) * fraction,
        bodyHeight * 0.84 + (tailY - bodyHeight * 0.84) * fraction,
        Math.min(width, height) * radius,
        Math.min(width, height) * radius,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      if (stroke > 0) ctx.stroke();
    }
  }
}

/** The source silhouette stays upright when its independent tail changes direction. */
function paintCustomBubble(
  ctx: CanvasRenderingContext2D,
  element: BubbleElement,
  width: number,
  height: number,
  owner: Document,
) {
  const contour = effectiveContour(element);
  const stroke = contour.width;
  const inset = stroke / 2 + 0.5;
  const body = customBodyRect(element, width, height);
  const points = element.customShape!.bodyOutline.map((point) => ({
    x: body.x + inset + point.x * Math.max(1, body.width - inset * 2),
    y: body.y + inset + point.y * Math.max(1, body.height - inset * 2),
  }));
  ctx.fillStyle = element.fill;
  ctx.strokeStyle = contourPaint(ctx, owner, contour);
  ctx.lineWidth = stroke;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) =>
    index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y),
  );
  ctx.closePath();
  ctx.fill();
  if (stroke > 0) ctx.stroke();
  if (!element.tail) return;
  const side = element.tail.side ?? 'bottom';
  const vertical = side === 'top' || side === 'bottom';
  const tip = { x: element.tail.x * width, y: element.tail.y * height };
  const projection = points.map((point) => (vertical ? point.x : point.y));
  const minimum = Math.min(...projection),
    maximum = Math.max(...projection);
  const epsilon = Math.min(0.01, (maximum - minimum) / 100);
  const half = Math.min((maximum - minimum) * 0.06, 20);
  const anchor = Math.max(
    minimum + half + epsilon,
    Math.min(maximum - half - epsilon, vertical ? tip.x : tip.y),
  );
  // Intersect the actual polygon, so a tail joins a cloud/ellipse instead of its empty bounds.
  const edgeAt = (coordinate: number) => {
    const values: number[] = [];
    for (let index = 0; index < points.length; index++) {
      const a = points[index]!,
        b = points[(index + 1) % points.length]!;
      const av = vertical ? a.x : a.y,
        bv = vertical ? b.x : b.y;
      if (av === bv || coordinate < Math.min(av, bv) || coordinate > Math.max(av, bv)) continue;
      const fraction = (coordinate - av) / (bv - av);
      values.push(
        (vertical ? a.y : a.x) + fraction * ((vertical ? b.y : b.x) - (vertical ? a.y : a.x)),
      );
    }
    if (!values.length) return null;
    const edge = side === 'bottom' || side === 'right' ? Math.max(...values) : Math.min(...values);
    return vertical ? { x: coordinate, y: edge } : { x: edge, y: coordinate };
  };
  const first = edgeAt(anchor - half),
    last = edgeAt(anchor + half);
  if (!first || !last) return;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(last.x, last.y);
  ctx.fill();
  if (stroke > 0) ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(last.x, last.y);
  ctx.strokeStyle = element.fill;
  ctx.lineWidth = stroke + 2;
  ctx.stroke();
}

function paintShape(
  ctx: CanvasRenderingContext2D,
  element: Extract<StudioElement, { kind: 'shape' }>,
  width: number,
  height: number,
  owner: Document,
) {
  const contour = effectiveContour(element),
    inset = contour.width / 2 + 0.5;
  const right = Math.max(inset, width - inset),
    bottom = Math.max(inset, height - inset);
  ctx.fillStyle = element.fill;
  ctx.strokeStyle = contourPaint(ctx, owner, contour);
  ctx.lineWidth = contour.width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (element.shape === 'ellipse')
    ctx.ellipse(
      width / 2,
      height / 2,
      Math.max(0.5, width / 2 - inset),
      Math.max(0.5, height / 2 - inset),
      0,
      0,
      Math.PI * 2,
    );
  else if (element.shape === 'rect')
    ctx.rect(inset, inset, Math.max(1, width - inset * 2), Math.max(1, height - inset * 2));
  else {
    ctx.moveTo(width / 2, inset);
    if (element.shape === 'triangle') {
      ctx.lineTo(right, bottom);
      ctx.lineTo(inset, bottom);
    } else {
      ctx.lineTo(right, height / 2);
      ctx.lineTo(width / 2, bottom);
      ctx.lineTo(inset, height / 2);
    }
    ctx.closePath();
  }
  ctx.fill();
  if (contour.width > 0) ctx.stroke();
}

/** The picker paints the inserted shape's logical geometry before replacing its bitmap. */
export function renderShapePreview(
  canvas: HTMLCanvasElement,
  element: Extract<StudioElement, { kind: 'shape' }>,
  width: number,
  height: number,
) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('도형 미리보기의 크기를 확인해 주세요.');
  const frame = canvas.ownerDocument.createElement('canvas');
  frame.width = Math.max(1, Math.round(width));
  frame.height = Math.max(1, Math.round(height));
  const context = frame.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 브라우저에서 캔버스를 사용할 수 없습니다.');
  context.scale(frame.width / width, frame.height / height);
  paintShape(context, element, width, height, canvas.ownerDocument);
  const target = canvas.getContext('2d', { willReadFrequently: true });
  if (!target) throw new Error('이 브라우저에서 캔버스를 사용할 수 없습니다.');
  canvas.width = frame.width;
  canvas.height = frame.height;
  target.drawImage(frame, 0, 0);
}

function paintText(
  ctx: CanvasRenderingContext2D,
  element: TextElement,
  width: number,
  height: number,
  owner: Document,
) {
  const box = textContentRect(element, width, height);
  const style = element.style;
  const contour = glyphContour(element);
  const pad = Math.ceil(contour.width / 2);
  ctx.save();
  ctx.beginPath();
  if (element.kind === 'text' && element.boxPaddingRatio !== undefined)
    ctx.rect(0, 0, width, height);
  else ctx.rect(box.x - pad, box.y - pad, box.width + pad * 2, box.height + pad * 2);
  ctx.clip();
  ctx.font = canvasFont(style);
  ctx.fillStyle = style.color;
  ctx.textAlign = style.align;
  ctx.textBaseline = 'top';
  const x =
    box.x + (style.align === 'center' ? box.width / 2 : style.align === 'right' ? box.width : 0);
  const lines = wrapText(element.text, box.width, (value) => ctx.measureText(value).width);
  const drawingOffset = textBlockVerticalOffset(ctx, element, lines, box.height);
  lines.forEach((line, index) => {
    const y = box.y + drawingOffset + index * style.fontSize * style.lineHeight;
    if (contour.width > 0) {
      ctx.strokeStyle = contourPaint(ctx, owner, contour);
      ctx.lineWidth = contour.width;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, x, y);
    }
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

/** Import confirmation paints the same body, independent tail and text as the editor. */
export function renderBubblePreview(
  canvas: HTMLCanvasElement,
  element: BubbleElement,
  width = 540,
  height = 300,
) {
  const frame = canvas.ownerDocument.createElement('canvas');
  frame.width = width;
  frame.height = height;
  const context = frame.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 브라우저에서 캔버스를 사용할 수 없습니다.');
  paintBubble(context, element, width, height, canvas.ownerDocument);
  paintText(context, element, width, height, canvas.ownerDocument);
  const target = canvas.getContext('2d', { willReadFrequently: true });
  if (!target) throw new Error('이 브라우저에서 캔버스를 사용할 수 없습니다.');
  canvas.width = width;
  canvas.height = height;
  target.drawImage(frame, 0, 0);
}

/** 완성된 프레임만 교체하므로 렌더링 실패가 기존 화면을 지우지 않는다. */
export function renderDocument(
  canvas: HTMLCanvasElement,
  doc: StudioDocument,
  options: RenderOptions = {},
) {
  const frame = canvas.ownerDocument.createElement('canvas');
  paintDocument(frame, doc, options);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 브라우저에서 캔버스를 사용할 수 없습니다.');
  canvas.width = frame.width;
  canvas.height = frame.height;
  context.drawImage(frame, 0, 0);
}

/** Every visible document element is painted with common panel/element clipping. */
function paintDocument(
  canvas: HTMLCanvasElement,
  document: StudioDocument,
  options: RenderOptions,
) {
  const ratio = options.ratio ?? document.activeRatio;
  const layout = document.layouts.find((l) => l.ratio === ratio);
  if (!layout) throw new Error('선택한 비율 배치가 없습니다.');
  const edge = options.longEdge ?? 1080;
  if (edge !== 1080 && edge !== 2048) throw new Error('지원하지 않는 출력 크기입니다.');
  const logical = canvasSize(ratio, 1080);
  const selected = options.panelId
    ? layout.panels.find((item) => item.panelId === options.panelId)
    : undefined;
  if (options.panelId !== undefined && !selected) throw new Error('출력할 컷을 찾을 수 없습니다.');
  const bounds = selected
    ? {
        x: selected.rect.x * logical.width,
        y: selected.rect.y * logical.height,
        width: selected.rect.width * logical.width,
        height: selected.rect.height * logical.height,
      }
    : { x: 0, y: 0, ...logical };
  const scale = edge / Math.max(bounds.width, bounds.height);
  const size = selected
    ? { width: Math.round(bounds.width * scale), height: Math.round(bounds.height * scale) }
    : canvasSize(ratio, edge);
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('이 브라우저에서 캔버스를 사용할 수 없습니다.');
  if (!options.transparent && !document.background?.transparent) {
    ctx.fillStyle = '#f7f5ef';
    ctx.fillRect(0, 0, size.width, size.height);
  }
  ctx.save();
  ctx.scale(size.width / bounds.width, size.height / bounds.height);
  ctx.translate(-bounds.x, -bounds.y);
  if (!options.transparent && document.background)
    paintBackground(
      ctx,
      document.background,
      0,
      0,
      logical.width,
      logical.height,
      layout.background,
      options.images,
    );
  if (!options.transparent)
    clearTransparentPanelUnderlays(ctx, document, selected ? [selected] : layout.panels, logical);
  for (const placed of selected ? [selected] : layout.panels) {
    const panel = document.panels.find((p) => p.id === placed.panelId);
    if (!panel) throw new Error('컷 배치 참조 오류');
    const px = placed.rect.x * logical.width,
      py = placed.rect.y * logical.height;
    const pw = placed.rect.width * logical.width,
      ph = placed.rect.height * logical.height;
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    if (!document.layeredPanelBackgrounds && !options.transparent && !panel.background.inherit)
      paintBackground(ctx, panel.background, px, py, pw, ph, placed.background, options.images);
    for (const id of panel.elementIds) {
      const element = document.elements.find((e) => e.id === id);
      const placement = placed.elements.find((e) => e.elementId === id);
      if (!element || !placement) throw new Error('요소 배치 참조 오류');
      if (element.hidden) continue;
      const transform = placement.transform;
      const width = transform.width * pw,
        height = transform.height * ph;
      ctx.save();
      ctx.translate(px + transform.x * pw + width / 2, py + transform.y * ph + height / 2);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.scale(transform.flipX ? -1 : 1, transform.flipY ? -1 : 1);
      ctx.translate(-width / 2, -height / 2);
      ctx.globalAlpha = transform.opacity;
      ctx.beginPath();
      const contour = effectiveContour(element);
      const imageContourPad =
        element.kind === 'image' || element.kind === 'character'
          ? contour.width / 2 + (contour.width > 0 ? 2 : 0)
          : 0;
      ctx.rect(
        -imageContourPad,
        -imageContourPad,
        width + imageContourPad * 2,
        height + imageContourPad * 2,
      );
      ctx.clip();
      if (element.kind === 'panel-background') {
        if (!element.background.inherit) {
          paintBackground(
            ctx,
            element.background,
            0,
            0,
            width,
            height,
            placement.background,
            options.images,
          );
        }
        if (contour.width > 0) {
          const inset = contour.width / 2;
          ctx.strokeStyle = contourPaint(ctx, canvas.ownerDocument, contour);
          ctx.lineWidth = contour.width;
          ctx.lineJoin = 'round';
          ctx.strokeRect(
            inset,
            inset,
            Math.max(0, width - contour.width),
            Math.max(0, height - contour.width),
          );
        }
      } else if (element.kind === 'image' || element.kind === 'character') {
        const image = options.images?.get(element.assetId);
        if (!image) throw new Error('이미지 데이터를 찾을 수 없습니다. 기존 화면은 유지됩니다.');
        const fit = element.kind === 'image' ? element.fit : 'contain';
        const fitted = fittedRect(image.width, image.height, width, height, fit);
        if (contour.width > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, width, height);
          ctx.clip();
        }
        ctx.drawImage(image, fitted.x, fitted.y, fitted.width, fitted.height);
        if (contour.width > 0) {
          ctx.restore();
          paintImageContour(ctx, canvas.ownerDocument, image, fitted, width, height, contour);
        }
      } else if (element.kind === 'shape') {
        paintShape(ctx, element, width, height, canvas.ownerDocument);
      } else if (element.kind === 'frame') {
        if (contour.width > 0) {
          const inset = contour.width / 2;
          ctx.strokeStyle = contourPaint(ctx, canvas.ownerDocument, contour);
          ctx.lineWidth = contour.width;
          ctx.lineJoin = 'round';
          ctx.strokeRect(
            inset,
            inset,
            Math.max(0, width - contour.width),
            Math.max(0, height - contour.width),
          );
        }
      } else {
        if (element.kind === 'bubble')
          paintBubble(ctx, element, width, height, canvas.ownerDocument);
        paintText(ctx, element, width, height, canvas.ownerDocument);
      }
      ctx.restore();
    }
    // Fixed multi-panel frames remain part of transparent artwork.
    if (document.panels.length > 1 && !document.frameLayers) {
      ctx.strokeStyle = '#243b35';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    }
    ctx.restore();
  }
  ctx.restore();
}
