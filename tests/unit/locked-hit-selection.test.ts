import { describe, expect, it } from 'vitest';
import {
  addElement,
  createEditorDocument,
  deleteElement,
  hitTestElement,
  setElementFlags,
  transformElement,
} from '@jjal/editor-core';
import { ensurePanelFrameLayers } from '../../apps/demo/src/composition/panelFrames';

describe('선택 전용 잠긴 레이어 hit test', () => {
  it('기본 동작은 잠긴 레이어를 건너뛰고 선택 옵션은 같은 위치의 최상단 잠긴 레이어를 반환한다', () => {
    const initial = createEditorDocument(),
      lower = initial.elements[0]!.id;
    const added = addElement(initial, initial.panels[0]!.id, { kind: 'text' });
    let doc = added.document;
    for (const id of [lower, added.elementId])
      doc = transformElement(doc, id, '1:1', {
        x: 0.2,
        y: 0.2,
        width: 0.4,
        height: 0.4,
        rotation: 37,
        flipX: true,
        flipY: true,
      });
    doc = setElementFlags(doc, [added.elementId], { locked: true });
    const before = structuredClone(doc);
    expect(hitTestElement(doc, 0.4, 0.4)?.elementId).toBe(lower);
    expect(hitTestElement(doc, 0.4, 0.4, { includeLocked: false })?.elementId).toBe(lower);
    expect(hitTestElement(doc, 0.4, 0.4, { includeLocked: true })?.elementId).toBe(added.elementId);
    expect(() => transformElement(doc, added.elementId, '1:1', { x: 0.3 })).toThrow('잠긴');
    expect(() => deleteElement(doc, added.elementId)).toThrow('잠긴');
    expect(doc).toEqual(before);
  });

  it('잠긴 요소를 포함해 선택하더라도 숨김과 불투명도 0인 요소는 선택하지 않는다', () => {
    const initial = createEditorDocument(),
      lower = initial.elements[0]!.id;
    const added = addElement(initial, initial.panels[0]!.id, { kind: 'text' });
    let doc = transformElement(added.document, added.elementId, '1:1', {
      x: 0.1,
      y: 0.35,
      width: 0.8,
      height: 0.65,
    });
    doc = setElementFlags(doc, [added.elementId], { locked: true, hidden: true });
    expect(hitTestElement(doc, 0.5, 0.5, { includeLocked: true })?.elementId).toBe(lower);
    doc = setElementFlags(doc, [added.elementId], { locked: false, hidden: false });
    doc = transformElement(doc, added.elementId, '1:1', { opacity: 0 });
    doc = setElementFlags(doc, [added.elementId], { locked: true });
    expect(hitTestElement(doc, 0.5, 0.5, { includeLocked: true })?.elementId).toBe(lower);
    doc = setElementFlags(doc, [lower], { hidden: true });
    expect(hitTestElement(doc, 0.5, 0.5, { includeLocked: true })).toBeNull();
  });

  it('잠긴 컷 테두리도 선택할 수 있지만 빈 가운데를 가로채지 않는다', () => {
    const initial = ensurePanelFrameLayers(createEditorDocument()),
      textId = initial.elements.find((element) => element.kind === 'text')!.id;
    const frameId = initial.elements.find((element) => element.kind === 'frame')!.id;
    const doc = setElementFlags(deleteElement(initial, textId), [frameId], { locked: true });
    expect(hitTestElement(doc, 0.001, 0.5)).toBeNull();
    expect(hitTestElement(doc, 0.001, 0.5, { includeLocked: true })?.elementId).toBe(frameId);
    expect(hitTestElement(doc, 0.5, 0.5, { includeLocked: true })).toBeNull();
  });
});
