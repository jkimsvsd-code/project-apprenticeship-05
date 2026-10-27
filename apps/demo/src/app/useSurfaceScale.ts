import { useEffect } from 'react';

const surfaces = [
  'button',
  '.json-import',
  '.precision-tools > summary',
  '.content-tools > summary',
  'input[type="file"]',
  '.tool-bookmark-icon',
  '.tool-pages',
  '.canvas-stage',
  '.resource-tray',
  '.resource-management form',
  '.resource-management > div',
  '.rotation-handle span',
  '.resize-handle span',
  '.bubble-tail-handle span',
].join(',');

/** Visual depth follows each surface's border-box width without changing editor state. */
export function useSurfaceScale() {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.studio-shell');
    if (!shell || typeof ResizeObserver === 'undefined') return;

    const observed = new Set<HTMLElement>();
    const widths = new Map<HTMLElement, string>();
    const measure = (element: HTMLElement, measuredWidth: number) => {
      if (!shell.contains(element) || !element.getClientRects().length || element.hidden) return;
      const style = getComputedStyle(element);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      )
        return;
      const width = Math.round(measuredWidth);
      if (!Number.isFinite(width) || width <= 0) return;
      const value = `${width}px`;
      if (widths.get(element) === value) return;
      widths.set(element, value);
      element.style.setProperty('--surface-width', value);
    };
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        // borderBoxSize excludes CSS transforms, including the rotated tail-tip cap.
        measure(element, entry.borderBoxSize[0]?.inlineSize ?? element.offsetWidth);
      }
    });
    const observe = (element: HTMLElement) => {
      if (observed.has(element)) return;
      observed.add(element);
      resize.observe(element, { box: 'border-box' });
      measure(element, element.offsetWidth);
    };
    const collect = (node: Node) => {
      if (!(node instanceof Element)) return;
      if (node instanceof HTMLElement && node.matches(surfaces)) observe(node);
      node.querySelectorAll<HTMLElement>(surfaces).forEach(observe);
    };
    collect(shell);

    const mutations = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach(collect);
      for (const element of observed) {
        if (shell.contains(element)) continue;
        resize.unobserve(element);
        observed.delete(element);
        widths.delete(element);
        element.style.removeProperty('--surface-width');
      }
    });
    // Width variables only affect visual CSS. Do not observe style attributes and feed back.
    mutations.observe(shell, { childList: true, subtree: true });
    return () => {
      mutations.disconnect();
      resize.disconnect();
      for (const element of observed) element.style.removeProperty('--surface-width');
      observed.clear();
      widths.clear();
    };
  }, []);
}
