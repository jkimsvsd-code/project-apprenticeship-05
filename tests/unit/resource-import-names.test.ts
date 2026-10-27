import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_ASSETS } from '@jjal/content';
import * as imageIo from '@jjal/image-io';
import { parseCachedResourceMetadata, validateCachedResources } from '@jjal/persistence/browser';
import {
  cachePreparedImage,
  cacheResourceBlobs,
  resourceRepository,
} from '../../apps/demo/src/composition/resources';

function body(file: string) {
  const bytes = new Uint8Array(readFileSync(file));
  const name = file.split('/').at(-1)!;
  const mimeType = name.endsWith('.webp') ? 'image/webp' : 'image/png';
  const header = imageIo.inspectImage(bytes, name, mimeType);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    asset: {
      id: `image-${sha256}`,
      sha256,
      mimeType: header.mimeType,
      byteLength: bytes.length,
      pixelWidth: header.width,
      pixelHeight: header.height,
    },
    file: new File([bytes], name, { type: mimeType }),
  };
}

/** Names are unit tested without replacing the production byte/hash/dedup validation. */
function nameBoundary() {
  const decoded: imageIo.PreparedImage[] = [];
  const prepare = vi.spyOn(imageIo, 'prepareImage').mockImplementation(async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const header = imageIo.inspectImage(bytes, file.name, file.type);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const image: imageIo.PreparedImage = {
      asset: {
        id: `image-${sha256}`,
        sha256,
        mimeType: header.mimeType,
        byteLength: file.size,
        pixelWidth: header.width,
        pixelHeight: header.height,
      },
      original: file,
      source: { width: header.width, height: header.height } as HTMLCanvasElement,
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
  return { prepare, add, decoded };
}

afterEach(() => vi.restoreAllMocks());

describe('가져온 자원의 표시 이름', () => {
  it('JSON의 해시 대신 순서별 이름과 원본 확장자를 표시하고 중복 이미지에는 번호를 추가하지 않는다', async () => {
    const boundary = nameBoundary();
    const png = body('tests/fixtures/images/portrait.png');
    const webp = body('tests/fixtures/images/static.webp');
    const saved = await cacheResourceBlobs(
      [png.asset, webp.asset, { ...png.asset, id: 'same-image-in-another-template' }],
      new Map([
        [png.asset.sha256, png.file],
        [webp.asset.sha256, webp.file],
      ]),
    );
    expect(boundary.prepare).toHaveBeenCalledTimes(2);
    expect(saved.map((resource) => resource.name)).toEqual([
      '가져온 이미지 1.png',
      '가져온 이미지 2.webp',
    ]);
    expect(saved.map((resource) => resource.asset.sha256)).toEqual([
      png.asset.sha256,
      webp.asset.sha256,
    ]);
    expect(
      boundary.decoded.every((image) => image.source.width === 0 && image.source.height === 0),
    ).toBe(true);
    expect(png.file.name).toBe('portrait.png');
  });

  it('직접 업로드한 원본 파일 이름은 유지한다', async () => {
    const boundary = nameBoundary();
    const input = body('tests/fixtures/images/portrait.png');
    const named = new File([input.file], '우리 가족 사진.png', { type: input.file.type });
    const prepared = await imageIo.prepareImage(named);
    const saved = await cachePreparedImage(prepared);
    expect(saved.name).toBe('우리 가족 사진.png');
    expect(prepared.original.name).toBe('우리 가족 사진.png');
    expect(prepared.source.width).toBeGreaterThan(0);
    expect(boundary.add).toHaveBeenCalledOnce();
  });

  it('기본 소재는 JSON으로 가져와도 제공 이름과 분류를 유지한다', async () => {
    nameBoundary();
    const entry = BUILTIN_ASSETS[0]!;
    const input = body(`apps/demo/public/${entry.url.replace(/^\.\//, '')}`);
    const saved = await cacheResourceBlobs(
      [entry.asset],
      new Map([[entry.asset.sha256, input.file]]),
    );
    expect(saved[0]!.name).toBe(entry.label);
    expect(saved[0]!.origin).toBe('builtin');
    expect(saved[0]!.category).toBe('character');
  });

  it('같은 바이트가 다른 이름으로 다시 들어와도 최초 표시 이름을 보존한다', async () => {
    nameBoundary();
    const input = body('tests/fixtures/images/portrait.png');
    const upload = await imageIo.prepareImage(
      new File([input.file], '내 사진.png', { type: input.file.type }),
    );
    const first = await cachePreparedImage(upload);
    const imported = await cacheResourceBlobs(
      [input.asset],
      new Map([[input.asset.sha256, input.file]]),
    );
    const repeated = await validateCachedResources([
      { ...first, blob: upload.original },
      { ...imported[0]!, blob: input.file },
    ]);
    expect(repeated).toHaveLength(1);
    expect(repeated[0]!.name).toBe('내 사진.png');
  });
});
