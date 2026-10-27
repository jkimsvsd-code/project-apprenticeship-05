import { AssetSchema, parseDocument, type Asset, type StudioDocument } from '@jjal/document-model';
import { canvasSize, LIMITS } from '@jjal/policies';

/** Resource placement creates an independent image layer while retaining the shared asset. */
export function addImageResource(
  doc: StudioDocument,
  panelId: string,
  input: Asset,
  point?: { x: number; y: number },
) {
  const asset = AssetSchema.parse(input);
  if (!asset.mimeType.startsWith('image/') || !asset.pixelWidth || !asset.pixelHeight)
    throw new Error('이미지 자원을 확인해 주세요.');
  if (
    point &&
    (![point.x, point.y].every(Number.isFinite) ||
      point.x < 0 ||
      point.x > 1 ||
      point.y < 0 ||
      point.y > 1)
  )
    throw new Error('카드 안의 배치 위치를 확인해 주세요.');
  const draft = structuredClone(doc);
  const panel = draft.panels.find((item) => item.id === panelId);
  if (!panel) throw new Error('이미지를 넣을 컷이 없습니다.');
  if (
    panel.elementIds.length >= LIMITS.elementsPerPanel + 2 ||
    panel.elementIds.filter((id) => {
      const kind = draft.elements.find((element) => element.id === id)?.kind;
      return kind !== 'frame' && kind !== 'panel-background';
    }).length >= LIMITS.elementsPerPanel
  )
    throw new Error(
      '컷당 콘텐츠는 최대 100개, 테두리·배경 예약 공간을 포함한 전체 요소는 최대 102개입니다.',
    );
  const same = draft.assets.find((item) => item.sha256 === asset.sha256);
  if (
    same &&
    (same.mimeType !== asset.mimeType ||
      same.byteLength !== asset.byteLength ||
      same.pixelWidth !== asset.pixelWidth ||
      same.pixelHeight !== asset.pixelHeight)
  )
    throw new Error('같은 자원 해시에 서로 다른 정보가 있습니다.');
  const stored = same ?? asset;
  if (!same) {
    if (draft.assets.some((item) => item.id === asset.id))
      throw new Error('같은 자원 ID의 내용이 다릅니다.');
    draft.assets.push(asset);
  }
  const elementId = `element-${crypto.randomUUID()}`;
  draft.elements.push({
    id: elementId,
    kind: 'image',
    assetId: stored.id,
    fit: 'contain',
    locked: false,
    hidden: false,
  });
  panel.elementIds.push(elementId);
  for (const layout of draft.layouts) {
    const placed = layout.panels.find((item) => item.panelId === panelId)!;
    const size = canvasSize(layout.ratio, 1080);
    const pw = placed.rect.width * size.width;
    const ph = placed.rect.height * size.height;
    const scale = Math.min((pw * 0.45) / asset.pixelWidth, (ph * 0.45) / asset.pixelHeight);
    const width = (asset.pixelWidth * scale) / pw;
    const height = (asset.pixelHeight * scale) / ph;
    const center = layout.ratio === doc.activeRatio && point ? point : { x: 0.5, y: 0.5 };
    placed.elements.push({
      elementId,
      transform: {
        x: Math.max(0, Math.min(1 - width, center.x - width / 2)),
        y: Math.max(0, Math.min(1 - height, center.y - height / 2)),
        width,
        height,
        rotation: 0,
        flipX: false,
        opacity: 1,
      },
    });
  }
  draft.updatedAt = new Date().toISOString();
  return { document: parseDocument(draft), elementId, assetId: stored.id };
}
