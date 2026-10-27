import { describe, expect, it } from 'vitest';
import { addElement, createEditorDocument } from '@jjal/editor-core';
import type { StudioElement } from '@jjal/document-model';
import { renderDocument, renderBubblePreview, textContentRect } from '@jjal/renderer';
import { recordingCanvas } from './renderer-recording';

const bubble: Extract<StudioElement, { kind: 'bubble' }> = {
  id: 'line-1',
  kind: 'bubble',
  locked: false,
  hidden: false,
  shape: 'speech',
  text: '중앙',
  style: {
    font: { kind: 'builtin', family: 'Noto Sans KR' },
    fontSize: 24,
    color: '#0B0F2B',
    align: 'center',
    lineHeight: 1.4,
    bold: false,
  },
  verticalAlign: 'center',
  textPadding: { top: 2, right: 4, bottom: 6, left: 8 },
  fill: '#FFFFFF',
  border: '#0B0F2B',
  borderWidth: 0,
  tail: null,
  customShape: {
    sourceAssetId: 'source',
    bodyOutline: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0.7, y: 1 },
      { x: 0, y: 0.6 },
    ],
    textRect: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
  },
};
describe('가져온 실루엣과 도형의 공통 렌더링', () => {
  it.each(['rect', 'ellipse', 'triangle', 'diamond'] as const)(
    '%s는 글자 렌더링 없이 채우기와 외곽을 그린다',
    (shape) => {
      const initial = createEditorDocument();
      const added = addElement(initial, initial.panels[0]!.id, { kind: 'shape', shape });
      const doc = added.document;
      doc.elements = doc.elements.filter((item) => item.id === added.elementId);
      doc.panels[0]!.elementIds = [added.elementId];
      for (const layout of doc.layouts)
        layout.panels[0]!.elements = layout.panels[0]!.elements.filter(
          (item) => item.elementId === added.elementId,
        );
      const recorder = recordingCanvas();
      renderDocument(recorder.canvas, doc);
      expect(recorder.calls.filter((call) => call.operation === 'fillText')).toHaveLength(0);
      expect(
        recorder.calls.some((call) => call.operation === 'fill' && call.fill === '#F8F9FA'),
      ).toBe(true);
      expect(
        recorder.calls.some((call) => call.operation === 'stroke' && call.lineWidth === 2),
      ).toBe(true);
      expect(
        recorder.calls.some(
          (call) =>
            call.operation ===
            (shape === 'ellipse' ? 'ellipse' : shape === 'rect' ? 'rect' : 'lineTo'),
        ),
      ).toBe(true);
    },
  );
  it('본체 문구 영역에 독립 여백을 적용하며 꼬리 방향에 따른 본체 위치를 공유한다', () => {
    expect(textContentRect(bubble, 200, 100)).toEqual({ x: 28, y: 22, width: 148, height: 52 });
    const top = { ...bubble, tail: { side: 'top' as const, x: 0.5, y: 0 } };
    const topBox = textContentRect(top, 200, 100);
    expect(topBox.x).toBe(28);
    expect(topBox.y).toBeCloseTo(36.4);
    expect(topBox.width).toBe(148);
    expect(topBox.height).toBeCloseTo(41.2);
    const left = textContentRect({ ...bubble, tail: { side: 'left', x: 0, y: 0.5 } }, 200, 100);
    expect(left.x).toBeCloseTo(60.4);
    expect(left.width).toBeCloseTo(119.2);
  });
  it('꼬리 방향을 바꿔도 원본 본체 윤곽을 회전시키지 않는다', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const doc = createEditorDocument();
      doc.elements[0] = {
        ...bubble,
        tail: {
          side,
          x: side === 'left' ? 0 : side === 'right' ? 1 : 0.5,
          y: side === 'top' ? 0 : side === 'bottom' ? 1 : 0.5,
        },
      };
      const recorder = recordingCanvas();
      renderDocument(recorder.canvas, doc);
      expect(
        recorder.calls.filter((call) => call.operation === 'rotate').map((call) => call.args),
      ).toEqual([[0]]);
      expect(recorder.calls.some((call) => call.operation === 'fillText')).toBe(true);
      expect(
        recorder.calls.filter((call) => call.operation === 'lineTo').length,
      ).toBeGreaterThanOrEqual(5);
    }
  });
  it('가져오기 미리보기는 실제 카드와 같은 본체·꼬리 경로를 그린다', () => {
    const element = { ...bubble, text: '', tail: { side: 'left' as const, x: 0, y: 0.5 } };
    const doc = createEditorDocument();
    doc.elements[0] = element;
    doc.layouts[0]!.panels[0]!.elements[0]!.transform = {
      x: 0,
      y: 0,
      width: 0.5,
      height: 300 / 1080,
      rotation: 0,
      flipX: false,
      opacity: 1,
    };
    const actual = recordingCanvas(),
      preview = recordingCanvas();
    renderDocument(actual.canvas, doc);
    renderBubblePreview(preview.canvas, element, 540, 300);
    const path = (calls: typeof actual.calls) =>
      calls
        .filter((call) => ['moveTo', 'lineTo', 'closePath'].includes(call.operation))
        .map((call) => ({ operation: call.operation, args: call.args }));
    expect(path(preview.calls)).toEqual(path(actual.calls));
    expect([preview.canvas.width, preview.canvas.height]).toEqual([540, 300]);
  });
  it('몸체 윤곽에 여백이 있어도 극단 꼬리 위치를 실제 윤곽에 연결한다', () => {
    const doc = createEditorDocument();
    doc.elements[0] = {
      ...bubble,
      tail: { side: 'bottom', x: 0.99, y: 1 },
      customShape: {
        ...bubble.customShape!,
        bodyOutline: [
          { x: 0.2, y: 0.2 },
          { x: 0.8, y: 0.2 },
          { x: 0.8, y: 0.8 },
          { x: 0.2, y: 0.8 },
        ],
      },
    };
    const recorder = recordingCanvas();
    renderDocument(recorder.canvas, doc);
    // The body uses three line segments; an attached tail adds two and its open seam adds one.
    expect(recorder.calls.filter((call) => call.operation === 'lineTo')).toHaveLength(6);
  });
});
