import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { StudioDocument, StudioElement } from '@jjal/document-model';
import type { PreparedImage } from '@jjal/image-io';
import { RESOURCE_DRAG_MIME, parseResourceDragId } from '../composition/resources';
import {
  LAYER_DRAG_MIME,
  canInsertLayer,
  layerInsertionAt,
  type LayerInsertion,
} from '../composition/layerOrder';
import { UiIcon } from './UiIcon';
import { LayerBadgeDialog, type LayerBadgeAction } from './LayerStateBadges';
import './layer-rail-grouped.css';
export type { LayerBadgeAction } from './LayerStateBadges';
export type LayerDetailsOpener = (editing: boolean) => void;

function elementLabel(element: StudioElement) {
  return 'text' in element
    ? `${element.kind === 'bubble' ? '말풍선' : '문구'} · ${element.text.slice(0, 24) || '빈 문구'}`
    : element.kind === 'character'
      ? '캐릭터'
      : element.kind === 'frame'
        ? '컷 영역 상자'
        : element.kind === 'panel-background'
          ? '컷 배경'
          : element.kind === 'shape'
            ? '도형'
            : '이미지';
}

function Thumbnail({
  element,
  image,
}: {
  element: StudioElement;
  image: PreparedImage | undefined;
}) {
  const [preview, setPreview] = useState<{ image: PreparedImage; url: string } | null>(null);
  useEffect(() => {
    if (!image) return;
    let alive = true;
    const url = URL.createObjectURL(image.original);
    const thumbnail = new Image();
    thumbnail.onload = () => {
      if (alive) setPreview({ image, url });
    };
    thumbnail.src = url;
    return () => {
      alive = false;
      thumbnail.onload = null;
      URL.revokeObjectURL(url);
    };
  }, [image]);
  if (image)
    return preview?.image === image ? (
      <img src={preview.url} alt="" draggable={false} />
    ) : (
      <UiIcon name="image" />
    );
  return element.kind === 'text' ? (
    <span className="layer-letter" aria-hidden="true">
      {[...element.text].slice(0, 2).join('') || 'T'}
    </span>
  ) : (
    <UiIcon
      name={
        element.kind === 'bubble'
          ? 'bubble'
          : element.kind === 'frame'
            ? 'frame'
            : element.kind === 'panel-background'
              ? 'background'
              : element.kind === 'shape'
                ? 'grid'
                : 'image'
      }
    />
  );
}

export function LayerRail({
  doc,
  images,
  selectedIds,
  multiple,
  disabled,
  onSelect,
  onResourceDrop,
  onOrder,
  onContextMenu,
  onBadgeAction,
  resourceInsertion,
  onResourcePreview,
}: {
  doc: StudioDocument;
  images: ReadonlyMap<string, PreparedImage>;
  selectedIds: readonly string[];
  multiple: boolean;
  disabled: boolean;
  onSelect: (ids: string[], panelId: string) => void;
  onResourceDrop: (id: string, insertion: LayerInsertion) => void;
  onOrder: (id: string, insertion: LayerInsertion) => void;
  onContextMenu: (id: string, panelId: string, openDetails: LayerDetailsOpener) => void;
  onBadgeAction: (id: string, panelId: string, action: LayerBadgeAction) => void;
  resourceInsertion?: LayerInsertion;
  onResourcePreview?: (insertion: LayerInsertion | undefined) => void;
}) {
  const [badgeView, setBadgeView] = useState<{
    id: string;
    panelId: string;
    label: string;
    editing: boolean;
    doc: StudioDocument;
  } | null>(null);
  if (badgeView && (disabled || badgeView.doc !== doc)) setBadgeView(null);
  const [movePreview, setMovePreview] = useState<{
    doc: StudioDocument;
    insertion: LayerInsertion;
  } | null>(null);
  const dragged = useRef<string | null>(null);
  const held = useRef<{
    id: string;
    pointerId: number;
    x: number;
    y: number;
    timer: number;
    armed: boolean;
    moved: boolean;
    scrollLeft: number;
    doc: StudioDocument;
    startedAt: number;
  } | null>(null);
  const suppress = useRef(0);
  const cancel = () => {
    if (held.current) window.clearTimeout(held.current.timer);
    held.current = null;
    setMovePreview(null);
  };
  useEffect(() => {
    const clear = () => {
      cancel();
      dragged.current = null;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    window.addEventListener('blur', clear);
    window.addEventListener('resize', clear);
    window.addEventListener('keydown', escape);
    return () => {
      if (held.current) window.clearTimeout(held.current.timer);
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
      window.removeEventListener('blur', clear);
      window.removeEventListener('resize', clear);
      window.removeEventListener('keydown', escape);
    };
  }, []);
  const begin = (event: PointerEvent<HTMLButtonElement>, element: StudioElement) => {
    if (disabled || event.pointerType === 'mouse' || !event.isPrimary) return;
    cancel();
    held.current = {
      id: element.id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      armed: false,
      moved: false,
      scrollLeft: event.currentTarget.closest<HTMLElement>('.layer-rail')?.scrollLeft ?? 0,
      doc,
      startedAt: event.timeStamp,
      timer: window.setTimeout(() => {
        if (held.current) held.current.armed = true;
      }, 350),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const openMenu = (id: string, panelId: string) => {
    const owner = doc.panels.find((panel) => panel.id === panelId);
    const element = doc.elements.find((item) => item.id === id);
    if (disabled || !owner?.elementIds.includes(id) || !element) return;
    cancel();
    dragged.current = null;
    onResourcePreview?.(undefined);
    onContextMenu(id, panelId, (editing) => {
      setBadgeView({
        id,
        panelId,
        label: `${doc.panels.indexOf(owner) + 1}컷 ${elementLabel(element)}`,
        editing,
        doc,
      });
    });
  };
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = held.current;
    cancel();
    if (gesture?.moved) suppress.current = event.timeStamp + 700;
    if (disabled || !gesture || gesture.doc !== doc || !gesture.armed) return;
    if (!gesture.moved && event.timeStamp - gesture.startedAt >= 550) {
      suppress.current = event.timeStamp + 700;
      const owner = doc.panels.find((panel) => panel.elementIds.includes(gesture.id));
      if (owner) openMenu(gesture.id, owner.id);
      return;
    }
    if (!gesture.moved) return;
    const insertion = layerInsertionAt(event.clientX, event.clientY);
    if (insertion && canInsertLayer(doc, gesture.id, insertion)) onOrder(gesture.id, insertion);
  };
  const layers = doc.panels.flatMap((owner, cut) =>
    [...owner.elementIds]
      .reverse()
      .map((id) => ({ owner, cut, element: doc.elements.find((item) => item.id === id)! })),
  );
  const insertion = !disabled
    ? (resourceInsertion ?? (movePreview?.doc === doc ? movePreview.insertion : undefined))
    : undefined;
  const badgeOwner = badgeView && doc.panels.find((panel) => panel.id === badgeView.panelId);
  const badgeElement = badgeView && doc.elements.find((element) => element.id === badgeView.id);
  const badgeMembers =
    badgeOwner && badgeElement
      ? doc.elements.filter(
          (element) =>
            badgeOwner.elementIds.includes(element.id) &&
            (element.id === badgeElement.id ||
              (badgeElement.groupId && element.groupId === badgeElement.groupId)),
        )
      : [];
  return (
    <>
      <section
        className="layer-rail layer-list layer-rail-grouped"
        role="group"
        aria-label="레이어 목록"
        data-empty-panel={doc.panels[0]!.id}
        data-drop-active={Boolean(insertion)}
        data-drop-empty={Boolean(insertion && !insertion.targetId)}
        onDragOver={(event) => {
          if (
            disabled ||
            ![RESOURCE_DRAG_MIME, LAYER_DRAG_MIME].some((mime) =>
              event.dataTransfer.types.includes(mime),
            )
          ) {
            setMovePreview(null);
            onResourcePreview?.(undefined);
            return;
          }
          event.preventDefault();
          const target = layerInsertionAt(event.clientX, event.clientY);
          if (event.dataTransfer.types.includes(RESOURCE_DRAG_MIME)) {
            event.dataTransfer.dropEffect = 'copy';
            onResourcePreview?.(target);
            setMovePreview(null);
          } else {
            const id = dragged.current ?? event.dataTransfer.getData(LAYER_DRAG_MIME);
            const valid = target && canInsertLayer(doc, id, target);
            event.dataTransfer.dropEffect = valid ? 'move' : 'none';
            setMovePreview(valid ? { doc, insertion: target } : null);
          }
        }}
        onDragLeave={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return;
          setMovePreview(null);
          onResourcePreview?.(undefined);
        }}
        onDragEnd={() => {
          dragged.current = null;
          setMovePreview(null);
          onResourcePreview?.(undefined);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setMovePreview(null);
          onResourcePreview?.(undefined);
          if (disabled) return;
          const insertion = layerInsertionAt(event.clientX, event.clientY) ?? {
            panelId: doc.panels[0]!.id,
            targetId: null,
            edge: 'after' as const,
          };
          const resource = parseResourceDragId(event.dataTransfer.getData(RESOURCE_DRAG_MIME));
          if (resource) onResourceDrop(resource, insertion);
          else {
            const id = event.dataTransfer.getData(LAYER_DRAG_MIME);
            if (doc.elements.some((item) => item.id === id)) onOrder(id, insertion);
          }
        }}
      >
        <span className="layer-rail-count" role="status" aria-label="전체 레이어 수">
          레이어 {layers.length}개
        </span>
        {layers.map(({ owner, cut, element }, index) => {
          const label = elementLabel(element);
          const selected = selectedIds.includes(element.id);
          const previous = layers[index - 1],
            next = layers[index + 1];
          const previousMember = Boolean(
            element.groupId &&
            previous?.owner.id === owner.id &&
            previous.element.groupId === element.groupId,
          );
          const nextMember = Boolean(
            element.groupId &&
            next?.owner.id === owner.id &&
            next.element.groupId === element.groupId,
          );
          return (
            <div
              className="layer-item"
              key={element.id}
              data-grouped={Boolean(element.groupId)}
              data-group-overlap={previousMember}
              data-group-run={
                element.groupId
                  ? previousMember
                    ? nextMember
                      ? 'middle'
                      : 'end'
                    : nextMember
                      ? 'start'
                      : 'single'
                  : undefined
              }
            >
              <button
                type="button"
                className="layer-circle"
                data-layer-id={element.id}
                data-element-id={element.id}
                data-panel-id={owner.id}
                data-group-id={element.groupId}
                aria-label={`레이어 선택 ${index + 1}: ${cut + 1}컷 ${label}${element.locked ? ' 잠김' : ''}${element.hidden ? ' 숨김' : ''}`}
                title={`${cut + 1}컷 · ${label}${element.groupId ? ' · 그룹' : ''}`}
                aria-pressed={selected}
                data-selected={selected}
                data-hidden={element.hidden}
                data-drop-edge={insertion?.targetId === element.id ? insertion.edge : undefined}
                disabled={disabled}
                draggable={!disabled && !element.locked}
                onClick={(event) => {
                  if (event.timeStamp < suppress.current) return;
                  const groupIds = element.groupId
                    ? owner.elementIds.filter(
                        (id) =>
                          doc.elements.find((item) => item.id === id)?.groupId === element.groupId,
                      )
                    : [element.id];
                  onSelect(
                    multiple
                      ? selected
                        ? selectedIds.filter((id) => !groupIds.includes(id))
                        : [...selectedIds.filter((id) => owner.elementIds.includes(id)), element.id]
                      : [element.id],
                    owner.id,
                  );
                }}
                onDragStart={(event) => {
                  const peers = element.groupId
                    ? doc.elements.filter(
                        (item) =>
                          owner.elementIds.includes(item.id) && item.groupId === element.groupId,
                      )
                    : [element];
                  if (disabled || peers.some((item) => item.locked)) {
                    event.preventDefault();
                    return;
                  }
                  dragged.current = element.id;
                  event.dataTransfer.setData(LAYER_DRAG_MIME, element.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!disabled) {
                    suppress.current = event.timeStamp + 700;
                    openMenu(element.id, owner.id);
                  }
                }}
                onPointerDown={(event) => begin(event, element)}
                onPointerMove={(event) => {
                  const g = held.current;
                  if (!g || g.pointerId !== event.pointerId) return;
                  if (Math.hypot(event.clientX - g.x, event.clientY - g.y) <= 6) return;
                  if (!g.armed) {
                    window.clearTimeout(g.timer);
                    g.moved = true;
                    event.preventDefault();
                    const strip = event.currentTarget.closest<HTMLElement>('.layer-rail');
                    if (strip) strip.scrollLeft = g.scrollLeft - event.clientX + g.x;
                    return;
                  }
                  event.preventDefault();
                  g.moved = true;
                  const target = layerInsertionAt(event.clientX, event.clientY);
                  setMovePreview(
                    target && g.doc === doc && canInsertLayer(doc, g.id, target)
                      ? { doc, insertion: target }
                      : null,
                  );
                }}
                onPointerUp={finish}
                onPointerCancel={cancel}
                onLostPointerCapture={cancel}
              >
                <Thumbnail
                  element={element}
                  image={'assetId' in element ? images.get(element.assetId) : undefined}
                />
                {doc.panels.length > 1 && <small className="layer-cut">{cut + 1}</small>}
              </button>
            </div>
          );
        })}
        {!layers.length && <span className="layer-empty">레이어 없음</span>}
      </section>
      {!disabled && badgeView?.doc === doc && badgeElement && badgeMembers.length > 0 && (
        <LayerBadgeDialog
          label={badgeView.label}
          members={badgeMembers}
          grouped={Boolean(badgeElement.groupId)}
          editing={badgeView.editing}
          onEditing={() => setBadgeView({ ...badgeView, editing: true })}
          onClose={() => setBadgeView(null)}
          onAction={(action) => {
            setBadgeView(null);
            onBadgeAction(badgeView.id, badgeView.panelId, action);
          }}
        />
      )}
    </>
  );
}
