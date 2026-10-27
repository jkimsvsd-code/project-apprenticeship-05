import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from '@jjal/document-model';
import { ASPECT_RATIOS, canvasSize } from '@jjal/policies';
import {
  BUILTIN_ASSETS,
  BUILTIN_TEMPLATES,
  createBuiltinDocument,
  STARTER_ASSET_MANIFEST,
} from '../../packages/content/src/builtins';

describe('초기 제공 템플릿과 오리지널 소재', () => {
  it('확정한 이름과 컷 수의 템플릿 6개를 제공한다', () => {
    expect(BUILTIN_TEMPLATES.map((item) => [item.name, item.panelCount])).toEqual([
      ['감정 한마디', 1],
      ['두 캐릭터 대화', 1],
      ['전후 비교', 2],
      ['상황과 반응', 2],
      ['짧은 이야기', 4],
      ['대화와 반전', 4],
    ]);
  });

  it.each(BUILTIN_TEMPLATES)('$name: 8개 독립 배치의 모든 요소가 편집 가능한 문서다', (item) => {
    const document = createBuiltinDocument(item.id);
    expect(parseDocument(document)).toEqual(document);
    expect(document.panels).toHaveLength(item.panelCount);
    expect(document.layouts.map((layout) => layout.ratio)).toEqual(ASPECT_RATIOS);
    expect(document.elements.every((element) => !element.locked && !element.hidden)).toBe(true);
    expect(document.elements.some((element) => element.kind === 'character')).toBe(true);
    expect(document.elements.some((element) => element.kind === 'bubble')).toBe(true);
    for (const layout of document.layouts) {
      const size = canvasSize(layout.ratio);
      for (const panel of layout.panels) {
        for (let left = 0; left < panel.elements.length; left++) {
          for (let right = left + 1; right < panel.elements.length; right++) {
            const a = panel.elements[left]!.transform;
            const b = panel.elements[right]!.transform;
            const intersectionWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const intersectionHeight =
              Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            expect(intersectionWidth <= 0.000001 || intersectionHeight <= 0.000001).toBe(true);
          }
        }
        for (const placed of panel.elements) {
          const t = placed.transform;
          expect(t.x).toBeGreaterThanOrEqual(0);
          expect(t.y).toBeGreaterThanOrEqual(0);
          expect(t.x + t.width).toBeLessThanOrEqual(1.000001);
          expect(t.y + t.height).toBeLessThanOrEqual(1.000001);
          const element = document.elements.find((value) => value.id === placed.elementId)!;
          if (element.kind === 'character') {
            // Avoid stretching either mascot when switching the canvas aspect ratio.
            const pixelWidth = t.width * panel.rect.width * size.width;
            const pixelHeight = t.height * panel.rect.height * size.height;
            expect(Math.abs(pixelWidth - pixelHeight)).toBeLessThan(0.001);
          }
        }
      }
    }
    expect(new Set(document.layouts.map((layout) => JSON.stringify(layout.panels))).size).toBe(8);
  });

  it('새 작품의 변경은 제공 원본이나 다음 작품을 변경하지 않는다', () => {
    const first = createBuiltinDocument('builtin-emotion');
    const second = createBuiltinDocument('builtin-emotion');
    expect(first.id).not.toBe(second.id);
    const element = first.elements.find((value) => value.kind === 'bubble')!;
    if (element.kind === 'bubble') element.text = '내가 바꾼 문구';
    first.layouts[0]!.panels[0]!.elements[0]!.transform.x = 0;
    const fresh = createBuiltinDocument('builtin-emotion');
    expect(fresh.elements).toEqual(second.elements);
    expect(fresh.layouts).toEqual(second.layouts);
    expect(() => createBuiltinDocument('missing-template')).toThrow('초기 템플릿');
  });

  it('소재 파일 12개의 실제 크기·해시·PNG 헤더가 배포 명세와 일치한다', () => {
    expect(BUILTIN_ASSETS.filter((item) => item.category === 'character')).toHaveLength(8);
    expect(BUILTIN_ASSETS.filter((item) => item.category === 'pattern')).toHaveLength(4);
    for (const { asset, url } of BUILTIN_ASSETS) {
      const bytes = readFileSync(resolve('apps/demo/public', url));
      expect(bytes.length).toBe(asset.byteLength);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(bytes.readUInt32BE(16)).toBe(asset.pixelWidth);
      expect(bytes.readUInt32BE(20)).toBe(asset.pixelHeight);
      expect(bytes[25]).toBe(6); // RGBA PNG, including transparent mascot boundaries.
    }
    expect(STARTER_ASSET_MANIFEST.generation.externalArtwork).toBe('none');
    expect(STARTER_ASSET_MANIFEST.usage.attributionRequired).toBe(false);
  });

  it('모든 표정·패턴·말풍선 모양과 세 기본 글꼴이 실제 초기 템플릿에 쓰인다', () => {
    const documents = BUILTIN_TEMPLATES.map((item) => createBuiltinDocument(item.id));
    const used = new Set(documents.flatMap((document) => document.assets.map((asset) => asset.id)));
    expect([...used].sort()).toEqual(BUILTIN_ASSETS.map((item) => item.asset.id).sort());
    const elements = documents.flatMap((document) => document.elements);
    expect(
      [
        ...new Set(
          elements.flatMap((element) => (element.kind === 'bubble' ? [element.shape] : [])),
        ),
      ].sort(),
    ).toEqual(['caption', 'shout', 'speech', 'thought']);
    expect(
      [
        ...new Set(
          elements.flatMap((element) =>
            'style' in element && element.style.font.kind === 'builtin'
              ? [element.style.font.family]
              : [],
          ),
        ),
      ].sort(),
    ).toEqual(['Jua', 'Noto Sans KR', 'Noto Serif KR']);
  });
});
