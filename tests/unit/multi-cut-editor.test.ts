import { expect, it } from 'vitest';
import { BUILTIN_TEMPLATES, createBuiltinDocument } from '@jjal/content';
import { changeCaption, replaceImage } from '@jjal/editor-core';

it('선택한 다른 컷의 말풍선만 편집하고 글꼴과 배치를 공유/분리한다', () => {
  const original = createBuiltinDocument(
    BUILTIN_TEMPLATES.find((item) => item.panelCount === 4)!.id,
  );
  const panel = original.panels[2]!;
  const text = original.elements.find(
    (item) => panel.elementIds.includes(item.id) && item.kind === 'bubble',
  )!;
  const after = changeCaption(
    original,
    { text: '바꾼 대사', fontFamily: 'Jua', x: 0.25 },
    '4:5',
    text.id,
  );
  const changed = after.elements.find((item) => item.id === text.id)!;
  expect(changed).toMatchObject({
    text: '바꾼 대사',
    style: { font: { kind: 'builtin', family: 'Jua' } },
  });
  expect(original.elements.find((item) => item.id === text.id)).not.toEqual(changed);
  expect(after.elements.filter((item) => item.id !== text.id)).toEqual(
    original.elements.filter((item) => item.id !== text.id),
  );
  expect(
    after.layouts
      .find((layout) => layout.ratio === '4:5')!
      .panels.find((item) => item.panelId === panel.id)!
      .elements.find((item) => item.elementId === text.id)!.transform.x,
  ).toBe(0.25);
  expect(after.layouts.find((layout) => layout.ratio === '1:1')).toEqual(
    original.layouts.find((layout) => layout.ratio === '1:1'),
  );
});

it('선택한 캐릭터의 이미지만 교체하며 다른 컷 참조와 모든 비율 배치를 보존한다', () => {
  const original = createBuiltinDocument(
    BUILTIN_TEMPLATES.find((item) => item.panelCount === 4)!.id,
  );
  const panel = original.panels[1]!;
  const character = original.elements.find(
    (item) => panel.elementIds.includes(item.id) && item.kind === 'character',
  )!;
  const replacement = { ...original.assets[0]!, id: 'replacement-image', sha256: 'f'.repeat(64) };
  const after = replaceImage(original, replacement, { panelId: panel.id, elementId: character.id });
  expect(after.elements.find((item) => item.id === character.id)).toMatchObject({
    assetId: replacement.id,
  });
  expect(after.elements.filter((item) => item.id !== character.id)).toEqual(
    original.elements.filter((item) => item.id !== character.id),
  );
  expect(after.layouts).toEqual(original.layouts);
  expect(after.assets.some((asset) => asset.id === replacement.id)).toBe(true);
});
