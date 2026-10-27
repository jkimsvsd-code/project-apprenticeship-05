import { useEffect, useEffectEvent, useMemo, useRef, type ReactNode } from 'react';
import { UiIcon, type UiIconName } from './UiIcon';

export interface ToolPage {
  id: string;
  category: string;
  label: string;
  icon: UiIconName;
  content: ReactNode;
}

interface Props {
  pages: ToolPage[];
  activePage: string;
  onPageChange: (id: string) => void;
  disabled?: boolean;
  label?: string;
  compact?: boolean;
  mode?: 'pages' | 'stacked';
}

export function ToolDeck(props: Props) {
  return props.mode === 'stacked' ? <StackedToolDeck {...props} /> : <PagedToolDeck {...props} />;
}

function StackedToolDeck({
  pages,
  activePage,
  onPageChange,
  disabled = false,
  label = '카드 편집 도구',
  compact = false,
}: Props) {
  const bookmarks = useRef<HTMLDivElement>(null);
  const currentIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === activePage),
  );
  const current = pages[currentIndex];
  const categories = pages.filter(
    (page, index) => pages.findIndex((item) => item.category === page.category) === index,
  );
  const activeCategory = current?.category;
  useEffect(() => {
    const bar = bookmarks.current;
    const selected = bar?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!bar || !selected) return;
    if (selected.offsetLeft < bar.scrollLeft + 8)
      bar.scrollLeft = Math.max(0, selected.offsetLeft - 8);
    else if (selected.offsetLeft + selected.offsetWidth > bar.scrollLeft + bar.clientWidth - 8)
      bar.scrollLeft = selected.offsetLeft + selected.offsetWidth - bar.clientWidth + 8;
  }, [activeCategory]);
  if (!current) return null;
  const siblings = pages.filter((page) => page.category === current.category);
  return (
    <section
      className={`tool-deck tool-deck-stacked${compact ? ' tool-deck-compact' : ''}`}
      aria-label={label}
      data-navigation-locked={disabled}
    >
      <div ref={bookmarks} className="tool-bookmarks" role="tablist" aria-label={`${label} 분류`}>
        {categories.map((category, index) => (
          <button
            key={category.category}
            id={`tool-bookmark-${category.id}`}
            type="button"
            role="tab"
            disabled={disabled}
            aria-selected={current.category === category.category}
            aria-controls={pages
              .filter((page) => page.category === category.category)
              .map((page) => `tool-page-${page.id}`)
              .join(' ')}
            tabIndex={current.category === category.category ? 0 : -1}
            onClick={() => onPageChange(category.id)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? categories.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) %
                      categories.length;
              const target = categories[next];
              if (!target) return;
              bookmarks.current
                ?.querySelector<HTMLButtonElement>(`#tool-bookmark-${target.id}`)
                ?.focus();
              onPageChange(target.id);
            }}
          >
            <span className="tool-bookmark-icon">
              <UiIcon name={category.icon} size={22} />
            </span>
            <span>{category.category}</span>
          </button>
        ))}
      </div>
      {siblings.length > 1 && (
        <div className="tool-subpages" role="group" aria-label={`${current.category} 세부 도구`}>
          {siblings.map((page) => (
            <button
              key={page.id}
              type="button"
              data-tool-subpage={page.id}
              aria-pressed={page.id === current.id}
              disabled={disabled}
              onClick={() => onPageChange(page.id)}
            >
              {page.label}
            </button>
          ))}
        </div>
      )}
      <div className="tool-pages">
        {pages.map((page) => (
          <section
            key={page.id}
            className="tool-page"
            id={`tool-page-${page.id}`}
            data-tool-page={page.id}
            role="tabpanel"
            aria-label={page.label}
            hidden={page.id !== current.id}
            aria-hidden={page.id !== current.id}
            inert={page.id !== current.id}
          >
            {page.content}
          </section>
        ))}
      </div>
    </section>
  );
}

function PagedToolDeck({
  pages,
  activePage,
  onPageChange,
  disabled = false,
  label = '카드 편집 도구',
  compact = false,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const bookmarks = useRef<HTMLDivElement>(null);
  const requested = useRef<string | null>(null);
  const reported = useRef<string | null>(null);
  const userScrolling = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const pageKey = pages.map((page) => page.id).join('|');
  const currentIndex = Math.max(
    0,
    pages.findIndex((page) => page.id === activePage),
  );
  const current = pages[currentIndex];
  const activeId = current?.id ?? '';
  const categories = useMemo(
    () =>
      pages.filter(
        (page, index) => pages.findIndex((item) => item.category === page.category) === index,
      ),
    [pages],
  );

  const alignPage = useEffectEvent(() => {
    const frame = viewport.current;
    if (!frame) return;
    const panel = [...frame.querySelectorAll<HTMLElement>('[data-tool-page]')].find(
      (item) => item.dataset.toolPage === activeId,
    );
    if (panel) {
      requested.current = activeId;
      frame.scrollTo({ left: panel.offsetLeft, behavior: 'instant' });
    }
  });

  const observePage = useEffectEvent(() => {
    const frame = viewport.current;
    if (!frame || disabled) return;
    const panels = [...frame.querySelectorAll<HTMLElement>('[data-tool-page]')];
    const nearest = panels.reduce<HTMLElement | undefined>(
      (best, panel) =>
        !best ||
        Math.abs(panel.offsetLeft - frame.scrollLeft) < Math.abs(best.offsetLeft - frame.scrollLeft)
          ? panel
          : best,
      undefined,
    );
    const id = nearest?.dataset.toolPage;
    if (!id || (requested.current && requested.current !== id)) return;
    requested.current = null;
    if (!userScrolling.current) {
      if (id !== activeId || Math.abs(nearest!.offsetLeft - frame.scrollLeft) > 1) alignPage();
      return;
    }
    if (id !== activeId) {
      reported.current = id;
      onPageChange(id);
    }
  });

  function settleScroll() {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      userScrolling.current = false;
    }, 150);
  }

  useEffect(() => {
    const frame = viewport.current;
    if (!frame) return;
    const observer = new IntersectionObserver(() => observePage(), {
      root: frame,
      threshold: [0.55, 0.85],
    });
    frame.querySelectorAll('[data-tool-page]').forEach((panel) => observer.observe(panel));
    return () => {
      observer.disconnect();
      window.clearTimeout(settleTimer.current);
    };
  }, [pageKey]);

  useEffect(() => {
    const frame = viewport.current;
    if (!frame) return;
    const panel = [...frame.querySelectorAll<HTMLElement>('[data-tool-page]')].find(
      (item) => item.dataset.toolPage === activeId,
    );
    if (panel && reported.current !== activeId) {
      requested.current = activeId;
      frame.scrollTo({ left: panel.offsetLeft, behavior: 'instant' });
    }
    reported.current = null;
    const selectedBookmark =
      bookmarks.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selectedBookmark && bookmarks.current) {
      const bar = bookmarks.current;
      const left = selectedBookmark.offsetLeft;
      const right = left + selectedBookmark.offsetWidth;
      if (left < bar.scrollLeft + 8)
        bar.scrollTo({ left: Math.max(0, left - 8), behavior: 'instant' });
      else if (right > bar.scrollLeft + bar.clientWidth - 8)
        bar.scrollTo({ left: right - bar.clientWidth + 8, behavior: 'instant' });
    }
  }, [activeId, pageKey]);

  useEffect(() => {
    const frame = viewport.current;
    if (!frame) return;
    const observer = new ResizeObserver(() => alignPage());
    observer.observe(frame);
    return () => observer.disconnect();
  }, [pageKey]);

  if (!current) return null;
  return (
    <section
      className={`tool-deck${compact ? ' tool-deck-compact' : ''}`}
      aria-label={label}
      data-navigation-locked={disabled}
    >
      <div
        ref={bookmarks}
        className="tool-bookmarks"
        role="tablist"
        aria-label={label === '카드 편집 도구' ? '편집 도구' : `${label} 분류`}
      >
        {categories.map((category, index) => (
          <button
            key={category.category}
            id={`tool-bookmark-${category.id}`}
            type="button"
            role="tab"
            disabled={disabled}
            aria-selected={current.category === category.category}
            aria-controls={pages
              .filter((page) => page.category === category.category)
              .map((page) => `tool-page-${page.id}`)
              .join(' ')}
            tabIndex={current.category === category.category ? 0 : -1}
            onClick={() => {
              reported.current = null;
              onPageChange(category.id);
            }}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? categories.length - 1
                    : (index + (event.key === 'ArrowRight' ? 1 : -1) + categories.length) %
                      categories.length;
              const target = categories[next];
              if (!target) return;
              bookmarks.current
                ?.querySelector<HTMLButtonElement>(`#tool-bookmark-${target.id}`)
                ?.focus();
              reported.current = null;
              onPageChange(target.id);
            }}
          >
            <span className="tool-bookmark-icon">
              <UiIcon name={category.icon} size={25} />
            </span>
            <span>{category.category}</span>
          </button>
        ))}
      </div>
      <div className="tool-pagebar">
        <button
          type="button"
          aria-label="이전 도구 페이지"
          disabled={disabled || currentIndex === 0}
          onClick={() => {
            const page = pages[currentIndex - 1];
            if (page) onPageChange(page.id);
          }}
        >
          <UiIcon name="chevron-left" size={17} />
        </button>
        <span aria-live="polite">
          {current.label}{' '}
          <span className="tool-page-count">
            {currentIndex + 1} / {pages.length}
          </span>
        </span>
        <button
          type="button"
          aria-label="다음 도구 페이지"
          disabled={disabled || currentIndex === pages.length - 1}
          onClick={() => {
            const page = pages[currentIndex + 1];
            if (page) onPageChange(page.id);
          }}
        >
          <UiIcon name="chevron-right" size={17} />
        </button>
      </div>
      <div
        ref={viewport}
        className="tool-pages"
        onPointerDown={(event) => {
          pointerStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const start = pointerStart.current;
          if (!start) return;
          const dx = Math.abs(event.clientX - start.x);
          const dy = Math.abs(event.clientY - start.y);
          if (dx <= 8 || dx <= dy) return;
          userScrolling.current = true;
          requested.current = null;
          settleScroll();
        }}
        onPointerUp={() => {
          pointerStart.current = null;
          settleScroll();
        }}
        onPointerCancel={() => {
          if (pointerStart.current) {
            userScrolling.current = true;
            requested.current = null;
            settleScroll();
          }
          pointerStart.current = null;
        }}
        onWheel={() => {
          userScrolling.current = true;
          requested.current = null;
          settleScroll();
        }}
        onScroll={settleScroll}
        onScrollEnd={() => {
          userScrolling.current = false;
        }}
      >
        {pages.map((page, index) => {
          return (
            <section
              key={page.id}
              className="tool-page"
              id={`tool-page-${page.id}`}
              data-tool-page={page.id}
              role="tabpanel"
              aria-label={page.label}
              aria-hidden={index !== currentIndex}
              inert={index !== currentIndex}
            >
              {page.content}
            </section>
          );
        })}
      </div>
    </section>
  );
}
