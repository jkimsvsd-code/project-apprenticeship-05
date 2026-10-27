import { describe, expect, it } from 'vitest';
import { createBuiltinDocument } from '@jjal/content';
import type { Asset, StudioDocument } from '@jjal/document-model';
import {
  addImageResource,
  createEditorDocument,
  reorderElement,
  setElementFlags,
  transformElement,
} from '@jjal/editor-core';
import { ASPECT_RATIOS, type AspectRatio } from '@jjal/policies';

// Independent dimensions for the default 1080-pixel output, including rounded 9:16 axes.
const dimensions: Record<AspectRatio, readonly [number, number]> = {
  '1:1': [1080, 1080],
  '4:5': [864, 1080],
  '3:4': [810, 1080],
  '2:3': [720, 1080],
  '9:16': [608, 1080],
  '4:3': [1080, 810],
  '3:2': [1080, 720],
  '16:9': [1080, 608],
};
const photo: Asset = {
  id: 'resource-photo',
  mimeType: 'image/png',
  byteLength: 1234,
  sha256: 'a'.repeat(64),
  pixelWidth: 1200,
  pixelHeight: 600,
};
function placement(doc: StudioDocument, panelId: string, elementId: string, ratio: AspectRatio) {
  const panel = doc.layouts
    .find((layout) => layout.ratio === ratio)!
    .panels.find((item) => item.panelId === panelId)!;
  return {
    panel,
    transform: panel.elements.find((item) => item.elementId === elementId)!.transform,
  };
}

describe.each([
  ['builtin-emotion', 1],
  ['builtin-before-after', 2],
  ['builtin-story', 4],
] as const)('%s의 %i컷 자원 배치', (templateId, panelCount) => {
  it.each(ASPECT_RATIOS)('%s에서 원본 비율·정확한 컷 좌표·다른 비율의 중앙을 유지한다', (ratio) => {
    for (const [pixelWidth, pixelHeight] of [
      [1200, 600],
      [600, 1200],
      [900, 900],
    ] as const) {
      const doc = createBuiltinDocument(templateId);
      doc.activeRatio = ratio;
      expect(doc.panels).toHaveLength(panelCount);
      const panelId = doc.panels.at(-1)!.id;
      const before = structuredClone(doc);
      const asset = { ...photo, pixelWidth, pixelHeight };
      const point = { x: 0.61, y: 0.39 };
      const result = addImageResource(doc, panelId, asset, point);
      expect(doc).toEqual(before);
      expect(result.document.elements.find((element) => element.id === result.elementId)).toEqual({
        id: result.elementId,
        kind: 'image',
        assetId: result.assetId,
        fit: 'contain',
        locked: false,
        hidden: false,
      });
      expect(result.document.panels.find((panel) => panel.id === panelId)!.elementIds.at(-1)).toBe(
        result.elementId,
      );
      for (const currentRatio of ASPECT_RATIOS) {
        const { panel, transform: t } = placement(
          result.document,
          panelId,
          result.elementId,
          currentRatio,
        );
        const [width, height] = dimensions[currentRatio];
        const actualWidth = t.width * panel.rect.width * width;
        const actualHeight = t.height * panel.rect.height * height;
        expect(actualWidth / actualHeight).toBeCloseTo(pixelWidth / pixelHeight, 10);
        expect(t.width).toBeGreaterThan(0);
        expect(t.height).toBeGreaterThan(0);
        expect(t.width).toBeLessThanOrEqual(0.4500000001);
        expect(t.height).toBeLessThanOrEqual(0.4500000001);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x + t.width).toBeLessThanOrEqual(1);
        expect(t.y + t.height).toBeLessThanOrEqual(1);
        expect(t.x + t.width / 2).toBeCloseTo(currentRatio === ratio ? point.x : 0.5, 10);
        expect(t.y + t.height / 2).toBeCloseTo(currentRatio === ratio ? point.y : 0.5, 10);
        expect(
          result.document.layouts
            .find((layout) => layout.ratio === currentRatio)!
            .panels.filter((item) => item.panelId !== panelId),
        ).toEqual(
          before.layouts
            .find((layout) => layout.ratio === currentRatio)!
            .panels.filter((item) => item.panelId !== panelId),
        );
      }
    }
  });
});

describe('자원 재사용과 원자적 실패', () => {
  it.each([
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [0.01, 0.99],
  ] as const)('가장자리 드롭 (%s, %s)는 이미지 전체가 컷 안에 남도록 제한한다', (x, y) => {
    const doc = createBuiltinDocument('builtin-before-after');
    doc.activeRatio = '9:16';
    const panelId = doc.panels[1]!.id;
    const result = addImageResource(doc, panelId, photo, { x, y });
    const { transform: t } = placement(result.document, panelId, result.elementId, '9:16');
    expect(t.x).toBeCloseTo(x <= 0.01 ? 0 : 1 - t.width, 10);
    expect(t.y).toBeCloseTo(y === 0 ? 0 : 1 - t.height, 10);
  });

  it('위치 없이 추가하면 모든 비율에서 중앙에 배치한다', () => {
    const doc = createEditorDocument();
    const panelId = doc.panels[0]!.id;
    const result = addImageResource(doc, panelId, photo);
    for (const ratio of ASPECT_RATIOS) {
      const { transform: t } = placement(result.document, panelId, result.elementId, ratio);
      expect(t.x + t.width / 2).toBeCloseTo(0.5, 10);
      expect(t.y + t.height / 2).toBeCloseTo(0.5, 10);
    }
  });

  it('5개 이상 독립 이미지 레이어를 만들고 같은 해시는 원본 자산 하나를 공유한다', () => {
    let doc = createEditorDocument();
    const panelId = doc.panels[0]!.id;
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      const result = addImageResource(doc, panelId, { ...photo, id: `photo-alias-${index}` });
      ids.push(result.elementId);
      expect(result.assetId).toBe('photo-alias-0');
      doc = result.document;
    }
    expect(new Set(ids).size).toBe(5);
    expect(doc.assets).toHaveLength(1);
    expect(doc.elements.filter((element) => element.kind === 'image')).toHaveLength(5);
    const before = structuredClone(doc);
    const moved = transformElement(doc, ids[0]!, '1:1', { x: 0.1, y: 0.2, rotation: 30 });
    expect(doc).toEqual(before);
    for (const id of ids.slice(1))
      for (const ratio of ASPECT_RATIOS)
        expect(placement(moved, panelId, id, ratio).transform).toEqual(
          placement(doc, panelId, id, ratio).transform,
        );
  });

  it.each([
    { mimeType: 'image/jpeg' as const },
    { byteLength: 1235 },
    { pixelWidth: 1201 },
    { pixelHeight: 601 },
  ])('같은 해시의 다른 메타데이터 %j는 기존 문서를 보존하며 거부한다', (patch) => {
    const first = addImageResource(createEditorDocument(), 'panel-1', photo).document;
    const before = structuredClone(first);
    expect(() => addImageResource(first, 'panel-1', { ...photo, ...patch })).toThrow('해시');
    expect(first).toEqual(before);
  });

  it('같은 자원 ID의 다른 해시는 원본을 보존하며 거부한다', () => {
    const doc = addImageResource(createEditorDocument(), 'panel-1', photo).document;
    const before = structuredClone(doc);
    expect(() => addImageResource(doc, 'panel-1', { ...photo, sha256: 'b'.repeat(64) })).toThrow(
      'ID',
    );
    expect(doc).toEqual(before);
  });

  it.each([
    { x: NaN, y: 0.5 },
    { x: 0.5, y: Infinity },
    { x: -0.01, y: 0.5 },
    { x: 1.01, y: 0.5 },
    { x: 0.5, y: -0.01 },
    { x: 0.5, y: 1.01 },
  ])('잘못된 드롭 좌표 %j는 문서와 자산을 보존하며 거부한다', (point) => {
    const doc = createEditorDocument();
    const before = structuredClone(doc);
    expect(() => addImageResource(doc, 'panel-1', photo, point)).toThrow('배치 위치');
    expect(doc).toEqual(before);
  });

  it('존재하지 않는 컷과 이미지가 아닌 자원은 기존 문서를 보존하며 거부한다', () => {
    const doc = createEditorDocument();
    const before = structuredClone(doc);
    expect(() => addImageResource(doc, 'missing', photo)).toThrow('컷');
    expect(() =>
      addImageResource(doc, 'panel-1', {
        ...photo,
        mimeType: 'font/ttf',
        pixelWidth: null,
        pixelHeight: null,
      }),
    ).toThrow('이미지');
    expect(doc).toEqual(before);
  });

  it('100번째 요소까지 허용하고 101번째 요소와 새 자산은 추가하지 않는다', () => {
    let doc = createEditorDocument();
    for (let index = 1; index < 100; index++)
      doc = addImageResource(doc, 'panel-1', photo).document;
    expect(doc.panels[0]!.elementIds).toHaveLength(100);
    expect(doc.assets).toHaveLength(1);
    const before = structuredClone(doc);
    expect(() =>
      addImageResource(doc, 'panel-1', {
        ...photo,
        id: 'new-photo',
        sha256: 'c'.repeat(64),
      }),
    ).toThrow('최대 100개');
    expect(doc).toEqual(before);
  });

  it('새 자원을 추가해도 잠긴 기존 레이어의 순서·위치·내용은 유지하고 잠금 명령은 거부한다', () => {
    let doc = createBuiltinDocument('builtin-story');
    const panelId = doc.panels[1]!.id;
    const lockedIds = [...doc.panels[1]!.elementIds];
    doc = setElementFlags(doc, lockedIds, { locked: true });
    const before = structuredClone(doc);
    const result = addImageResource(doc, panelId, photo, { x: 0.7, y: 0.3 });
    expect(doc).toEqual(before);
    expect(result.document.panels[1]!.elementIds.slice(0, lockedIds.length)).toEqual(lockedIds);
    const afterPlacement = structuredClone(result.document);
    for (const id of lockedIds) {
      expect(result.document.elements.find((element) => element.id === id)).toEqual(
        before.elements.find((element) => element.id === id),
      );
      for (const ratio of ASPECT_RATIOS)
        expect(placement(result.document, panelId, id, ratio).transform).toEqual(
          placement(before, panelId, id, ratio).transform,
        );
      expect(() => transformElement(result.document, id, '1:1', { x: 0.1 })).toThrow('잠긴');
      for (const direction of ['front', 'forward', 'backward', 'back'] as const)
        expect(() => reorderElement(result.document, id, direction)).toThrow('잠긴');
    }
    expect(result.document).toEqual(afterPlacement);
    expect(doc).toEqual(before);
  });
});
