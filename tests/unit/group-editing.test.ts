import { describe, expect, it } from 'vitest';
import { BUILTIN_ASSETS, createBuiltinDocument } from '@jjal/content';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import {
  addElement,
  applyStyle,
  captureStyle,
  changeCaption,
  copyElements,
  createEditorDocument,
  deleteElements,
  moveElements,
  reorderPanel,
  replaceImage,
  scaleElements,
  setElementFlags,
  transformElement,
} from '@jjal/editor-core';
import { parseDocument } from '@jjal/document-model';

describe('여러 요소와 컷 작업의 원자성', () => {
  it('잠금/숨김 관리와 모든 요소 내용/배치 변경의 잠금 보호', () => {
    let doc = createBuiltinDocument('builtin-before-after');
    const ids = doc.panels[0]!.elementIds;
    const text = ids.find((id) => doc.elements.find((item) => item.id === id)!.kind === 'text')!;
    const image = ids.find(
      (id) => doc.elements.find((item) => item.id === id)!.kind === 'character',
    )!;
    const style = captureStyle(doc, text, '서식');
    doc = setElementFlags(doc, ids, { locked: true, hidden: true });
    const before = structuredClone(doc);
    for (const operation of [
      () => changeCaption(doc, { text: '차단' }, '1:1', text),
      () => transformElement(doc, text, '1:1', { x: 0.5 }),
      () =>
        replaceImage(doc, BUILTIN_ASSETS[1]!.asset, {
          panelId: doc.panels[0]!.id,
          elementId: image,
        }),
      () => applyStyle(doc, text, style),
      () => moveElements(doc, ids, '1:1', 0.1, 0),
      () => scaleElements(doc, ids, '1:1', 2),
      () => copyElements(doc, ids, doc.panels[1]!.id),
      () => deleteElements(doc, ids),
    ])
      expect(operation).toThrow(/잠/);
    expect(doc).toEqual(before);
    const shown = setElementFlags(doc, ids, { hidden: false });
    expect(
      shown.elements
        .filter((item) => ids.includes(item.id))
        .every((item) => item.locked && !item.hidden),
    ).toBe(true);
    expect(
      setElementFlags(shown, ids, { locked: false })
        .elements.filter((item) => ids.includes(item.id))
        .every((item) => !item.locked),
    ).toBe(true);
    expect(doc.layouts).toEqual(shown.layouts);
  });
  it.each(ASPECT_RATIOS)(
    '%s의 묶음 이동/배율은 상대 배치를 유지하며 다른 비율/컷을 보존한다',
    (ratio) => {
      const doc = createBuiltinDocument('builtin-before-after');
      const ids = doc.panels[0]!.elementIds;
      const moved = moveElements(doc, ids, ratio, 0.07, -0.03);
      const scaled = scaleElements(moved, ids, ratio, 0.8);
      const before = doc.layouts.find((item) => item.ratio === ratio)!.panels[0]!;
      const afterMove = moved.layouts.find((item) => item.ratio === ratio)!.panels[0]!;
      const after = scaled.layouts.find((item) => item.ratio === ratio)!.panels[0]!;
      before.elements.forEach((item, index) => {
        expect(afterMove.elements[index]!.transform.x).toBeCloseTo(item.transform.x + 0.07, 10);
        expect(afterMove.elements[index]!.transform.y).toBeCloseTo(item.transform.y - 0.03, 10);
        expect(after.elements[index]!.transform.width).toBeCloseTo(item.transform.width * 0.8, 10);
        expect(after.elements[index]!.transform.height).toBeCloseTo(
          item.transform.height * 0.8,
          10,
        );
      });
      const centerDifference = (items: typeof after.elements) =>
        items[1]!.transform.x +
        items[1]!.transform.width / 2 -
        items[0]!.transform.x -
        items[0]!.transform.width / 2;
      expect(centerDifference(after.elements)).toBeCloseTo(
        centerDifference(afterMove.elements) * 0.8,
        10,
      );
      expect(scaled.layouts.filter((item) => item.ratio !== ratio)).toEqual(
        doc.layouts.filter((item) => item.ratio !== ratio),
      );
      expect(scaled.layouts.find((item) => item.ratio === ratio)!.panels[1]).toEqual(
        doc.layouts.find((item) => item.ratio === ratio)!.panels[1],
      );
      expect(scaled.elements).toEqual(doc.elements);
    },
  );
  it('복제는 레이어 순서와 모든 배치/서식/참조를 유지하고 독립 ID를 부여한다', () => {
    const doc = createBuiltinDocument('builtin-before-after');
    const original = structuredClone(doc),
      ids = doc.panels[0]!.elementIds;
    const result = copyElements(doc, [...ids].reverse(), doc.panels[0]!.id);
    expect(result.elementIds.every((id) => !doc.elements.some((item) => item.id === id))).toBe(
      true,
    );
    expect(result.document.assets).toEqual(doc.assets);
    expect(result.document.panels[0]!.elementIds).toEqual([...ids, ...result.elementIds]);
    result.elementIds.forEach((id, index) =>
      expect(result.document.elements.find((item) => item.id === id)).toEqual({
        ...doc.elements.find((item) => item.id === ids[index])!,
        id,
      }),
    );
    for (const layout of result.document.layouts) {
      const source = doc.layouts.find((item) => item.ratio === layout.ratio)!.panels[0]!;
      for (const [index, id] of result.elementIds.entries()) {
        const t = source.elements.find((item) => item.elementId === ids[index])!.transform;
        expect(layout.panels[0]!.elements.find((item) => item.elementId === id)!.transform).toEqual(
          { ...t, x: t.x + 0.03, y: t.y + 0.03 },
        );
      }
    }
    const textId = result.elementIds.find(
      (id) => result.document.elements.find((item) => item.id === id)!.kind === 'text',
    )!;
    const edited = changeCaption(result.document, { text: '복사본만 수정' }, '1:1', textId);
    expect(edited.elements.filter((item) => ids.includes(item.id))).toEqual(
      doc.elements.filter((item) => ids.includes(item.id)),
    );
    expect(doc).toEqual(original);
  });
  it('서로 다른 컷 크기의 복사는 8비율의 픽셀 크기/상대 간격을 유지한다', () => {
    const doc = createBuiltinDocument('builtin-before-after');
    const source = doc.panels[0]!,
      target = doc.panels[1]!;
    for (const layout of doc.layouts) {
      layout.panels[0]!.rect = { x: 0, y: 0, width: 0.4, height: 0.6 };
      layout.panels[1]!.rect = { x: 0.4, y: 0, width: 0.6, height: 1 };
    }
    const result = copyElements(doc, source.elementIds, target.id);
    for (const layout of result.document.layouts) {
      const size = canvasSize(layout.ratio),
        from = layout.panels[0]!,
        to = layout.panels[1]!;
      result.elementIds.forEach((id, index) => {
        const a = from.elements.find(
          (item) => item.elementId === source.elementIds[index],
        )!.transform;
        const b = to.elements.find((item) => item.elementId === id)!.transform;
        for (const key of ['x', 'width'] as const)
          expect(b[key] * to.rect.width * size.width).toBeCloseTo(
            a[key] * from.rect.width * size.width,
            9,
          );
        for (const key of ['y', 'height'] as const)
          expect(b[key] * to.rect.height * size.height).toBeCloseTo(
            a[key] * from.rect.height * size.height,
            9,
          );
      });
    }
    expect(parseDocument(result.document)).toEqual(result.document);
  });
  it('컷 교환은 8비율의 격자를 고정하고 배경/요소/플래그를 함께 이동한다', () => {
    const doc = createBuiltinDocument('builtin-story');
    doc.elements[0]!.locked = true;
    doc.elements[1]!.hidden = true;
    const before = structuredClone(doc);
    const result = reorderPanel(doc, doc.panels[2]!.id, 'previous');
    expect(result.panels.map((item) => item.id)).toEqual([
      doc.panels[0]!.id,
      doc.panels[2]!.id,
      doc.panels[1]!.id,
      doc.panels[3]!.id,
    ]);
    expect(result.elements).toEqual(doc.elements);
    for (const [index, layout] of result.layouts.entries()) {
      expect(layout.panels.map((item) => item.rect)).toEqual(
        doc.layouts[index]!.panels.map((item) => item.rect),
      );
      const source = doc.layouts[index]!.panels[2]!;
      expect(layout.panels[1]!.elements).toEqual(source.elements);
    }
    expect(result.panels[1]).toEqual(doc.panels[2]);
    expect(reorderPanel(result, doc.panels[2]!.id, 'next')).toEqual({
      ...doc,
      updatedAt: expect.any(String),
    });
    expect(reorderPanel(doc, doc.panels[0]!.id, 'previous')).toBe(doc);
    expect(doc).toEqual(before);
  });
  it('일부 잠금·다른 컷·중복/빈 ID·수치 오류와 범위 초과는 부분 반영하지 않는다', () => {
    const doc = createBuiltinDocument('builtin-before-after'),
      before = structuredClone(doc),
      ids = doc.panels[0]!.elementIds;
    for (const action of [
      () => moveElements(doc, [], '1:1', 0, 0),
      () => moveElements(doc, [ids[0]!, ids[0]!], '1:1', 0, 0),
      () => moveElements(doc, [ids[0]!, doc.panels[1]!.elementIds[0]!], '1:1', 0, 0),
      () => moveElements(doc, ids, '1:1', NaN, 0),
      () => moveElements(doc, ids, '1:1', 5, 0),
      () => scaleElements(doc, ids, '1:1', 0),
      () => scaleElements(doc, ids, '1:1', Infinity),
      () => scaleElements(doc, ids, '1:1', 100),
      () => copyElements(doc, ids, 'missing'),
      () => setElementFlags(doc, ids, { hidden: 'yes' } as never),
    ]) {
      expect(action).toThrow();
      expect(doc).toEqual(before);
    }
    doc.elements.find((item) => item.id === ids[1])!.locked = true;
    const locked = structuredClone(doc);
    expect(() => deleteElements(doc, ids)).toThrow('잠');
    expect(doc).toEqual(locked);
  });
  it('캐릭터/요소 한도와 복사 대상의 좌표 제한은 사전 거부하고 공유 소재는 마지막 삭제까지 유지한다', () => {
    const doc = createBuiltinDocument('builtin-before-after'),
      ids = doc.panels[0]!.elementIds;
    const copied = copyElements(doc, ids, doc.panels[0]!.id);
    const four = copyElements(
      copied.document,
      [...ids, ...copied.elementIds],
      doc.panels[0]!.id,
    ).document;
    const before = structuredClone(four);
    expect(() => copyElements(four, ids, four.panels[0]!.id)).toThrow('최대 4개');
    expect(four).toEqual(before);
    let many = createEditorDocument();
    for (let index = 1; index < 100; index++)
      many = addElement(many, many.panels[0]!.id, { kind: 'text' }).document;
    const full = structuredClone(many);
    expect(() => copyElements(many, ['line-1'], many.panels[0]!.id)).toThrow('최대 100개');
    expect(many).toEqual(full);
    const small = structuredClone(doc);
    for (const layout of small.layouts) layout.panels[1]!.rect.width = 0.001;
    expect(() => copyElements(small, ids, small.panels[1]!.id)).toThrow();
    const removed = deleteElements(copied.document, ids);
    expect(removed.assets).toEqual(doc.assets);
  });
});
