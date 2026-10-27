import { parseDocument, type StudioDocument } from '@jjal/document-model';
import { ASPECT_RATIOS } from '@jjal/policies';
export {
  BUILTIN_TEMPLATES,
  BUILTIN_ASSETS,
  STARTER_ASSET_MANIFEST,
  createBuiltinDocument,
} from './builtins';

// 개발 환경 확인용 직접 작성 문구. 제품 초기 템플릿 6개와 구분한다.
export function createSampleDocument(): StudioDocument {
  return parseDocument({
    kind: 'jjal-document',
    schemaVersion: 1,
    id: 'sample-scene',
    title: '오늘의 작은 이야기',
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
    activeRatio: '1:1',
    assets: [],
    panels: [
      {
        id: 'panel-1',
        elementIds: ['line-1', 'line-2'],
        background: { color: '#ebe9df', imageAssetId: null, fit: 'cover' },
      },
    ],
    elements: [
      {
        id: 'line-1',
        kind: 'text',
        text: '오늘의 작은 이야기',
        locked: false,
        hidden: false,
        style: {
          font: { kind: 'builtin', family: 'Noto Sans KR' },
          fontSize: 42,
          color: '#243b35',
          align: 'center',
          lineHeight: 1.5,
          bold: true,
        },
      },
      {
        id: 'line-2',
        kind: 'text',
        text: '내 캐릭터의 하루를\n한 장면에 담아보세요.',
        locked: false,
        hidden: false,
        style: {
          font: { kind: 'builtin', family: 'Noto Sans KR' },
          fontSize: 26,
          color: '#51625a',
          align: 'center',
          lineHeight: 1.6,
          bold: false,
        },
      },
    ],
    layouts: ASPECT_RATIOS.map((ratio) => ({
      ratio,
      panels: [
        {
          panelId: 'panel-1',
          rect: { x: 0, y: 0, width: 1, height: 1 },
          elements: [
            {
              elementId: 'line-1',
              transform: {
                x: 0.1,
                y: 0.35,
                width: 0.8,
                height: 0.2,
                rotation: 0,
                flipX: false,
                opacity: 1,
              },
            },
            {
              elementId: 'line-2',
              transform: {
                x: 0.1,
                y: 0.54,
                width: 0.8,
                height: 0.3,
                rotation: 0,
                flipX: false,
                opacity: 1,
              },
            },
          ],
        },
      ],
    })),
  });
}
