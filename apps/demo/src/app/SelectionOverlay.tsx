import { useLayoutEffect, useState, type RefObject } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import { canvasSize } from '@jjal/policies';

/** UI selection decorations never enter the renderer or exported pixels. */
export function SelectionOverlay({
  canvas,
  doc,
  ids,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  doc: StudioDocument;
  ids: string[];
}) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
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
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    observer.observe(target.parentElement!);
    return () => observer.disconnect();
  }, [canvas]);
  const size = canvasSize(doc.activeRatio);
  return (
    <svg
      aria-hidden="true"
      className="selection-overlay"
      style={box}
      viewBox={`0 0 ${size.width} ${size.height}`}
    >
      {doc.layouts
        .find((layout) => layout.ratio === doc.activeRatio)!
        .panels.flatMap((panel) =>
          panel.elements
            .filter(
              (item) =>
                ids.includes(item.elementId) &&
                !doc.elements.find((element) => element.id === item.elementId)!.hidden,
            )
            .map((item) => {
              const t = item.transform,
                x = (panel.rect.x + t.x * panel.rect.width) * size.width,
                y = (panel.rect.y + t.y * panel.rect.height) * size.height;
              const width = t.width * panel.rect.width * size.width,
                height = t.height * panel.rect.height * size.height;
              return (
                <rect
                  key={item.elementId}
                  data-selected-id={item.elementId}
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  transform={`rotate(${t.rotation} ${x + width / 2} ${y + height / 2})`}
                  vectorEffect="non-scaling-stroke"
                />
              );
            }),
        )}
    </svg>
  );
}
