import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import { canvasSize } from '@jjal/policies';
import { fontDefinition } from '@jjal/document-model';
import {
  canvasFont,
  textContentRect,
  textBlockVerticalOffset,
  textDrawingOffset,
  wrapText,
} from '@jjal/renderer';

export function InlineTextEditor({
  canvas,
  doc,
  elementId,
  onSubmit,
  onCancel,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  doc: StudioDocument;
  elementId: string;
  onSubmit: (text: string) => boolean;
  onCancel: () => void;
}) {
  const element = doc.elements.find((item) => item.id === elementId);
  const text = element && 'text' in element ? element.text : '';
  const [value, setValue] = useState(text);
  const [composing, setComposing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
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
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, []);
  if (!element || (element.kind !== 'text' && element.kind !== 'bubble')) return null;
  const panel = doc.layouts
    .find((layout) => layout.ratio === doc.activeRatio)!
    .panels.find((item) => item.elements.some((placed) => placed.elementId === elementId));
  const placement = panel?.elements.find((item) => item.elementId === elementId);
  if (!panel || !placement) return null;
  const logical = canvasSize(doc.activeRatio, 1080);
  const t = placement.transform;
  const width = panel.rect.width * t.width * box.width;
  const height = panel.rect.height * t.height * box.height;
  const logicalWidth = panel.rect.width * t.width * logical.width;
  const logicalHeight = panel.rect.height * t.height * logical.height;
  const content = textContentRect(element, logicalWidth, logicalHeight);
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = canvasFont(element.style);
  context.textBaseline = 'top';
  const lines = wrapText(value, content.width, (text) => context.measureText(text).width);
  const verticalSpace = Math.max(
    0,
    textBlockVerticalOffset(context, element, lines, content.height) -
      textDrawingOffset(context, lines),
  );
  const sx = box.width / logical.width;
  const sy = box.height / logical.height;
  const family = element.style.font.kind === 'builtin' ? element.style.font.family : 'Noto Sans KR';
  return (
    <div
      className="inline-editor"
      role="group"
      aria-label="카드 문구 편집"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        className="inline-text-box"
        style={{
          left: box.left + (panel.rect.x + panel.rect.width * t.x) * box.width,
          top: box.top + (panel.rect.y + panel.rect.height * t.y) * box.height,
          width,
          height,
          transform: `rotate(${t.rotation}deg) scale(${t.flipX ? -1 : 1}, ${t.flipY ? -1 : 1})`,
        }}
      >
        <textarea
          ref={input}
          aria-label="카드 문구 직접 편집"
          value={value}
          spellCheck={false}
          style={{
            left: content.x * sx,
            top: content.y * sy,
            width: Math.max(1, content.width * sx),
            height: Math.max(1, content.height * sy),
            fontFamily: `"${family}", "Noto Sans KR", sans-serif`,
            fontSize: element.style.fontSize * sx,
            fontWeight: element.style.bold && fontDefinition(family).boldAvailable ? 700 : 400,
            lineHeight: element.style.lineHeight,
            color: element.style.color,
            textAlign: element.style.align,
            paddingTop: verticalSpace * sy,
          }}
          onChange={(event) => setValue(event.currentTarget.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setValue(event.currentTarget.value);
            setComposing(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (composing || event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              onSubmit(value);
            }
          }}
        />
      </div>
      <div className="inline-edit-actions">
        <button type="button" disabled={composing} onClick={() => onSubmit(value)}>
          완료
        </button>
        <button type="button" disabled={composing} onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
