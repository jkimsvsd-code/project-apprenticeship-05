import { useEffect, useRef } from 'react';
import type { StudioElement } from '@jjal/document-model';
import { UiIcon } from './UiIcon';

export type LayerBadgeAction = 'toggle-lock' | 'toggle-hidden' | 'ungroup';

export function LayerBadgeDialog({
  label,
  members,
  grouped,
  editing,
  onEditing,
  onAction,
  onClose,
}: {
  label: string;
  members: readonly StudioElement[];
  grouped: boolean;
  editing: boolean;
  onEditing: () => void;
  onAction: (action: LayerBadgeAction) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const lockedCount = members.filter((element) => element.locked).length;
  const hiddenCount = members.filter((element) => element.hidden).length;
  const allLocked = lockedCount === members.length;
  const allHidden = hiddenCount === members.length;
  return (
    <dialog
      ref={dialog}
      className="layer-badge-dialog"
      aria-label={editing ? '레이어 상태 편집' : '레이어 상태 상세'}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="layer-badge-heading">
        <h2>{editing ? '레이어 상태 편집' : '레이어 상태 상세'}</h2>
        <button type="button" aria-label="레이어 상태 닫기" onClick={onClose}>
          <UiIcon name="close" />
        </button>
      </div>
      <p className="layer-badge-summary">{label}</p>
      <dl className="layer-badge-list">
        <div>
          <dt>잠금</dt>
          <dd>{lockedCount ? `${members.length}개 중 ${lockedCount}개 잠김` : '잠금 없음'}</dd>
        </div>
        <div>
          <dt>표시</dt>
          <dd>{hiddenCount ? `${members.length}개 중 ${hiddenCount}개 숨김` : '모두 표시'}</dd>
        </div>
        <div>
          <dt>그룹</dt>
          <dd>{grouped ? `${members.length}개 묶음` : '그룹 없음'}</dd>
        </div>
      </dl>
      <div className="layer-badge-actions">
        {editing ? (
          <>
            <button type="button" onClick={() => onAction('toggle-lock')}>
              {allLocked ? '잠금 해제' : '잠금'}
            </button>
            <button type="button" onClick={() => onAction('toggle-hidden')}>
              {allHidden ? '숨김 해제' : '숨김'}
            </button>
            <button
              type="button"
              disabled={!grouped || lockedCount > 0}
              onClick={() => onAction('ungroup')}
            >
              그룹 해제
            </button>
          </>
        ) : (
          <button type="button" onClick={onEditing}>
            상태 편집
          </button>
        )}
      </div>
    </dialog>
  );
}
