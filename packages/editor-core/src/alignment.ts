import type { ElementTransform, StudioDocument } from '@jjal/document-model';
import { canvasSize, type AspectRatio } from '@jjal/policies';

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export interface AlignmentGuide {
  axis: 'x' | 'y';
  position: number;
  source: 'panel' | 'element';
}

export function alignmentPlacement(doc: StudioDocument, id: string, ratio: AspectRatio) {
  const element = doc.elements.find((item) => item.id === id);
  if (!element) throw new Error('편집할 요소가 없습니다.');
  if (element.locked) throw new Error('잠긴 요소는 편집할 수 없습니다.');
  const panel = doc.layouts
    .find((layout) => layout.ratio === ratio)
    ?.panels.find((item) => item.elements.some((placed) => placed.elementId === id));
  if (!panel) throw new Error('현재 비율의 요소 배치가 없습니다.');
  const transform = panel.elements.find((item) => item.elementId === id)!.transform;
  const size = canvasSize(ratio);
  return {
    panel,
    transform,
    width: panel.rect.width * size.width,
    height: panel.rect.height * size.height,
  };
}

/** Rotation is calculated in pixels, then returned in panel-normalized coordinates. */
export function elementBounds(t: ElementTransform, panelWidth: number, panelHeight: number) {
  const angle = (t.rotation * Math.PI) / 180;
  const halfX =
    (Math.abs(Math.cos(angle)) * t.width +
      (Math.abs(Math.sin(angle)) * t.height * panelHeight) / panelWidth) /
    2;
  const halfY =
    ((Math.abs(Math.sin(angle)) * t.width * panelWidth) / panelHeight +
      Math.abs(Math.cos(angle)) * t.height) /
    2;
  const cx = t.x + t.width / 2,
    cy = t.y + t.height / 2;
  return { left: cx - halfX, right: cx + halfX, top: cy - halfY, bottom: cy + halfY, cx, cy };
}

/** Nearest edge/center wins; stable ties prefer the panel, then its layer order. */
export function snapElementPosition(
  doc: StudioDocument,
  id: string,
  ratio: AspectRatio,
  position: { x: number; y: number },
  threshold: { x: number; y: number },
) {
  if (
    ![position.x, position.y, threshold.x, threshold.y].every(Number.isFinite) ||
    threshold.x < 0 ||
    threshold.y < 0
  )
    throw new Error('정렬 좌표와 허용 거리를 확인해 주세요.');
  const { panel, transform, width, height } = alignmentPlacement(doc, id, ratio);
  const moving = elementBounds({ ...transform, ...position }, width, height);
  const targets = [
    {
      bounds: { left: 0, cx: 0.5, right: 1, top: 0, cy: 0.5, bottom: 1 },
      source: 'panel' as const,
    },
    ...panel.elements
      .filter((placed) => {
        const element = doc.elements.find((item) => item.id === placed.elementId)!;
        if (placed.elementId === id || element.hidden || placed.transform.opacity === 0)
          return false;
        const bounds = elementBounds(placed.transform, width, height);
        return bounds.right > 0 && bounds.left < 1 && bounds.bottom > 0 && bounds.top < 1;
      })
      .map((placed) => ({
        bounds: elementBounds(placed.transform, width, height),
        source: 'element' as const,
      })),
  ];
  const guides: AlignmentGuide[] = [];
  const result = { ...position };
  for (const axis of ['x', 'y'] as const) {
    const keys =
      axis === 'x' ? (['left', 'cx', 'right'] as const) : (['top', 'cy', 'bottom'] as const);
    let best: { delta: number; position: number; source: 'panel' | 'element' } | undefined;
    for (const target of targets)
      for (const targetKey of keys) {
        const value = target.bounds[targetKey];
        if (value < 0 || value > 1) continue;
        for (const key of keys) {
          const delta = value - moving[key];
          const next = position[axis] + delta;
          if (next < -2 || next > 3 || Math.abs(delta) > threshold[axis] + 1e-10) continue;
          if (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-10)
            best = { delta, position: value, source: target.source };
        }
      }
    if (best) {
      result[axis] += best.delta;
      guides.push({ axis, position: best.position, source: best.source });
    }
  }
  return { position: result, guides };
}
