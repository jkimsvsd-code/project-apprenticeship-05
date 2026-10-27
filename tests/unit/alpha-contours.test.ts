import { describe, expect, it } from 'vitest';
import { alphaContourBand, contourInkAlpha } from '@jjal/renderer';

function oracle(alpha: Uint8Array, width: number, height: number, radius: number) {
  return Uint8Array.from(alpha, (_value, index) => {
    const x = index % width,
      y = Math.floor(index / width);
    let maximum = 0,
      minimum = 255;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++) {
        const sx = x + dx,
          sy = y + dy;
        const value =
          sx < 0 || sx >= width || sy < 0 || sy >= height
            ? 0
            : alpha[sy * width + sx]! >= 16
              ? 255
              : 0;
        maximum = Math.max(maximum, value);
        minimum = Math.min(minimum, value);
      }
    return maximum - minimum;
  });
}
describe('PNG alpha 실루엣과 결정적 외곽 질감', () => {
  it.each([1, 2, 3])(
    '반경 %d는 내부 구멍·얇은 선·투명 여백의 경계를 따라가며 단순 전체 사각형이 되지 않는다',
    (radius) => {
      const width = 17,
        height = 11;
      const alpha = new Uint8Array(width * height);
      for (let y = 2; y <= 8; y++) for (let x = 3; x <= 12; x++) alpha[y * width + x] = 255;
      for (let y = 4; y <= 6; y++) for (let x = 7; x <= 9; x++) alpha[y * width + x] = 0;
      const before = alpha.slice(),
        band = alphaContourBand(alpha, width, height, radius);
      expect(band).toEqual(oracle(alpha, width, height, radius));
      expect(band.some((value) => value === 0)).toBe(true);
      expect(band.some((value) => value === 255)).toBe(true);
      expect(alpha).toEqual(before);
    },
  );
  it('불투명 사진은 사각 가장자리에만 선이 생기고 투명 이미지는 아무것도 그리지 않는다', () => {
    const full = new Uint8Array(81).fill(255),
      band = alphaContourBand(full, 9, 9, 1);
    expect(band[4 * 9 + 4]).toBe(0);
    expect(band[0]).toBe(255);
    expect(band[4]).toBe(255);
    expect(alphaContourBand(new Uint8Array(81), 9, 9, 1).every((value) => value === 0)).toBe(true);
  });
  it('희미한 alpha 15는 제외하고 alpha 16 이상은 동일 실루엣으로 취급한다', () => {
    const a = new Uint8Array(25),
      b = new Uint8Array(25);
    a[12] = 16;
    b[12] = 255;
    expect(alphaContourBand(a, 5, 5, 1)).toEqual(alphaContourBand(b, 5, 5, 1));
    a[12] = 15;
    expect(alphaContourBand(a, 5, 5, 1).every((value) => value === 0)).toBe(true);
  });
  it('pen·pencil·paint는 재렌더링 시 동일하며 선명한 펜·성긴 연필·굵은 도료의 밀도가 다르다', () => {
    const samples = (texture: 'pen' | 'pencil' | 'paint') =>
      Array.from({ length: 1024 }, (_, index) =>
        contourInkAlpha(texture, index % 32, Math.floor(index / 32)),
      );
    const pen = samples('pen'),
      pencil = samples('pencil'),
      paint = samples('paint');
    expect(pen.every((value) => value === 255)).toBe(true);
    expect(pencil).toEqual(samples('pencil'));
    expect(paint).toEqual(samples('paint'));
    expect(pencil).toContain(0);
    const average = (values: number[]) =>
      values.reduce((total, value) => total + value, 0) / values.length;
    expect(average(pencil)).toBeLessThan(average(paint));
    expect(average(paint)).toBeLessThan(average(pen));
  });
  it('무효한 raster 크기·반경은 원본을 변경하지 않고 거부한다', () => {
    const alpha = new Uint8Array(25).fill(255),
      before = alpha.slice();
    for (const [width, height, radius] of [
      [0, 5, 1],
      [4, 5, 1],
      [5, 5, 0],
      [5, 5, 65],
      [5, 5, NaN],
    ])
      expect(() => alphaContourBand(alpha, width!, height!, radius!)).toThrow();
    expect(alpha).toEqual(before);
  });
});
