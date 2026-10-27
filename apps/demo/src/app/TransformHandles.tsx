import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { BubbleAppearance, StudioDocument } from '@jjal/document-model';
import { changeElementStyle, transformElement } from '@jjal/editor-core';
import { canvasSize } from '@jjal/policies';
import { editorHandleLayout } from '../composition/editorHandleLayout';
import {
  canvasPointToElement,
  elementPointToCanvas,
  normalizeRotation,
  pointerAngleDelta,
  tailFromElementPoint,
  type ElementFrame,
  type Point,
} from '../composition/transformGeometry';

interface Snapshot {
  doc: StudioDocument;
  revision: number;
}
interface Gesture {
  pointerId: number;
  mode: 'rotation' | 'tail';
  documentId: string;
  elementId: string;
  ratio: StudioDocument['activeRatio'];
  revision: number;
  frame: ElementFrame;
  startClient: Point;
  startPoint: Point;
  previous: Point;
  rotation: number;
  tail: NonNullable<BubbleAppearance['tail']> | undefined;
  readyAt: number;
  width: number;
  height: number;
  group: symbol;
}

function frameFor(doc: StudioDocument, id: string): ElementFrame | undefined {
  const placed = doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)
    ?.panels.find((panel) => panel.elements.some((element) => element.elementId === id));
  const element = placed?.elements.find((element) => element.elementId === id);
  if (!placed || !element) return;
  const size = canvasSize(doc.activeRatio, 1080);
  return {
    transform: { ...element.transform },
    panel: {
      x: placed.rect.x * size.width,
      y: placed.rect.y * size.height,
      width: placed.rect.width * size.width,
      height: placed.rect.height * size.height,
    },
  };
}

/** DOM overlays share renderer coordinates, and are never painted into exported artwork. */
export function TransformHandles({
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
  const frame = id ? frameFor(doc, id) : undefined;
  const enabled =
    !disabled &&
    !!element &&
    !element.locked &&
    !element.hidden &&
    !!frame &&
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
  if (!enabled || !frame || !element || !id) return null;
  const logical = canvasSize(doc.activeRatio, 1080);
  const toScreen = (point: Point) => ({
    x: (point.x * box.width) / logical.width,
    y: (point.y * box.height) / logical.height,
  });
  const center = toScreen(elementPointToCanvas(frame, { x: 0.5, y: 0.5 }));
  const tail = element.kind === 'bubble' && element.shape !== 'caption' ? element.tail : null;
  const handleLayout =
    element.kind === 'bubble' || element.kind === 'shape'
      ? editorHandleLayout({
          center,
          width: (frame.transform.width * frame.panel.width * box.width) / logical.width,
          height: (frame.transform.height * frame.panel.height * box.height) / logical.height,
          rotation: frame.transform.rotation,
          edges: true,
          stage: {
            left: -box.left,
            top: -box.top,
            width: box.parentWidth,
            height: box.parentHeight,
          },
          ...(tail ? { tail: toScreen(elementPointToCanvas(frame, tail)) } : {}),
        })
      : null;
  // Plain text/images keep their existing four-corner and rotation positions.
  const legacyTop = toScreen(
    elementPointToCanvas(
      { ...frame, transform: { ...frame.transform, flipX: false, flipY: false } },
      { x: 0.5, y: 0 },
    ),
  );
  const angle = (frame.transform.rotation * Math.PI) / 180;
  const nominal = { x: legacyTop.x + Math.sin(angle) * 36, y: legacyTop.y - Math.cos(angle) * 36 };
  const clampAxis = (value: number, origin: number, extent: number) =>
    extent < 44
      ? extent / 2 - origin
      : Math.max(22 - origin, Math.min(extent - origin - 22, value));
  const clampScreen = (point: Point) => ({
    x: clampAxis(point.x, box.left, box.parentWidth),
    y: clampAxis(point.y, box.top, box.parentHeight),
  });
  const coversCenter = (point: Point) =>
    Math.abs(point.x - center.x) < 34 && Math.abs(point.y - center.y) < 34;
  let legacyKnob = clampScreen(nominal);
  if (!handleLayout && coversCenter(legacyKnob)) {
    legacyKnob =
      [
        { x: center.x, y: center.y - 44 },
        { x: center.x + 44, y: center.y },
        { x: center.x, y: center.y + 44 },
        { x: center.x - 44, y: center.y },
      ]
        .map(clampScreen)
        .filter((point) => !coversCenter(point))
        .sort(
          (a, b) =>
            Math.hypot(a.x - nominal.x, a.y - nominal.y) -
            Math.hypot(b.x - nominal.x, b.y - nominal.y),
        )[0] ?? legacyKnob;
  }
  const top = handleLayout?.top ?? legacyTop,
    knob = handleLayout?.rotation ?? legacyKnob,
    tailPoint = handleLayout?.tail;

  function pointAt(
    event: { clientX: number; clientY: number },
    rect: DOMRect,
    ratio: StudioDocument['activeRatio'],
  ): Point {
    const size = canvasSize(ratio, 1080);
    return {
      x: ((event.clientX - rect.left) * size.width) / rect.width,
      y: ((event.clientY - rect.top) * size.height) / rect.height,
    };
  }
  function end(pointerId: number) {
    if (gesture.current?.pointerId === pointerId) gesture.current = null;
  }
  function start(event: React.PointerEvent<HTMLButtonElement>, mode: Gesture['mode']) {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    event.preventDefault();
    event.stopPropagation();
    beforeGesture();
    const current = getSnapshot();
    const selected = current.doc.elements.find((item) => item.id === id);
    const startFrame = frameFor(current.doc, id!);
    const rect = canvas.current?.getBoundingClientRect();
    if (
      disabled ||
      !selected ||
      selected.locked ||
      selected.hidden ||
      !startFrame ||
      !rect ||
      !rect.width ||
      !rect.height
    )
      return;
    const point = pointAt(event, rect, current.doc.activeRatio);
    gesture.current = {
      pointerId: event.pointerId,
      mode,
      documentId: current.doc.id,
      elementId: id!,
      ratio: current.doc.activeRatio,
      revision: current.revision,
      frame: startFrame,
      startClient: { x: event.clientX, y: event.clientY },
      startPoint: point,
      previous: point,
      rotation: startFrame.transform.rotation,
      tail: selected.kind === 'bubble' ? (selected.tail ?? undefined) : undefined,
      readyAt: performance.now() + (event.pointerType === 'touch' ? 350 : 0),
      width: rect.width,
      height: rect.height,
      group: Symbol(mode),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: React.PointerEvent<HTMLButtonElement>) {
    const moving = gesture.current;
    if (!moving || moving.pointerId !== event.pointerId) return;
    const current = getSnapshot(),
      rect = canvas.current?.getBoundingClientRect();
    const selected = current.doc.elements.find((item) => item.id === moving.elementId);
    if (
      disabled ||
      !selected ||
      selected.locked ||
      selected.hidden ||
      !rect ||
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
      if (
        Math.hypot(event.clientX - moving.startClient.x, event.clientY - moving.startClient.y) > 10
      )
        gesture.current = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const point = pointAt(event, rect, moving.ratio);
    try {
      if (moving.mode === 'rotation') {
        const center = elementPointToCanvas(moving.frame, { x: 0.5, y: 0.5 });
        const delta = pointerAngleDelta(center, moving.previous, point);
        if (Math.abs(delta) < 0.0001) return;
        moving.rotation += delta;
        onChange(
          transformElement(current.doc, moving.elementId, moving.ratio, {
            rotation: normalizeRotation(moving.rotation),
          }),
          moving.group,
        );
      } else {
        if (
          selected.kind !== 'bubble' ||
          !selected.tail ||
          selected.shape === 'caption' ||
          !moving.tail
        ) {
          gesture.current = null;
          return;
        }
        const start = canvasPointToElement(moving.frame, moving.startPoint),
          next = canvasPointToElement(moving.frame, point);
        const nextTail = tailFromElementPoint({
          x: moving.tail.x + next.x - start.x,
          y: moving.tail.y + next.y - start.y,
        });
        if (JSON.stringify(nextTail) === JSON.stringify(selected.tail)) return;
        onChange(
          changeElementStyle(current.doc, moving.elementId, { bubble: { tail: nextTail } }),
          moving.group,
        );
      }
      moving.previous = point;
      moving.revision = getSnapshot().revision;
    } catch (cause) {
      gesture.current = null;
      onError(cause);
    }
  }
  function keyboard(event: React.KeyboardEvent<HTMLButtonElement>, mode: Gesture['mode']) {
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    beforeGesture();
    const current = getSnapshot(),
      selected = current.doc.elements.find((item) => item.id === id),
      currentFrame = frameFor(current.doc, id!);
    if (!selected || selected.locked || selected.hidden || !currentFrame || disabled) return;
    try {
      const positive = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      if (mode === 'rotation') {
        onChange(
          transformElement(current.doc, id!, current.doc.activeRatio, {
            rotation: normalizeRotation(
              currentFrame.transform.rotation + (positive ? 1 : -1) * (event.shiftKey ? 15 : 1),
            ),
          }),
        );
      } else if (selected.kind === 'bubble' && selected.tail && selected.shape !== 'caption') {
        const step = event.shiftKey ? 0.1 : 0.01;
        const x =
          selected.tail.x +
          (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0);
        const y =
          selected.tail.y +
          (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0);
        onChange(
          changeElementStyle(current.doc, id!, {
            bubble: { tail: tailFromElementPoint({ x, y }) },
          }),
        );
      }
    } catch (cause) {
      onError(cause);
    }
  }
  return (
    <div
      className="transform-handles"
      role="group"
      aria-label="선택 요소 회전과 꼬리 조절"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
    >
      <span
        className="rotation-stem"
        aria-hidden="true"
        style={{
          left: top.x,
          top: top.y,
          height: Math.hypot(knob.x - top.x, knob.y - top.y),
          transform: `rotate(${Math.atan2(top.x - knob.x, knob.y - top.y)}rad)`,
        }}
      />
      <button
        type="button"
        className="rotation-handle"
        data-transform-handle="rotation"
        aria-label="요소 회전 조절"
        style={{ left: knob.x, top: knob.y }}
        onPointerDown={(event) => start(event, 'rotation')}
        onPointerMove={move}
        onPointerUp={(event) => end(event.pointerId)}
        onPointerCancel={(event) => end(event.pointerId)}
        onLostPointerCapture={(event) => end(event.pointerId)}
        onKeyDown={(event) => keyboard(event, 'rotation')}
      >
        <span aria-hidden="true">↻</span>
      </button>
      {tailPoint && (
        <button
          type="button"
          className="bubble-tail-handle"
          data-transform-handle="tail"
          aria-label="말풍선 꼬리 조절"
          style={{ left: tailPoint.x, top: tailPoint.y }}
          onPointerDown={(event) => start(event, 'tail')}
          onPointerMove={move}
          onPointerUp={(event) => end(event.pointerId)}
          onPointerCancel={(event) => end(event.pointerId)}
          onLostPointerCapture={(event) => end(event.pointerId)}
          onKeyDown={(event) => keyboard(event, 'tail')}
        >
          <span aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
