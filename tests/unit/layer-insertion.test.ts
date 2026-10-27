import { describe, expect, it } from 'vitest';
import { addElement, createEditorDocument, setElementFlags } from '@jjal/editor-core';
import { parseDocument } from '@jjal/document-model';
import { textContentRect } from '@jjal/renderer';
import { canInsertLayer, insertLayer } from '../../apps/demo/src/composition/layerOrder';
import { ensurePanelBackgroundLayers } from '../../apps/demo/src/composition/panelBackgrounds';

describe('display-order layer insertion', () => {
  it('inserts on either side without changing any of the eight placements', () => {
    let doc = createEditorDocument();
    const first = addElement(doc, doc.panels[0]!.id, { kind: 'text' });
    const second = addElement(first.document, doc.panels[0]!.id, { kind: 'text' });
    doc = second.document;
    const layouts = structuredClone(doc.layouts);
    const insertion = { panelId: doc.panels[0]!.id, targetId: 'line-1', edge: 'after' as const };
    const next = insertLayer(doc, second.elementId, insertion);
    expect([...next.panels[0]!.elementIds].reverse()).toEqual([
      first.elementId,
      'line-1',
      second.elementId,
    ]);
    expect(next.layouts).toEqual(layouts);
    expect(
      [
        ...insertLayer(next, second.elementId, { ...insertion, edge: 'before' }).panels[0]!
          .elementIds,
      ].reverse(),
    ).toEqual([first.elementId, second.elementId, 'line-1']);
  });
  it('rejects locked, missing targets and other cuts without mutating work', () => {
    const doc = createEditorDocument();
    const before = structuredClone(doc);
    const target = { panelId: doc.panels[0]!.id, targetId: null, edge: 'after' as const };
    expect(() =>
      insertLayer(setElementFlags(doc, ['line-1'], { locked: true }), 'line-1', target),
    ).toThrow();
    expect(() => insertLayer(doc, 'line-1', { ...target, panelId: 'other-panel' })).toThrow();
    expect(() => insertLayer(doc, 'line-1', { ...target, targetId: 'missing' })).toThrow();
    expect(doc).toEqual(before);
  });
});

describe('opt-in text box padding', () => {
  it('preserves legacy schema-v1 geometry and applies equal relative insets only when present', () => {
    const doc = createEditorDocument();
    const text = doc.elements[0]!;
    if (text.kind !== 'text') throw new Error('Expected default text');
    expect(textContentRect(text, 150, 90)).toEqual({ x: 0, y: 0, width: 150, height: 90 });
    const padded = textContentRect({ ...text, boxPaddingRatio: 1 / 6 }, 150, 90);
    expect(padded).toMatchObject({ x: 25, y: 15 });
    expect(padded.width).toBeCloseTo(100);
    expect(padded.height).toBeCloseTo(60);
    const invalid = structuredClone(doc);
    Object.assign(invalid.elements[0]!, { boxPaddingRatio: -0.1 });
    expect(() => parseDocument(invalid)).toThrow();
  });
});

describe('group order preservation', () => {
  it('only offers insertion feedback for an actual permitted move outside the moving group', () => {
    const doc = ensurePanelBackgroundLayers(createEditorDocument());
    const frame = doc.elements.find((element) => element.kind === 'frame')!;
    const bg = doc.elements.find((element) => element.kind === 'panel-background')!;
    const target = { panelId: doc.panels[0]!.id, targetId: 'line-1', edge: 'before' as const };
    expect(canInsertLayer(doc, frame.id, target)).toBe(true);
    expect(insertLayer(doc, frame.id, target)).not.toBe(doc);
    expect(canInsertLayer(doc, frame.id, { ...target, targetId: bg.id })).toBe(false);
    expect(insertLayer(doc, frame.id, { ...target, targetId: bg.id })).toBe(doc);
    expect(canInsertLayer(doc, frame.id, { ...target, panelId: 'other-cut' })).toBe(false);
    expect(canInsertLayer(doc, frame.id, { ...target, targetId: 'missing' })).toBe(false);
    expect(canInsertLayer(setElementFlags(doc, [bg.id], { locked: true }), frame.id, target)).toBe(
      false,
    );
  });
  it('moves the default frame/background together and preserves all ratio placements', () => {
    const doc = ensurePanelBackgroundLayers(createEditorDocument());
    const frame = doc.elements.find((element) => element.kind === 'frame')!;
    const bg = doc.elements.find((element) => element.kind === 'panel-background')!;
    const next = insertLayer(doc, frame.id, {
      panelId: doc.panels[0]!.id,
      targetId: 'line-1',
      edge: 'before',
    });
    expect([...next.panels[0]!.elementIds].reverse()).toEqual([frame.id, bg.id, 'line-1']);
    expect(next.layouts).toEqual(doc.layouts);
    expect([...doc.panels[0]!.elementIds].reverse()).toEqual(['line-1', frame.id, bg.id]);
  });
  it('refuses a locked peer without changing its group order or original document', () => {
    const doc = ensurePanelBackgroundLayers(createEditorDocument());
    const bg = doc.elements.find((element) => element.kind === 'panel-background')!;
    const frame = doc.elements.find((element) => element.kind === 'frame')!;
    const locked = setElementFlags(doc, [bg.id], { locked: true });
    const original = structuredClone(locked);
    expect(() =>
      insertLayer(locked, frame.id, {
        panelId: doc.panels[0]!.id,
        targetId: 'line-1',
        edge: 'before',
      }),
    ).toThrow('잠긴');
    expect(locked).toEqual(original);
  });
});
