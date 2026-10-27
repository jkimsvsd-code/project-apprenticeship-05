import { z } from 'zod';
import { ASPECT_RATIOS, IMAGE_MIME_TYPES, LIMITS } from '@jjal/policies';
import { BUILTIN_FONT_FAMILIES } from './fonts';
export {
  FONT_CATALOG,
  BUILTIN_FONT_FAMILIES,
  fontDefinition,
  type BuiltinFontFamily,
} from './fonts';

export const IdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const ContourSchema = z.strictObject({
  texture: z.enum(['pen', 'pencil', 'paint']),
  color: ColorSchema,
  width: z.number().finite().min(0).max(30),
});
export type Contour = z.infer<typeof ContourSchema>;
const coordinate = z.number().finite().min(-2).max(3);
const size = z.number().finite().positive().max(4);
export const RectSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  width: size,
  height: size,
});
export const TransformSchema = RectSchema.extend({
  rotation: z.number().finite().min(-360).max(360),
  flipX: z.boolean(),
  // Optional for existing schema-v1 JSON; absence means no vertical reflection.
  flipY: z.boolean().optional(),
  opacity: z.number().min(0).max(1),
});
export const BackgroundPlacementSchema = z.strictObject({
  x: z.number().finite().min(-2).max(2),
  y: z.number().finite().min(-2).max(2),
  zoom: z.number().finite().min(0.1).max(5),
});
export const BackgroundSchema = z.strictObject({
  color: ColorSchema,
  // Omission preserves the opaque fill of existing schema-v1 documents.
  transparent: z.boolean().optional(),
  imageAssetId: IdSchema.nullable(),
  fit: z.enum(['cover', 'contain']),
  originalImageAssetId: IdSchema.optional(),
  resultImageAssetId: IdSchema.optional(),
});
export const FontSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('builtin'),
    family: z.enum(BUILTIN_FONT_FAMILIES),
  }),
  z.strictObject({ kind: z.literal('uploaded'), assetId: IdSchema }),
]);
export const TextStyleSchema = z.strictObject({
  font: FontSchema,
  fontSize: z.number().finite().min(8).max(300),
  color: ColorSchema,
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().finite().min(0.8).max(3),
  bold: z.boolean(),
  outline: z
    .strictObject({ color: ColorSchema, width: z.number().finite().min(0).max(20) })
    .optional(),
});
export const BubbleTailSchema = z.strictObject({
  x: coordinate,
  y: coordinate,
  side: z.enum(['top', 'right', 'bottom', 'left']).optional(),
});
const normalized = z.number().finite().min(0).max(1);
export const CustomBubbleShapeSchema = z
  .strictObject({
    sourceAssetId: IdSchema,
    bodyOutline: z
      .array(z.strictObject({ x: normalized, y: normalized }))
      .min(3)
      .max(256),
    textRect: z.strictObject({
      x: normalized,
      y: normalized,
      width: normalized.positive(),
      height: normalized.positive(),
    }),
  })
  .superRefine((shape, ctx) => {
    const r = shape.textRect;
    if (r.x + r.width > 1.000001 || r.y + r.height > 1.000001)
      ctx.addIssue({ code: 'custom', message: '말풍선 문구 영역이 본체를 벗어났습니다.' });
    const area = shape.bodyOutline.reduce((sum, p, i) => {
      const next = shape.bodyOutline[(i + 1) % shape.bodyOutline.length]!;
      return sum + p.x * next.y - next.x * p.y;
    }, 0);
    if (Math.abs(area) < 0.0001)
      ctx.addIssue({ code: 'custom', message: '말풍선 본체 윤곽의 면적이 없습니다.' });
  });
export type CustomBubbleShape = z.infer<typeof CustomBubbleShapeSchema>;
export const CustomBubbleResourceSchema = z.strictObject({
  customShape: CustomBubbleShapeSchema,
  tail: BubbleTailSchema.nullable(),
  fill: ColorSchema,
  border: ColorSchema,
  borderWidth: z.number().finite().min(0).max(30),
});
export type CustomBubbleResource = z.infer<typeof CustomBubbleResourceSchema>;
export const BubbleAppearanceSchema = z.strictObject({
  shape: z.enum(['speech', 'thought', 'shout', 'caption']),
  fill: ColorSchema,
  border: ColorSchema,
  borderWidth: z.number().finite().min(0).max(30),
  tail: BubbleTailSchema.nullable(),
  textPadding: z
    .strictObject({
      top: z.number().finite().min(0).max(200),
      right: z.number().finite().min(0).max(200),
      bottom: z.number().finite().min(0).max(200),
      left: z.number().finite().min(0).max(200),
    })
    .optional(),
  verticalAlign: z.enum(['top', 'center', 'bottom']).optional(),
  corners: z
    .strictObject({
      topLeft: z.number().finite().min(0).max(50),
      topRight: z.number().finite().min(0).max(50),
      bottomRight: z.number().finite().min(0).max(50),
      bottomLeft: z.number().finite().min(0).max(50),
    })
    .optional(),
  spikeSharpness: z.number().finite().min(0).max(100).optional(),
});
export const SavedStyleSchema = z
  .strictObject({
    kind: z.literal('jjal-style'),
    schemaVersion: z.literal(1),
    id: IdSchema,
    name: z.string().trim().min(1).max(60),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    text: TextStyleSchema,
    bubble: BubbleAppearanceSchema.optional(),
    contour: ContourSchema.optional(),
  })
  .superRefine((style, ctx) => {
    if (style.text.font.kind !== 'builtin')
      ctx.addIssue({ code: 'custom', message: '내 스타일에는 제공 글꼴만 저장할 수 있습니다.' });
    if (style.updatedAt < style.createdAt)
      ctx.addIssue({ code: 'custom', message: '스타일 시각 순서 오류' });
  });
export type SavedStyle = z.infer<typeof SavedStyleSchema>;
export type BubbleAppearance = z.infer<typeof BubbleAppearanceSchema>;
const text = z
  .string()
  .refine(
    (v) => [...v].length <= LIMITS.textCodePoints,
    '문구는 1,000 코드포인트 이하여야 합니다.',
  );
const baseElement = {
  id: IdSchema,
  locked: z.boolean(),
  hidden: z.boolean(),
  contour: ContourSchema.optional(),
  groupId: IdSchema.optional(),
};
export const ElementSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...baseElement,
    kind: z.literal('text'),
    text,
    style: TextStyleSchema,
    // New text boxes opt in; missing values preserve existing schema-v1 layout.
    boxPaddingRatio: z.number().finite().min(0).max(0.4).optional(),
  }),
  z.strictObject({
    ...baseElement,
    kind: z.literal('image'),
    assetId: IdSchema,
    fit: z.enum(['cover', 'contain']),
  }),
  z.strictObject({
    ...baseElement,
    kind: z.literal('character'),
    assetId: IdSchema,
    characterId: IdSchema,
    anchor: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  }),
  z.strictObject({
    ...baseElement,
    kind: z.literal('bubble'),
    text,
    style: TextStyleSchema,
    ...BubbleAppearanceSchema.shape,
    customShape: CustomBubbleShapeSchema.optional(),
  }),
  z.strictObject({
    ...baseElement,
    kind: z.literal('shape'),
    shape: z.enum(['rect', 'ellipse', 'triangle', 'diamond']),
    fill: ColorSchema,
  }),
  z.strictObject({ ...baseElement, kind: z.literal('frame') }),
  z.strictObject({
    ...baseElement,
    kind: z.literal('panel-background'),
    background: BackgroundSchema.extend({ inherit: z.boolean().optional() }),
  }),
]);
export const AssetSchema = z.strictObject({
  id: IdSchema,
  mimeType: z.enum([...IMAGE_MIME_TYPES, 'font/ttf', 'font/otf', 'font/woff', 'font/woff2']),
  byteLength: z.number().int().nonnegative().max(LIMITS.templateBackupBytes),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  pixelWidth: z.number().int().positive().max(40_000).nullable(),
  pixelHeight: z.number().int().positive().max(40_000).nullable(),
});
const PanelSchema = z.strictObject({
  id: IdSchema,
  elementIds: z.array(IdSchema).max(LIMITS.elementsPerPanel + 2),
  background: BackgroundSchema.extend({ inherit: z.boolean().optional() }),
});
const PanelLayoutSchema = z.strictObject({
  panelId: IdSchema,
  rect: RectSchema,
  background: BackgroundPlacementSchema.optional(),
  elements: z
    .array(
      z.strictObject({
        elementId: IdSchema,
        transform: TransformSchema,
        background: BackgroundPlacementSchema.optional(),
      }),
    )
    .max(LIMITS.elementsPerPanel + 2),
});
const LayoutSchema = z.strictObject({
  ratio: z.enum(ASPECT_RATIOS),
  background: BackgroundPlacementSchema.optional(),
  panels: z.array(PanelLayoutSchema).min(1).max(4),
});

export const DocumentSchema = z
  .strictObject({
    kind: z.literal('jjal-document'),
    schemaVersion: z.literal(1),
    id: IdSchema,
    title: z.string().trim().min(1).max(120),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    activeRatio: z.enum(ASPECT_RATIOS),
    // Opt-in migration marker also remembers intentional frame deletion.
    frameLayers: z.boolean().optional(),
    layeredPanelBackgrounds: z.boolean().optional(),
    background: BackgroundSchema.optional(),
    assets: z.array(AssetSchema).max(500),
    panels: z.array(PanelSchema).refine((p) => [1, 2, 4].includes(p.length), '컷은 1·2·4개입니다.'),
    elements: z.array(ElementSchema).max(408),
    layouts: z.array(LayoutSchema).min(1).max(8),
  })
  .superRefine((doc, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const unique = (values: string[], name: string) => {
      if (new Set(values).size !== values.length) issue(`${name} 중복`);
    };
    unique(
      doc.assets.map((v) => v.id),
      '소재 ID',
    );
    unique(
      doc.elements.map((v) => v.id),
      '요소 ID',
    );
    unique(
      doc.panels.map((v) => v.id),
      '컷 ID',
    );
    unique(
      doc.layouts.map((v) => v.ratio),
      '비율 배치',
    );
    if (!doc.layouts.some((v) => v.ratio === doc.activeRatio)) issue('현재 비율 배치가 없습니다.');
    const assetMap = new Map(doc.assets.map((a) => [a.id, a]));
    const elementMap = new Map(doc.elements.map((e) => [e.id, e]));
    const used = doc.panels.flatMap((p) => p.elementIds);
    unique(used, '컷 간 요소 참조');
    if (used.length !== doc.elements.length || used.some((id) => !elementMap.has(id)))
      issue('컷과 요소 참조가 일치하지 않습니다.');
    const imageReference = (id: string) => {
      if (!assetMap.get(id)?.mimeType.startsWith('image/'))
        issue('이미지 소재 참조가 올바르지 않습니다.');
    };
    for (const background of [
      doc.background,
      ...doc.panels.map((panel) => panel.background),
      ...doc.elements.flatMap((element) =>
        element.kind === 'panel-background' ? [element.background] : [],
      ),
    ]) {
      if (!background) continue;
      for (const id of [
        background.imageAssetId,
        background.originalImageAssetId,
        background.resultImageAssetId,
      ])
        if (id) imageReference(id);
      if (background.resultImageAssetId && !background.originalImageAssetId)
        issue('보정 결과에는 원본 이미지가 필요합니다.');
      if (
        background.originalImageAssetId &&
        background.imageAssetId !== background.originalImageAssetId &&
        background.imageAssetId !== background.resultImageAssetId
      )
        issue('현재 배경은 원본 또는 보정 결과여야 합니다.');
    }
    for (const panel of doc.panels) {
      if (
        panel.elementIds.filter(
          (id) => !['frame', 'panel-background'].includes(elementMap.get(id)?.kind ?? ''),
        ).length > LIMITS.elementsPerPanel
      )
        issue('컷당 콘텐츠 요소는 최대 100개입니다.');
      if (panel.background.inherit && !doc.background) issue('전체 배경 참조가 없습니다.');
      if (
        panel.elementIds.filter((id) => elementMap.get(id)?.kind === 'character').length >
        LIMITS.charactersPerPanel
      )
        issue('컷당 캐릭터는 최대 4개입니다.');
    }
    for (const element of doc.elements) {
      if (element.kind === 'panel-background' && element.background.inherit && !doc.background)
        issue('전체 배경 참조가 없습니다.');
      if ('assetId' in element) imageReference(element.assetId);
      if (element.kind === 'bubble' && element.customShape) {
        imageReference(element.customShape.sourceAssetId);
        if (assetMap.get(element.customShape.sourceAssetId)?.mimeType !== 'image/png')
          issue('가져온 말풍선 원본은 PNG여야 합니다.');
      }
      if (
        'style' in element &&
        element.style.font.kind === 'uploaded' &&
        !assetMap.get(element.style.font.assetId)?.mimeType.startsWith('font/')
      )
        issue('글꼴 소재 참조가 올바르지 않습니다.');
    }
    for (const asset of doc.assets) {
      if (asset.mimeType.startsWith('image/')) {
        if (
          !asset.pixelWidth ||
          !asset.pixelHeight ||
          asset.pixelWidth * asset.pixelHeight > LIMITS.decodedPixels ||
          asset.byteLength > LIMITS.imageBytes
        )
          issue('이미지 크기 제한을 초과했거나 크기가 없습니다.');
      } else if (asset.pixelWidth !== null || asset.pixelHeight !== null)
        issue('글꼴에는 이미지 크기를 지정하지 않습니다.');
    }
    for (const layout of doc.layouts) {
      unique(
        layout.panels.map((p) => p.panelId),
        '배치의 컷',
      );
      if (layout.panels.length !== doc.panels.length) issue('배치의 컷 수가 일치하지 않습니다.');
      for (const placed of layout.panels) {
        const panel = doc.panels.find((p) => p.id === placed.panelId);
        if (!panel) {
          issue('존재하지 않는 컷 배치');
          continue;
        }
        const placedIds = placed.elements.map((e) => e.elementId);
        unique(placedIds, '배치의 요소');
        if (
          placedIds.length !== panel.elementIds.length ||
          placedIds.some((id) => !panel.elementIds.includes(id))
        )
          issue('배치의 요소 참조가 일치하지 않습니다.');
        const r = placed.rect;
        if (r.x < 0 || r.y < 0 || r.x + r.width > 1.000001 || r.y + r.height > 1.000001)
          issue('컷은 캔버스 안에 있어야 합니다.');
      }
    }
    if (doc.updatedAt < doc.createdAt) issue('수정 시각은 생성 시각보다 이전일 수 없습니다.');
  });

export type StudioDocument = z.infer<typeof DocumentSchema>;
export type StudioElement = z.infer<typeof ElementSchema>;
export type TextStyle = z.infer<typeof TextStyleSchema>;
export type Asset = z.infer<typeof AssetSchema>;
export type ElementTransform = z.infer<typeof TransformSchema>;
export type Background = z.infer<typeof BackgroundSchema>;
export type BackgroundPlacement = z.infer<typeof BackgroundPlacementSchema>;

/** Includes retained originals/results and inactive panel backgrounds. */
export function referencedAssetIds(doc: StudioDocument): Set<string> {
  const used = new Set<string>();
  for (const background of [
    doc.background,
    ...doc.panels.map((panel) => panel.background),
    ...doc.elements.flatMap((element) =>
      element.kind === 'panel-background' ? [element.background] : [],
    ),
  ]) {
    if (!background) continue;
    for (const id of [
      background.imageAssetId,
      background.originalImageAssetId,
      background.resultImageAssetId,
    ])
      if (id) used.add(id);
  }
  for (const element of doc.elements) {
    if ('assetId' in element) used.add(element.assetId);
    if (element.kind === 'bubble' && element.customShape)
      used.add(element.customShape.sourceAssetId);
    if ('style' in element && element.style.font.kind === 'uploaded')
      used.add(element.style.font.assetId);
  }
  return used;
}

export function parseDocument(input: unknown): StudioDocument {
  return DocumentSchema.parse(input);
}
