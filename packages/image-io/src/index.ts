import type { Asset } from '@jjal/document-model';
import { LIMITS } from '@jjal/policies';

type ImageHeader = {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
};
const invalid = () => new Error('이미지 파일이 손상되었거나 완전하지 않습니다.');
const animated = () =>
  new Error('움직이는 이미지는 지원하지 않습니다. 정지 PNG·JPEG·WebP를 선택해 주세요.');

export function checkFileSize(size: number) {
  if (!size) throw new Error('빈 파일은 불러올 수 없습니다.');
  if (size > LIMITS.imageBytes) throw new Error('이미지는 10MB 이하로 선택해 주세요.');
}

export function checkDimensions(width: number, height: number) {
  if (!width || !height) throw invalid();
  if (width > 40_000 || height > 40_000 || width * height > LIMITS.decodedPixels)
    throw new Error('이미지 크기는 4천만 픽셀 이하, 각 변 40,000px 이하여야 합니다.');
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 디코딩 전에 크기·정지 이미지·구조를 검사하고 브라우저 디코딩으로 최종 검증한다. */
export function inspectImage(bytes: Uint8Array, name: string, declaredType: string): ImageHeader {
  checkFileSize(bytes.length);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  let header: ImageHeader | undefined;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) {
    let offset = 8,
      hasData = false,
      ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset),
        tag = ascii(offset + 4, 4),
        end = offset + 12 + length;
      if (end > bytes.length) throw invalid();
      if (tag === 'acTL') throw animated();
      if (view.getUint32(end - 4) !== crc32(bytes.subarray(offset + 4, end - 4))) throw invalid();
      if (offset === 8) {
        if (tag !== 'IHDR' || length !== 13) throw invalid();
        header = {
          mimeType: 'image/png',
          width: view.getUint32(offset + 8),
          height: view.getUint32(offset + 12),
        };
        checkDimensions(header.width, header.height);
      } else if (tag === 'IHDR') throw invalid();
      if (tag === 'IDAT' && length > 0) hasData = true;
      if (tag === 'IEND') {
        if (length !== 0 || end !== bytes.length) throw invalid();
        ended = true;
        break;
      }
      offset = end;
    }
    if (!header || !hasData || !ended) throw invalid();
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) throw invalid();
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalid();
      if (
        marker !== undefined &&
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        if (length < 8) throw invalid();
        header = {
          mimeType: 'image/jpeg',
          height: view.getUint16(offset + 3),
          width: view.getUint16(offset + 5),
        };
        checkDimensions(header.width, header.height);
      }
      offset += length;
    }
    if (!header || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw invalid();
  } else if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    if (view.getUint32(4, true) + 8 !== bytes.length) throw invalid();
    let offset = 12,
      imageChunks = 0;
    while (offset + 8 <= bytes.length) {
      const tag = ascii(offset, 4),
        length = view.getUint32(offset + 4, true),
        data = offset + 8;
      const end = data + length + (length % 2);
      if (end > bytes.length) throw invalid();
      if (tag === 'ANIM' || tag === 'ANMF') throw animated();
      if (tag === 'VP8X') {
        if (length !== 10) throw invalid();
        if (bytes[data]! & 2) throw animated();
        const u24 = (p: number) => bytes[p]! + (bytes[p + 1]! << 8) + (bytes[p + 2]! << 16);
        header = { mimeType: 'image/webp', width: 1 + u24(data + 4), height: 1 + u24(data + 7) };
        checkDimensions(header.width, header.height);
      }
      if (tag === 'VP8 ' || tag === 'VP8L') {
        imageChunks++;
        let width: number, height: number;
        if (tag === 'VP8 ') {
          if (length < 10 || ascii(data + 3, 3) !== '\x9d\x01\x2a') throw invalid();
          width = view.getUint16(data + 6, true) & 0x3fff;
          height = view.getUint16(data + 8, true) & 0x3fff;
        } else {
          if (length < 5 || bytes[data] !== 0x2f) throw invalid();
          const bits = view.getUint32(data + 1, true);
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
        }
        checkDimensions(width, height);
        if (header && (width !== header.width || height !== header.height)) throw invalid();
        header = { mimeType: 'image/webp', width, height };
      }
      offset = end;
    }
    if (!header || imageChunks !== 1 || offset !== bytes.length) throw invalid();
  } else {
    throw new Error('지원하지 않는 파일입니다. PNG·JPEG·WebP 이미지를 선택해 주세요.');
  }
  const extension = name.split('.').at(-1)?.toLowerCase();
  const allowed = { 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/webp': ['webp'] };
  if (
    !extension ||
    !allowed[header.mimeType].includes(extension) ||
    (declaredType && declaredType !== header.mimeType)
  )
    throw new Error('파일 이름·형식과 실제 이미지 내용이 일치하지 않습니다.');
  return header;
}

export interface PreparedImage {
  asset: Asset;
  source: HTMLCanvasElement;
  original: File;
  resized: boolean;
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  checkFileSize(file.size);
  const buffer = await file.arrayBuffer();
  const header = inspectImage(new Uint8Array(buffer), file.name, file.type);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buffer], { type: header.mimeType }), {
      imageOrientation: 'from-image',
    });
  } catch {
    throw invalid();
  }
  try {
    checkDimensions(bitmap.width, bitmap.height);
    const scale = Math.min(1, LIMITS.editingLongEdge / Math.max(bitmap.width, bitmap.height));
    const source = document.createElement('canvas');
    source.width = Math.max(1, Math.round(bitmap.width * scale));
    source.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = source.getContext('2d');
    if (!context) throw new Error('이 브라우저에서 이미지를 처리할 수 없습니다.');
    context.drawImage(bitmap, 0, 0, source.width, source.height);
    const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');
    return {
      original: file,
      source,
      resized: scale < 1,
      asset: {
        id: `image-${sha256}`,
        sha256,
        mimeType: header.mimeType,
        byteLength: file.size,
        pixelWidth: bitmap.width,
        pixelHeight: bitmap.height,
      },
    };
  } finally {
    bitmap.close();
  }
}

export type ExportFormat = 'png' | 'jpg' | 'webp';
export const EXPORT_MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

/** Reject silent PNG fallback rather than saving misleading file extensions. */
export function imageBlob(canvas: HTMLCanvasElement, format: ExportFormat): Promise<Blob> {
  const mime = EXPORT_MIME[format];
  if (!mime) return Promise.reject(new Error('지원하지 않는 출력 형식입니다.'));
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0)
          reject(new Error('다운로드 파일을 만들지 못했습니다. 다시 시도해 주세요.'));
        else if (blob.type !== mime)
          reject(
            new Error(
              '이 브라우저에서 선택한 출력 형식을 지원하지 않습니다. 다른 형식을 선택해 주세요.',
            ),
          );
        else resolve(blob);
      },
      mime,
      format === 'jpg' ? 0.92 : 1,
    ),
  );
}

export function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return imageBlob(canvas, 'png');
}
