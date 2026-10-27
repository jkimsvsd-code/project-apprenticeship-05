import { useLayoutEffect, useRef, useState } from 'react';
import type { StudioDocument, StudioElement } from '@jjal/document-model';
import { changeDocument, newElementDimensions, shapeAppearance } from '@jjal/editor-core';
import { canvasSize } from '@jjal/policies';
import { renderShapePreview } from '@jjal/renderer';

type Shape = Extract<StudioElement, { kind: 'shape' }>['shape'];
const shapes: { shape: Shape; label: string }[] = [
  { shape: 'rect', label: '정사각형' },
  { shape: 'ellipse', label: '원' },
  { shape: 'triangle', label: '정삼각형' },
  { shape: 'diamond', label: '마름모' },
];

function ShapePreview({ shape, width, height }: { shape: Shape; width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    if (canvas.current)
      renderShapePreview(
        canvas.current,
        {
          id: 'shape-preview',
          locked: false,
          hidden: false,
          ...shapeAppearance(shape),
        },
        width,
        height,
      );
  }, [shape, width, height]);
  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      data-shape-preview={shape}
      data-logical-width={width}
      data-logical-height={height}
    />
  );
}

export function ShapeTools({
  doc,
  targetId,
  panelId,
  disabled,
  onAdd,
  onChange,
  onError,
}: {
  doc: StudioDocument;
  targetId: string | undefined;
  panelId: string;
  disabled: boolean;
  onAdd: (shape: Shape) => void;
  onChange: (doc: StudioDocument) => void;
  onError: (cause: unknown) => void;
}) {
  const [hex, setHex] = useState<string | null>(null);
  const target = doc.elements.find((item) => item.id === targetId);
  const element = target?.kind === 'shape' ? target : undefined;
  const panel = doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)!
    .panels.find((panel) => panel.panelId === panelId)!;
  const logical = canvasSize(doc.activeRatio);
  const panelWidth = panel.rect.width * logical.width,
    panelHeight = panel.rect.height * logical.height;
  function fill(color: string) {
    if (!element || element.locked || element.hidden || disabled) return;
    try {
      onChange(
        changeDocument(doc, (draft) => {
          const item = draft.elements.find((item) => item.id === element.id)!;
          if (item.kind === 'shape') item.fill = color;
        }),
      );
    } catch {
      onError(new Error('색은 #과 6자리 HEX로 입력해 주세요. 기존 작업은 유지됩니다.'));
    }
  }
  return (
    <section className="tool-section shape-tools" aria-label="도형 추가와 편집">
      <fieldset disabled={disabled}>
        <legend>도형 추가</legend>
        <div className="element-buttons shape-options">
          {shapes.map(({ shape, label }) => {
            const size = newElementDimensions('shape', panelWidth, panelHeight, shape);
            return (
              <button
                type="button"
                key={shape}
                className="shape-option"
                aria-label={`${label} 추가`}
                onClick={() => onAdd(shape)}
              >
                <ShapePreview
                  shape={shape}
                  width={size.width * panelWidth}
                  height={size.height * panelHeight}
                />
              </button>
            );
          })}
        </div>
      </fieldset>
      {element && (
        <fieldset disabled={disabled || element.locked || element.hidden}>
          <legend>도형 채우기</legend>
          <div className="element-grid">
            <label>
              채우기 색
              <input
                type="color"
                aria-label="도형 채우기 색"
                value={element.fill}
                onChange={(event) => fill(event.target.value)}
              />
            </label>
            <label>
              채우기 색 (HEX)
              <input
                type="text"
                aria-label="도형 채우기 색 (HEX)"
                maxLength={7}
                value={hex ?? element.fill}
                onChange={(event) => setHex(event.target.value)}
                onBlur={() => {
                  if (hex !== null) fill(hex);
                  setHex(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </label>
          </div>
        </fieldset>
      )}
    </section>
  );
}
