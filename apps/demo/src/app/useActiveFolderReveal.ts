import { useCallback, useEffect, useState } from 'react';

/** Reveal only the active folder inside its horizontal strip, without moving focus or the page. */
export function useActiveFolderReveal(activeId: string, tabKey: string, enabled: boolean) {
  const [tablist, setTablist] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => setTablist(node), []);

  useEffect(() => {
    if (!enabled || !tablist) return;
    const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const active = tabs.find((tab) => tab.id === `resource-folder-${activeId}`);
    if (!active) return;
    let frame: number | undefined;
    let disposed = false;

    const reveal = () => {
      frame = undefined;
      if (
        disposed ||
        !tablist.isConnected ||
        !active.isConnected ||
        !tablist.contains(active) ||
        !tablist.getClientRects().length ||
        !tablist.clientWidth ||
        !tablist.offsetWidth
      )
        return;

      const box = tablist.getBoundingClientRect();
      const style = getComputedStyle(tablist);
      const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
      const paddingRight = Number.parseFloat(style.paddingRight) || 0;
      const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
      const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
      const declaredWidth = Number.parseFloat(style.width);
      const borderBoxWidth =
        style.boxSizing === 'border-box'
          ? declaredWidth
          : declaredWidth + paddingLeft + paddingRight + borderLeft + borderRight;
      // Computed width keeps fractional CSS pixels that integer offsetWidth/clientWidth round off.
      const unscaledWidth = borderBoxWidth || tablist.offsetWidth;
      const scale = box.width / unscaledWidth;
      if (!Number.isFinite(scale) || scale <= 0) return;
      const viewportWidth = Math.min(tablist.clientWidth, unscaledWidth - borderLeft - borderRight);
      const selected = active.getBoundingClientRect();
      const padding = paddingLeft + paddingRight;
      const paddingScale =
        padding > 0
          ? Math.min(1, Math.max(0, viewportWidth - selected.width / scale) / padding)
          : 0;
      const left = box.left + (borderLeft + paddingLeft * paddingScale) * scale;
      const right = box.left + (borderLeft + viewportWidth - paddingRight * paddingScale) * scale;
      if (right <= left) return;
      const start = (selected.left - left) / scale;
      const end = (selected.right - right) / scale;
      const oversized = selected.width > right - left;
      // A tab wider than the viewport already spanning both edges cannot be made fully visible.
      if (start < -0.5 && end > 0.5) return;
      let delta = 0;
      if (start < -0.5) delta = oversized ? end : start;
      else if (end > 0.5) delta = oversized ? start : end;
      if (Math.abs(delta) <= 0.5) return;
      const maximum = Math.max(0, tablist.scrollWidth - tablist.clientWidth);
      const next = Math.max(0, Math.min(maximum, tablist.scrollLeft + delta));
      if (Math.abs(next - tablist.scrollLeft) > 0.5)
        tablist.scrollTo({ left: next, behavior: 'instant' });
    };
    const schedule = () => {
      if (!disposed && frame === undefined) frame = requestAnimationFrame(reveal);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(tablist);
    // An earlier tab changing width also changes the selected tab's position.
    tabs.forEach((tab) => observer?.observe(tab));
    const onSelect = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[role="tab"]') === active)
        schedule();
    };
    tablist.addEventListener('click', onSelect);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      disposed = true;
      observer?.disconnect();
      tablist.removeEventListener('click', onSelect);
      window.removeEventListener('resize', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [activeId, tabKey, enabled, tablist]);

  return attach;
}
