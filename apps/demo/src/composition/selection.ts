import type { StudioDocument } from '@jjal/document-model';
import { expandElementGroups } from '@jjal/editor-core';

export interface EditorSelection {
  panelId: string;
  ids: readonly string[];
  /** A tool can edit one member without dissolving its saved group. */
  scope?: 'element';
}

/** A selection stays in its cut and includes every peer of each selected group. */
export function normalizeSelection(
  doc: StudioDocument,
  requested: EditorSelection,
): EditorSelection {
  const owner = doc.panels.find((panel) => panel.id === requested.panelId) ?? doc.panels[0]!;
  const owned = new Set(owner.elementIds);
  const ids = requested.ids.filter((id) => owned.has(id));
  if (requested.scope === 'element')
    return { panelId: owner.id, ids: ids.slice(0, 1), scope: 'element' };
  return { panelId: owner.id, ids: expandElementGroups(doc, ids).filter((id) => owned.has(id)) };
}

/** Prefer a selected compatible member, then the topmost editable member in this cut. */
export function selectionForTool(
  doc: StudioDocument,
  requested: EditorSelection,
  tool: 'text' | 'style',
): EditorSelection {
  const owner = doc.panels.find((panel) => panel.id === requested.panelId) ?? doc.panels[0]!;
  const compatible = (id: string) => {
    const item = doc.elements.find((element) => element.id === id);
    return (
      owner.elementIds.includes(id) &&
      item &&
      !item.locked &&
      !item.hidden &&
      // Every kind has an editable contour; the text tab needs actual text content.
      (tool === 'style' || item.kind === 'text' || item.kind === 'bubble')
    );
  };
  const id = requested.ids.find(compatible) ?? [...owner.elementIds].reverse().find(compatible);
  return { panelId: owner.id, ids: id ? [id] : [], scope: 'element' };
}
