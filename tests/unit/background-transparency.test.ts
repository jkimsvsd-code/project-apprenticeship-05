import { describe, expect, it } from 'vitest';
import { ColorSchema, parseDocument, type Asset, type StudioDocument } from '@jjal/document-model';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import {
  backgroundValue,
  changeBackground,
  copyElements,
  createEditorDocument,
  findPanelBackground,
  inheritWholeBackground,
  placeBackground,
  restorePanelBackground,
  setBackgroundImage,
  setElementFlags,
  showBackgroundVersion,
} from '@jjal/editor-core';
import { cloneTemplateDocument } from '@jjal/template-kit';
import { renderDocument } from '@jjal/renderer';
import { ensurePanelBackgroundLayers } from '../../apps/demo/src/composition/panelBackgrounds';
import { recordingCanvas } from './renderer-recording';

const original: Asset = {
  id: 'transparent-original',
  sha256: 'a'.repeat(64),
  mimeType: 'image/png',
  byteLength: 300,
  pixelWidth: 200,
  pixelHeight: 100,
};
const result: Asset = { ...original, id: 'transparent-result', sha256: 'b'.repeat(64) };

function whole() {
  return changeBackground(createEditorDocument(), 'whole', { color: '#123456' });
}
function layered() {
  return ensurePanelBackgroundLayers(whole());
}
function layer(doc: StudioDocument) {
  return findPanelBackground(doc, { panelId: doc.panels[0]!.id })!;
}

describe('편집 배경의 선택적 투명 채움', () => {
  it('과거 v1은 새 필드를 삽입하지 않고 그대로 읽으며 RGB 스키마는 투명 문자열을 받지 않는다', () => {
    const old = whole();
    expect(parseDocument(JSON.parse(JSON.stringify(old)))).toEqual(old);
    expect(Object.hasOwn(old.background!, 'transparent')).toBe(false);
    expect(ColorSchema.safeParse('transparent').success).toBe(false);
    expect(ColorSchema.safeParse('#123456').success).toBe(true);
  });

  it.each([true, false])('전체·컷·레이어의 transparent=%s를 JSON에 보존한다', (transparent) => {
    const doc = layered();
    doc.background!.transparent = transparent;
    doc.panels[0]!.background.transparent = transparent;
    layer(doc).background.transparent = transparent;
    expect(parseDocument(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });

  it.each(['true', 1, null])('잘못된 투명 값 %j는 기존 작품을 바꾸지 않고 거부한다', (value) => {
    const doc = layered();
    const before = structuredClone(doc);
    expect(() => changeBackground(doc, 'whole', { transparent: value as never })).toThrow();
    expect(doc).toEqual(before);
  });

  it('전체 투명 전환은 RGB·원본/보정 이미지·배치를 보존하고 다시 색을 사용할 수 있다', () => {
    let doc = setBackgroundImage(whole(), 'whole', original);
    doc = setBackgroundImage(doc, 'whole', result, true);
    doc = placeBackground(doc, 'whole', '4:5', { x: 0.2, y: -0.1, zoom: 1.7 });
    const before = structuredClone(doc);
    doc = changeBackground(doc, 'whole', { transparent: true });
    expect(doc.background).toEqual({ ...before.background, transparent: true });
    expect(doc.layouts).toEqual(before.layouts);
    expect(doc.assets).toEqual(before.assets);
    doc = showBackgroundVersion(doc, 'whole', 'original');
    expect(doc.background!.transparent).toBe(true);
    expect(doc.background!.imageAssetId).toBe(original.id);
    doc = changeBackground(doc, 'whole', { transparent: false });
    expect(doc.background!.color).toBe('#123456');
    expect(doc.background!.imageAssetId).toBe(original.id);
  });

  it('상속 중인 legacy 컷을 투명하게 바꾸면 해당 컷만 독립하고 복원할 때 투명 설정도 유지한다', () => {
    const source = whole();
    const target = { panelId: source.panels[0]!.id };
    let doc = changeBackground(source, target, { transparent: true });
    expect(doc.background).toEqual(source.background);
    expect(doc.panels[0]!.background).toMatchObject({
      transparent: true,
      inherit: false,
      color: '#123456',
    });
    doc = inheritWholeBackground(doc, target.panelId);
    expect(backgroundValue(doc, target).transparent).toBeUndefined();
    doc = restorePanelBackground(doc, target.panelId);
    expect(backgroundValue(doc, target).transparent).toBe(true);
  });

  it('선택한 배경층만 투명하게 바꾸며 잠긴 층과 원본 문서를 보호한다', () => {
    const source = layered();
    const selected = layer(source);
    const copied = copyElements(source, [selected.id], source.panels[0]!.id);
    const target = { panelId: source.panels[0]!.id, elementId: selected.id };
    const before = structuredClone(copied.document);
    const changed = changeBackground(copied.document, target, { transparent: true });
    expect(backgroundValue(changed, target).transparent).toBe(true);
    expect(changed.elements.find((item) => item.id === copied.elementIds[0])).toEqual(
      before.elements.find((item) => item.id === copied.elementIds[0]),
    );
    expect(copied.document).toEqual(before);
    const locked = setElementFlags(changed, [selected.id], { locked: true });
    expect(() => changeBackground(locked, target, { transparent: false })).toThrow('잠긴');
    expect(backgroundValue(locked, target).transparent).toBe(true);
  });

  it('legacy 이행·템플릿 사본은 투명 값·RGB·8비율 배치를 보존한다', () => {
    let legacy = changeBackground(whole(), { panelId: 'panel-1' }, { transparent: true });
    for (const ratio of ASPECT_RATIOS)
      legacy = placeBackground(legacy, { panelId: 'panel-1' }, ratio, { x: 0.1, zoom: 1.2 });
    const source = structuredClone(legacy);
    const migrated = ensurePanelBackgroundLayers(legacy);
    expect(layer(migrated).background.transparent).toBe(true);
    const copy = cloneTemplateDocument(migrated);
    expect(layer(copy).background).toEqual(layer(migrated).background);
    expect(copy.layouts.map((item) => item.panels[0]!.elements[0]!.background)).toEqual(
      migrated.layouts.map((item) => item.panels[0]!.elements[0]!.background),
    );
    expect(legacy).toEqual(source);
  });
});

describe('투명 배경과 전역 바탕의 공유 렌더링', () => {
  it('전체 색상 없음은 기본 불투명 바탕도 제외하며 이미지는 그대로 그린다', () => {
    let doc = changeBackground(whole(), 'whole', { transparent: true });
    const empty = recordingCanvas();
    renderDocument(empty.canvas, doc);
    expect(empty.calls.filter((call) => call.operation === 'fillRect')).toHaveLength(0);
    expect(empty.calls.some((call) => call.operation === 'fillText')).toBe(true);
    doc = setBackgroundImage(doc, 'whole', original);
    const image = { width: 200, height: 100 } as HTMLCanvasElement;
    const withImage = recordingCanvas();
    renderDocument(withImage.canvas, doc, { images: new Map([[original.id, image]]) });
    expect(withImage.calls.filter((call) => call.operation === 'fillRect')).toHaveLength(0);
    expect(
      withImage.calls.filter((call) => call.operation === 'drawImage' && call.args[0] === image),
    ).toHaveLength(1);
  });

  it.each(ASPECT_RATIOS)('%s legacy 컷의 투명 영역은 전역 바탕만 먼저 비운다', (ratio) => {
    const doc = changeBackground(whole(), { panelId: 'panel-1' }, { transparent: true });
    doc.activeRatio = ratio;
    const f = recordingCanvas();
    renderDocument(f.canvas, doc);
    const placed = doc.layouts.find((item) => item.ratio === ratio)!.panels[0]!;
    const size = canvasSize(ratio);
    const clears = f.calls.filter((call) => call.operation === 'clearRect');
    expect(clears).toHaveLength(1);
    expect(clears[0]!.args).toEqual([
      placed.rect.x * size.width,
      placed.rect.y * size.height,
      placed.rect.width * size.width,
      placed.rect.height * size.height,
    ]);
    expect(f.calls.findIndex((call) => call.operation === 'clearRect')).toBeLessThan(
      f.calls.findIndex((call) => call.operation === 'fillText'),
    );
  });

  it('한 컷만 투명하면 다른 컷의 색을 보존하고 개별 컷 출력도 같은 영역을 비운다', () => {
    const doc = changeBackground(whole(), { panelId: 'panel-1' }, { transparent: true });
    doc.panels.push({
      id: 'panel-2',
      elementIds: [],
      background: { color: '#66C4FF', imageAssetId: null, fit: 'cover' },
    });
    for (const layout of doc.layouts) {
      layout.panels[0]!.rect = { x: 0, y: 0, width: 0.5, height: 1 };
      layout.panels.push({
        panelId: 'panel-2',
        rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
        elements: [],
      });
    }
    const full = recordingCanvas();
    renderDocument(full.canvas, parseDocument(doc));
    expect(
      full.calls.filter((call) => call.operation === 'clearRect').map((call) => call.args),
    ).toEqual([[0, 0, 540, 1080]]);
    expect(
      full.calls.some((call) => call.operation === 'fillRect' && call.fill === '#66C4FF'),
    ).toBe(true);
    const single = recordingCanvas();
    renderDocument(single.canvas, doc, { panelId: 'panel-1' });
    expect([single.canvas.width, single.canvas.height]).toEqual([540, 1080]);
    expect(
      single.calls.filter((call) => call.operation === 'clearRect').map((call) => call.args),
    ).toEqual([[0, 0, 540, 1080]]);
    expect(
      single.calls.some((call) => call.operation === 'fillRect' && call.fill === '#66C4FF'),
    ).toBe(false);
  });

  it('투명 층의 아래에 있는 명시적 배경과 기존 문구는 전역 바탕을 비운 뒤 그대로 그린다', () => {
    const source = layered();
    layer(source).background.inherit = false;
    layer(source).background.color = '#E6AB5E';
    const copied = copyElements(source, [layer(source).id], source.panels[0]!.id);
    const doc = changeBackground(
      copied.document,
      { panelId: source.panels[0]!.id, elementId: copied.elementIds[0]! },
      { transparent: true },
    );
    const f = recordingCanvas();
    renderDocument(f.canvas, doc);
    const clear = f.calls.findIndex((call) => call.operation === 'clearRect');
    expect(clear).toBeGreaterThan(-1);
    expect(clear).toBeLessThan(
      f.calls.findIndex((call) => call.operation === 'fillRect' && call.fill === '#E6AB5E'),
    );
    expect(clear).toBeLessThan(f.calls.findIndex((call) => call.operation === 'fillText'));
    expect(f.calls.filter((call) => call.operation === 'clearRect')).toHaveLength(1);
  });

  it('투명 배경층은 컷 clip·이동·크기·회전·반전에 맞는 전역 바탕만 비운다', () => {
    const doc = layered();
    const bg = layer(doc);
    bg.background.inherit = false;
    bg.background.transparent = true;
    const placed = doc.layouts[0]!.panels[0]!.elements.find((item) => item.elementId === bg.id)!;
    Object.assign(placed.transform, {
      x: 0.2,
      y: 0.3,
      width: 0.4,
      height: 0.5,
      rotation: 90,
      flipX: true,
      flipY: true,
    });
    const f = recordingCanvas();
    renderDocument(f.canvas, parseDocument(doc));
    const clear = f.calls.findIndex((call) => call.operation === 'clearRect');
    expect(f.calls[clear]!.args).toEqual([0, 0, 432, 540]);
    expect(f.calls.slice(0, clear).some((call) => call.operation === 'clip')).toBe(true);
    expect(
      f.calls
        .slice(0, clear)
        .some((call) => call.operation === 'rotate' && call.args[0] === Math.PI / 2),
    ).toBe(true);
    expect(
      f.calls
        .slice(0, clear)
        .some((call) => call.operation === 'scale' && call.args[0] === -1 && call.args[1] === -1),
    ).toBe(true);
    expect(clear).toBeLessThan(f.calls.findIndex((call) => call.operation === 'fillText'));
  });

  it.each(['hidden', 'inherited', 'zero-opacity'] as const)(
    '%s 투명 층은 전역 바탕을 비우지 않는다',
    (mode) => {
      const doc = layered();
      const bg = layer(doc);
      bg.background.transparent = true;
      bg.background.inherit = mode === 'inherited';
      bg.hidden = mode === 'hidden';
      if (mode === 'zero-opacity')
        doc.layouts[0]!.panels[0]!.elements.find(
          (item) => item.elementId === bg.id,
        )!.transform.opacity = 0;
      const f = recordingCanvas();
      renderDocument(f.canvas, doc);
      expect(f.calls.some((call) => call.operation === 'clearRect')).toBe(false);
      expect(f.calls.some((call) => call.operation === 'fillRect' && call.fill === '#123456')).toBe(
        true,
      );
    },
  );

  it('투명 출력도 투명 층의 이미지를 보존하고 전역 바탕이나 색상을 합성하지 않는다', () => {
    let doc = layered();
    const target = { panelId: doc.panels[0]!.id, elementId: layer(doc).id };
    doc = changeBackground(doc, target, { transparent: true });
    doc = setBackgroundImage(doc, target, original);
    const image = { width: 200, height: 100 } as HTMLCanvasElement;
    const f = recordingCanvas();
    renderDocument(f.canvas, doc, { transparent: true, images: new Map([[original.id, image]]) });
    expect(
      f.calls.some((call) => call.operation === 'fillRect' || call.operation === 'clearRect'),
    ).toBe(false);
    expect(f.calls.some((call) => call.operation === 'drawImage' && call.args[0] === image)).toBe(
      true,
    );
    expect(f.calls.some((call) => call.operation === 'fillText')).toBe(true);
  });
});
