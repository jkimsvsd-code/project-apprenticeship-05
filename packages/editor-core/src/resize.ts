import {
  parseDocument,
  TextStyleSchema,
  TransformSchema,
  type ElementTransform,
  type StudioDocument,
} from '@jjal/document-model';
import type { AspectRatio } from '@jjal/policies';

export type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
export type ResizeEdge = 'n' | 'e' | 's' | 'w';

export interface ResizeCornerInput {
  readonly transform: Readonly<ElementTransform>;
  readonly corner: ResizeCorner;
  /** Absolute pointer movement from pointer-down, in the panel's pixel coordinate space. */
  readonly dx: number;
  readonly dy: number;
  readonly panelWidth: number;
  readonly panelHeight: number;
  /** Minimum box dimensions in the same units as panelWidth/panelHeight, not normalized. */
  readonly minWidth: number;
  readonly minHeight: number;
}

export interface ResizeEdgeInput extends Omit<ResizeCornerInput, 'corner'> {
  readonly edge: ResizeEdge;
}

/** Resize one local axis, preserving the other dimension and the opposite rotated edge. */
export function resizeElementFromEdge(input: ResizeEdgeInput): ElementTransform {
  const { edge, dx, dy, panelWidth, panelHeight, minWidth, minHeight } = input;
  if (
    !['n', 'e', 's', 'w'].includes(edge) ||
    ![dx, dy, panelWidth, panelHeight, minWidth, minHeight].every(Number.isFinite) ||
    [panelWidth, panelHeight, minWidth, minHeight].some((value) => value <= 0) ||
    !Number.isFinite(panelWidth * 4) ||
    !Number.isFinite(panelHeight * 4) ||
    minWidth > panelWidth * 4 ||
    minHeight > panelHeight * 4
  )
    throw new Error('크기 조절 방향과 컷·최소 크기를 확인해 주세요.');
  const original = TransformSchema.parse(input.transform);
  const horizontal = edge === 'e' ? 1 : edge === 'w' ? -1 : 0;
  const vertical = edge === 's' ? 1 : edge === 'n' ? -1 : 0;
  const angle = (original.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const localX = cosine * dx + sine * dy;
  const localY = -sine * dx + cosine * dy;
  if (![localX, localY].every(Number.isFinite))
    throw new Error('크기 조절 이동 거리를 확인해 주세요.');
  const beforeWidth = original.width * panelWidth;
  const beforeHeight = original.height * panelHeight;
  const width = horizontal
    ? Math.max(minWidth, Math.min(panelWidth * 4, beforeWidth + horizontal * localX))
    : beforeWidth;
  const height = vertical
    ? Math.max(minHeight, Math.min(panelHeight * 4, beforeHeight + vertical * localY))
    : beforeHeight;
  if (width === beforeWidth && height === beforeHeight) return original;
  const halfWidthChange = (horizontal * (width - beforeWidth)) / 2;
  const halfHeightChange = (vertical * (height - beforeHeight)) / 2;
  const candidate = TransformSchema.safeParse({
    ...original,
    x:
      original.x +
      (cosine * halfWidthChange - sine * halfHeightChange - (width - beforeWidth) / 2) / panelWidth,
    y:
      original.y +
      (sine * halfWidthChange + cosine * halfHeightChange - (height - beforeHeight) / 2) /
        panelHeight,
    width: horizontal ? width / panelWidth : original.width,
    height: vertical ? height / panelHeight : original.height,
  });
  if (!candidate.success)
    throw new Error('위치 −200~300%, 크기 0 초과~400% 범위 안에서 조절해 주세요.');
  return candidate.data;
}

/** Bubble and shape edge resizing changes geometry only, never shared content or other ratios. */
export function resizeDocumentElementFromEdge(
  doc: StudioDocument,
  id: string,
  ratio: AspectRatio,
  input: ResizeEdgeInput,
): StudioDocument {
  const element = doc.elements.find((item) => item.id === id);
  if (!element) throw new Error('편집할 요소가 없습니다.');
  if (element.locked || element.hidden) throw new Error('잠기거나 숨긴 요소는 편집할 수 없습니다.');
  if (element.kind !== 'bubble' && element.kind !== 'shape')
    throw new Error('말풍선과 도형의 가로·세로 크기만 따로 조절할 수 있습니다.');
  const placement = doc.layouts
    .find((layout) => layout.ratio === ratio)
    ?.panels.flatMap((panel) => panel.elements)
    .find((item) => item.elementId === id);
  if (!placement) throw new Error('현재 비율의 요소 배치가 없습니다.');
  const transform = resizeElementFromEdge(input);
  const draft = structuredClone(doc);
  draft.layouts
    .find((layout) => layout.ratio === ratio)!
    .panels.flatMap((panel) => panel.elements)
    .find((item) => item.elementId === id)!.transform = transform;
  draft.updatedAt = new Date().toISOString();
  return parseDocument(draft);
}

/**
 * Resize from the pointer-down snapshot, keeping the opposite rotated corner fixed.
 * Reflection changes the rendered content, so it does not change handle directions.
 * A schema-invalid placement is rejected rather than moving the fixed corner.
 */
export function resizeElementFromCorner(input: ResizeCornerInput): ElementTransform {
  return resizeFromCorner(input);
}

function resizeFromCorner(
  input: ResizeCornerInput,
  uniform?: { min: number; max: number },
): ElementTransform {
  const { corner, dx, dy, panelWidth, panelHeight, minWidth, minHeight } = input;
  if (
    !['nw', 'ne', 'sw', 'se'].includes(corner) ||
    ![dx, dy, panelWidth, panelHeight, minWidth, minHeight].every(Number.isFinite) ||
    [panelWidth, panelHeight, minWidth, minHeight].some((value) => value <= 0) ||
    !Number.isFinite(panelWidth * 4) ||
    !Number.isFinite(panelHeight * 4) ||
    minWidth > panelWidth * 4 ||
    minHeight > panelHeight * 4
  )
    throw new Error('크기 조절 방향과 컷·최소 크기를 확인해 주세요.');

  const original = TransformSchema.parse(input.transform);
  const horizontal = corner.endsWith('e') ? 1 : -1;
  const vertical = corner.startsWith('s') ? 1 : -1;
  const angle = (original.rotation * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  // Inverse-rotate actual pixel deltas before normalizing. Normalized dx/dy cannot
  // be rotated directly when a panel is not square.
  const localX = cosine * dx + sine * dy;
  const localY = -sine * dx + cosine * dy;
  if (![localX, localY].every(Number.isFinite))
    throw new Error('크기 조절 이동 거리를 확인해 주세요.');
  const beforeWidth = original.width * panelWidth;
  const beforeHeight = original.height * panelHeight;
  let width: number;
  let height: number;
  if (uniform) {
    const minimum = Math.max(minWidth / beforeWidth, minHeight / beforeHeight, uniform.min);
    const maximum = Math.min(4 / original.width, 4 / original.height, uniform.max);
    const diagonal = Math.hypot(beforeWidth, beforeHeight);
    if (![minimum, maximum, diagonal].every(Number.isFinite) || minimum > maximum || minimum <= 0)
      throw new Error('글자 크기와 요소 최소 크기 범위 안에서 조절해 주세요.');
    // Project the pointer onto the original corner diagonal. This preserves the
    // text box aspect ratio even when only one pointer axis moves.
    const requested =
      1 +
      ((horizontal * beforeWidth * (localX / diagonal)) / diagonal +
        (vertical * beforeHeight * (localY / diagonal)) / diagonal);
    const scale = Math.max(minimum, Math.min(maximum, requested));
    width = beforeWidth * scale;
    height = beforeHeight * scale;
  } else {
    width = Math.max(minWidth, Math.min(panelWidth * 4, beforeWidth + horizontal * localX));
    height = Math.max(minHeight, Math.min(panelHeight * 4, beforeHeight + vertical * localY));
  }
  if (width === beforeWidth && height === beforeHeight) return original;
  const halfWidthChange = (horizontal * (width - beforeWidth)) / 2;
  const halfHeightChange = (vertical * (height - beforeHeight)) / 2;
  const centerX =
    (original.x + original.width / 2) * panelWidth +
    cosine * halfWidthChange -
    sine * halfHeightChange;
  const centerY =
    (original.y + original.height / 2) * panelHeight +
    sine * halfWidthChange +
    cosine * halfHeightChange;
  const candidate = TransformSchema.safeParse({
    ...original,
    x: (centerX - width / 2) / panelWidth,
    y: (centerY - height / 2) / panelHeight,
    width: width / panelWidth,
    height: height / panelHeight,
  });
  if (!candidate.success)
    throw new Error('위치 −200~300%, 크기 0 초과~400% 범위 안에서 조절해 주세요.');
  return candidate.data;
}

export interface ResizeDocumentCornerInput extends ResizeCornerInput {
  /** Text size captured with transform at pointer-down, never the previous move's size. */
  readonly fontSize?: number;
}

/** Geometry and shared text style are validated together before a candidate is exposed. */
export function resizeDocumentElementFromCorner(
  doc: StudioDocument,
  id: string,
  ratio: AspectRatio,
  input: ResizeDocumentCornerInput,
): StudioDocument {
  const element = doc.elements.find((item) => item.id === id);
  if (!element) throw new Error('편집할 요소가 없습니다.');
  if (element.locked || element.hidden) throw new Error('잠기거나 숨긴 요소는 편집할 수 없습니다.');
  const placement = doc.layouts
    .find((layout) => layout.ratio === ratio)
    ?.panels.flatMap((panel) => panel.elements)
    .find((item) => item.elementId === id);
  if (!placement) throw new Error('현재 비율의 요소 배치가 없습니다.');
  const hasText = element.kind === 'text' || element.kind === 'bubble';
  const font = TextStyleSchema.shape.fontSize;
  const startFontSize = hasText ? font.parse(input.fontSize ?? element.style.fontSize) : undefined;
  const transform = resizeFromCorner(
    input,
    startFontSize === undefined
      ? undefined
      : { min: font.minValue! / startFontSize, max: font.maxValue! / startFontSize },
  );
  const draft = structuredClone(doc);
  draft.layouts
    .find((layout) => layout.ratio === ratio)!
    .panels.flatMap((panel) => panel.elements)
    .find((item) => item.elementId === id)!.transform = transform;
  const target = draft.elements.find((item) => item.id === id)!;
  if (startFontSize !== undefined && (target.kind === 'text' || target.kind === 'bubble')) {
    const scale = transform.width / input.transform.width;
    target.style.fontSize = font.parse(
      Math.max(font.minValue!, Math.min(font.maxValue!, startFontSize * scale)),
    );
  }
  draft.updatedAt = new Date().toISOString();
  return parseDocument(draft);
}
