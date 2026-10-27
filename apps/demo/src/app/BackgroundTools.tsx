import { UiIcon } from './UiIcon';
import { useRef } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import {
  backgroundValue,
  backgroundPlacement,
  changeBackground,
  placeBackground,
  setBackgroundImage,
  showBackgroundVersion,
  inheritWholeBackground,
  restorePanelBackground,
  findPanelBackground,
  type BackgroundTarget,
} from '@jjal/editor-core';
import { prepareImage, type PreparedImage } from '@jjal/image-io';
import { NumberField } from './ElementTools';
import { cachePreparedImage } from '../composition/resources';

export function BackgroundTools({
  doc,
  panelId,
  elementId,
  scope,
  onScope,
  dragging,
  onDragging,
  disabled,
  busy,
  getSnapshot,
  revision,
  onChange,
  onError,
  onBusy,
}: {
  doc: StudioDocument;
  panelId: string;
  elementId?: string | undefined;
  scope: 'whole' | 'panel';
  onScope: (value: 'whole' | 'panel') => void;
  dragging: boolean;
  onDragging: (value: boolean) => void;
  disabled: boolean;
  busy: boolean;
  getSnapshot: () => { doc: StudioDocument; images: ReadonlyMap<string, PreparedImage> };
  revision: () => number;
  onChange: (doc: StudioDocument, images?: ReadonlyMap<string, PreparedImage>) => void;
  onError: (cause: unknown) => void;
  onBusy: (busy: boolean) => void;
}) {
  const request = useRef(0);
  const singlePanel = doc.panels.length === 1;
  const target: BackgroundTarget =
    scope === 'whole' ? 'whole' : { panelId, ...(elementId ? { elementId } : {}) };
  const background = backgroundValue(doc, target);
  const originalImageAssetId = background.originalImageAssetId ?? background.imageAssetId;
  const backgroundLayer = doc.layeredPanelBackgrounds
    ? findPanelBackground(doc, { panelId, ...(elementId ? { elementId } : {}) })
    : undefined;
  const inherits =
    scope === 'panel' &&
    (backgroundLayer?.kind === 'panel-background'
      ? backgroundLayer.background.inherit
      : doc.panels.find((panel) => panel.id === panelId)!.background.inherit);
  const placement = backgroundPlacement(doc, inherits ? 'whole' : target);
  function act(work: (current: StudioDocument) => StudioDocument) {
    try {
      onChange(work(getSnapshot().doc));
    } catch (cause) {
      onError(cause);
    }
  }
  async function input(file: File, result: boolean) {
    const ticket = ++request.current,
      before = getSnapshot(),
      stamp = revision();
    onBusy(true);
    try {
      const prepared = await prepareImage(file);
      await cachePreparedImage(prepared);
      if (ticket !== request.current) return;
      if (getSnapshot().doc !== before.doc || revision() !== stamp)
        throw new Error(
          '불러오는 동안 편집 대상이나 작업이 바뀌었습니다. 배경 이미지를 다시 선택해 주세요.',
        );
      const next = setBackgroundImage(before.doc, target, prepared.asset, result);
      onChange(next, new Map([...before.images, [prepared.asset.id, prepared]]));
    } catch (cause) {
      if (ticket === request.current) onError(cause);
    } finally {
      if (ticket === request.current) onBusy(false);
    }
  }
  return (
    <section className="background-tools tool-section" aria-label="배경 편집">
      <h2>
        <UiIcon name="image" /> 배경 편집
      </h2>
      <fieldset disabled={disabled || busy}>
        <label>
          배경 적용 범위
          <select
            aria-label="배경 적용 범위"
            value={singlePanel ? 'none' : scope}
            disabled={singlePanel}
            onChange={(event) => {
              if (singlePanel) return;
              const value = event.target.value;
              if (value === 'whole' || value === 'panel') onScope(value);
            }}
          >
            {singlePanel ? (
              <option value="none">해당 없음</option>
            ) : (
              <>
                <option value="panel">현재 컷</option>
                <option value="whole">작품 전체</option>
              </>
            )}
          </select>
        </label>
        <fieldset disabled={scope === 'panel' && Boolean(backgroundLayer?.locked)}>
          <label>
            배경 색상
            <input
              aria-label="배경 색상"
              type="color"
              value={background.color}
              onChange={(event) =>
                act((doc) =>
                  changeBackground(doc, target, {
                    color: event.target.value,
                    transparent: false,
                  }),
                )
              }
            />
          </label>
          <label className="check-row">
            <input
              aria-label="배경색 없음"
              type="checkbox"
              checked={background.transparent ?? false}
              onChange={(event) =>
                act((doc) => changeBackground(doc, target, { transparent: event.target.checked }))
              }
            />
            배경색 없음
          </label>
          <label>
            배경 맞춤
            <select
              aria-label="배경 맞춤"
              value={background.fit}
              onChange={(event) =>
                act((doc) =>
                  changeBackground(doc, target, { fit: event.target.value as 'cover' | 'contain' }),
                )
              }
            >
              <option value="cover">꽉 채우기</option>
              <option value="contain">전체 보이기</option>
            </select>
          </label>

          {inherits && (
            <button onClick={() => act((doc) => changeBackground(doc, target, {}))}>
              이 컷에서 독립 편집
            </button>
          )}
          {inherits && (
            <button onClick={() => act((doc) => restorePanelBackground(doc, panelId, elementId))}>
              보관된 컷 배경 복원
            </button>
          )}
          {scope === 'panel' && doc.background && !inherits && (
            <button onClick={() => act((doc) => inheritWholeBackground(doc, panelId, elementId))}>
              이 컷에 전체 배경 사용
            </button>
          )}
          <fieldset disabled={!!inherits}>
            <div key={`${doc.id}-${doc.activeRatio}-${scope}-${panelId}-${!!inherits}`}>
              <NumberField
                label="배경 확대"
                value={Number((placement.zoom * 100).toFixed(4))}
                min={10}
                max={500}
                apply={(value) =>
                  act((doc) => placeBackground(doc, target, doc.activeRatio, { zoom: value / 100 }))
                }
              />
              <details className="precision-tools">
                <summary>정밀 조정</summary>
                <div className="element-grid">
                  <NumberField
                    label="배경 가로 위치"
                    value={Number((placement.x * 100).toFixed(4))}
                    min={-200}
                    max={200}
                    apply={(value) =>
                      act((doc) =>
                        placeBackground(doc, target, doc.activeRatio, { x: value / 100 }),
                      )
                    }
                  />
                  <NumberField
                    label="배경 세로 위치"
                    value={Number((placement.y * 100).toFixed(4))}
                    min={-200}
                    max={200}
                    apply={(value) =>
                      act((doc) =>
                        placeBackground(doc, target, doc.activeRatio, { y: value / 100 }),
                      )
                    }
                  />
                </div>
              </details>
            </div>
          </fieldset>
          <button
            disabled={!!inherits}
            onClick={() =>
              act((doc) => placeBackground(doc, target, doc.activeRatio, { x: 0, y: 0, zoom: 1 }))
            }
          >
            현재 비율 배경 배치 초기화
          </button>
          <label className="check-row">
            <input
              aria-label="배경 드래그 모드"
              type="checkbox"
              checked={dragging}
              disabled={(!background.imageAssetId || !!inherits) && !dragging}
              onChange={(event) => onDragging(event.target.checked)}
            />
            배경 드래그 모드
          </label>

          <details className="content-tools" open={scope === 'whole'}>
            <summary>이미지 파일·버전</summary>
            <label>
              새 원본 이미지 파일
              <input
                aria-label="배경 원본 파일"
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void input(file, false);
                }}
              />
            </label>
            <label>
              수정 이미지 파일
              <input
                aria-label="배경 수정 파일"
                type="file"
                disabled={!background.imageAssetId}
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (file) void input(file, true);
                }}
              />
            </label>
            <button
              disabled={!originalImageAssetId || background.imageAssetId === originalImageAssetId}
              onClick={() => act((doc) => showBackgroundVersion(doc, target, 'original'))}
            >
              원본 이미지로 복귀
            </button>
            <button
              disabled={
                !background.resultImageAssetId ||
                background.imageAssetId === background.resultImageAssetId
              }
              onClick={() => act((doc) => showBackgroundVersion(doc, target, 'result'))}
            >
              수정 이미지 다시 보기
            </button>
          </details>
        </fieldset>
      </fieldset>
      {busy && <p role="status">배경 이미지를 확인하고 있습니다…</p>}
    </section>
  );
}
