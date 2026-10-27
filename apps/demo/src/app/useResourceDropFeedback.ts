import { useEffect, useState, type RefObject } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import { layerInsertionAt, type LayerInsertion } from '../composition/layerOrder';
import { RESOURCE_DRAG_MIME } from '../composition/resources';

export function resourcePointAt(
  doc: StudioDocument,
  canvas: HTMLCanvasElement | null,
  clientX: number,
  clientY: number,
) {
  const rect = canvas?.getBoundingClientRect();
  if (!rect?.width || !rect.height) return;
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  if (x < 0 || y < 0 || x > 1 || y > 1) return;
  const panel = doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)!
    .panels.find(
      (item) =>
        x >= item.rect.x &&
        y >= item.rect.y &&
        x <= item.rect.x + item.rect.width &&
        y <= item.rect.y + item.rect.height,
    );
  if (!panel) return;
  return {
    panelId: panel.panelId,
    point: {
      x: (x - panel.rect.x) / panel.rect.width,
      y: (y - panel.rect.y) / panel.rect.height,
    },
  };
}

type Destination =
  { kind: 'panel'; panelId: string } | { kind: 'layer'; insertion: LayerInsertion };

export function useResourceDropFeedback(
  canvas: RefObject<HTMLCanvasElement | null>,
  getSnapshot: () => { doc: StudioDocument; revision: number },
  blocked: boolean,
  onCancel: () => void,
) {
  const [hint, setHint] = useState<{
    doc: StudioDocument;
    revision: number;
    destination: Destination;
  } | null>(null);
  const clear = () => setHint(null);
  const update = (x: number, y: number) => {
    const current = getSnapshot();
    if (blocked) return clear();
    const insertion = layerInsertionAt(x, y);
    const point = insertion ? undefined : resourcePointAt(current.doc, canvas.current, x, y);
    const destination: Destination | undefined = insertion
      ? { kind: 'layer', insertion }
      : point
        ? { kind: 'panel', panelId: point.panelId }
        : undefined;
    if (!destination) return clear();
    setHint((previous) =>
      previous?.doc === current.doc &&
      previous.revision === current.revision &&
      JSON.stringify(previous.destination) === JSON.stringify(destination)
        ? previous
        : { ...current, destination },
    );
  };
  useEffect(() => {
    const over = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes(RESOURCE_DRAG_MIME))
        update(event.clientX, event.clientY);
      else clear();
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) clear();
    };
    const cancel = () => {
      clear();
      onCancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel();
    };
    const visibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    window.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
    };
  });
  const current = getSnapshot();
  const visible =
    !blocked && hint?.doc === current.doc && hint.revision === current.revision
      ? hint.destination
      : undefined;
  return { update, clear, destination: visible };
}
