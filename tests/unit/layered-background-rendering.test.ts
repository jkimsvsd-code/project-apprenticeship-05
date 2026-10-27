import { describe, expect, it } from 'vitest';
import { createEditorDocument } from '@jjal/editor-core';
import {
  parseDocument,
  referencedAssetIds,
  type Asset,
  type StudioDocument,
} from '@jjal/document-model';
import { canvasSize, ASPECT_RATIOS } from '@jjal/policies';
import { renderDocument } from '@jjal/renderer';
import { recordingCanvas } from './renderer-recording';

const asset = (id: string): Asset => ({
  id,
  mimeType: 'image/png',
  byteLength: 100,
  sha256: id
    .padEnd(64, 'a')
    .slice(0, 64)
    .replace(/[^a-f0-9]/g, 'a'),
  pixelWidth: 200,
  pixelHeight: 100,
});
function layered(): StudioDocument {
  const doc = createEditorDocument();
  doc.layeredPanelBackgrounds = true;
  doc.elements.unshift({
    id: 'panel-bg',
    kind: 'panel-background',
    hidden: false,
    locked: false,
    groupId: 'cut-group',
    background: { color: '#66C4FF', imageAssetId: null, fit: 'contain' },
  });
  doc.panels[0]!.elementIds.unshift('panel-bg');
  for (const layout of doc.layouts)
    layout.panels[0]!.elements.unshift({
      elementId: 'panel-bg',
      transform: { x: 0, y: 0, width: 1, height: 1, rotation: 0, flipX: false, opacity: 1 },
    });
  return parseDocument(doc);
}

describe('명시적인 컷 배경 레이어 렌더링', () => {
  it('marker 없는 문서는 종전 panel.background를 그리고 투명 출력에서는 제외한다', () => {
    const doc = createEditorDocument();
    doc.panels[0]!.background.color = '#E6AB5E';
    const normal = recordingCanvas();
    renderDocument(normal.canvas, doc);
    expect(
      normal.calls.some((call) => call.operation === 'fillRect' && call.fill === '#E6AB5E'),
    ).toBe(true);
    const transparent = recordingCanvas();
    renderDocument(transparent.canvas, doc, { transparent: true });
    expect(transparent.calls.some((call) => call.operation === 'fillRect')).toBe(false);
  });

  it('레이어 순서가 배경 채움과 문구 순서를 정하고 marker는 legacy panel 채움을 중지한다', () => {
    const doc = layered();
    doc.panels[0]!.background.color = '#E6AB5E';
    const before = structuredClone(doc),
      normal = recordingCanvas();
    renderDocument(normal.canvas, doc);
    expect(
      normal.calls.some((call) => call.operation === 'fillRect' && call.fill === '#E6AB5E'),
    ).toBe(false);
    const firstFill = normal.calls.findIndex(
      (call) => call.operation === 'fillRect' && call.fill === '#66C4FF',
    );
    const text = normal.calls.findIndex((call) => call.operation === 'fillText');
    expect(firstFill).toBeLessThan(text);
    doc.panels[0]!.elementIds.reverse();
    const above = recordingCanvas();
    renderDocument(above.canvas, doc);
    expect(
      above.calls.findIndex((call) => call.operation === 'fillRect' && call.fill === '#66C4FF'),
    ).toBeGreaterThan(above.calls.findIndex((call) => call.operation === 'fillText'));
    expect(before.panels[0]!.elementIds).toEqual(['panel-bg', 'line-1']);
  });

  it.each(ASPECT_RATIOS)(
    '%s의 배경 레이어는 독립 transform과 비율별 crop을 공유 논리 픽셀로 그린다',
    (ratio) => {
      const doc = layered();
      doc.activeRatio = ratio;
      const bg = doc.elements.find((element) => element.kind === 'panel-background')!;
      if (bg.kind !== 'panel-background') throw new Error('test background');
      const image = { width: 200, height: 100 } as HTMLCanvasElement;
      doc.assets.push(asset('abc'));
      bg.background.imageAssetId = 'abc';
      const placement = doc.layouts.find((layout) => layout.ratio === ratio)!.panels[0]!
        .elements[0]!;
      Object.assign(placement.transform, {
        x: 0.2,
        y: 0.3,
        width: 0.4,
        height: 0.3,
        rotation: 17,
        flipX: true,
      });
      placement.background = { x: 0.1, y: -0.2, zoom: 1.5 };
      const f = recordingCanvas();
      renderDocument(f.canvas, parseDocument(doc), { images: new Map([['abc', image]]) });
      const painted = f.calls.find(
        (call) => call.operation === 'drawImage' && call.args[0] === image,
      )!;
      const size = canvasSize(ratio),
        width = size.width * 0.4,
        height = size.height * 0.3;
      const scale = Math.min(width / 200, height / 100) * 1.5;
      const expected = [
        (width - 200 * scale) / 2 + 0.1 * width,
        (height - 100 * scale) / 2 - 0.2 * height,
        200 * scale,
        100 * scale,
      ];
      expected.forEach((value, index) => expect(painted.args[index + 1]).toBeCloseTo(value, 10));
      expect(
        f.calls.some(
          (call) => call.operation === 'rotate' && call.args[0] === (17 * Math.PI) / 180,
        ),
      ).toBe(true);
      expect(f.calls.some((call) => call.operation === 'scale' && call.args[0] === -1)).toBe(true);
    },
  );

  it('투명 출력에도 보이는 독립 배경층을 포함하고 숨김 또는 삭제하면 그리지 않는다', () => {
    const doc = layered();
    doc.background = { color: '#000080', imageAssetId: null, fit: 'cover' };
    const visible = recordingCanvas();
    renderDocument(visible.canvas, doc, { transparent: true });
    expect(
      visible.calls.some((call) => call.operation === 'fillRect' && call.fill === '#66C4FF'),
    ).toBe(true);
    expect(
      visible.calls.some((call) => call.operation === 'fillRect' && call.fill === '#000080'),
    ).toBe(false);
    doc.elements[0]!.hidden = true;
    const hidden = recordingCanvas();
    renderDocument(hidden.canvas, doc, { transparent: true });
    expect(hidden.calls.some((call) => call.operation === 'fillRect')).toBe(false);
    doc.elements.shift();
    doc.panels[0]!.elementIds.shift();
    for (const layout of doc.layouts) layout.panels[0]!.elements.shift();
    const deleted = recordingCanvas();
    renderDocument(deleted.canvas, doc);
    expect(
      deleted.calls.some((call) => call.operation === 'fillRect' && call.fill === '#66C4FF'),
    ).toBe(false);
  });

  it('상속 배경층은 기본 배경을 반복 그리지 않고 명시 contour만 그린다', () => {
    const doc = layered(),
      image = { width: 200, height: 100 } as HTMLCanvasElement;
    doc.assets.push(asset('abc'));
    doc.background = { color: '#000080', imageAssetId: 'abc', fit: 'cover' };
    const bg = doc.elements[0]!;
    if (bg.kind !== 'panel-background') throw new Error('test background');
    bg.background.inherit = true;
    bg.contour = { texture: 'pen', color: '#0047AB', width: 8 };
    const normal = recordingCanvas();
    renderDocument(normal.canvas, doc, { images: new Map([['abc', image]]) });
    expect(
      normal.calls.filter((call) => call.operation === 'drawImage' && call.args[0] === image),
    ).toHaveLength(1);
    expect(
      normal.calls.filter((call) => call.operation === 'strokeRect' && call.stroke === '#0047AB'),
    ).toHaveLength(1);
    const transparent = recordingCanvas();
    renderDocument(transparent.canvas, doc, { transparent: true });
    expect(transparent.calls.filter((call) => call.operation === 'fillRect')).toHaveLength(0);
    expect(
      transparent.calls.filter(
        (call) => call.operation === 'strokeRect' && call.stroke === '#0047AB',
      ),
    ).toHaveLength(1);
    bg.hidden = true;
    const hidden = recordingCanvas();
    renderDocument(hidden.canvas, doc, { images: new Map([['abc', image]]) });
    expect(
      hidden.calls.filter((call) => call.operation === 'drawImage' && call.args[0] === image),
    ).toHaveLength(1);
    expect(
      hidden.calls.filter((call) => call.operation === 'strokeRect' && call.stroke === '#0047AB'),
    ).toHaveLength(0);
  });

  it('배경층의 현재·원본·결과 이미지 참조와 group/crop은 JSON에 보존되고 누락된 참조는 거부한다', () => {
    const doc = layered(),
      bg = doc.elements[0]!;
    if (bg.kind !== 'panel-background') throw new Error('test background');
    doc.assets.push(asset('aaa'), asset('bbb'), asset('ccc'));
    bg.background = {
      color: '#F8F9FA',
      imageAssetId: 'bbb',
      originalImageAssetId: 'aaa',
      resultImageAssetId: 'bbb',
      fit: 'cover',
    };
    doc.panels[0]!.background.imageAssetId = 'ccc';
    doc.layouts[0]!.panels[0]!.elements[0]!.background = { x: 0.3, y: -0.2, zoom: 1.7 };
    expect(referencedAssetIds(doc)).toEqual(new Set(['aaa', 'bbb', 'ccc']));
    expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    const broken = structuredClone(doc);
    broken.assets = broken.assets.filter((item) => item.id !== 'aaa');
    expect(() => parseDocument(broken)).toThrow();
    expect(() =>
      parseDocument({
        ...doc,
        elements: doc.elements.map((element) =>
          element.id === bg.id ? { ...element, groupId: 'bad group' } : element,
        ),
      }),
    ).toThrow();
  });
});
