import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inspectImage, checkFileSize } from '@jjal/image-io';
import { createEditorDocument, changeCaption, replaceBackground } from '@jjal/editor-core';
import { fittedRect } from '@jjal/renderer';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../fixtures/images/${name}`, import.meta.url)));
describe('이미지 입력의 상태 변경 전 검증', () => {
  it.each([
    ['portrait.png', 'image/png', 400, 1200],
    ['landscape.jpg', 'image/jpeg', 1200, 400],
    ['static.webp', 'image/webp', 640, 480],
    ['lossy.webp', 'image/webp', 640, 480],
    ['alpha.webp', 'image/webp', 640, 480],
  ])('%s의 실제 형식과 크기', (name, mime, width, height) => {
    expect(inspectImage(fixture(String(name)), String(name), String(mime))).toEqual({
      mimeType: mime,
      width,
      height,
    });
  });
  it.each([
    'signature-only.png',
    'not-image.txt',
    'too-many-pixels.png',
    'animated.png',
    'animated.webp',
  ])('%s를 거부한다', (name) => {
    expect(() => inspectImage(fixture(name), name, '')).toThrow();
  });
  it('이름·MIME 위조를 거부하고 빈 MIME은 실제 내용으로 확인한다', () => {
    expect(() => inspectImage(fixture('portrait.png'), 'x.jpg', 'image/png')).toThrow(/일치/);
    expect(() => inspectImage(fixture('portrait.png'), 'x.png', 'image/jpeg')).toThrow(/일치/);
    expect(inspectImage(fixture('portrait.png'), 'x.PNG', '').mimeType).toBe('image/png');
  });
  it('빈 파일과 10MB 초과 파일은 읽기 전에 거부한다', () => {
    expect(() => checkFileSize(0)).toThrow(/빈/);
    expect(() => checkFileSize(10_000_001)).toThrow(/10MB/);
    expect(() => checkFileSize(10_000_000)).not.toThrow();
  });
});

describe('편집 명령의 불변성과 비율별 좌표', () => {
  it('잘못된 문구·크기·좌표·소재는 원본을 바꾸지 않는다', () => {
    const before = createEditorDocument();
    const snapshot = structuredClone(before);
    for (const patch of [
      { text: '가'.repeat(1001) },
      { fontSize: NaN },
      { color: 'bad' },
      { x: -1 },
    ])
      expect(() => changeCaption(before, patch, '1:1')).toThrow();
    expect(() =>
      replaceBackground(before, {
        id: 'bad',
        mimeType: 'image/png',
        byteLength: 1,
        sha256: 'a'.repeat(64),
        pixelWidth: null,
        pixelHeight: null,
      }),
    ).toThrow();
    expect(before).toEqual(snapshot);
  });
  it('현재 비율의 좌표만 수정하고 공통 문구를 유지한다', () => {
    const before = createEditorDocument();
    const after = changeCaption(before, { x: 0.5, text: '바꾼 문구' }, '4:5');
    expect(after.layouts.find((l) => l.ratio === '4:5')!.panels[0]!.elements[0]!.transform.x).toBe(
      0.5,
    );
    expect(after.layouts.find((l) => l.ratio === '1:1')!.panels[0]!.elements[0]!.transform.x).toBe(
      0.1,
    );
    expect(before.elements[0]).not.toEqual(after.elements[0]);
  });
  it('cover는 가운데 자르기, contain은 전체 맞춤', () => {
    expect(fittedRect(1200, 400, 1080, 1080, 'cover')).toEqual({
      x: -1080,
      y: 0,
      width: 3240,
      height: 1080,
    });
    expect(fittedRect(1200, 400, 1080, 1080, 'contain')).toEqual({
      x: 0,
      y: 360,
      width: 1080,
      height: 360,
    });
  });
});
