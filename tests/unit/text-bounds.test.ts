import { describe, expect, it } from 'vitest';
import { addElement, createEditorDocument, elementBounds } from '@jjal/editor-core';
import { createBuiltinDocument } from '@jjal/content';
import type { StudioDocument, StudioElement } from '@jjal/document-model';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import { canvasFont, textContentRect, wrapText } from '@jjal/renderer';
import {
  fitChangedTextBoxes,
  fitNewTextBoxes,
  measureTextBlock,
} from '../../apps/demo/src/composition/textBounds';

function measuringContext() {
  return {
    font: '',
    textBaseline: 'top' as CanvasTextBaseline,
    textAlign: 'left' as CanvasTextAlign,
    measureText: (text: string) =>
      ({
        width: [...text].length * 21,
        actualBoundingBoxLeft: 1,
        actualBoundingBoxRight: [...text].length * 21 - 1,
        actualBoundingBoxAscent: 3,
        actualBoundingBoxDescent: 31,
      }) as TextMetrics,
  };
}

describe('새 문구의 실측 1.5배 상자', () => {
  it.each(ASPECT_RATIOS)(
    '%s 컷 픽셀의 실측 치수와 사방 패딩을 맞추며 기존 중심을 보존한다',
    (ratio) => {
      const doc = createEditorDocument();
      doc.activeRatio = ratio;
      for (const layout of doc.layouts)
        layout.panels[0]!.rect = { x: 0.51, y: 0.02, width: 0.47, height: 0.46 };
      const before = structuredClone(doc),
        context = measuringContext();
      const after = fitNewTextBoxes(doc, undefined, context);
      const element = after.elements[0]!;
      if (element.kind !== 'text') throw new Error('test text');
      expect(element.boxPaddingRatio).toBe(1 / 6);
      for (const layout of after.layouts) {
        const logical = canvasSize(layout.ratio, 1080),
          placed = layout.panels[0]!,
          t = placed.elements[0]!.transform;
        const previous = before.layouts.find((item) => item.ratio === layout.ratio)!.panels[0]!
          .elements[0]!.transform;
        const width = t.width * placed.rect.width * logical.width,
          height = t.height * placed.rect.height * logical.height;
        expect(width).toBeCloseTo(4 * 21 * 1.5, 10);
        expect(height).toBeCloseTo(34 * 1.5, 10);
        expect(t.x + t.width / 2).toBeCloseTo(previous.x + previous.width / 2, 12);
        expect(t.y + t.height / 2).toBeCloseTo(previous.y + previous.height / 2, 12);
        const content = textContentRect(element, width, height);
        expect(content.width).toBeCloseTo(84, 10);
        expect(content.height).toBeCloseTo(34, 10);
        expect(content.x).toBeCloseTo(21, 10);
        expect(content.y).toBeCloseTo(8.5, 10);
      }
      expect(context.font).toContain('"Noto Sans KR"');
      expect(doc).toEqual(before);
    },
  );

  it('줄바꿈은 실제 잉크 높이와 줄 간격을 합하고 top-baseline의 위쪽 잉크를 보호한다', () => {
    const doc = createEditorDocument(),
      element = doc.elements[0]!;
    if (element.kind !== 'text') throw new Error('test text');
    element.text = '가나다\n라';
    element.style.fontSize = 40;
    element.style.lineHeight = 1.25;
    expect(measureTextBlock(element, measuringContext())).toEqual({ width: 63, height: 84 });
  });

  it('기존 문구·저장 배치를 변경하지 않고 새 ID의 문구만 맞춘다', () => {
    const original = createEditorDocument();
    original.layouts[0]!.panels[0]!.elements[0]!.transform.rotation = 32;
    const added = addElement(original, original.panels[0]!.id, { kind: 'text' });
    const after = fitNewTextBoxes(added.document, original, measuringContext());
    expect(after.elements[0]).toEqual(original.elements[0]);
    for (const layout of after.layouts)
      expect(layout.panels[0]!.elements[0]).toEqual(
        original.layouts.find((item) => item.ratio === layout.ratio)!.panels[0]!.elements[0],
      );
    expect(fitNewTextBoxes(original, original)).toBe(original);
  });

  it('말풍선·이미지 등은 일반 문구 초기 세팅을 적용하지 않는다', () => {
    const original = createEditorDocument();
    const added = addElement(original, original.panels[0]!.id, { kind: 'bubble', shape: 'speech' });
    expect(fitNewTextBoxes(added.document, original)).toBe(added.document);
  });

  it('빈 문구도 유효한 최소 치수이며 긴 문구는 스키마 한도에서 멈춘다', () => {
    const doc = createEditorDocument(),
      element = doc.elements[0]!;
    if (element.kind !== 'text') throw new Error('test text');
    element.text = '';
    const empty = fitNewTextBoxes(doc, undefined, measuringContext());
    expect(
      empty.layouts.every((layout) => layout.panels[0]!.elements[0]!.transform.width > 0),
    ).toBe(true);
    element.text = '가'.repeat(1000);
    const long = fitNewTextBoxes(doc, undefined, measuringContext());
    expect(
      long.layouts.every((layout) => layout.panels[0]!.elements[0]!.transform.width <= 4),
    ).toBe(true);
  });

  it('측정 실패는 기존 문구·배치·패딩을 보존하고 오류로 종료한다', () => {
    const doc = createEditorDocument(),
      before = structuredClone(doc),
      context = measuringContext();
    context.measureText = () =>
      ({
        width: NaN,
        actualBoundingBoxLeft: 0,
        actualBoundingBoxRight: 0,
        actualBoundingBoxAscent: 0,
        actualBoundingBoxDescent: 0,
      }) as TextMetrics;
    expect(() => fitNewTextBoxes(doc, undefined, context)).toThrow('측정');
    expect(doc).toEqual(before);
  });
});

type PlainText = Extract<StudioElement, { kind: 'text' }>;
function scaledContext() {
  return {
    font: '',
    textBaseline: 'top' as CanvasTextBaseline,
    textAlign: 'left' as CanvasTextAlign,
    measureText(text: string) {
      const size = Number(this.font.match(/([\d.]+)px/)?.[1] ?? 42);
      const family = this.font.includes('Noto Serif KR') ? 1.15 : 1;
      const weight = this.font.startsWith('700') ? 1.12 : 1;
      const count = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)].length;
      const width = count * size * 0.62 * family * weight;
      return {
        width,
        actualBoundingBoxLeft: text ? size * 0.02 : 0,
        actualBoundingBoxRight: text ? width - size * 0.02 : 0,
        actualBoundingBoxAscent: text ? size * 0.08 : 0,
        actualBoundingBoxDescent: text ? size * 0.82 : 0,
      } as TextMetrics;
    },
  };
}
function plain(doc: StudioDocument, id = doc.elements[0]!.id): PlainText {
  const value = doc.elements.find((element) => element.id === id);
  if (value?.kind !== 'text') throw new Error('test text');
  return value;
}
function completeText(doc: StudioDocument, id: string, context = scaledContext()) {
  const element = plain(doc, id);
  for (const layout of doc.layouts) {
    const size = canvasSize(layout.ratio);
    const panel = layout.panels.find((item) =>
      item.elements.some((placed) => placed.elementId === id),
    )!;
    const placed = panel.elements.find((item) => item.elementId === id)!;
    const pw = panel.rect.width * size.width,
      ph = panel.rect.height * size.height;
    const width = placed.transform.width * pw,
      height = placed.transform.height * ph;
    const box = textContentRect(element, width, height);
    context.font = canvasFont(element.style);
    const lines = wrapText(element.text, box.width, (value) => context.measureText(value).width);
    const block = measureTextBlock(element, context, box.width);
    expect(lines.join('')).toBe(element.text.replaceAll('\n', ''));
    expect(block.width).toBeLessThanOrEqual(box.width + 1e-6);
    expect(block.height).toBeLessThanOrEqual(box.height + 1e-6);
    const bounds = elementBounds(placed.transform, pw, ph);
    expect(panel.rect.x * size.width + bounds.left * pw).toBeGreaterThanOrEqual(-1e-6);
    expect(panel.rect.y * size.height + bounds.top * ph).toBeGreaterThanOrEqual(-1e-6);
    expect(panel.rect.x * size.width + bounds.right * pw).toBeLessThanOrEqual(size.width + 1e-6);
    expect(panel.rect.y * size.height + bounds.bottom * ph).toBeLessThanOrEqual(size.height + 1e-6);
    expect(bounds.left).toBeGreaterThanOrEqual(-1e-6);
    expect(bounds.right).toBeLessThanOrEqual(1 + 1e-6);
    expect(bounds.top).toBeGreaterThanOrEqual(-1e-6);
    expect(bounds.bottom).toBeLessThanOrEqual(1 + 1e-6);
  }
}

describe('변경한 일반 문구의 전체 표시 재맞춤', () => {
  it('내용을 바꾼 문구만 8개 비율에서 재측정하고 들어맞는 기존 중심과 입력을 보존한다', () => {
    const before = fitNewTextBoxes(createEditorDocument(), undefined, scaledContext());
    const added = addElement(before, before.panels[0]!.id, { kind: 'text' });
    const baseline = fitNewTextBoxes(added.document, before, scaledContext());
    const next = structuredClone(baseline),
      id = next.elements[0]!.id;
    plain(next, id).text = '더 긴 내용으로 변경합니다';
    const snapshot = structuredClone(next);
    const result = fitChangedTextBoxes(next, baseline, scaledContext());
    for (const layout of result.layouts) {
      const t = layout.panels[0]!.elements[0]!.transform;
      const previous = baseline.layouts.find((item) => item.ratio === layout.ratio)!.panels[0]!
        .elements[0]!.transform;
      expect(t.x + t.width / 2).toBeCloseTo(previous.x + previous.width / 2, 10);
      expect(t.y + t.height / 2).toBeCloseTo(previous.y + previous.height / 2, 10);
      expect(layout.panels[0]!.elements[1]).toEqual(
        baseline.layouts.find((item) => item.ratio === layout.ratio)!.panels[0]!.elements[1],
      );
    }
    expect(result.elements[1]).toEqual(baseline.elements[1]);
    expect(next).toEqual(snapshot);
    completeText(result, id);
  });

  it.each(['font', 'fontSize', 'bold', 'lineHeight', 'outline', 'contour'] as const)(
    '%s 변경 시 수동 상자를 재측정한다',
    (field) => {
      const previous = fitNewTextBoxes(createEditorDocument(), undefined, scaledContext());
      const next = structuredClone(previous),
        element = plain(next);
      if (field === 'font') element.style.font = { kind: 'builtin', family: 'Noto Serif KR' };
      if (field === 'fontSize') element.style.fontSize = 90;
      if (field === 'bold') element.style.bold = !element.style.bold;
      if (field === 'lineHeight') {
        element.style.lineHeight = 2.4;
        element.text = '첫줄\n둘째줄';
      }
      if (field === 'outline') element.style.outline = { color: '#000080', width: 12 };
      if (field === 'contour') element.contour = { texture: 'paint', color: '#0047AB', width: 20 };
      const result = fitChangedTextBoxes(next, previous, scaledContext());
      expect(result).not.toBe(next);
      completeText(result, element.id);
      expect(result.layouts[0]!.panels[0]!.elements[0]!.transform).not.toEqual(
        previous.layouts[0]!.panels[0]!.elements[0]!.transform,
      );
    },
  );

  it('위치·크기·회전만 바꾸거나 글자색·정렬만 바꾸면 다시 맞추지 않는다', () => {
    const previous = fitNewTextBoxes(createEditorDocument(), undefined, scaledContext());
    const next = structuredClone(previous);
    plain(next).style.color = '#0047AB';
    plain(next).style.align = 'left';
    Object.assign(next.layouts[0]!.panels[0]!.elements[0]!.transform, {
      x: 0.1,
      y: 0.3,
      width: 0.2,
      height: 0.5,
      rotation: 37,
    });
    expect(fitChangedTextBoxes(next, previous)).toBe(next);
  });

  it('1,000자 긴 한 줄을 전부 줄바꿈하고 공유 글꼴을 필요한 크기만 줄여 8개 비율에 넣는다', () => {
    const previous = createEditorDocument(),
      next = structuredClone(previous),
      element = plain(next);
    element.text = '가'.repeat(1000);
    element.style.fontSize = 100;
    const result = fitChangedTextBoxes(next, previous, scaledContext());
    expect(plain(result).style.fontSize).toBeGreaterThanOrEqual(8);
    expect(plain(result).style.fontSize).toBeLessThan(100);
    completeText(result, element.id);
  });

  it('실제 Noto 계열처럼 잉크 폭이 advance보다 넓어도 최소 8의 맞는 문구를 잘못 거부하지 않는다', () => {
    const previous = createEditorDocument(),
      next = structuredClone(previous),
      context = scaledContext();
    plain(next).text = '가'.repeat(1000);
    plain(next).style.fontSize = 8;
    context.measureText = (text: string) => {
      const size = Number(context.font.match(/([\d.]+)px/)?.[1] ?? 8),
        width = [...text].length * size * 0.92;
      return {
        width,
        actualBoundingBoxLeft: text ? 1 : 0,
        actualBoundingBoxRight: text ? width + 0.64 : 0,
        actualBoundingBoxAscent: 0,
        actualBoundingBoxDescent: size * 1.006,
      } as TextMetrics;
    };
    const result = fitChangedTextBoxes(next, previous, context);
    expect(plain(result).style.fontSize).toBe(8);
    completeText(result, next.elements[0]!.id, context);
  });

  it('여러 줄과 이모지 결합문자를 renderer와 같은 grapheme 경계로 보존한다', () => {
    const previous = createEditorDocument(),
      next = structuredClone(previous);
    plain(next).text = '👩‍💻가나다\n'.repeat(25);
    const result = fitChangedTextBoxes(next, previous, scaledContext());
    completeText(result, next.elements[0]!.id);
  });

  it.each([0, 45, 90, 137])('4컷의 %s도 상자를 실제 회전 AABB 안으로 최소 이동한다', (rotation) => {
    const original = createBuiltinDocument('builtin-story');
    const added = addElement(original, original.panels[0]!.id, { kind: 'text' });
    plain(added.document, added.elementId).text =
      '회전해도 모든 문구가 보이는지 확인합니다. '.repeat(6);
    for (const layout of added.document.layouts) {
      const placement = layout.panels[0]!.elements.find(
        (item) => item.elementId === added.elementId,
      )!;
      Object.assign(placement.transform, { x: 0.8, y: 0.9, rotation, flipX: true, flipY: true });
    }
    const result = fitChangedTextBoxes(added.document, original, scaledContext());
    completeText(result, added.elementId);
    expect(
      result.layouts.every(
        (layout) =>
          layout.panels[0]!.elements.find((item) => item.elementId === added.elementId)!.transform
            .rotation === rotation,
      ),
    ).toBe(true);
  });

  it('Canvas 가장자리의 좁은 컷도 실제 경계 안으로 배치한다', () => {
    const previous = createEditorDocument(),
      next = structuredClone(previous);
    plain(next).text = '경계 문구 확인';
    for (const layout of next.layouts)
      layout.panels[0]!.rect = { x: 0.85, y: 0.1, width: 0.15, height: 0.8 };
    const result = fitChangedTextBoxes(next, previous, scaledContext());
    completeText(result, next.elements[0]!.id);
  });

  it('contour가 기존 outline을 대체하며 1.5배 상자 내부에 유효 외곽선 폭을 포함한다', () => {
    const previous = createEditorDocument(),
      next = structuredClone(previous),
      element = plain(next);
    element.style.outline = { color: '#000080', width: 20 };
    element.contour = { texture: 'pencil', color: '#0047AB', width: 4 };
    const result = fitChangedTextBoxes(next, previous, scaledContext()),
      target = plain(result);
    const block = measureTextBlock(target, scaledContext());
    const size = canvasSize(result.layouts[0]!.ratio),
      t = result.layouts[0]!.panels[0]!.elements[0]!.transform;
    expect(t.width * size.width).toBeCloseTo((block.width + 4) * 1.5, 8);
    expect(t.height * size.height).toBeCloseTo((block.height + 4) * 1.5, 8);
    completeText(result, target.id);
  });

  it('최소 8에서도 불가능한 줄 수는 명확히 거부하고 모든 원본 요소·배치를 보존한다', () => {
    const previous = createEditorDocument();
    const added = addElement(previous, previous.panels[0]!.id, { kind: 'text' });
    const next = structuredClone(added.document);
    plain(next, next.elements[0]!.id).text = '먼저 맞춰질 내용';
    plain(next, added.elementId).text = '\n'.repeat(999);
    const snapshot = structuredClone(next),
      oldSnapshot = structuredClone(previous);
    expect(() => fitChangedTextBoxes(next, previous, scaledContext())).toThrow('최소 글자 크기 8');
    expect(next).toEqual(snapshot);
    expect(previous).toEqual(oldSnapshot);
  });
});
