import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  parseCachedResourceMetadata,
  parseResourceId,
  validateCachedResources,
  type CachedResource,
} from '@jjal/persistence/browser';

function fixture(): CachedResource {
  const bytes = new Uint8Array(readFileSync('tests/fixtures/images/portrait.png'));
  const hash = createHash('sha256').update(bytes).digest('hex');
  const id = `resource-${hash}`;
  const header = new DataView(bytes.buffer);
  return {
    id,
    name: '나의 사진.png',
    origin: 'user',
    category: 'image',
    createdAt: '2026-10-22T00:00:00.000Z',
    asset: {
      id,
      mimeType: 'image/png',
      byteLength: bytes.length,
      sha256: hash,
      pixelWidth: header.getUint32(16),
      pixelHeight: header.getUint32(20),
    },
    blob: new Blob([bytes], { type: 'image/png' }),
  };
}

describe('브라우저 자원 캐시 입력 검증', () => {
  it('동일 원본 바이트를 SHA-256 한 자원으로 묶고 최초 이름과 시각을 유지한다', async () => {
    const first = fixture();
    const later = { ...first, name: '다른 파일명.png', createdAt: '2026-10-22T01:00:00.000Z' };
    const result = await validateCachedResources([first, later]);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe(first.name);
    expect(result[0]!.createdAt).toBe(first.createdAt);
    expect(result[0]!.blob).toBe(first.blob);
    expect(result[0]!.asset).not.toBe(first.asset);
    expect(later.name).toBe('다른 파일명.png');
  });

  it('같은 해시의 서로 다른 치수는 묶음 전체를 거부한다', async () => {
    const first = fixture();
    const originalWidth = first.asset.pixelWidth!;
    const changed = { ...first, asset: { ...first.asset, pixelWidth: originalWidth + 1 } };
    await expect(validateCachedResources([first, changed])).rejects.toThrow('서로 다른 정보');
    expect(first.asset.pixelWidth).toBe(originalWidth);
  });

  it('표시 크기·MIME이 같아도 원본 바이트 해시가 다르면 거부한다', async () => {
    const input = fixture();
    const wrongBlob = new Blob([new Uint8Array(input.blob.size)], { type: 'image/png' });
    await expect(validateCachedResources([{ ...input, blob: wrongBlob }])).rejects.toThrow('해시');
  });

  it('바이트 크기나 MIME 선언이 다르면 원본을 변경하지 않고 거부한다', async () => {
    const input = fixture();
    await expect(
      validateCachedResources([{ ...input, blob: new Blob(['other'], { type: 'image/png' }) }]),
    ).rejects.toThrow('크기 또는 형식');
    await expect(
      validateCachedResources([
        { ...input, blob: new Blob([await input.blob.arrayBuffer()], { type: 'image/jpeg' }) },
      ]),
    ).rejects.toThrow('크기 또는 형식');
  });

  it.each([
    { name: '' },
    { name: ' '.repeat(8) },
    { name: '가'.repeat(121) },
    { name: '파일\u0000.png' },
    { createdAt: 'not-a-time' },
    { createdAt: '2026-10-22' },
    { origin: 'external' },
    { category: 'font' },
  ])('잘못된 이름·분류·시각을 거부한다: %j', (change) => {
    expect(() => parseCachedResourceMetadata({ ...fixture(), ...change })).toThrow();
  });

  it.each([
    { byteLength: 0 },
    { byteLength: 10_000_001 },
    { pixelWidth: null },
    { pixelHeight: 40_001 },
    { pixelWidth: 40_000, pixelHeight: 40_000 },
    { mimeType: 'font/ttf', pixelWidth: null, pixelHeight: null },
    { sha256: 'f'.repeat(64) },
    { id: 'another-image' },
  ])('잘못된 이미지 메타데이터를 거부한다: %j', (change) => {
    const input = fixture();
    expect(() =>
      parseCachedResourceMetadata({ ...input, asset: { ...input.asset, ...change } }),
    ).toThrow();
  });

  it.each([
    '',
    'resource-../../file',
    'https://example.com/a.png',
    'a'.repeat(64),
    `resource-${'A'.repeat(64)}`,
  ])('외부 주소나 임의 drag payload를 자원 키로 사용하지 않는다: %s', (input) =>
    expect(() => parseResourceId(input)).toThrow(),
  );

  it('목록 메타데이터는 Blob과 호출자가 추가한 필드를 전달하지 않는다', () => {
    const input = fixture();
    const parsed = parseCachedResourceMetadata({ ...input, privateExtra: 'unused' });
    expect(Object.keys(parsed).sort()).toEqual(
      ['id', 'name', 'origin', 'category', 'createdAt', 'asset'].sort(),
    );
    expect(parsed.asset).not.toBe(input.asset);
  });
});
