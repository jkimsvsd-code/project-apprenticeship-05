import { UiIcon } from './UiIcon';
import { useState } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import {
  copyElements,
  deleteElements,
  moveElements,
  reorderPanel,
  scaleElements,
  setElementFlags,
  groupElements,
  ungroupElements,
} from '@jjal/editor-core';
import { NumberField } from './ElementTools';
import { BUILTIN_ASSETS } from '../composition/builtins';

interface Props {
  doc: StudioDocument;
  panelId: string;
  selectedIds: string[];
  composing: boolean;
  multiple: boolean;
  onMultiple: (value: boolean) => void;
  getSnapshot: () => StudioDocument;
  onSelection: (ids: string[], panelId?: string) => void;
  onChange: (doc: StudioDocument) => void;
  onError: (cause: unknown) => void;
  showSelectionList?: boolean;
}
export function GroupTools(props: Props) {
  const { doc, panelId, selectedIds: ids } = props;
  const [target, setTarget] = useState('');
  const panel = doc.panels.find((item) => item.id === panelId)!;
  const panelLayout = doc.layouts
    .find((item) => item.ratio === doc.activeRatio)!
    .panels.find((item) => item.panelId === panelId)!;
  const chosen = doc.elements.filter((item) => ids.includes(item.id));
  const locked = chosen.some((item) => item.locked);
  const allLocked = chosen.length > 0 && chosen.every((item) => item.locked);
  const allHidden = chosen.length > 0 && chosen.every((item) => item.hidden);
  const index = doc.panels.indexOf(panel);
  const destination =
    doc.panels.find((item) => item.id === target && item.id !== panelId)?.id ??
    doc.panels.find((item) => item.id !== panelId)?.id ??
    '';
  function run(action: (current: StudioDocument) => StudioDocument) {
    try {
      props.onChange(action(props.getSnapshot()));
    } catch (cause) {
      props.onError(cause);
    }
  }
  function copy(to: string) {
    try {
      const result = copyElements(props.getSnapshot(), ids, to);
      props.onChange(result.document);
      props.onSelection(result.elementIds, to);
    } catch (cause) {
      props.onError(cause);
    }
  }
  return (
    <div
      className="tool-section element-tools group-tools"
      role="region"
      aria-label="여러 요소와 컷 편집"
    >
      <h2>
        <UiIcon name="layers" /> 레이어
      </h2>
      <fieldset disabled={props.composing}>
        <legend>선택 · {ids.length}개</legend>
        <div className="element-buttons">
          <button
            type="button"
            disabled={ids.length < 2 || locked}
            onClick={() => run((current) => groupElements(current, ids))}
          >
            그룹 묶기
          </button>
          <button
            type="button"
            disabled={!chosen.some((item) => item.groupId) || locked}
            onClick={() => run((current) => ungroupElements(current, ids))}
          >
            그룹 해제
          </button>
          <button
            type="button"
            aria-pressed={props.multiple}
            onClick={() => props.onMultiple(!props.multiple)}
          >
            다중 선택
          </button>
          <button
            type="button"
            onClick={() =>
              props.onSelection(
                panel.elementIds.filter((id) => {
                  const element = doc.elements.find((item) => item.id === id)!;
                  return !element.locked && !element.hidden;
                }),
              )
            }
          >
            편집 가능한 요소 전체 선택
          </button>
          <button type="button" onClick={() => props.onSelection([])}>
            선택 해제
          </button>
        </div>
        {props.showSelectionList !== false && (
          <div className="layer-list" role="group" aria-label="레이어 목록">
            {[...panel.elementIds].reverse().map((id, index) => {
              const element = doc.elements.find((item) => item.id === id)!;
              const transform = panelLayout.elements.find(
                (item) => item.elementId === id,
              )!.transform;
              const builtin =
                'assetId' in element
                  ? BUILTIN_ASSETS.find((asset) => asset.asset.id === element.assetId)
                  : undefined;
              const label =
                element.kind === 'text' || element.kind === 'bubble'
                  ? `${element.kind === 'text' ? '문구' : '말풍선'} · ${element.text.slice(0, 12) || '빈 문구'}`
                  : `${element.kind === 'character' ? '캐릭터' : element.kind === 'frame' ? '컷 영역 상자' : element.kind === 'panel-background' ? '컷 배경' : '이미지'}${builtin ? ` · ${builtin.label}` : ''}`;
              const content = (
                <>
                  <span className="layer-name">{label}</span>
                  <span className="layer-badges">
                    {element.locked && <span>잠김</span>}
                    {element.hidden && <span>숨김</span>}
                    {transform.opacity === 0 && <span>투명</span>}
                  </span>
                </>
              );
              return props.multiple ? (
                <label key={id} className="layer-row" data-selected={ids.includes(id)}>
                  <input
                    type="checkbox"
                    data-element-id={id}
                    aria-label={`다중 선택 ${index + 1}: ${label}`}
                    checked={ids.includes(id)}
                    onChange={(event) =>
                      props.onSelection(
                        event.target.checked ? [...ids, id] : ids.filter((item) => item !== id),
                      )
                    }
                  />
                  {content}
                </label>
              ) : (
                <button
                  key={id}
                  type="button"
                  className="layer-row"
                  data-element-id={id}
                  data-selected={ids.includes(id)}
                  aria-label={`레이어 선택 ${index + 1}: ${label}`}
                  aria-pressed={ids.includes(id)}
                  onClick={() => props.onSelection([id])}
                >
                  {content}
                </button>
              );
            })}
            {!panel.elementIds.length && <p>레이어 없음</p>}
          </div>
        )}
        <div className="element-buttons">
          <button
            disabled={!ids.length}
            onClick={() => run((current) => setElementFlags(current, ids, { locked: !allLocked }))}
          >
            {allLocked ? '선택 잠금 해제' : '선택 잠금'}
          </button>
          <button
            disabled={!ids.length}
            onClick={() => run((current) => setElementFlags(current, ids, { hidden: !allHidden }))}
          >
            {allHidden ? '선택 숨김 해제' : '선택 숨김'}
          </button>
        </div>
        <fieldset disabled={!ids.length || locked}>
          <legend>선택 묶음 편집</legend>
          {ids.length > 1 && (
            <>
              <NumberField
                label="선택 묶음 배율"
                value={100}
                min={1}
                max={400}
                apply={(value) =>
                  run((current) => scaleElements(current, ids, current.activeRatio, value / 100))
                }
              />
              <details className="precision-tools">
                <summary>정밀 조정</summary>
                <div className="element-grid">
                  <NumberField
                    label="선택 묶음 가로 이동"
                    value={0}
                    min={-500}
                    max={500}
                    apply={(value) =>
                      run((current) =>
                        moveElements(current, ids, current.activeRatio, value / 100, 0),
                      )
                    }
                  />
                  <NumberField
                    label="선택 묶음 세로 이동"
                    value={0}
                    min={-500}
                    max={500}
                    apply={(value) =>
                      run((current) =>
                        moveElements(current, ids, current.activeRatio, 0, value / 100),
                      )
                    }
                  />
                </div>
              </details>
            </>
          )}
          <div className="element-buttons">
            <button onClick={() => copy(panelId)}>선택 복제</button>
            {ids.length > 1 && (
              <button onClick={() => run((current) => deleteElements(current, ids))}>
                선택 묶음 삭제
              </button>
            )}
          </div>
          <label>
            복사할 컷
            <select
              aria-label="복사할 컷"
              value={destination}
              disabled={!destination}
              onChange={(event) => setTarget(event.target.value)}
            >
              {!destination && <option value="">다른 컷이 없습니다</option>}
              {doc.panels.map(
                (item, index) =>
                  item.id !== panelId && (
                    <option key={item.id} value={item.id}>
                      {index + 1}컷
                    </option>
                  ),
              )}
            </select>
          </label>
          <button disabled={!destination} onClick={() => copy(destination)}>
            다른 컷으로 복사
          </button>
        </fieldset>
        <div className="element-buttons">
          <button
            disabled={index === 0}
            onClick={() => run((current) => reorderPanel(current, panelId, 'previous'))}
          >
            컷을 이전으로
          </button>
          <button
            disabled={index === doc.panels.length - 1}
            onClick={() => run((current) => reorderPanel(current, panelId, 'next'))}
          >
            컷을 다음으로
          </button>
        </div>
      </fieldset>
    </div>
  );
}
