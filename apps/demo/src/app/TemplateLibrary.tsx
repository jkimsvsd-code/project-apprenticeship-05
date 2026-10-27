import { useEffect, useRef, useState } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import type { PreparedImage } from '@jjal/image-io';
import { createTemplateRepository } from '@jjal/persistence/browser';
import { createSavedTemplate, type SavedTemplate } from '@jjal/template-kit';
import { exportTemplateBackup, readBackupFile, restoreTemplate } from '@jjal/template-kit/browser';
import { cachePreparedImages, cacheResourceBlobs } from '../composition/resources';
import { UiIcon } from './UiIcon';

const repository = createTemplateRepository();
type Snapshot = {
  doc: StudioDocument;
  images: ReadonlyMap<string, PreparedImage>;
  revision: number;
};
interface Props {
  getSnapshot: () => Snapshot;
  applyTemplate: (doc: StudioDocument, images: ReadonlyMap<string, PreparedImage>) => void;
  composing: boolean;
}
const explain = (cause: unknown) =>
  cause instanceof Error && cause.name !== 'ZodError'
    ? cause.message
    : '템플릿의 필수 항목 또는 이름이 올바르지 않습니다.';
const imageBodies = ({ images }: Snapshot) =>
  new Map([...images.values()].map((image) => [image.asset.sha256, image.original]));

export function TemplateLibrary({ getSnapshot, applyTemplate, composing }: Props) {
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState('');
  const [scope, setScope] = useState('all');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  useEffect(() => {
    let alive = true;
    repository
      .list()
      .then((list) => {
        if (alive) {
          setTemplates(list);
          setReady(true);
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(`브라우저 저장소를 열지 못했습니다. ${explain(cause)}`);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function action(work: () => Promise<void>, importing = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (cause) {
      setError(
        `${importing ? 'JSON을 가져오지 못했습니다. ' : ''}${explain(cause)}${importing ? ' 기존 작업과 템플릿은 그대로 유지됩니다.' : ''}`,
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  function checkName() {
    if (!name.trim() || name.trim().length > 120)
      throw new Error('템플릿 이름을 1~120자로 입력해 주세요.');
  }
  async function save(update: boolean) {
    checkName();
    const snapshot = getSnapshot();
    const previous = update ? (await repository.read(selected)).template : undefined;
    const template = createSavedTemplate(name, snapshot.doc, previous);
    await repository.save(template, imageBodies(snapshot), update ? 'update' : 'create');
    setTemplates(await repository.list());
    setSelected(template.id);
    setName(template.name);
    setNotice(`‘${template.name}’ 템플릿을 ${update ? '수정' : '저장'}했습니다.`);
  }
  async function load() {
    const before = getSnapshot();
    const contents = await repository.read(selected);
    const prepared = await restoreTemplate(contents.template, contents.assets);
    await cachePreparedImages(prepared.images);
    if (getSnapshot().doc !== before.doc || getSnapshot().revision !== before.revision)
      throw new Error('불러오는 동안 현재 편집 내용이 바뀌었습니다. 다시 불러와 주세요.');
    applyTemplate(prepared.doc, prepared.images);
    setName(contents.template.name);
    setNotice(`‘${contents.template.name}’ 사본을 불러왔습니다.`);
  }
  async function remove() {
    const template = templates.find((item) => item.id === selected);
    if (
      !template ||
      !window.confirm(`‘${template.name}’ 템플릿을 삭제할까요? 현재 편집 중인 카드는 유지됩니다.`)
    )
      return;
    await repository.remove(template.id);
    setTemplates(await repository.list());
    setSelected('');
    setNotice(`‘${template.name}’ 템플릿을 삭제했습니다.`);
  }
  async function exportJson() {
    const list =
      scope === 'selected' ? [(await repository.read(selected)).template] : await repository.list();
    const bodies = new Map<string, Blob>();
    for (const item of list)
      for (const [sha256, blob] of (await repository.read(item.id)).assets)
        bodies.set(sha256, blob);
    const text = await exportTemplateBackup(list, bodies);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `jjal-templates-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setNotice(`템플릿 ${list.length}개의 JSON 파일을 만들었습니다.`);
  }
  async function importJson(file: File) {
    const prepared = await readBackupFile(file);
    await cacheResourceBlobs(
      prepared.templates.flatMap((template) => template.document.assets),
      prepared.assets,
    );
    await repository.addMany(prepared.templates, prepared.assets);
    setTemplates(await repository.list());
    setNotice(
      `템플릿 ${prepared.templates.length}개를 새 사본으로 가져왔습니다. 현재 카드는 유지됩니다.`,
    );
  }

  return (
    <section className="template-library" aria-label="내 템플릿" aria-busy={busy}>
      <div className="library-heading">
        <div className="section-heading">
          <UiIcon name="folder" className="section-icon" />
          <h2>
            내 템플릿 <span className="count-badge">{templates.length}</span>
          </h2>
        </div>
      </div>
      <fieldset disabled={!ready || busy || composing}>
        <div className="library-columns">
          <div className="library-save">
            <label>
              템플릿 이름
              <input
                aria-label="템플릿 이름"
                type="text"
                value={name}
                maxLength={120}
                placeholder="템플릿 이름"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button-content"
              onClick={() => void action(() => save(false))}
            >
              <UiIcon name="save" size={17} />
              <span>새 템플릿 저장</span>
            </button>
          </div>
          <div className="library-saved">
            <label>
              저장된 템플릿
              <select
                aria-label="저장된 템플릿"
                value={selected}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setName(templates.find((item) => item.id === event.target.value)?.name ?? '');
                }}
              >
                <option value="">템플릿을 선택해 주세요</option>
                {templates.map((template) => (
                  <option value={template.id} key={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="library-actions">
              <button
                type="button"
                className="button-content button-secondary"
                disabled={!selected}
                onClick={() => void action(load)}
              >
                <UiIcon name="folder" size={16} />
                <span>불러오기</span>
              </button>
              <button
                type="button"
                className="button-content button-secondary"
                disabled={!selected}
                onClick={() => void action(() => save(true))}
              >
                <UiIcon name="save" size={16} />
                <span>선택 템플릿 수정</span>
              </button>
              <button
                type="button"
                className="button-content button-danger"
                disabled={!selected}
                onClick={() => void action(remove)}
              >
                <UiIcon name="trash" size={16} />
                <span>삭제</span>
              </button>
            </div>
          </div>
          <div className="library-json">
            <label>
              JSON 범위
              <select
                aria-label="JSON 범위"
                value={scope}
                onChange={(event) => setScope(event.target.value)}
              >
                <option value="all">저장된 템플릿 전체</option>
                <option value="selected">선택한 템플릿 1개</option>
              </select>
            </label>
            <div className="library-actions">
              <button
                type="button"
                className="button-content button-secondary"
                disabled={!templates.length || (scope === 'selected' && !selected)}
                onClick={() => void action(exportJson)}
              >
                <UiIcon name="download" size={16} />
                <span>JSON 내보내기</span>
              </button>
              <label className="json-import button-content button-secondary">
                <UiIcon name="upload" size={16} />
                <span>JSON 가져오기</span>
                <input
                  aria-label="템플릿 JSON 파일"
                  type="file"
                  accept=".json,application/json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = '';
                    if (file) void action(() => importJson(file), true);
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </fieldset>
      {notice && (
        <p className="library-status" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="library-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
