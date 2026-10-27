import { UiIcon } from './UiIcon';
import { useState } from 'react';
import type { ElementTransform, StudioDocument } from '@jjal/document-model';
import {
  addElement,
  deleteElement,
  reorderElement,
  transformElement,
  alignElement,
} from '@jjal/editor-core';
import type { PreparedImage } from '@jjal/image-io';
import { canvasSize } from '@jjal/policies';
import { BUILTIN_ASSETS, loadBuiltinCharacter } from '../composition/builtins';
import { cachePreparedImage } from '../composition/resources';

interface Props {
  doc: StudioDocument;
  panelId: string;
  selectedId: string;
  composing: boolean;
  creationDisabled: boolean;
  getSnapshot: () => {
    doc: StudioDocument;
    images: ReadonlyMap<string, PreparedImage>;
    epoch: number;
  };
  onSelect: (id: string) => void;
  onChange: (doc: StudioDocument, images?: ReadonlyMap<string, PreparedImage>) => void;
  onError: (error: unknown) => void;
  onBusyChange: (busy: boolean) => void;
  snapping: boolean;
  onSnappingChange: (value: boolean) => void;
}
export function NumberField({
  label,
  value,
  min,
  max,
  apply,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  apply: (value: number) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step="any"
        value={raw ?? String(value)}
        onChange={(event) => setRaw(event.target.value)}
        onBlur={() => {
          if (raw !== null) apply(raw.trim() ? Number(raw) : NaN);
          setRaw(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function ElementTools(props: Props) {
  const { doc, panelId, selectedId, composing } = props;
  const [character, setCharacter] = useState('starter-seed-neutral');
  const [loading, setLoading] = useState(false);
  const panel = doc.panels.find((item) => item.id === panelId)!;
  const selected = doc.elements.find(
    (item) => item.id === selectedId && panel.elementIds.includes(item.id),
  );
  const placement = doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)!
    .panels.find((item) => item.panelId === panelId)!
    .elements.find((item) => item.elementId === selected?.id);
  const index = panel.elementIds.indexOf(selectedId);
  const outside = (() => {
    if (!placement) return false;
    const rect = doc.layouts
      .find((layout) => layout.ratio === doc.activeRatio)!
      .panels.find((item) => item.panelId === panelId)!.rect;
    const size = canvasSize(doc.activeRatio),
      t = placement.transform;
    const pw = rect.width * size.width,
      ph = rect.height * size.height;
    const angle = (t.rotation * Math.PI) / 180;
    const halfWidth =
      (Math.abs(Math.cos(angle)) * t.width * pw + Math.abs(Math.sin(angle)) * t.height * ph) / 2;
    const halfHeight =
      (Math.abs(Math.sin(angle)) * t.width * pw + Math.abs(Math.cos(angle)) * t.height * ph) / 2;
    const cx = (t.x + t.width / 2) * pw,
      cy = (t.y + t.height / 2) * ph;
    return (
      cx - halfWidth < -0.001 ||
      cy - halfHeight < -0.001 ||
      cx + halfWidth > pw + 0.001 ||
      cy + halfHeight > ph + 0.001
    );
  })();
  function run(action: () => StudioDocument) {
    try {
      props.onChange(action());
    } catch (error) {
      props.onError(error);
    }
  }
  async function addCharacter() {
    if (composing || props.creationDisabled || loading) return;
    const { doc: before, epoch } = props.getSnapshot();
    const documentId = before.id;
    setLoading(true);
    props.onBusyChange(true);
    try {
      const prepared = await loadBuiltinCharacter(character);
      await cachePreparedImage(prepared);
      const current = props.getSnapshot();
      if (current.doc.id !== documentId || current.epoch !== epoch) return;
      const result = addElement(current.doc, panelId, {
        kind: 'character',
        asset: prepared.asset,
        characterId: character.startsWith('starter-seed') ? 'starter-seed' : 'starter-block',
      });
      props.onChange(result.document, new Map([...current.images, [prepared.asset.id, prepared]]));
      props.onSelect(result.elementId);
    } catch (error) {
      if (props.getSnapshot().doc.id === documentId && props.getSnapshot().epoch === epoch)
        props.onError(error);
    } finally {
      setLoading(false);
      props.onBusyChange(false);
    }
  }
  function change(patch: Partial<ElementTransform>) {
    run(() => transformElement(props.getSnapshot().doc, selectedId, doc.activeRatio, patch));
  }
  return (
    <div className="tool-section element-tools">
      <h2>
        <UiIcon name="layers" /> 요소와 레이어
      </h2>
      <fieldset disabled={props.creationDisabled || loading}>
        <legend>요소 추가</legend>
        <details className="content-tools">
          <summary>캐릭터 추가</summary>
          <label>
            캐릭터 소재
            <select
              aria-label="추가할 캐릭터"
              value={character}
              disabled={composing}
              onChange={(event) => setCharacter(event.target.value)}
            >
              {BUILTIN_ASSETS.filter((asset) => asset.category === 'character').map((asset) => (
                <option key={asset.asset.id} value={asset.asset.id}>
                  {asset.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={composing} onClick={() => void addCharacter()}>
            {loading ? '캐릭터 준비 중…' : '캐릭터 추가'}
          </button>
        </details>
      </fieldset>
      {selected && placement && (
        <fieldset disabled={composing || selected.locked}>
          <legend>선택 요소 배치</legend>
          <NumberField
            key={`${selectedId}-${doc.activeRatio}-rotation`}
            label="요소 회전"
            min={-360}
            max={360}
            value={Math.round(placement.transform.rotation * 100) / 100}
            apply={(value) => change({ rotation: value })}
          />
          <details className="precision-tools">
            <summary>정밀 조정</summary>
            <div className="element-grid">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <NumberField
                  key={`${selectedId}-${doc.activeRatio}-${key}`}
                  label={
                    {
                      x: '요소 가로 위치',
                      y: '요소 세로 위치',
                      width: '요소 폭',
                      height: '요소 높이',
                    }[key]
                  }
                  min={key === 'width' || key === 'height' ? 1 : -200}
                  max={key === 'width' || key === 'height' ? 400 : 300}
                  value={Math.round(placement.transform[key] * 10_000) / 100}
                  apply={(value) => change({ [key]: value / 100 })}
                />
              ))}
            </div>
          </details>
          <div className="element-buttons" role="group" aria-label="컷 기준 정렬">
            {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((alignment) => (
              <button
                key={alignment}
                type="button"
                onClick={() =>
                  run(() =>
                    alignElement(props.getSnapshot().doc, selectedId, doc.activeRatio, alignment),
                  )
                }
              >
                {
                  {
                    left: '왼쪽 정렬',
                    center: '가로 가운데',
                    right: '오른쪽 정렬',
                    top: '위쪽 정렬',
                    middle: '세로 가운데',
                    bottom: '아래쪽 정렬',
                  }[alignment]
                }
              </button>
            ))}
          </div>
          <div className="element-buttons">
            <button
              type="button"
              aria-pressed={placement.transform.flipX}
              onClick={() => change({ flipX: !placement.transform.flipX })}
            >
              좌우 반전
            </button>
            <button
              type="button"
              aria-pressed={placement.transform.flipY ?? false}
              onClick={() => change({ flipY: !placement.transform.flipY })}
            >
              상하 반전
            </button>
          </div>
          <div className="element-buttons">
            {(['front', 'forward', 'backward', 'back'] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                disabled={
                  direction === 'front' || direction === 'forward'
                    ? index === panel.elementIds.length - 1
                    : index === 0
                }
                onClick={() =>
                  run(() => reorderElement(props.getSnapshot().doc, selectedId, direction))
                }
              >
                {
                  {
                    front: '맨 앞으로',
                    forward: '한 단계 앞으로',
                    backward: '한 단계 뒤로',
                    back: '맨 뒤로',
                  }[direction]
                }
              </button>
            ))}
            <button
              type="button"
              onClick={() => run(() => deleteElement(props.getSnapshot().doc, selectedId))}
            >
              선택 요소 삭제
            </button>
          </div>
        </fieldset>
      )}
      {outside && (
        <p className="overflow-notice">
          선택 요소가 컷 경계를 벗어났습니다. 벗어난 부분은 다운로드에서도 잘립니다.
        </p>
      )}

      <label className="snap-option">
        <input
          type="checkbox"
          checked={props.snapping}
          onChange={(event) => props.onSnappingChange(event.target.checked)}
        />
        정렬선과 자동 맞춤
      </label>
    </div>
  );
}
