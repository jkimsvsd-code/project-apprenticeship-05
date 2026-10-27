import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FONT_CATALOG, FontSchema, type BuiltinFontFamily } from '@jjal/document-model';
import { canvasFont } from '@jjal/renderer';
import { createEditorDocument } from '@jjal/editor-core';

const manifest = JSON.parse(
  readFileSync('apps/demo/public/assets/fonts/additional-manifest.json', 'utf8'),
) as {
  fonts: {
    family: BuiltinFontFamily;
    filename: string;
    sourceFilename?: string;
    label: string;
    path: string;
    licensePath: string;
    license: string;
    sha256: string;
    officialSha256?: string;
    byteLength: number;
    approved: boolean;
    officialFileMatched: boolean;
    modified: boolean;
    copyright: string[];
  }[];
};

describe('권리가 확인된 추가 글꼴', () => {
  it('기존 기본 3종과 추가 10종만 모델과 선택 목록에서 공유한다', () => {
    expect(FONT_CATALOG.filter((font) => font.startup).map((font) => font.family)).toEqual([
      'Noto Sans KR',
      'Noto Serif KR',
      'Jua',
    ]);
    expect(
      FONT_CATALOG.filter((font) => !font.startup)
        .map((font) => font.family)
        .sort(),
    ).toEqual(manifest.fonts.map((font) => font.family).sort());
    expect(manifest.fonts).toHaveLength(10);
    expect(new Set(FONT_CATALOG.map((font) => font.family)).size).toBe(13);
    expect(() => FontSchema.parse({ kind: 'builtin', family: 'Unreviewed font' })).toThrow();
  });
  it('카탈로그의 ASCII 배포 경로가 실제 파일·명세와 일치하고 원본 파일명을 보존한다', () => {
    for (const definition of FONT_CATALOG) {
      expect(definition.path).toMatch(/^[\u0020-\u007e]+$/);
      const publicPath = `apps/demo/public/assets/fonts/${definition.path}`;
      const bytes = readFileSync(publicPath);
      expect(bytes.byteLength).toBeGreaterThan(0);
      const font = manifest.fonts.find((item) => item.family === definition.family);
      if (!definition.startup) {
        expect(font).toBeDefined();
        expect(font!.path).toBe(publicPath);
        expect(font!.filename).toBe(definition.path);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(font!.sha256);
      }
      if (definition.family.startsWith('Ownglyph ')) {
        expect(font!.sourceFilename).toBe(`${font!.label}.ttf`);
        expect(font!.filename).toMatch(/^Ownglyph[A-Za-z]+-Regular\.ttf$/);
        expect(font!.sourceFilename).not.toBe(font!.filename);
      }
    }
  });
  it.each(manifest.fonts)(
    '$family: 공식 원본 해시·라이선스와 실제 regular 표시를 유지한다',
    (font) => {
      const bytes = readFileSync(font.path);
      expect(bytes.byteLength).toBe(font.byteLength);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(font.sha256);
      expect(font.approved && font.officialFileMatched).toBe(true);
      expect(font.modified).toBe(false);
      if (font.officialSha256) expect(font.sha256).toBe(font.officialSha256);
      expect(font.copyright.length).toBeGreaterThan(0);
      const license = readFileSync(font.licensePath, 'utf8');
      if (font.license === 'OFL-1.1') {
        expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
        expect(license).toContain('DISCLAIMER');
        const copyright = readFileSync(
          'apps/demo/public/assets/fonts/licenses/DancingPeoples-COPYRIGHT.txt',
          'utf8',
        );
        expect(copyright).toContain('Hada Type');
      } else {
        expect(font.license).toBe('Ownglyph Original Font License');
        expect(license).toContain('폰트 수정 | 폰트 파일의 수정 가능 | X');
        expect(license).toContain('임베딩 | HW 내 탑재, SW 내 탑재, 웹폰트 등 웹서버 탑재 | O');
        expect(license).toContain('폰트 배포 | 폰트 파일 배포 가능 | O');
      }
      expect(FontSchema.parse({ kind: 'builtin', family: font.family }).kind).toBe('builtin');
      expect(
        canvasFont({
          font: { kind: 'builtin', family: font.family },
          fontSize: 38,
          color: '#000000',
          align: 'center',
          lineHeight: 1.25,
          bold: true,
        }),
      ).toBe(`400 38px "${font.family}", "Noto Sans KR"`);
    },
  );
});

describe('추가 글꼴 지연 로드와 실패 복구', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  function fakeFonts(rejectFirst = false) {
    const requested: { family: string; source: string }[] = [];
    let attempts = 0;
    vi.stubGlobal('document', {
      baseURI: 'http://127.0.0.1:4173/sub/',
      fonts: { add: vi.fn(), ready: Promise.resolve() },
    });
    vi.stubGlobal(
      'FontFace',
      class {
        status = 'loaded';
        constructor(
          public family: string,
          public source: string,
        ) {
          requested.push(this);
        }
        async load() {
          if (rejectFirst && attempts++ === 0) throw new Error('unavailable');
          return this;
        }
      },
    );
    return requested;
  }
  it('시작 때는 원래 3종만 요청하고, ASCII 경로의 추가 글꼴 요청을 공유한다', async () => {
    const requested = fakeFonts();
    const loader = await import('../../packages/renderer/src/fonts');
    await loader.ensureBuiltinFonts();
    expect(requested.map((font) => font.family)).toEqual(['Noto Sans KR', 'Noto Serif KR', 'Jua']);
    const first = loader.ensureFont('Ownglyph Ryurue');
    expect(loader.ensureFont('Ownglyph Ryurue')).toBe(first);
    await first;
    expect(requested).toHaveLength(4);
    expect(requested[3]!.source).toContain('OwnglyphRyurue-Regular.ttf');
    expect(loader.isFontReady('Ownglyph Ryurue')).toBe(true);
  });
  it('실패한 요청은 성공으로 캐시하지 않고 같은 글꼴을 다시 시도한다', async () => {
    const requested = fakeFonts(true);
    const loader = await import('../../packages/renderer/src/fonts');
    await expect(loader.ensureFont('Ownglyph Hyunja')).rejects.toThrow('현자체');
    expect(loader.isFontReady('Ownglyph Hyunja')).toBe(false);
    await loader.ensureFont('Ownglyph Hyunja');
    expect(loader.isFontReady('Ownglyph Hyunja')).toBe(true);
    expect(requested.filter((font) => font.family === 'Ownglyph Hyunja')).toHaveLength(2);
    expect(requested.some((font) => font.family === 'Noto Sans KR')).toBe(true);
  });
  it('문서에서 실제 참조하는 글꼴만 준비하고 중복 참조를 합친다', async () => {
    const requested = fakeFonts();
    const loader = await import('../../packages/renderer/src/fonts');
    const doc = createEditorDocument();
    for (const element of doc.elements)
      if ('style' in element) element.style.font = { kind: 'builtin', family: 'Dancing Peoples' };
    await loader.ensureDocumentFonts(doc);
    expect(requested.map((font) => font.family)).toEqual(['Dancing Peoples', 'Noto Sans KR']);
    expect(requested[0]!.source).toContain('DancingPeoples%5BDance%5D.ttf');
  });
});
