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

/** Template/import rendering must prepare every referenced face before measuring. */
export async function ensureDocumentFonts(doc: StudioDocument): Promise<void> {
  const families = new Set(
    doc.elements.flatMap((element) =>
      'style' in element && element.style.font.kind === 'builtin'
        ? [element.style.font.family]
        : [],
    ),
  );
  await Promise.all([...families].map(ensureFont));
}
