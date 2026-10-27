import { describe, expect, it } from 'vitest';
import { createEditorDocument } from '@jjal/editor-core';
import {
  BubbleAppearanceSchema,
  parseDocument,
  SavedStyleSchema,
  type StudioElement,
} from '@jjal/document-model';
import { renderDocument, textBlockVerticalOffset, textContentRect } from '@jjal/renderer';
import { recordingCanvas } from './renderer-recording';

function bubble(): Extract<StudioElement, { kind: 'bubble' }> {
  const text = createEditorDocument().elements[0]!;
  if (text.kind !== 'text') throw new Error('test text');
  return {
    id: text.id,
    kind: 'bubble',
    locked: false,
    hidden: false,
    text: '가\n나',
    style: { ...text.style, align: 'center', fontSize: 28, lineHeight: 1.25 },
    shape: 'speech',
    fill: '#F8F9FA',
    border: '#0B0F2B',
    borderWidth: 2,
    tail: { x: 0.5, y: 1, side: 'bottom' },
  };
}

function renderBubble(element: Extract<StudioElement, { kind: 'bubble' }>) {
  const doc = createEditorDocument();
  doc.elements[0] = element;
  for (const layout of doc.layouts)
    Object.assign(layout.panels[0]!.elements[0]!.transform, {
      width: 300 / 1080,
      height: 200 / 1080,
    });
  const f = recordingCanvas();
  renderDocument(f.canvas, parseDocument(doc));
  return f;
}

describe('말풍선 사방 여백과 실제 글자 블록 정렬', () => {
  it.each([
    ['bottom', { x: 45.5, y: 15.5, width: 229, height: 113 }],
    ['top', { x: 45.5, y: 51.5, width: 229, height: 113 }],
    ['left', { x: 99.5, y: 15.5, width: 175, height: 149 }],
    ['right', { x: 45.5, y: 15.5, width: 175, height: 149 }],
  ] as const)(
    '%s 꼬리 공간을 제외한 테두리 안쪽부터 사방 logical px와 글자 외곽 여백을 적용한다',
    (side, expected) => {
      const element = bubble();
      element.tail = { x: 0.5, y: 0.5, side };
      element.textPadding = { top: 10, right: 20, bottom: 30, left: 40 };
      element.style.outline = { color: '#0047AB', width: 6 };
      const box = textContentRect(element, 300, 200);
      for (const key of ['x', 'y', 'width', 'height'] as const)
        expect(box[key]).toBeCloseTo(expected[key], 10);
    },
  );

  it('caption은 꼬리 공간을 차감하지 않고 과거 미지정 여백은 기존 값으로 남는다', () => {
    const element = bubble();
    expect(textContentRect(element, 300, 200)).toEqual({ x: 36, y: 26, width: 228, height: 112 });
    element.borderWidth = 30;
    expect(textContentRect(element, 300, 200)).toEqual({ x: 36, y: 26, width: 228, height: 112 });
    element.borderWidth = 2;
    element.shape = 'caption';
    element.textPadding = { top: 10, right: 20, bottom: 30, left: 40 };
    expect(textContentRect(element, 300, 200)).toEqual({
      x: 42.5,
      y: 12.5,
      width: 235,
      height: 155,
    });
    element.textPadding = { top: 200, right: 200, bottom: 200, left: 200 };
    expect(textContentRect(element, 100, 80)).toMatchObject({ width: 1, height: 1 });
  });

  it.each(['border', 'contour'] as const)(
    '%s 폭30에서도 glyph 외곽과 실제 테두리 안쪽 사이에 지정한 12px를 확보한다',
    (source) => {
      const element = bubble();
      if (source === 'border') element.borderWidth = 30;
      else element.contour = { texture: 'pen', color: '#0047AB', width: 30 };
      element.textPadding = { top: 12, right: 12, bottom: 12, left: 12 };
      element.style.outline = { color: '#0B0F2B', width: 6 };
      const box = textContentRect(element, 300, 200);
      expect(box).toEqual({ x: 45.5, y: 45.5, width: 209, height: 73 });
      const glyphPad = 3;
      // The painted body is 300×164; path inset15.5 plus stroke half15 yields30.5.
      const inner = { left: 30.5, top: 30.5, right: 269.5, bottom: 133.5 };
      expect(box.x - glyphPad - inner.left).toBe(12);
      expect(box.y - glyphPad - inner.top).toBe(12);
      expect(inner.right - (box.x + box.width + glyphPad)).toBe(12);
      expect(inner.bottom - (box.y + box.height + glyphPad)).toBe(12);
    },
  );

  it('테두리 폭0은 사방 여백을 몸체에서 그대로 적용한다', () => {
    const element = bubble();
    element.shape = 'caption';
    element.contour = { texture: 'pen', color: '#0B0F2B', width: 0 };
    element.textPadding = { top: 18, right: 24, bottom: 46, left: 70 };
    expect(textContentRect(element, 300, 200)).toEqual({ x: 70, y: 18, width: 206, height: 136 });
  });

  it('두 줄의 실제 잉크와 line advance를 가운데·아래 정렬하고 부재 시 기존 top offset을 유지한다', () => {
    const element = bubble(),
      lines = ['가', '나'];
    const context = {
      measureText: (line: string) =>
        ({
          actualBoundingBoxAscent: line === '가' ? 6 : 2,
          actualBoundingBoxDescent: line === '가' ? 18 : 22,
        }) as TextMetrics,
    };
    expect(textBlockVerticalOffset(context, element, lines, 120)).toBe(6);
    element.verticalAlign = 'center';
    const centered = textBlockVerticalOffset(context, element, lines, 120);
    const top = centered - 6,
      bottom = centered + 35 + 22;
    expect(top).toBeCloseTo(120 - bottom, 12);
    element.verticalAlign = 'bottom';
    expect(textBlockVerticalOffset(context, element, lines, 120) + 35 + 22).toBe(120);
    element.verticalAlign = 'top';
    expect(textBlockVerticalOffset(context, element, lines, 120)).toBe(6);
  });

  it('공통 painter는 수평 가운데와 계산한 수직 offset을 실제 fillText에 적용한다', () => {
    const element = bubble();
    element.textPadding = { top: 12, right: 12, bottom: 12, left: 12 };
    element.verticalAlign = 'center';
    const f = renderBubble(element),
      box = textContentRect(element, 300, 200);
    const drawings = f.calls.filter((call) => call.operation === 'fillText');
    const offset = textBlockVerticalOffset(
      {
        measureText: () =>
          ({ actualBoundingBoxAscent: 6, actualBoundingBoxDescent: 18 }) as TextMetrics,
      },
      element,
      ['가', '나'],
      box.height,
    );
    expect(drawings).toHaveLength(2);
    expect(drawings[0]!.args[1]).toBeCloseTo(box.x + box.width / 2, 10);
    expect(drawings[0]!.args[2]).toBeCloseTo(box.y + offset, 10);
    expect(Number(drawings[1]!.args[2]) - Number(drawings[0]!.args[2])).toBe(35);
  });

  it('여백·정렬·모서리·뾰족함이 SavedStyle/문서 JSON에 그대로 남는다', () => {
    const element = bubble();
    element.textPadding = { top: 12, right: 16, bottom: 20, left: 24 };
    element.verticalAlign = 'center';
    element.corners = { topLeft: 10, topRight: 20, bottomRight: 30, bottomLeft: 40 };
    element.spikeSharpness = 80;
    const { id, kind, text, style, locked, hidden, ...appearance } = element;
    void kind;
    void text;
    void locked;
    void hidden;
    expect(BubbleAppearanceSchema.parse(appearance)).toEqual(appearance);
    const saved = SavedStyleSchema.parse({
      kind: 'jjal-style',
      schemaVersion: 1,
      id,
      name: '말풍선',
      createdAt: '2026-10-23T00:00:00Z',
      updatedAt: '2026-10-23T00:00:00Z',
      text: style,
      bubble: appearance,
    });
    expect(saved.bubble).toEqual(appearance);
    const doc = createEditorDocument();
    doc.elements[0] = element;
    expect(parseDocument(JSON.parse(JSON.stringify(doc))).elements[0]).toEqual(element);
  });

  it.each([
    { textPadding: { top: -1, right: 0, bottom: 0, left: 0 } },
    { textPadding: { top: 0, right: 201, bottom: 0, left: 0 } },
    { verticalAlign: 'stretch' },
    { corners: { topLeft: 0, topRight: 0, bottomRight: 51, bottomLeft: 0 } },
    { spikeSharpness: -1 },
    { spikeSharpness: 101 },
    { spikeSharpness: NaN },
  ])('무효한 말풍선 입력 %j를 원본 변경 없이 거부한다', (patch) => {
    const element = bubble(),
      before = structuredClone(element);
    const appearance = {
      shape: element.shape,
      fill: element.fill,
      border: element.border,
      borderWidth: element.borderWidth,
      tail: element.tail,
      ...patch,
    };
    expect(BubbleAppearanceSchema.safeParse(appearance).success).toBe(false);
    expect(element).toEqual(before);
  });
});

describe('개별 모서리와 외침의 뾰족함', () => {
  it.each([
    ['bottom', [10, 20, 30, 40], 161],
    ['top', [30, 40, 10, 20], 161],
    ['left', [20, 30, 40, 10], 197],
    ['right', [40, 10, 20, 30], 197],
  ] as const)(
    '%s 꼬리 회전 후에도 실제 같은 모서리의 둥글기 비율이 보존된다',
    (side, expected, shortSide) => {
      const element = bubble();
      element.text = '';
      element.tail = { x: 0.5, y: 0.5, side };
      element.corners = { topLeft: 10, topRight: 20, bottomRight: 30, bottomLeft: 40 };
      const f = renderBubble(element),
        rounded = f.calls.find((call) => call.operation === 'roundRect')!;
      const radii = rounded.args[4] as number[];
      expected.forEach((percent, index) =>
        expect(radii[index]).toBeCloseTo((shortSide * percent) / 100, 10),
      );
    },
  );

  it.each([undefined, 0, 40, 100])(
    '외침 sharpness %s는 모든 안쪽 꼭짓점의 반경을 함께 조절한다',
    (sharpness) => {
      const element = bubble();
      element.text = '';
      element.shape = 'shout';
      element.tail = null;
      if (sharpness !== undefined) element.spikeSharpness = sharpness;
      const f = renderBubble(element),
        points = f.calls
          .filter((call) => ['moveTo', 'lineTo'].includes(call.operation))
          .slice(0, 28);
      expect(points).toHaveLength(28);
      const radius = 1 - (0.4 * (sharpness ?? 40)) / 100;
      for (let index = 0; index < points.length; index++) {
        const x = (Number(points[index]!.args[0]) - 150) / 148.5;
        const y = (Number(points[index]!.args[1]) - 82) / 80.5;
        expect(Math.hypot(x, y)).toBeCloseTo(index % 2 ? radius : 1, 10);
      }
    },
  );

  it('thought는 개별 모서리 값과 무관하게 구름 윤곽을 유지한다', () => {
    const element = bubble();
    element.shape = 'thought';
    element.tail = null;
    element.corners = { topLeft: 0, topRight: 10, bottomRight: 30, bottomLeft: 50 };
    const f = renderBubble(element);
    expect(f.calls.some((call) => call.operation === 'bezierCurveTo')).toBe(true);
    expect(f.calls.some((call) => call.operation === 'ellipse')).toBe(false);
    expect(f.calls.some((call) => call.operation === 'roundRect')).toBe(false);
    element.corners = { topLeft: 50, topRight: 0, bottomRight: 10, bottomLeft: 30 };
    const outline = (calls: typeof f.calls) =>
      calls.filter((call) => call.operation === 'bezierCurveTo');
    expect(outline(renderBubble(element).calls)).toEqual(outline(f.calls));
  });
});
