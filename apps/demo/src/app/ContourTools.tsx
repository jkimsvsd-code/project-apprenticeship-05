import { useState } from 'react';
import type { Contour, StudioDocument } from '@jjal/document-model';
import { changeElementContour } from '@jjal/editor-core';
import { effectiveContour } from '@jjal/renderer';
import { NumberField } from './ElementTools';

export function ContourTools({
  doc,
  targetId,
  disabled,
  onChange,
  onError,
}: {
  doc: StudioDocument;
  targetId: string | undefined;
  disabled: boolean;
  onChange: (doc: StudioDocument) => void;
  onError: (error: unknown) => void;
}) {
  const [hex, setHex] = useState<string | null>(null);
  const element = doc.elements.find((item) => item.id === targetId);
  if (!element) return null;
  const contour = effectiveContour(element);
  function edit(patch: Partial<Contour>) {
    try {
      onChange(changeElementContour(doc, element!.id, patch));
    } catch (cause) {
      onError(
        cause instanceof Error && cause.name === 'ZodError'
          ? new Error('색은 #과 6자리 HEX, 두께는 0~30으로 입력해 주세요. 기존 작업을 유지합니다.')
          : cause,
      );
    }
  }
  return (
    <fieldset className="contour-tools" disabled={disabled || element.locked || element.hidden}>
      <legend>외곽 스타일</legend>
      <label>
        외곽 질감
        <select
          aria-label="외곽 질감"
          value={contour.texture}
          onChange={(event) => edit({ texture: event.target.value as Contour['texture'] })}
        >
          <option value="pen">펜</option>
          <option value="pencil">연필</option>
          <option value="paint">물감</option>
        </select>
      </label>
      <div className="element-grid">
        <label>
          외곽 색
          <input
            type="color"
            aria-label="외곽 색"
            value={contour.color}
            onChange={(event) => edit({ color: event.target.value })}
          />
        </label>
        <label>
          외곽 색 (HEX)
          <input
            type="text"
            aria-label="외곽 색 (HEX)"
            value={hex ?? contour.color}
            maxLength={7}
            onChange={(event) => setHex(event.target.value)}
            onBlur={() => {
              if (hex !== null) edit({ color: hex });
              setHex(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        </label>
        <NumberField
          label="외곽 두께"
          min={0}
          max={30}
          value={contour.width}
          apply={(width) => edit({ width })}
        />
      </div>
    </fieldset>
  );
}
