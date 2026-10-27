import { describe, expect, it } from 'vitest';
import { createBuiltinDocument } from '@jjal/content';
import { parseDocument, referencedAssetIds, type Asset } from '@jjal/document-model';
import { ASPECT_RATIOS } from '@jjal/policies';
import {
  backgroundPlacement,
  backgroundValue,
  createEditorDocument,
  findPanelBackground,
  placeBackground,
  setBackgroundImage,
  showBackgroundVersion,
  type BackgroundTarget,
} from '@jjal/editor-core';
import { cloneTemplateDocument, createSavedTemplate, TemplateSchema } from '@jjal/template-kit';
import { ensurePanelBackgroundLayers } from '../../apps/demo/src/composition/panelBackgrounds';

const asset = (id: string, digit: string): Asset => ({
  id,
  sha256: digit.repeat(64),
  mimeType: 'image/png',
  byteLength: 256,
  pixelWidth: 96,
  pixelHeight: 64,
});
const original = asset('version-original-a', 'a'),
  modified = asset('version-modified-b', 'b');

describe('배경 원본과 사용자가 가져온 수정 이미지 전환', () => {
  for (const layered of [false, true])
    for (const whole of [false, true]) {
      it(`${layered ? '명시 레이어' : '기존 컷'} / ${whole ? '작품 전체' : '선택 컷'} A→B→A→B 전환은 8비율 배치와 두 원본 참조를 보존한다`, () => {
        const source = createBuiltinDocument('builtin-before-after');
        let doc = layered ? ensurePanelBackgroundLayers(source) : source;
        const target: BackgroundTarget = whole
          ? 'whole'
          : {
              panelId: doc.panels[0]!.id,
              ...(layered
                ? { elementId: findPanelBackground(doc, { panelId: doc.panels[0]!.id })!.id }
                : {}),
            };
        doc = setBackgroundImage(doc, target, original);
        for (const [index, ratio] of ASPECT_RATIOS.entries())
          doc = placeBackground(doc, target, ratio, {
            x: index / 20,
            y: index === 0 ? 0 : -index / 30,
            zoom: 1 + index / 10,
          });
        const before = structuredClone(doc),
          otherPanel = structuredClone(doc.panels[1]);
        doc = setBackgroundImage(doc, target, modified, true);
        const b = structuredClone(doc);
        for (const version of ['original', 'result', 'original', 'result'] as const) {
          doc = showBackgroundVersion(doc, target, version);
          expect(backgroundValue(doc, target)).toMatchObject({
            imageAssetId: version === 'original' ? original.id : modified.id,
            originalImageAssetId: original.id,
            resultImageAssetId: modified.id,
          });
          for (const ratio of ASPECT_RATIOS)
            expect(backgroundPlacement(doc, target, ratio)).toEqual(
              backgroundPlacement(before, target, ratio),
            );
          expect(referencedAssetIds(doc).has(original.id)).toBe(true);
          expect(referencedAssetIds(doc).has(modified.id)).toBe(true);
          expect(doc.panels[1]).toEqual(otherPanel);
        }
        expect(b.assets.find((asset) => asset.id === original.id)).toEqual(original);
        expect(before.assets.some((asset) => asset.id === modified.id)).toBe(false);
        expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
      });
    }
  it('숨긴 선택 배경 전환은 숨김·잠금·그룹·다른 층을 바꾸지 않고 잠긴 층/전체 편집을 원자적으로 거부한다', () => {
    let doc = ensurePanelBackgroundLayers(createBuiltinDocument('builtin-before-after'));
    const target = {
      panelId: doc.panels[0]!.id,
      elementId: findPanelBackground(doc, { panelId: doc.panels[0]!.id })!.id,
    };
    doc = setBackgroundImage(doc, target, original);
    doc = setBackgroundImage(doc, target, modified, true);
    const layer = findPanelBackground(doc, target)!;
    layer.hidden = true;
    const others = structuredClone(doc.elements.filter((element) => element.id !== layer.id));
    const next = showBackgroundVersion(doc, target, 'original');
    expect(findPanelBackground(next, target)).toMatchObject({
      hidden: true,
      locked: layer.locked,
      groupId: layer.groupId,
      background: { imageAssetId: original.id, resultImageAssetId: modified.id },
    });
    expect(next.elements.filter((element) => element.id !== layer.id)).toEqual(others);
    const locked = structuredClone(doc);
    findPanelBackground(locked, target)!.locked = true;
    const frozen = structuredClone(locked);
    for (const action of [
      () => showBackgroundVersion(locked, target, 'original'),
      () => showBackgroundVersion(locked, 'whole', 'original'),
      () => setBackgroundImage(locked, target, original),
      () => setBackgroundImage(locked, 'whole', modified, true),
    ])
      expect(action).toThrow('잠긴');
    expect(locked).toEqual(frozen);
  });
  it('템플릿 JSON과 새 ID 사본에서 A/B 모두 다시 표시되며 새 원본 선택은 이전 수정본만 해제한다', () => {
    let doc = ensurePanelBackgroundLayers(createEditorDocument());
    const target = {
      panelId: doc.panels[0]!.id,
      elementId: findPanelBackground(doc, { panelId: doc.panels[0]!.id })!.id,
    };
    doc = setBackgroundImage(doc, target, original);
    doc = setBackgroundImage(doc, target, modified, true);
    const stored = TemplateSchema.parse(
      JSON.parse(JSON.stringify(createSavedTemplate('배경 버전', doc))),
    );
    const cloned = cloneTemplateDocument(stored.document);
    const copiedTarget = {
      panelId: cloned.panels[0]!.id,
      elementId: findPanelBackground(cloned, { panelId: cloned.panels[0]!.id })!.id,
    };
    const a = cloned.assets.find((asset) => asset.sha256 === original.sha256)!,
      b = cloned.assets.find((asset) => asset.sha256 === modified.sha256)!;
    expect(a.id).not.toBe(original.id);
    expect(b.id).not.toBe(modified.id);
    expect(
      backgroundValue(showBackgroundVersion(cloned, copiedTarget, 'original'), copiedTarget)
        .imageAssetId,
    ).toBe(a.id);
    expect(
      backgroundValue(showBackgroundVersion(cloned, copiedTarget, 'result'), copiedTarget)
        .imageAssetId,
    ).toBe(b.id);
    const replacement = asset('new-original-c', 'c');
    const replaced = setBackgroundImage(cloned, copiedTarget, replacement);
    expect(backgroundValue(replaced, copiedTarget)).toMatchObject({
      imageAssetId: replacement.id,
      originalImageAssetId: replacement.id,
    });
    expect(backgroundValue(replaced, copiedTarget).resultImageAssetId).toBeUndefined();
    expect(replaced.assets.some((asset) => asset.id === b.id)).toBe(false);
    expect(backgroundValue(cloned, copiedTarget).resultImageAssetId).toBe(b.id);
  });
});
