import { useEffect, useRef } from 'react';
import { addCustomBubble, createEditorDocument } from '@jjal/editor-core';
import { renderBubblePreview } from '@jjal/renderer';
import {
  customBubbleFromCandidate,
  type BubbleImportCandidate,
} from '../composition/png-bubble-import';

/** Import confirmation and the artwork use the same bubble/tail renderer. No PNG is baked into the body. */
export function BubbleImportPreview({ candidate }: { candidate: BubbleImportCandidate }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const converted = customBubbleFromCandidate(candidate);
    const prepared = addCustomBubble(
      createEditorDocument(),
      'panel-1',
      { ...candidate.image.asset, id: converted.customShape.sourceAssetId },
      converted,
    );
    const bubble = prepared.document.elements.find((element) => element.id === prepared.elementId)!;
    if (bubble.kind === 'bubble') renderBubblePreview(target, { ...bubble, text: '' }, 540, 300);
  }, [candidate]);
  return <canvas ref={canvas} width="540" height="300" role="img" aria-label="변환 미리보기" />;
}
