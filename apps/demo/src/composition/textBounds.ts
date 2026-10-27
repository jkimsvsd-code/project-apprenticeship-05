import { parseDocument, type StudioDocument, type StudioElement } from '@jjal/document-model';
import { LIMITS, canvasSize } from '@jjal/policies';
import { canvasFont, textContentRect, textDrawingOffset, wrapText } from '@jjal/renderer';

type TextElement = Extract<StudioElement, { kind: 'text' }>;
type MeasuringContext = Pick<
  CanvasRenderingContext2D,
  'font' | 'textBaseline' | 'textAlign' | 'measureText'
>;
type Placement = StudioDocument['layouts'][number]['panels'][number]['elements'][number];
interface Frame {
  placement: Placement;
  panelWidth: number;
  panelHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
}
interface FittedBox {
  frame: Frame;
  width: number;
  height: number;
  halfX: number;
  halfY: number;
}
const INSET = 1 / 6;
const EPSILON = 1e-7;
const cannotFit = () =>
  new Error(
    '문구 전체를 컷 안에 표시할 수 없습니다. 최소 글자 크기 8에서도 맞지 않아 기존 작업을 유지합니다. 문구나 줄바꿈을 줄여 주세요.',
  );

function contour(element: TextElement) {
  return element.contour;
}

function strokePadding(element: TextElement) {
  return Math.ceil((contour(element)?.width ?? element.style.outline?.width ?? 0) / 2);
}

function measurer(element: TextElement, context: MeasuringContext) {
  context.font = canvasFont(element.style);
  context.textBaseline = 'top';
  context.textAlign = 'left';
  const cache = new Map<string, TextMetrics>();
  return (value: string) => {
    const previous = cache.get(value);
    if (previous) return previous;
    const metric = context.measureText(value);
    if (
      ![
        metric.width,
        metric.actualBoundingBoxLeft,
        metric.actualBoundingBoxRight,
        metric.actualBoundingBoxAscent,
        metric.actualBoundingBoxDescent,
      ].every(Number.isFinite)
    )
      throw new Error('문구의 크기를 측정하지 못했습니다. 기존 작업은 유지됩니다.');
    cache.set(value, metric);
    return metric;
  };
}

function blockFor(
  element: TextElement,
  lines: readonly string[],
  measure: (value: string) => TextMetrics,
) {
  const metrics = lines.map(measure);
  const offset = textDrawingOffset({ measureText: measure }, lines);
  const width = Math.max(
    1,
    ...metrics.map((line) =>
      Math.max(line.width, line.actualBoundingBoxLeft + line.actualBoundingBoxRight),
    ),
  );
  const pitch = element.style.fontSize * element.style.lineHeight;
  const height = Math.max(
    1,
    ...metrics.map(
      (line, index) =>
        offset +
        index * pitch +
        (lines[index] ? line.actualBoundingBoxDescent : element.style.fontSize),
    ),
  );
  if (![width, height].every(Number.isFinite))
    throw new Error('문구의 크기를 측정하지 못했습니다. 기존 작업은 유지됩니다.');
  return { width, height };
}

/** Match the renderer's font, top baseline, grapheme wrapping and actual ink metrics. */
export function measureTextBlock(
  element: TextElement,
  context: MeasuringContext,
  maxWidth?: number,
) {
  const measure = measurer(element, context);
  const lines =
    maxWidth === undefined
      ? element.text.split('\n')
      : wrapText(element.text, maxWidth, (value) => measure(value).width);
  return blockFor(element, lines, measure);
}

function framesFor(doc: StudioDocument, id: string): Frame[] {
  return doc.layouts.flatMap((layout) => {
    const size = canvasSize(layout.ratio, 1080);
    return layout.panels.flatMap((panel) => {
      const placement = panel.elements.find((item) => item.elementId === id);
      if (!placement) return [];
      const panelWidth = panel.rect.width * size.width;
      const panelHeight = panel.rect.height * size.height;
      // Use the same panel and canvas pixel boundary as the renderer's clipping.
      const left = Math.max(0, -panel.rect.x * size.width);
      const top = Math.max(0, -panel.rect.y * size.height);
      const right = Math.min(panelWidth, size.width - panel.rect.x * size.width);
      const bottom = Math.min(panelHeight, size.height - panel.rect.y * size.height);
      return [
        {
          placement,
          panelWidth,
          panelHeight,
          left,
          top,
          width: right - left,
          height: bottom - top,
        },
      ];
    });
  });
}

function fitFrame(
  element: TextElement,
  frame: Frame,
  measure: (value: string) => TextMetrics,
): FittedBox | undefined {
  if (frame.width <= 0 || frame.height <= 0) return;
  const angle = (frame.placement.transform.rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(angle));
  const sin = Math.abs(Math.sin(angle));
  const pad = strokePadding(element);
  const outward = (value: number) => value + Math.max(1, value) * Number.EPSILON * 32;
  const outer = (block: { width: number; height: number }) => ({
    // Normalized storage and textContentRect divide/multiply these values again.
    // Round outward by a few ulps so an exact line does not gain another wrap.
    width: outward((block.width + pad * 2) * 1.5),
    height: outward((block.height + pad * 2) * 1.5),
  });
  const inspect = (width: number, height: number): FittedBox | undefined => {
    const halfX = (cos * width + sin * height) / 2;
    const halfY = (sin * width + cos * height) / 2;
    if (
      width > frame.panelWidth * 4 + EPSILON ||
      height > frame.panelHeight * 4 + EPSILON ||
      halfX * 2 > frame.width + EPSILON ||
      halfY * 2 > frame.height + EPSILON
    )
      return;
    return { frame, width, height, halfX, halfY };
  };
  const natural = outer(blockFor(element, element.text.split('\n'), measure));
  const unchangedWrap = inspect(natural.width, natural.height);
  if (unchangedWrap) return unchangedWrap;

  let widthLimit = Math.min(
    frame.panelWidth * 4,
    cos > EPSILON ? frame.width / cos : Infinity,
    sin > EPSILON ? frame.height / sin : Infinity,
  );
  let inkAllowance = 0;
  // The width bound can only shrink as wrapping adds lines. Every reduction either fits,
  // changes a break, or proves even the largest remaining width cannot fit that height.
  for (let step = 0; step <= LIMITS.textCodePoints + 2; step++) {
    if (!Number.isFinite(widthLimit) || widthLimit * (1 - INSET * 2) - pad * 2 < 1) return;
    const interior = textContentRect(element, widthLimit, frame.height);
    if (interior.width - inkAllowance < 1) return;
    const lines = wrapText(
      element.text,
      interior.width - inkAllowance,
      (value) => measure(value).width,
    );
    const block = blockFor(element, lines, measure);
    if (block.width > interior.width + EPSILON) {
      // Canvas advances and actual glyph ink differ (e.g. 55 Noto Sans KR glyphs
      // can advance 404.8px while their ink spans 406.44px). Reserve that ink
      // before wrapping rather than falsely rejecting text that fits one glyph earlier.
      const overhang = Math.max(
        ...lines.map((line) => {
          const metric = measure(line);
          return metric.actualBoundingBoxLeft + metric.actualBoundingBoxRight - metric.width;
        }),
        0,
      );
      inkAllowance = Math.max(inkAllowance + block.width - interior.width, overhang + EPSILON);
      continue;
    }
    const box = outer(block);
    const fitted = inspect(box.width, box.height);
    if (fitted) return fitted;
    if (box.height > frame.panelHeight * 4 + EPSILON) return;
    const nextLimit = Math.min(
      widthLimit,
      cos > EPSILON ? (frame.width - sin * box.height) / cos : Infinity,
      sin > EPSILON ? (frame.height - cos * box.height) / sin : Infinity,
    );
    if (nextLimit >= widthLimit - EPSILON) return;
    widthLimit = nextLimit;
  }
  return;
}

function refitElement(doc: StudioDocument, element: TextElement, context: MeasuringContext) {
  const frames = framesFor(doc, element.id);
  if (!frames.length) throw cannotFit();
  const requestedSize = element.style.fontSize;
  const attempt = (fontSize: number) => {
    const candidate = {
      ...element,
      boxPaddingRatio: INSET,
      style: { ...element.style, fontSize },
    };
    const measure = measurer(candidate, context);
    const boxes: FittedBox[] = [];
    for (const frame of frames) {
      const box = fitFrame(candidate, frame, measure);
      if (!box) return;
      boxes.push(box);
    }
    return boxes;
  };
  let fitted = attempt(requestedSize);
  let finalSize = requestedSize;
  if (!fitted) {
    const minimum = attempt(8);
    if (!minimum) throw cannotFit();
    let lower = 8;
    let upper = requestedSize;
    for (let iteration = 0; iteration < 12; iteration++) {
      const middle = (lower + upper) / 2;
      const boxes = attempt(middle);
      if (boxes) {
        lower = middle;
      } else upper = middle;
    }
    finalSize = Math.floor(lower * 1_000) / 1_000;
    fitted = attempt(finalSize);
    if (!fitted) throw cannotFit();
  }
  element.style.fontSize = finalSize;
  element.boxPaddingRatio = INSET;
  for (const box of fitted) {
    const { frame } = box;
    const previous = frame.placement.transform;
    const centerX = (previous.x + previous.width / 2) * frame.panelWidth;
    const centerY = (previous.y + previous.height / 2) * frame.panelHeight;
    const x = Math.max(
      frame.left + box.halfX,
      Math.min(frame.left + frame.width - box.halfX, centerX),
    );
    const y = Math.max(
      frame.top + box.halfY,
      Math.min(frame.top + frame.height - box.halfY, centerY),
    );
    frame.placement.transform = {
      ...previous,
      x: (x - box.width / 2) / frame.panelWidth,
      y: (y - box.height / 2) / frame.panelHeight,
      width: box.width / frame.panelWidth,
      height: box.height / frame.panelHeight,
    };
  }
}

function changed(element: TextElement, previous: TextElement) {
  return (
    element.text !== previous.text ||
    JSON.stringify(element.style.font) !== JSON.stringify(previous.style.font) ||
    element.style.fontSize !== previous.style.fontSize ||
    element.style.bold !== previous.style.bold ||
    element.style.lineHeight !== previous.style.lineHeight ||
    JSON.stringify(element.style.outline) !== JSON.stringify(previous.style.outline) ||
    JSON.stringify(contour(element)) !== JSON.stringify(contour(previous))
  );
}

function fitSelected(
  doc: StudioDocument,
  previousDoc: StudioDocument | undefined,
  includeChanged: boolean,
  measuringContext?: MeasuringContext,
) {
  const previous = new Map(previousDoc?.elements.map((element) => [element.id, element]));
  const ids = doc.elements
    .filter((element): element is TextElement => {
      if (element.kind !== 'text') return false;
      const before = previous.get(element.id);
      return !before || before.kind !== 'text' || (includeChanged && changed(element, before));
    })
    .map((element) => element.id);
  if (!ids.length) return doc;
  const draft = parseDocument(doc);
  const context = measuringContext ?? document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('이 브라우저에서 문구 크기를 측정할 수 없습니다.');
  for (const id of ids) {
    const element = draft.elements.find((item) => item.id === id);
    if (element?.kind === 'text') refitElement(draft, element, context);
  }
  return parseDocument(draft);
}

/** Initial/new IDs only: loading an existing document does not refit stored placements. */
export function fitNewTextBoxes(
  doc: StudioDocument,
  previousDoc?: StudioDocument,
  measuringContext?: MeasuringContext,
): StudioDocument {
  return fitSelected(doc, previousDoc, false, measuringContext);
}

/** Refit new text and metric-affecting edits; transform-only edits are left untouched. */
export function fitChangedTextBoxes(
  doc: StudioDocument,
  previousDoc: StudioDocument,
  measuringContext?: MeasuringContext,
): StudioDocument {
  return fitSelected(doc, previousDoc, true, measuringContext);
}
