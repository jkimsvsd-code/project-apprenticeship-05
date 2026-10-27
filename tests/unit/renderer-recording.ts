export interface PaintCall {
  operation: string;
  args: unknown[];
  fill: unknown;
  stroke: unknown;
  lineWidth: unknown;
}

/** Geometry recorder, separate from the actual-browser pixel acceptance tests. */
export function recordingCanvas() {
  const calls: PaintCall[] = [];
  const owner = { createElement: () => create() } as unknown as Document;
  function create(): HTMLCanvasElement {
    const state: Record<string, unknown> = {
      measureText: (text: string) => ({
        width: [...text].length * 20,
        actualBoundingBoxAscent: 6,
        actualBoundingBoxDescent: 18,
      }),
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      createPattern: () => ({ texturePattern: true }),
    };
    const context = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[String(key)];
        return (...args: unknown[]) =>
          calls.push({
            operation: String(key),
            args,
            fill: state.fillStyle,
            stroke: state.strokeStyle,
            lineWidth: state.lineWidth,
          });
      },
    });
    const canvas = {
      width: 88,
      height: 99,
      ownerDocument: owner,
      getContext: () => context,
    } as unknown as HTMLCanvasElement;
    state.canvas = canvas;
    return canvas;
  }
  return { canvas: create(), calls };
}
