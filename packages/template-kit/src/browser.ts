import type { Asset, StudioDocument } from '@jjal/document-model';
import { prepareImage, type PreparedImage } from '@jjal/image-io';
import { LIMITS } from '@jjal/policies';
import { ensureDocumentFonts, loadUploadedFont, renderDocument } from '@jjal/renderer';
import {
  BackupSchema,
  TemplateSchema,
  parseTemplateBackup,
  validateEditorDocument,
  cloneTemplateDocument,
  usesPersonalFonts,
  type SavedTemplate,
} from './index';

const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
function templateError(cause: unknown): Error {
  return cause instanceof Error && cause.name !== 'ZodError'
    ? cause
    : new Error('템플릿의 필수 항목·버전·참조 정보가 올바르지 않습니다.');
}

async function sha256Hex(blob: Blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function metadataKey(asset: Asset) {
  return JSON.stringify([asset.mimeType, asset.byteLength, asset.pixelWidth, asset.pixelHeight]);
}
function collectAssets(templates: SavedTemplate[]) {
  const assets = new Map<string, Asset>();
  let totalPixels = 0;
  for (const template of templates) {
    validateEditorDocument(template.document);
    for (const asset of template.document.assets) {
      if (asset.mimeType.startsWith('font/')) continue;
      const existing = assets.get(asset.sha256);
      if (existing && metadataKey(existing) !== metadataKey(asset))
        throw new Error('같은 소재 해시에 서로 다른 이미지 정보가 지정되어 있습니다.');
      if (!existing) {
        totalPixels += asset.pixelWidth! * asset.pixelHeight!;
        if (totalPixels > LIMITS.decodedPixels)
          throw new Error(
            '한 번에 처리할 이미지의 합계는 4천만 픽셀 이하여야 합니다. 템플릿을 나눠 주세요.',
          );
        assets.set(asset.sha256, asset);
      }
    }
  }
  return assets;
}

async function decodeAsset(asset: Asset, blob: Blob): Promise<PreparedImage> {
  if (blob.size !== asset.byteLength || blob.type !== asset.mimeType)
    throw new Error('소재의 바이트 수 또는 이미지 형식이 일치하지 않습니다.');
  const prepared = await prepareImage(
    new File([blob], `${asset.sha256}.${extensions[asset.mimeType]}`, { type: asset.mimeType }),
  );
  if (prepared.asset.sha256 !== asset.sha256)
    throw new Error('이미지 본문의 SHA256 해시가 일치하지 않습니다.');
  if (metadataKey(prepared.asset) !== metadataKey(asset))
    throw new Error('실제 이미지 크기와 템플릿 소재 정보가 일치하지 않습니다.');
  return { ...prepared, asset };
}

function checkRender(doc: StudioDocument, images: ReadonlyMap<string, PreparedImage>) {
  const canvas = document.createElement('canvas');
  try {
    // 비율별 배치가 실제로 렌더링 가능한지 확인한 뒤에만 저장한다.
    for (const { ratio } of doc.layouts)
      renderDocument(canvas, doc, {
        ratio,
        images: new Map([...images].map(([id, image]) => [id, image.source])),
      });
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function restoreTemplate(
  template: SavedTemplate,
  blobs: ReadonlyMap<string, Blob>,
  freshIds = true,
) {
  const images = new Map<string, PreparedImage>();
  try {
    const parsed = TemplateSchema.parse(template);
    const doc = freshIds
      ? cloneTemplateDocument(parsed.document)
      : validateEditorDocument(parsed.document);
    collectAssets([{ ...parsed, document: doc }]);
    for (const asset of doc.assets) {
      const blob = blobs.get(asset.sha256);
      if (!blob) throw new Error('템플릿 이미지 본문을 찾을 수 없습니다.');
      if (asset.mimeType.startsWith('font/')) {
        // 개인 글꼴 원본은 템플릿 저장소에 함께 보관된 바이트를 검증해 그대로 적용한다.
        if (blob.size !== asset.byteLength || blob.type !== asset.mimeType)
          throw new Error('개인 글꼴 원본의 크기 또는 형식이 일치하지 않습니다.');
        if ((await sha256Hex(blob)) !== asset.sha256)
          throw new Error('개인 글꼴 원본의 SHA256 해시가 일치하지 않습니다.');
        await loadUploadedFont(asset.sha256, blob);
        continue;
      }
      images.set(asset.id, await decodeAsset(asset, blob));
    }
    await ensureDocumentFonts(doc);
    checkRender(doc, images);
    return { doc, images };
  } catch (cause) {
    for (const image of images.values()) image.source.width = image.source.height = 0;
    throw templateError(cause);
  }
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  if (btoa(binary) !== value) throw new Error('이미지 Base64 본문이 올바르지 않습니다.');
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function encodeBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  return btoa(chunks.join(''));
}

export async function prepareBackupImport(
  text: string,
): Promise<{ templates: SavedTemplate[]; assets: Map<string, Blob> }> {
  try {
    const backup = parseTemplateBackup(text);
    const metadata = collectAssets(backup.templates);
    const bodies = new Map(backup.embeddedAssets.map((body) => [body.sha256, body.base64]));
    const assets = new Map<string, Blob>();
    // 순차 검사 후 캔버스는 해제한다. 여러 압축 이미지를 한꺼번에 디코딩하지 않는다.
    for (const [sha256, asset] of metadata) {
      const blob = new Blob([decodeBase64(bodies.get(sha256)!)], { type: asset.mimeType });
      const prepared = await decodeAsset(asset, blob);
      prepared.source.width = prepared.source.height = 0;
      assets.set(sha256, blob);
    }
    const templates: SavedTemplate[] = [];
    for (const template of backup.templates) {
      const doc = cloneTemplateDocument(template.document);
      // 검증된 이미지를 다시 디코딩해 실제 렌더링까지 검사한다. 한 장씩 해제한다.
      const restored = await restoreTemplate({ ...template, document: doc }, assets, false);
      for (const image of restored.images.values()) image.source.width = image.source.height = 0;
      templates.push(TemplateSchema.parse({ ...template, id: crypto.randomUUID(), document: doc }));
    }
    return { templates, assets };
  } catch (cause) {
    throw templateError(cause);
  }
}

export async function readBackupFile(file: File) {
  if (file.size > LIMITS.templateBackupBytes) throw new Error('JSON 파일은 25MB 이하여야 합니다.');
  return prepareBackupImport(await file.text());
}

export async function exportTemplateBackup(
  templates: SavedTemplate[],
  blobs: ReadonlyMap<string, Blob>,
): Promise<string> {
  try {
    if (!templates.length) throw new Error('내보낼 템플릿을 먼저 저장해 주세요.');
    // 기존 Base64 JSON은 이미지 전용 형식이므로 개인 글꼴을 조용히 빼지 않고 거부한다.
    if (templates.some((template) => usesPersonalFonts(template.document)))
      throw new Error(
        '개인 글꼴을 쓰는 템플릿은 JSON 백업에 담을 수 없습니다. 전체 자료 ZIP 다운로드를 사용해 주세요.',
      );
    const metadata = collectAssets(templates);
    // Base64 문자열 생성 전에 파일 합계와 예상 확장 크기를 검사한다.
    const minimumBytes = [...metadata.values()].reduce(
      (sum, asset) => sum + 4 * Math.ceil(asset.byteLength / 3),
      0,
    );
    if (minimumBytes > LIMITS.templateBackupBytes)
      throw new Error('JSON 파일은 25MB 이하여야 합니다. 템플릿을 나눠 주세요.');
    const embeddedAssets: { sha256: string; base64: string }[] = [];
    for (const [sha256, asset] of metadata) {
      const blob = blobs.get(sha256);
      if (!blob) throw new Error('내보낼 템플릿 이미지 본문이 없습니다.');
      const prepared = await decodeAsset(asset, blob);
      prepared.source.width = prepared.source.height = 0;
      embeddedAssets.push({ sha256, base64: await encodeBase64(blob) });
    }
    const backup = BackupSchema.parse({
      kind: 'jjal-template-backup',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      templates,
      embeddedAssets,
    });
    const text = JSON.stringify(backup, null, 2);
    if (new TextEncoder().encode(text).byteLength > LIMITS.templateBackupBytes)
      throw new Error('JSON 파일은 25MB 이하여야 합니다. 템플릿을 나눠 주세요.');
    return text;
  } catch (cause) {
    throw templateError(cause);
  }
}
