import { openDB, type DBSchema, type IDBPTransaction } from 'idb';
import {
  DocumentSchema,
  AssetSchema,
  SavedStyleSchema,
  type SavedStyle,
  type Asset,
  type StudioDocument,
  CustomBubbleResourceSchema,
} from '@jjal/document-model';
import { TemplateSchema, type SavedTemplate } from '@jjal/template-kit';
import type {
  CachedResource,
  CachedResourceMetadata,
  DraftRecord,
  ResourceRepository,
  TemplateRepository,
} from '../interfaces/index';
export type {
  CachedResource,
  CachedResourceMetadata,
  ResourceRepository,
} from '../interfaces/index';

export interface StudioDatabase extends DBSchema {
  templates: { key: string; value: SavedTemplate };
  drafts: { key: string; value: DraftRecord };
  assets: { key: string; value: { sha256: string; blob: Blob } };
  styles: { key: string; value: SavedStyle };
  resources: { key: string; value: CachedResource };
}

export function openStudioDatabase(name = 'jjal-studio-demo') {
  return openDB<StudioDatabase>(name, 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('templates', { keyPath: 'id' });
        db.createObjectStore('drafts', { keyPath: 'documentId' });
        db.createObjectStore('assets', { keyPath: 'sha256' });
      }
      if (oldVersion < 2) db.createObjectStore('styles', { keyPath: 'id' });
      // Independent Blob ownership: template cleanup must never remove library resources.
      if (oldVersion < 3) db.createObjectStore('resources', { keyPath: 'id' });
    },
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
    },
  });
}

export function createStyleRepository(name = 'jjal-studio-demo') {
  const parse = (input: unknown) => {
    const result = SavedStyleSchema.safeParse(input);
    if (!result.success) throw new Error('스타일 이름 또는 서식이 올바르지 않습니다.');
    return result.data;
  };
  return {
    async list() {
      const db = await openStudioDatabase(name);
      try {
        return (await db.getAll('styles'))
          .map(parse)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
      } finally {
        db.close();
      }
    },
    async save(input: SavedStyle, mode: 'create' | 'update' = 'create') {
      const style = parse(input);
      const db = await openStudioDatabase(name);
      let tx: IDBPTransaction<StudioDatabase, ['styles'], 'readwrite'>;
      try {
        tx = db.transaction('styles', 'readwrite');
      } catch (cause) {
        db.close();
        throw new Error('스타일 저장소를 열지 못했습니다.', { cause });
      }
      const completed = tx.done;
      void completed.catch(() => undefined);
      try {
        const existing = await tx.store.get(style.id);
        if (mode === 'create' && existing)
          throw new RepositoryError('같은 ID의 스타일이 이미 있습니다.');
        if (mode === 'update' && !existing) throw new RepositoryError('수정할 스타일이 없습니다.');
        if (mode === 'create' && (await tx.store.count()) >= 100)
          throw new RepositoryError('내 스타일은 최대 100개입니다.');
        if (mode === 'create') await tx.store.add(style);
        else await tx.store.put(style);
        await completed;
      } catch (cause) {
        try {
          tx.abort();
        } catch {
          /* Already completed or aborted. */
        }
        await completed.catch(() => undefined);
        if (cause instanceof RepositoryError) throw cause;
        if (cause instanceof DOMException && cause.name === 'QuotaExceededError')
          throw new Error('브라우저 저장 공간이 부족합니다. 기존 스타일은 유지됩니다.', { cause });
        throw new Error('스타일을 저장하지 못했습니다. 기존 스타일은 유지됩니다.', { cause });
      } finally {
        db.close();
      }
    },
    async remove(id: string) {
      const db = await openStudioDatabase(name);
      try {
        await db.delete('styles', id);
      } finally {
        db.close();
      }
    },
  };
}

class RepositoryError extends Error {}

export function parseResourceId(input: unknown): string {
  if (typeof input !== 'string' || !/^resource-[0-9a-f]{64}$/.test(input))
    throw new RepositoryError('자원 ID가 올바르지 않습니다.');
  return input;
}

/** Decode/prepare images before calling the repository; validate metadata and byte ownership here. */
export function parseCachedResourceMetadata(input: unknown): CachedResourceMetadata {
  if (!input || typeof input !== 'object')
    throw new RepositoryError('자원 정보가 올바르지 않습니다.');
  const value = input as Record<string, unknown>;
  const id = parseResourceId(value.id);
  const parsed = AssetSchema.safeParse(value.asset);
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';
  const time = Date.parse(createdAt);
  if (
    !parsed.success ||
    parsed.data.id !== id ||
    id !== `resource-${parsed.data.sha256}` ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(parsed.data.mimeType) ||
    parsed.data.byteLength < 1 ||
    parsed.data.byteLength > 10_000_000 ||
    !parsed.data.pixelWidth ||
    !parsed.data.pixelHeight ||
    parsed.data.pixelWidth * parsed.data.pixelHeight > 40_000_000 ||
    typeof value.name !== 'string' ||
    !value.name.trim() ||
    value.name.length > 120 ||
    [...value.name].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    (value.origin !== 'builtin' && value.origin !== 'user') ||
    (value.category !== 'image' &&
      value.category !== 'character' &&
      value.category !== 'background') ||
    !Number.isFinite(time) ||
    new Date(time).toISOString() !== createdAt
  )
    throw new RepositoryError('자원 이름·형식·크기·생성 시각이 올바르지 않습니다.');
  const customBubble =
    value.customBubble === undefined
      ? undefined
      : CustomBubbleResourceSchema.parse(value.customBubble);
  if (
    customBubble &&
    (parsed.data.mimeType !== 'image/png' || customBubble.customShape.sourceAssetId !== id)
  )
    throw new RepositoryError('말풍선 원본 참조가 올바르지 않습니다.');
  return {
    id,
    name: value.name.trim(),
    origin: value.origin,
    category: value.category,
    createdAt,
    asset: parsed.data,
    ...(customBubble ? { customBubble } : {}),
  };
}

async function checkedResource(input: CachedResource): Promise<CachedResource> {
  const resource = parseCachedResourceMetadata(input);
  validateBlob(input.blob, resource.asset);
  const bytes = await input.blob.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== resource.asset.sha256)
    throw new RepositoryError('자원 파일의 해시가 저장 정보와 다릅니다.');
  return { ...resource, blob: input.blob };
}

function sameResourceBody(left: CachedResourceMetadata, right: CachedResourceMetadata) {
  return (
    left.asset.sha256 === right.asset.sha256 &&
    left.asset.mimeType === right.asset.mimeType &&
    left.asset.byteLength === right.asset.byteLength &&
    left.asset.pixelWidth === right.asset.pixelWidth &&
    left.asset.pixelHeight === right.asset.pixelHeight
  );
}

export async function validateCachedResources(inputs: readonly CachedResource[]) {
  const result = new Map<string, CachedResource>();
  for (const input of inputs) {
    const resource = await checkedResource(input);
    const previous = result.get(resource.id);
    if (previous && !sameResourceBody(previous, resource))
      throw new RepositoryError('같은 자원 해시에 서로 다른 정보가 있습니다.');
    // Preserve the original label and creation time when identical bytes arrive again.
    if (!previous) result.set(resource.id, resource);
  }
  return [...result.values()];
}

function resourceStorageError(cause: unknown): Error {
  if (cause instanceof RepositoryError) return cause;
  if (cause instanceof DOMException && cause.name === 'QuotaExceededError')
    return new Error('브라우저 저장 공간이 부족합니다. 기존 자원은 유지됩니다.', { cause });
  return new Error('자원 저장소를 처리하지 못했습니다. 기존 자원은 유지됩니다.', { cause });
}

export function createResourceRepository(name = 'jjal-studio-demo'): ResourceRepository {
  return {
    async list() {
      const db = await openStudioDatabase(name).catch((cause: unknown) => {
        throw resourceStorageError(cause);
      });
      try {
        return (await db.getAll('resources'))
          .map(parseCachedResourceMetadata)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      } catch (cause) {
        throw resourceStorageError(cause);
      } finally {
        db.close();
      }
    },
    async read(id) {
      parseResourceId(id);
      const db = await openStudioDatabase(name).catch((cause: unknown) => {
        throw resourceStorageError(cause);
      });
      try {
        const resource = await db.get('resources', id);
        if (!resource) throw new RepositoryError('자원을 찾을 수 없습니다.');
        return await checkedResource(resource);
      } catch (cause) {
        throw resourceStorageError(cause);
      } finally {
        db.close();
      }
    },
    async addMany(inputs) {
      // Complete all asynchronous hashes before opening a transaction (no auto-commit gap).
      const resources = await validateCachedResources(inputs);
      if (!resources.length) return [];
      const db = await openStudioDatabase(name).catch((cause: unknown) => {
        throw resourceStorageError(cause);
      });
      let tx: IDBPTransaction<StudioDatabase, ['resources'], 'readwrite'>;
      try {
        tx = db.transaction('resources', 'readwrite');
      } catch (cause) {
        db.close();
        throw resourceStorageError(cause);
      }
      const completed = tx.done;
      void completed.catch(() => undefined);
      try {
        const saved: CachedResourceMetadata[] = [];
        for (const resource of resources) {
          const existing = await tx.store.get(resource.id);
          if (existing) {
            const metadata = parseCachedResourceMetadata(existing);
            validateBlob(existing.blob, metadata.asset);
            if (!sameResourceBody(metadata, resource))
              throw new RepositoryError('저장된 자원 정보가 일치하지 않습니다.');
            if (resource.customBubble) {
              if (
                resource.customBubble.customShape.sourceAssetId !== metadata.id ||
                metadata.asset.mimeType !== 'image/png'
              )
                throw new RepositoryError('말풍선 원본 참조가 올바르지 않습니다.');
              const promoted = {
                ...existing,
                customBubble: structuredClone(resource.customBubble),
              };
              await tx.store.put(promoted);
              saved.push(parseCachedResourceMetadata(promoted));
            } else saved.push(metadata);
          } else {
            await tx.store.add(resource);
            saved.push(parseCachedResourceMetadata(resource));
          }
        }
        await completed;
        return saved;
      } catch (cause) {
        try {
          tx.abort();
        } catch {
          /* Already completed or aborted. */
        }
        await completed.catch(() => undefined);
        throw resourceStorageError(cause);
      } finally {
        db.close();
      }
    },
  };
}

function parsedTemplate(input: unknown): SavedTemplate {
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) throw new RepositoryError('템플릿 형식이 올바르지 않습니다.');
  if (parsed.data.updatedAt < parsed.data.createdAt)
    throw new RepositoryError('템플릿의 수정 시각이 생성 시각보다 빠릅니다.');
  return parsed.data;
}

function referencedAssets(documents: StudioDocument[]): Map<string, Asset> {
  const referenced = new Map<string, Asset>();
  for (const document of documents) {
    for (const asset of document.assets) {
      const previous = referenced.get(asset.sha256);
      if (
        previous &&
        (previous.byteLength !== asset.byteLength ||
          previous.mimeType !== asset.mimeType ||
          previous.pixelWidth !== asset.pixelWidth ||
          previous.pixelHeight !== asset.pixelHeight)
      ) {
        throw new RepositoryError('같은 소재 해시에 서로 다른 정보가 있습니다.');
      }
      referenced.set(asset.sha256, asset);
    }
  }
  return referenced;
}

function validateBlob(blob: unknown, asset: Asset): asserts blob is Blob {
  if (!(blob instanceof Blob) || blob.size !== asset.byteLength || blob.type !== asset.mimeType)
    throw new RepositoryError('소재 파일의 크기 또는 형식이 저장 정보와 다릅니다.');
}

function preparedAssets(templates: SavedTemplate[], assets: ReadonlyMap<string, Blob>) {
  const referenced = referencedAssets(templates.map((template) => template.document));
  const blobs = new Map<string, Blob>();
  for (const [sha256, asset] of referenced) {
    const blob = assets.get(sha256);
    if (!blob) throw new RepositoryError('저장할 소재 파일이 없습니다.');
    validateBlob(blob, asset);
    blobs.set(sha256, blob);
  }
  for (const sha256 of assets.keys()) {
    if (!referenced.has(sha256)) throw new RepositoryError('참조하지 않는 소재 파일이 있습니다.');
  }
  return { referenced, blobs };
}

function storageError(error: unknown): Error {
  if (error instanceof RepositoryError) return error;
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return new Error('브라우저 저장 공간이 부족합니다. 기존 템플릿은 유지됩니다.');
  return new Error('브라우저 저장 작업에 실패했습니다. 기존 템플릿은 유지됩니다.', {
    cause: error,
  });
}

type WriteTransaction = IDBPTransaction<
  StudioDatabase,
  ['templates', 'assets', 'drafts'],
  'readwrite'
>;

async function storedDocuments(tx: WriteTransaction, templates: SavedTemplate[]) {
  const drafts = await tx.objectStore('drafts').getAll();
  return [
    ...templates.map((template) => template.document),
    ...drafts.map((draft) => {
      const parsed = DocumentSchema.safeParse(draft.document);
      if (!parsed.success)
        throw new RepositoryError('저장된 작업의 소재 참조를 확인할 수 없어 변경을 취소했습니다.');
      return parsed.data;
    }),
  ];
}

async function cleanAssets(tx: WriteTransaction, referenced: ReadonlyMap<string, Asset>) {
  const store = tx.objectStore('assets');
  for (const sha256 of await store.getAllKeys()) {
    if (!referenced.has(sha256)) await store.delete(sha256);
  }
}

/**
 * 문서와 Blob을 한 트랜잭션으로 저장한다. 전달한 Blob의 SHA-256과 디코딩 가능 여부는
 * 호출자가 먼저 검증한다. 이 계층은 스키마·크기·MIME·공유 참조를 검사한다.
 * 모든 메서드는 자체 연결을 닫으므로 데이터베이스 교체/삭제를 막지 않는다.
 */
export function createTemplateRepository(name = 'jjal-studio-demo'): TemplateRepository {
  async function write(action: (tx: WriteTransaction) => Promise<void>) {
    const db = await openStudioDatabase(name).catch((error: unknown) => {
      throw storageError(error);
    });
    let tx: WriteTransaction;
    try {
      tx = db.transaction(['templates', 'assets', 'drafts'], 'readwrite');
    } catch (error) {
      db.close();
      throw storageError(error);
    }
    // 요청 실패가 tx.done보다 먼저 관찰되더라도 미처리 거부를 남기지 않는다.
    const completed = tx.done;
    void completed.catch(() => undefined);
    try {
      await action(tx);
      await completed;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // 요청 실패로 이미 취소되거나 종료된 트랜잭션일 수 있다.
      }
      await completed.catch(() => undefined);
      throw storageError(error);
    } finally {
      db.close();
    }
  }

  async function saveMany(
    inputs: SavedTemplate[],
    assets: ReadonlyMap<string, Blob>,
    mode: 'create' | 'update',
  ) {
    const templates = inputs.map(parsedTemplate);
    if (templates.length === 0) throw new RepositoryError('저장할 템플릿이 없습니다.');
    if (new Set(templates.map((template) => template.id)).size !== templates.length)
      throw new RepositoryError('저장할 템플릿 ID가 중복됩니다.');
    const incomingAssets = preparedAssets(templates, assets);
    await write(async (tx) => {
      const store = tx.objectStore('templates');
      const current = (await store.getAll()).map(parsedTemplate);
      const next = new Map(current.map((template) => [template.id, template]));
      for (const template of templates) {
        if (mode === 'create' && next.has(template.id))
          throw new RepositoryError('같은 ID의 템플릿이 이미 있습니다. 기존 항목은 유지됩니다.');
        if (mode === 'update' && !next.has(template.id))
          throw new RepositoryError('수정할 템플릿을 찾을 수 없습니다.');
        next.set(template.id, template);
      }
      const referenced = referencedAssets(await storedDocuments(tx, [...next.values()]));
      const assetStore = tx.objectStore('assets');
      for (const [sha256, asset] of incomingAssets.referenced) {
        const existing = await assetStore.get(sha256);
        if (existing) validateBlob(existing.blob, asset);
        await assetStore.put({ sha256, blob: incomingAssets.blobs.get(sha256)! });
      }
      for (const template of templates) {
        if (mode === 'create') await store.add(template);
        else await store.put(template);
      }
      await cleanAssets(tx, referenced);
    });
  }

  return {
    async list() {
      const db = await openStudioDatabase(name).catch((error: unknown) => {
        throw storageError(error);
      });
      try {
        return (await db.getAll('templates'))
          .map(parsedTemplate)
          .sort(
            (left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id),
          );
      } catch (error) {
        throw storageError(error);
      } finally {
        db.close();
      }
    },
    async read(id) {
      const db = await openStudioDatabase(name).catch((error: unknown) => {
        throw storageError(error);
      });
      let tx: IDBPTransaction<StudioDatabase, ['templates', 'assets'], 'readonly'>;
      try {
        tx = db.transaction(['templates', 'assets'], 'readonly');
      } catch (error) {
        db.close();
        throw storageError(error);
      }
      const completed = tx.done;
      void completed.catch(() => undefined);
      try {
        const row = await tx.objectStore('templates').get(id);
        if (!row) throw new RepositoryError('불러올 템플릿을 찾을 수 없습니다.');
        const template = parsedTemplate(row);
        const assets = new Map<string, Blob>();
        for (const [sha256, asset] of referencedAssets([template.document])) {
          const stored = await tx.objectStore('assets').get(sha256);
          if (!stored) throw new RepositoryError('저장된 소재 파일을 찾을 수 없습니다.');
          validateBlob(stored.blob, asset);
          assets.set(sha256, stored.blob);
        }
        await completed;
        return { template, assets };
      } catch (error) {
        await completed.catch(() => undefined);
        throw storageError(error);
      } finally {
        db.close();
      }
    },
    async save(template, assets, mode) {
      await saveMany([template], assets, mode);
    },
    async remove(id) {
      await write(async (tx) => {
        const store = tx.objectStore('templates');
        const current = (await store.getAll()).map(parsedTemplate);
        if (!current.some((template) => template.id === id))
          throw new RepositoryError('삭제할 템플릿을 찾을 수 없습니다.');
        const remaining = current.filter((template) => template.id !== id);
        const referenced = referencedAssets(await storedDocuments(tx, remaining));
        await store.delete(id);
        await cleanAssets(tx, referenced);
      });
    },
    async addMany(templates, assets) {
      await saveMany(templates, assets, 'create');
    },
  };
}
