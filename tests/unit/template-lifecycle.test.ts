import { describe, expect, it } from 'vitest';
import { createSampleDocument, BUILTIN_TEMPLATES, createBuiltinDocument } from '@jjal/content';
import { parseDocument, type StudioDocument } from '@jjal/document-model';
import { createEditorDocument } from '@jjal/editor-core';
import {
  cloneTemplateDocument,
  createSavedTemplate,
  validateEditorDocument,
} from '@jjal/template-kit';

function documentWithImage(): StudioDocument {
  const doc = createEditorDocument();
  doc.assets = [
    {
      id: 'fixture-background',
      sha256: 'a'.repeat(64),
      mimeType: 'image/png',
      byteLength: 120,
      pixelWidth: 400,
      pixelHeight: 800,
    },
  ];
  doc.panels[0]!.background.imageAssetId = doc.assets[0]!.id;
  return parseDocument(doc);
}

function documentIds(doc: StudioDocument) {
  return [
    doc.id,
    ...doc.assets.map((asset) => asset.id),
    ...doc.panels.map((panel) => panel.id),
    ...doc.elements.map((element) => element.id),
  ];
}

describe('개인 템플릿의 독립된 저장 사본', () => {
  it('이름을 정리해 저장하며 편집 문서와 저장 사본은 서로 변경하지 않는다', () => {
    const doc = createEditorDocument();
    const before = structuredClone(doc);
    const saved = createSavedTemplate('  나의 첫 카드  ', doc);
    expect(saved.name).toBe('나의 첫 카드');
    expect(saved.kind).toBe('jjal-template');
    expect(saved.schemaVersion).toBe(1);
    expect(doc).toEqual(before);
    expect(saved.document).toEqual(doc);
    expect(saved.document).not.toBe(doc);

    doc.title = '저장 뒤 편집한 제목';
    expect(saved.document.title).toBe(before.title);
    saved.document.panels[0]!.background.color = '#123456';
    expect(doc.panels[0]!.background.color).toBe(before.panels[0]!.background.color);
  });

  it.each(['', '  \n\t ', '가'.repeat(121)])('빈 이름 또는 120자 초과 이름은 거부한다', (name) => {
    const doc = createEditorDocument();
    const before = structuredClone(doc);
    expect(() => createSavedTemplate(name, doc)).toThrow();
    expect(doc).toEqual(before);
  });

  it('120자 이름은 저장할 수 있고 새 저장은 서로 다른 ID를 사용한다', () => {
    const doc = createEditorDocument();
    const first = createSavedTemplate('가'.repeat(120), doc);
    const second = createSavedTemplate('두 번째', doc);
    expect(first.name).toHaveLength(120);
    expect(second.id).not.toBe(first.id);
  });

  it('기존 템플릿 수정은 ID와 생성 시각을 유지하며 이전 저장 사본은 보존한다', () => {
    const doc = createEditorDocument();
    const previous = createSavedTemplate('처음 이름', doc);
    previous.createdAt = previous.updatedAt = '2026-01-01T00:00:00.000Z';
    const before = structuredClone(previous);
    const modified = structuredClone(doc);
    const text = modified.elements[0]!;
    if (text.kind !== 'text') throw new Error('시험 문구 없음');
    text.text = '수정한 문구';
    const updated = createSavedTemplate('  바꾼 이름  ', modified, previous);

    expect(updated.id).toBe(previous.id);
    expect(updated.createdAt).toBe(previous.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(previous.updatedAt));
    expect(updated.name).toBe('바꾼 이름');
    expect(updated.document).toEqual(modified);
    expect(previous).toEqual(before);
    modified.panels[0]!.background.color = '#abcdef';
    expect(updated.document.panels[0]!.background.color).toBe(doc.panels[0]!.background.color);
  });
});

describe('템플릿으로 만든 새 작품의 참조 재연결', () => {
  it('문서·소재·컷·요소 ID를 모두 새로 만들며 8개 배치와 배경 참조를 유지한다', () => {
    const original = documentWithImage();
    const before = structuredClone(original);
    const cloned = cloneTemplateDocument(original);
    const oldIds = new Set(documentIds(original));
    expect(documentIds(cloned).every((id) => !oldIds.has(id))).toBe(true);
    expect(cloned.layouts).toHaveLength(8);
    expect(cloned.assets[0]).toEqual({ ...original.assets[0]!, id: cloned.assets[0]!.id });
    expect(cloned.panels[0]!.background).toEqual({
      ...original.panels[0]!.background,
      imageAssetId: cloned.assets[0]!.id,
    });
    expect(cloned.panels[0]!.elementIds).toEqual([cloned.elements[0]!.id]);
    for (const layout of cloned.layouts) {
      const originalLayout = original.layouts.find((item) => item.ratio === layout.ratio)!;
      expect(layout.panels[0]!.panelId).toBe(cloned.panels[0]!.id);
      expect(layout.panels[0]!.elements[0]!.elementId).toBe(cloned.elements[0]!.id);
      expect(layout.panels[0]!.rect).toEqual(originalLayout.panels[0]!.rect);
      expect(layout.panels[0]!.elements[0]!.transform).toEqual(
        originalLayout.panels[0]!.elements[0]!.transform,
      );
    }
    expect(() => parseDocument(cloned)).not.toThrow();
    expect(original).toEqual(before);
  });

  it('같은 템플릿에서 두 번 만든 작품도 서로 독립된 ID와 내용을 가진다', () => {
    const original = documentWithImage();
    const first = cloneTemplateDocument(original);
    const second = cloneTemplateDocument(original);
    const firstIds = new Set(documentIds(first));
    expect(documentIds(second).every((id) => !firstIds.has(id))).toBe(true);
    first.panels[0]!.background.color = '#654321';
    first.layouts[0]!.panels[0]!.elements[0]!.transform.x = 0.45;
    expect(second.panels[0]!.background.color).toBe(original.panels[0]!.background.color);
    expect(second.layouts[0]!.panels[0]!.elements[0]!.transform.x).toBe(
      original.layouts[0]!.panels[0]!.elements[0]!.transform.x,
    );
  });
});

describe('현재 편집기에서 사용할 수 있는 템플릿만 수용', () => {
  it('배경 없는 문서와 배경 이미지 한 개를 가진 문서를 깊은 사본으로 수용한다', () => {
    for (const original of [createEditorDocument(), documentWithImage()]) {
      const validated = validateEditorDocument(original);
      expect(validated).toEqual(original);
      expect(validated).not.toBe(original);
      validated.panels[0]!.background.color = '#010203';
      expect(original.panels[0]!.background.color).not.toBe('#010203');
    }
  });

  it('필수 참조가 손상된 문서는 현재 문서를 변경하지 않고 거부한다', () => {
    const doc = createEditorDocument();
    doc.panels[0]!.elementIds[0] = 'missing-caption';
    const before = structuredClone(doc);
    expect(() => validateEditorDocument(doc)).toThrow();
    expect(doc).toEqual(before);
  });

  it('문구가 두 개인 문서도 각각 선택해 편집할 수 있도록 수용한다', () => {
    const doc = createSampleDocument();
    expect(() => parseDocument(doc)).not.toThrow();
    expect(validateEditorDocument(doc)).toEqual(doc);
  });

  it('마지막 문구를 삭제한 빈 컷도 저장한다', () => {
    const doc = createEditorDocument();
    const secondPanel = structuredClone(doc.panels[0]!);
    secondPanel.id = 'panel-second';
    secondPanel.elementIds = [];
    doc.panels.push(secondPanel);
    for (const layout of doc.layouts) {
      layout.panels[0]!.rect.width = 0.5;
      layout.panels.push({
        panelId: secondPanel.id,
        rect: { x: 0.5, y: 0, width: 0.5, height: 1 },
        elements: [],
      });
    }
    expect(() => parseDocument(doc)).not.toThrow();
    expect(validateEditorDocument(doc)).toEqual(doc);
  });

  it('이미지 요소만 남은 컷도 저장한다', () => {
    const doc = documentWithImage();
    doc.elements[0] = {
      id: doc.elements[0]!.id,
      kind: 'image',
      locked: false,
      hidden: false,
      assetId: doc.assets[0]!.id,
      fit: 'cover',
    };
    expect(() => parseDocument(doc)).not.toThrow();
    expect(validateEditorDocument(doc)).toEqual(doc);
  });

  it('미지원 사용자 글꼴을 기본 글꼴로 바꾸어 저장하지 않고 거부한다', () => {
    const doc = createEditorDocument();
    doc.assets.push({
      id: 'fixture-font',
      mimeType: 'font/woff2',
      byteLength: 100,
      sha256: 'b'.repeat(64),
      pixelWidth: null,
      pixelHeight: null,
    });
    const text = doc.elements[0]!;
    if (text.kind !== 'text') throw new Error('시험 문구 없음');
    text.style.font = { kind: 'uploaded', assetId: doc.assets[0]!.id };
    expect(() => parseDocument(doc)).not.toThrow();
    expect(() => validateEditorDocument(doc)).toThrow();
  });

  it('배경에 쓰이지 않는 추가 소재를 거부한다', () => {
    const doc = documentWithImage();
    doc.assets.push({ ...doc.assets[0]!, id: 'unused-image', sha256: 'c'.repeat(64) });
    expect(() => parseDocument(doc)).not.toThrow();
    expect(() => validateEditorDocument(doc)).toThrow();
  });

  it.each(['1:1', '4:5', '9:16'] as const)('필수 %s 배치가 없으면 거부한다', (ratio) => {
    const doc = createEditorDocument();
    doc.activeRatio = ratio === '1:1' ? '4:5' : '1:1';
    doc.layouts = doc.layouts.filter((layout) => layout.ratio !== ratio);
    expect(() => parseDocument(doc)).not.toThrow();
    expect(() => validateEditorDocument(doc)).toThrow();
  });

  it('기존 3비율 외의 활성 비율도 유효한 배치가 있으면 수용한다', () => {
    const doc = createEditorDocument();
    doc.activeRatio = '4:3';
    expect(() => parseDocument(doc)).not.toThrow();
    expect(validateEditorDocument(doc)).toEqual(doc);
  });

  it.each(BUILTIN_TEMPLATES)(
    '$name 다중 컷·캐릭터·말풍선 사본의 모든 참조를 재연결한다',
    ({ id }) => {
      const original = createBuiltinDocument(id);
      const before = structuredClone(original);
      const cloned = cloneTemplateDocument(original);
      const oldIds = new Set(documentIds(original));
      expect(documentIds(cloned).every((value) => !oldIds.has(value))).toBe(true);
      for (const element of cloned.elements)
        if ('assetId' in element)
          expect(cloned.assets.some((asset) => asset.id === element.assetId)).toBe(true);
      expect(validateEditorDocument(cloned)).toEqual(cloned);
      expect(original).toEqual(before);
    },
  );
});
