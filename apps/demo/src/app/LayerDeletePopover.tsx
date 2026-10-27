import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { StudioDocument } from '@jjal/document-model';

/** Touch context actions are UI only and never enter the artwork. */
export function LayerDeletePopover({
  canvas,
  doc,
  id,
  onDelete,
  onEdit,
  onDetails,
  onStateEdit,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  doc: StudioDocument;
  id: string;
  onDelete?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onDetails?: (() => void) | undefined;
  onStateEdit?: (() => void) | undefined;
}) {
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const measure = () => {
      const panel = doc.layouts
        .find((layout) => layout.ratio === doc.activeRatio)!
        .panels.find((item) => item.elements.some((element) => element.elementId === id));
      const transform = panel?.elements.find((item) => item.elementId === id)?.transform;
      if (!panel || !transform) return;
      const bounds = target.getBoundingClientRect();
      const stage = target.parentElement!.getBoundingClientRect();
      const menuHeight = menu.current?.getBoundingClientRect().height ?? 44;
      const width = transform.width * panel.rect.width * bounds.width;
      const height = transform.height * panel.rect.height * bounds.height;
      const angle = (transform.rotation * Math.PI) / 180;
      const halfX = (Math.abs(Math.cos(angle)) * width + Math.abs(Math.sin(angle)) * height) / 2;
      const halfY = (Math.abs(Math.sin(angle)) * width + Math.abs(Math.cos(angle)) * height) / 2;
      const centerX =
        bounds.left -
        stage.left +
        (panel.rect.x + (transform.x + transform.width / 2) * panel.rect.width) * bounds.width;
      const centerY =
        bounds.top -
        stage.top +
        (panel.rect.y + (transform.y + transform.height / 2) * panel.rect.height) * bounds.height;
      setPosition({
        left: Math.max(8, Math.min(stage.width - 148, centerX + halfX - 14)),
        top: Math.max(8, Math.min(stage.height - menuHeight - 8, centerY - halfY - menuHeight - 4)),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    observer.observe(target.parentElement!);
    if (menu.current) observer.observe(menu.current);
    return () => observer.disconnect();
  }, [canvas, doc, id]);
  return (
    <div
      ref={menu}
      className="layer-delete-popover"
      role="group"
      aria-label="선택 레이어 메뉴"
      style={{
        ...position,
        display: 'grid',
        gap: 4,
        width: 140,
        maxHeight: 'calc(100% - 16px)',
        overflowY: 'auto',
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {onDetails && (
        <button type="button" onClick={onDetails}>
          상세 보기
        </button>
      )}
      {onStateEdit && (
        <button type="button" onClick={onStateEdit}>
          상태 편집
        </button>
      )}
      <button type="button" disabled={!onDelete} onClick={onDelete}>
        레이어지우기
      </button>
      {onEdit && (
        <button type="button" onClick={onEdit}>
          내용 수정
        </button>
      )}
    </div>
  );
}
