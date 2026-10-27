import { describe, expect, it } from 'vitest';
import { createBuiltinDocument } from '@jjal/content';
import { parseDocument, type StudioElement } from '@jjal/document-model';
import {
  addElement,
  createEditorDocument,
  newElementDimensions,
  transformElement,
} from '@jjal/editor-core';
import { canvasSize } from '@jjal/policies';
import { renderDocument, renderShapePreview } from '@jjal/renderer';
import { cloneTemplateDocument } from '@jjal/template-kit';
import { recordingCanvas } from './renderer-recording';

const shapes = ['rect', 'ellipse', 'triangle', 'diamond'] as const;
const templates = ['builtin-emotion', 'builtin-before-after', 'builtin-story'] as const;

describe('새 도형의 정규 형태와 기존 작품 보존', () => {
  it.each(shapes)('%s: 1·2·4컷과 8비율에서 실제 경로가 정규 형태다', (shape) => {
    for (const template of templates) {
      const initial = createBuiltinDocument(template);
      const result = addElement(initial, initial.panels.at(-1)!.id, { kind: 'shape', shape });
      const element = result.document.elements.find(
        (item): item is Extract<StudioElement, { kind: 'shape' }> => item.id === result.elementId,
      )!;
      for (const layout of result.document.layouts) {
        const panel = layout.panels.at(-1)!;
        const placement = panel.elements.find((item) => item.elementId === result.elementId)!;
        const size = canvasSize(layout.ratio);
        const width = placement.transform.width * panel.rect.width * size.width;
        const height = placement.transform.height * panel.rect.height * size.height;
        expect(width).toBeGreaterThan(0);
        expect(height).toBeGreaterThan(0);
        expect(placement.transform.x).toBeGreaterThanOrEqual(0);
        expect(placement.transform.y).toBeGreaterThanOrEqual(0);
        expect(placement.transform.x + placement.transform.width).toBeLessThanOrEqual(1);
        expect(placement.transform.y + placement.transform.height).toBeLessThanOrEqual(1);
        const recorder = recordingCanvas();
        renderShapePreview(recorder.canvas, element, width, height);
        if (shape === 'rect') {
          const rect = recorder.calls.find((call) => call.operation === 'rect')!;
          expect(rect.args[2]).toBeCloseTo(rect.args[3] as number, 10);
        } else if (shape === 'ellipse') {
          const ellipse = recorder.calls.find((call) => call.operation === 'ellipse')!;
          expect(ellipse.args[2]).toBeCloseTo(ellipse.args[3] as number, 10);
        } else {
          const vertices = recorder.calls
            .filter((call) => call.operation === 'moveTo' || call.operation === 'lineTo')
            .map((call) => call.args as [number, number]);
          expect(vertices).toHaveLength(shape === 'triangle' ? 3 : 4);
          const lengths = vertices.map(([x, y], index) => {
            const next = vertices[(index + 1) % vertices.length]!;
            return Math.hypot(next[0] - x, next[1] - y);
          });
          lengths.forEach((length) => expect(length).toBeCloseTo(lengths[0]!, 10));
          if (shape === 'diamond') expect(width).toBeCloseTo(height, 10);
        }
      }
    }
  });

  it('기존 납작한 도형은 새 도형 추가·저장·템플릿 사본에서도 치수와 경로를 유지한다', () => {
    const initial = createEditorDocument();
    const first = addElement(initial, initial.panels[0]!.id, { kind: 'shape', shape: 'triangle' });
    const existing = transformElement(first.document, first.elementId, '1:1', {
      x: 0.1,
      y: 0.6,
      width: 0.8,
      height: 0.18,
    });
    const snapshot = structuredClone(existing);
    const beforePaint = recordingCanvas();
    renderDocument(beforePaint.canvas, existing, { ratio: '1:1' });
    const result = addElement(existing, existing.panels[0]!.id, {
      kind: 'shape',
      shape: 'ellipse',
    });
    expect(existing).toEqual(snapshot);
    expect(result.document.elements.slice(0, -1)).toEqual(existing.elements);
    for (const layout of result.document.layouts) {
      const original = existing.layouts.find((item) => item.ratio === layout.ratio)!;
      expect(layout.panels[0]!.elements.slice(0, -1)).toEqual(original.panels[0]!.elements);
    }
    const roundTrip = parseDocument(JSON.parse(JSON.stringify(result.document)));
    expect(roundTrip).toEqual(result.document);
    const copy = cloneTemplateDocument(roundTrip);
    expect(
      copy.layouts.map((layout) => layout.panels[0]!.elements.map((item) => item.transform)),
    ).toEqual(
      roundTrip.layouts.map((layout) => layout.panels[0]!.elements.map((item) => item.transform)),
    );
    const oldOnly = structuredClone(roundTrip);
    oldOnly.elements.pop();
    oldOnly.panels[0]!.elementIds.pop();
    for (const layout of oldOnly.layouts) layout.panels[0]!.elements.pop();
    const afterPaint = recordingCanvas();
    renderDocument(afterPaint.canvas, oldOnly, { ratio: '1:1' });
    // Temporary frame canvases carry distinct function references. Compare their
    // actual dimensions and every recorded paint argument, not object identity.
    const geometry = (recorder: ReturnType<typeof recordingCanvas>) =>
      recorder.calls.map((call) => ({
        ...call,
        args: call.args.map((arg) =>
          arg && typeof arg === 'object' && 'getContext' in arg
            ? { width: (arg as HTMLCanvasElement).width, height: (arg as HTMLCanvasElement).height }
            : arg,
        ),
      }));
    expect(geometry(afterPaint)).toEqual(geometry(beforePaint));
  });

  it('도형 경로보다 작은 컷과 잘못된 치수는 안전하게 거부한다', () => {
    for (const shape of shapes) {
      for (const [width, height] of [
        [0, 100],
        [100, -1],
        [NaN, 100],
        [100, Infinity],
        [4, 100],
      ])
        expect(() => newElementDimensions('shape', width!, height!, shape)).toThrow('크기');
    }
  });
});
