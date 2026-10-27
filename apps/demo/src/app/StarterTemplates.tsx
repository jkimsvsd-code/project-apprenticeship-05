import { useRef, useState } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import type { PreparedImage } from '@jjal/image-io';
import { BUILTIN_TEMPLATES, loadBuiltinTemplate } from '../composition/builtins';
import { cachePreparedImages } from '../composition/resources';
import { UiIcon } from './UiIcon';

interface Props {
  revision: () => number;
  apply: (doc: StudioDocument, images: ReadonlyMap<string, PreparedImage>) => void;
  composing: boolean;
  onBusyChange: (busy: boolean) => void;
}
export function StarterTemplates({ revision, apply, composing, onBusyChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const running = useRef(false);
  async function select(id: string) {
    if (running.current) return;
    running.current = true;
    const before = revision();
    setBusy(true);
    onBusyChange(true);
    setError('');
    try {
      const prepared = await loadBuiltinTemplate(id);
      await cachePreparedImages(prepared.images);
      if (revision() !== before)
        throw new Error('불러오는 동안 편집이 시작되었습니다. 현재 작업을 유지했습니다.');
      apply(prepared.doc, prepared.images);
      setNotice(`${prepared.doc.title} 사본을 불러왔습니다.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : '기본 템플릿을 불러오지 못했습니다. 기존 작업은 유지됩니다.',
      );
    } finally {
      running.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="starter-library" aria-label="기본 템플릿" aria-busy={busy}>
      <div className="library-heading">
        <div className="section-heading">
          <UiIcon name="grid" className="section-icon" />
          <h2>기본 템플릿</h2>
        </div>
      </div>
      <div className="starter-options">
        {BUILTIN_TEMPLATES.map((item, index) => (
          <button
            type="button"
            key={item.id}
            aria-label={item.name}
            disabled={busy || composing}
            onClick={() => void select(item.id)}
          >
            <span
              className={`starter-mini starter-mini-${item.panelCount}`}
              data-panel-count={item.panelCount}
              aria-hidden="true"
            >
              {Array.from({ length: item.panelCount }, (_, cell) => (
                <i key={cell}>
                  <UiIcon name={index % 2 ? 'bubble' : 'image'} size={20} />
                </i>
              ))}
            </span>
            <strong>{item.name}</strong>
            <span>{item.panelCount}컷</span>
          </button>
        ))}
      </div>
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
