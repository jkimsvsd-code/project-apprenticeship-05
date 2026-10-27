import { describe, expect, it } from 'vitest';
import {
  EditHistory,
  createEditorDocument,
  changeCaption,
  transformElement,
  changeDocument,
  addElement,
  deleteElement,
} from '@jjal/editor-core';
import { ASPECT_RATIOS } from '@jjal/policies';

describe('session history', () => {
  it('ignores no-op edits without destroying redo', () => {
    const h = new EditHistory<number>((a, b) => a === b);
    expect(h.undo(0)).toBeUndefined();
    expect(h.redo(0)).toBeUndefined();
    h.record(0, 1);
    expect(h.undo(1)).toBe(0);
    h.record(0, 0);
    expect(h.redoCount).toBe(1);
    expect(h.redo(0)).toBe(1);
  });
  it('groups a gesture, branches after undo, and releases references on clear', () => {
    const h = new EditHistory<number>((a, b) => a === b);
    const gesture = Symbol();
    h.record(0, 1, gesture);
    h.record(1, 2, gesture);
    h.record(2, 3, gesture);
    expect(h.undoCount).toBe(1);
    expect(h.undo(3)).toBe(0);
    h.record(0, 4, gesture);
    expect(h.redoCount).toBe(0);
    expect(h.undo(4)).toBe(0);
    expect(h.redo(0)).toBe(4);
    h.clear();
    expect(h.undoTarget).toBeUndefined();
    expect(h.redoTarget).toBeUndefined();
  });
  it('keeps only 50 complete steps and rejects invalid bounds', () => {
    const h = new EditHistory<number>((a, b) => a === b);
    for (let i = 0; i < 60; i++) h.record(i, i + 1);
    expect(h.undoCount).toBe(50);
    let current = 60;
    while (h.undoCount) current = h.undo(current)!;
    expect(current).toBe(10);
    expect(h.redoCount).toBe(50);
    expect(() => new EditHistory(Object.is, 0)).toThrow();
    expect(() => new EditHistory(Object.is, 1.5)).toThrow();
  });
  it('retains resource identity without retaining rendered frames', () => {
    const image = { original: new Uint8Array([1, 2, 3]) };
    const before = { doc: 'old', images: new Map([['image', image]]) };
    const after = { doc: 'new', images: new Map<string, typeof image>() };
    const h = new EditHistory<typeof before>((a, b) => a.doc === b.doc);
    h.record(before, after);
    expect(h.undo(after)?.images.get('image')).toBe(image);
    expect(h.redo(before)?.images.size).toBe(0);
  });
  for (const ratio of ASPECT_RATIOS) {
    it(`${ratio}: restores text, geometry, add/delete and all layouts without mutation`, () => {
      const original = createEditorDocument();
      const h = new EditHistory<typeof original>((a, b) => a === b);
      const states = [original];
      const apply = (next: typeof original) => {
        h.record(states.at(-1)!, next);
        states.push(next);
      };
      const frozen = JSON.stringify(original);
      apply(changeCaption(states.at(-1)!, { text: '되돌릴 문구' }, ratio, 'line-1'));
      apply(
        transformElement(states.at(-1)!, 'line-1', ratio, { x: 0.2, rotation: 22, flipX: true }),
      );
      const added = addElement(states.at(-1)!, original.panels[0]!.id, {
        kind: 'bubble',
        shape: 'speech',
      });
      apply(added.document);
      apply(deleteElement(states.at(-1)!, added.elementId));
      apply(
        changeDocument(states.at(-1)!, (d) => {
          d.panels[0]!.background.color = '#123456';
        }),
      );
      let current = states.at(-1)!;
      for (let i = states.length - 2; i >= 0; i--) {
        current = h.undo(current)!;
        expect(current).toEqual(states[i]);
      }
      expect(JSON.stringify(original)).toBe(frozen);
      for (let i = 1; i < states.length; i++) {
        current = h.redo(current)!;
        expect(current).toEqual(states[i]);
      }
    });
  }
});
