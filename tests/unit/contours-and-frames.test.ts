import { describe, expect, it } from 'vitest';
import { createBuiltinDocument } from '@jjal/content';
import {
  ContourSchema,
  DocumentSchema,
  parseDocument,
  type StudioDocument,
} from '@jjal/document-model';
import {
  addElement,
  addImageResource,
  applyStyle,
  captureStyle,
  changeElementContour,
  copyElements,
  createEditorDocument,
  deleteElement,
  EditHistory,
  hitTestElement,
  reorderElement,
  setElementFlags,
  transformElement,
} from '@jjal/editor-core';
import { ASPECT_RATIOS } from '@jjal/policies';
import { effectiveContour } from '@jjal/renderer';
import { ensurePanelFrameLayers } from '../../apps/demo/src/composition/panelFrames';

function fullDocument(count = 100): StudioDocument {
  const doc = createEditorDocument(),
    text = doc.elements[0]!,
    transform = doc.layouts[0]!.panels[0]!.elements[0]!.transform;
  doc.elements = Array.from({ length: count }, (_, index) => ({
    ...structuredClone(text),
    id: `text-${index}`,
  }));
  doc.panels[0]!.elementIds = doc.elements.map((element) => element.id);
  for (const layout of doc.layouts)
    layout.panels[0]!.elements = doc.elements.map((element) => ({
      elementId: element.id,
      transform: structuredClone(transform),
    }));
  return parseDocument(doc);
}

describe('공통 외곽 스타일의 스키마·불변 편집', () => {
  it('5종 요소의 외곽 질감·HEX·두께를 바꾸어도 배치·원본은 유지한다', () => {
    let doc = ensurePanelFrameLayers(createBuiltinDocument('builtin-story'));
    const image = addImageResource(doc, doc.panels[0]!.id, doc.assets[0]!);
    doc = image.document;
    const before = structuredClone(doc);
    expect(new Set(doc.elements.map((element) => element.kind))).toEqual(
      new Set(['frame', 'image', 'character', 'bubble', 'text']),
    );
    for (const element of doc.elements) {
      const next = changeElementContour(doc, element.id, {
        texture: 'pencil',
        color: '#66C4FF',
        width: 13,
      });
      expect(next.elements.find((item) => item.id === element.id)!.contour).toEqual({
        texture: 'pencil',
        color: '#66C4FF',
        width: 13,
      });
      expect(next.layouts).toEqual(doc.layouts);
      expect(next.assets).toEqual(doc.assets);
      expect(next.elements.filter((item) => item.id !== element.id)).toEqual(
        doc.elements.filter((item) => item.id !== element.id),
      );
    }
    expect(doc).toEqual(before);
  });

  it.each([
    { width: -1 },
    { width: 31 },
    { width: NaN },
    { width: Infinity },
    { color: 'red' },
    { color: '#12345G' },
    { texture: 'oil' },
    { text: 'overwrite' },
  ])('잘못된 외곽 입력 %j는 기존 문서를 변경하지 않는다', (patch) => {
    const doc = createEditorDocument(),
      before = structuredClone(doc);
    expect(() =>
      changeElementContour(
        doc,
        doc.elements[0]!.id,
        patch as Parameters<typeof changeElementContour>[2],
      ),
    ).toThrow();
    expect(doc).toEqual(before);
  });

  it('미지정 외곽선은 기존 문구/말풍선 서식을 사용하고 명시적인 0은 이를 끈다', () => {
    const doc = createBuiltinDocument('builtin-story');
    const bubble = doc.elements.find((element) => element.kind === 'bubble')!;
    if (bubble.kind !== 'bubble') throw new Error('test bubble');
    expect(effectiveContour(bubble)).toEqual({
      texture: 'pen',
      color: bubble.border,
      width: bubble.borderWidth,
    });
    const text = doc.elements.find((element) => element.kind === 'text')!;
    if (text.kind !== 'text') throw new Error('test text');
    text.style.outline = { color: '#E6AB5E', width: 8 };
    expect(effectiveContour(text)).toEqual({ texture: 'pen', color: '#E6AB5E', width: 8 });
    expect(
      effectiveContour(
        changeElementContour(doc, text.id, { width: 0 }).elements.find(
          (element) => element.id === text.id,
        )!,
      ).width,
    ).toBe(0);
    expect(ContourSchema.parse({ texture: 'paint', color: '#F8F9FA', width: 0 })).toMatchObject({
      width: 0,
    });
  });

  it('잠긴 요소는 외곽 변경을 거부하고 내 스타일·JSON에는 새 외곽선이 보존된다', () => {
    const original = createEditorDocument(),
      id = original.elements[0]!.id;
    const doc = changeElementContour(original, id, {
      texture: 'paint',
      color: '#0047AB',
      width: 11,
    });
    const style = captureStyle(doc, id, '외곽 스타일');
    expect(style.contour).toEqual(doc.elements[0]!.contour);
    expect(applyStyle(original, id, style).elements[0]!.contour).toEqual(style.contour);
    const locked = setElementFlags(doc, [id], { locked: true });
    expect(() => changeElementContour(locked, id, { width: 5 })).toThrow('잠긴');
    expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const legacyStyle = captureStyle(original, id, '기존 스타일');
    expect(applyStyle(doc, id, legacyStyle).elements[0]).not.toHaveProperty('contour');
  });
});

describe('컷 테두리의 독립 레이어 이행과 편집', () => {
  it.each([
    'builtin-emotion',
    'builtin-dialogue',
    'builtin-before-after',
    'builtin-reaction',
    'builtin-story',
    'builtin-twist',
  ])('%s의 모든 컷 아래에 테두리를 한 번만 추가하고 8개 비율 배치를 보존한다', (id) => {
    const doc = createBuiltinDocument(id),
      before = structuredClone(doc);
    const next = ensurePanelFrameLayers(doc);
    expect(next.frameLayers).toBe(true);
    expect(next.elements.filter((element) => element.kind === 'frame')).toHaveLength(
      doc.panels.length,
    );
    expect(next.layouts).toHaveLength(8);
    for (const panel of next.panels) {
      const frameId = panel.elementIds[0]!;
      expect(next.elements.find((element) => element.id === frameId)?.kind).toBe('frame');
      expect(panel.elementIds.slice(1)).toEqual(
        doc.panels.find((item) => item.id === panel.id)!.elementIds,
      );
      for (const layout of next.layouts) {
        const placed = layout.panels.find((item) => item.panelId === panel.id)!;
        expect(placed.elements.find((item) => item.elementId === frameId)!.transform).toEqual({
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotation: 0,
          flipX: false,
          opacity: 1,
        });
        expect(placed.elements.filter((item) => item.elementId !== frameId)).toEqual(
          doc.layouts
            .find((item) => item.ratio === layout.ratio)!
            .panels.find((item) => item.panelId === panel.id)!.elements,
        );
      }
    }
    expect(ensurePanelFrameLayers(next)).toBe(next);
    expect(next.updatedAt).toBe(doc.updatedAt);
    expect(doc).toEqual(before);
  });

  it('비율 배치가 하나인 과거 문서는 정규화 배치를 복사해 나머지 비율을 준비한다', () => {
    const doc = createEditorDocument();
    doc.layouts = doc.layouts.slice(0, 1);
    const next = ensurePanelFrameLayers(doc);
    expect(new Set(next.layouts.map((layout) => layout.ratio))).toEqual(new Set(ASPECT_RATIOS));
    expect(doc.layouts).toHaveLength(1);
  });

  it('테두리는 변형·순서·복제·잠금·숨김·삭제되며 삭제 후 이행을 다시 해도 되살아나지 않는다', () => {
    const doc = ensurePanelFrameLayers(createEditorDocument()),
      frame = doc.elements.find((element) => element.kind === 'frame')!;
    const changed = transformElement(doc, frame.id, '9:16', {
      rotation: 37,
      width: 0.7,
      height: 0.8,
      flipX: true,
    });
    expect(
      changed.layouts.find((layout) => layout.ratio === '9:16')!.panels[0]!.elements[0]!.transform,
    ).toMatchObject({ rotation: 37, width: 0.7, height: 0.8, flipX: true });
    const front = reorderElement(changed, frame.id, 'front');
    expect(front.panels[0]!.elementIds.at(-1)).toBe(frame.id);
    const copied = copyElements(front, [frame.id], front.panels[0]!.id);
    expect(
      copied.document.elements.find((element) => element.id === copied.elementIds[0])?.kind,
    ).toBe('frame');
    expect(
      setElementFlags(front, [frame.id], { hidden: true }).elements.find(
        (element) => element.id === frame.id,
      )?.hidden,
    ).toBe(true);
    const locked = setElementFlags(front, [frame.id], { locked: true });
    expect(() => deleteElement(locked, frame.id)).toThrow('잠긴');
    const deleted = deleteElement(doc, frame.id);
    expect(deleted.frameLayers).toBe(true);
    expect(ensurePanelFrameLayers(deleted)).toBe(deleted);
    expect(deleted.elements.some((element) => element.kind === 'frame')).toBe(false);
    const history = new EditHistory<StudioDocument>(
      (a, b) => JSON.stringify(a) === JSON.stringify(b),
    );
    history.record(doc, deleted);
    expect(history.undo(deleted)).toEqual(doc);
  });

  it.each(ASPECT_RATIOS)(
    '%s 테두리는 내부 빈 공간에서 선택되지 않고 경계 근처만 선택된다',
    (ratio) => {
      const doc = ensurePanelFrameLayers(createEditorDocument());
      doc.activeRatio = ratio;
      const textId = doc.elements.find((element) => element.kind === 'text')!.id;
      const frame = doc.elements.find((element) => element.kind === 'frame')!;
      const onlyFrame = deleteElement(doc, textId);
      expect(hitTestElement(onlyFrame, 0.5, 0.5)).toBeNull();
      expect(hitTestElement(onlyFrame, 0.001, 0.5)?.elementId).toBe(frame.id);
      expect(
        hitTestElement(setElementFlags(onlyFrame, [frame.id], { hidden: true }), 0.001, 0.5),
      ).toBeNull();
      expect(
        hitTestElement(setElementFlags(onlyFrame, [frame.id], { locked: true }), 0.001, 0.5),
      ).toBeNull();
      expect(
        hitTestElement(changeElementContour(onlyFrame, frame.id, { width: 0 }), 0.001, 0.5),
      ).toBeNull();
    },
  );

  it('100개 콘텐츠는 테두리 포함 102개까지 유지하고 콘텐츠 101개·전체 103개는 거부한다', () => {
    const original = fullDocument(),
      before = structuredClone(original),
      next = ensurePanelFrameLayers(original);
    expect(next.elements).toHaveLength(101);
    expect(DocumentSchema.safeParse(next).success).toBe(true);
    expect(() => addElement(next, next.panels[0]!.id, { kind: 'text' })).toThrow('100');
    expect(() => copyElements(next, ['text-0'], next.panels[0]!.id)).toThrow('100');
    const frame = next.elements.find((element) => element.kind === 'frame')!;
    const nextBeforeCopy = structuredClone(next);
    const copied = copyElements(next, [frame.id], next.panels[0]!.id);
    expect(copied.document.elements).toHaveLength(102);
    expect(DocumentSchema.safeParse(copied.document).success).toBe(true);
    expect(copied.elementIds).toHaveLength(1);
    expect(copied.elementIds[0]).not.toBe(frame.id);
    expect(copied.document.elements.find((element) => element.id === copied.elementIds[0])).toEqual(
      {
        ...frame,
        id: copied.elementIds[0],
      },
    );
    expect(copied.document.elements.filter((element) => element.kind !== 'frame')).toHaveLength(
      100,
    );
    for (const layout of copied.document.layouts)
      expect(layout.panels[0]!.elements).toHaveLength(102);
    const copyBeforeFailure = structuredClone(copied.document);
    expect(() => copyElements(copied.document, [frame.id], copied.document.panels[0]!.id)).toThrow(
      '102',
    );
    expect(() =>
      addElement(copied.document, copied.document.panels[0]!.id, { kind: 'text' }),
    ).toThrow('100');
    expect(() => copyElements(copied.document, ['text-0'], copied.document.panels[0]!.id)).toThrow(
      '100',
    );
    expect(copied.document).toEqual(copyBeforeFailure);
    expect(next).toEqual(nextBeforeCopy);
    const noFrame = deleteElement(next, frame.id);
    expect(() => addElement(noFrame, noFrame.panels[0]!.id, { kind: 'text' })).toThrow('100');
    expect(
      addElement(noFrame, noFrame.panels[0]!.id, { kind: 'frame' }).document.elements,
    ).toHaveLength(101);
    expect(original).toEqual(before);
    const invalid = fullDocument(99),
      sample = invalid.elements[0]!;
    for (const id of ['extra-a', 'extra-b']) {
      invalid.elements.push({ ...structuredClone(sample), id });
      invalid.panels[0]!.elementIds.push(id);
      for (const layout of invalid.layouts)
        layout.panels[0]!.elements.push({
          elementId: id,
          transform: structuredClone(layout.panels[0]!.elements[0]!.transform),
        });
    }
    expect(DocumentSchema.safeParse(invalid).success).toBe(false);
  });

  it('4컷의 과거 콘텐츠 400개는 프레임 4개를 포함한 404개로 원본 손실 없이 이행한다', () => {
    const doc = createBuiltinDocument('builtin-story');
    const sample = doc.elements.find((element) => element.kind === 'text')!;
    doc.elements = [];
    for (const panel of doc.panels) {
      const elements = Array.from({ length: 100 }, (_, index) => ({
        ...structuredClone(sample),
        id: `${panel.id}-text-${index}`,
      }));
      doc.elements.push(...elements);
      panel.elementIds = elements.map((element) => element.id);
      for (const layout of doc.layouts) {
        const placed = layout.panels.find((item) => item.panelId === panel.id)!;
        const transform = placed.elements[0]!.transform;
        placed.elements = elements.map((element) => ({
          elementId: element.id,
          transform: structuredClone(transform),
        }));
      }
    }
    const before = structuredClone(parseDocument(doc));
    const next = ensurePanelFrameLayers(doc);
    expect(next.elements).toHaveLength(404);
    expect(next.panels.every((panel) => panel.elementIds.length === 101)).toBe(true);
    expect(next.elements.filter((element) => element.kind !== 'frame')).toEqual(before.elements);
    expect(DocumentSchema.safeParse(next).success).toBe(true);
    expect(doc).toEqual(before);
  });
});
