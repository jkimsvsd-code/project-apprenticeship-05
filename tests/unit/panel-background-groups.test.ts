import { describe, expect, it } from 'vitest';
import { createBuiltinDocument } from '@jjal/content';
import {
  parseDocument,
  referencedAssetIds,
  type Asset,
  type StudioDocument,
} from '@jjal/document-model';
import { ASPECT_RATIOS } from '@jjal/policies';
import { cloneTemplateDocument, createSavedTemplate, TemplateSchema } from '@jjal/template-kit';
import {
  addElement,
  addImageResource,
  applyStyle,
  backgroundPlacement,
  backgroundValue,
  captureStyle,
  changeBackground,
  changeElementStyle,
  copyElements,
  createEditorDocument,
  deleteElement,
  deleteElements,
  expandElementGroups,
  findPanelBackground,
  groupElements,
  inheritWholeBackground,
  moveElements,
  placeBackground,
  replaceImage,
  restorePanelBackground,
  setBackgroundImage,
  setElementFlags,
  showBackgroundVersion,
  ungroupElements,
} from '@jjal/editor-core';
import { ensurePanelBackgroundLayers } from '../../apps/demo/src/composition/panelBackgrounds';

const asset = (id: string, hash: string): Asset => ({
  id,
  sha256: hash.repeat(64),
  mimeType: 'image/png',
  byteLength: 300,
  pixelWidth: 240,
  pixelHeight: 120,
});
const original = asset('background-original', 'a'),
  result = asset('background-result', 'b'),
  other = asset('background-other', 'c');
function migrated() {
  return ensurePanelBackgroundLayers(createEditorDocument());
}
function layer(doc: StudioDocument, panelId = doc.panels[0]!.id) {
  return findPanelBackground(doc, { panelId })!;
}

describe('컷 배경 레이어 이행과 독립 소유', () => {
  it('legacy 원본/결과와 8비율 crop을 이행하고 bg→frame→콘텐츠 순서·새 기본그룹을 만든다', () => {
    let legacy = setBackgroundImage(createEditorDocument(), { panelId: 'panel-1' }, original);
    legacy = setBackgroundImage(legacy, { panelId: 'panel-1' }, result, true);
    ASPECT_RATIOS.forEach((ratio, index) => {
      legacy = placeBackground(legacy, { panelId: 'panel-1' }, ratio, {
        x: index * 0.1,
        y: -0.1,
        zoom: 1 + index * 0.2,
      });
    });
    const before = structuredClone(legacy),
      doc = ensurePanelBackgroundLayers(legacy),
      background = layer(doc);
    const frame = doc.elements.find((element) => element.kind === 'frame')!;
    expect(doc.layeredPanelBackgrounds).toBe(true);
    expect(background.background).toEqual(before.panels[0]!.background);
    expect(doc.panels[0]!.elementIds.slice(0, 2)).toEqual([background.id, frame.id]);
    expect(background.groupId).toBeTruthy();
    expect(frame.groupId).toBe(background.groupId);
    expect(doc.panels[0]!.background).toEqual({
      color: '#f7f5ef',
      imageAssetId: null,
      fit: 'cover',
    });
    for (const ratio of ASPECT_RATIOS) {
      const panel = doc.layouts.find((layout) => layout.ratio === ratio)!.panels[0]!;
      const stored = panel.elements.find((element) => element.elementId === background.id)!;
      expect(stored.transform).toEqual({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        rotation: 0,
        flipX: false,
        opacity: 1,
      });
      expect(stored.background).toEqual(
        before.layouts.find((layout) => layout.ratio === ratio)!.panels[0]!.background,
      );
      expect(panel.background).toBeUndefined();
    }
    expect(referencedAssetIds(doc)).toEqual(new Set([original.id, result.id]));
    expect(legacy).toEqual(before);
  });

  it('전체 기본배경은 global crop을 유지하고 개별 source/crop은 inherit 해제 시 복원한다', () => {
    let legacy = setBackgroundImage(createEditorDocument(), { panelId: 'panel-1' }, original);
    legacy = placeBackground(legacy, { panelId: 'panel-1' }, '4:5', { x: 0.3, zoom: 1.7 });
    legacy = setBackgroundImage(legacy, 'whole', other);
    let doc = ensurePanelBackgroundLayers(legacy);
    const id = layer(doc).id,
      target = { panelId: 'panel-1', elementId: id };
    expect(layer(doc).background.inherit).toBe(true);
    expect(backgroundValue(doc, target).imageAssetId).toBe(other.id);
    doc = placeBackground(doc, 'whole', '4:5', { x: -0.2, zoom: 2 });
    expect(backgroundPlacement(doc, 'whole', '4:5')).toEqual({ x: -0.2, y: 0, zoom: 2 });
    expect(backgroundPlacement(doc, target, '4:5')).toEqual({ x: 0.3, y: 0, zoom: 1.7 });
    doc = restorePanelBackground(doc, 'panel-1', id);
    expect(backgroundValue(doc, target).imageAssetId).toBe(original.id);
    expect(backgroundPlacement(doc, target, '4:5')).toEqual({ x: 0.3, y: 0, zoom: 1.7 });
    doc = inheritWholeBackground(doc, 'panel-1', id);
    doc = changeBackground(doc, target, { color: '#0047AB' });
    expect(layer(doc).background.inherit).toBe(false);
    expect(backgroundValue(doc, target).imageAssetId).toBe(other.id);
    expect(backgroundPlacement(doc, target, '4:5')).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('복제 배경의 아래 레이어를 지정한 상속/복원은 최상위 배경 대신 지정 ID만 바꾸고 잠금을 지킨다', () => {
    let doc = setBackgroundImage(migrated(), { panelId: 'panel-1' }, original);
    const lower = layer(doc).id;
    doc = setBackgroundImage(doc, 'whole', other);
    doc = restorePanelBackground(doc, 'panel-1', lower);
    const copied = copyElements(doc, [lower], 'panel-1');
    doc = copied.document;
    const upper = copied.elementIds[0]!;
    expect(layer(doc).id).toBe(upper);
    const upperBefore = structuredClone(
      findPanelBackground(doc, { panelId: 'panel-1', elementId: upper }),
    );
    doc = inheritWholeBackground(doc, 'panel-1', lower);
    expect(
      findPanelBackground(doc, { panelId: 'panel-1', elementId: lower })!.background.inherit,
    ).toBe(true);
    expect(findPanelBackground(doc, { panelId: 'panel-1', elementId: upper })).toEqual(upperBefore);
    doc = inheritWholeBackground(doc, 'panel-1', upper);
    const upperInherited = structuredClone(
      findPanelBackground(doc, { panelId: 'panel-1', elementId: upper }),
    );
    doc = restorePanelBackground(doc, 'panel-1', lower);
    expect(
      findPanelBackground(doc, { panelId: 'panel-1', elementId: lower })!.background.inherit,
    ).toBe(false);
    expect(backgroundValue(doc, { panelId: 'panel-1', elementId: lower }).imageAssetId).toBe(
      original.id,
    );
    expect(findPanelBackground(doc, { panelId: 'panel-1', elementId: upper })).toEqual(
      upperInherited,
    );
    const locked = setElementFlags(doc, [lower], { locked: true });
    const before = structuredClone(locked);
    expect(() => inheritWholeBackground(locked, 'panel-1', lower)).toThrow('잠');
    expect(() => restorePanelBackground(locked, 'panel-1', lower)).toThrow('잠');
    expect(locked).toEqual(before);
    // The historical two-argument form still addresses the topmost background.
    expect(
      findPanelBackground(restorePanelBackground(doc, 'panel-1'), {
        panelId: 'panel-1',
        elementId: upper,
      })!.background.inherit,
    ).toBe(false);
  });

  it('삭제/그룹해제 marker는 재접속 이행·읽기에서 복구되지 않고 명시 배경 편집만 새 레이어를 만든다', () => {
    let doc = setBackgroundImage(migrated(), { panelId: 'panel-1' }, original);
    const id = layer(doc).id;
    doc = ungroupElements(doc, [id]);
    expect(doc.elements.every((element) => !element.groupId)).toBe(true);
    expect(ensurePanelBackgroundLayers(doc)).toBe(doc);
    doc = deleteElement(doc, id);
    const before = structuredClone(doc);
    expect(ensurePanelBackgroundLayers(doc)).toBe(doc);
    expect(findPanelBackground(doc, { panelId: 'panel-1' })).toBeUndefined();
    expect(backgroundValue(doc, { panelId: 'panel-1' }).imageAssetId).toBeNull();
    expect(backgroundPlacement(doc, { panelId: 'panel-1' })).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(doc).toEqual(before);
    expect(JSON.stringify(doc)).not.toContain(original.id);
    const recreated = changeBackground(doc, { panelId: 'panel-1' }, { color: '#66C4FF' });
    expect(layer(recreated).id).not.toBe(id);
    expect(layer(recreated).background.color).toBe('#66C4FF');
    expect(layer(recreated).groupId).toBeUndefined();
    expect(layer(recreated).locked).toBe(false);
  });

  it('삭제한 배경의 legacy 잔존 참조도 정리해 원본/결과가 JSON에 남지 않는다', () => {
    let doc = setBackgroundImage(migrated(), { panelId: 'panel-1' }, original);
    doc = setBackgroundImage(doc, { panelId: 'panel-1' }, result, true);
    doc.panels[0]!.background = structuredClone(layer(doc).background);
    doc.layouts[0]!.panels[0]!.background = { x: 0.2, y: 0, zoom: 2 };
    const removed = deleteElement(doc, layer(doc).id);
    expect(removed.assets).toEqual([]);
    expect(JSON.stringify(removed)).not.toContain(original.id);
    expect(JSON.stringify(removed)).not.toContain(result.id);
    expect(removed.layouts[0]!.panels[0]!.background).toBeUndefined();
  });

  it('명시 elementId와 최상위 배경을 구분하고 원본 변경은 해당 layer의 crop만 초기화한다', () => {
    let doc = setBackgroundImage(migrated(), { panelId: 'panel-1' }, original);
    const first = layer(doc).id;
    doc = placeBackground(doc, { panelId: 'panel-1', elementId: first }, '9:16', {
      x: 0.2,
      zoom: 1.4,
    });
    const duplicate = copyElements(doc, [first], 'panel-1'),
      second = duplicate.elementIds[0]!;
    doc = duplicate.document;
    expect(layer(doc).id).toBe(second);
    doc = changeBackground(doc, { panelId: 'panel-1' }, { color: '#0047AB' });
    expect(
      findPanelBackground(doc, { panelId: 'panel-1', elementId: first })!.background.color,
    ).not.toBe('#0047AB');
    doc = setBackgroundImage(doc, { panelId: 'panel-1', elementId: first }, other);
    expect(backgroundPlacement(doc, { panelId: 'panel-1', elementId: first }, '9:16')).toEqual({
      x: 0,
      y: 0,
      zoom: 1,
    });
    expect(backgroundPlacement(doc, { panelId: 'panel-1', elementId: second }, '9:16')).toEqual({
      x: 0.2,
      y: 0,
      zoom: 1.4,
    });
    expect(backgroundValue(doc, { panelId: 'panel-1', elementId: second }).imageAssetId).toBe(
      original.id,
    );
  });

  it('기존 이미지탭 replaceImage도 현재 bg layer를 갱신하고 원본/결과 전환을 보존한다', () => {
    let doc = migrated();
    const id = layer(doc).id;
    doc = replaceImage(doc, original, { panelId: 'panel-1' });
    expect(layer(doc).id).toBe(id);
    expect(layer(doc).background.originalImageAssetId).toBe(original.id);
    doc = setBackgroundImage(doc, { panelId: 'panel-1', elementId: id }, result, true);
    doc = showBackgroundVersion(doc, { panelId: 'panel-1', elementId: id }, 'original');
    expect(layer(doc).background.imageAssetId).toBe(original.id);
    doc = replaceImage(doc, other, { panelId: 'panel-1', elementId: id });
    expect(layer(doc).background.imageAssetId).toBe(other.id);
    expect(layer(doc).background.resultImageAssetId).toBeUndefined();
    expect(doc.assets.map((item) => item.id)).toEqual([other.id]);
  });

  it('잠김·잘못된 대상·좌표는 기존 layer/source/crop을 보존하고 거부한다', () => {
    let doc = setBackgroundImage(migrated(), { panelId: 'panel-1' }, original);
    const id = layer(doc).id;
    doc = setElementFlags(doc, [id], { locked: true });
    const before = structuredClone(doc),
      target = { panelId: 'panel-1', elementId: id };
    for (const operation of [
      () => changeBackground(doc, target, { color: '#0047AB' }),
      () => setBackgroundImage(doc, target, other),
      () => placeBackground(doc, target, '1:1', { x: 0.2 }),
      () => showBackgroundVersion(doc, target, 'original'),
      () => changeBackground(doc, 'whole', { color: '#0047AB' }),
    ])
      expect(operation).toThrow('잠');
    expect(() =>
      changeBackground(doc, { panelId: 'panel-1', elementId: 'line-1' }, { color: '#0047AB' }),
    ).toThrow('배경 레이어');
    expect(doc).toEqual(before);
    const unlocked = setElementFlags(doc, [id], { locked: false });
    expect(() => placeBackground(unlocked, target, '1:1', { zoom: 10 })).toThrow('배경 위치');
    expect(doc).toEqual(before);
  });
});

describe('지속 그룹과 배경 복사', () => {
  it('기본 그룹 확장은 클릭 primary를 보존하고 해제 후 더 이상 확장하지 않는다', () => {
    const doc = migrated(),
      background = layer(doc),
      frame = doc.elements.find((element) => element.kind === 'frame')!;
    expect(expandElementGroups(doc, [frame.id])).toEqual([frame.id, background.id]);
    const ungrouped = ungroupElements(doc, [frame.id]);
    expect(expandElementGroups(ungrouped, [frame.id])).toEqual([frame.id]);
    expect(ensurePanelBackgroundLayers(ungrouped)).toBe(ungrouped);
    const regrouped = groupElements(ungrouped, [frame.id, background.id]);
    expect(regrouped.elements.find((item) => item.id === frame.id)!.groupId).not.toBe(
      frame.groupId,
    );
  });

  it('다른 컷 복사는 새 group/element ID와 모든 비율의 독립 crop/source를 보존한다', () => {
    let doc = ensurePanelBackgroundLayers(createBuiltinDocument('builtin-before-after'));
    const source = doc.panels[0]!.id,
      target = doc.panels[1]!.id,
      bg = layer(doc, source);
    doc = setBackgroundImage(doc, { panelId: source, elementId: bg.id }, original);
    ASPECT_RATIOS.forEach((ratio, index) => {
      doc = placeBackground(doc, { panelId: source, elementId: bg.id }, ratio, {
        x: index * 0.1,
        zoom: 1.2,
      });
    });
    const ids = expandElementGroups(doc, [bg.id]),
      oldGroup = layer(doc, source).groupId;
    const copied = copyElements(doc, ids, target),
      clones = copied.document.elements.filter((item) => copied.elementIds.includes(item.id));
    expect(new Set(clones.map((item) => item.groupId)).size).toBe(1);
    expect(clones[0]!.groupId).toBeTruthy();
    expect(clones[0]!.groupId).not.toBe(oldGroup);
    const clone = clones.find((item) => item.kind === 'panel-background')!;
    for (const ratio of ASPECT_RATIOS)
      expect(
        backgroundPlacement(copied.document, { panelId: target, elementId: clone.id }, ratio),
      ).toEqual(backgroundPlacement(doc, { panelId: source, elementId: bg.id }, ratio));
    const changed = placeBackground(
      copied.document,
      { panelId: target, elementId: clone.id },
      '1:1',
      { x: -0.5 },
    );
    expect(backgroundPlacement(changed, { panelId: source, elementId: bg.id }, '1:1').x).toBe(0);
    expect(backgroundValue(changed, { panelId: target, elementId: clone.id }).imageAssetId).toBe(
      original.id,
    );
  });

  it('그룹 선택의 잠금/이동/삭제는 확장한 ID 전부를 확인하고 원자적으로 적용한다', () => {
    const doc = migrated(),
      ids = expandElementGroups(doc, [layer(doc).id]);
    const moved = moveElements(doc, ids, '1:1', 0.1, 0.1);
    for (const id of ids) {
      const t = moved.layouts[0]!.panels[0]!.elements.find(
        (item) => item.elementId === id,
      )!.transform;
      expect(t.x).toBe(0.1);
      expect(t.y).toBe(0.1);
    }
    const locked = setElementFlags(doc, [ids[1]!], { locked: true }),
      before = structuredClone(locked);
    for (const operation of [
      () => groupElements(locked, [ids[0]!]),
      () => ungroupElements(locked, [ids[0]!]),
      () => moveElements(locked, ids, '1:1', 0.1, 0),
      () => deleteElements(locked, ids),
      () => copyElements(locked, ids, 'panel-1'),
    ])
      expect(operation).toThrow('잠');
    expect(locked).toEqual(before);
    const removed = deleteElements(doc, ids);
    expect(removed.elements.every((item) => !ids.includes(item.id))).toBe(true);
    expect(removed.layeredPanelBackgrounds).toBe(true);
    expect(ensurePanelBackgroundLayers(removed)).toBe(removed);
  });

  it('누락·단일 요소·여러 컷 그룹은 거부하고 원본은 보존한다', () => {
    const doc = ensurePanelBackgroundLayers(createBuiltinDocument('builtin-before-after')),
      before = structuredClone(doc);
    const text = doc.elements.find((item) => item.kind === 'text')!;
    expect(() => groupElements(doc, [text.id])).toThrow('두 개');
    expect(() =>
      groupElements(doc, [layer(doc, doc.panels[0]!.id).id, layer(doc, doc.panels[1]!.id).id]),
    ).toThrow('같은 컷');
    expect(() => expandElementGroups(doc, ['missing'])).toThrow('요소');
    expect(doc).toEqual(before);
  });
});

describe('콘텐츠 한도와 새 말풍선 서식', () => {
  it('4컷의 기존 400 콘텐츠를 줄이지 않고 frame/bg 예약 8개를 더해 문서 408개로 이행한다', () => {
    const seed = createEditorDocument(),
      base = seed.elements[0]!,
      placement = seed.layouts[0]!.panels[0]!.elements[0]!;
    const sourcePanels = Array.from({ length: 4 }, (_, index) => ({
      id: `panel-${index + 1}`,
      elementIds: Array.from({ length: 100 }, (_, item) => `text-${index}-${item}`),
      background: { color: '#F8F9FA', imageAssetId: null, fit: 'cover' as const },
    }));
    seed.panels = sourcePanels;
    seed.elements = sourcePanels.flatMap((panel) =>
      panel.elementIds.map((id) => ({ ...structuredClone(base), id })),
    );
    for (const layout of seed.layouts)
      layout.panels = sourcePanels.map((panel, index) => ({
        panelId: panel.id,
        rect: { x: (index % 2) * 0.5, y: Math.floor(index / 2) * 0.5, width: 0.5, height: 0.5 },
        elements: panel.elementIds.map((id) => ({ ...structuredClone(placement), elementId: id })),
      }));
    const before = structuredClone(seed),
      doc = ensurePanelBackgroundLayers(parseDocument(seed));
    expect(doc.elements).toHaveLength(408);
    expect(doc.panels.every((panel) => panel.elementIds.length === 102)).toBe(true);
    expect(doc.elements.filter((element) => element.kind === 'text')).toHaveLength(400);
    expect(doc.elements.filter((element) => element.kind === 'frame')).toHaveLength(4);
    expect(doc.elements.filter((element) => element.kind === 'panel-background')).toHaveLength(4);
    expect(seed).toEqual(before);
  });

  it('100 콘텐츠+frame+background 102개에서 콘텐츠 추가/복사를 거부하고 예약 배경은 복구한다', () => {
    const seed = createEditorDocument(),
      base = seed.elements[0]!,
      placement = seed.layouts[0]!.panels[0]!.elements[0]!;
    seed.elements = Array.from({ length: 100 }, (_, i) => ({
      ...structuredClone(base),
      id: `text-${i}`,
    }));
    seed.panels[0]!.elementIds = seed.elements.map((item) => item.id);
    for (const layout of seed.layouts)
      layout.panels[0]!.elements = seed.elements.map((item) => ({
        ...structuredClone(placement),
        elementId: item.id,
      }));
    const doc = ensurePanelBackgroundLayers(parseDocument(seed));
    expect(doc.panels[0]!.elementIds).toHaveLength(102);
    expect(() => addElement(doc, 'panel-1', { kind: 'text' })).toThrow('최대 100개');
    expect(() => addImageResource(doc, 'panel-1', original)).toThrow('최대 100개');
    expect(() => copyElements(doc, ['text-0'], 'panel-1')).toThrow('최대 100개');
    const deleted = deleteElement(doc, layer(doc).id);
    const restored = changeBackground(deleted, { panelId: 'panel-1' }, { color: '#0047AB' });
    expect(restored.panels[0]!.elementIds).toHaveLength(102);
    expect(layer(restored).groupId).toBeUndefined();
  });

  it('새 말풍선은 중앙/패딩/모서리/예리함 기본값이고 저장 스타일은 추가 필드를 왕복 보존한다', () => {
    const added = addElement(createEditorDocument(), 'panel-1', { kind: 'bubble', shape: 'shout' }),
      id = added.elementId;
    const bubble = added.document.elements.find((item) => item.id === id)!;
    if (bubble.kind !== 'bubble') throw new Error('test bubble');
    expect(bubble.style.align).toBe('center');
    expect(bubble.verticalAlign).toBe('center');
    expect(bubble.textPadding).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
    expect(bubble.corners).toEqual({ topLeft: 10, topRight: 10, bottomRight: 10, bottomLeft: 10 });
    expect(bubble.spikeSharpness).toBe(40);
    const edited = changeElementStyle(added.document, id, {
      bubble: {
        verticalAlign: 'bottom',
        textPadding: { top: 20, right: 22, bottom: 24, left: 26 },
        corners: { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
        spikeSharpness: 87,
      },
    });
    const saved = captureStyle(edited, id, '말풍선 서식');
    expect(saved.bubble?.spikeSharpness).toBe(87);
    const applied = applyStyle(added.document, id, saved).elements.find((item) => item.id === id)!;
    if (applied.kind !== 'bubble') throw new Error('test bubble');
    expect(applied.textPadding).toEqual(saved.bubble!.textPadding);
    expect(applied.corners).toEqual(saved.bubble!.corners);
    expect(applied.verticalAlign).toBe('bottom');
    expect(applied.spikeSharpness).toBe(87);
  });
});

describe('레이어 배경의 템플릿 새 작품 복사', () => {
  it('JSON 왕복 뒤 원본/결과 asset ID와 group ID를 새로 연결하고 모든 비율 crop은 독립 복제한다', () => {
    let doc = setBackgroundImage(migrated(), { panelId: 'panel-1' }, original);
    const bg = layer(doc);
    doc = setBackgroundImage(doc, { panelId: 'panel-1', elementId: bg.id }, result, true);
    ASPECT_RATIOS.forEach((ratio, index) => {
      doc = placeBackground(doc, { panelId: 'panel-1', elementId: bg.id }, ratio, {
        x: index * 0.1,
        y: -0.2,
        zoom: 1.2,
      });
    });
    doc = showBackgroundVersion(doc, { panelId: 'panel-1', elementId: bg.id }, 'original');
    const snapshot = structuredClone(doc),
      saved = createSavedTemplate('배경 저장', doc);
    const roundtrip = TemplateSchema.parse(JSON.parse(JSON.stringify(saved)));
    const copy = cloneTemplateDocument(roundtrip.document),
      clone = layer(copy);
    const originalAsset = copy.assets.find((item) => item.sha256 === original.sha256)!;
    const resultAsset = copy.assets.find((item) => item.sha256 === result.sha256)!;
    expect(clone.id).not.toBe(bg.id);
    expect(copy.panels[0]!.id).not.toBe('panel-1');
    expect(originalAsset.id).not.toBe(original.id);
    expect(resultAsset.id).not.toBe(result.id);
    expect(clone.background.imageAssetId).toBe(originalAsset.id);
    expect(clone.background.originalImageAssetId).toBe(originalAsset.id);
    expect(clone.background.resultImageAssetId).toBe(resultAsset.id);
    expect(clone.groupId).not.toBe(bg.groupId);
    const peers = expandElementGroups(copy, [clone.id]);
    expect(peers).toHaveLength(2);
    expect(
      copy.elements
        .filter((item) => peers.includes(item.id))
        .every((item) => item.groupId === clone.groupId),
    ).toBe(true);
    expect(referencedAssetIds(copy)).toEqual(new Set(copy.assets.map((item) => item.id)));
    for (const ratio of ASPECT_RATIOS) {
      const nextPlacement = backgroundPlacement(
        copy,
        { panelId: copy.panels[0]!.id, elementId: clone.id },
        ratio,
      );
      const beforePlacement = backgroundPlacement(
        doc,
        { panelId: 'panel-1', elementId: bg.id },
        ratio,
      );
      expect(nextPlacement).toEqual(beforePlacement);
      expect(nextPlacement).not.toBe(beforePlacement);
    }
    const altered = placeBackground(
      copy,
      { panelId: copy.panels[0]!.id, elementId: clone.id },
      '1:1',
      { x: -1 },
    );
    expect(
      backgroundPlacement(altered, { panelId: copy.panels[0]!.id, elementId: clone.id }, '1:1').x,
    ).toBe(-1);
    expect(doc).toEqual(snapshot);
    expect(ensurePanelBackgroundLayers(copy)).toBe(copy);
  });

  it('삭제한 배경과 그룹해제 상태는 JSON 새 작품에서도 되살아나지 않고 원본 바이트 참조가 없다', () => {
    let doc = setBackgroundImage(migrated(), { panelId: 'panel-1' }, original);
    doc = ungroupElements(doc, [layer(doc).id]);
    doc = deleteElement(doc, layer(doc).id);
    const template = createSavedTemplate('삭제 보존', doc);
    const stored = TemplateSchema.parse(JSON.parse(JSON.stringify(template)));
    const copied = cloneTemplateDocument(stored.document);
    expect(findPanelBackground(copied, { panelId: copied.panels[0]!.id })).toBeUndefined();
    expect(ensurePanelBackgroundLayers(copied)).toBe(copied);
    expect(copied.elements.every((item) => !item.groupId)).toBe(true);
    expect(copied.assets).toHaveLength(0);
    expect(JSON.stringify(stored)).not.toContain(original.sha256);
    expect(JSON.stringify(copied)).not.toContain(original.sha256);
  });
});
