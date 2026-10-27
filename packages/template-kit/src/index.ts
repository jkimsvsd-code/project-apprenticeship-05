import { z } from 'zod';
import {
  DocumentSchema,
  IdSchema,
  parseDocument,
  referencedAssetIds,
  type StudioDocument,
} from '@jjal/document-model';
import { LIMITS, DEMO_RATIOS } from '@jjal/policies';

export const TemplateSchema = z.strictObject({
  kind: z.literal('jjal-template'),
  schemaVersion: z.literal(1),
  id: IdSchema,
  name: z.string().trim().min(1).max(120),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  document: DocumentSchema,
});

// 중첩 반복 정규식은 큰 정상 Base64에서 V8의 정규식 스택을 넘을 수 있다.
function validBase64(value: string) {
  if (value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  for (let index = 0; index < value.length - padding; index++) {
    const code = value.charCodeAt(index);
    if (!(
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    ))
      return false;
  }
  return true;
}

// 외부 URL이나 로컬 경로를 저장하지 않는다. Blob은 IndexedDB에서 별도 보관한다.
export const BackupSchema = z
  .strictObject({
    kind: z.literal('jjal-template-backup'),
    schemaVersion: z.literal(1),
    exportedAt: z.iso.datetime(),
    templates: z.array(TemplateSchema).min(1).max(LIMITS.templatesPerImport),
    embeddedAssets: z
      .array(
        z.strictObject({
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
          base64: z.string().refine(validBase64, '이미지 Base64 본문 형식이 올바르지 않습니다.'),
        }),
      )
      .max(500),
  })
  .superRefine((backup, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (new Set(backup.templates.map((t) => t.id)).size !== backup.templates.length)
      issue('템플릿 ID가 중복됩니다.');
    const blobs = new Map(backup.embeddedAssets.map((a) => [a.sha256, a]));
    if (blobs.size !== backup.embeddedAssets.length) issue('중복 소재 본문');
    const used = new Set<string>();
    for (const template of backup.templates) {
      if (template.updatedAt < template.createdAt) issue('템플릿 시각 순서 오류');
      for (const asset of template.document.assets) {
        const blob = blobs.get(asset.sha256);
        if (!blob) {
          issue('소재 본문이 없습니다.');
          continue;
        }
        used.add(asset.sha256);
        const padding = blob.base64.endsWith('==') ? 2 : blob.base64.endsWith('=') ? 1 : 0;
        if ((blob.base64.length / 4) * 3 - padding !== asset.byteLength)
          issue('소재 바이트 수 불일치');
      }
    }
    if (used.size !== blobs.size) issue('참조하지 않는 소재 본문');
  });

export type SavedTemplate = z.infer<typeof TemplateSchema>;
export type TemplateBackup = z.infer<typeof BackupSchema>;

/** 구조 검사. 실제 Blob 검증은 template-kit/browser, 저장은 persistence/browser에서 수행한다. */
export function parseTemplateBackup(text: string): TemplateBackup {
  if (new TextEncoder().encode(text).byteLength > LIMITS.templateBackupBytes)
    throw new Error('JSON 파일은 25MB 이하여야 합니다.');
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error('올바른 JSON 파일이 아닙니다.');
  }
  return BackupSchema.parse(input);
}

/** 현재 demo가 편집·출력할 수 있는 문서만 받아 조용한 데이터 누락을 막는다. */
export function validateEditorDocument(input: StudioDocument): StudioDocument {
  const doc = parseDocument(input);
  for (const element of doc.elements) {
    if (!('style' in element) || element.style.font.kind !== 'uploaded') continue;
    const assetId = element.style.font.assetId;
    const asset = doc.assets.find((item) => item.id === assetId);
    if (!asset || !PERSONAL_FONT_TYPES.includes(asset.mimeType))
      throw new Error('개인 글꼴은 TTF 또는 OTF 원본이 연결되어 있어야 합니다.');
  }
  if (DEMO_RATIOS.some((ratio) => !doc.layouts.some((layout) => layout.ratio === ratio)))
    throw new Error('템플릿에는 1:1·4:5·9:16 기본 배치가 필요합니다.');
  const used = referencedAssetIds(doc);
  if (
    doc.assets.some(
      (asset) =>
        !used.has(asset.id) ||
        !(asset.mimeType.startsWith('image/') || PERSONAL_FONT_TYPES.includes(asset.mimeType)),
    )
  )
    throw new Error('이미지·개인 글꼴 외 소재 또는 참조하지 않는 소재는 저장할 수 없습니다.');
  return doc;
}

const PERSONAL_FONT_TYPES: readonly string[] = ['font/ttf', 'font/otf'];

/** 글꼴을 바꾼 뒤 더 이상 쓰지 않는 개인 글꼴 소재만 제거한다. 이미지 소재는 그대로 둔다. */
export function withoutUnusedFontAssets(input: StudioDocument): StudioDocument {
  const used = referencedAssetIds(input);
  if (input.assets.every((asset) => used.has(asset.id) || !asset.mimeType.startsWith('font/')))
    return input;
  return parseDocument({
    ...input,
    assets: input.assets.filter(
      (asset) => used.has(asset.id) || !asset.mimeType.startsWith('font/'),
    ),
  });
}

export function usesPersonalFonts(doc: StudioDocument): boolean {
  return doc.elements.some(
    (element) => 'style' in element && element.style.font.kind === 'uploaded',
  );
}

export function createSavedTemplate(
  name: string,
  document: StudioDocument,
  previous?: SavedTemplate,
): SavedTemplate {
  const doc = validateEditorDocument(withoutUnusedFontAssets(document));
  const existing = previous ? TemplateSchema.parse(previous) : undefined;
  const now = new Date(
    Math.max(Date.now(), Date.parse(doc.updatedAt), existing ? Date.parse(existing.updatedAt) : 0),
  ).toISOString();
  return TemplateSchema.parse({
    kind: 'jjal-template',
    schemaVersion: 1,
    id: existing?.id ?? crypto.randomUUID(),
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    document: doc,
  });
}

/** 저장 원본과 새 작품이 ID와 객체 참조를 공유하지 않도록 모든 내부 참조를 재연결한다. */
export function cloneTemplateDocument(input: StudioDocument): StudioDocument {
  const doc = validateEditorDocument(input);
  const assetIds = new Map(doc.assets.map((asset) => [asset.id, crypto.randomUUID()]));
  const panelIds = new Map(doc.panels.map((panel) => [panel.id, crypto.randomUUID()]));
  const elementIds = new Map(doc.elements.map((element) => [element.id, crypto.randomUUID()]));
  const groupIds = new Map(
    doc.elements.flatMap((element) =>
      element.groupId ? [[element.groupId, `group-${crypto.randomUUID()}`] as const] : [],
    ),
  );
  doc.id = crypto.randomUUID();
  for (const asset of doc.assets) asset.id = assetIds.get(asset.id)!;
  for (const element of doc.elements) {
    element.id = elementIds.get(element.id)!;
    if ('assetId' in element) element.assetId = assetIds.get(element.assetId)!;
    if (element.kind === 'bubble' && element.customShape)
      element.customShape.sourceAssetId = assetIds.get(element.customShape.sourceAssetId)!;
    if (element.groupId) element.groupId = groupIds.get(element.groupId)!;
    if ('style' in element && element.style.font.kind === 'uploaded')
      element.style.font = { kind: 'uploaded', assetId: assetIds.get(element.style.font.assetId)! };
  }
  for (const background of [
    doc.background,
    ...doc.panels.map((panel) => panel.background),
    ...doc.elements.flatMap((element) =>
      element.kind === 'panel-background' ? [element.background] : [],
    ),
  ]) {
    if (!background) continue;
    for (const key of ['imageAssetId', 'originalImageAssetId', 'resultImageAssetId'] as const)
      if (background[key]) background[key] = assetIds.get(background[key]!)!;
  }
  for (const panel of doc.panels) {
    panel.id = panelIds.get(panel.id)!;
    panel.elementIds = panel.elementIds.map((id) => elementIds.get(id)!);
  }
  for (const layout of doc.layouts)
    for (const panel of layout.panels) {
      panel.panelId = panelIds.get(panel.panelId)!;
      for (const element of panel.elements) element.elementId = elementIds.get(element.elementId)!;
    }
  return parseDocument(doc);
}
