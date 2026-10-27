import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  EditHistory,
  createEditorDocument,
  changeCaption,
  changeDocument,
  transformElement,
  hitTestElement,
  snapElementPosition,
  type AlignmentGuide,
  moveElements,
  backgroundPlacement,
  backgroundValue,
  placeBackground,
  type BackgroundTarget,
  addImageResource,
  addElement,
  addCustomBubble,
  deleteElements,
  expandElementGroups,
  findPanelBackground,
  setElementFlags,
  ungroupElements,
} from '@jjal/editor-core';
import {
  FONT_CATALOG,
  fontDefinition,
  type BuiltinFontFamily,
  type StudioDocument,
} from '@jjal/document-model';
import type { PreparedImage } from '@jjal/image-io';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import {
  renderDocument,
  canvasFont,
  textContentRect,
  textDrawingOffset,
  wrapText,
} from '@jjal/renderer';
import { BackgroundTools } from './BackgroundTools';
import { ExportTools } from './ExportTools';
import { TemplateLibrary } from './TemplateLibrary';
import { StarterTemplates } from './StarterTemplates';
import { StyleTools } from './StyleTools';
import { ShapeTools } from './ShapeTools';
import { ContourTools } from './ContourTools';
import { AlignmentOverlay } from './AlignmentOverlay';
import { GroupTools } from './GroupTools';
import { SelectionOverlay } from './SelectionOverlay';
import { ResizeHandles } from './ResizeHandles';
import { InlineTextEditor } from './InlineTextEditor';
import { ResourceLibrary } from './ResourceLibrary';
import { UiIcon } from './UiIcon';
import { ToolDeck, type ToolPage } from './ToolDeck';
import { LayerRail } from './LayerRail';
import { TransformHandles } from './TransformHandles';
import { LayerDeletePopover } from './LayerDeletePopover';
import { useSurfaceScale } from './useSurfaceScale';
import {
  bubbleResourceShape,
  customBubbleSourceId,
  type BubbleResourceShape,
} from '../composition/bubble-resources';
import { fitNewTextBoxes, fitChangedTextBoxes } from '../composition/textBounds';
import { ensurePanelBackgroundLayers } from '../composition/panelBackgrounds';
import {
  normalizeSelection,
  selectionForTool,
  type EditorSelection,
} from '../composition/selection';
import { insertLayer, layerInsertionAt, type LayerInsertion } from '../composition/layerOrder';
import {
  readCachedResource,
  parseResourceDragId,
  RESOURCE_DRAG_MIME,
} from '../composition/resources';
import { ensureBuiltinFonts, ensureFont, isFontReady } from '../composition/fonts';

interface Session {
  doc: StudioDocument;
  images: ReadonlyMap<string, PreparedImage>;
  frame: HTMLCanvasElement;
  longEdge: 1080 | 2048;
}

function makeSession(
  doc: StudioDocument,
  images: ReadonlyMap<string, PreparedImage>,
  longEdge: 1080 | 2048,
): Session {
  const frame = document.createElement('canvas');
  renderDocument(frame, doc, {
    longEdge,
    images: new Map([...images].map(([id, image]) => [id, image.source])),
  });
  return { doc, images, frame, longEdge };
}
type Snapshot = Pick<Session, 'doc' | 'images'>;
function contentKey({ doc }: Snapshot) {
  // Ratio is navigation; timestamps do not turn an unchanged value into an edit.
  return JSON.stringify({ ...doc, activeRatio: '1:1', updatedAt: '' });
}
const message = (error: unknown) =>
  error instanceof Error ? error.message : '작업을 완료하지 못했습니다. 다시 시도해 주세요.';

function Editor() {
  useSurfaceScale();
  const shell = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [session, setSession] = useState(() =>
    makeSession(
      fitNewTextBoxes(ensurePanelBackgroundLayers(createEditorDocument())),
      new Map(),
      1080,
    ),
  );
  const latest = useRef(session);
  const history = useRef(new EditHistory<Snapshot>((a, b) => contentKey(a) === contentKey(b)));
  const [counts, setCounts] = useState({ undo: 0, redo: 0 });
  const inputGroup = useRef<symbol | undefined>(undefined);
  const gestureGroup = useRef<symbol | undefined>(undefined);
  const activity = useRef(0);
  const fontRequest = useRef(0);
  const [fontBusy, setFontBusy] = useState(false);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const [backgroundScope, setBackgroundScope] = useState<'whole' | 'panel'>('panel');
  const [backgroundMode, setBackgroundMode] = useState(false);
  const backgroundDrag = useRef<{
    pointerId: number;
    documentId: string;
    ratio: StudioDocument['activeRatio'];
    target: BackgroundTarget;
    x: number;
    y: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
    revision: number;
  } | null>(null);
  const [starterBusy, setStarterBusy] = useState(false);
  const [styleBusy, setStyleBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftText, setDraftText] = useState<string | null>(null);
  const [inlineEdit, setInlineEdit] = useState<{
    elementId: string;
    documentId: string;
    ratio: StudioDocument['activeRatio'];
    revision: number;
  } | null>(null);
  const longPress = useRef<{
    timer: number;
    pointerId: number;
    x: number;
    y: number;
    ready: boolean;
    elementId: string;
    documentId: string;
    revision: number;
  } | null>(null);
  const [resourceBusy, setResourceBusy] = useState(false);
  const resourceRequest = useRef(0);
  const resourceGesture = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    armed: boolean;
    timer: number;
    tray: HTMLElement | null;
    scrollLeft: number;
    documentId: string;
    ratio: StudioDocument['activeRatio'];
    revision: number;
  } | null>(null);
  const [resourceGhost, setResourceGhost] = useState<{ x: number; y: number } | null>(null);
  const suppressResourceClick = useRef(0);
  const canvasHold = useRef<{
    pointerId: number;
    x: number;
    y: number;
    ready: boolean;
    timer: number;
  } | null>(null);
  const [selectionState, setSelectionState] = useState(() =>
    normalizeSelection(session.doc, { panelId: 'panel-1', ids: ['line-1'] }),
  );
  const selectionRef = useRef(selectionState);
  const panelId = selectionState.panelId;
  const selectedId = selectionState.ids[0] ?? '';
  const [multiple, setMultiple] = useState(false);
  const snapping = true;
  const [activeTool, setActiveTool] = useState('text');
  const [mobilePanel, setMobilePanel] = useState<'closed' | 'tools' | 'resources'>('closed');
  const mobileDock = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(
    () =>
      window.matchMedia('(min-width: 1000px), (orientation: landscape) and (min-width: 760px)')
        .matches,
  );
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    documentId: string;
    revision: number;
    openDetails?: (editing: boolean) => void;
  } | null>(null);
  const [readOnly] = useState(
    () => new URLSearchParams(window.location.search).get('view') === 'readonly',
  );
  const [guideState, setGuideState] = useState<{
    documentId: string;
    ratio: StudioDocument['activeRatio'];
    elementId: string;
    panelId: string;
    guides: AlignmentGuide[];
  } | null>(null);
  const drag = useRef<{
    pointerId: number;
    documentId: string;
    ratio: StudioDocument['activeRatio'];
    elementId: string;
    panelId: string;
    startX: number;
    elementIds: string[];
    revision: number;
    startY: number;
    x: number;
    y: number;
    panelWidth: number;
    panelHeight: number;
  } | null>(null);
  const { doc, images } = session;
  const composing = draftText !== null || inlineEdit !== null;
  function refreshLayout() {
    setWide(
      window.matchMedia('(min-width: 1000px), (orientation: landscape) and (min-width: 760px)')
        .matches,
    );
  }
  const updateLayout = useEffectEvent(() => {
    if (!composing) refreshLayout();
  });
  useEffect(() => {
    const media = window.matchMedia(
      '(min-width: 1000px), (orientation: landscape) and (min-width: 760px)',
    );
    const update = () => updateLayout();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const frame = stage.current;
    const area = workspace.current;
    const root = shell.current;
    if (!frame || !area || !root) return;
    const measure = () => {
      const bounds = frame.getBoundingClientRect();
      root.style.setProperty('--editor-stage-height', `${bounds.height}px`);
      root.style.setProperty(
        '--editor-stage-offset',
        `${bounds.top - area.getBoundingClientRect().top}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(area);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const panel = doc.panels.find((item) => item.id === panelId) ?? doc.panels[0]!;
  const selectionIds = selectionState.ids.filter((id) => panel.elementIds.includes(id));
  const candidate = doc.elements.find(
    (item) => panel.elementIds.includes(item.id) && item.id === selectedId,
  );
  const caption =
    candidate?.kind === 'text' || candidate?.kind === 'bubble' ? candidate : undefined;
  const selectedBackgroundId = selectionIds.find(
    (id) => doc.elements.find((element) => element.id === id)?.kind === 'panel-background',
  );
  const singleGroup =
    Boolean(candidate?.groupId) &&
    selectionIds.every(
      (id) => doc.elements.find((element) => element.id === id)?.groupId === candidate?.groupId,
    );
  const transform = doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)!
    .panels.find((item) => item.panelId === panel.id)!
    .elements.find((item) => item.elementId === caption?.id)?.transform;
  const overflow = (() => {
    if (!caption || !transform) return false;
    const logical = canvasSize(doc.activeRatio, 1080);
    const placement = doc.layouts
      .find((layout) => layout.ratio === doc.activeRatio)!
      .panels.find((item) => item.panelId === panel.id)!;
    const box = textContentRect(
      caption,
      transform.width * placement.rect.width * logical.width,
      transform.height * placement.rect.height * logical.height,
    );
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = canvasFont(caption.style);
    ctx.textBaseline = 'top';
    const lines = wrapText(caption.text, box.width, (text) => ctx.measureText(text).width);
    const offset = textDrawingOffset(ctx, lines);
    return (
      lines.some(
        (line, index) =>
          ctx.measureText(line).width > box.width ||
          offset +
            index * caption.style.fontSize * caption.style.lineHeight +
            ctx.measureText(line).actualBoundingBoxDescent >
            box.height,
      ) ||
      transform.x < 0 ||
      transform.y < 0 ||
      transform.x + transform.width > 1.000001 ||
      transform.y + transform.height > 1.000001
    );
  })();

  useEffect(() => {
    const target = canvas.current;
    if (target) {
      target.width = session.frame.width;
      target.height = session.frame.height;
      // Match the renderer's readback path so transparent edge pixels stay stable.
      target.getContext('2d', { willReadFrequently: true })!.drawImage(session.frame, 0, 0);
    }
  }, [session]);
  useEffect(
    () => () => {
      fontRequest.current++;
    },
    [],
  );

  function adoptSelection(nextDoc: StudioDocument, requested: EditorSelection) {
    const next = normalizeSelection(nextDoc, requested);
    selectionRef.current = next;
    setSelectionState(next);
  }
  function commit(
    nextDoc: StudioDocument,
    nextImages = latest.current.images,
    nextEdge = latest.current.longEdge,
    group?: symbol,
    skipTextFit = false,
  ) {
    if (!skipTextFit) nextDoc = fitChangedTextBoxes(nextDoc, latest.current.doc);
    setDeleteTarget(null);
    setGuideState(null);
    const kept = new Map(
      [...nextImages].filter(([id]) => nextDoc.assets.some((asset) => asset.id === id)),
    );
    const next = makeSession(nextDoc, kept, nextEdge);
    history.current.record(
      { doc: latest.current.doc, images: latest.current.images },
      { doc: next.doc, images: next.images },
      group,
    );
    adopt(next);
  }
  function adopt(next: Session) {
    setDeleteTarget(null);
    setCounts({ undo: history.current.undoCount, redo: history.current.redoCount });
    const nextDoc = next.doc;
    activity.current++;
    latest.current = next;
    setSession(next);
    adoptSelection(nextDoc, selectionRef.current);
  }
  function clearLongPress() {
    if (longPress.current) window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  }
  function clearCanvasHold() {
    if (canvasHold.current) window.clearTimeout(canvasHold.current.timer);
    canvasHold.current = null;
  }
  function startCanvasHold(event: ReactPointerEvent<HTMLCanvasElement>) {
    clearCanvasHold();
    if (event.pointerType === 'mouse') return;
    canvasHold.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ready: false,
      timer: window.setTimeout(() => {
        if (canvasHold.current?.pointerId === event.pointerId) canvasHold.current.ready = true;
      }, 350),
    };
  }
  function travel(direction: 'undo' | 'redo') {
    if (composing || readOnly) return;
    clearLongPress();
    const target = direction === 'undo' ? history.current.undoTarget : history.current.redoTarget;
    if (!target) return;
    try {
      const current = latest.current;
      // Preserve the visible ratio and export size while restoring all eight layouts.
      const nextDoc = { ...target.doc, activeRatio: current.doc.activeRatio };
      const next = makeSession(nextDoc, target.images, current.longEdge);
      history.current[direction]({ doc: current.doc, images: current.images });
      fontRequest.current++;
      setFontBusy(false);
      inputGroup.current = undefined;
      gestureGroup.current = undefined;
      drag.current = null;
      backgroundDrag.current = null;
      setGuideState(null);
      adopt(next);
      setError('');
      setNotice(direction === 'undo' ? '변경을 실행 취소했습니다.' : '변경을 다시 실행했습니다.');
    } catch (cause) {
      setError(`${message(cause)} 기존 작업과 이력을 유지합니다.`);
    }
  }
  function removeSelection(ids = selectionIds) {
    if (
      readOnly ||
      composing ||
      resourceBusy ||
      starterBusy ||
      backgroundBusy ||
      styleBusy ||
      fontBusy ||
      !ids.length
    )
      return;
    try {
      commit(deleteElements(latest.current.doc, ids));
      selectGroup([]);
      setDeleteTarget(null);
      setError('');
      setNotice('레이어를 삭제했습니다.');
    } catch (cause) {
      setError(message(cause));
    }
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.isComposing ||
        composing ||
        event.altKey ||
        target.closest('input,textarea,select,[contenteditable="true"]')
      )
        return;
      if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey) {
        if (selectionIds.length) {
          event.preventDefault();
          removeSelection();
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z' || (key === 'y' && !event.shiftKey)) {
        event.preventDefault();
        travel(key === 'y' || event.shiftKey ? 'redo' : 'undo');
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  function showLayerMenu(id: string, openDetails?: (editing: boolean) => void) {
    const element = latest.current.doc.elements.find((item) => item.id === id);
    if (readOnly || composing || !element) return;
    setDeleteTarget({
      id,
      documentId: latest.current.doc.id,
      revision: activity.current,
      ...(openDetails ? { openDetails } : {}),
    });
  }
  function edit(patch: Parameters<typeof changeCaption>[1]) {
    if (!caption) return;
    try {
      commit(
        changeCaption(latest.current.doc, patch, latest.current.doc.activeRatio, caption.id),
        latest.current.images,
        latest.current.longEdge,
        inputGroup.current,
      );
      setError('');
    } catch (cause) {
      setError(message(cause));
    }
  }
  function cancelFontSelection() {
    fontRequest.current++;
    setFontBusy(false);
    if (fontBusy) setNotice('글꼴 적용을 취소했습니다. 현재 선택한 문구를 편집할 수 있습니다.');
  }
  async function selectFont(family: BuiltinFontFamily) {
    if (!caption) return;
    const ticket = ++fontRequest.current;
    const documentId = latest.current.doc.id;
    const elementId = caption.id;
    setError('');
    if (isFontReady(family)) {
      setFontBusy(false);
      edit({ fontFamily: family });
      setNotice(`${fontDefinition(family).label} 글꼴을 적용했습니다.`);
      return;
    }
    setFontBusy(true);
    setNotice(`${fontDefinition(family).label} 글꼴을 불러오고 있습니다…`);
    try {
      await ensureFont(family);
      if (ticket !== fontRequest.current || latest.current.doc.id !== documentId) return;
      // Keep any text, image or ratio edits made while the original font was loading.
      commit(
        changeCaption(
          latest.current.doc,
          { fontFamily: family },
          latest.current.doc.activeRatio,
          elementId,
        ),
      );
      setNotice(`${fontDefinition(family).label} 글꼴을 적용했습니다.`);
    } catch (cause) {
      if (ticket === fontRequest.current) {
        setError(`${message(cause)} 기존 작업은 그대로 유지됩니다.`);
        setNotice('글꼴을 적용하지 못했습니다. 현재 작업을 유지합니다.');
      }
    } finally {
      if (ticket === fontRequest.current) setFontBusy(false);
    }
  }
  function beginInlineEditing(elementId: string) {
    if (readOnly) return;
    if (composing || resourceBusy || starterBusy || backgroundBusy || styleBusy) return;
    const current = latest.current.doc;
    const element = current.elements.find((item) => item.id === elementId);
    const owner = current.panels.find((item) => item.elementIds.includes(elementId));
    if (
      !owner ||
      !element ||
      element.locked ||
      element.hidden ||
      (element.kind !== 'text' && element.kind !== 'bubble')
    )
      return;
    clearLongPress();
    cancelFontSelection();
    drag.current = null;
    backgroundDrag.current = null;
    gestureGroup.current = undefined;
    setGuideState(null);
    setBackgroundMode(false);
    selectElement(elementId);
    setDeleteTarget(null);
    setInlineEdit({
      elementId,
      documentId: current.id,
      ratio: current.activeRatio,
      revision: activity.current,
    });
    setError('');
  }
  function finishInlineEditing(text: string) {
    const editing = inlineEdit;
    if (!editing) return false;
    const current = latest.current;
    if (
      editing.documentId !== current.doc.id ||
      editing.ratio !== current.doc.activeRatio ||
      editing.revision !== activity.current
    ) {
      setError('편집 대상이 변경되었습니다. 기존 작업을 유지합니다.');
      return false;
    }
    try {
      const next = changeCaption(current.doc, { text }, current.doc.activeRatio, editing.elementId);
      commit(next, current.images, current.longEdge, Symbol('inline-text'));
      setInlineEdit(null);
      refreshLayout();
      setError('');
      setNotice('문구를 수정했습니다.');
      return true;
    } catch (cause) {
      setError(message(cause));
      return false;
    }
  }
  function resourceDropPoint(clientX: number, clientY: number) {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return undefined;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || y < 0 || x > 1 || y > 1) return undefined;
    const current = latest.current.doc;
    const target = current.layouts
      .find((layout) => layout.ratio === current.activeRatio)!
      .panels.find(
        (item) =>
          x >= item.rect.x &&
          y >= item.rect.y &&
          x <= item.rect.x + item.rect.width &&
          y <= item.rect.y + item.rect.height,
      );
    if (!target) return undefined;
    return {
      panelId: target.panelId,
      point: {
        x: (x - target.rect.x) / target.rect.width,
        y: (y - target.rect.y) / target.rect.height,
      },
    };
  }
  async function placeResource(
    id: string,
    target?: { panelId: string; point?: { x: number; y: number }; insertion?: LayerInsertion },
  ) {
    if (creationBusy) return;
    const shape = bubbleResourceShape(id);
    if (shape) {
      appendBubble(shape, target);
      return;
    }
    const bubbleSource = customBubbleSourceId(id);
    const resourceId = bubbleSource ?? parseResourceDragId(id);
    if (!resourceId) {
      setError('자원을 확인해 주세요.');
      return;
    }
    const before = latest.current;
    const revision = activity.current;
    const ticket = ++resourceRequest.current;
    setResourceBusy(true);
    setError('');
    let decoded: PreparedImage | undefined;
    let adopted = false;
    try {
      const { image, resource } = await readCachedResource(resourceId);
      decoded = image;
      if (
        ticket !== resourceRequest.current ||
        latest.current.doc !== before.doc ||
        activity.current !== revision
      )
        return;
      if (bubbleSource && !resource.customBubble) throw new Error('말풍선 변환 정보가 없습니다.');
      const result = bubbleSource
        ? addCustomBubble(
            before.doc,
            target?.panelId ?? panel.id,
            image.asset,
            resource.customBubble!,
          )
        : addImageResource(before.doc, target?.panelId ?? panel.id, image.asset, target?.point);
      const placed = result.document.elements.find((item) => item.id === result.elementId)!;
      const assetId =
        placed.kind === 'image'
          ? placed.assetId
          : placed.kind === 'bubble' && placed.customShape
            ? placed.customShape.sourceAssetId
            : image.asset.id;
      const existing = before.images.get(assetId);
      const kept = existing ?? {
        ...image,
        asset: result.document.assets.find((asset) => asset.id === assetId)!,
      };
      let nextDoc = target?.insertion
        ? insertLayer(result.document, result.elementId, target.insertion)
        : result.document;
      if (bubbleSource && target?.point) {
        const transform = nextDoc.layouts
          .find((layout) => layout.ratio === before.doc.activeRatio)!
          .panels.find((item) => item.panelId === (target.panelId ?? panel.id))!
          .elements.find((item) => item.elementId === result.elementId)!.transform;
        nextDoc = transformElement(nextDoc, result.elementId, before.doc.activeRatio, {
          x: Math.max(0, Math.min(1 - transform.width, target.point.x - transform.width / 2)),
          y: Math.max(0, Math.min(1 - transform.height, target.point.y - transform.height / 2)),
        });
      }
      commit(nextDoc, new Map([...before.images, [assetId, kept]]));
      adopted = !existing;
      setMultiple(false);
      selectElement(result.elementId);
      if (!bubbleSource) changeTool('layers');
      setNotice(bubbleSource ? '말풍선을 배치했습니다.' : '이미지를 배치했습니다.');
    } catch (cause) {
      if (ticket === resourceRequest.current) setError(`${message(cause)} 기존 작업은 유지됩니다.`);
    } finally {
      if (decoded && !adopted) decoded.source.width = decoded.source.height = 0;
      if (ticket === resourceRequest.current) setResourceBusy(false);
    }
  }
  function beginResourceGesture(id: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (
      event.pointerType === 'mouse' ||
      readOnly ||
      composing ||
      resourceBusy ||
      !event.isPrimary ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const current = latest.current.doc;
    const tray = event.currentTarget.closest<HTMLElement>('.resource-tray');
    resourceGesture.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      armed: false,
      tray,
      scrollLeft: tray?.scrollLeft ?? 0,
      timer: window.setTimeout(() => {
        const gesture = resourceGesture.current;
        if (gesture?.pointerId === event.pointerId && !gesture.moved) {
          gesture.armed = true;
          setResourceGhost({ x: gesture.startX, y: gesture.startY });
        }
      }, 350),
      documentId: current.id,
      ratio: current.activeRatio,
      revision: activity.current,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const gesture = resourceGesture.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      event.preventDefault();
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 6) {
        gesture.moved = true;
        if (!gesture.armed) {
          window.clearTimeout(gesture.timer);
          if (gesture.tray)
            gesture.tray.scrollLeft = gesture.scrollLeft - event.clientX + gesture.startX;
          return;
        }
      }
      if (gesture.armed && gesture.moved) setResourceGhost({ x: event.clientX, y: event.clientY });
    };
    const finish = (event: PointerEvent) => {
      const gesture = resourceGesture.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      resourceGesture.current = null;
      window.clearTimeout(gesture.timer);
      setResourceGhost(null);
      suppressResourceClick.current = Date.now() + 800;
      event.preventDefault();
      if (
        event.type === 'pointercancel' ||
        readOnly ||
        gesture.documentId !== latest.current.doc.id ||
        gesture.ratio !== latest.current.doc.activeRatio ||
        gesture.revision !== activity.current
      )
        return;
      const insertion = gesture.armed ? layerInsertionAt(event.clientX, event.clientY) : undefined;
      const target = gesture.armed ? resourceDropPoint(event.clientX, event.clientY) : undefined;
      if (insertion) void placeResource(gesture.id, { panelId: insertion.panelId, insertion });
      else if (target) void placeResource(gesture.id, target);
      else if (!gesture.moved) void placeResource(gesture.id);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish, { passive: false });
    window.addEventListener('pointercancel', finish, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  });
  useEffect(
    () => () => {
      clearLongPress();
      clearCanvasHold();
      if (resourceGesture.current) window.clearTimeout(resourceGesture.current.timer);
      resourceRequest.current++;
    },
    [],
  );
  const creationBusy =
    readOnly || composing || fontBusy || resourceBusy || starterBusy || backgroundBusy || styleBusy;
  const pageDefinitions: ToolPage[] = [
    {
      id: 'templates',
      category: '템플릿',
      label: '기본 템플릿',
      icon: 'grid',
      content: (
        <>
          <StarterTemplates
            revision={() => activity.current}
            apply={(next, nextImages) =>
              applyDocument(
                changeDocument(next, (draft) => {
                  for (const element of draft.elements)
                    if (element.kind === 'bubble') {
                      element.style.align = 'center';
                      element.verticalAlign ??= 'center';
                      element.textPadding ??= { top: 12, right: 12, bottom: 12, left: 12 };
                      element.corners ??= {
                        topLeft: 10,
                        topRight: 10,
                        bottomRight: 10,
                        bottomLeft: 10,
                      };
                      element.spikeSharpness ??= 40;
                    }
                }),
                nextImages,
              )
            }
            composing={composing}
            onBusyChange={setStarterBusy}
          />
        </>
      ),
    },
    {
      id: 'layout',
      category: '템플릿',
      label: '작품 · 비율',
      icon: 'grid',
      content: (
        <>
          <section className="tool-section">
            {' '}
            <label>
              편집할 컷
              <select
                aria-label="편집할 컷"
                value={panel.id}
                disabled={composing}
                onChange={(event) => {
                  activity.current++;
                  cancelFontSelection();
                  const next = doc.panels.find((item) => item.id === event.target.value)!;
                  adoptSelection(latest.current.doc, {
                    panelId: next.id,
                    ids: next.elementIds.length ? [next.elementIds.at(-1)!] : [],
                  });
                }}
              >
                {doc.panels.map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {index + 1}컷
                  </option>
                ))}
              </select>
            </label>{' '}
            <div className="preview-footer">
              <span>화면 비율</span>
              <div className="ratio-options" role="group" aria-label="화면 비율">
                {ASPECT_RATIOS.map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    aria-pressed={doc.activeRatio === ratio}
                    disabled={
                      inlineEdit !== null || !doc.layouts.some((layout) => layout.ratio === ratio)
                    }
                    onClick={() => {
                      try {
                        commit(
                          changeDocument(latest.current.doc, (d) => {
                            d.activeRatio = ratio;
                          }),
                        );
                        setError('');
                      } catch (cause) {
                        setError(message(cause));
                      }
                    }}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </>
      ),
    },
    {
      id: 'text',
      category: '문구',
      label: '문구 편집',
      icon: 'text',
      content: (
        <>
          {caption && transform ? (
            <div className="tool-section">
              <h2>
                <UiIcon name="text" /> 문구 편집
              </h2>
              <fieldset
                className="caption-fields"
                disabled={caption.locked || selectionIds.length > 1}
              >
                <details className="content-tools">
                  <summary
                    aria-disabled={draftText !== null}
                    onClick={(event) => {
                      if (draftText !== null) event.preventDefault();
                    }}
                  >
                    내용 편집
                  </summary>
                  <label htmlFor="caption">
                    문구 <span className="hint">{[...caption.text].length} / 1,000</span>
                  </label>
                  <textarea
                    id="caption"
                    aria-label="문구"
                    value={draftText ?? caption.text}
                    rows={3}
                    onCompositionStart={() => {
                      activity.current++;
                      setDraftText(caption.text);
                    }}
                    onCompositionEnd={(event) => {
                      setDraftText(null);
                      edit({ text: event.currentTarget.value });
                      refreshLayout();
                    }}
                    onChange={(event) => {
                      if (draftText !== null) setDraftText(event.target.value);
                      else edit({ text: event.target.value });
                    }}
                  />
                </details>
                <label className="select-row">
                  글꼴
                  <select
                    aria-label="문구 글꼴"
                    value={
                      caption.style.font.kind === 'builtin'
                        ? caption.style.font.family
                        : 'Noto Sans KR'
                    }
                    onChange={(event) => void selectFont(event.target.value as BuiltinFontFamily)}
                  >
                    <optgroup label="기본 글꼴">
                      {FONT_CATALOG.filter((font) => font.startup).map((font) => (
                        <option key={font.family} value={font.family}>
                          {font.label}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="추가 글꼴">
                      {FONT_CATALOG.filter((font) => !font.startup).map((font) => (
                        <option key={font.family} value={font.family}>
                          {font.label}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                {fontBusy && <p role="status">선택한 글꼴을 준비하고 있습니다…</p>}
                <label className="color-control">
                  색상
                  <input
                    aria-label="문구 색상"
                    type="color"
                    value={caption.style.color}
                    onChange={(e) => edit({ color: e.target.value })}
                  />
                </label>
                <details className="precision-tools">
                  <summary>정밀 조정</summary>
                  <label>
                    크기 <output>{Number(caption.style.fontSize.toFixed(2))}px</output>
                    <input
                      aria-label="문구 크기"
                      type="range"
                      min="8"
                      max="300"
                      value={caption.style.fontSize}
                      onChange={(e) => edit({ fontSize: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    가로 위치 <output>{Math.round(transform.x * 100)}%</output>
                    <input
                      aria-label="문구 가로 위치"
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(transform.x * 100)}
                      onChange={(e) => edit({ x: Number(e.target.value) / 100 })}
                    />
                  </label>
                  <label>
                    세로 위치 <output>{Math.round(transform.y * 100)}%</output>
                    <input
                      aria-label="문구 세로 위치"
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(transform.y * 100)}
                      onChange={(e) => edit({ y: Number(e.target.value) / 100 })}
                    />
                  </label>
                  <label>
                    문구 폭 <output>{Math.round(transform.width * 100)}%</output>
                    <input
                      aria-label="문구 폭"
                      type="range"
                      min="10"
                      max="100"
                      value={Math.round(transform.width * 100)}
                      onChange={(e) => edit({ width: Number(e.target.value) / 100 })}
                    />
                  </label>
                </details>
                {overflow && <p className="overflow-notice">문구 영역을 벗어난 부분은 잘립니다.</p>}
              </fieldset>
            </div>
          ) : null}
          <button
            type="button"
            className="caption-add"
            disabled={creationBusy}
            onClick={appendText}
          >
            <UiIcon name="plus" /> 문구 추가
          </button>
        </>
      ),
    },
    {
      id: 'background',
      category: '배경',
      label: '배경 편집',
      icon: 'background',
      content: (
        <>
          <BackgroundTools
            doc={doc}
            panelId={panel.id}
            elementId={selectedBackgroundId}
            scope={backgroundScope}
            onScope={(scope) => {
              activity.current++;
              backgroundDrag.current = null;
              setBackgroundMode(false);
              setBackgroundScope(scope);
            }}
            dragging={backgroundMode}
            onDragging={(value) => {
              activity.current++;
              drag.current = null;
              backgroundDrag.current = null;
              setGuideState(null);
              setBackgroundMode(value);
            }}
            disabled={composing || starterBusy}
            busy={backgroundBusy}
            getSnapshot={() => latest.current}
            revision={() => activity.current}
            onBusy={setBackgroundBusy}
            onChange={(next, nextImages) => {
              commit(next, nextImages);
              setError('');
            }}
            onError={(cause) => setError(`${message(cause)} 기존 작업은 그대로 유지됩니다.`)}
          />
        </>
      ),
    },
    {
      id: 'layers',
      category: '레이어',
      label: '선택 · 복사',
      icon: 'layers',
      content: (
        <>
          <GroupTools
            showSelectionList={false}
            doc={doc}
            panelId={panel.id}
            selectedIds={selectionIds}
            composing={composing || starterBusy}
            multiple={multiple}
            onMultiple={(value) => {
              setMultiple(value);
              drag.current = null;
              setGuideState(null);
            }}
            getSnapshot={() => latest.current.doc}
            onSelection={selectGroup}
            onChange={(next) => {
              commit(next);
              setError('');
            }}
            onError={(cause) =>
              setError(
                `${cause instanceof Error && cause.name === 'ZodError' ? '요소의 위치·크기 한도를 확인해 주세요.' : message(cause)} 기존 작업은 그대로 유지됩니다.`,
              )
            }
          />
        </>
      ),
    },
    {
      id: 'style',
      category: '도형',
      label: '도형 · 말풍선',
      icon: 'style',
      content: (
        <>
          <ShapeTools
            key={`shape-${candidate?.id ?? 'none'}`}
            doc={doc}
            panelId={panel.id}
            targetId={candidate?.id}
            disabled={creationBusy}
            onAdd={appendShape}
            onChange={(next) => {
              commit(next);
              setError('');
            }}
            onError={(cause) => setError(message(cause))}
          />
          {!candidate ? (
            <p className="style-empty">조정할 요소를 선택해주세요.</p>
          ) : (
            <ContourTools
              key={`contour-${candidate?.id}`}
              doc={doc}
              targetId={candidate?.id}
              disabled={
                composing || fontBusy || (selectionIds.length > 1 && !singleGroup) || styleBusy
              }
              onChange={(next) => {
                commit(next);
                setError('');
              }}
              onError={(cause) => setError(message(cause))}
            />
          )}
          {caption && (
            <StyleTools
              doc={doc}
              targetId={candidate?.id}
              composing={composing || fontBusy || selectionIds.length > 1}
              getSnapshot={() => ({ doc: latest.current.doc, revision: activity.current })}
              beforeApply={cancelFontSelection}
              onBusyChange={setStyleBusy}
              onChange={(next) => {
                commit(next);
                setError('');
              }}
              onError={(cause) => setError(message(cause))}
            />
          )}
        </>
      ),
    },
    {
      id: 'library',
      category: '저장',
      label: '내 템플릿 · JSON',
      icon: 'save',
      content: (
        <>
          <TemplateLibrary
            getSnapshot={() => ({ ...latest.current, revision: activity.current })}
            composing={composing || backgroundBusy || fontBusy || styleBusy}
            applyTemplate={applyDocument}
          />
        </>
      ),
    },
    {
      id: 'export',
      category: '저장',
      label: '이미지',
      icon: 'download',
      content: (
        <>
          <ExportTools
            session={session}
            disabled={
              resourceBusy || backgroundBusy || starterBusy || styleBusy || fontBusy || composing
            }
            onNotice={setNotice}
            onSize={(edge) => {
              try {
                commit(latest.current.doc, latest.current.images, edge);
                setError('');
              } catch (cause) {
                setError(message(cause));
              }
            }}
          />
        </>
      ),
    },
  ];
  const pageOrder = [
    'text',
    'background',
    'layers',
    'style',
    'templates',
    'layout',
    'export',
    'library',
  ];
  const pages = pageOrder
    .map((id) => pageDefinitions.find((page) => page.id === id)!)
    .map((page) => ({
      ...page,
      content: (
        <fieldset className="page-editing-guard" disabled={readOnly}>
          {page.content}
        </fieldset>
      ),
    }));

  const changeTool = (id: string) => {
    clearLongPress();
    setDeleteTarget(null);
    drag.current = null;
    backgroundDrag.current = null;
    setGuideState(null);
    if (id !== 'background') setBackgroundMode(false);
    setActiveTool(id);
  };
  function navigateTool(id: string) {
    if (composing) return;
    if (id === 'text' || id === 'style') {
      activity.current++;
      cancelFontSelection();
      setMultiple(false);
      adoptSelection(
        latest.current.doc,
        selectionForTool(latest.current.doc, selectionRef.current, id),
      );
    }
    changeTool(id);
  }
  function appendShape(shape: 'rect' | 'ellipse' | 'triangle' | 'diamond') {
    if (creationBusy) return;
    try {
      const result = addElement(latest.current.doc, selectionRef.current.panelId, {
        kind: 'shape',
        shape,
      });
      commit(result.document);
      setMultiple(false);
      selectElement(result.elementId);
      setError('');
      setNotice('도형을 추가했습니다.');
    } catch (cause) {
      setError(`${message(cause)} 기존 작업은 그대로 유지됩니다.`);
    }
  }
  function appendText() {
    if (creationBusy) return;
    try {
      const result = addElement(latest.current.doc, selectionRef.current.panelId, { kind: 'text' });
      commit(result.document);
      setMultiple(false);
      selectElement(result.elementId);
      setError('');
      setNotice('문구를 추가했습니다.');
    } catch (cause) {
      setError(`${message(cause)} 기존 작업은 그대로 유지됩니다.`);
    }
  }
  function appendBubble(
    shape: BubbleResourceShape,
    target?: { panelId: string; point?: { x: number; y: number }; insertion?: LayerInsertion },
  ) {
    if (creationBusy) return;
    try {
      const current = latest.current.doc;
      const owner = target?.panelId ?? selectionRef.current.panelId;
      const result = addElement(current, owner, { kind: 'bubble', shape });
      let next = result.document;
      if (target?.point) {
        const transform = next.layouts
          .find((layout) => layout.ratio === current.activeRatio)!
          .panels.find((panel) => panel.panelId === owner)!
          .elements.find((element) => element.elementId === result.elementId)!.transform;
        next = transformElement(next, result.elementId, current.activeRatio, {
          x: Math.max(0, Math.min(1 - transform.width, target.point.x - transform.width / 2)),
          y: Math.max(0, Math.min(1 - transform.height, target.point.y - transform.height / 2)),
        });
      }
      if (target?.insertion) next = insertLayer(next, result.elementId, target.insertion);
      commit(next);
      setMultiple(false);
      selectElement(result.elementId);
      setError('');
      setNotice('말풍선을 배치했습니다.');
    } catch (cause) {
      setError(`${message(cause)} 기존 작업은 그대로 유지됩니다.`);
    }
  }
  const historyControls = (
    <section className="history-tools session-toolbar" aria-label="현재 세션 편집 이력">
      <button
        type="button"
        aria-label="실행 취소"
        disabled={readOnly || composing || !counts.undo}
        onClick={() => travel('undo')}
      >
        <UiIcon name="undo" />
        <span>실행 취소</span>
      </button>
      <button
        type="button"
        aria-label="다시 실행"
        disabled={readOnly || composing || !counts.redo}
        onClick={() => travel('redo')}
      >
        <UiIcon name="redo" />
        <span>다시 실행</span>
      </button>
      <span className="toolbar-history-count" aria-live="polite">
        취소 {counts.undo} · 다시 {counts.redo}
      </span>
    </section>
  );
  const resources = (
    <ResourceLibrary
      disabled={composing || resourceBusy || starterBusy || backgroundBusy || styleBusy}
      readOnly={readOnly}
      onRequestEdit={() => setNotice('편집 권한 요청 기능은 준비 중입니다.')}
      onAddBubble={(shape) => {
        if (Date.now() >= suppressResourceClick.current) appendBubble(shape);
      }}
      onPlace={(id) => {
        if (!readOnly && Date.now() >= suppressResourceClick.current) void placeResource(id);
      }}
      onResourcePointerDown={beginResourceGesture}
    />
  );
  const layers = (
    <LayerRail
      doc={doc}
      images={images}
      selectedIds={selectionIds}
      multiple={multiple}
      disabled={readOnly || composing || resourceBusy || starterBusy || backgroundBusy}
      onSelect={selectGroup}
      onBadgeAction={(id, owner, action) => {
        if (creationBusy) return;
        try {
          const current = latest.current.doc;
          const element = current.elements.find((item) => item.id === id);
          const panel = current.panels.find((item) => item.id === owner);
          if (!element || !panel?.elementIds.includes(id)) return;
          const ids = expandElementGroups(current, [id]);
          const members = current.elements.filter((item) => ids.includes(item.id));
          const next =
            action === 'ungroup'
              ? ungroupElements(current, ids)
              : setElementFlags(current, ids, {
                  ...(action === 'toggle-lock'
                    ? { locked: !members.every((item) => item.locked) }
                    : { hidden: !members.every((item) => item.hidden) }),
                });
          commit(next);
          setError('');
          setNotice('레이어 상태를 변경했습니다.');
        } catch (cause) {
          setError(message(cause));
        }
      }}
      onContextMenu={(id, owner, openDetails) => {
        selectGroup([id], owner);
        showLayerMenu(id, openDetails);
      }}
      onResourceDrop={(id, insertion) =>
        void placeResource(id, { panelId: insertion.panelId, insertion })
      }
      onOrder={(id, insertion) => {
        try {
          commit(insertLayer(latest.current.doc, id, insertion));
          selectElement(id);
          setError('');
        } catch (cause) {
          setError(message(cause));
        }
      }}
    />
  );
  const mobileCategories = pages.filter(
    (page, index) => pages.findIndex((item) => item.category === page.category) === index,
  );
  const currentCategory = pages.find((page) => page.id === activeTool)?.category;
  useEffect(() => {
    const bar = mobileDock.current;
    const selected = bar?.querySelector<HTMLElement>('[aria-expanded="true"]');
    if (!bar || !selected) return;
    if (selected.offsetLeft < bar.scrollLeft + 8)
      bar.scrollLeft = Math.max(0, selected.offsetLeft - 8);
    else if (selected.offsetLeft + selected.offsetWidth > bar.scrollLeft + bar.clientWidth - 8)
      bar.scrollLeft = selected.offsetLeft + selected.offsetWidth - bar.clientWidth + 8;
  }, [activeTool, mobilePanel, wide]);

  return (
    <div
      ref={shell}
      className={`studio-shell editorial-workspace${wide ? ' is-wide' : ''}`}
      data-active-tool={activeTool}
      data-mobile-panel={mobilePanel}
      onFocusCapture={(event) => {
        const target = event.target;
        if (
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLInputElement && ['range', 'color'].includes(target.type))
        )
          inputGroup.current = Symbol('input');
      }}
      onBlurCapture={() => {
        inputGroup.current = undefined;
      }}
    >
      <h1 className="sr-only">짤 카드 스튜디오</h1>
      <header className="studio-topbar">
        <div className="studio-logo" aria-label="짤 카드 스튜디오">
          <span aria-hidden="true">짤</span>
          <strong>카드 스튜디오</strong>
        </div>
        <div className="studio-header-actions">
          <button
            type="button"
            className="button-primary studio-send-button"
            disabled={composing}
            onClick={() => {
              changeTool('export');
              setMobilePanel('tools');
              if (wide)
                requestAnimationFrame(() =>
                  document
                    .getElementById('tool-page-export')
                    ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
                );
            }}
          >
            <UiIcon name="download" />
            저장
          </button>
        </div>
      </header>
      <div className="layer-strip-shell">
        {layers}
        <div className="studio-history">{historyControls}</div>
      </div>
      <main ref={workspace} className="card-workspace">
        <section className="preview-panel" aria-label="카드 미리보기">
          <div className="canvas-contextbar">
            <span className="card-size-label" aria-label="작품 비율과 컷 수">
              {doc.activeRatio} · {doc.panels.length}컷
            </span>
            <span className="selection-label">
              {selectionIds.length > 1
                ? `${selectionIds.length}개 선택`
                : candidate
                  ? 'text' in candidate
                    ? candidate.text || '빈 문구'
                    : candidate.kind === 'frame'
                      ? '컷 영역 상자'
                      : candidate.kind === 'panel-background'
                        ? '컷 배경'
                        : candidate.kind === 'shape'
                          ? '도형'
                          : '캐릭터·이미지'
                  : '선택 없음'}
            </span>
            {caption && selectionIds.length === 1 && (
              <button
                type="button"
                className="button-content"
                disabled={
                  readOnly ||
                  composing ||
                  caption.locked ||
                  caption.hidden ||
                  resourceBusy ||
                  starterBusy ||
                  backgroundBusy ||
                  styleBusy ||
                  fontBusy
                }
                onClick={() => beginInlineEditing(caption.id)}
              >
                <UiIcon name="text" size={18} /> 내용 수정
              </button>
            )}
          </div>
          <div
            ref={stage}
            className="canvas-stage"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget && !readOnly && !composing) selectGroup([]);
            }}
          >
            <canvas
              ref={canvas}
              role="img"
              aria-label={`카드 ${doc.activeRatio} 비율`}
              onDoubleClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const hit = hitTestElement(
                  latest.current.doc,
                  (event.clientX - box.left) / box.width,
                  (event.clientY - box.top) / box.height,
                  { includeLocked: true },
                );
                if (!readOnly && hit) beginInlineEditing(hit.elementId);
              }}
              onContextMenu={(event) => event.preventDefault()}
              onDragOver={(event) => {
                if (
                  !readOnly &&
                  !composing &&
                  !resourceBusy &&
                  event.dataTransfer.types.includes(RESOURCE_DRAG_MIME)
                ) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id = parseResourceDragId(event.dataTransfer.getData(RESOURCE_DRAG_MIME));
                const target = resourceDropPoint(event.clientX, event.clientY);
                if (!readOnly && id && target) void placeResource(id, target);
              }}
              onPointerDown={(event) => {
                if (readOnly || composing || resourceBusy || event.button !== 0 || !event.isPrimary)
                  return;
                clearLongPress();
                setDeleteTarget(null);
                if (backgroundMode) {
                  const current = latest.current.doc;
                  const target: BackgroundTarget =
                    backgroundScope === 'whole'
                      ? 'whole'
                      : {
                          panelId: panel.id,
                          ...(selectedBackgroundId ? { elementId: selectedBackgroundId } : {}),
                        };
                  const backdrop =
                    current.layeredPanelBackgrounds && target !== 'whole'
                      ? findPanelBackground(current, target)
                      : undefined;
                  if (
                    backgroundBusy ||
                    !backgroundValue(current, target).imageAssetId ||
                    (target !== 'whole' &&
                      (backdrop?.locked ||
                        backdrop?.background.inherit ||
                        (!current.layeredPanelBackgrounds && panel.background.inherit)))
                  )
                    return;
                  const box = event.currentTarget.getBoundingClientRect();
                  const placed = current.layouts
                    .find((layout) => layout.ratio === current.activeRatio)!
                    .panels.find((item) => item.panelId === panel.id)!;
                  if (target !== 'whole') {
                    const x = (event.clientX - box.left) / box.width,
                      y = (event.clientY - box.top) / box.height;
                    if (
                      x < placed.rect.x ||
                      x > placed.rect.x + placed.rect.width ||
                      y < placed.rect.y ||
                      y > placed.rect.y + placed.rect.height
                    )
                      return;
                  }
                  const position = backgroundPlacement(current, target);
                  backgroundDrag.current = {
                    pointerId: event.pointerId,
                    documentId: current.id,
                    ratio: current.activeRatio,
                    target,
                    x: position.x,
                    y: position.y,
                    startX: event.clientX,
                    startY: event.clientY,
                    width: box.width * (target === 'whole' ? 1 : placed.rect.width),
                    height: box.height * (target === 'whole' ? 1 : placed.rect.height),
                    revision: activity.current,
                  };
                  gestureGroup.current = Symbol('background-drag');
                  event.currentTarget.setPointerCapture(event.pointerId);
                  startCanvasHold(event);
                  event.preventDefault();
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX - rect.left) / rect.width,
                  y = (event.clientY - rect.top) / rect.height;
                const hit = hitTestElement(latest.current.doc, x, y, { includeLocked: true });
                if (!hit) {
                  selectGroup([]);
                  return;
                }
                if (event.shiftKey || multiple) {
                  const current = panel.id === hit.panelId ? selectionIds : [];
                  selectGroup(
                    current.includes(hit.elementId)
                      ? current.filter((id) => id !== hit.elementId)
                      : [...current, hit.elementId],
                    hit.panelId,
                  );
                  return;
                }
                if (selectionIds.length && !selectionIds.includes(hit.elementId)) {
                  selectGroup([]);
                  return;
                }
                const movingIds =
                  panel.id === hit.panelId && selectionIds.includes(hit.elementId)
                    ? selectionIds
                    : expandElementGroups(latest.current.doc, [hit.elementId]);
                if (!selectionIds.includes(hit.elementId)) selectGroup(movingIds, hit.panelId);
                if (
                  movingIds.some(
                    (id) =>
                      latest.current.doc.elements.find((element) => element.id === id)?.locked,
                  )
                )
                  return;
                const placed = doc.layouts
                  .find((item) => item.ratio === doc.activeRatio)!
                  .panels.find((item) => item.panelId === hit.panelId)!;
                const t = placed.elements.find(
                  (item) => item.elementId === hit.elementId,
                )!.transform;
                drag.current = {
                  pointerId: event.pointerId,
                  documentId: doc.id,
                  ratio: doc.activeRatio,
                  elementId: hit.elementId,
                  panelId: hit.panelId,
                  startX: x,
                  elementIds: movingIds,
                  revision: activity.current,
                  startY: y,
                  x: t.x,
                  y: t.y,
                  panelWidth: placed.rect.width,
                  panelHeight: placed.rect.height,
                };
                gestureGroup.current = Symbol('element-drag');
                event.currentTarget.setPointerCapture(event.pointerId);
                startCanvasHold(event);
                event.preventDefault();
                const element = latest.current.doc.elements.find(
                  (item) => item.id === hit.elementId,
                );
                if (element && event.pointerType !== 'mouse') {
                  const before = latest.current.doc;
                  const revision = activity.current;
                  longPress.current = {
                    pointerId: event.pointerId,
                    x: event.clientX,
                    y: event.clientY,
                    ready: false,
                    elementId: hit.elementId,
                    documentId: before.id,
                    revision,
                    timer: window.setTimeout(() => {
                      if (
                        longPress.current &&
                        latest.current.doc === before &&
                        activity.current === revision
                      )
                        longPress.current.ready = true;
                    }, 550),
                  };
                }
              }}
              onPointerMove={(event) => {
                const hold = canvasHold.current;
                if (hold?.pointerId === event.pointerId && !hold.ready) {
                  if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 6) {
                    clearCanvasHold();
                    clearLongPress();
                    drag.current = null;
                    backgroundDrag.current = null;
                  }
                  return;
                }
                const held = longPress.current;
                if (held && held.pointerId === event.pointerId) {
                  if (Math.hypot(event.clientX - held.x, event.clientY - held.y) <= 6) return;
                  clearLongPress();
                }
                const background = backgroundDrag.current;
                if (background) {
                  if (
                    background.pointerId !== event.pointerId ||
                    background.documentId !== latest.current.doc.id ||
                    background.ratio !== latest.current.doc.activeRatio ||
                    background.revision !== activity.current
                  ) {
                    backgroundDrag.current = null;
                    return;
                  }
                  const clamp = (value: number) => Math.max(-2, Math.min(2, value));
                  try {
                    commit(
                      placeBackground(latest.current.doc, background.target, background.ratio, {
                        x: clamp(
                          background.x + (event.clientX - background.startX) / background.width,
                        ),
                        y: clamp(
                          background.y + (event.clientY - background.startY) / background.height,
                        ),
                      }),
                      latest.current.images,
                      latest.current.longEdge,
                      gestureGroup.current,
                    );
                    background.revision = activity.current;
                    setError('');
                  } catch (cause) {
                    backgroundDrag.current = null;
                    setError(message(cause));
                  }
                  return;
                }
                const moving = drag.current;
                if (
                  !moving ||
                  event.pointerId !== moving.pointerId ||
                  latest.current.doc.id !== moving.documentId ||
                  latest.current.doc.activeRatio !== moving.ratio
                )
                  return;
                if (moving.revision !== activity.current) {
                  drag.current = null;
                  setGuideState(null);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                const clamp = (value: number) => Math.min(3, Math.max(-2, value));
                try {
                  const position = {
                    x: clamp(
                      moving.x +
                        ((event.clientX - rect.left) / rect.width - moving.startX) /
                          moving.panelWidth,
                    ),
                    y: clamp(
                      moving.y +
                        ((event.clientY - rect.top) / rect.height - moving.startY) /
                          moving.panelHeight,
                    ),
                  };
                  const snapped =
                    snapping && moving.elementIds.length === 1
                      ? snapElementPosition(
                          latest.current.doc,
                          moving.elementId,
                          moving.ratio,
                          position,
                          {
                            x: 6 / (rect.width * moving.panelWidth),
                            y: 6 / (rect.height * moving.panelHeight),
                          },
                        )
                      : { position, guides: [] };
                  if (moving.elementIds.length > 1) {
                    const current = latest.current.doc.layouts
                      .find((item) => item.ratio === moving.ratio)!
                      .panels.find((item) => item.panelId === moving.panelId)!
                      .elements.find((item) => item.elementId === moving.elementId)!.transform;
                    commit(
                      moveElements(
                        latest.current.doc,
                        moving.elementIds,
                        moving.ratio,
                        position.x - current.x,
                        position.y - current.y,
                      ),
                      latest.current.images,
                      latest.current.longEdge,
                      gestureGroup.current,
                    );
                  } else
                    commit(
                      transformElement(
                        latest.current.doc,
                        moving.elementId,
                        moving.ratio,
                        snapped.position,
                      ),
                      latest.current.images,
                      latest.current.longEdge,
                      gestureGroup.current,
                    );
                  setGuideState({
                    documentId: moving.documentId,
                    ratio: moving.ratio,
                    elementId: moving.elementId,
                    panelId: moving.panelId,
                    guides: snapped.guides,
                  });
                  setError('');
                  moving.revision = activity.current;
                } catch (cause) {
                  setError(
                    cause instanceof Error && cause.name === 'ZodError'
                      ? '요소의 위치·크기 한도를 넘을 수 없습니다. 기존 작업을 유지합니다.'
                      : message(cause),
                  );
                  drag.current = null;
                  setGuideState(null);
                }
              }}
              onPointerUp={() => {
                const held = longPress.current;
                const editId =
                  held?.ready &&
                  held.documentId === latest.current.doc.id &&
                  held.revision === activity.current
                    ? held.elementId
                    : undefined;
                clearCanvasHold();
                clearLongPress();
                gestureGroup.current = undefined;
                backgroundDrag.current = null;
                drag.current = null;
                setGuideState(null);
                if (editId) showLayerMenu(editId);
              }}
              onPointerCancel={() => {
                clearCanvasHold();
                clearLongPress();
                gestureGroup.current = undefined;
                backgroundDrag.current = null;
                drag.current = null;
                setGuideState(null);
              }}
              onLostPointerCapture={() => {
                clearCanvasHold();
                clearLongPress();
                gestureGroup.current = undefined;
                backgroundDrag.current = null;
                drag.current = null;
                setGuideState(null);
              }}
            />
            {deleteTarget &&
              !readOnly &&
              !composing &&
              deleteTarget.documentId === doc.id &&
              selectionIds.includes(deleteTarget.id) && (
                <LayerDeletePopover
                  canvas={canvas}
                  doc={doc}
                  id={deleteTarget.id}
                  onDelete={
                    selectionIds.every((id) => !doc.elements.find((item) => item.id === id)?.locked)
                      ? () => {
                          if (
                            deleteTarget.revision === activity.current &&
                            deleteTarget.documentId === latest.current.doc.id
                          )
                            removeSelection(selectionIds);
                        }
                      : undefined
                  }
                  onEdit={
                    caption && !caption.locked && !caption.hidden
                      ? () => beginInlineEditing(deleteTarget.id)
                      : undefined
                  }
                  onDetails={
                    deleteTarget.openDetails
                      ? () => {
                          setDeleteTarget(null);
                          deleteTarget.openDetails?.(false);
                        }
                      : undefined
                  }
                  onStateEdit={
                    deleteTarget.openDetails
                      ? () => {
                          setDeleteTarget(null);
                          deleteTarget.openDetails?.(true);
                        }
                      : undefined
                  }
                />
              )}
            {inlineEdit && (
              <InlineTextEditor
                canvas={canvas}
                doc={doc}
                elementId={inlineEdit.elementId}
                onSubmit={finishInlineEditing}
                onCancel={() => {
                  setInlineEdit(null);
                  refreshLayout();
                  setError('');
                }}
              />
            )}
            <SelectionOverlay canvas={canvas} doc={doc} ids={selectionIds} />
            <ResizeHandles
              canvas={canvas}
              doc={doc}
              id={selectionIds.length === 1 ? selectionIds[0] : undefined}
              disabled={
                readOnly ||
                composing ||
                resourceBusy ||
                backgroundMode ||
                multiple ||
                starterBusy ||
                backgroundBusy ||
                styleBusy ||
                fontBusy
              }
              getSnapshot={() => ({ doc: latest.current.doc, revision: activity.current })}
              beforeGesture={() => {
                clearLongPress();
                activity.current++;
                drag.current = null;
                backgroundDrag.current = null;
                setGuideState(null);
              }}
              onChange={(next, group) => {
                commit(next, latest.current.images, latest.current.longEdge, group, true);
                setError('');
              }}
              onError={(cause) => setError(`${message(cause)} 기존 작업은 그대로 유지됩니다.`)}
            />
            <TransformHandles
              canvas={canvas}
              doc={doc}
              id={selectionIds.length === 1 ? selectionIds[0] : undefined}
              disabled={
                readOnly ||
                composing ||
                resourceBusy ||
                backgroundMode ||
                multiple ||
                starterBusy ||
                backgroundBusy ||
                styleBusy ||
                fontBusy
              }
              getSnapshot={() => ({ doc: latest.current.doc, revision: activity.current })}
              beforeGesture={() => {
                clearLongPress();
                activity.current++;
                drag.current = null;
                backgroundDrag.current = null;
                setGuideState(null);
              }}
              onChange={(next, group) => {
                commit(next, latest.current.images, latest.current.longEdge, group);
                setError('');
              }}
              onError={(cause) => setError(`${message(cause)} 기존 작업은 그대로 유지됩니다.`)}
            />
            {guideState &&
              guideState.documentId === doc.id &&
              guideState.ratio === doc.activeRatio &&
              guideState.elementId === selectedId &&
              guideState.panelId === panel.id && (
                <AlignmentOverlay
                  canvas={canvas}
                  guides={guideState.guides}
                  panel={
                    doc.layouts
                      .find((layout) => layout.ratio === doc.activeRatio)!
                      .panels.find((item) => item.panelId === guideState.panelId)!.rect
                  }
                />
              )}
          </div>
        </section>
      </main>
      <div
        ref={mobileDock}
        className="mobile-tool-dock"
        role="toolbar"
        aria-label="편집 도구"
        inert={inlineEdit !== null}
      >
        <button
          type="button"
          aria-expanded={mobilePanel === 'resources'}
          aria-controls="mobile-resources-panel"
          disabled={composing}
          onClick={() => setMobilePanel(mobilePanel === 'resources' ? 'closed' : 'resources')}
        >
          <UiIcon name="folder" size={20} /> 자원
        </button>
        {mobileCategories.map((page) => (
          <button
            key={page.category}
            type="button"
            aria-expanded={mobilePanel === 'tools' && currentCategory === page.category}
            aria-controls="mobile-direct-panel"
            disabled={composing}
            onClick={() => {
              if (mobilePanel === 'tools' && currentCategory === page.category)
                setMobilePanel('closed');
              else {
                navigateTool(page.id);
                setMobilePanel('tools');
              }
            }}
          >
            <UiIcon name={page.icon} size={20} /> {page.category}
          </button>
        ))}
      </div>
      <section
        id="mobile-direct-panel"
        className="studio-direct studio-editor-tools tools"
        data-mobile-active={mobilePanel === 'tools'}
        inert={inlineEdit !== null || (!wide && mobilePanel !== 'tools')}
      >
        <ToolDeck
          pages={pages}
          activePage={activeTool}
          onPageChange={navigateTool}
          disabled={composing}
          compact={wide}
          label="편집 도구 상세"
          mode="stacked"
        />
      </section>
      <aside className="studio-sidebar">
        <div
          id="mobile-resources-panel"
          className="studio-resources top-resource-area"
          data-mobile-active={mobilePanel === 'resources'}
          inert={!wide && mobilePanel !== 'resources'}
        >
          {resources}
        </div>
      </aside>
      <p className="status studio-status" role="status">
        {notice}
      </p>
      {error && (
        <p className="error studio-error" role="alert">
          {error}
        </p>
      )}
      {resourceGhost && (
        <div
          className="resource-drag-ghost"
          aria-hidden="true"
          style={{ left: resourceGhost.x, top: resourceGhost.y }}
        >
          자원
        </div>
      )}
    </div>
  );

  function selectElement(id: string) {
    if (!id || !latest.current.doc.elements.some((element) => element.id === id)) {
      selectGroup([]);
      return;
    }
    clearLongPress();
    setDeleteTarget(null);
    activity.current++;
    cancelFontSelection();
    adoptSelection(latest.current.doc, {
      panelId: latest.current.doc.panels.find((owner) => owner.elementIds.includes(id))!.id,
      ids: [id],
    });
    const element = latest.current.doc.elements.find((item) => item.id === id);
    if (element) focusElementTool(element.kind);
  }

  function selectGroup(ids: string[], nextPanelId = selectionRef.current.panelId) {
    clearLongPress();
    setDeleteTarget(null);
    activity.current++;
    cancelFontSelection();
    drag.current = null;
    setGuideState(null);
    const current = latest.current.doc;
    adoptSelection(current, { panelId: nextPanelId, ids });
    if (!ids.length) setMultiple(false);
    if (selectionRef.current.ids.length > 1) {
      changeTool('layers');
    } else {
      const selected = current.elements.find((item) => item.id === selectionRef.current.ids[0]);
      if (selected) focusElementTool(selected.kind);
    }
  }

  function focusElementTool(kind: StudioDocument['elements'][number]['kind']) {
    const tool =
      kind === 'text' || kind === 'bubble'
        ? 'text'
        : kind === 'panel-background'
          ? 'background'
          : kind === 'frame' || kind === 'shape'
            ? 'style'
            : 'layers';
    changeTool(tool);
  }

  function applyDocument(nextDoc: StudioDocument, nextImages: ReadonlyMap<string, PreparedImage>) {
    nextDoc = ensurePanelBackgroundLayers(nextDoc);
    clearLongPress();
    setDeleteTarget(null);
    resourceRequest.current++;
    resourceGesture.current = null;
    setResourceBusy(false);
    setResourceGhost(null);
    setInlineEdit(null);
    cancelFontSelection();
    backgroundDrag.current = null;
    setBackgroundMode(false);
    const candidate = makeSession(nextDoc, nextImages, latest.current.longEdge);
    history.current.clear();
    setCounts({ undo: 0, redo: 0 });
    inputGroup.current = undefined;
    gestureGroup.current = undefined;
    drag.current = null;
    setMultiple(false);
    setGuideState(null);
    activity.current++;
    setDraftText(null);
    const firstPanel = nextDoc.panels[0]!;
    adoptSelection(nextDoc, {
      panelId: firstPanel.id,
      ids: firstPanel.elementIds.length ? [firstPanel.elementIds.at(-1)!] : [],
    });
    latest.current = candidate;
    setSession(candidate);
    setError('');
    setNotice('템플릿을 불러왔습니다.');
  }
}

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    ensureBuiltinFonts()
      .then(() => {
        if (alive) {
          document.body.dataset.fontsReady = 'true';
          setReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(`기본 글꼴을 불러오지 못했습니다. ${message(cause)}`);
      });
    return () => {
      alive = false;
    };
  }, []);
  if (error)
    return (
      <main className="font-loading">
        <p role="alert">{error}</p>
        <button onClick={() => window.location.reload()}>글꼴 다시 불러오기</button>
      </main>
    );
  if (!ready)
    return (
      <main className="font-loading">
        <p role="status">기본 글꼴 3종을 준비하고 있습니다…</p>
      </main>
    );
  return <Editor />;
}
