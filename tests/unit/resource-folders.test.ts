import { describe, expect, it } from 'vitest';
import type { CachedResourceMetadata } from '@jjal/persistence/browser';
import {
  BUILTIN_FOLDER,
  RESOURCE_FOLDERS_KEY,
  UNCLASSIFIED_FOLDER,
  createResourceFolderStore,
  parseResourceFolders,
  resourcesInFolder,
} from '../../apps/demo/src/composition/resource-folders';

const id = `resource-${'a'.repeat(64)}`;
const resource = { id, origin: 'user' } as CachedResourceMetadata;
function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe('자원 폴더 분류 보존', () => {
  it('새 폴더와 이름 변경·분류를 새 저장소 인스턴스에서도 그대로 읽는다', () => {
    const storage = memory();
    const store = createResourceFolderStore(storage);
    store.add('여행', 'folder-travel');
    store.rename('folder-travel', '여름 여행');
    store.assign([id], 'folder-travel');
    const restored = createResourceFolderStore(storage).read();
    expect(restored.folders).toEqual([{ id: 'folder-travel', name: '여름 여행' }]);
    expect(resourcesInFolder([resource], restored, 'folder-travel')).toEqual([resource]);
    expect(resourcesInFolder([resource], restored, UNCLASSIFIED_FOLDER)).toEqual([]);
  });

  it('같은 해시를 다른 폴더로 다시 불러와도 기존 연결을 보존하고 중복 연결을 만들지 않는다', () => {
    const store = createResourceFolderStore(memory());
    store.add('첫 폴더', 'folder-one');
    store.add('둘째 폴더', 'folder-two');
    store.assign([id], 'folder-one');
    store.assign([id, id], 'folder-two');
    expect(store.read().memberships[id]).toEqual(['folder-one', 'folder-two']);
    expect(resourcesInFolder([resource], store.read(), 'folder-one')).toHaveLength(1);
    expect(resourcesInFolder([resource], store.read(), 'folder-two')).toHaveLength(1);
  });

  it('10,001개 자원도 분류·새로 읽기·다른 폴더에 연속 추가할 수 있고 잘못된 추가는 기존 분류를 보존한다', () => {
    const storage = memory();
    const store = createResourceFolderStore(storage);
    store.add('첫 폴더', 'folder-one');
    store.add('둘째 폴더', 'folder-two');
    const ids = Array.from(
      { length: 10_001 },
      (_, index) => `resource-${index.toString(16).padStart(64, '0')}`,
    );
    store.assign(ids, 'folder-one');
    const restored = createResourceFolderStore(storage);
    expect(Object.keys(restored.read().memberships)).toHaveLength(10_001);
    restored.assign(ids, 'folder-two');
    expect(restored.read().memberships[ids[10_000]!]).toEqual(['folder-one', 'folder-two']);
    const before = storage.getItem(RESOURCE_FOLDERS_KEY);
    expect(() => restored.assign([ids[0]!, 'invalid-id'], 'folder-two')).toThrow();
    expect(storage.getItem(RESOURCE_FOLDERS_KEY)).toBe(before);
  });

  it('분류 이동은 선택한 폴더 연결만 바꾸고 미분류 이동은 모든 사용자 분류를 해제한다', () => {
    const store = createResourceFolderStore(memory());
    for (const name of ['one', 'two', 'three']) store.add(name, `folder-${name}`);
    store.assign([id], 'folder-one');
    store.assign([id], 'folder-two');
    store.assign([id], 'folder-three', 'folder-one');
    expect(store.read().memberships[id]).toEqual(['folder-two', 'folder-three']);
    store.assign([id], UNCLASSIFIED_FOLDER);
    expect(resourcesInFolder([resource], store.read(), UNCLASSIFIED_FOLDER)).toEqual([resource]);
  });

  it('기본 자원은 사용자 폴더에 분류해도 기본 탭에서 계속 보인다', () => {
    const store = createResourceFolderStore(memory());
    store.add('자주 쓰는 소재', 'folder-favorite');
    store.assign([id], 'folder-favorite');
    const builtin = { ...resource, origin: 'builtin' as const };
    expect(resourcesInFolder([builtin], store.read(), BUILTIN_FOLDER)).toEqual([builtin]);
    expect(resourcesInFolder([builtin], store.read(), 'folder-favorite')).toEqual([builtin]);
    expect(resourcesInFolder([builtin], store.read(), UNCLASSIFIED_FOLDER)).toEqual([]);
  });

  it('읽은 뒤 다른 탭에서 추가한 분류도 다음 변경에서 덮어쓰지 않는다', () => {
    const storage = memory();
    const first = createResourceFolderStore(storage);
    const second = createResourceFolderStore(storage);
    first.read();
    second.add('다른 탭', 'folder-other');
    first.add('현재 탭', 'folder-current');
    expect(first.read().folders.map((folder) => folder.id)).toEqual([
      'folder-other',
      'folder-current',
    ]);
  });

  it.each(['', ' ', '기본', '미분류', '가'.repeat(31), '금지\u0000문자'])(
    '잘못된 이름 %j에도 기존 분류를 보존한다',
    (name) => {
      const storage = memory();
      const store = createResourceFolderStore(storage);
      store.add('보존', 'folder-safe');
      const before = storage.getItem(RESOURCE_FOLDERS_KEY);
      expect(() => store.add(name, 'folder-invalid')).toThrow();
      expect(storage.getItem(RESOURCE_FOLDERS_KEY)).toBe(before);
    },
  );

  it('손상된 JSON·미등록 폴더·잘못된 자원 ID는 기존 저장값을 덮어쓰지 않는다', () => {
    const storage = memory();
    const store = createResourceFolderStore(storage);
    storage.setItem(RESOURCE_FOLDERS_KEY, '{broken');
    expect(() => store.add('다른 폴더', 'folder-next')).toThrow('기존 정보는 유지');
    expect(storage.getItem(RESOURCE_FOLDERS_KEY)).toBe('{broken');
    expect(() =>
      parseResourceFolders({ version: 1, folders: [], memberships: { [id]: ['folder-missing'] } }),
    ).toThrow();
    expect(() =>
      parseResourceFolders({ version: 1, folders: [], memberships: { bad: ['folder-missing'] } }),
    ).toThrow();
  });

  it('저장 공간 오류가 발생하면 호출자에게 실패를 알리고 기존 분류를 보존한다', () => {
    const storage = memory();
    createResourceFolderStore(storage).add('기존', 'folder-safe');
    const before = storage.getItem(RESOURCE_FOLDERS_KEY);
    const store = createResourceFolderStore({
      getItem: storage.getItem,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => store.rename('folder-safe', '바뀐 이름')).toThrow('기존 분류는 유지');
    expect(storage.getItem(RESOURCE_FOLDERS_KEY)).toBe(before);
  });
});
