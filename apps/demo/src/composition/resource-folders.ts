import { parseResourceId, type CachedResourceMetadata } from '@jjal/persistence/browser';

export const RESOURCE_FOLDERS_KEY = 'jjal-resource-folders-v1';
export const UNCLASSIFIED_FOLDER = 'unclassified';
export const BUILTIN_FOLDER = 'builtin';
export interface ResourceFolder {
  id: string;
  name: string;
}
export interface ResourceFolders {
  version: 1;
  folders: ResourceFolder[];
  memberships: Record<string, string[]>;
}
type StoragePort = Pick<Storage, 'getItem' | 'setItem'>;
const empty = (): ResourceFolders => ({ version: 1, folders: [], memberships: {} });
const invalid = () =>
  new Error('저장된 자원 폴더 정보가 올바르지 않습니다. 기존 정보는 유지됩니다.');

function folderName(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > 30 ||
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  )
    throw new Error('폴더 이름은 1~30자의 표시 가능한 문자로 입력해 주세요.');
  return value.trim();
}

export function parseResourceFolders(input: unknown): ResourceFolders {
  if (!input || typeof input !== 'object') throw invalid();
  const value = input as Record<string, unknown>;
  if (
    value.version !== 1 ||
    !Array.isArray(value.folders) ||
    value.folders.length > 40 ||
    !value.memberships ||
    typeof value.memberships !== 'object' ||
    Array.isArray(value.memberships)
  )
    throw invalid();
  const ids = new Set<string>();
  const names = new Set(['미분류', '기본']);
  const folders = value.folders.map((input: unknown) => {
    if (!input || typeof input !== 'object') throw invalid();
    const folder = input as Record<string, unknown>;
    const name = folderName(folder.name);
    if (
      typeof folder.id !== 'string' ||
      !/^folder-[a-zA-Z0-9-]{1,80}$/.test(folder.id) ||
      ids.has(folder.id) ||
      names.has(name)
    )
      throw invalid();
    ids.add(folder.id);
    names.add(name);
    return { id: folder.id, name };
  });
  const entries = Object.entries(value.memberships);
  const memberships: Record<string, string[]> = {};
  for (const [resourceId, targets] of entries) {
    parseResourceId(resourceId);
    if (
      !Array.isArray(targets) ||
      !targets.length ||
      targets.length > 40 ||
      targets.some((id: unknown) => typeof id !== 'string' || !ids.has(id)) ||
      new Set(targets).size !== targets.length
    )
      throw invalid();
    memberships[resourceId] = [...targets] as string[];
  }
  return { version: 1, folders, memberships };
}

export function createResourceFolderStore(storage: StoragePort) {
  const read = () => {
    const raw = storage.getItem(RESOURCE_FOLDERS_KEY);
    if (raw === null) return empty();
    try {
      return parseResourceFolders(JSON.parse(raw));
    } catch (cause) {
      throw new Error('저장된 자원 폴더를 읽지 못했습니다. 기존 정보는 유지됩니다.', { cause });
    }
  };
  const update = (operation: (current: ResourceFolders) => ResourceFolders) => {
    const next = parseResourceFolders(operation(read()));
    try {
      // A single setItem commits the complete validated metadata, including all memberships.
      storage.setItem(RESOURCE_FOLDERS_KEY, JSON.stringify(next));
    } catch (cause) {
      throw new Error('자원 폴더를 저장하지 못했습니다. 기존 분류는 유지됩니다.', { cause });
    }
    return next;
  };
  return {
    read,
    add(name: string, id = `folder-${crypto.randomUUID()}`) {
      return update((state) => ({
        ...state,
        folders: [...state.folders, { id, name: folderName(name) }],
      }));
    },
    rename(id: string, name: string) {
      return update((state) => {
        if (!state.folders.some((folder) => folder.id === id)) throw new Error('폴더가 없습니다.');
        return {
          ...state,
          folders: state.folders.map((folder) =>
            folder.id === id ? { ...folder, name: folderName(name) } : folder,
          ),
        };
      });
    },
    assign(resourceIds: readonly string[], targetId: string, sourceId?: string) {
      return update((state) => {
        if (
          targetId !== UNCLASSIFIED_FOLDER &&
          !state.folders.some((folder) => folder.id === targetId)
        )
          throw new Error('분류할 폴더가 없습니다.');
        const memberships = { ...state.memberships };
        for (const input of resourceIds) {
          const id = parseResourceId(input);
          if (targetId === UNCLASSIFIED_FOLDER) delete memberships[id];
          else {
            const previous = (memberships[id] ?? []).filter((folder) => folder !== sourceId);
            memberships[id] = [...new Set([...previous, targetId])];
          }
        }
        return { ...state, memberships };
      });
    },
  };
}

export function resourcesInFolder<T extends CachedResourceMetadata>(
  resources: readonly T[],
  state: ResourceFolders,
  folderId: string,
): T[] {
  return resources.filter((resource) =>
    folderId === BUILTIN_FOLDER
      ? resource.origin === 'builtin'
      : folderId === UNCLASSIFIED_FOLDER
        ? resource.origin === 'user' && !state.memberships[resource.id]?.length
        : state.memberships[resource.id]?.includes(folderId),
  );
}
