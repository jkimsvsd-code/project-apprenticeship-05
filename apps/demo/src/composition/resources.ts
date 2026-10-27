import { BUILTIN_ASSETS, STARTER_ASSET_MANIFEST } from '@jjal/content';
import { AssetSchema, type Asset } from '@jjal/document-model';
import { prepareImage, type PreparedImage } from '@jjal/image-io';
import { bubbleResourceShape, customBubbleSourceId } from './bubble-resources';
import { customBubbleFromCandidate, type BubbleImportCandidate } from './png-bubble-import';
import {
  createResourceRepository,
  parseCachedResourceMetadata,
  parseResourceId,
  type CachedResource,
  type CachedResourceMetadata,
} from '@jjal/persistence/browser';

export type { CachedResourceMetadata };
export const RESOURCE_DRAG_MIME = 'application/x-jjal-resource';
export const RESOURCE_CATALOG_URL = './assets/resource-catalog.json';
export const RESOURCE_CATALOG_KEY = 'jjal-resource-catalog-v1';
export const resourceRepository = createResourceRepository();
const listeners = new Set<() => void>();

export function subscribeResources(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function parseResourceDragId(input: unknown): string | null {
  if (typeof input === 'string' && (bubbleResourceShape(input) || customBubbleSourceId(input)))
    return input;
  try {
    return parseResourceId(input);
  } catch {
    return null;
  }
}

function toResource(image: PreparedImage): CachedResource {
  const builtin = BUILTIN_ASSETS.find((entry) => entry.asset.sha256 === image.asset.sha256);
  const id = `resource-${image.asset.sha256}`;
  const name = [...(builtin?.label ?? image.original.name)]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 120);
  return {
    id,
    name: name || '이미지',
    origin: builtin ? 'builtin' : 'user',
    category: builtin ? (builtin.category === 'character' ? 'character' : 'background') : 'image',
    createdAt: new Date().toISOString(),
    asset: { ...image.asset, id },
    blob: image.original,
  };
}

export async function cachePreparedImages(
  images: ReadonlyMap<string, PreparedImage> | readonly PreparedImage[],
) {
  const resources = [...images.values()].map(toResource);
  const saved = await resourceRepository.addMany(resources);
  if (saved.length) for (const listener of listeners) listener();
  return saved;
}

export async function cachePreparedImage(image: PreparedImage) {
  return (await cachePreparedImages([image]))[0]!;
}

/** Decode the entire selection before committing any of its resources. */
export async function cacheResourceFiles(files: readonly File[]) {
  if (!files.length) return [];
  const prepared: PreparedImage[] = [];
  try {
    for (const file of files) {
      const image = await prepareImage(file);
      prepared.push(image);
      // Keep validated originals, not every decoded canvas, until the atomic batch write.
      image.source.width = image.source.height = 0;
    }
    return await cachePreparedImages(prepared);
  } finally {
    for (const image of prepared) image.source.width = image.source.height = 0;
  }
}

/** Explicit preview confirmation writes all source PNGs and vector definitions in one IDB transaction. */
export async function cacheBubbleCandidates(candidates: readonly BubbleImportCandidate[]) {
  const resources = candidates.map((candidate) => ({
    ...toResource(candidate.image),
    customBubble: customBubbleFromCandidate(candidate),
  }));
  const saved = await resourceRepository.addMany(resources);
  if (saved.length) for (const listener of listeners) listener();
  return saved;
}

export interface ResourceCatalogEntry {
  asset: Asset;
  url: string;
  label: string;
  category: 'image' | 'character' | 'background';
}
export interface ResourceCatalog {
  version: 1;
  rights: {
    statement: string;
    source: string;
    attributionRequired: boolean;
    thirdPartyArtwork: boolean;
  };
  assets: ResourceCatalogEntry[];
}

export function parseResourceCatalog(input: unknown, baseUrl: string): ResourceCatalog {
  if (!input || typeof input !== 'object') throw new Error('기본 자원 목록이 올바르지 않습니다.');
  const value = input as Record<string, unknown>;
  const rights = value.rights as Record<string, unknown> | undefined;
  if (
    value.version !== 1 ||
    !Array.isArray(value.assets) ||
    value.assets.length > 200 ||
    !rights ||
    typeof rights.statement !== 'string' ||
    !rights.statement.trim() ||
    rights.statement.length > 2_000 ||
    typeof rights.source !== 'string' ||
    !rights.source.trim() ||
    rights.source.length > 500 ||
    typeof rights.attributionRequired !== 'boolean' ||
    typeof rights.thirdPartyArtwork !== 'boolean'
  )
    throw new Error('기본 자원 목록의 버전·소재·권리 정보가 올바르지 않습니다.');
  if (
    rights.source !== 'packages/content/src/asset-manifest.json' ||
    rights.statement !== STARTER_ASSET_MANIFEST.usage.statement ||
    rights.attributionRequired !== STARTER_ASSET_MANIFEST.usage.attributionRequired ||
    rights.thirdPartyArtwork !== STARTER_ASSET_MANIFEST.usage.thirdPartyArtwork
  )
    throw new Error('기본 제공 자원의 권리·출처 조건은 목록 갱신으로 변경할 수 없습니다.');
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const assets = value.assets.map((input: unknown): ResourceCatalogEntry => {
    if (!input || typeof input !== 'object') throw new Error('기본 자원 정보가 올바르지 않습니다.');
    const entry = input as Record<string, unknown>;
    const asset = AssetSchema.parse(entry.asset);
    const metadata = parseCachedResourceMetadata({
      id: `resource-${asset.sha256}`,
      name: entry.label,
      origin: 'builtin',
      category: entry.category === 'pattern' ? 'background' : entry.category,
      createdAt: '2026-10-23T00:00:00.000Z',
      asset: { ...asset, id: `resource-${asset.sha256}` },
    });
    if (typeof entry.url !== 'string') throw new Error('기본 자원 경로가 올바르지 않습니다.');
    const url = new URL(entry.url, base);
    if (
      url.origin !== base.origin ||
      !url.pathname.startsWith('/assets/') ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      /%2f|%5c|%2e/i.test(url.pathname) ||
      !/\.(png|jpe?g|webp)$/i.test(url.pathname) ||
      seen.has(asset.sha256)
    )
      throw new Error('기본 자원 경로 또는 중복 해시가 올바르지 않습니다.');
    seen.add(asset.sha256);
    return { asset, url: url.href, label: metadata.name, category: metadata.category };
  });
  // A catalog update may add resources, but cannot silently alter the bundled originals.
  for (const original of BUILTIN_ASSETS) {
    const entry = assets.find((item) => item.asset.sha256 === original.asset.sha256);
    if (
      !entry ||
      entry.label !== original.label ||
      entry.category !== (original.category === 'character' ? 'character' : 'background') ||
      entry.asset.mimeType !== original.asset.mimeType ||
      entry.asset.byteLength !== original.asset.byteLength ||
      entry.asset.pixelWidth !== original.asset.pixelWidth ||
      entry.asset.pixelHeight !== original.asset.pixelHeight
    )
      throw new Error('기본 제공 원본의 이름·분류·파일 정보는 변경할 수 없습니다.');
  }
  return {
    version: 1,
    rights: {
      statement: rights.statement,
      source: rights.source,
      attributionRequired: rights.attributionRequired,
      thirdPartyArtwork: rights.thirdPartyArtwork,
    },
    assets,
  };
}

let catalogCaching: Promise<CachedResourceMetadata[]> | undefined;
let lastCatalog: ResourceCatalog | undefined;

/** Catalog membership is separate from immutable, deduplicated user Blob metadata. */
export async function listLibraryResources(): Promise<CachedResourceMetadata[]> {
  const resources = await resourceRepository.list();
  let catalog = lastCatalog;
  try {
    const raw = localStorage.getItem(RESOURCE_CATALOG_KEY);
    if (raw) catalog = parseResourceCatalog(JSON.parse(raw), document.baseURI);
  } catch {
    // A damaged optional snapshot must not hide or overwrite cached user originals.
  }
  if (!catalog) return resources;
  const entries = new Map(catalog.assets.map((entry) => [entry.asset.sha256, entry]));
  return resources.map((resource) => {
    const entry = entries.get(resource.asset.sha256);
    return entry &&
      entry.asset.byteLength === resource.asset.byteLength &&
      entry.asset.mimeType === resource.asset.mimeType &&
      entry.asset.pixelWidth === resource.asset.pixelWidth &&
      entry.asset.pixelHeight === resource.asset.pixelHeight
      ? { ...resource, origin: 'builtin', category: entry.category }
      : resource;
  });
}

/** Revalidate the published catalog; a web browser cannot enumerate server directories. */
export function refreshBuiltinResources(): Promise<CachedResourceMetadata[]> {
  if (catalogCaching) return catalogCaching;
  catalogCaching = (async () => {
    const response = await fetch(new URL(RESOURCE_CATALOG_URL, document.baseURI), {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('기본 자원 목록을 불러오지 못했습니다.');
    if (Number(response.headers.get('content-length') ?? 0) > 512_000)
      throw new Error('기본 자원 목록이 너무 큽니다.');
    const text = await response.text();
    if (text.length > 512_000) throw new Error('기본 자원 목록이 너무 큽니다.');
    const catalog = parseResourceCatalog(JSON.parse(text), document.baseURI);
    const stored = new Set((await resourceRepository.list()).map((resource) => resource.id));
    const prepared: PreparedImage[] = [];
    const resources: CachedResource[] = [];
    try {
      for (const entry of catalog.assets) {
        const id = `resource-${entry.asset.sha256}`;
        if (stored.has(id)) continue;
        const assetResponse = await fetch(entry.url, { cache: 'no-store' });
        if (!assetResponse.ok) throw new Error('추가 기본 자원을 불러오지 못했습니다.');
        const blob = await assetResponse.blob();
        if (blob.size !== entry.asset.byteLength)
          throw new Error('기본 자원 파일의 크기가 목록과 다릅니다.');
        const extension = entry.asset.mimeType.split('/')[1];
        const image = await prepareImage(
          new File([blob], `${entry.asset.id}.${extension}`, { type: entry.asset.mimeType }),
        );
        prepared.push(image);
        if (
          image.asset.sha256 !== entry.asset.sha256 ||
          image.asset.mimeType !== entry.asset.mimeType ||
          image.asset.byteLength !== entry.asset.byteLength ||
          image.asset.pixelWidth !== entry.asset.pixelWidth ||
          image.asset.pixelHeight !== entry.asset.pixelHeight
        )
          throw new Error('추가 기본 자원 파일의 해시·크기 검증에 실패했습니다.');
        resources.push({
          id,
          name: entry.label,
          origin: 'builtin',
          category: entry.category,
          createdAt: new Date().toISOString(),
          asset: { ...entry.asset, id },
          blob: image.original,
        });
      }
      const saved = await resourceRepository.addMany(resources);
      lastCatalog = catalog;
      // Keep catalog membership across reloads even when the same bytes were uploaded earlier.
      try {
        localStorage.setItem(RESOURCE_CATALOG_KEY, JSON.stringify(catalog));
      } catch (cause) {
        for (const listener of listeners) listener();
        throw new Error('기본 자원은 유지되지만 목록 정보를 브라우저에 저장하지 못했습니다.', {
          cause,
        });
      }
      for (const listener of listeners) listener();
      return saved;
    } finally {
      for (const image of prepared) image.source.width = image.source.height = 0;
    }
  })().finally(() => {
    catalogCaching = undefined;
  });
  return catalogCaching;
}

export async function readCachedResource(id: string) {
  const resource = await resourceRepository.read(id);
  const extensions: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };
  const extension = extensions[resource.asset.mimeType];
  if (!extension) throw new Error('지원하지 않는 자원 형식입니다.');
  const image = await prepareImage(
    new File([resource.blob], `${resource.id}.${extension}`, { type: resource.asset.mimeType }),
  );
  if (
    image.asset.sha256 !== resource.asset.sha256 ||
    image.asset.byteLength !== resource.asset.byteLength ||
    image.asset.pixelWidth !== resource.asset.pixelWidth ||
    image.asset.pixelHeight !== resource.asset.pixelHeight
  ) {
    image.source.width = image.source.height = 0;
    throw new Error('자원 파일의 크기 또는 해시가 저장 정보와 다릅니다.');
  }
  return { resource, image: { ...image, asset: resource.asset } };
}

export async function cacheResourceBlobs(
  metadata: readonly Asset[],
  assetsBySha: ReadonlyMap<string, Blob>,
) {
  const unique = new Map<string, Asset>();
  for (const input of metadata) {
    const asset = AssetSchema.parse(input);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType))
      throw new Error('지원하지 않는 자원 형식입니다.');
    const previous = unique.get(asset.sha256);
    if (
      previous &&
      (previous.mimeType !== asset.mimeType ||
        previous.byteLength !== asset.byteLength ||
        previous.pixelWidth !== asset.pixelWidth ||
        previous.pixelHeight !== asset.pixelHeight)
    )
      throw new Error('같은 자원 해시에 서로 다른 정보가 있습니다.');
    unique.set(asset.sha256, asset);
  }
  const prepared: PreparedImage[] = [];
  try {
    for (const asset of unique.values()) {
      const blob = assetsBySha.get(asset.sha256);
      if (!blob || blob.type !== asset.mimeType || blob.size !== asset.byteLength)
        throw new Error('자원 파일의 크기 또는 형식이 저장 정보와 다릅니다.');
      const extension =
        asset.mimeType === 'image/png' ? 'png' : asset.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
      const image = await prepareImage(
        new File([blob], `가져온 이미지 ${prepared.length + 1}.${extension}`, {
          type: asset.mimeType,
        }),
      );
      prepared.push(image);
      if (
        image.asset.sha256 !== asset.sha256 ||
        image.asset.pixelWidth !== asset.pixelWidth ||
        image.asset.pixelHeight !== asset.pixelHeight
      )
        throw new Error('자원 파일의 크기 또는 해시가 저장 정보와 다릅니다.');
    }
    return await cachePreparedImages(prepared);
  } finally {
    for (const image of prepared) image.source.width = image.source.height = 0;
  }
}

let builtinCaching: Promise<CachedResourceMetadata[]> | undefined;
export function cacheBuiltinResources(): Promise<CachedResourceMetadata[]> {
  if (builtinCaching) return builtinCaching;
  builtinCaching = (async () => {
    const stored = new Set((await resourceRepository.list()).map((resource) => resource.id));
    const prepared: PreparedImage[] = [];
    try {
      for (const entry of BUILTIN_ASSETS) {
        if (stored.has(`resource-${entry.asset.sha256}`)) continue;
        const response = await fetch(new URL(entry.url, document.baseURI));
        if (!response.ok) throw new Error('기본 소재를 불러오지 못했습니다.');
        const image = await prepareImage(
          new File([await response.arrayBuffer()], `${entry.asset.id}.png`, {
            type: entry.asset.mimeType,
          }),
        );
        prepared.push(image);
        if (
          image.asset.sha256 !== entry.asset.sha256 ||
          image.asset.byteLength !== entry.asset.byteLength ||
          image.asset.pixelWidth !== entry.asset.pixelWidth ||
          image.asset.pixelHeight !== entry.asset.pixelHeight
        )
          throw new Error('기본 소재 파일 검증에 실패했습니다.');
      }
      return await cachePreparedImages(prepared);
    } finally {
      for (const image of prepared) image.source.width = image.source.height = 0;
    }
  })().finally(() => {
    builtinCaching = undefined;
  });
  return builtinCaching;
}
