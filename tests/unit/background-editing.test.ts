import { describe, expect, it } from 'vitest';
import { createBuiltinDocument, createSampleDocument } from '@jjal/content';
import { parseDocument, referencedAssetIds, type Asset } from '@jjal/document-model';
import { ASPECT_RATIOS } from '@jjal/policies';
import {
  backgroundPlacement,
  changeBackground,
  deleteElement,
  inheritWholeBackground,
  restorePanelBackground,
  placeBackground,
  reorderPanel,
  setBackgroundImage,
  showBackgroundVersion,
} from '@jjal/editor-core';
import { cloneTemplateDocument, validateEditorDocument } from '@jjal/template-kit';
import { backgroundImageRect } from '@jjal/renderer';

const asset = (id: string, digit: string): Asset => ({
  id,
  sha256: digit.repeat(64),
  mimeType: 'image/png',
  byteLength: 300,
  pixelWidth: 240,
  pixelHeight: 120,
});
const original = asset('original', 'a'),
  result = asset('result', 'b'),
  other = asset('other', 'c');
describe('배경의 비율별 배치와 원본 보존', () => {
  it('같은 원본 재선택과 전체 적용 뒤 보관된 컷 배경 복원을 허용한다', () => {
    let doc = setBackgroundImage(createSampleDocument(), { panelId: 'panel-1' }, original);
    doc = setBackgroundImage(doc, { panelId: 'panel-1' }, { ...original });
    doc = placeBackground(doc, { panelId: 'panel-1' }, '1:1', { x: 0.3 });
    doc = setBackgroundImage(doc, 'whole', other);
    doc = restorePanelBackground(doc, 'panel-1');
    expect(doc.panels[0]!.background.imageAssetId).toBe('original');
    expect(backgroundPlacement(doc, { panelId: 'panel-1' }).x).toBe(0.3);
    expect(doc.background!.imageAssetId).toBe('other');
  });
  it.each(ASPECT_RATIOS)('%s 위치/확대는 다른 비율·요소를 바꾸지 않는다', (ratio) => {
    const source = createBuiltinDocument('builtin-story');
    let doc = setBackgroundImage(source, 'whole', original);
    const before = structuredClone(doc);
    doc = placeBackground(doc, 'whole', ratio, { x: 0.15, y: -0.2, zoom: 1.8 });
    expect(backgroundPlacement(doc, 'whole', ratio)).toEqual({ x: 0.15, y: -0.2, zoom: 1.8 });
    for (const other of ASPECT_RATIOS.filter((value) => value !== ratio))
      expect(doc.layouts.find((l) => l.ratio === other)).toEqual(
        before.layouts.find((l) => l.ratio === other),
      );
    expect(doc.elements).toEqual(source.elements);
    const target = { panelId: doc.panels[1]!.id };
    doc = placeBackground(doc, target, ratio, { x: -0.1, zoom: 0.5 });
    expect(doc.panels[1]!.background.inherit).toBe(false);
    expect(doc.panels[0]!.background.inherit).toBe(true);
    expect(backgroundPlacement(doc, 'whole', ratio)).toEqual({ x: 0.15, y: -0.2, zoom: 1.8 });
    expect(backgroundPlacement(doc, target, ratio)).toEqual({ x: -0.1, y: 0, zoom: 0.5 });
    expect(source.background).toBeUndefined();
  });
  it('원본/결과 전환과 요소 삭제·템플릿 사본에서 모든 소재 참조를 보존한다', () => {
    let doc = setBackgroundImage(createSampleDocument(), 'whole', original);
    doc = setBackgroundImage(doc, 'whole', result, true);
    doc = placeBackground(doc, 'whole', '1:1', { zoom: 2, x: 0.2 });
    doc = showBackgroundVersion(doc, 'whole', 'original');
    doc = deleteElement(doc, doc.elements[0]!.id);
    expect(doc.assets.map((a) => a.id)).toEqual(['original', 'result']);
    expect(doc.background!.imageAssetId).toBe('original');
    const copy = cloneTemplateDocument(validateEditorDocument(doc));
    expect(copy.background!.originalImageAssetId).not.toBe('original');
    expect(copy.background!.imageAssetId).toBe(copy.background!.originalImageAssetId);
    expect(referencedAssetIds(copy)).toEqual(new Set(copy.assets.map((a) => a.id)));
    const displayed = showBackgroundVersion(copy, 'whole', 'result');
    expect(displayed.background!.imageAssetId).toBe(copy.background!.resultImageAssetId);
    expect(backgroundPlacement(displayed, 'whole')).toEqual({ x: 0.2, y: 0, zoom: 2 });
    expect(doc.assets[0]).toEqual(original);
  });
  it('새 원본은 해당 대상만 초기화하며 다른 컷의 공유 원본은 유지한다', () => {
    let doc = setBackgroundImage(createBuiltinDocument('builtin-before-after'), 'whole', original);
    const target = { panelId: doc.panels[0]!.id };
    doc = changeBackground(doc, target, { fit: 'contain' });
    doc = setBackgroundImage(doc, target, result, true);
    doc = placeBackground(doc, target, '4:5', { x: 0.2 });
    doc = setBackgroundImage(doc, target, other);
    expect(doc.assets.some((a) => a.id === 'result')).toBe(false);
    expect(doc.assets.some((a) => a.id === 'original')).toBe(true);
    expect(backgroundPlacement(doc, target, '4:5')).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(doc.background!.imageAssetId).toBe('original');
    doc = inheritWholeBackground(doc, target.panelId);
    expect(doc.panels[0]!.background.imageAssetId).toBe('other');
    expect(doc.panels[0]!.background.inherit).toBe(true);
  });
  it('컷 교환은 개별 배경 배치를 옮기고 전체 배경은 유지한다', () => {
    let doc = setBackgroundImage(createBuiltinDocument('builtin-before-after'), 'whole', original);
    const id = doc.panels[0]!.id;
    doc = placeBackground(doc, { panelId: id }, '4:5', { x: 0.25, zoom: 2 });
    const moved = reorderPanel(doc, id, 'next');
    expect(moved.panels[1]!.id).toBe(id);
    expect(backgroundPlacement(moved, { panelId: id }, '4:5')).toEqual({ x: 0.25, y: 0, zoom: 2 });
    expect(moved.background).toEqual(doc.background);
  });
  it.each([{ x: NaN }, { x: 2.01 }, { y: -2.01 }, { zoom: 0.09 }, { zoom: 5.01 }])(
    '무효 보정 %j는 전체 문서를 보존한다',
    (patch) => {
      const doc = setBackgroundImage(createSampleDocument(), 'whole', original),
        before = structuredClone(doc);
      expect(() => placeBackground(doc, 'whole', '1:1', patch)).toThrow();
      expect(doc).toEqual(before);
    },
  );
  it('누락 원본·잘못된 컷/색/형식/참조를 저장 전에 거부한다', () => {
    const doc = createSampleDocument(),
      before = structuredClone(doc);
    expect(() => setBackgroundImage(doc, 'whole', result, true)).toThrow('원본');
    expect(() => placeBackground(doc, { panelId: 'absent' }, '1:1', { zoom: 2 })).toThrow();
    expect(() => changeBackground(doc, 'whole', { color: '#bad' })).toThrow();
    expect(() => inheritWholeBackground(doc, doc.panels[0]!.id)).toThrow();
    const bad = setBackgroundImage(doc, 'whole', original);
    bad.background!.resultImageAssetId = 'absent';
    expect(() => parseDocument(bad)).toThrow();
    expect(doc).toEqual(before);
  });
  it('선택 필드가 없는 기존 v1 문서는 기존 중앙 배치를 유지한다', () => {
    const doc = parseDocument(createSampleDocument());
    expect(backgroundPlacement(doc, { panelId: doc.panels[0]!.id })).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
    expect(backgroundImageRect(200, 100, 100, 100, 'cover')).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(
      backgroundImageRect(200, 100, 100, 100, 'contain', { x: 0.1, y: -0.2, zoom: 2 }),
    ).toEqual({ x: -40, y: -20, width: 200, height: 100 });
  });
});
