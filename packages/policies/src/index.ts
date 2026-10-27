export const ASPECT_RATIOS = ['1:1', '4:5', '3:4', '2:3', '9:16', '4:3', '3:2', '16:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];
export const DEMO_RATIOS = ['1:1', '4:5', '9:16'] as const satisfies readonly AspectRatio[];

// MB는 1,000,000바이트로 표시·검증한다. 기술 보호값은 ADR-0005에 근거한다.
export const LIMITS = {
  imageBytes: 10_000_000,
  decodedPixels: 40_000_000,
  editingLongEdge: 2048,
  defaultExportLongEdge: 1080,
  textCodePoints: 1000,
  elementsPerPanel: 100,
  charactersPerPanel: 4,
  templateBackupBytes: 25_000_000,
  templatesPerImport: 100,
} as const;

export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function canvasSize(ratio: AspectRatio, longEdge: 1080 | 2048 = 1080) {
  const [width, height] = ratio.split(':').map(Number);
  if (!width || !height) throw new Error('지원하지 않는 화면 비율입니다.');
  const scale = longEdge / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
