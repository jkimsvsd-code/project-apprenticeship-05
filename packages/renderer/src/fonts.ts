import {
  FONT_CATALOG,
  fontDefinition,
  type BuiltinFontFamily,
  type StudioDocument,
} from '@jjal/document-model';

const pending = new Map<BuiltinFontFamily, Promise<void>>();
const loaded = new Set<BuiltinFontFamily>();
let startup: Promise<void> | undefined;

export function isFontReady(family: BuiltinFontFamily): boolean {
  return loaded.has(family);
}

/** Same-origin originals only. Failed attempts are evicted so selection can retry. */
export function ensureFont(family: BuiltinFontFamily): Promise<void> {
  const existing = pending.get(family);
  if (existing) return existing;
  const definition = fontDefinition(family);
  if (!definition) return Promise.reject(new Error('사용 가능한 글꼴을 선택해 주세요.'));
  const work = (async () => {
    if (typeof FontFace === 'undefined' || !document.fonts)
      throw new Error('기본 글꼴을 불러올 수 없는 브라우저입니다. 최신 브라우저로 열어주세요.');
    const path = definition.path.split('/').map(encodeURIComponent).join('/');
    const url = new URL(`./assets/fonts/${path}`, document.baseURI);
    try {
      const face = await new FontFace(family, `url("${url.href}") format("truetype")`, {
        style: 'normal',
        weight: definition.weight,
      }).load();
      if (face.status !== 'loaded') throw new Error('font not ready');
      if (!definition.boldAvailable) await ensureFont('Noto Sans KR');
      document.fonts.add(face);
      await document.fonts.ready;
      loaded.add(family);
    } catch {
      throw new Error(`${definition.label} 기본 글꼴을 불러오지 못했습니다. 다시 선택해 주세요.`);
    }
  })();
  pending.set(family, work);
  void work.catch(() => pending.delete(family));
  return work;
}

/** Preserve the original three-font startup; extra families load only when used. */
export function ensureBuiltinFonts(): Promise<void> {
  startup ??= Promise.all(
    FONT_CATALOG.filter((font) => font.startup).map((font) => ensureFont(font.family)),
  ).then(() => undefined);
  return startup;
}

/** Browser-internal family for a personal font; never written into document JSON. */
export const uploadedFontFamily = (sha256: string) => `jjal-uploaded-${sha256}`;
const uploadedReady = new Set<string>();
const uploadedAssets = new Map<string, string>();
let uploadedLoader: ((sha256: string) => Promise<void>) | undefined;

/** The app supplies the personal-font store; the renderer only knows hashes and faces. */
export function setUploadedFontLoader(loader: (sha256: string) => Promise<void>): void {
  uploadedLoader = loader;
}

/** Load verified original bytes as the uploaded family. Callers check SHA-256 first. */
export async function loadUploadedFont(sha256: string, bytes: Blob | ArrayBuffer): Promise<void> {
  if (uploadedReady.has(sha256)) return;
  if (typeof FontFace === 'undefined' || !document.fonts)
    throw new Error('개인 글꼴을 불러올 수 없는 브라우저입니다.');
  const data = bytes instanceof Blob ? await bytes.arrayBuffer() : bytes;
  let face: FontFace;
  try {
    face = await new FontFace(uploadedFontFamily(sha256), data).load();
  } catch {
    throw new Error('개인 글꼴을 불러오지 못했습니다. 기존 작업은 유지됩니다.');
  }
  if (face.status !== 'loaded') throw new Error('개인 글꼴을 불러오지 못했습니다.');
  document.fonts.add(face);
  uploadedReady.add(sha256);
}

export function isUploadedFontReady(sha256: string): boolean {
  return uploadedReady.has(sha256);
}

/** Asset IDs change on template copies, so the lookup is rebuilt from each prepared document. */
export function registerUploadedFontAssets(doc: StudioDocument): string[] {
  const hashes: string[] = [];
  for (const element of doc.elements) {
    if (!('style' in element) || element.style.font.kind !== 'uploaded') continue;
    const assetId = element.style.font.assetId;
    const asset = doc.assets.find((item) => item.id === assetId);
    if (!asset || !asset.mimeType.startsWith('font/'))
      throw new Error('개인 글꼴 소재 참조가 올바르지 않습니다.');
    uploadedAssets.set(assetId, asset.sha256);
    hashes.push(asset.sha256);
  }
  return hashes;
}

export function uploadedFontHash(assetId: string): string | undefined {
  return uploadedAssets.get(assetId);
}

/** Template/import rendering must prepare every referenced face before measuring. */
export async function ensureDocumentFonts(doc: StudioDocument): Promise<void> {
  const families = new Set(
    doc.elements.flatMap((element) =>
      'style' in element && element.style.font.kind === 'builtin'
        ? [element.style.font.family]
        : [],
    ),
  );
  const uploaded = new Set(registerUploadedFontAssets(doc));
  await Promise.all([
    ...[...families].map(ensureFont),
    ...[...uploaded].map(async (sha256) => {
      if (uploadedReady.has(sha256)) return;
      if (!uploadedLoader) throw new Error('개인 글꼴 원본을 찾을 수 없습니다.');
      await uploadedLoader(sha256);
      if (!uploadedReady.has(sha256)) throw new Error('개인 글꼴을 준비하지 못했습니다.');
    }),
  ]);
}
