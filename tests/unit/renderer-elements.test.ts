import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSampleDocument } from '@jjal/content';
import type { StudioElement, TextStyle } from '@jjal/document-model';
import { canvasFont, renderDocument, textContentRect, textDrawingOffset } from '@jjal/renderer';

const style: TextStyle = {
  font: { kind: 'builtin', family: 'Noto Sans KR' },
  fontSize: 26,
  color: '#123456',
  align: 'center',
  lineHeight: 1.4,
  bold: true,
};

const bubble: Extract<StudioElement, { kind: 'bubble' }> = {
  id: 'balloon',
  kind: 'bubble',
  locked: false,
  hidden: false,
  text: '처음 만나요\n안녕하세요',
  style,
  shape: 'speech',
  fill: '#ffffff',
  border: '#123456',
  borderWidth: 3,
  tail: { x: 0.5, y: 1 },
};

/** A recording context verifies observable geometry and the atomic paint boundary. */
function canvasFixture() {
  const calls: { operation: string; args: unknown[] }[] = [];
  const context = new Proxy(
    {
      measureText: (text: string) => ({ width: [...text].length * 26, actualBoundingBoxAscent: 0 }),
    },
    {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        return (...args: unknown[]) => calls.push({ operation: String(key), args });
      },
    },
  );
  const create = (): HTMLCanvasElement =>
    ({
      width: 88,
      height: 99,
      getContext: () => context,
      ownerDocument: { createElement: create },
    }) as unknown as HTMLCanvasElement;
  return { canvas: create(), calls };
}

describe('실제 요소·말풍선 렌더링', () => {
  it.each(['speech', 'thought', 'shout', 'caption'] as const)(
    '%s 말풍선의 도형과 내부 문구를 모두 그린다',
    (shape) => {
      const doc = createSampleDocument();
      doc.elements[0] = { ...bubble, id: doc.elements[0]!.id, shape };
      const fixture = canvasFixture();
      renderDocument(fixture.canvas, doc);
      expect(fixture.calls.some((call) => call.operation === 'fill')).toBe(true);
      expect(fixture.calls.some((call) => call.operation === 'stroke')).toBe(true);
      expect(fixture.calls.filter((call) => call.operation === 'fillText').length).toBeGreaterThan(
        1,
      );
      expect(fixture.canvas.width).toBe(1080);
    },
  );
  it('이미지 cover와 캐릭터 contain을 같은 좌표계로 그린다', () => {
    const doc = createSampleDocument();
    doc.elements[0] = {
      id: 'line-1',
      kind: 'image',
      assetId: 'picture',
      fit: 'cover',
      locked: false,
      hidden: false,
    };
    doc.elements[1] = {
      id: 'line-2',
      kind: 'character',
      assetId: 'picture',
      characterId: 'cat',
      anchor: { x: 0.5, y: 0.5 },
      locked: false,
      hidden: false,
    };
    const image = { width: 200, height: 100 } as HTMLCanvasElement;
    const fixture = canvasFixture();
    renderDocument(fixture.canvas, doc, { images: new Map([['picture', image]]) });
    const drawings = fixture.calls.filter(
      (call) => call.operation === 'drawImage' && call.args[0] === image,
    );
    expect(drawings).toHaveLength(2);
    expect(drawings[0]!.args).toEqual([image, 0, -108, 864, 432]);
    expect(drawings[1]!.args).toEqual([image, 108, 0, 648, 324]);
  });
  it('소재가 없으면 기존 화면 크기와 픽셀을 교체하지 않는다', () => {
    const doc = createSampleDocument();
    doc.elements[0] = {
      id: 'line-1',
      kind: 'image',
      assetId: 'missing',
      fit: 'cover',
      locked: false,
      hidden: false,
    };
    const fixture = canvasFixture();
    expect(() => renderDocument(fixture.canvas, doc)).toThrow('이미지 데이터를 찾을 수 없습니다');
    expect([fixture.canvas.width, fixture.canvas.height]).toEqual([88, 99]);
    expect(fixture.calls.some((call) => call.operation === 'drawImage')).toBe(false);
  });
  it('말풍선의 꼬리 공간과 글자 여백을 줄바꿈 영역에서 제외한다', () => {
    expect(textContentRect(bubble, 300, 200)).toEqual({ x: 36, y: 26, width: 228, height: 112 });
    expect(textContentRect({ ...bubble, shape: 'caption' }, 300, 200).height).toBe(148);
  });
  it('Jua는 실제 regular를 쓰고 Serif는 지정된 서체를 그대로 쓴다', () => {
    expect(canvasFont({ ...style, font: { kind: 'builtin', family: 'Jua' } })).toBe(
      '400 26px "Jua", "Noto Sans KR"',
    );
    expect(canvasFont({ ...style, font: { kind: 'builtin', family: 'Noto Serif KR' } })).toBe(
      '700 26px "Noto Serif KR"',
    );
    expect(() => canvasFont({ ...style, font: { kind: 'uploaded', assetId: 'font-1' } })).toThrow(
      '업로드 글꼴',
    );
  });
  it('top 기준선 위로 올라오는 줄의 잉크를 정수 여백으로 보호한다', () => {
    const context = {
      measureText: (line: string) =>
        ({ actualBoundingBoxAscent: line === '오늘의 이야기' ? 1.59375 : -8 }) as TextMetrics,
    };
    expect(textDrawingOffset(context, ['처음 만나요', '오늘의 이야기'])).toBe(2);
    expect(textDrawingOffset(context, ['처음 만나요'])).toBe(0);
    expect(textDrawingOffset(context, [])).toBe(0);
  });
});

function hasCodePoint(font: Buffer, codePoint: number) {
  const count = font.readUInt16BE(4);
  let cmap = 0;
  for (let i = 0; i < count; i++) {
    const entry = 12 + i * 16;
    if (font.toString('ascii', entry, entry + 4) === 'cmap') cmap = font.readUInt32BE(entry + 8);
  }
  if (!cmap) return false;
  const subtableCount = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtableCount; i++) {
    const subtable = cmap + font.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = font.readUInt16BE(subtable);
    if (format === 12) {
      const groupCount = font.readUInt32BE(subtable + 12);
      for (let group = 0; group < groupCount; group++) {
        const offset = subtable + 16 + group * 12;
        const first = font.readUInt32BE(offset),
          last = font.readUInt32BE(offset + 4);
        if (first <= codePoint && codePoint <= last)
          return font.readUInt32BE(offset + 8) + codePoint - first !== 0;
      }
    }
    if (format === 4 && codePoint <= 0xffff) {
      const segmentCount = font.readUInt16BE(subtable + 6) / 2;
      for (let segment = 0; segment < segmentCount; segment++) {
        const end = font.readUInt16BE(subtable + 14 + segment * 2);
        const start = font.readUInt16BE(subtable + 16 + segmentCount * 2 + segment * 2);
        if (start > codePoint || codePoint > end) continue;
        const delta = font.readInt16BE(subtable + 16 + segmentCount * 4 + segment * 2);
        const rangeAddress = subtable + 16 + segmentCount * 6 + segment * 2;
        const range = font.readUInt16BE(rangeAddress);
        if (!range) return ((codePoint + delta) & 0xffff) !== 0;
        const glyph = font.readUInt16BE(rangeAddress + range + (codePoint - start) * 2);
        return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
      }
    }
  }
  return false;
}

describe('기본 글꼴의 원본·라이선스·전체 한글', () => {
  const manifest = JSON.parse(
    readFileSync(resolve('apps/demo/public/assets/fonts/manifest.json'), 'utf8'),
  ) as {
    fonts: {
      family: string;
      license: string;
      modified: boolean;
      files: Record<string, { localPath: string; sha256: string; byteLength: number }>;
    }[];
  };
  it.each(manifest.fonts.map((font) => [font.family, font] as const))(
    '%s의 모든 원본과 라이선스 해시가 일치한다',
    (_family, font) => {
      expect(font.license).toBe('OFL-1.1');
      expect(font.modified).toBe(false);
      for (const file of Object.values(font.files)) {
        const data = readFileSync(resolve(file.localPath));
        expect(data.byteLength).toBe(file.byteLength);
        expect(createHash('sha256').update(data).digest('hex')).toBe(file.sha256);
      }
      const license = readFileSync(resolve(font.files.license!.localPath), 'utf8');
      expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1');
      expect(license).toContain('DISCLAIMER');
    },
  );
  it.each(manifest.fonts.map((font) => [font.family, font] as const))(
    '%s의 한글 범위를 실측하고 누락 문자의 로컬 대체를 보장한다',
    (family, font) => {
      const data = readFileSync(resolve(font.files.font!.localPath));
      const missing: number[] = [];
      for (let character = 0xac00; character <= 0xd7a3; character++) {
        if (!hasCodePoint(data, character)) missing.push(character);
      }
      expect(11172 - missing.length).toBe(family === 'Jua' ? 2367 : 11172);
      if (family === 'Jua') {
        expect(missing).toContain('갂'.codePointAt(0));
        expect(canvasFont({ ...style, font: { kind: 'builtin', family: 'Jua' } })).toContain(
          '"Noto Sans KR"',
        );
      }
    },
  );
});

describe('글꼴 로드 완료·오류 처리', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  it('중복 요청을 공유하고 실제 로컬 글꼴 3개가 준비된 후 추가한다', async () => {
    const requested: { family: string; source: string; status: string }[] = [];
    const add = vi.fn();
    vi.stubGlobal('document', {
      baseURI: 'http://127.0.0.1:4173/subfolder/',
      fonts: { add, ready: Promise.resolve() },
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
          return this;
        }
      },
    );
    const { ensureBuiltinFonts } = await import('../../apps/demo/src/composition/fonts');
    const first = ensureBuiltinFonts(),
      second = ensureBuiltinFonts();
    expect(first).toBe(second);
    await first;
    expect(add).toHaveBeenCalledTimes(3);
    expect(requested.map((face) => face.family)).toEqual(['Noto Sans KR', 'Noto Serif KR', 'Jua']);
    expect(
      requested.every((face) =>
        face.source.startsWith('url("http://127.0.0.1:4173/subfolder/assets/fonts/'),
      ),
    ).toBe(true);
  });
  it('파일 로드 실패 시 대체 글꼴로 성공 처리하지 않는다', async () => {
    const add = vi.fn();
    vi.stubGlobal('document', {
      baseURI: 'http://127.0.0.1/',
      fonts: { add, ready: Promise.resolve() },
    });
    vi.stubGlobal(
      'FontFace',
      class {
        async load() {
          throw new Error('missing local file');
        }
      },
    );
    const { ensureBuiltinFonts } = await import('../../apps/demo/src/composition/fonts');
    await expect(ensureBuiltinFonts()).rejects.toThrow(
      'Noto Sans KR 기본 글꼴을 불러오지 못했습니다',
    );
    expect(add).not.toHaveBeenCalled();
  });
});
