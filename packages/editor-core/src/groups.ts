import { parseDocument, type StudioDocument } from '@jjal/document-model';

/** Preserve the clicked primary ID; append its group peers without crossing cuts. */
export function expandElementGroups(doc: StudioDocument, ids: readonly string[]): string[] {
  const result = [...new Set(ids)];
  const byId = new Map(doc.elements.map((element) => [element.id, element]));
  for (const id of result) if (!byId.has(id)) throw new Error('선택한 요소가 없습니다.');
  const groups = new Set(result.flatMap((id) => byId.get(id)!.groupId ?? []));
  for (const panel of doc.panels) {
    if (!panel.elementIds.some((id) => result.includes(id))) continue;
    for (const id of panel.elementIds)
      if (byId.get(id)!.groupId && groups.has(byId.get(id)!.groupId!) && !result.includes(id))
        result.push(id);
  }
  return result;
}

function editableSelection(doc: StudioDocument, ids: readonly string[]) {
  const expanded = expandElementGroups(doc, ids);
  if (!expanded.length) throw new Error('묶을 요소를 선택해 주세요.');
  const owner = doc.panels.find((panel) => panel.elementIds.includes(expanded[0]!));
  if (!owner || !expanded.every((id) => owner.elementIds.includes(id)))
    throw new Error('같은 컷의 요소만 함께 묶을 수 있습니다.');
  if (doc.elements.some((element) => expanded.includes(element.id) && element.locked))
    throw new Error('잠긴 요소가 포함되어 있습니다. 먼저 잠금을 해제해 주세요.');
  return expanded;
}

export function groupElements(doc: StudioDocument, ids: readonly string[]): StudioDocument {
  const selected = editableSelection(doc, ids);
  if (selected.length < 2) throw new Error('그룹은 요소를 두 개 이상 선택해 주세요.');
  const groupId = `group-${crypto.randomUUID()}`;
  const next = structuredClone(doc);
  for (const element of next.elements) if (selected.includes(element.id)) element.groupId = groupId;
  next.updatedAt = new Date().toISOString();
  return parseDocument(next);
}

export function ungroupElements(doc: StudioDocument, ids: readonly string[]): StudioDocument {
  const selected = editableSelection(doc, ids);
  if (!doc.elements.some((element) => selected.includes(element.id) && element.groupId)) return doc;
  const next = structuredClone(doc);
  for (const element of next.elements) if (selected.includes(element.id)) delete element.groupId;
  next.updatedAt = new Date().toISOString();
  return parseDocument(next);
}
