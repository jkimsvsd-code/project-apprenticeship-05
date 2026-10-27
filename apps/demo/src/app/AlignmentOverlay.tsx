import { useLayoutEffect, useState, type RefObject } from 'react';
import type { AlignmentGuide } from '@jjal/editor-core';

export function AlignmentOverlay({
  canvas,
  guides,
  panel,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  guides: AlignmentGuide[];
  panel: { x: number; y: number; width: number; height: number };
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
  return (
    <svg
      className="alignment-overlay"
      data-testid="alignment-guides"
      aria-hidden="true"
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      style={box}
    >
      {guides.map((guide) => {
        const x = panel.x + guide.position * panel.width,
          y = panel.y + guide.position * panel.height;
        return (
          <line
            key={guide.axis}
            data-axis={guide.axis}
            data-position={guide.position}
            data-source={guide.source}
            x1={guide.axis === 'x' ? x : panel.x}
            x2={guide.axis === 'x' ? x : panel.x + panel.width}
            y1={guide.axis === 'y' ? y : panel.y}
            y2={guide.axis === 'y' ? y : panel.y + panel.height}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}
