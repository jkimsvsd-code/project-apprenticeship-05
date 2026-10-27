export {
  resizeElementFromCorner,
  resizeDocumentElementFromCorner,
  resizeElementFromEdge,
  resizeDocumentElementFromEdge,
  type ResizeCorner,
  type ResizeEdge,
  type ResizeCornerInput,
  type ResizeEdgeInput,
  type ResizeDocumentCornerInput,
} from './resize';
export { EditHistory } from './history';
export { addImageResource } from './resources';
export { expandElementGroups, groupElements, ungroupElements } from './groups';
import {
  parseDocument,
  referencedAssetIds,
  type StudioDocument,
  type Asset,
  type TextStyle,
  type StudioElement,
  type ElementTransform,
  TransformSchema,
  SavedStyleSchema,
  TextStyleSchema,
  BubbleAppearanceSchema,
  type SavedStyle,
  type BubbleAppearance,
  ContourSchema,
  type Contour,
  CustomBubbleResourceSchema,
  type CustomBubbleResource,
  AssetSchema,
} from '@jjal/document-model';
import { createSampleDocument } from '@jjal/content';
import { LIMITS, canvasSize, type AspectRatio } from '@jjal/policies';
import { alignmentPlacement, elementBounds, type Alignment } from './alignment';
import { setBackgroundImage } from './background';
export {
  snapElementPosition,
  elementBounds,
  type Alignment,
  type AlignmentGuide,
} from './alignment';

export function alignElement(
  doc: StudioDocument,
  id: string,
  ratio: AspectRatio,
  alignment: Alignment,
) {
  const { transform, width, height } = alignmentPlacement(doc, id, ratio);
  const b = elementBounds(transform, width, height);
  const offsets = {
    left: { x: transform.x - b.left },
    center: { x: transform.x + 0.5 - b.cx },
    right: { x: transform.x + 1 - b.right },
    top: { y: transform.y - b.top },
    middle: { y: transform.y + 0.5 - b.cy },
    bottom: { y: transform.y + 1 - b.bottom },
  };
  if (!Object.hasOwn(offsets, alignment)) throw new Error('정렬 방향을 확인해 주세요.');
  return transformElement(doc, id, ratio, offsets[alignment]);
}

export function createEditorDocument(): StudioDocument {
  const doc = createSampleDocument();
  doc.id = 'local-card';
  doc.createdAt = doc.updatedAt = new Date().toISOString();
  doc.elements = doc.elements.slice(0, 1);
  if (doc.elements[0]!.kind === 'text') doc.elements[0]!.text = '새 문구';
  doc.panels[0]!.elementIds = ['line-1'];
  for (const layout of doc.layouts) {
    layout.panels[0]!.elements = layout.panels[0]!.elements.slice(0, 1);
    Object.assign(layout.panels[0]!.elements[0]!.transform, {
      x: 0.1,
      y: 0.35,
      width: 0.8,
      height: 0.65,
    });
  }
  return parseDocument(doc);
}

/** Styling is shared across ratios; content, identity and placements are never replaced. */
export function changeElementStyle(
  doc: StudioDocument,
  id: string,
  patch: {
    text?: Partial<TextStyle>;
    bubble?: Partial<BubbleAppearance>;
  },
) {
  const element = editable(doc, id);
  if (element.kind !== 'text' && element.kind !== 'bubble')
    throw new Error('문구 또는 말풍선을 선택해 주세요.');
  if (patch.bubble && element.kind !== 'bubble') throw new Error('말풍선을 선택해 주세요.');
  const text = patch.text ? TextStyleSchema.partial().parse(patch.text) : undefined;
  const bubble = patch.bubble ? BubbleAppearanceSchema.partial().parse(patch.bubble) : undefined;
  return changeDocument(doc, (draft) => {
    const target = draft.elements.find((item) => item.id === id)!;
    if (target.kind !== 'text' && target.kind !== 'bubble') return;
    if (text) Object.assign(target.style, text);
    if (bubble && target.kind === 'bubble') {
      if (Object.hasOwn(bubble, 'shape')) delete target.customShape;
      Object.assign(target, bubble);
    }
  });
}

/** Shared element contours are validated before the immutable candidate is exposed. */
export function changeElementContour(doc: StudioDocument, id: string, patch: Partial<Contour>) {
  const element = editable(doc, id);
  const fallback: Contour =
    element.kind === 'bubble'
      ? { texture: 'pen', color: element.border, width: element.borderWidth }
      : element.kind === 'text'
        ? {
            texture: 'pen',
            color: element.style.outline?.color ?? '#0B0F2B',
            width: element.style.outline?.width ?? 0,
          }
        : { texture: 'pen', color: '#0B0F2B', width: element.kind === 'frame' ? 2 : 0 };
  const contour = ContourSchema.parse({ ...fallback, ...element.contour, ...patch });
  return changeDocument(doc, (draft) => {
    draft.elements.find((item) => item.id === id)!.contour = contour;
  });
}

export function captureStyle(
  doc: StudioDocument,
  id: string,
  name: string,
  previous?: SavedStyle,
): SavedStyle {
  const element = doc.elements.find((item) => item.id === id);
  if (!element || (element.kind !== 'text' && element.kind !== 'bubble'))
    throw new Error('문구 또는 말풍선을 선택해 주세요.');
  const now = new Date().toISOString();
  return SavedStyleSchema.parse({
    kind: 'jjal-style',
    schemaVersion: 1,
    id: previous?.id ?? crypto.randomUUID(),
    name,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    text: structuredClone(element.style),
    ...(element.contour ? { contour: structuredClone(element.contour) } : {}),
    ...(element.kind === 'bubble'
      ? {
          bubble: Object.fromEntries(
            Object.keys(BubbleAppearanceSchema.shape)
              .filter((key) => Object.hasOwn(element, key))
              .map((key) => [
                key,
                structuredClone((element as unknown as Record<string, unknown>)[key]),
              ]),
          ),
        }
      : {}),
  });
}

export function applyStyle(doc: StudioDocument, id: string, input: SavedStyle) {
  const style = SavedStyleSchema.parse(input);
  const element = editable(doc, id);
  if (element.kind !== 'text' && element.kind !== 'bubble')
    throw new Error('문구 또는 말풍선을 선택해 주세요.');
  return changeDocument(doc, (draft) => {
    const target = draft.elements.find((item) => item.id === id)!;
    if (target.kind !== 'text' && target.kind !== 'bubble') return;
    target.style = structuredClone(style.text);
    if (style.contour) target.contour = structuredClone(style.contour);
    else delete target.contour;
    if (target.kind === 'bubble' && style.bubble) {
      for (const key of Object.keys(BubbleAppearanceSchema.shape))
        delete (target as unknown as Record<string, unknown>)[key];
      Object.assign(target, structuredClone(style.bubble));
    }
  });
}

/** 후보 복사본 전체가 유효한 경우에만 호출자가 채택한다. 원본은 항상 불변. */
export function changeDocument(doc: StudioDocument, change: (draft: StudioDocument) => void) {
  const draft = structuredClone(doc);
  change(draft);
  draft.updatedAt = new Date().toISOString();
  return parseDocument(draft);
}

export function changeCaption(
  doc: StudioDocument,
  patch: {
    text?: string;
    fontSize?: number;
    color?: string;
    x?: number;
    y?: number;
    width?: number;
    fontFamily?: Extract<TextStyle['font'], { kind: 'builtin' }>['family'];
  },
  ratio: AspectRatio,
  elementId = doc.elements[0]?.id,
) {
  if (elementId) editable(doc, elementId);
  if (patch.text !== undefined && [...patch.text].length > LIMITS.textCodePoints)
    throw new Error('문구는 1,000자 이하로 입력해 주세요. 기존 문구는 유지됩니다.');
  for (const key of ['x', 'y', 'width'] as const) {
    const value = patch[key];
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value < (key === 'width' ? 0.1 : 0) || value > 1)
    )
      throw new Error('위치는 0~100%, 문구 폭은 10~100%로 입력해 주세요.');
  }
  return changeDocument(doc, (draft) => {
    const element = draft.elements.find((item) => item.id === elementId);
    if (!element || (element.kind !== 'text' && element.kind !== 'bubble'))
      throw new Error('편집할 문구가 없습니다.');
    if (patch.text !== undefined) element.text = patch.text;
    if (patch.fontSize !== undefined) element.style.fontSize = patch.fontSize;
    if (patch.color !== undefined) element.style.color = patch.color;
    if (patch.fontFamily !== undefined)
      element.style.font = { kind: 'builtin', family: patch.fontFamily };
    const transform = draft.layouts
      .find((l) => l.ratio === ratio)
      ?.panels.flatMap((panel) => panel.elements)
      .find((item) => item.elementId === element.id)?.transform;
    if (!transform) throw new Error('문구 배치를 찾을 수 없습니다.');
    for (const key of ['x', 'y', 'width'] as const)
      if (patch[key] !== undefined) transform[key] = patch[key];
  });
}

export function replaceBackground(doc: StudioDocument, asset: Asset) {
  return replaceImage(doc, asset, { panelId: doc.panels[0]!.id });
}

export function replaceImage(
  doc: StudioDocument,
  asset: Asset,
  target: { panelId: string; elementId?: string },
) {
  if (
    doc.layeredPanelBackgrounds &&
    (!target.elementId ||
      doc.elements.find((element) => element.id === target.elementId)?.kind === 'panel-background')
  )
    return setBackgroundImage(doc, target, asset);
  if (target.elementId) editable(doc, target.elementId);
  return changeDocument(doc, (draft) => {
    const panel = draft.panels.find((item) => item.id === target.panelId);
    if (!panel) throw new Error('이미지를 넣을 컷이 없습니다.');
    if (target.elementId) {
      const element = draft.elements.find(
        (item) => item.id === target.elementId && panel.elementIds.includes(item.id),
      );
      if (!element || !('assetId' in element)) throw new Error('교체할 이미지 요소가 없습니다.');
      element.assetId = asset.id;
    } else {
      panel.background.imageAssetId = asset.id;
      panel.background.originalImageAssetId = asset.id;
      delete panel.background.resultImageAssetId;
      panel.background.inherit = false;
      for (const layout of draft.layouts)
        delete layout.panels.find((p) => p.panelId === panel.id)!.background;
    }
    if (!draft.assets.some((item) => item.id === asset.id)) draft.assets.push(asset);
    const used = referencedAssetIds(draft);
    draft.assets = draft.assets.filter((item) => used.has(item.id));
  });
}

export type NewElement =
  | { kind: 'text' }
  | { kind: 'frame' }
  | { kind: 'shape'; shape: Extract<StudioElement, { kind: 'shape' }>['shape'] }
  | { kind: 'bubble'; shape: Extract<StudioElement, { kind: 'bubble' }>['shape'] }
  | { kind: 'character'; asset: Asset; characterId: string };

/** Normalized initial bounds, shared by insertion and its visual picker. */
export function newElementDimensions(
  kind: NewElement['kind'],
  panelWidth: number,
  panelHeight: number,
  shape: Extract<StudioElement, { kind: 'shape' }>['shape'] = 'rect',
) {
  if (![panelWidth, panelHeight].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('요소를 추가할 컷의 크기를 확인해 주세요.');
  const side = Math.min(panelWidth * 0.55, panelHeight * 0.5);
  if (kind === 'shape') {
    // Preserve the renderer and every existing placement. Its symmetric stroke
    // inset is included in the new triangle's bounds so the painted three sides,
    // rather than only the surrounding box, form an equilateral triangle.
    const inset = shapeAppearance(shape).contour.width / 2 + 0.5;
    if (side <= inset * 2) throw new Error('도형을 추가할 컷의 크기를 확인해 주세요.');
    const height =
      shape === 'triangle' ? (side - inset * 2) * (Math.sqrt(3) / 2) + inset * 2 : side;
    return { width: side / panelWidth, height: height / panelHeight };
  }
  return {
    width: kind === 'frame' ? 1 : kind === 'character' ? side / panelWidth : 0.8,
    height:
      kind === 'frame'
        ? 1
        : kind === 'character'
          ? side / panelHeight
          : Math.min(0.7, Math.max(kind === 'bubble' ? 0.3 : 0.18, 100 / panelHeight)),
  };
}

/** Default ink is shared by the added shape and the shape picker. */
export function shapeAppearance(shape: Extract<StudioElement, { kind: 'shape' }>['shape']): Pick<
  Extract<StudioElement, { kind: 'shape' }>,
  'kind' | 'shape' | 'fill'
> & {
  contour: Contour;
} {
  return {
    kind: 'shape',
    shape,
    fill: '#F8F9FA',
    contour: { texture: 'pen', color: '#0B0F2B', width: 2 },
  };
}

/** Content/order is shared; every stored ratio receives its own initial placement. */
export function addElement(doc: StudioDocument, panelId: string, input: NewElement) {
  const id = `element-${crypto.randomUUID()}`;
  const document = changeDocument(doc, (draft) => {
    const panel = draft.panels.find((item) => item.id === panelId);
    if (!panel) throw new Error('요소를 추가할 컷이 없습니다.');
    if (
      panel.elementIds.length >= LIMITS.elementsPerPanel + 2 ||
      (input.kind !== 'frame' &&
        panel.elementIds.filter((id) => {
          const kind = draft.elements.find((element) => element.id === id)?.kind;
          return kind !== 'frame' && kind !== 'panel-background';
        }).length >= LIMITS.elementsPerPanel)
    )
      throw new Error(
        '컷당 콘텐츠는 최대 100개, 테두리·배경 예약 공간을 포함한 전체 요소는 최대 102개입니다. 기존 작업은 유지됩니다.',
      );
    if (
      input.kind === 'character' &&
      panel.elementIds.filter(
        (key) => draft.elements.find((element) => element.id === key)?.kind === 'character',
      ).length >= LIMITS.charactersPerPanel
    )
      throw new Error('컷당 캐릭터는 최대 4개입니다. 기존 작업은 유지됩니다.');
    const style: TextStyle = {
      font: { kind: 'builtin', family: 'Noto Sans KR' },
      fontSize: 28,
      color: '#29473d',
      align: 'center',
      lineHeight: 1.25,
      bold: false,
    };
    const base = { id, locked: false, hidden: false };
    let element: StudioElement;
    if (input.kind === 'character') {
      const existing = draft.assets.find((asset) => asset.id === input.asset.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(input.asset))
        throw new Error('동일한 소재 ID의 내용이 다릅니다.');
      if (!existing) draft.assets.push(input.asset);
      element = {
        ...base,
        kind: 'character',
        assetId: input.asset.id,
        characterId: input.characterId,
        anchor: { x: 0.5, y: 0.5 },
      };
    } else if (input.kind === 'bubble') {
      element = {
        ...base,
        kind: 'bubble',
        shape: input.shape,
        text: '새 대사',
        style,
        fill: '#fffdf6',
        border: '#536a52',
        borderWidth: 2,
        tail: input.shape === 'caption' ? null : { x: 0.5, y: 1 },
        verticalAlign: 'center',
        textPadding: { top: 12, right: 12, bottom: 12, left: 12 },
        corners: { topLeft: 10, topRight: 10, bottomRight: 10, bottomLeft: 10 },
        spikeSharpness: 40,
      };
    } else if (input.kind === 'shape') {
      element = { ...base, ...shapeAppearance(input.shape) };
    } else if (input.kind === 'frame') {
      element = { ...base, kind: 'frame', contour: { texture: 'pen', color: '#0B0F2B', width: 2 } };
      draft.frameLayers = true;
    } else element = { ...base, kind: 'text', text: '새 문구', style };
    const offset = (panel.elementIds.length % 4) * 0.035;
    panel.elementIds.push(id);
    draft.elements.push(element);
    for (const layout of draft.layouts) {
      const placed = layout.panels.find((item) => item.panelId === panelId)!;
      const size = canvasSize(layout.ratio);
      const pw = placed.rect.width * size.width,
        ph = placed.rect.height * size.height;
      const { width, height } = newElementDimensions(
        input.kind,
        pw,
        ph,
        input.kind === 'shape' ? input.shape : undefined,
      );
      placed.elements.push({
        elementId: id,
        transform: {
          x: input.kind === 'frame' ? 0 : (1 - width) / 2 + offset,
          y: input.kind === 'frame' ? 0 : (1 - height) / 2 + offset,
          width,
          height,
          rotation: 0,
          flipX: false,
          opacity: 1,
        },
      });
    }
  });
  return { document, elementId: id };
}

/** A vector bubble keeps its PNG as a referenced original, not as its painted body. */
export function addCustomBubble(
  doc: StudioDocument,
  panelId: string,
  asset: Asset,
  input: CustomBubbleResource,
) {
  asset = AssetSchema.parse(asset);
  const imported = CustomBubbleResourceSchema.parse(input);
  if (asset.mimeType !== 'image/png' || imported.customShape.sourceAssetId !== asset.id)
    throw new Error('말풍선 PNG 원본 참조가 올바르지 않습니다.');
  const added = addElement(doc, panelId, { kind: 'bubble', shape: 'speech' });
  const document = changeDocument(added.document, (draft) => {
    const existing = draft.assets.find((item) => item.id === asset.id);
    const same = draft.assets.find((item) => item.sha256 === asset.sha256);
    const different = (left: Asset, right: Asset) =>
      (['mimeType', 'byteLength', 'sha256', 'pixelWidth', 'pixelHeight'] as const).some(
        (key) => left[key] !== right[key],
      );
    if ((existing && different(existing, asset)) || (same && different(same, asset)))
      throw new Error('동일한 원본 소재 ID의 내용이 다릅니다.');
    const stored = existing ?? same ?? asset;
    if (!existing && !same) draft.assets.push(structuredClone(asset));
    const element = draft.elements.find((item) => item.id === added.elementId)!;
    if (element.kind === 'bubble')
      Object.assign(
        element,
        structuredClone({
          ...imported,
          customShape: { ...imported.customShape, sourceAssetId: stored.id },
        }),
      );
  });
  return { document, elementId: added.elementId };
}

function editable(doc: StudioDocument, id: string) {
  const element = doc.elements.find((item) => item.id === id);
  if (!element) throw new Error('편집할 요소가 없습니다.');
  if (element.locked) throw new Error('잠긴 요소는 편집할 수 없습니다.');
  return element;
}

export function transformElement(
  doc: StudioDocument,
  id: string,
  ratio: AspectRatio,
  patch: Partial<ElementTransform>,
) {
  editable(doc, id);
  return changeDocument(doc, (draft) => {
    const placement = draft.layouts
      .find((layout) => layout.ratio === ratio)
      ?.panels.flatMap((panel) => panel.elements)
      .find((item) => item.elementId === id);
    if (!placement) throw new Error('현재 비율의 요소 배치가 없습니다.');
    const result = TransformSchema.safeParse({ ...placement.transform, ...patch });
    if (!result.success)
      throw new Error('위치 −200~300%, 크기 0 초과~400%, 회전 −360~360° 범위로 입력해 주세요.');
    placement.transform = result.data;
  });
}

export function deleteElement(doc: StudioDocument, id: string) {
  const removed = editable(doc, id);
  return changeDocument(doc, (draft) => {
    draft.elements = draft.elements.filter((element) => element.id !== id);
    for (const panel of draft.panels)
      panel.elementIds = panel.elementIds.filter((key) => key !== id);
    for (const layout of draft.layouts)
      for (const panel of layout.panels)
        panel.elements = panel.elements.filter((item) => item.elementId !== id);
    if (removed.kind === 'panel-background' && draft.layeredPanelBackgrounds) {
      const owner = doc.panels.find((panel) => panel.elementIds.includes(id))!;
      draft.panels.find((panel) => panel.id === owner.id)!.background = {
        color: '#f7f5ef',
        imageAssetId: null,
        fit: 'cover',
      };
      for (const layout of draft.layouts)
        delete layout.panels.find((panel) => panel.panelId === owner.id)!.background;
    }
    const groupCounts = new Map<string, number>();
    for (const element of draft.elements)
      if (element.groupId)
        groupCounts.set(element.groupId, (groupCounts.get(element.groupId) ?? 0) + 1);
    for (const element of draft.elements)
      if (element.groupId && groupCounts.get(element.groupId) === 1) delete element.groupId;
    const used = referencedAssetIds(draft);
    draft.assets = draft.assets.filter((asset) => used.has(asset.id));
  });
}

export function reorderElement(
  doc: StudioDocument,
  id: string,
  direction: 'forward' | 'backward' | 'front' | 'back',
) {
  editable(doc, id);
  return changeDocument(doc, (draft) => {
    const panel = draft.panels.find((item) => item.elementIds.includes(id))!;
    const from = panel.elementIds.indexOf(id);
    const to =
      direction === 'front'
        ? panel.elementIds.length - 1
        : direction === 'back'
          ? 0
          : Math.max(
              0,
              Math.min(panel.elementIds.length - 1, from + (direction === 'forward' ? 1 : -1)),
            );
    panel.elementIds.splice(from, 1);
    panel.elementIds.splice(to, 0, id);
  });
}

/** Hit tests use the renderer's pixel coordinate space, inverse rotation and panel clipping. */
export function hitTestElement(
  doc: StudioDocument,
  x: number,
  y: number,
  options: { includeLocked?: boolean } = {},
) {
  const size = canvasSize(doc.activeRatio);
  const layout = doc.layouts.find((item) => item.ratio === doc.activeRatio)!;
  for (const placed of [...layout.panels].reverse()) {
    const rect = placed.rect;
    if (x < rect.x || y < rect.y || x > rect.x + rect.width || y > rect.y + rect.height) continue;
    const panel = doc.panels.find((item) => item.id === placed.panelId)!;
    const pw = rect.width * size.width,
      ph = rect.height * size.height;
    for (const id of [...panel.elementIds].reverse()) {
      const element = doc.elements.find((item) => item.id === id)!;
      const t = placed.elements.find((item) => item.elementId === id)!.transform;
      if (element.hidden || (element.locked && !options.includeLocked) || t.opacity === 0) continue;
      const dx = (x - rect.x) * size.width - (t.x + t.width / 2) * pw;
      const dy = (y - rect.y) * size.height - (t.y + t.height / 2) * ph;
      const angle = (-t.rotation * Math.PI) / 180;
      const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
      const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
      if (element.kind === 'frame') {
        const stroke = element.contour?.width ?? 2;
        if (stroke === 0) continue;
        const halfWidth = (t.width * pw) / 2,
          halfHeight = (t.height * ph) / 2;
        const band = Math.max(10, stroke / 2 + 4);
        if (
          Math.abs(localX) <= halfWidth &&
          Math.abs(localY) <= halfHeight &&
          (halfWidth - Math.abs(localX) <= band || halfHeight - Math.abs(localY) <= band)
        )
          return { elementId: id, panelId: panel.id };
        continue;
      }
      if (Math.abs(localX) <= (t.width * pw) / 2 && Math.abs(localY) <= (t.height * ph) / 2)
        return { elementId: id, panelId: panel.id };
    }
  }
  return null;
}

function selection(doc: StudioDocument, ids: readonly string[], allowLocked = false) {
  if (!ids.length || new Set(ids).size !== ids.length)
    throw new Error('같은 컷의 요소를 중복 없이 선택해 주세요.');
  const elements = ids.map((id) => {
    const element = doc.elements.find((item) => item.id === id);
    if (!element) throw new Error('선택한 요소가 없습니다.');
    if (!allowLocked && element.locked)
      throw new Error('잠긴 요소가 포함되어 있습니다. 먼저 잠금을 해제해 주세요.');
    return element;
  });
  const panel = doc.panels.find((item) => item.elementIds.includes(ids[0]!))!;
  if (!ids.every((id) => panel.elementIds.includes(id)))
    throw new Error('같은 컷의 요소만 함께 편집할 수 있습니다.');
  return { elements, panel };
}

/** Layer management can unlock/show a locked element; content edits cannot. */
export function setElementFlags(
  doc: StudioDocument,
  ids: readonly string[],
  patch: { locked?: boolean; hidden?: boolean },
) {
  selection(doc, ids, true);
  if (
    !Object.keys(patch).length ||
    Object.entries(patch).some(
      ([key, value]) => !['locked', 'hidden'].includes(key) || typeof value !== 'boolean',
    )
  )
    throw new Error('잠금과 표시 상태만 변경할 수 있습니다.');
  return changeDocument(doc, (draft) => {
    for (const element of draft.elements)
      if (ids.includes(element.id)) Object.assign(element, patch);
  });
}

export function moveElements(
  doc: StudioDocument,
  ids: readonly string[],
  ratio: AspectRatio,
  dx: number,
  dy: number,
) {
  const { panel } = selection(doc, ids);
  if (![dx, dy].every(Number.isFinite)) throw new Error('이동 거리를 확인해 주세요.');
  return changeDocument(doc, (draft) => {
    const placed = draft.layouts
      .find((item) => item.ratio === ratio)
      ?.panels.find((item) => item.panelId === panel.id);
    if (!placed) throw new Error('현재 비율의 배치가 없습니다.');
    for (const item of placed.elements)
      if (ids.includes(item.elementId)) {
        item.transform.x += dx;
        item.transform.y += dy;
      }
  });
}

export function scaleElements(
  doc: StudioDocument,
  ids: readonly string[],
  ratio: AspectRatio,
  factor: number,
) {
  const { panel } = selection(doc, ids);
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error('배율은 0보다 큰 수로 입력해 주세요.');
  const placed = doc.layouts
    .find((item) => item.ratio === ratio)
    ?.panels.find((item) => item.panelId === panel.id);
  if (!placed) throw new Error('현재 비율의 배치가 없습니다.');
  const size = canvasSize(ratio);
  const boxes = placed.elements
    .filter((item) => ids.includes(item.elementId))
    .map((item) =>
      elementBounds(
        item.transform,
        size.width * placed.rect.width,
        size.height * placed.rect.height,
      ),
    );
  const cx = (Math.min(...boxes.map((b) => b.left)) + Math.max(...boxes.map((b) => b.right))) / 2;
  const cy = (Math.min(...boxes.map((b) => b.top)) + Math.max(...boxes.map((b) => b.bottom))) / 2;
  return changeDocument(doc, (draft) => {
    const target = draft.layouts
      .find((item) => item.ratio === ratio)!
      .panels.find((item) => item.panelId === panel.id)!;
    for (const item of target.elements)
      if (ids.includes(item.elementId)) {
        const t = item.transform;
        const centerX = cx + (t.x + t.width / 2 - cx) * factor;
        const centerY = cy + (t.y + t.height / 2 - cy) * factor;
        t.width *= factor;
        t.height *= factor;
        t.x = centerX - t.width / 2;
        t.y = centerY - t.height / 2;
      }
  });
}

export function deleteElements(doc: StudioDocument, ids: readonly string[]) {
  selection(doc, ids);
  // Existing deletion handles asset references; no intermediate document is exposed.
  return ids.reduce((current, id) => deleteElement(current, id), doc);
}

export function copyElements(doc: StudioDocument, ids: readonly string[], targetPanelId: string) {
  const { panel: source } = selection(doc, ids);
  const target = doc.panels.find((item) => item.id === targetPanelId);
  if (!target) throw new Error('복사할 컷이 없습니다.');
  const ordered = source.elementIds.filter((id) => ids.includes(id));
  const elements = ordered.map((id) => doc.elements.find((item) => item.id === id)!);
  if (
    target.elementIds.length + elements.length > LIMITS.elementsPerPanel + 2 ||
    target.elementIds.filter((id) => {
      const kind = doc.elements.find((element) => element.id === id)?.kind;
      return kind !== 'frame' && kind !== 'panel-background';
    }).length +
      elements.filter((element) => element.kind !== 'frame' && element.kind !== 'panel-background')
        .length >
      LIMITS.elementsPerPanel
  )
    throw new Error(
      '컷당 콘텐츠는 최대 100개, 테두리·배경 예약 공간을 포함한 전체 요소는 최대 102개입니다.',
    );
  if (
    target.elementIds.filter(
      (id) => doc.elements.find((item) => item.id === id)!.kind === 'character',
    ).length +
      elements.filter((item) => item.kind === 'character').length >
    LIMITS.charactersPerPanel
  )
    throw new Error('컷당 캐릭터는 최대 4개입니다.');
  const map = new Map(ordered.map((id) => [id, `element-${crypto.randomUUID()}`]));
  const groups = new Map(
    elements.flatMap((element) =>
      element.groupId ? [[element.groupId, `group-${crypto.randomUUID()}`] as const] : [],
    ),
  );
  const document = changeDocument(doc, (draft) => {
    draft.elements.push(
      ...elements.map((element) => ({
        ...structuredClone(element),
        id: map.get(element.id)!,
        ...(element.groupId ? { groupId: groups.get(element.groupId)! } : {}),
      })),
    );
    draft.panels.find((item) => item.id === targetPanelId)!.elementIds.push(...map.values());
    for (const layout of draft.layouts) {
      const from = layout.panels.find((item) => item.panelId === source.id)!;
      const to = layout.panels.find((item) => item.panelId === targetPanelId)!;
      const chosen = ordered.map((id) => from.elements.find((item) => item.elementId === id)!);
      const sx = from.rect.width / to.rect.width,
        sy = from.rect.height / to.rect.height;
      const same = source.id === targetPanelId;
      const dx = same && chosen.every((item) => item.transform.x + 0.03 <= 3) ? 0.03 : 0;
      const dy = same && chosen.every((item) => item.transform.y + 0.03 <= 3) ? 0.03 : 0;
      to.elements.push(
        ...chosen.map((item) => ({
          elementId: map.get(item.elementId)!,
          ...(item.background ? { background: structuredClone(item.background) } : {}),
          transform: {
            ...item.transform,
            x: item.transform.x * sx + dx,
            y: item.transform.y * sy + dy,
            width: item.transform.width * sx,
            height: item.transform.height * sy,
          },
        })),
      );
    }
  });
  return { document, elementIds: [...map.values()] };
}

export function reorderPanel(doc: StudioDocument, panelId: string, direction: 'previous' | 'next') {
  const from = doc.panels.findIndex((item) => item.id === panelId);
  if (from < 0 || !['previous', 'next'].includes(direction))
    throw new Error('컷과 이동 방향을 확인해 주세요.');
  const to = from + (direction === 'previous' ? -1 : 1);
  if (to < 0 || to >= doc.panels.length) return doc;
  return changeDocument(doc, (draft) => {
    const slots = draft.layouts.map((layout) =>
      draft.panels.map((panel) => layout.panels.find((item) => item.panelId === panel.id)!.rect),
    );
    const [moved] = draft.panels.splice(from, 1);
    draft.panels.splice(to, 0, moved!);
    draft.layouts.forEach((layout, index) => {
      const before = new Map(layout.panels.map((panel) => [panel.panelId, panel]));
      layout.panels = draft.panels.map((panel, slot) => ({
        ...before.get(panel.id)!,
        rect: slots[index]![slot]!,
      }));
    });
  });
}

export * from './background';
