import {
  AssetSchema,
  parseDocument,
  type ElementTransform,
  type StudioDocument,
  type StudioElement,
  type TextStyle,
} from '@jjal/document-model';
import { ASPECT_RATIOS, canvasSize, type AspectRatio } from '@jjal/policies';
import manifest from './asset-manifest.json' with { type: 'json' };

export const STARTER_ASSET_MANIFEST = manifest;

/** Hashes and lengths describe the actual, project-created PNG files in public/assets. */
export const BUILTIN_ASSETS = manifest.assets.map((item) => ({
  ...item,
  asset: AssetSchema.parse(item.asset),
}));

export const BUILTIN_TEMPLATES = [
  {
    id: 'builtin-emotion',
    name: '감정 한마디',
    panelCount: 1,
    description: '한 캐릭터의 감정과 짧은 대사',
  },
  {
    id: 'builtin-dialogue',
    name: '두 캐릭터 대화',
    panelCount: 1,
    description: '두 캐릭터가 주고받는 작은 대화',
  },
  {
    id: 'builtin-before-after',
    name: '전후 비교',
    panelCount: 2,
    description: '변화 전과 후를 나란히 비교',
  },
  {
    id: 'builtin-reaction',
    name: '상황과 반응',
    panelCount: 2,
    description: '상황을 보여주고 표정으로 반응',
  },
  {
    id: 'builtin-story',
    name: '짧은 이야기',
    panelCount: 4,
    description: '작은 시작부터 마무리까지 네 장면',
  },
  {
    id: 'builtin-twist',
    name: '대화와 반전',
    panelCount: 4,
    description: '대화를 이어가다 마지막에 반전',
  },
] as const;

type BuiltinId = (typeof BUILTIN_TEMPLATES)[number]['id'];
type BuiltinFont = Extract<TextStyle['font'], { kind: 'builtin' }>['family'];
type Shape = Extract<StudioElement, { kind: 'bubble' }>['shape'];
type Scene = {
  label: string;
  line: string;
  shape: Shape;
  characters: string[];
  pattern: string;
  reply?: string;
};

const SCENES: Record<BuiltinId, Scene[]> = {
  'builtin-emotion': [
    {
      label: '오늘의 기분',
      line: '좋은 예감이 들어!',
      shape: 'speech',
      characters: ['seed-happy'],
      pattern: 'dots',
    },
  ],
  'builtin-dialogue': [
    {
      label: '우리의 작은 대화',
      line: '산책 갈래?',
      reply: '좋아, 가자!',
      shape: 'speech',
      characters: ['seed-neutral', 'block-happy'],
      pattern: 'grid',
    },
  ],
  'builtin-before-after': [
    {
      label: '01 · 시작하기 전',
      line: '할 수 있을까?',
      shape: 'thought',
      characters: ['seed-surprised'],
      pattern: 'stripes',
    },
    {
      label: '02 · 해낸 뒤',
      line: '생각보다 괜찮네!',
      shape: 'speech',
      characters: ['seed-happy'],
      pattern: 'dots',
    },
  ],
  'builtin-reaction': [
    {
      label: '01 · 상황',
      line: '내일이 마감이래.',
      shape: 'speech',
      characters: ['block-neutral'],
      pattern: 'grid',
    },
    {
      label: '02 · 반응',
      line: '지금 시작하자!',
      shape: 'shout',
      characters: ['seed-angry'],
      pattern: 'focus',
    },
  ],
  'builtin-story': [
    {
      label: '01 · 작은 시작',
      line: '한번 해볼까?',
      shape: 'thought',
      characters: ['seed-neutral'],
      pattern: 'dots',
    },
    {
      label: '02 · 뜻밖의 일',
      line: '어? 비가 오네.',
      shape: 'speech',
      characters: ['block-surprised'],
      pattern: 'stripes',
    },
    {
      label: '03 · 함께하기',
      line: '같이 쓰자!',
      shape: 'speech',
      characters: ['seed-happy'],
      pattern: 'grid',
    },
    {
      label: '04 · 좋은 마무리',
      line: '즐거웠어!',
      shape: 'caption',
      characters: ['block-happy'],
      pattern: 'dots',
    },
  ],
  'builtin-twist': [
    {
      label: '01 · 약속',
      line: '간식 가져왔어?',
      shape: 'speech',
      characters: ['seed-neutral', 'block-neutral'],
      pattern: 'grid',
    },
    {
      label: '02 · 자신 있게',
      line: '물론이지!',
      shape: 'speech',
      characters: ['seed-surprised', 'block-happy'],
      pattern: 'dots',
    },
    {
      label: '03 · 기다림',
      line: '그런데 어디에?',
      shape: 'thought',
      characters: ['seed-angry', 'block-neutral'],
      pattern: 'stripes',
    },
    {
      label: '04 · 반전',
      line: '이미 다 먹었어!',
      shape: 'shout',
      characters: ['seed-happy', 'block-angry'],
      pattern: 'focus',
    },
  ],
};

const FONTS: Record<BuiltinId, BuiltinFont> = {
  'builtin-emotion': 'Noto Sans KR',
  'builtin-dialogue': 'Jua',
  'builtin-before-after': 'Noto Sans KR',
  'builtin-reaction': 'Jua',
  'builtin-story': 'Noto Serif KR',
  'builtin-twist': 'Noto Sans KR',
};

/** Ratio-specific safe edges and gutters. Reading order is always row-major. */
const COMPOSITIONS: Record<
  AspectRatio,
  { edgeX: number; edgeY: number; gutterX: number; gutterY: number; twoColumns: boolean }
> = {
  '1:1': { edgeX: 0.025, edgeY: 0.025, gutterX: 0.018, gutterY: 0.018, twoColumns: true },
  '4:5': { edgeX: 0.03, edgeY: 0.026, gutterX: 0.02, gutterY: 0.018, twoColumns: false },
  '3:4': { edgeX: 0.032, edgeY: 0.025, gutterX: 0.022, gutterY: 0.017, twoColumns: false },
  '2:3': { edgeX: 0.034, edgeY: 0.023, gutterX: 0.024, gutterY: 0.016, twoColumns: false },
  '9:16': { edgeX: 0.028, edgeY: 0.023, gutterX: 0.028, gutterY: 0.015, twoColumns: false },
  '4:3': { edgeX: 0.024, edgeY: 0.029, gutterX: 0.017, gutterY: 0.022, twoColumns: true },
  '3:2': { edgeX: 0.023, edgeY: 0.032, gutterX: 0.018, gutterY: 0.024, twoColumns: true },
  '16:9': { edgeX: 0.023, edgeY: 0.035, gutterX: 0.016, gutterY: 0.026, twoColumns: true },
};

function transform(x: number, y: number, width: number, height: number): ElementTransform {
  return { x, y, width, height, rotation: 0, flipX: false, opacity: 1 };
}

function textStyle(family: BuiltinFont, fontSize: number, caption = false): TextStyle {
  return {
    font: { kind: 'builtin', family },
    fontSize,
    color: caption ? '#52664e' : '#29473d',
    align: 'center',
    lineHeight: 1.25,
    bold: caption,
  };
}

function bubble(id: string, text: string, shape: Shape, style: TextStyle): StudioElement {
  return {
    id,
    kind: 'bubble',
    text,
    style,
    shape,
    fill: '#fffdf6',
    border: '#536a52',
    borderWidth: shape === 'shout' ? 3 : 2,
    tail: shape === 'caption' ? null : { x: 0.5, y: 1 },
    locked: false,
    hidden: false,
  };
}

function panelRects(ratio: AspectRatio, panelCount: number) {
  const c = COMPOSITIONS[ratio];
  const columns =
    panelCount === 4
      ? ratio === '3:2' || ratio === '16:9'
        ? 4
        : 2
      : panelCount === 2 && c.twoColumns
        ? 2
        : 1;
  const rows = panelCount / columns;
  const width = (1 - 2 * c.edgeX - (columns - 1) * c.gutterX) / columns;
  const height = (1 - 2 * c.edgeY - (rows - 1) * c.gutterY) / rows;
  return Array.from({ length: panelCount }, (_, index) => ({
    x: c.edgeX + (index % columns) * (width + c.gutterX),
    y: c.edgeY + Math.floor(index / columns) * (height + c.gutterY),
    width,
    height,
  }));
}

function scenePlacements(
  scene: Scene,
  index: number,
  panelWidth: number,
  panelHeight: number,
  fontSize: number,
  captionSize: number,
) {
  const prefix = `scene-${index + 1}`;
  const captionTop = Math.max(10, panelHeight * 0.04);
  const captionHeight = captionSize * 1.6;
  const bubbleTop = captionTop + captionHeight + Math.max(10, panelHeight * 0.024);
  // The common renderer reserves 18% for tails and 16% at both vertical edges.
  // Two default lines must fit even in a narrow 9:16 four-panel composition.
  const bubbleHeight = Math.max(
    (fontSize * 1.25 * 2) / (0.82 * 0.68) + 8,
    Math.min(fontSize * 2.8 + 30, panelHeight * 0.3),
  );
  const captions = [
    {
      elementId: `${prefix}-label`,
      transform: transform(0.06, captionTop / panelHeight, 0.88, captionHeight / panelHeight),
    },
  ];
  // A tall conversation reads from the first speaker to the second, with each
  // balloon beside its speaker instead of leaving an empty center between them.
  if (scene.reply && panelWidth / panelHeight <= 0.7) {
    const rowTop = captionTop + captionHeight + panelHeight * 0.055;
    const rowGap = panelHeight * 0.045;
    const rowHeight = (panelHeight * 0.94 - rowTop - rowGap) / 2;
    const characterSize = Math.min(panelWidth * 0.43, rowHeight * 0.9);
    const width = characterSize / panelWidth;
    const height = characterSize / panelHeight;
    const centers = [rowTop + rowHeight / 2, rowTop + rowHeight * 1.5 + rowGap];
    return [
      {
        elementId: `${prefix}-character-1`,
        transform: transform(0.03, (centers[0]! - characterSize / 2) / panelHeight, width, height),
      },
      {
        elementId: `${prefix}-character-2`,
        transform: transform(
          0.97 - width,
          (centers[1]! - characterSize / 2) / panelHeight,
          width,
          height,
        ),
      },
      {
        elementId: `${prefix}-bubble`,
        transform: transform(
          0.49,
          (centers[0]! - bubbleHeight / 2) / panelHeight,
          0.48,
          bubbleHeight / panelHeight,
        ),
      },
      {
        elementId: `${prefix}-reply`,
        transform: transform(
          0.03,
          (centers[1]! - bubbleHeight / 2) / panelHeight,
          0.48,
          bubbleHeight / panelHeight,
        ),
      },
      ...captions,
    ];
  }
  const characterCount = scene.characters.length;
  const characterSize = Math.min(
    panelWidth * (characterCount === 1 ? 0.72 : 0.43),
    panelHeight - bubbleTop - bubbleHeight - panelHeight * 0.065,
  );
  let characters = scene.characters.map((_, character) => {
    const center = characterCount === 1 ? 0.5 : character === 0 ? 0.265 : 0.735;
    const width = characterSize / panelWidth;
    const height = characterSize / panelHeight;
    return {
      elementId: `${prefix}-character-${character + 1}`,
      transform: transform(center - width / 2, 0.95 - height, width, height),
    };
  });
  // Four-panel landscape strips have enough height to give both faces their own
  // space. Stack the pair diagonally instead of shrinking them into tiny icons.
  if (panelWidth / panelHeight < 0.5) {
    const availableTop = bubbleTop + bubbleHeight + panelHeight * 0.035;
    const availableHeight = panelHeight * 0.95 - availableTop;
    const gap = panelHeight * 0.025;
    const size = Math.min(
      panelWidth * (characterCount === 1 ? 0.78 : 0.67),
      (availableHeight - gap * (characterCount - 1)) / characterCount,
    );
    const firstTop =
      availableTop + (availableHeight - size * characterCount - gap * (characterCount - 1)) / 2;
    characters = scene.characters.map((_, character) => ({
      elementId: `${prefix}-character-${character + 1}`,
      transform: transform(
        characterCount === 1
          ? (1 - size / panelWidth) / 2
          : character === 0
            ? 0.055
            : 0.945 - size / panelWidth,
        (firstTop + character * (size + gap)) / panelHeight,
        size / panelWidth,
        size / panelHeight,
      ),
    }));
  }
  const bubbles = scene.reply
    ? [
        {
          elementId: `${prefix}-bubble`,
          transform: transform(0.045, bubbleTop / panelHeight, 0.44, bubbleHeight / panelHeight),
        },
        {
          elementId: `${prefix}-reply`,
          transform: transform(0.515, bubbleTop / panelHeight, 0.44, bubbleHeight / panelHeight),
        },
      ]
    : [
        {
          elementId: `${prefix}-bubble`,
          transform: transform(0.075, bubbleTop / panelHeight, 0.85, bubbleHeight / panelHeight),
        },
      ];
  return [...characters, ...bubbles, ...captions];
}

/** Every call returns an independent editable document; shipped templates never mutate. */
export function createBuiltinDocument(id: string): StudioDocument {
  const definition = BUILTIN_TEMPLATES.find((item) => item.id === id);
  if (!definition) throw new Error('초기 템플릿을 찾을 수 없습니다.');
  const scenes = SCENES[definition.id];
  const font = FONTS[definition.id];
  const fontSize = scenes.length === 4 ? 25 : scenes.length === 2 ? 32 : 38;
  const captionSize = scenes.length === 4 ? 18 : scenes.length === 2 ? 23 : 28;
  const elements: StudioElement[] = [];
  const panels: StudioDocument['panels'] = scenes.map((scene, index) => {
    const prefix = `scene-${index + 1}`;
    const panelElements: StudioElement[] = scene.characters.map((character, characterIndex) => ({
      id: `${prefix}-character-${characterIndex + 1}`,
      kind: 'character',
      characterId: character.startsWith('seed') ? 'starter-seed' : 'starter-block',
      assetId: `starter-${character}`,
      anchor: { x: 0.5, y: 0.5 },
      locked: false,
      hidden: false,
    }));
    panelElements.push(
      bubble(`${prefix}-bubble`, scene.line, scene.shape, textStyle(font, fontSize)),
    );
    if (scene.reply)
      panelElements.push(
        bubble(`${prefix}-reply`, scene.reply, 'speech', textStyle(font, fontSize)),
      );
    panelElements.push({
      id: `${prefix}-label`,
      kind: 'text',
      text: scene.label,
      style: textStyle(font, captionSize, true),
      locked: false,
      hidden: false,
    });
    elements.push(...panelElements);
    return {
      id: prefix,
      elementIds: panelElements.map((element) => element.id),
      background: {
        color: '#fbf6e9',
        imageAssetId: `starter-pattern-${scene.pattern}`,
        fit: 'cover',
      },
    };
  });
  const referenced = new Set([
    ...panels.map((panel) => panel.background.imageAssetId),
    ...elements.flatMap((element) => ('assetId' in element ? [element.assetId] : [])),
  ]);
  const now = new Date().toISOString();
  return parseDocument({
    kind: 'jjal-document',
    schemaVersion: 1,
    id: `work-${definition.id}-${crypto.randomUUID()}`,
    title: definition.name,
    createdAt: now,
    updatedAt: now,
    activeRatio: '1:1',
    assets: BUILTIN_ASSETS.filter((item) => referenced.has(item.asset.id)).map(
      (item) => item.asset,
    ),
    panels,
    elements,
    layouts: ASPECT_RATIOS.map((ratio) => {
      const size = canvasSize(ratio);
      return {
        ratio,
        panels: panelRects(ratio, scenes.length).map((rect, index) => ({
          panelId: `scene-${index + 1}`,
          rect,
          elements: scenePlacements(
            scenes[index]!,
            index,
            rect.width * size.width,
            rect.height * size.height,
            fontSize,
            captionSize,
          ),
        })),
      };
    }),
  });
}
