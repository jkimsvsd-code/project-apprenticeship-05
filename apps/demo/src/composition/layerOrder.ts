import { parseDocument, type StudioDocument } from '@jjal/document-model';

export const LAYER_DRAG_MIME = 'application/x-jjal-layer';
export type LayerInsertion = { panelId: string; targetId: string | null; edge: 'before' | 'after' };

function layerMove(doc: StudioDocument, id: string, insertion: LayerInsertion) {
  const owner = doc.panels.find((panel) => panel.elementIds.includes(id));
  const element = doc.elements.find((item) => item.id === id);
  if (!owner || !element || element.locked)
    throw new Error('잠긴 레이어의 순서는 변경할 수 없습니다.');
  if (owner.id !== insertion.panelId)
    throw new Error('같은 컷 안에서 레이어 순서를 변경해 주세요.');
  const group = owner.elementIds.filter(
    (item) =>
      item === id ||
      (element.groupId &&
        doc.elements.find((candidate) => candidate.id === item)?.groupId === element.groupId),
  );
  if (group.some((item) => doc.elements.find((candidate) => candidate.id === item)?.locked))
    throw new Error('잠긴 레이어가 포함된 그룹의 순서는 변경할 수 없습니다.');
  if (insertion.targetId && !owner.elementIds.includes(insertion.targetId))
    throw new Error('레이어 위치를 확인해 주세요.');
  return { owner, group };
}

/** The visual insertion cue and the actual move share the same permission checks. */
export function canInsertLayer(doc: StudioDocument, id: string, insertion: LayerInsertion) {
  try {
    const { group } = layerMove(doc, id, insertion);
    return !insertion.targetId || !group.includes(insertion.targetId);
  } catch {
    return false;
  }
}

/** Display order is front to back; persisted order is back to front. */
export function insertLayer(doc: StudioDocument, id: string, insertion: LayerInsertion) {
  const { owner, group } = layerMove(doc, id, insertion);
  if (insertion.targetId && group.includes(insertion.targetId)) return doc;
  const next = structuredClone(doc);
  const panel = next.panels.find((item) => item.id === owner.id)!;
  const originalDisplay = [...panel.elementIds].reverse();
  const display = originalDisplay.filter((item) => !group.includes(item));
  const moving = originalDisplay.filter((item) => group.includes(item));
  let index = insertion.targetId === null ? display.length : display.indexOf(insertion.targetId);
  if (index < 0) throw new Error('레이어 위치를 확인해 주세요.');
  if (insertion.targetId !== null && insertion.edge === 'after') index++;
  display.splice(index, 0, ...moving);
  panel.elementIds = display.reverse();
  next.updatedAt = new Date().toISOString();
  return parseDocument(next);
}

export function layerInsertionAt(clientX: number, clientY: number): LayerInsertion | undefined {
  const rail = document.querySelector<HTMLElement>('.layer-rail');
  if (!rail) return;
  const rect = rail.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
    return;
  const buttons = [...rail.querySelectorAll<HTMLElement>('[data-layer-id]')];
  const closest = buttons.reduce<HTMLElement | undefined>((found, item) => {
    if (!found) return item;
    const distance = (node: HTMLElement) => {
      const box = node.getBoundingClientRect();
      return Math.abs(clientX - box.left - box.width / 2);
    };
    return distance(item) < distance(found) ? item : found;
  }, undefined);
  if (!closest)
    return rail.dataset.emptyPanel
      ? { panelId: rail.dataset.emptyPanel, targetId: null, edge: 'after' }
      : undefined;
  const box = closest.getBoundingClientRect();
  return {
    panelId: closest.dataset.panelId!,
    targetId: closest.dataset.layerId!,
    edge: clientX < box.left + box.width / 2 ? 'before' : 'after',
  };
}
