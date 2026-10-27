import { parseDocument, type StudioDocument } from '@jjal/document-model';
import { LIMITS } from '@jjal/policies';
import { ensurePanelFrameLayers } from './panelFrames';

/** One-time migration: marker presence preserves intentional deletion and ungrouping. */
export function ensurePanelBackgroundLayers(doc: StudioDocument): StudioDocument {
  if (doc.layeredPanelBackgrounds === true) return doc;
  const next = structuredClone(ensurePanelFrameLayers(doc));
  const ids = new Set(next.elements.map((element) => element.id));
  for (const panel of next.panels) {
    let background = panel.elementIds
      .map((id) => next.elements.find((element) => element.id === id)!)
      .find((element) => element.kind === 'panel-background');
    if (!background) {
      if (panel.elementIds.length >= LIMITS.elementsPerPanel + 2 || next.elements.length >= 408)
        throw new Error('컷 배경을 추가할 예약 공간이 없습니다. 기존 작품은 그대로 유지됩니다.');
      const base = `background-${panel.id}`.slice(0, 72);
      let id = base;
      let suffix = 1;
      while (ids.has(id)) id = `${base}-${suffix++}`;
      ids.add(id);
      background = {
        id,
        kind: 'panel-background',
        background: structuredClone(panel.background),
        locked: false,
        hidden: false,
      };
      next.elements.push(background);
      panel.elementIds.unshift(id);
      for (const layout of next.layouts) {
        const placed = layout.panels.find((item) => item.panelId === panel.id)!;
        const crop = placed.background;
        placed.elements.unshift({
          elementId: id,
          transform: { x: 0, y: 0, width: 1, height: 1, rotation: 0, flipX: false, opacity: 1 },
          ...(crop ? { background: structuredClone(crop) } : {}),
        });
      }
    }
    const frame = panel.elementIds
      .map((id) => next.elements.find((element) => element.id === id)!)
      .find((element) => element.kind === 'frame');
    if (frame) {
      const groupId = `group-${crypto.randomUUID()}`;
      frame.groupId = groupId;
      background.groupId = groupId;
    }
    const prefix = [background.id, ...(frame ? [frame.id] : [])];
    panel.elementIds = [...prefix, ...panel.elementIds.filter((id) => !prefix.includes(id))];
    for (const layout of next.layouts) {
      const placed = layout.panels.find((item) => item.panelId === panel.id)!;
      delete placed.background;
      placed.elements.sort(
        (left, right) =>
          panel.elementIds.indexOf(left.elementId) - panel.elementIds.indexOf(right.elementId),
      );
    }
    // The element owns old/current/original/result references; no duplicate legacy owner remains.
    panel.background = { color: '#f7f5ef', imageAssetId: null, fit: 'cover' };
  }
  next.layeredPanelBackgrounds = true;
  return parseDocument(next);
}
