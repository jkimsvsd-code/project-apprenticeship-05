import { useLayoutEffect, useState, type RefObject } from 'react';
import type { StudioDocument } from '@jjal/document-model';

/** Destination feedback is a DOM decoration, never part of the saved or exported card. */
export function ResourceDropOverlay({
  canvas,
  doc,
  panelId,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  doc: StudioDocument;
  panelId: string;
}) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const measure = () => {
      const rect = target.getBoundingClientRect();
      const parent = target.parentElement!.getBoundingClientRect();
      setBox({
        left: rect.left - parent.left,
        top: rect.top - parent.top,
        width: rect.width,
        height: rect.height,
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    observer.observe(target.parentElement!);
    return () => observer.disconnect();
  }, [canvas]);
  const panel = doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)!
    .panels.find((item) => item.panelId === panelId);
  if (!panel) return null;
  return (
    <svg
      className="resource-drop-preview"
      data-drop-panel={panelId}
      aria-hidden="true"
      style={box}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <rect
        x={panel.rect.x * 100}
        y={panel.rect.y * 100}
        width={panel.rect.width * 100}
        height={panel.rect.height * 100}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
