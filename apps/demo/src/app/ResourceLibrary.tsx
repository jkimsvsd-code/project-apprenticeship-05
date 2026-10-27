import { useEffect, useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { UiIcon } from './UiIcon';
import { BubbleImportPreview } from './BubbleImportPreview';
import { THOUGHT_CLOUD_SVG_PATH } from '@jjal/renderer';
import { useActiveFolderReveal } from './useActiveFolderReveal';
import {
  cacheBuiltinResources,
  cacheResourceFiles,
  cacheBubbleCandidates,
  refreshBuiltinResources,
  listLibraryResources,
  resourceRepository,
  RESOURCE_DRAG_MIME,
  subscribeResources,
  type CachedResourceMetadata,
} from '../composition/resources';
import {
  BUILTIN_FOLDER,
  UNCLASSIFIED_FOLDER,
  RESOURCE_FOLDERS_KEY,
  createResourceFolderStore,
  resourcesInFolder,
  type ResourceFolders,
} from '../composition/resource-folders';
import {
  BUBBLE_FOLDER,
  BUBBLE_RESOURCES,
  bubbleResourceId,
  customBubbleResourceId,
  type BubbleResourceShape,
} from '../composition/bubble-resources';
import {
  prepareBubbleFiles,
  customBubbleFromCandidate,
  type BubbleImportCandidate,
  type TailSide,
} from '../composition/png-bubble-import';

interface Props {
  disabled?: boolean;
  readOnly?: boolean;
  toolbar?: ReactNode;
  onRequestEdit?: () => void;
  onPlace: (resourceId: string) => void;
  onAddBubble: (shape: BubbleResourceShape) => void;
  onResourcePointerDown?: (resourceId: string, event: PointerEvent<HTMLButtonElement>) => void;
}
type Thumbnail = CachedResourceMetadata & { url: string };
const emptyFolders = (): ResourceFolders => ({ version: 1, folders: [], memberships: {} });
const categoryLabels = { image: '이미지', character: '캐릭터', background: '배경' };

function BubbleResourcePreview({ shape }: { shape: BubbleResourceShape }) {
  return (
    <svg
      className="resource-bubble-preview"
      viewBox="0 0 64 52"
      width="72"
      height="58"
      fill="#F8F9FA"
      stroke="#0B0F2B"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape === 'speech' ? (
        <path d="M12 5H52Q58 5 58 11V33Q58 39 52 39H31L19 47L22 39H12Q6 39 6 33V11Q6 5 12 5Z" />
      ) : shape === 'thought' ? (
        <>
          <path d={THOUGHT_CLOUD_SVG_PATH} />
          <circle cx="17" cy="43" r="3" />
          <circle cx="10" cy="49" r="1.5" />
        </>
      ) : shape === 'shout' ? (
        <path d="M32 2L38 9L49 3L48 13L61 14L54 23L62 31L49 33L50 44L39 40L32 50L25 40L13 45L14 34L2 32L9 23L3 14L17 14L16 4L27 10Z" />
      ) : (
        <rect x="6" y="7" width="52" height="36" rx="3" />
      )}
    </svg>
  );
}

function ResourceFolderTabSurface() {
  const surfaceId = useId();
  return (
    <svg
      className="resource-tab-surface"
      viewBox="0 0 120 52"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={surfaceId} x1="0" y1="0" x2="0" y2="1">
          <stop stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#EDF3FA" />
        </linearGradient>
      </defs>
      <path
        className="resource-tab-back"
        d="M43 12H101Q114 12 114 24"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="resource-tab-front"
        d="M12 4H37Q43 4 46 10L50 17H108Q117 17 117 26V41Q117 49 108 49H12Q3 49 3 40V13Q3 4 12 4Z"
        fill={`url(#${surfaceId})`}
        vectorEffect="non-scaling-stroke"
      />
      <path
        className="resource-tab-highlight"
        d="M12 7H37Q41 7 43 12L47 20H107Q113 20 113 26"
        fill="none"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function ResourceLibrary({
  disabled = false,
  readOnly = false,
  toolbar,
  onRequestEdit,
  onPlace,
  onAddBubble,
  onResourcePointerDown,
}: Props) {
  const [resources, setResources] = useState<Thumbnail[]>([]);
  const [folders, setFolders] = useState<ResourceFolders>(emptyFolders);
  const [activeFolder, setActiveFolder] = useState(UNCLASSIFIED_FOLDER);
  const [newFolderName, setNewFolderName] = useState('');
  const [rename, setRename] = useState('');
  const [manageOpen, setManageOpen] = useState(false);
  const [classifyId, setClassifyId] = useState('');
  const [classifyTarget, setClassifyTarget] = useState(UNCLASSIFIED_FOLDER);
  const [error, setError] = useState('');
  const [folderError, setFolderError] = useState('');
  const [busy, setBusy] = useState(true);
  const [importing, setImporting] = useState(false);
  const [bubbleCandidates, setBubbleCandidates] = useState<BubbleImportCandidate[] | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const bubbleDialog = useRef<HTMLDialogElement>(null);
  const bubbleUrls = useRef<string[]>([]);
  const hasBubbleCandidates = Boolean(bubbleCandidates?.length);
  useEffect(() => {
    if (!hasBubbleCandidates) return;
    const node = bubbleDialog.current;
    node?.showModal();
    return () => {
      node?.close();
      for (const url of bubbleUrls.current) URL.revokeObjectURL(url);
      bubbleUrls.current = [];
    };
  }, [hasBubbleCandidates]);
  const input = useRef<HTMLInputElement>(null);
  const folderNameInput = useRef<HTMLInputElement>(null);
  const operation = useRef(0);
  const mounted = useRef(true);
  const blocked = useRef(disabled || readOnly);

  useEffect(() => {
    blocked.current = disabled || readOnly;
    if (blocked.current) operation.current++;
  }, [disabled, readOnly]);

  useEffect(() => {
    mounted.current = true;
    operation.current++;
    const refreshFolders = () => {
      try {
        setFolders(createResourceFolderStore(localStorage).read());
        setFolderError('');
      } catch (cause) {
        setFolderError(cause instanceof Error ? cause.message : '자원 폴더를 읽지 못했습니다.');
      }
    };
    refreshFolders();
    const onStorage = (event: StorageEvent) => {
      if (event.key === RESOURCE_FOLDERS_KEY || event.key === null) refreshFolders();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      mounted.current = false;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let generation = 0;
    let activeUrls: string[] = [];
    const release = (urls: string[]) => urls.forEach((url) => URL.revokeObjectURL(url));
    const refresh = async () => {
      const current = ++generation;
      const urls: string[] = [];
      try {
        const metadata = await listLibraryResources();
        const next: Thumbnail[] = [];
        for (const resource of metadata) {
          if (!alive || current !== generation) return;
          const stored = await resourceRepository.read(resource.id);
          const url = URL.createObjectURL(stored.blob);
          urls.push(url);
          next.push({ ...resource, url });
        }
        if (alive && current === generation) {
          release(activeUrls);
          activeUrls = urls.splice(0);
          setResources(next);
          setBusy(false);
        }
      } catch (cause) {
        if (alive && current === generation) {
          setError(cause instanceof Error ? cause.message : '자원을 불러오지 못했습니다.');
          setBusy(false);
        }
      } finally {
        release(urls);
      }
    };
    const unsubscribe = subscribeResources(() => void refresh());
    void refresh();
    void cacheBuiltinResources().catch((cause: unknown) => {
      if (alive)
        setError(cause instanceof Error ? cause.message : '기본 소재를 저장하지 못했습니다.');
    });
    return () => {
      alive = false;
      generation++;
      unsubscribe();
      release(activeUrls);
      activeUrls = [];
    };
  }, []);

  const folderTabs = [
    { id: UNCLASSIFIED_FOLDER, name: '미분류' },
    { id: BUILTIN_FOLDER, name: '기본' },
    { id: BUBBLE_FOLDER, name: '말풍선' },
    ...folders.folders,
  ];
  const current = folderTabs.find((folder) => folder.id === activeFolder) ?? folderTabs[0]!;
  const folderTabsRef = useActiveFolderReveal(current.id, JSON.stringify(folderTabs), !readOnly);
  const isBubbleFolder = current.id === BUBBLE_FOLDER;
  const group = isBubbleFolder
    ? resources.filter((resource) => resource.customBubble)
    : resourcesInFolder(resources, folders, current.id);
  const customFolder = folders.folders.find((folder) => folder.id === current.id);
  const controlsDisabled = disabled || readOnly || importing;
  const classificationDisabled = controlsDisabled || Boolean(folderError);

  const mutateFolders = (
    mutate: (store: ReturnType<typeof createResourceFolderStore>) => ResourceFolders,
  ) => {
    if (blocked.current || importing || folderError) return false;
    try {
      setFolders(mutate(createResourceFolderStore(localStorage)));
      setError('');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '자원 폴더를 저장하지 못했습니다.');
      return false;
    }
  };

  const importResources = async (files?: File[]) => {
    if (blocked.current || importing) return;
    const ticket = ++operation.current;
    const target = current.id;
    setImporting(true);
    setError('');
    try {
      if (target === BUBBLE_FOLDER) {
        const candidates = await prepareBubbleFiles(files ?? []);
        if (!mounted.current || ticket !== operation.current || blocked.current) {
          for (const candidate of candidates) URL.revokeObjectURL(candidate.url);
          return;
        }
        bubbleUrls.current = candidates.map((candidate) => candidate.url);
        setCandidateIndex(0);
        setBubbleCandidates(candidates);
      } else if (target === BUILTIN_FOLDER) await refreshBuiltinResources();
      else {
        if (folderError) throw new Error(folderError);
        const store = createResourceFolderStore(localStorage);
        store.read();
        const saved = await cacheResourceFiles(files ?? []);
        if (!mounted.current || ticket !== operation.current || blocked.current) return;
        if (target !== UNCLASSIFIED_FOLDER && saved.length)
          setFolders(
            store.assign(
              saved.map((resource) => resource.id),
              target,
            ),
          );
      }
    } catch (cause) {
      if (mounted.current && ticket === operation.current)
        setError(cause instanceof Error ? cause.message : '자원을 불러오지 못했습니다.');
    } finally {
      if (mounted.current) setImporting(false);
    }
  };

  return (
    <section className="resource-library" aria-label="자원그룹" aria-busy={busy || importing}>
      {readOnly ? (
        <div className="resource-toolbar">
          <button
            type="button"
            className="resource-readonly-banner"
            onClick={onRequestEdit}
            style={{ background: 'rgba(11, 15, 43, 0.5)', color: '#F8F9FA' }}
          >
            현재 보기만 가능한 상태입니다. 편집권한을 가져오려면 눌러주세요.
          </button>
          {toolbar && <div className="resource-history">{toolbar}</div>}
        </div>
      ) : (
        <>
          <div className="resource-editor-row">
            <div className="resource-folder-shell">
              <div className="resource-toolbar">
                <div
                  ref={folderTabsRef}
                  className="resource-folder-tabs"
                  role="tablist"
                  aria-label="자원 폴더"
                >
                  {folderTabs.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      role="tab"
                      className="resource-folder-tab"
                      aria-label={
                        folder.id !== BUBBLE_FOLDER && folder.name === '말풍선'
                          ? '말풍선 사용자 폴더'
                          : undefined
                      }
                      aria-selected={current.id === folder.id}
                      aria-controls="resource-folder-content"
                      id={`resource-folder-${folder.id}`}
                      onClick={() => {
                        setActiveFolder(folder.id);
                        setRename('');
                        setClassifyId('');
                      }}
                    >
                      <ResourceFolderTabSurface />
                      <span className="resource-tab-content">
                        <UiIcon
                          name={folder.id === BUBBLE_FOLDER ? 'bubble' : 'folder'}
                          size={16}
                        />
                        <span>{folder.name}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  className="resource-folder-add"
                  type="button"
                  aria-label="자원 폴더 추가"
                  disabled={classificationDisabled}
                  onClick={() => {
                    setManageOpen(true);
                    requestAnimationFrame(() => folderNameInput.current?.focus());
                  }}
                >
                  <UiIcon name="plus" size={17} />
                </button>
                <button
                  className="resource-import"
                  type="button"
                  aria-label={
                    current.id === BUILTIN_FOLDER ? '기본 소재 새로고침' : `${current.name} 추가`
                  }
                  title={
                    current.id === BUILTIN_FOLDER ? '기본 소재 새로고침' : `${current.name} 추가`
                  }
                  disabled={
                    controlsDisabled ||
                    (!isBubbleFolder && current.id !== BUILTIN_FOLDER && Boolean(folderError))
                  }
                  onClick={() => {
                    if (current.id === BUILTIN_FOLDER) void importResources();
                    else input.current?.click();
                  }}
                >
                  <UiIcon name="upload" size={17} />
                  <span>
                    {current.id === BUILTIN_FOLDER
                      ? importing
                        ? '새로고침 중'
                        : '기본 소재 새로고침'
                      : importing
                        ? `${current.name} 추가 중`
                        : `${current.name} 추가`}
                  </span>
                </button>
              </div>
              <div
                className="resource-tray"
                id="resource-folder-content"
                role="tabpanel"
                aria-labelledby={`resource-folder-${current.id}`}
              >
                {isBubbleFolder &&
                  BUBBLE_RESOURCES.map(({ shape, name, addLabel }) => {
                    const id = bubbleResourceId(shape);
                    return (
                      <button
                        key={shape}
                        type="button"
                        className="resource-item resource-bubble-item"
                        data-bubble-shape={shape}
                        data-resource-id={id}
                        aria-label={addLabel}
                        disabled={controlsDisabled}
                        draggable={!controlsDisabled}
                        onDragStart={(event) => {
                          event.dataTransfer.setData(RESOURCE_DRAG_MIME, id);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                        onPointerDown={(event) => onResourcePointerDown?.(id, event)}
                        onClick={() => onAddBubble(shape)}
                      >
                        <span className="resource-bubble-thumbnail">
                          <BubbleResourcePreview shape={shape} />
                        </span>
                        <span className="resource-name">{name}</span>
                      </button>
                    );
                  })}
                {group.map((resource) => {
                  const id = isBubbleFolder ? customBubbleResourceId(resource.id) : resource.id;
                  return (
                    <button
                      key={resource.id}
                      type="button"
                      className="resource-item"
                      aria-label={`${resource.name} ${isBubbleFolder ? '말풍선 추가' : '배치'}`}
                      data-resource-id={id}
                      data-bubble-shape={isBubbleFolder ? 'custom' : undefined}
                      title={`${resource.name} · ${categoryLabels[resource.category]}`}
                      disabled={controlsDisabled}
                      draggable={!controlsDisabled}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(RESOURCE_DRAG_MIME, id);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      onPointerDown={(event) => onResourcePointerDown?.(id, event)}
                      onClick={() => onPlace(id)}
                    >
                      <img src={resource.url} alt="" draggable={false} loading="lazy" />
                      <span className="resource-name" title={resource.name}>
                        {resource.name}
                      </span>
                    </button>
                  );
                })}
                {!isBubbleFolder && !busy && !group.length && (
                  <span className="resource-empty">비어 있음</span>
                )}
              </div>
            </div>
            {toolbar && <div className="resource-history">{toolbar}</div>}
          </div>
          <input
            ref={input}
            type="file"
            multiple
            accept={isBubbleFolder ? 'image/png,.png' : 'image/png,image/jpeg,image/webp'}
            aria-label={isBubbleFolder ? '말풍선 PNG 파일' : '자원 이미지 파일'}
            hidden
            disabled={controlsDisabled || (!isBubbleFolder && Boolean(folderError))}
            onChange={(event) => {
              const files = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = '';
              if (files.length) void importResources(files);
            }}
          />
          {bubbleCandidates?.length &&
            (() => {
              const candidate = bubbleCandidates[candidateIndex]!;
              let converted;
              try {
                converted = customBubbleFromCandidate(candidate);
              } catch {
                converted = null;
              }
              return (
                <dialog
                  ref={bubbleDialog}
                  className="bubble-import-dialog"
                  aria-label="PNG 말풍선 변환"
                  onCancel={(event) => {
                    event.preventDefault();
                    setBubbleCandidates(null);
                  }}
                >
                  <h2>PNG 말풍선 변환</h2>
                  <fieldset disabled={disabled || readOnly || importing}>
                    <label>
                      파일
                      <select
                        aria-label="가져올 말풍선 파일"
                        value={candidateIndex}
                        onChange={(event) => setCandidateIndex(Number(event.target.value))}
                      >
                        {bubbleCandidates.map((item, i) => (
                          <option key={i} value={i}>
                            {item.image.original.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="bubble-import-previews">
                      <img src={candidate.url} alt="PNG 원본" width="180" height="140" />
                      {converted && <BubbleImportPreview candidate={candidate} />}
                    </div>
                    <fieldset>
                      <legend>몸체 범위(원본 꼬리 제외)</legend>
                      {(['x', 'y', 'width', 'height'] as const).map((key) => (
                        <label key={key}>
                          {{ x: '왼쪽', y: '위', width: '폭', height: '높이' }[key]}
                          <input
                            aria-label={`말풍선 몸체 ${{ x: '왼쪽', y: '위', width: '폭', height: '높이' }[key]}`}
                            type="number"
                            min={key === 'width' || key === 'height' ? 1 : 0}
                            max="100"
                            step="1"
                            value={Math.round(candidate.bounds[key] * 100)}
                            onChange={(event) => {
                              const value = Number(event.target.value) / 100;
                              if (!Number.isFinite(value)) return;
                              setBubbleCandidates(
                                (items) =>
                                  items?.map((item, i) =>
                                    i === candidateIndex
                                      ? { ...item, bounds: { ...item.bounds, [key]: value } }
                                      : item,
                                  ) ?? null,
                              );
                            }}
                          />
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      추가할 편집 꼬리
                      <select
                        aria-label="가져올 말풍선 꼬리"
                        value={candidate.side}
                        onChange={(event) =>
                          setBubbleCandidates(
                            (items) =>
                              items?.map((item, i) =>
                                i === candidateIndex
                                  ? { ...item, side: event.target.value as TailSide }
                                  : item,
                              ) ?? null,
                          )
                        }
                      >
                        <option value="none">없음</option>
                        <option value="top">위</option>
                        <option value="right">오른쪽</option>
                        <option value="bottom">아래</option>
                        <option value="left">왼쪽</option>
                      </select>
                    </label>
                    {!converted && <p role="alert">몸체 범위를 이미지 안으로 지정해 주세요.</p>}
                    {error && <p role="alert">{error}</p>}
                    <button
                      type="button"
                      disabled={!converted}
                      onClick={() => {
                        if (blocked.current) return;
                        setImporting(true);
                        const ticket = ++operation.current;
                        void cacheBubbleCandidates(bubbleCandidates)
                          .then(() => {
                            if (mounted.current && ticket === operation.current) {
                              setBubbleCandidates(null);
                              setError('');
                            }
                          })
                          .catch((cause) => {
                            if (mounted.current && ticket === operation.current)
                              setError(
                                cause instanceof Error
                                  ? cause.message
                                  : '말풍선을 저장하지 못했습니다.',
                              );
                          })
                          .finally(() => {
                            if (mounted.current) setImporting(false);
                          });
                      }}
                    >
                      가져오기
                    </button>
                  </fieldset>
                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => setBubbleCandidates(null)}
                  >
                    취소
                  </button>
                </dialog>
              );
            })()}
          <details
            className="resource-management"
            open={manageOpen}
            onToggle={(event) => setManageOpen(event.currentTarget.open)}
          >
            <summary>폴더 관리</summary>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const id = `folder-${crypto.randomUUID()}`;
                if (mutateFolders((store) => store.add(newFolderName, id))) {
                  setActiveFolder(id);
                  setNewFolderName('');
                }
              }}
            >
              <label>
                새 폴더
                <input
                  ref={folderNameInput}
                  value={newFolderName}
                  maxLength={30}
                  disabled={classificationDisabled}
                  onChange={(event) => setNewFolderName(event.target.value)}
                />
              </label>
              <button type="submit" disabled={classificationDisabled || !newFolderName.trim()}>
                추가
              </button>
            </form>
            {customFolder && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (mutateFolders((store) => store.rename(current.id, rename))) setRename('');
                }}
              >
                <label>
                  폴더 이름
                  <input
                    value={rename}
                    placeholder={customFolder.name}
                    maxLength={30}
                    disabled={classificationDisabled}
                    onChange={(event) => setRename(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={classificationDisabled || !rename.trim()}>
                  이름 변경
                </button>
              </form>
            )}
            {!isBubbleFolder && (
              <div className="resource-classification">
                <label>
                  분류할 자원
                  <select
                    value={classifyId}
                    disabled={classificationDisabled}
                    onChange={(event) => setClassifyId(event.target.value)}
                  >
                    <option value="">자원 선택</option>
                    {group.map((resource) => (
                      <option key={resource.id} value={resource.id}>
                        {resource.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  이동할 폴더
                  <select
                    value={classifyTarget}
                    disabled={classificationDisabled}
                    onChange={(event) => setClassifyTarget(event.target.value)}
                  >
                    <option value={UNCLASSIFIED_FOLDER}>미분류</option>
                    {folders.folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={classificationDisabled || !classifyId}
                  onClick={() => {
                    if (
                      mutateFolders((store) =>
                        store.assign([classifyId], classifyTarget, current.id),
                      )
                    )
                      setClassifyId('');
                  }}
                >
                  이동
                </button>
              </div>
            )}
          </details>
        </>
      )}
      {(error || folderError) && (
        <p className="library-error" role="alert">
          {error || folderError}
        </p>
      )}
    </section>
  );
}
