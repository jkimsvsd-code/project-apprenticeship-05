import {
  BackgroundPlacementSchema,
  referencedAssetIds,
  type Asset,
  type Background,
  type BackgroundPlacement,
  type StudioDocument,
  type StudioElement,
} from '@jjal/document-model';
import { LIMITS, type AspectRatio } from '@jjal/policies';
import { changeDocument } from './index';

export type BackgroundTarget = 'whole' | { panelId: string; elementId?: string };
type BackgroundLayer = Extract<StudioElement, { kind: 'panel-background' }>;
type LayerBackground = BackgroundLayer['background'];
export const DEFAULT_BACKGROUND_PLACEMENT: BackgroundPlacement = { x: 0, y: 0, zoom: 1 };
const neutral = (): Background => ({ color: '#f7f5ef', imageAssetId: null, fit: 'cover' });

/** Read-only lookup: deletion never implicitly recreates a layer. */
export function findPanelBackground(
  doc: StudioDocument,
  target: Exclude<BackgroundTarget, 'whole'>,
) {
  const panel = doc.panels.find((panel) => panel.id === target.panelId);
  if (!panel) throw new Error('배경을 편집할 컷이 없습니다.');
  if (target.elementId !== undefined) {
    const selected = doc.elements.find((element) => element.id === target.elementId);
    if (selected?.kind !== 'panel-background' || !panel.elementIds.includes(selected.id))
      throw new Error('선택한 컷 배경 레이어가 없습니다.');
    return selected;
  }
  for (const id of [...panel.elementIds].reverse()) {
    const element = doc.elements.find((element) => element.id === id);
    if (element?.kind === 'panel-background') return element;
  }
  return undefined;
}

export function backgroundValue(doc: StudioDocument, target: BackgroundTarget): Background {
  if (target === 'whole') return doc.background ?? neutral();
  if (doc.layeredPanelBackgrounds) {
    const layer = findPanelBackground(doc, target);
    return layer?.background.inherit
      ? (doc.background ?? neutral())
      : (layer?.background ?? neutral());
  }
  const panel = doc.panels.find((panel) => panel.id === target.panelId);
  if (!panel) throw new Error('배경을 편집할 컷이 없습니다.');
  return panel.background.inherit ? doc.background! : panel.background;
}

export function backgroundPlacement(
  doc: StudioDocument,
  target: BackgroundTarget,
  ratio = doc.activeRatio,
): BackgroundPlacement {
  const layout = doc.layouts.find((layout) => layout.ratio === ratio);
  if (!layout) throw new Error('배경의 비율 배치가 없습니다.');
  if (target === 'whole') return layout.background ?? DEFAULT_BACKGROUND_PLACEMENT;
  const placed = layout.panels.find((panel) => panel.panelId === target.panelId);
  if (!placed) throw new Error('배경을 편집할 컷이 없습니다.');
  if (doc.layeredPanelBackgrounds) {
    const layer = findPanelBackground(doc, target);
    return layer
      ? (placed.elements.find((item) => item.elementId === layer.id)?.background ??
          DEFAULT_BACKGROUND_PLACEMENT)
      : DEFAULT_BACKGROUND_PLACEMENT;
  }
  return placed.background ?? DEFAULT_BACKGROUND_PLACEMENT;
}

function clearLegacyOwner(doc: StudioDocument, panelId: string) {
  doc.panels.find((panel) => panel.id === panelId)!.background = neutral();
  for (const layout of doc.layouts)
    delete layout.panels.find((panel) => panel.panelId === panelId)!.background;
}

/** Called only by explicit editing commands, never by value/selection/render reads. */
function editableLayer(
  doc: StudioDocument,
  target: Exclude<BackgroundTarget, 'whole'>,
): BackgroundLayer {
  const found = findPanelBackground(doc, target);
  if (found) {
    if (found.locked) throw new Error('잠긴 배경 레이어는 편집할 수 없습니다.');
    clearLegacyOwner(doc, target.panelId);
    return found;
  }
  const panel = doc.panels.find((panel) => panel.id === target.panelId)!;
  if (panel.elementIds.length >= LIMITS.elementsPerPanel + 2 || doc.elements.length >= 408)
    throw new Error('컷 배경을 추가할 예약 공간이 없습니다. 기존 작품은 유지됩니다.');
  const layer: BackgroundLayer = {
    id: `background-${crypto.randomUUID()}`,
    kind: 'panel-background',
    background: neutral(),
    locked: false,
    hidden: false,
  };
  doc.elements.push(layer);
  panel.elementIds.unshift(layer.id);
  for (const layout of doc.layouts)
    layout.panels
      .find((item) => item.panelId === panel.id)!
      .elements.unshift({
        elementId: layer.id,
        transform: { x: 0, y: 0, width: 1, height: 1, rotation: 0, flipX: false, opacity: 1 },
      });
  clearLegacyOwner(doc, panel.id);
  return layer;
}

function resetLayerPlacement(doc: StudioDocument, panelId: string, elementId: string) {
  for (const layout of doc.layouts)
    delete layout.panels
      .find((panel) => panel.panelId === panelId)!
      .elements.find((item) => item.elementId === elementId)!.background;
}

function editableBackground(doc: StudioDocument, target: BackgroundTarget): Background {
  if (target === 'whole') {
    doc.background ??= neutral();
    if (doc.layeredPanelBackgrounds) {
      const layers = doc.elements.filter((element) => element.kind === 'panel-background');
      if (layers.some((element) => element.locked))
        throw new Error('잠긴 배경 레이어가 포함되어 있습니다. 먼저 잠금을 해제해 주세요.');
      for (const layer of layers) layer.background.inherit = true;
    } else for (const panel of doc.panels) panel.background.inherit = true;
    return doc.background;
  }
  if (doc.layeredPanelBackgrounds) {
    const layer = editableLayer(doc, target);
    if (layer.background.inherit) {
      layer.background = { ...structuredClone(doc.background ?? neutral()), inherit: false };
      resetLayerPlacement(doc, target.panelId, layer.id);
    }
    return layer.background;
  }
  const panel = doc.panels.find((panel) => panel.id === target.panelId);
  if (!panel) throw new Error('배경을 편집할 컷이 없습니다.');
  if (panel.background.inherit) {
    panel.background = { ...structuredClone(doc.background!), inherit: false };
    for (const layout of doc.layouts)
      delete layout.panels.find((p) => p.panelId === panel.id)!.background;
  }
  return panel.background;
}

function clean(doc: StudioDocument) {
  const used = referencedAssetIds(doc);
  doc.assets = doc.assets.filter((asset) => used.has(asset.id));
}

export function changeBackground(
  doc: StudioDocument,
  target: BackgroundTarget,
  patch: Partial<Pick<Background, 'color' | 'fit' | 'transparent'>>,
) {
  return changeDocument(doc, (draft) => {
    Object.assign(editableBackground(draft, target), patch);
    clean(draft);
  });
}

export function placeBackground(
  doc: StudioDocument,
  target: BackgroundTarget,
  ratio: AspectRatio,
  patch: Partial<BackgroundPlacement>,
) {
  return changeDocument(doc, (draft) => {
    editableBackground(draft, target);
    const next = BackgroundPlacementSchema.safeParse({
      ...backgroundPlacement(draft, target, ratio),
      ...patch,
    });
    if (!next.success) throw new Error('배경 위치 −200~200%, 확대 10~500% 범위로 입력해 주세요.');
    const layout = draft.layouts.find((layout) => layout.ratio === ratio)!;
    if (target === 'whole') layout.background = next.data;
    else {
      const placed = layout.panels.find((panel) => panel.panelId === target.panelId)!;
      if (draft.layeredPanelBackgrounds) {
        const layer = findPanelBackground(draft, target)!;
        placed.elements.find((item) => item.elementId === layer.id)!.background = next.data;
      } else placed.background = next.data;
    }
    clean(draft);
  });
}

export function setBackgroundImage(
  doc: StudioDocument,
  target: BackgroundTarget,
  asset: Asset,
  result = false,
) {
  return changeDocument(doc, (draft) => {
    const background = editableBackground(draft, target);
    if (result && !background.imageAssetId)
      throw new Error('먼저 원본 배경 이미지를 선택해 주세요.');
    const existing = draft.assets.find((item) => item.id === asset.id);
    if (
      existing &&
      (['mimeType', 'byteLength', 'sha256', 'pixelWidth', 'pixelHeight'] as const).some(
        (key) => existing[key] !== asset[key],
      )
    )
      throw new Error('소재 ID와 이미지 정보가 일치하지 않습니다.');
    if (!existing) draft.assets.push(asset);
    if (result) {
      background.originalImageAssetId ??= background.imageAssetId!;
      background.resultImageAssetId = asset.id;
    } else {
      background.originalImageAssetId = asset.id;
      delete background.resultImageAssetId;
      if (target !== 'whole' && draft.layeredPanelBackgrounds) {
        resetLayerPlacement(draft, target.panelId, findPanelBackground(draft, target)!.id);
      } else
        for (const layout of draft.layouts) {
          if (target === 'whole') delete layout.background;
          else delete layout.panels.find((panel) => panel.panelId === target.panelId)!.background;
        }
    }
    background.imageAssetId = asset.id;
    clean(draft);
  });
}

export function showBackgroundVersion(
  doc: StudioDocument,
  target: BackgroundTarget,
  version: 'original' | 'result',
) {
  return changeDocument(doc, (draft) => {
    const background = editableBackground(draft, target);
    const id =
      version === 'original'
        ? (background.originalImageAssetId ?? background.imageAssetId)
        : background.resultImageAssetId;
    if (!id) throw new Error('선택한 배경 이미지 버전이 없습니다.');
    background.imageAssetId = id;
    clean(draft);
  });
}

export function inheritWholeBackground(doc: StudioDocument, panelId: string, elementId?: string) {
  return changeDocument(doc, (draft) => {
    if (!draft.background) throw new Error('먼저 전체 배경을 설정해 주세요.');
    if (draft.layeredPanelBackgrounds) {
      editableLayer(draft, { panelId, ...(elementId ? { elementId } : {}) }).background.inherit =
        true;
    } else {
      const panel = draft.panels.find((panel) => panel.id === panelId);
      if (!panel) throw new Error('배경을 편집할 컷이 없습니다.');
      panel.background.inherit = true;
    }
    clean(draft);
  });
}

export function restorePanelBackground(doc: StudioDocument, panelId: string, elementId?: string) {
  return changeDocument(doc, (draft) => {
    if (draft.layeredPanelBackgrounds) {
      const background: LayerBackground = editableLayer(draft, {
        panelId,
        ...(elementId ? { elementId } : {}),
      }).background;
      background.inherit = false;
    } else {
      const panel = draft.panels.find((panel) => panel.id === panelId);
      if (!panel) throw new Error('배경을 편집할 컷이 없습니다.');
      panel.background.inherit = false;
    }
    clean(draft);
  });
}
