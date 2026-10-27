import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@jjal/content';
import { DocumentSchema, parseDocument } from '@jjal/document-model';

describe('작품 스키마 v1', () => {
  it('8개 비율 배치를 갖는 작품을 검증하고 깊은 사본을 돌려준다', () => {
    const original = createSampleDocument();
    const result = parseDocument(original);
    expect(result.layouts).toHaveLength(8);
    result.elements[0]!.hidden = true;
    expect(original.elements[0]!.hidden).toBe(false);
  });

  it.each([
    [
      '알 수 없는 버전',
      (v: Record<string, unknown>) => {
        v.schemaVersion = 2;
      },
    ],
    [
      'API 키 필드',
      (v: Record<string, unknown>) => {
        v.apiKey = 'test-only-not-a-secret';
      },
    ],
    [
      '필수 제목 누락',
      (v: Record<string, unknown>) => {
        delete v.title;
      },
    ],
  ])('%s를 거부한다', (_name, change) => {
    const doc: Record<string, unknown> = createSampleDocument();
    change(doc);
    expect(DocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('존재하지 않는 요소를 가리키는 컷을 거부한다', () => {
    const doc = createSampleDocument();
    doc.panels[0]!.elementIds[0] = 'missing-element';
    expect(DocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('중복 요소와 비율 배치를 거부한다', () => {
    const doc = createSampleDocument();
    doc.elements[1]!.id = doc.elements[0]!.id;
    expect(DocumentSchema.safeParse(doc).success).toBe(false);
    const second = createSampleDocument();
    second.layouts[1]!.ratio = second.layouts[0]!.ratio;
    expect(DocumentSchema.safeParse(second).success).toBe(false);
  });

  it('배치에서 요소를 빼거나 유효하지 않은 크기를 주면 거부한다', () => {
    const doc = createSampleDocument();
    doc.layouts[0]!.panels[0]!.elements.pop();
    expect(DocumentSchema.safeParse(doc).success).toBe(false);
    const second = createSampleDocument();
    second.layouts[0]!.panels[0]!.elements[0]!.transform.width = Number.NaN;
    expect(DocumentSchema.safeParse(second).success).toBe(false);
  });

  it('존재하지 않는 이미지 소재 참조를 거부한다', () => {
    const doc = createSampleDocument();
    doc.panels[0]!.background.imageAssetId = 'unknown-asset';
    expect(DocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('현재 비율의 배치가 없으면 거부한다', () => {
    const doc = createSampleDocument();
    doc.layouts = doc.layouts.filter((l) => l.ratio !== doc.activeRatio);
    expect(DocumentSchema.safeParse(doc).success).toBe(false);
  });

  it('1,000 코드포인트 문구는 수용하고 초과는 거부한다', () => {
    const doc = createSampleDocument();
    const element = doc.elements[0]!;
    if (element.kind !== 'text') throw new Error('시험 문구 없음');
    element.text = '가'.repeat(1000);
    expect(DocumentSchema.safeParse(doc).success).toBe(true);
    element.text += '나';
    expect(DocumentSchema.safeParse(doc).success).toBe(false);
  });
});
