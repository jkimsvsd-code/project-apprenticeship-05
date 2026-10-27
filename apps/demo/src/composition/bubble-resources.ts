import type { StudioElement } from '@jjal/document-model';

export type BubbleResourceShape = Extract<StudioElement, { kind: 'bubble' }>['shape'];
// Persisted user folder IDs must start with "folder-", so this tab cannot replace one.
export const BUBBLE_FOLDER = 'builtin-bubbles';
export const BUBBLE_RESOURCES = [
  { shape: 'speech', name: '대화', addLabel: '대화 말풍선 추가' },
  { shape: 'thought', name: '생각', addLabel: '생각 말풍선 추가' },
  { shape: 'shout', name: '외침', addLabel: '외침 말풍선 추가' },
  { shape: 'caption', name: '설명 상자', addLabel: '설명 상자 추가' },
] as const satisfies readonly { shape: BubbleResourceShape; name: string; addLabel: string }[];

const shapeById = new Map<string, BubbleResourceShape>(
  BUBBLE_RESOURCES.map(({ shape }) => [`builtin-bubble:${shape}`, shape]),
);

/** These IDs belong only to the UI drag boundary, never to the image Blob repository. */
export function bubbleResourceShape(input: unknown): BubbleResourceShape | null {
  return typeof input === 'string' ? (shapeById.get(input) ?? null) : null;
}

export function bubbleResourceId(shape: BubbleResourceShape): string {
  const id = `builtin-bubble:${shape}`;
  if (bubbleResourceShape(id) === null) throw new Error('지원하지 않는 말풍선 모양입니다.');
  return id;
}

export function customBubbleSourceId(input: unknown): string | null {
  return typeof input === 'string' && /^custom-bubble:[0-9a-f]{64}$/.test(input)
    ? `resource-${input.slice('custom-bubble:'.length)}`
    : null;
}
export function customBubbleResourceId(resourceId: string): string {
  if (!/^resource-[0-9a-f]{64}$/.test(resourceId))
    throw new Error('말풍선 자원 ID가 올바르지 않습니다.');
  return `custom-bubble:${resourceId.slice('resource-'.length)}`;
}
