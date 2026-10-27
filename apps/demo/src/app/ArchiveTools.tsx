import { useEffect, useRef, useState } from 'react';
import type { StudioDocument } from '@jjal/document-model';
import { imageBlob, type PreparedImage } from '@jjal/image-io';
import { openStudioDatabase } from '@jjal/persistence/browser';
import { loadUploadedFont, setUploadedFontLoader } from '@jjal/renderer';
import type { SavedTemplate } from '@jjal/template-kit';
import {
  createArchive,
  importPersonalFont,
  listPersonalFonts,
  readPersonalFont,
  type ArchiveResource,
  type PersonalFont,
} from '../../../../packages/project-archive/src/index';
import { listLibraryResources } from '../composition/resources';
import { createResourceFolderStore } from '../composition/resource-folders';
import { UiIcon } from './UiIcon';

// 렌더러는 해시만 알고, 개인 글꼴 원본은 이 브라우저의 개인 글꼴 보관소에서 읽는다.
setUploadedFontLoader(async (sha256) => {
  const row = await readPersonalFont(sha256);
  await loadUploadedFont(sha256, row.blob);
});

export interface ArchiveSource {
  doc: StudioDocument;
  images: ReadonlyMap<string, PreparedImage>;
  frame: HTMLCanvasElement;
}
interface Props {
  getSource: () => ArchiveSource;
  /** 현재 선택한(없으면 첫) 문구의 개인 글꼴 SHA-256. */
  appliedFont: string;
  disabled: boolean;
  onApplyFont: (font: PersonalFont) => Promise<void>;
  onNotice: (message: string) => void;
}
const explain = (cause: unknown) =>
  cause instanceof Error ? cause.message : '작업을 완료하지 못했습니다. 다시 시도해 주세요.';

/** 템플릿·소재·자원 원본은 하나의 읽기 전용 트랜잭션에서 같은 시점으로 읽는다. */
async function readStoredLibrary(userResourceIds: ReadonlySet<string>) {
  const db = await openStudioDatabase();
  try {
    const tx = db.transaction(['templates', 'assets', 'resources'], 'readonly');
    const [templates, assets, resources] = await Promise.all([
      tx.objectStore('templates').getAll(),
      tx.objectStore('assets').getAll(),
      tx.objectStore('resources').getAll(),
    ]);
    await tx.done;
    return {
      templates: templates as SavedTemplate[],
      assets,
      resources: resources.filter((row) => userResourceIds.has(row.id)),
    };
  } finally {
    db.close();
  }
}

export function ArchiveTools({ getSource, appliedFont, disabled, onApplyFont, onNotice }: Props) {
  const [fonts, setFonts] = useState<PersonalFont[]>([]);
  const [busy, setBusy] = useState(false);
  const [fontBusy, setFontBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const running = useRef(false);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      listPersonalFonts()
        .then((list) => {
          if (alive) setFonts(list);
        })
        .catch((cause: unknown) => {
          if (alive) setError(`개인 글꼴 목록을 열지 못했습니다. ${explain(cause)}`);
        });
    void refresh();
    window.addEventListener('jjal-personal-fonts-changed', refresh);
    return () => {
      alive = false;
      window.removeEventListener('jjal-personal-fonts-changed', refresh);
    };
  }, []);

  async function importFonts(files: readonly File[]) {
    if (!files.length) return;
    setFontBusy(true);
    setError('');
    const failed: string[] = [];
    let added = 0;
    try {
      // 파일별로 실제 로드·검증한다. 실패한 파일은 보관소와 카드를 바꾸지 않는다.
      for (const file of files) {
        try {
          await importPersonalFont(file);
          added++;
        } catch (cause) {
          failed.push(`${file.name}: ${explain(cause)}`);
        }
      }
      setFonts(await listPersonalFonts());
      if (failed.length) setError(failed.join(' '));
      if (added) {
        setStatus(`개인 글꼴 ${added}개를 보관했습니다.`);
        onNotice(`개인 글꼴 ${added}개를 보관했습니다.`);
      }
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setFontBusy(false);
    }
  }

  async function chooseFont(sha256: string) {
    const font = fonts.find((item) => item.sha256 === sha256);
    if (!font) return;
    setFontBusy(true);
    setError('');
    try {
      await onApplyFont(font);
      setStatus(`${font.name} 글꼴을 적용했습니다.`);
    } catch (cause) {
      setError(`${explain(cause)} 기존 작업은 그대로 유지됩니다.`);
    } finally {
      setFontBusy(false);
    }
  }

  async function downloadArchive() {
    // 같은 클릭이 연달아 들어와도 첫 실행만 진행한다(상태 갱신 전 동기 가드).
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    setError('');
    setStatus('전체 자료 ZIP을 만들고 있습니다…');
    let url = '';
    try {
      // 시작 시점의 문서·이미지·미리보기 캔버스를 고정한다. 이후 편집은 새 세션에 반영된다.
      const source = getSource();
      const document_ = structuredClone(source.doc);
      const images = [...source.images.values()].map(
        (image) => [image.asset.sha256, image.original] as const,
      );
      const preview = await imageBlob(source.frame, 'png');
      const library = await listLibraryResources();
      const userIds = new Set(
        library.filter((resource) => resource.origin === 'user').map((r) => r.id),
      );
      const stored = await readStoredLibrary(userIds);
      const personal = await listPersonalFonts();
      const fontBodies = await Promise.all(
        personal.map(
          async (font) => [font.sha256, (await readPersonalFont(font.sha256)).blob] as const,
        ),
      );
      let folders: ReturnType<ReturnType<typeof createResourceFolderStore>['read']> | undefined;
      try {
        folders = createResourceFolderStore(localStorage).read();
      } catch {
        folders = undefined;
      }
      const folderNames = new Map(folders?.folders.map((folder) => [folder.id, folder.name]) ?? []);
      const resources: ArchiveResource[] = stored.resources.map((row) => {
        const names = (folders?.memberships[row.id] ?? []).flatMap((id) => {
          const name = folderNames.get(id);
          return name ? [name] : [];
        });
        return {
          id: row.id,
          name: row.name,
          sha256: row.asset.sha256,
          ...(names.length ? { folders: names } : {}),
        };
      });
      const files = new Map<string, Blob>();
      for (const { sha256, blob } of stored.assets) files.set(sha256, blob);
      for (const row of stored.resources) files.set(row.asset.sha256, row.blob);
      for (const [sha256, blob] of images) files.set(sha256, blob);
      for (const [sha256, blob] of fontBodies) files.set(sha256, blob);
      const { blob } = await createArchive({
        current: { document: document_, preview },
        templates: stored.templates,
        resources,
        fonts: personal,
        files,
      });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `jjal-export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      const started = 'ZIP 다운로드를 시작했습니다';
      setStatus(started);
      onNotice(started);
    } catch (cause) {
      setStatus('');
      setError(
        `전체 자료 ZIP을 만들지 못했습니다. ${explain(cause)} 기존 자료는 그대로 유지됩니다.`,
      );
    } finally {
      if (url) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="export-tools archive-tools" aria-label="전체 자료" aria-busy={busy}>
      <label>
        개인 글꼴 (TTF·OTF, 파일당 10MB)
        <input
          type="file"
          aria-label="개인 글꼴 파일"
          accept=".ttf,.otf,font/ttf,font/otf"
          multiple
          disabled={fontBusy}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            void importFonts(files);
          }}
        />
      </label>
      <label className="select-row">
        적용할 개인 글꼴
        <select
          aria-label="개인 글꼴 선택"
          value={fonts.some((font) => font.sha256 === appliedFont) ? appliedFont : ''}
          disabled={fontBusy || disabled || !fonts.length}
          onChange={(event) => void chooseFont(event.target.value)}
        >
          <option value="">
            {fonts.length ? '개인 글꼴을 고르세요' : '보관한 개인 글꼴 없음'}
          </option>
          {fonts.map((font) => (
            <option key={font.sha256} value={font.sha256}>
              {font.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="download-button button-content"
        aria-label="전체 자료 ZIP 다운로드"
        disabled={busy || disabled}
        onClick={() => void downloadArchive()}
      >
        <UiIcon name="download" size={19} />
        <span>{busy ? 'ZIP 만드는 중…' : '전체 자료 ZIP 다운로드'}</span>
      </button>
      <p className="hint">
        사용자 자원, 현재 카드(JSON·PNG), 저장한 템플릿, 개인 글꼴 원본을 ZIP 하나로 내려받습니다.
        ZIP 가져오기는 아직 지원하지 않습니다.
      </p>
      {status && <p role="status">{status}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
