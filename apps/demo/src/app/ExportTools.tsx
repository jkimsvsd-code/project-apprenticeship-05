import { useEffect, useState } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import { imageBlob, type ExportFormat, type PreparedImage } from '@jjal/image-io';
import { renderDocument } from '@jjal/renderer';
import { UiIcon } from './UiIcon';

interface ExportSession {
  doc: StudioDocument;
  images: ReadonlyMap<string, PreparedImage>;
  frame: HTMLCanvasElement;
  longEdge: 1080 | 2048;
}
interface Artifact {
  session: ExportSession;
  format: ExportFormat;
  transparent: boolean;
  panelId: string;
  url: string;
  blob?: Blob;
  width?: number;
  height?: number;
  error?: string;
}

export function ExportTools({
  session,
  disabled,
  onSize,
  onNotice,
}: {
  session: ExportSession;
  disabled: boolean;
  onSize: (edge: 1080 | 2048) => void;
  onNotice: (message: string) => void;
}) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [transparent, setTransparent] = useState(false);
  const [scope, setScope] = useState('');
  const [artifact, setArtifact] = useState<Artifact>();
  const [downloadError, setDownloadError] = useState('');
  const panelId = session.doc.panels.some((panel) => panel.id === scope) ? scope : '';
  const alpha = format !== 'jpg' && transparent;
  const current =
    artifact?.session === session &&
    artifact.format === format &&
    artifact.transparent === alpha &&
    artifact.panelId === panelId
      ? artifact
      : undefined;

  useEffect(() => {
    let cancelled = false;
    let url = '';
    const identity = { session, format, transparent: alpha, panelId };
    async function prepare() {
      try {
        let frame = session.frame;
        if (alpha || panelId) {
          frame = document.createElement('canvas');
          renderDocument(frame, session.doc, {
            longEdge: session.longEdge,
            transparent: alpha,
            ...(panelId ? { panelId } : {}),
            images: new Map([...session.images].map(([id, image]) => [id, image.source])),
          });
        }
        if (format === 'jpg') {
          const opaque = document.createElement('canvas');
          opaque.width = frame.width;
          opaque.height = frame.height;
          const context = opaque.getContext('2d');
          if (!context) throw new Error('JPG 파일을 만들지 못했습니다.');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, opaque.width, opaque.height);
          context.drawImage(frame, 0, 0);
          frame = opaque;
        }
        const blob = await imageBlob(frame, format);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        await image.decode();
        if (cancelled) return;
        setArtifact({
          ...identity,
          blob,
          url,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      } catch (cause) {
        if (!cancelled)
          setArtifact({
            ...identity,
            url: '',
            error: cause instanceof Error ? cause.message : '출력 파일을 만들지 못했습니다.',
          });
      }
    }
    void prepare();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [session, format, alpha, panelId]);

  function download() {
    if (!current?.blob || disabled) return;
    try {
      const url = URL.createObjectURL(current.blob);
      const anchor = document.createElement('a');
      const number = session.doc.panels.findIndex((panel) => panel.id === panelId) + 1;
      anchor.href = url;
      anchor.download = `jjal-${session.doc.activeRatio.replace(':', 'x')}-${session.longEdge}${panelId ? `-cut-${number}` : ''}${alpha ? '-transparent' : ''}.${format}`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setDownloadError('');
      onNotice(`${format.toUpperCase()} 파일을 만들었습니다.`);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : '다운로드를 시작하지 못했습니다.');
    }
  }

  return (
    <section className="export-tools" aria-label="이미지 출력">
      <div className="download-row">
        <label>
          출력 크기
          <select
            aria-label="출력 크기"
            value={session.longEdge}
            onChange={(event) => onSize(Number(event.target.value) as 1080 | 2048)}
          >
            <option value="1080">긴 변 1,080px</option>
            <option value="2048">긴 변 2,048px</option>
          </select>
        </label>
        <label>
          파일 형식
          <select
            aria-label="파일 형식"
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
          >
            <option value="png">PNG</option>
            <option value="jpg">JPG</option>
            <option value="webp">WebP</option>
          </select>
        </label>
        <label>
          출력 범위
          <select
            aria-label="출력 범위"
            value={panelId}
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="">작품 전체</option>
            {session.doc.panels.map((panel, index) => (
              <option key={panel.id} value={panel.id}>
                {index + 1}번 컷
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          aria-label="투명 배경 출력"
          checked={transparent}
          disabled={format === 'jpg'}
          onChange={(event) => setTransparent(event.target.checked)}
        />
        투명 배경 (PNG·WebP)
      </label>

      <details className="export-preview">
        <summary>
          <UiIcon name="eye" size={17} />
          출력 미리보기{current?.blob ? ` · ${current.width} × ${current.height}px` : ''}
        </summary>
        {current?.blob ? (
          <img src={current.url} alt="실제 다운로드 파일 미리보기" />
        ) : (
          <p>{current?.error ?? '출력 미리보기를 준비하고 있습니다…'}</p>
        )}
      </details>
      <button
        className="download-button button-content"
        aria-label={
          !current ? '파일 만드는 중…' : `${format === 'webp' ? 'WebP' : format.toUpperCase()} 저장`
        }
        disabled={disabled || !current?.blob}
        onClick={download}
      >
        <UiIcon name="download" size={19} />
        <span>
          {!current
            ? '파일 만드는 중…'
            : `${format === 'webp' ? 'WebP' : format.toUpperCase()} 저장`}
        </span>
      </button>
      {(current?.error || downloadError) && (
        <p className="error" role="alert">
          {current?.error || downloadError} 기존 작업은 그대로 유지됩니다.
        </p>
      )}
    </section>
  );
}
