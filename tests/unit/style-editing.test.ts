import { describe, expect, it } from 'vitest';
import { createBuiltinDocument } from '@jjal/content';
import {
  applyStyle,
  captureStyle,
  changeElementStyle,
  createEditorDocument,
} from '@jjal/editor-core';
import { parseDocument, SavedStyleSchema, type StudioElement } from '@jjal/document-model';
import { cloneTemplateDocument } from '@jjal/template-kit';
import { textContentRect, renderDocument } from '@jjal/renderer';

const source = () => {
  const doc = createBuiltinDocument('builtin-story');
  const bubble = doc.elements.find((element) => element.kind === 'bubble')!;
  return { doc, id: bubble.id };
};
describe('말풍선·문구·내 스타일의 보존 규칙', () => {
  it('스타일은 비율에 공유하되 내용·배치·다른 컷·원본을 보존한다', () => {
    const { doc, id } = source(),
      before = structuredClone(doc);
    const next = changeElementStyle(doc, id, {
      text: { align: 'right', outline: { color: '#ff0000', width: 8 } },
      bubble: {
        fill: '#aabbcc',
        border: '#112233',
        borderWidth: 10,
        tail: { side: 'left', x: 0, y: 0.6 },
      },
    });
    expect(doc).toEqual(before);
    expect(next.layouts).toEqual(doc.layouts);
    expect(next.elements.filter((item) => item.id !== id)).toEqual(
      doc.elements.filter((item) => item.id !== id),
    );
    expect(next.elements.find((item) => item.id === id)).toMatchObject({
      text: '한번 해볼까?',
      fill: '#aabbcc',
      style: { align: 'right', outline: { width: 8 } },
    });
  });
  it.each(['top', 'right', 'bottom', 'left'] as const)('%s 꼬리가 JSON·사본에 유지된다', (side) => {
    const { doc, id } = source();
    const next = changeElementStyle(doc, id, { bubble: { tail: { side, x: 0.5, y: 0.95 } } });
    const copied = cloneTemplateDocument(parseDocument(JSON.parse(JSON.stringify(next))));
    expect(copied.elements.find((item) => item.kind === 'bubble')).toMatchObject({
      tail: { side, x: 0.5, y: 0.95 },
    });
  });
  it.each([
    { text: { outline: { color: '#ffffff', width: 21 } } },
    { text: { outline: { color: 'red', width: 4 } } },
    { bubble: { borderWidth: NaN } },
    { bubble: { borderWidth: 31 } },
    { bubble: { tail: { x: Infinity, y: 1 } } },
    { bubble: { fill: '#zzzzzz' } },
  ])('잘못된 스타일 패치는 원자적으로 거부한다: %j', (patch) => {
    const { doc, id } = source(),
      before = structuredClone(doc);
    expect(() => changeElementStyle(doc, id, patch)).toThrow();
    expect(doc).toEqual(before);
  });
  it('서식 패치에 식별자·내용·타입을 끼워 넣을 수 없다', () => {
    const { doc, id } = source(),
      before = structuredClone(doc);
    const patch = JSON.parse(
      '{"bubble":{"fill":"#ffffff","text":"덮어쓰기","id":"other"}}',
    ) as Parameters<typeof changeElementStyle>[2];
    expect(() => changeElementStyle(doc, id, patch)).toThrow();
    expect(doc).toEqual(before);
  });
  it('말풍선 스타일을 다른 말풍선·일반 문구에 재사용해도 내용과 배치를 보존한다', () => {
    const { doc: original, id } = source();
    let doc = original;
    doc = changeElementStyle(doc, id, {
      text: { align: 'left', outline: { width: 10, color: '#000000' } },
      bubble: { shape: 'speech', tail: null, fill: '#ffeecc' },
    });
    const style = captureStyle(doc, id, '나의 대화');
    expect(style).not.toHaveProperty('document');
    expect(style).not.toHaveProperty('assets');
    expect(style.text).not.toHaveProperty('text');
    for (const target of doc.elements
      .filter((item) => item.kind === 'text' || item.kind === 'bubble')
      .slice(-2)) {
      const next = applyStyle(doc, target.id, style);
      expect(next.layouts).toEqual(doc.layouts);
      expect(next.elements.find((item) => item.id === target.id)).toMatchObject({
        text: target.text,
        style: style.text,
      });
      if (target.kind === 'text')
        expect(next.elements.find((item) => item.id === target.id)).not.toHaveProperty('fill');
    }
    style.text.color = '#ff0000';
    expect(doc.elements.find((item) => item.id === id)).not.toMatchObject({
      style: { color: '#ff0000' },
    });
  });
  it('외곽선 없는 스타일은 기존 외곽선을 지우며 문구 스타일은 말풍선 모양을 유지한다', () => {
    const plain = createEditorDocument(),
      style = captureStyle(plain, 'line-1', '기본 글자');
    const { doc: original, id } = source();
    let doc = original;
    doc = changeElementStyle(doc, id, { text: { outline: { width: 8, color: '#000000' } } });
    const next = applyStyle(doc, id, style);
    const after = next.elements.find((item) => item.id === id)!;
    expect(after).toMatchObject({ shape: 'thought' });
    if ('style' in after) expect(after.style.outline).toBeUndefined();
  });
  it('이름 수정은 ID·생성 시각을 유지하며 잘못된 이름/글꼴/필드는 거부한다', () => {
    const { doc, id } = source(),
      style = captureStyle(doc, id, '처음');
    const updated = captureStyle(doc, id, '수정', style);
    expect(updated.id).toBe(style.id);
    expect(updated.createdAt).toBe(style.createdAt);
    for (const name of ['', ' ', '가'.repeat(61)])
      expect(() => captureStyle(doc, id, name)).toThrow();
    expect(
      SavedStyleSchema.safeParse({
        ...style,
        text: { ...style.text, font: { kind: 'uploaded', assetId: 'font' } },
      }).success,
    ).toBe(false);
    expect(SavedStyleSchema.safeParse({ ...style, token: 'forbidden' }).success).toBe(false);
  });
  it('잠긴 요소·이미지·없는 대상에는 스타일을 적용하지 않는다', () => {
    const { doc, id } = source(),
      style = captureStyle(doc, id, '서식');
    doc.elements.find((item) => item.id === id)!.locked = true;
    expect(() => applyStyle(doc, id, style)).toThrow('잠긴');
    expect(() => changeElementStyle(doc, id, { text: { align: 'left' } })).toThrow('잠긴');
    expect(() => applyStyle(doc, doc.elements[0]!.id, style)).toThrow();
    expect(() => applyStyle(doc, 'missing', style)).toThrow();
  });
  it('종전 v1의 외곽선·꼬리 방향 없는 문서는 그대로 파싱한다', () => {
    const { doc } = source();
    expect(parseDocument(doc)).toEqual(doc);
    expect(
      doc.elements
        .filter((element) => 'style' in element)
        .every((element) => !('outline' in element.style)),
    ).toBe(true);
  });
});

it('상단/좌측 꼬리와 외곽선 공간을 실제 문구 영역에 반영한다', () => {
  const { doc } = source();
  const bubble = doc.elements.find((element) => element.kind === 'bubble') as Extract<
    StudioElement,
    { kind: 'bubble' }
  >;
  bubble.shape = 'speech';
  bubble.tail = { x: 0.5, y: 0, side: 'top' };
  bubble.style.outline = { width: 12, color: '#000000' };
  expect(textContentRect(bubble, 300, 200)).toEqual({ x: 42, y: 68, width: 216, height: 100 });
  bubble.tail = { x: 0, y: 0.5, side: 'left' };
  const box = textContentRect(bubble, 300, 200);
  expect(box.x).toBeCloseTo(89.52);
  expect(box.height).toBe(136);
});
it('외곽선을 먼저 그리고 채움을 나중에 그리며 0 두께는 strokeText를 호출하지 않는다', () => {
  const calls: string[] = [];
  const context = new Proxy(
    { measureText: () => ({ width: 20, actualBoundingBoxAscent: 0 }) },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        return () => calls.push(String(key));
      },
    },
  );
  const create = (): HTMLCanvasElement =>
    ({
      width: 0,
      height: 0,
      getContext: () => context,
      ownerDocument: { createElement: create },
    }) as unknown as HTMLCanvasElement;
  let doc = createEditorDocument();
  doc = changeElementStyle(doc, 'line-1', { text: { outline: { width: 8, color: '#000000' } } });
  renderDocument(create(), doc);
  expect(calls.indexOf('strokeText')).toBeLessThan(calls.indexOf('fillText'));
  calls.length = 0;
  doc = changeElementStyle(doc, 'line-1', { text: { outline: { width: 0, color: '#000000' } } });
  renderDocument(create(), doc);
  expect(calls).not.toContain('strokeText');
  expect(calls).toContain('fillText');
});
