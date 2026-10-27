import {
  parseDocument,
  referencedAssetIds,
  type StudioDocument,
  type Asset,
} from '../../document-model/src/index';
import { TemplateSchema, type SavedTemplate } from '../../template-kit/src/index';
import { digest, validateFont, type PersonalFont } from './fonts';
import { storeZip } from './zip';
export {
  importPersonalFont,
  listPersonalFonts,
  readPersonalFont,
  ensurePersonalFont,
  personalFontFamily,
  digest,
  FONT_BYTES,
} from './fonts';
export type { PersonalFont } from './fonts';
export const ARCHIVE_BYTES = 100_000_000;
export interface ArchiveResource {
  id: string;
  name: string;
  sha256: string;
  folders?: string[];
}
export interface ArchiveSnapshot {
  current: { document: StudioDocument; preview: Blob };
  templates: SavedTemplate[];
  resources: ArchiveResource[];
  fonts: PersonalFont[];
  files: ReadonlyMap<string, Blob>;
}
export interface ArchiveManifest {
  kind: 'jjal-archive';
  schemaVersion: 1;
  exportedAt: string;
  counts: { resources: number; templates: number; fonts: number; current: 1 };
  files: { path: string; sha256: string; byteLength: number }[];
  assets: { sha256: string; path: string; mimeType: string; byteLength: number }[];
  fonts: (PersonalFont & { path: string })[];
}
export function validateArchiveSize(sizes: readonly number[]): void {
  let total = 0;
  for (const size of sizes) {
    if (!Number.isSafeInteger(size) || size < 0)
      throw new Error('파일 크기 정보가 올바르지 않습니다.');
    total += size;
    if (total > ARCHIVE_BYTES) throw new Error('아카이브 원본 합계는 100MB 이하여야 합니다.');
  }
}
const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
};
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function uniqueIds(rows: readonly { id: string }[], label: string) {
  if (new Set(rows.map((row) => row.id)).size !== rows.length)
    throw new Error(`${label} ID가 중복됩니다.`);
}

export async function createArchive(
  input: ArchiveSnapshot,
): Promise<{ blob: Blob; manifest: ArchiveManifest }> {
  // Snapshot all metadata synchronously before any I/O; Blobs are immutable.
  const current = parseDocument(structuredClone(input.current.document));
  const templates = input.templates.map((t) => TemplateSchema.parse(structuredClone(t)));
  const resources = input.resources.map(({ id, name, sha256, folders }) => {
    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      (folders && (!Array.isArray(folders) || folders.some((f) => typeof f !== 'string')))
    )
      throw new Error('자원 목록 정보가 올바르지 않습니다.');
    return { id, name, sha256, ...(folders ? { folders: [...folders] } : {}) };
  });
  const fonts = input.fonts.map(({ id, name, sha256, mimeType }) => {
    if (typeof id !== 'string' || typeof name !== 'string')
      throw new Error('글꼴 목록 정보가 올바르지 않습니다.');
    return { id, name, sha256, mimeType };
  });
  const bodies = new Map(input.files),
    preview = input.current.preview;
  uniqueIds(templates, '템플릿');
  uniqueIds(resources, '자원');
  uniqueIds(fonts, '글꼴');
  const wanted = new Set([...resources.map((r) => r.sha256), ...fonts.map((f) => f.sha256)]);
  const metadata = new Map<string, Asset>();
  for (const document of [current, ...templates.map((t) => t.document)]) {
    const referenced = referencedAssetIds(document);
    for (const asset of document.assets.filter((a) => referenced.has(a.id))) {
      const previous = metadata.get(asset.sha256);
      if (
        previous &&
        (previous.mimeType !== asset.mimeType ||
          previous.byteLength !== asset.byteLength ||
          previous.pixelWidth !== asset.pixelWidth ||
          previous.pixelHeight !== asset.pixelHeight)
      )
        throw new Error('같은 원본 해시에 서로 다른 파일 정보가 있습니다.');
      metadata.set(asset.sha256, asset);
      wanted.add(asset.sha256);
    }
  }
  const selected = [...wanted].sort().map((hash) => {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('원본 SHA-256 정보가 올바르지 않습니다.');
    const blob = bodies.get(hash);
    if (!blob) throw new Error('필요한 원본 파일이 없습니다. 기존 자료는 유지됩니다.');
    return { hash, blob };
  });
  // Fast lower-bound rejection before decoding/hashing potentially large bodies.
  validateArchiveSize([preview.size, ...selected.map(({ blob }) => blob.size)]);
  const entries = new Map<string, Uint8Array<ArrayBuffer>>();
  const assets: ArchiveManifest['assets'] = [];
  for (const { hash, blob } of selected) {
    const mime = blob.type,
      extension = extensions[mime];
    if (!extension) throw new Error('지원하지 않는 원본 파일 형식입니다.');
    if ((await digest(blob)) !== hash)
      throw new Error('원본 파일 SHA-256 해시가 일치하지 않습니다.');
    const declared = metadata.get(hash);
    if (declared && (declared.byteLength !== blob.size || declared.mimeType !== mime))
      throw new Error('문서와 원본 파일 정보가 다릅니다.');
    if (mime.startsWith('image/')) {
      const image = await createImageBitmap(blob);
      try {
        if (
          declared &&
          (declared.pixelWidth !== image.width || declared.pixelHeight !== image.height)
        )
          throw new Error('원본 이미지 크기가 다릅니다.');
      } finally {
        image.close();
      }
    } else {
      await validateFont(blob, `original.${extension}`);
    }
    const path = `${mime.startsWith('font/') ? 'fonts' : 'assets/images'}/${hash}.${extension}`;
    entries.set(path, new Uint8Array(await blob.arrayBuffer()));
    assets.push({ sha256: hash, path, mimeType: mime, byteLength: blob.size });
  }
  const byHash = new Map(assets.map((a) => [a.sha256, a]));
  for (const font of fonts)
    if (byHash.get(font.sha256)?.mimeType !== font.mimeType)
      throw new Error('글꼴 목록과 원본 형식이 다릅니다.');
  entries.set(
    'resources/index.json',
    encode(resources.map((resource) => ({ ...resource, path: byHash.get(resource.sha256)!.path }))),
  );
  entries.set('creations/current/document.json', encode(current));
  if (preview.type !== 'image/png') throw new Error('현재 카드 미리보기는 PNG여야 합니다.');
  const decodedPreview = await createImageBitmap(preview);
  decodedPreview.close();
  entries.set('creations/current/preview.png', new Uint8Array(await preview.arrayBuffer()));
  for (const [i, template] of templates.entries())
    entries.set(
      `creations/templates/template-${String(i + 1).padStart(4, '0')}.json`,
      encode(template),
    );
  const files: ArchiveManifest['files'] = [];
  for (const [path, bytes] of entries)
    files.push({ path, sha256: await digest(new Blob([bytes])), byteLength: bytes.length });
  const manifest: ArchiveManifest = {
    kind: 'jjal-archive',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      resources: resources.length,
      templates: templates.length,
      fonts: fonts.length,
      current: 1,
    },
    files,
    assets,
    fonts: fonts.map((f) => ({ ...f, path: byHash.get(f.sha256)!.path })),
  };
  entries.set('manifest.json', encode(manifest));
  validateArchiveSize([...entries.values()].map((bytes) => bytes.length));
  return {
    blob: storeZip(new Map([...entries].map(([name, body]) => [`jjal-export/${name}`, body]))),
    manifest,
  };
}
