import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { ElementTransform, StudioDocument } from '@jjal/document-model';
import {
  resizeDocumentElementFromCorner,
  resizeDocumentElementFromEdge,
  type ResizeCorner,
  type ResizeEdge,
} from '@jjal/editor-core';
import { canvasSize } from '@jjal/policies';
import { editorHandleLayout } from '../composition/editorHandleLayout';
import { elementPointToCanvas } from '../composition/transformGeometry';

const corners = {
  nw: { x: -1, y: -1, label: '왼쪽 위' },
  ne: { x: 1, y: -1, label: '오른쪽 위' },
  sw: { x: -1, y: 1, label: '왼쪽 아래' },
  se: { x: 1, y: 1, label: '오른쪽 아래' },
} as const;
const edges = {
  n: { x: 0, y: -1, label: '위' },
  e: { x: 1, y: 0, label: '오른쪽' },
  s: { x: 0, y: 1, label: '아래' },
  w: { x: -1, y: 0, label: '왼쪽' },
} as const;
type ResizeHandle = ResizeCorner | ResizeEdge;
const points = { ...corners, ...edges };
function isEdgeHandle(handle: ResizeHandle): handle is ResizeEdge {
  return handle.length === 1;
}
interface Snapshot {
  doc: StudioDocument;
  revision: number;
}
interface Gesture {
  pointerId: number;
  handle: ResizeHandle;
  documentId: string;
  elementId: string;
  ratio: StudioDocument['activeRatio'];
  startX: number;
  startY: number;
  readyAt: number;
  transform: ElementTransform;
  fontSize: number | undefined;
  revision: number;
  width: number;
  height: number;
  panelWidth: number;
  panelHeight: number;
  group: symbol;
}

/** Accessible DOM controls; no selection decoration is painted into exported images. */
export function ResizeHandles({
  canvas,
  doc,
  id,
  disabled,
  getSnapshot,
  beforeGesture,
  onChange,
  onError,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  doc: StudioDocument;
  id: string | undefined;
  disabled: boolean;
  getSnapshot: () => Snapshot;
  beforeGesture: () => void;
  onChange: (doc: StudioDocument, group?: symbol) => void;
  onError: (cause: unknown) => void;
}) {
  const [box, setBox] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    parentWidth: 0,
    parentHeight: 0,
  });
  const gesture = useRef<Gesture | null>(null);
  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const measure = () => {
      const rect = target.getBoundingClientRect(),
        parent = target.parentElement!.getBoundingClientRect();
      setBox({
        left: rect.left - parent.left,
        top: rect.top - parent.top,
        width: rect.width,
        height: rect.height,
        parentWidth: parent.width,
        parentHeight: parent.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    observer.observe(target.parentElement!);
    return () => observer.disconnect();
  }, [canvas]);

  const element = doc.elements.find((item) => item.id === id);
  const panel = doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)!
    .panels.find((panel) => panel.elements.some((item) => item.elementId === id));
  const placed = panel?.elements.find((item) => item.elementId === id);
  const enabled =
    !disabled &&
    !!element &&
    !element.locked &&
    !element.hidden &&
    !!panel &&
    !!placed &&
    box.width > 0 &&
    box.height > 0;
  useEffect(() => {
    gesture.current = null;
  }, [
    enabled,
    id,
    doc.id,
    doc.activeRatio,
    box.width,
    box.height,
    box.parentWidth,
    box.parentHeight,
  ]);
  if (!enabled || !panel || !placed) return null;
  const logical = canvasSize(doc.activeRatio, 1080),
    t = placed.transform;
  const pw = panel.rect.width * logical.width,
    ph = panel.rect.height * logical.height;
  const angle = (t.rotation * Math.PI) / 180,
    cos = Math.cos(angle),
    sin = Math.sin(angle);
  const cx = panel.rect.x * logical.width + (t.x + t.width / 2) * pw;
  const cy = panel.rect.y * logical.height + (t.y + t.height / 2) * ph;
  const tail = element.kind === 'bubble' && element.shape !== 'caption' ? element.tail : null;
  const tailPoint = tail
    ? elementPointToCanvas(
        {
          transform: t,
          panel: {
            x: panel.rect.x * logical.width,
            y: panel.rect.y * logical.height,
            width: pw,
            height: ph,
          },
        },
        tail,
      )
    : undefined;
  const independentAxes = element.kind === 'bubble' || element.kind === 'shape';
  const handleLayout = independentAxes
    ? editorHandleLayout({
        center: { x: (cx * box.width) / logical.width, y: (cy * box.height) / logical.height },
        width: (t.width * pw * box.width) / logical.width,
        height: (t.height * ph * box.height) / logical.height,
        rotation: t.rotation,
        edges: true,
        stage: {
          left: -box.left,
          top: -box.top,
          width: box.parentWidth,
          height: box.parentHeight,
        },
        ...(tailPoint
          ? {
              tail: {
                x: (tailPoint.x * box.width) / logical.width,
                y: (tailPoint.y * box.height) / logical.height,
              },
            }
          : {}),
      })
    : null;

  function apply(
    current: Snapshot,
    start: ElementTransform,
    handle: ResizeHandle,
    dx: number,
    dy: number,
    width: number,
    height: number,
    panelWidth: number,
    panelHeight: number,
    fontSize: number | undefined,
    group?: symbol,
  ) {
    const size = canvasSize(current.doc.activeRatio, 1080);
    const scaleX = width / size.width,
      scaleY = height / size.height;
    const compactGeometry =
      fontSize !== undefined ||
      current.doc.elements.find((item) => item.id === id)?.kind === 'shape';
    const input = {
      transform: start,
      dx: dx / scaleX,
      dy: dy / scaleY,
      panelWidth,
      panelHeight,
      // Text and shapes may be smaller than their separate 44px handle hit targets.
      minWidth: (compactGeometry ? 1 : 44) / scaleX,
      minHeight: (compactGeometry ? 1 : 44) / scaleY,
    };
    const resized = isEdgeHandle(handle)
      ? resizeDocumentElementFromEdge(current.doc, id!, current.doc.activeRatio, {
          ...input,
          edge: handle,
        })
      : resizeDocumentElementFromCorner(current.doc, id!, current.doc.activeRatio, {
          ...input,
          ...(fontSize === undefined ? {} : { fontSize }),
          corner: handle,
        });
    onChange(resized, group);
  }

  return (
    <div
      className="resize-handles"
      role="group"
      aria-label="선택 요소 크기 조절"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      {(Object.keys(independentAxes ? points : corners) as ResizeHandle[]).map((handle) => {
        const point = points[handle];
        const edge = isEdgeHandle(handle);
        const dx = (point.x * Math.max(t.width * pw, (64 * logical.width) / box.width)) / 2,
          dy = (point.y * Math.max(t.height * ph, (64 * logical.height) / box.height)) / 2;
        const { x, y } = handleLayout?.resize[handle] ?? {
          x: Math.max(
            0,
            Math.min(box.width, ((cx + cos * dx - sin * dy) * box.width) / logical.width),
          ),
          y: Math.max(
            0,
            Math.min(box.height, ((cy + sin * dx + cos * dy) * box.height) / logical.height),
          ),
        };
        const end = (pointerId: number) => {
          if (gesture.current?.pointerId === pointerId) gesture.current = null;
        };
        return (
          <button
            key={handle}
            type="button"
            className={`resize-handle${edge ? ' resize-edge-handle' : ''}`}
            data-resize-handle={edge ? undefined : handle}
            data-resize-edge={edge ? handle : undefined}
            aria-label={
              edge
                ? `${element.kind === 'shape' ? '도형' : '말풍선'} ${handle === 'e' || handle === 'w' ? '가로' : '세로'} 크기 조절 ${point.label}`
                : `요소 크기 조절 ${point.label}`
            }
            style={{
              left: x,
              top: y,
              cursor: edge
                ? (handle === 'e' || handle === 'w') === Math.abs(cos) >= Math.abs(sin)
                  ? 'ew-resize'
                  : 'ns-resize'
                : handle === 'nw' || handle === 'se'
                  ? 'nwse-resize'
                  : 'nesw-resize',
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || !event.isPrimary || gesture.current) return;
              event.preventDefault();
              event.stopPropagation();
              beforeGesture();
              const current = getSnapshot();
              const target = canvas.current!.getBoundingClientRect();
              const selected = current.doc.elements.find((item) => item.id === id);
              const currentPanel = current.doc.layouts
                .find((layout) => layout.ratio === current.doc.activeRatio)
                ?.panels.find((item) => item.elements.some((placed) => placed.elementId === id));
              const currentTransform = currentPanel?.elements.find(
                (item) => item.elementId === id,
              )?.transform;
              if (
                !selected ||
                (edge && selected.kind !== 'bubble' && selected.kind !== 'shape') ||
                selected.locked ||
                selected.hidden ||
                !currentPanel ||
                !currentTransform
              )
                return;
              const currentSize = canvasSize(current.doc.activeRatio, 1080);
              gesture.current = {
                pointerId: event.pointerId,
                handle,
                documentId: current.doc.id,
                elementId: id!,
                ratio: current.doc.activeRatio,
                startX: event.clientX,
                startY: event.clientY,
                readyAt: performance.now() + (event.pointerType === 'touch' ? 350 : 0),
                transform: { ...currentTransform },
                fontSize:
                  selected.kind === 'text' || selected.kind === 'bubble'
                    ? selected.style.fontSize
                    : undefined,
                revision: current.revision,
                width: target.width,
                height: target.height,
                panelWidth: currentPanel.rect.width * currentSize.width,
                panelHeight: currentPanel.rect.height * currentSize.height,
                group: Symbol('resize'),
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const moving = gesture.current;
              if (!moving || moving.pointerId !== event.pointerId) return;
              const current = getSnapshot(),
                rect = canvas.current!.getBoundingClientRect();
              const selected = current.doc.elements.find((item) => item.id === moving.elementId);
              if (
                disabled ||
                !selected ||
                selected.locked ||
                selected.hidden ||
                current.revision !== moving.revision ||
                current.doc.id !== moving.documentId ||
                current.doc.activeRatio !== moving.ratio ||
                id !== moving.elementId ||
                Math.abs(rect.width - moving.width) > 0.5 ||
                Math.abs(rect.height - moving.height) > 0.5
              ) {
                gesture.current = null;
                return;
              }
              if (performance.now() < moving.readyAt) {
                if (Math.hypot(event.clientX - moving.startX, event.clientY - moving.startY) > 10)
                  gesture.current = null;
                return;
              }
              event.preventDefault();
              try {
                apply(
                  current,
                  moving.transform,
                  moving.handle,
                  event.clientX - moving.startX,
                  event.clientY - moving.startY,
                  moving.width,
                  moving.height,
                  moving.panelWidth,
                  moving.panelHeight,
                  moving.fontSize,
                  moving.group,
                );
                moving.revision = getSnapshot().revision;
              } catch (cause) {
                gesture.current = null;
                onError(cause);
              }
            }}
            onPointerUp={(event) => end(event.pointerId)}
            onPointerCancel={(event) => end(event.pointerId)}
            onLostPointerCapture={(event) => end(event.pointerId)}
            onKeyDown={(event) => {
              const vectors = {
                ArrowLeft: [-1, 0],
                ArrowRight: [1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              };
              if (
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                !Object.hasOwn(vectors, event.key)
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              beforeGesture();
              const delta = vectors[event.key as keyof typeof vectors]!,
                step = event.shiftKey ? 10 : 1;
              try {
                apply(
                  getSnapshot(),
                  t,
                  handle,
                  delta[0]! * step,
                  delta[1]! * step,
                  box.width,
                  box.height,
                  pw,
                  ph,
                  element.kind === 'text' || element.kind === 'bubble'
                    ? element.style.fontSize
                    : undefined,
                );
              } catch (cause) {
                onError(cause);
              }
            }}
          >
            <span aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
