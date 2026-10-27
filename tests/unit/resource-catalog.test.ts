import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_ASSETS } from '@jjal/content';
import * as imageIo from '@jjal/image-io';
import { parseCachedResourceMetadata, validateCachedResources } from '@jjal/persistence/browser';
import {
  cacheResourceFiles,
  listLibraryResources,
  parseResourceCatalog,
  refreshBuiltinResources,
  resourceRepository,
  RESOURCE_CATALOG_KEY,
} from '../../apps/demo/src/composition/resources';

const base = 'https://example.test/';
const manifest = () =>
  JSON.parse(readFileSync('apps/demo/public/assets/resource-catalog.json', 'utf8'));
function preparedBoundary() {
  const decoded: imageIo.PreparedImage[] = [];
  vi.spyOn(imageIo, 'prepareImage').mockImplementation(async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = imageIo.inspectImage(bytes, file.name, file.type);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const image: imageIo.PreparedImage = {
      asset: {
        id: `image-${sha256}`,
        sha256,
        mimeType: info.mimeType,
        byteLength: bytes.length,
        pixelWidth: info.width,
        pixelHeight: info.height,
      },
      original: file,
      source: { width: info.width, height: info.height } as HTMLCanvasElement,
      resized: false,
    };
    decoded.push(image);
    return image;
  });
  const add = vi
    .spyOn(resourceRepository, 'addMany')
    .mockImplementation(async (resources) =>
      (await validateCachedResources(resources)).map(parseCachedResourceMetadata),
    );
  return { decoded, add };
}
function extra() {
  const bytes = new Uint8Array(readFileSync('tests/fixtures/images/portrait.png'));
  const info = imageIo.inspectImage(bytes, 'portrait.png', 'image/png');
  return {
    bytes,
    asset: {
      id: 'catalog-photo',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType: info.mimeType,
      byteLength: bytes.length,
      pixelWidth: info.width,
      pixelHeight: info.height,
    },
    label: '추가 사진',
    category: 'image',
    url: './assets/new/photo.png',
  };
}

/** Distinct, valid PNGs with identical pixels keep the batch fixture small. */
function batchFiles(count: number) {
  const bytes = readFileSync('tests/fixtures/images/transparent.png');
  return Array.from({ length: count }, (_, index) => {
    const text = Buffer.from(`Batch\0${index}`);
    const chunk = Buffer.alloc(text.length + 12);
    chunk.writeUInt32BE(text.length, 0);
    chunk.write('tEXt', 4);
    text.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    return new File(
      [Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)])],
      `소재 ${index + 1}.png`,
      { type: 'image/png' },
    );
  });
}
beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('공개 기본 자원 목록 갱신', () => {
  it('기본 12개의 실제 파일 해시·치수·이름·권리 원문을 그대로 제공한다', () => {
    const catalog = parseResourceCatalog(manifest(), base);
    expect(catalog.assets).toHaveLength(12);
    expect(catalog.rights.source).toBe('packages/content/src/asset-manifest.json');
    const original = JSON.parse(readFileSync(catalog.rights.source, 'utf8'));
    expect(catalog.rights.statement).toBe(original.usage.statement);
    for (const entry of catalog.assets) {
      const bytes = readFileSync(`apps/demo/public${new URL(entry.url).pathname}`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(entry.asset.sha256);
      expect(bytes.length).toBe(entry.asset.byteLength);
      expect(BUILTIN_ASSETS.find((asset) => asset.asset.sha256 === entry.asset.sha256)?.label).toBe(
        entry.label,
      );
    }
  });

  it.each([
    'https://external.test/assets/photo.png',
    './private/photo.png',
    './assets/photo.png?token=bad',
    './assets/%2e%2e/photo.png',
  ])('외부·비자원·동적 경로를 거부한다: %s', (url) => {
    const input = manifest();
    input.assets.push({ ...extra(), url });
    expect(() => parseResourceCatalog(input, base)).toThrow();
  });

  it('원본 이름·해시 정보 변경이나 중복·권리 누락은 기존 자원 갱신 전에 거부한다', () => {
    const renamed = manifest();
    renamed.assets[0].label = 'changed';
    expect(() => parseResourceCatalog(renamed, base)).toThrow('기본 제공 원본');
    const removed = manifest();
    removed.assets.pop();
    expect(() => parseResourceCatalog(removed, base)).toThrow('기본 제공 원본');
    const duplicate = manifest();
    duplicate.assets.push(duplicate.assets[0]);
    expect(() => parseResourceCatalog(duplicate, base)).toThrow('중복 해시');
    const noRights = manifest();
    delete noRights.rights;
    expect(() => parseResourceCatalog(noRights, base)).toThrow('권리');
    const changedRights = manifest();
    changedRights.rights.attributionRequired = true;
    expect(() => parseResourceCatalog(changedRights, base)).toThrow('권리·출처 조건');
  });

  it('불러오기는 목록을 no-store로 재조회하고 아직 없는 자원만 검증·저장한다', async () => {
    const boundary = preparedBoundary();
    vi.stubGlobal('document', { baseURI: base });
    vi.spyOn(resourceRepository, 'list').mockResolvedValue(
      BUILTIN_ASSETS.map((entry) => ({ id: `resource-${entry.asset.sha256}` }) as never),
    );
    const added = extra(),
      input = manifest();
    input.assets.push(added);
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(input)))
      .mockResolvedValueOnce(new Response(added.bytes));
    vi.stubGlobal('fetch', fetcher);
    const saved = await refreshBuiltinResources();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every((call) => call[1].cache === 'no-store')).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.name).toBe(added.label);
    expect(saved[0]!.origin).toBe('builtin');
    expect(boundary.decoded[0]!.source.width).toBe(0);
  });

  it('이미 업로드한 파일과 신규 기본 자원의 해시가 같아도 원본 이름·바이트를 바꾸지 않고 기본 폴더에 표시한다', async () => {
    const boundary = preparedBoundary();
    vi.stubGlobal('document', { baseURI: base });
    const added = extra();
    const user = parseCachedResourceMetadata({
      id: `resource-${added.asset.sha256}`,
      name: '내가 먼저 업로드한 사진.png',
      origin: 'user',
      category: 'image',
      createdAt: '2026-10-23T00:00:00.000Z',
      asset: { ...added.asset, id: `resource-${added.asset.sha256}` },
    });
    const metadata = [
      ...BUILTIN_ASSETS.map((entry) =>
        parseCachedResourceMetadata({
          id: `resource-${entry.asset.sha256}`,
          name: entry.label,
          origin: 'builtin',
          category: entry.category === 'character' ? 'character' : 'background',
          createdAt: '2026-10-23T00:00:00.000Z',
          asset: { ...entry.asset, id: `resource-${entry.asset.sha256}` },
        }),
      ),
      user,
    ];
    vi.spyOn(resourceRepository, 'list').mockResolvedValue(metadata);
    const input = manifest();
    input.assets.push(added);
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(input)));
    vi.stubGlobal('fetch', fetcher);
    await refreshBuiltinResources();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(boundary.decoded).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(RESOURCE_CATALOG_KEY)!).version).toBe(1);
    // Listing the projected metadata does not change the repository record itself.
    const view = (await listLibraryResources()).find((entry) => entry.id === user.id)!;
    expect(view.origin).toBe('builtin');
    expect(view.name).toBe(user.name);
    expect(user.origin).toBe('user');
    expect(user.asset.sha256).toBe(added.asset.sha256);
  });

  it('새 자원의 바이트가 목록과 다르면 묶음 전체 저장을 하지 않고 디코딩 자원을 해제한다', async () => {
    const boundary = preparedBoundary();
    vi.stubGlobal('document', { baseURI: base });
    vi.spyOn(resourceRepository, 'list').mockResolvedValue([]);
    const input = manifest();
    input.assets[1].asset.sha256 = '0'.repeat(64);
    // Altering an original is rejected before even fetching its file.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(input))));
    await expect(refreshBuiltinResources()).rejects.toThrow('기본 제공 원본');
    expect(boundary.add).not.toHaveBeenCalled();
    const added = extra(),
      next = manifest();
    next.assets.push({ ...added, asset: { ...added.asset, sha256: '1'.repeat(64) } });
    vi.spyOn(resourceRepository, 'list').mockResolvedValue(
      BUILTIN_ASSETS.map((entry) => ({ id: `resource-${entry.asset.sha256}` }) as never),
    );
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(next)))
        .mockResolvedValueOnce(new Response(added.bytes)),
    );
    await expect(refreshBuiltinResources()).rejects.toThrow('해시');
    expect(boundary.add).not.toHaveBeenCalled();
    expect(
      boundary.decoded.every((image) => image.source.width === 0 && image.source.height === 0),
    ).toBe(true);
  });

  it('사용자 다중 파일 중 하나가 잘못돼도 기존 캐시에 일부를 저장하지 않는다', async () => {
    const boundary = preparedBoundary();
    const added = extra();
    await expect(
      cacheResourceFiles([
        new File([added.bytes], 'valid.png', { type: 'image/png' }),
        new File(['broken'], 'bad.png', { type: 'image/png' }),
      ]),
    ).rejects.toThrow();
    expect(boundary.add).not.toHaveBeenCalled();
    expect(boundary.decoded[0]!.source.width).toBe(0);
  });

  it('51개의 서로 다른 파일을 한 번에 검증·저장하고 연속 추가를 허용하며 디코딩 캔버스를 쌓지 않는다', async () => {
    const boundary = preparedBoundary();
    const decode = vi.mocked(imageIo.prepareImage).getMockImplementation()!;
    vi.mocked(imageIo.prepareImage).mockImplementation(async (file) => {
      expect(boundary.decoded.every((image) => image.source.width === 0)).toBe(true);
      return decode(file);
    });
    const files = batchFiles(51);
    const saved = await cacheResourceFiles(files);
    expect(saved).toHaveLength(51);
    expect(new Set(saved.map((resource) => resource.id)).size).toBe(51);
    expect(saved.map((resource) => resource.name)).toEqual(files.map((file) => file.name));
    expect(boundary.add).toHaveBeenCalledOnce();
    expect(boundary.add.mock.calls[0]![0]).toHaveLength(51);
    expect(await cacheResourceFiles([files[0]!, files[0]!])).toHaveLength(1);
    expect(boundary.add).toHaveBeenCalledTimes(2);
    expect(boundary.decoded.every((image) => image.source.width === 0)).toBe(true);
  });

  it('50개 유효 파일 뒤의 잘못된 51번째 파일도 전체 저장 전에 거부한다', async () => {
    const boundary = preparedBoundary();
    await expect(
      cacheResourceFiles([
        ...batchFiles(50),
        new File(['broken'], 'bad.png', { type: 'image/png' }),
      ]),
    ).rejects.toThrow('지원하지 않는 파일');
    expect(boundary.decoded).toHaveLength(50);
    expect(boundary.add).not.toHaveBeenCalled();
    expect(boundary.decoded.every((image) => image.source.width === 0)).toBe(true);
  });
});
