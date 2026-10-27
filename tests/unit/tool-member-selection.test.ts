import { describe, expect, it } from 'vitest';
import {
  addElement,
  changeCaption,
  createEditorDocument,
  groupElements,
  setElementFlags,
} from '@jjal/editor-core';
import { normalizeSelection, selectionForTool } from '../../apps/demo/src/composition/selection';

describe('분류 전환의 단일 멤버 선택', () => {
  it('문구·도형의 단일 멤버 편집은 저장된 그룹과 다른 요소를 유지한다', () => {
    const initial = createEditorDocument(),
      panelId = initial.panels[0]!.id;
    const first = initial.elements[0]!.id;
    const shape = addElement(initial, panelId, { kind: 'shape', shape: 'ellipse' });
    const doc = groupElements(shape.document, [first, shape.elementId]);
    const before = structuredClone(doc);
    const grouped = normalizeSelection(doc, { panelId, ids: [shape.elementId] });
    expect(grouped.ids).toHaveLength(2);
    const text = selectionForTool(doc, grouped, 'text');
    expect(text).toEqual({ panelId, ids: [first], scope: 'element' });
    expect(normalizeSelection(doc, text)).toEqual(text);
    const edited = changeCaption(doc, { text: '한 멤버만 편집' }, doc.activeRatio, text.ids[0]);
    expect(normalizeSelection(edited, text)).toEqual(text);
    expect(edited.elements.find((item) => item.id === shape.elementId)).toEqual(
      before.elements.find((item) => item.id === shape.elementId),
    );
    expect(edited.elements.map((item) => item.groupId)).toEqual(
      before.elements.map((item) => item.groupId),
    );
    expect(selectionForTool(doc, text, 'style').ids).toEqual([first]);
    expect(selectionForTool(doc, { panelId, ids: [shape.elementId, first] }, 'style').ids).toEqual([
      shape.elementId,
    ]);
    expect(doc).toEqual(before);
  });
  it('잠금·숨김과 다른 컷을 건너뛰고 호환 대상이 없으면 선택을 비운다', () => {
    const initial = createEditorDocument(),
      panelId = initial.panels[0]!.id;
    const added = addElement(initial, panelId, { kind: 'bubble', shape: 'thought' });
    const doc = setElementFlags(added.document, [added.elementId], { locked: true });
    const selection = { panelId, ids: [added.elementId] };
    expect(selectionForTool(doc, selection, 'text').ids).toEqual([initial.elements[0]!.id]);
    expect(selectionForTool(doc, selection, 'style').ids).toEqual([initial.elements[0]!.id]);
    const hidden = setElementFlags(doc, [initial.elements[0]!.id], { hidden: true });
    expect(selectionForTool(hidden, selection, 'text').ids).toEqual([]);
    expect(selectionForTool(hidden, selection, 'style').ids).toEqual([]);
    expect(normalizeSelection(doc, { panelId, ids: ['missing'], scope: 'element' }).ids).toEqual(
      [],
    );
  });
});
