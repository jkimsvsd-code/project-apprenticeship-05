import { describe, expect, it } from 'vitest';
import { canvasSize } from '@jjal/policies';
import { wrapText } from '@jjal/renderer';

describe('공통 렌더링 규칙', () => {
  it.each([
    ['1:1', 1080, 1080],
    ['4:5', 864, 1080],
    ['9:16', 608, 1080],
  ] as const)('%s는 긴 변 1080 기준으로 계산한다', (ratio, width, height) => {
    expect(canvasSize(ratio)).toEqual({ width, height });
  });
  it('2048 출력에서도 비율을 유지한다', () => {
    expect(canvasSize('16:9', 2048)).toEqual({ width: 2048, height: 1152 });
  });
  it('빈 줄과 마지막 줄바꿈을 유지한다', () => {
    expect(wrapText('첫 줄\n\n마지막\n', 100, (v) => v.length)).toEqual([
      '첫 줄',
      '',
      '마지막',
      '',
    ]);
  });
  it('공백 없는 문구를 줄바꿈하되 이모지 조합을 분리하지 않는다', () => {
    const family = '👨‍👩‍👧‍👦';
    const measure = (v: string) =>
      [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(v)].length;
    expect(wrapText(`가${family}나다`, 2, measure)).toEqual([`가${family}`, '나다']);
  });
});
