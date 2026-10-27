import type { ReactNode } from 'react';

export type UiIconName =
  | 'image'
  | 'background'
  | 'frame'
  | 'text'
  | 'layers'
  | 'style'
  | 'grid'
  | 'undo'
  | 'redo'
  | 'download'
  | 'upload'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'save'
  | 'plus'
  | 'trash'
  | 'copy'
  | 'lock'
  | 'eye'
  | 'bubble'
  | 'check'
  | 'close'
  | 'folder';

const shapes: Record<UiIconName, ReactNode> = {
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
    </>
  ),
  background: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 15h18M3 18h18M7 4l-4 4M12 4l-9 9M17 4 6 15M21 5 11 15M21 10l-5 5" />
    </>
  ),
  frame: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M7 3v4H3M17 3v4h4M3 17h4v4M21 17h-4v4" />
    </>
  ),
  text: (
    <>
      <path d="M4 6V4h16v2M12 4v16M8 20h8" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  style: (
    <>
      <path d="m13 3 8 8-9 9H4v-8l9-9ZM9 7l8 8M4 20l4-4" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  undo: (
    <>
      <path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12" />
    </>
  ),
  redo: (
    <>
      <path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
    </>
  ),
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-down': <path d="m5 9 7 7 7-7" />,
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M7 3v6h9V3M7 21v-7h10v7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  bubble: <path d="M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  folder: (
    <>
      <path d="M11 5h7a3 3 0 0 1 3 3" strokeWidth="2.2" />
      <path
        d="M5 3h4a2 2 0 0 1 1.9 1.4L12 8h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
        strokeWidth="2.2"
      />
    </>
  ),
};

export function UiIcon({
  name,
  size = 20,
  className,
}: {
  name: UiIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `ui-icon ${className}` : 'ui-icon'}
    >
      {shapes[name]}
    </svg>
  );
}
