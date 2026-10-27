import { parseDocument, type StudioDocument } from '@jjal/document-model';
import { ASPECT_RATIOS, LIMITS } from '@jjal/policies';

/** One-time, immutable migration. The marker deliberately survives frame deletion. */
export function ensurePanelFrameLayers(doc: StudioDocument): StudioDocument {
  if (doc.frameLayers === true) return doc;
  const next = structuredClone(doc);
  const fallback = next.layouts.find((layout) => layout.ratio === next.activeRatio)!;
  for (const ratio of ASPECT_RATIOS)
    if (!next.layouts.some((layout) => layout.ratio === ratio))
      next.layouts.push({ ...structuredClone(fallback), ratio });
  const ids = new Set(next.elements.map((element) => element.id));
  for (const panel of next.panels) {
    if (
      panel.elementIds.some(
        (id) => next.elements.find((element) => element.id === id)?.kind === 'frame',
      )
    )
      continue;
    if (panel.elementIds.length >= LIMITS.elementsPerPanel + 2 || next.elements.length >= 408)
      throw new Error('컷 테두리를 추가할 요소 공간이 없습니다. 기존 작품은 그대로 유지됩니다.');
    const base = `frame-${panel.id}`.slice(0, 74);
    let id = base,
      suffix = 1;
    while (ids.has(id)) id = `${base}-${suffix++}`;
    ids.add(id);
    next.elements.push({
      id,
      kind: 'frame',
      locked: false,
      hidden: false,
      contour: { texture: 'pen', color: '#0B0F2B', width: 2 },
    });
    panel.elementIds.unshift(id);
    for (const layout of next.layouts)
      layout.panels
        .find((placed) => placed.panelId === panel.id)!
        .elements.unshift({
          elementId: id,
          transform: { x: 0, y: 0, width: 1, height: 1, rotation: 0, flipX: false, opacity: 1 },
        });
  }
  next.frameLayers = true;
  return parseDocument(next);
}
