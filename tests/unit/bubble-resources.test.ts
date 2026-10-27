import { describe, expect, it } from 'vitest';
import { addElement, createEditorDocument } from '@jjal/editor-core';
import { parseResourceId } from '@jjal/persistence/browser';
import {
  BUBBLE_FOLDER,
  BUBBLE_RESOURCES,
  bubbleResourceId,
  bubbleResourceShape,
} from '../../apps/demo/src/composition/bubble-resources';
import { parseResourceDragId } from '../../apps/demo/src/composition/resources';
import { parseResourceFolders } from '../../apps/demo/src/composition/resource-folders';

describe('편집 가능한 말풍선 자원 경계', () => {
  it.each(BUBBLE_RESOURCES)(
    '$shape 자원은 같은 타일을 재사용해도 독립적인 벡터 요소를 만든다',
    ({ shape }) => {
      const id = bubbleResourceId(shape);
      expect(bubbleResourceShape(id)).toBe(shape);
      expect(parseResourceDragId(id)).toBe(id);
      // UI IDs cannot become fake cached images or asset references.
      expect(() => parseResourceId(id)).toThrow();
      const source = createEditorDocument();
      const before = structuredClone(source);
      const first = addElement(source, source.panels[0]!.id, { kind: 'bubble', shape });
      const second = addElement(first.document, source.panels[0]!.id, { kind: 'bubble', shape });
      expect(second.elementId).not.toBe(first.elementId);
      for (const elementId of [first.elementId, second.elementId]) {
        expect(second.document.elements.find((element) => element.id === elementId)).toMatchObject({
          kind: 'bubble',
          shape,
          text: '새 대사',
        });
        expect(
          second.document.layouts.every((layout) =>
            layout.panels[0]!.elements.some((element) => element.elementId === elementId),
          ),
        ).toBe(true);
      }
      expect(second.document.assets).toEqual(source.assets);
      expect(source).toEqual(before);
    },
  );

  it.each([
    null,
    undefined,
    {},
    '',
    'builtin-bubble:',
    'builtin-bubble:SPEECH',
    'builtin-bubble:speech:extra',
    ' builtin-bubble:speech',
    'builtin-bubble:speech ',
    'builtin-bubble:image',
    'https://example.test/builtin-bubble:speech',
  ])('알 수 없거나 변형된 UI 자원 ID %j를 거부한다', (input) => {
    expect(bubbleResourceShape(input)).toBeNull();
    expect(parseResourceDragId(input)).toBeNull();
  });

  it('기존 SHA 이미지 ID 경계와 사용자 동명 폴더를 보존한다', () => {
    const imageId = `resource-${'a'.repeat(64)}`;
    expect(bubbleResourceShape(imageId)).toBeNull();
    expect(parseResourceDragId(imageId)).toBe(imageId);
    expect(parseResourceId(imageId)).toBe(imageId);
    const existing = {
      version: 1,
      folders: [{ id: 'folder-existing', name: '말풍선' }],
      memberships: { [imageId]: ['folder-existing'] },
    };
    expect(parseResourceFolders(existing)).toEqual(existing);
    expect(() =>
      parseResourceFolders({
        ...existing,
        folders: [{ id: BUBBLE_FOLDER, name: '말풍선' }],
      }),
    ).toThrow();
    expect(() => bubbleResourceId('unknown' as never)).toThrow();
  });
});
