/** Curated local fonts whose source files and embedding rights have been verified. */
export const FONT_CATALOG = [
  {
    family: 'Noto Sans KR',
    label: 'Noto Sans KR',
    path: 'notosanskr/NotoSansKR-Variable.ttf',
    weight: '100 900',
    startup: true,
    boldAvailable: true,
  },
  {
    family: 'Noto Serif KR',
    label: 'Noto Serif KR',
    path: 'notoserifkr/NotoSerifKR-Variable.ttf',
    weight: '200 900',
    startup: true,
    boldAvailable: true,
  },
  {
    family: 'Jua',
    label: 'Jua',
    path: 'jua/Jua-Regular.ttf',
    weight: '400',
    startup: true,
    boldAvailable: false,
  },
  {
    family: 'Dancing Peoples',
    label: '춤추는사람들',
    path: 'DancingPeoples[Dance].ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph Hyunja',
    label: '온글잎 현자체',
    path: 'OwnglyphHyunja-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph Smartiam',
    label: '온글잎 공부잘하자나',
    path: 'OwnglyphSmartiam-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph Haesom',
    label: '온글잎 해솜체',
    path: 'OwnglyphHaesom-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph Lee Sunho',
    label: '온글잎 이선호',
    path: 'OwnglyphLeeSunho-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph Ryurue',
    label: '온글잎 류류체',
    path: 'OwnglyphRyurue-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph BHMSJIHYESSAM',
    label: '온글잎 부흥지혜쌤체',
    path: 'OwnglyphBHMSJIHYESSAM-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph Unreal Science Medicine',
    label: '온글잎 안될과학약체',
    path: 'OwnglyphUnrealScienceMedicine-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph Wiseelist',
    label: '온글잎 위씨리스트',
    path: 'OwnglyphWiseelist-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
  {
    family: 'Ownglyph Wasacrecord',
    label: '온글잎 풋사과레코드',
    path: 'OwnglyphWasacrecord-Regular.ttf',
    weight: '400',
    startup: false,
    boldAvailable: false,
  },
] as const;

export type BuiltinFontFamily = (typeof FONT_CATALOG)[number]['family'];
export const BUILTIN_FONT_FAMILIES = FONT_CATALOG.map((font) => font.family);
export function fontDefinition(family: BuiltinFontFamily) {
  return FONT_CATALOG.find((font) => font.family === family)!;
}
