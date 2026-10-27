import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSETS, createBuiltinDocument } from '@jjal/content';
import { ASPECT_RATIOS } from '@jjal/policies';
import {
  addElement,
  changeCaption,
  createEditorDocument,
  deleteElement,
  hitTestElement,
  reorderElement,
  transformElement,
} from '@jjal/editor-core';
import { parseDocument } from '@jjal/document-model';
import { cloneTemplateDocument, validateEditorDocument } from '@jjal/template-kit';

const character = {
  kind: 'character' as const,
  asset: BUILTIN_ASSETS[0]!.asset,
  characterId: 'starter-seed',
};
describe('자유 요소 편집의 데이터 보존', () => {
  it('4컷 중 선택한 컷에만 추가하며 8비율의 참조와 정사각형 캐릭터를 생성한다', () => {
    const before = createBuiltinDocument('builtin-story');
    const original = structuredClone(before);
    const result = addElement(before, before.panels[2]!.id, character);
    expect(before).toEqual(original);
    expect(result.document.panels[0]).toEqual(before.panels[0]);
    expect(result.document.panels[2]!.elementIds.at(-1)).toBe(result.elementId);
    for (const layout of result.document.layouts) {
      const placed = layout.panels[2]!;
      const t = placed.elements.find((item) => item.elementId === result.elementId)!.transform;
      const [w, h] = layout.ratio.split(':').map(Number);
      expect(t.width * placed.rect.width * w!).toBeCloseTo(t.height * placed.rect.height * h!, 1);
      expect(t.x + t.width).toBeLessThanOrEqual(1);
      expect(t.y + t.height).toBeLessThanOrEqual(1);
    }
  });
  it('캐릭터 4개는 허용하고 5번째는 원본과 소재 목록을 보존하며 거부한다', () => {
    let doc = createEditorDocument();
    for (let count = 0; count < 4; count++)
      doc = addElement(doc, doc.panels[0]!.id, character).document;
    const before = structuredClone(doc);
    expect(() => addElement(doc, doc.panels[0]!.id, character)).toThrow('최대 4개');
    expect(doc).toEqual(before);
    expect(doc.assets).toHaveLength(1);
  });
  it('100개 요소 한도에서도 기존 문서가 보존된다', () => {
    let doc = createEditorDocument();
    for (let count = 1; count < 100; count++)
      doc = addElement(doc, doc.panels[0]!.id, { kind: 'text' }).document;
    const before = structuredClone(doc);
    expect(() => addElement(doc, doc.panels[0]!.id, { kind: 'bubble', shape: 'speech' })).toThrow(
      '최대 100개',
    );
    expect(doc).toEqual(before);
  });
  it('모든 말풍선 종류와 텍스트를 독립 ID로 추가한다', () => {
    let doc = createEditorDocument();
    for (const shape of ['speech', 'thought', 'shout', 'caption'] as const) {
      const result = addElement(doc, doc.panels[0]!.id, { kind: 'bubble', shape });
      doc = result.document;
      expect(doc.elements.find((item) => item.id === result.elementId)).toMatchObject({
        shape,
        tail: shape === 'caption' ? null : { x: 0.5, y: 1 },
      });
    }
    expect(new Set(doc.elements.map((element) => element.id)).size).toBe(5);
    expect(parseDocument(doc)).toEqual(doc);
  });
  it.each(ASPECT_RATIOS)('%s만 이동·크기·회전·양방향 반전하고 나머지 비율은 보존한다', (ratio) => {
    const doc = createEditorDocument();
    const after = transformElement(doc, 'line-1', ratio, {
      x: -0.1,
      y: 0.2,
      width: 0.7,
      height: 0.35,
      rotation: 45,
      flipX: true,
      flipY: true,
    });
    expect(after.layouts.filter((layout) => layout.ratio !== ratio)).toEqual(
      doc.layouts.filter((layout) => layout.ratio !== ratio),
    );
    expect(after.elements).toEqual(doc.elements);
    expect(
      after.layouts.find((layout) => layout.ratio === ratio)!.panels[0]!.elements[0]!.transform,
    ).toMatchObject({ x: -0.1, rotation: 45, flipY: true });
    expect(
      cloneTemplateDocument(after).layouts.map(
        (layout) => layout.panels[0]!.elements[0]!.transform,
      ),
    ).toEqual(after.layouts.map((layout) => layout.panels[0]!.elements[0]!.transform));
  });
  it('NaN·무한대·0크기·좌표/회전 초과와 유효/무효 혼합 패치는 모두 원자적으로 거부한다', () => {
    const doc = createEditorDocument(),
      before = structuredClone(doc);
    for (const patch of [
      { x: NaN },
      { height: Infinity },
      { width: 0 },
      { x: 4 },
      { y: -3 },
      { rotation: 361 },
      { x: 0.3, height: -1 },
    ]) {
      expect(() => transformElement(doc, 'line-1', '1:1', patch)).toThrow();
      expect(doc).toEqual(before);
    }
    expect(() => transformElement(doc, 'missing', '1:1', {})).toThrow();
  });
  it('순서 변경은 해당 컷의 공유 순서만 바꾸며 양 끝에서 멈춘다', () => {
    const doc = createBuiltinDocument('builtin-story'),
      id = doc.panels[1]!.elementIds[0]!;
    const moved = reorderElement(doc, id, 'front');
    expect(moved.panels[1]!.elementIds.at(-1)).toBe(id);
    expect(moved.layouts).toEqual(doc.layouts);
    expect(moved.panels[0]).toEqual(doc.panels[0]);
    expect(reorderElement(moved, id, 'forward').panels).toEqual(moved.panels);
    const back = reorderElement(moved, id, 'back');
    expect(back.panels[1]!.elementIds).toEqual(doc.panels[1]!.elementIds);
    expect(reorderElement(back, id, 'backward').panels).toEqual(back.panels);
  });
  it('공유 소재는 마지막 참조 삭제 전까지 보존하고 빈 컷의 저장·복원을 허용한다', () => {
    let doc = createEditorDocument();
    const first = addElement(doc, doc.panels[0]!.id, character);
    doc = first.document;
    const second = addElement(doc, doc.panels[0]!.id, character);
    doc = second.document;
    doc = deleteElement(doc, first.elementId);
    expect(doc.assets).toHaveLength(1);
    doc = deleteElement(doc, second.elementId);
    expect(doc.assets).toHaveLength(0);
    doc = deleteElement(doc, 'line-1');
    expect(doc.elements).toEqual([]);
    expect(doc.layouts.every((layout) => layout.panels[0]!.elements.length === 0)).toBe(true);
    expect(validateEditorDocument(doc)).toEqual(doc);
    expect(validateEditorDocument(cloneTemplateDocument(doc)).elements).toEqual([]);
  });
  it('잠긴 요소는 삭제·변형·순서·문구 변경에서 보존한다', () => {
    const doc = createEditorDocument();
    doc.elements[0]!.locked = true;
    const before = structuredClone(doc);
    for (const edit of [
      () => deleteElement(doc, 'line-1'),
      () => transformElement(doc, 'line-1', '1:1', { x: 0.5 }),
      () => reorderElement(doc, 'line-1', 'front'),
      () => changeCaption(doc, { text: '안됨' }, '1:1', 'line-1'),
    ])
      expect(edit).toThrow('잠긴');
    expect(doc).toEqual(before);
  });
  it('역회전 선택은 앞 레이어를 우선하며 컷 밖·숨김·잠금은 선택하지 않는다', () => {
    let doc = createEditorDocument();
    const result = addElement(doc, doc.panels[0]!.id, { kind: 'text' });
    doc = result.document;
    doc = transformElement(doc, result.elementId, '1:1', {
      x: 0.3,
      y: 0.3,
      width: 0.4,
      height: 0.1,
      rotation: 90,
    });
    expect(hitTestElement(doc, 0.5, 0.5)?.elementId).toBe(result.elementId);
    expect(hitTestElement(doc, 0.65, 0.35)?.elementId).not.toBe(result.elementId);
    doc.elements.find((item) => item.id === result.elementId)!.hidden = true;
    expect(hitTestElement(doc, 0.5, 0.5)?.elementId).toBe('line-1');
    doc.elements[0]!.locked = true;
    expect(hitTestElement(doc, 0.5, 0.5)).toBeNull();
    expect(hitTestElement(doc, -0.1, 0.5)).toBeNull();
  });
});
