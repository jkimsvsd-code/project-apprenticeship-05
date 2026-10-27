import { openDB, type DBSchema } from 'idb';

export const FONT_BYTES = 10_000_000;
export interface PersonalFont {
  id: string;
  name: string;
  sha256: string;
  mimeType: 'font/ttf' | 'font/otf';
}
interface StoredFont extends PersonalFont {
  blob: Blob;
}
interface FontDatabase extends DBSchema {
  fonts: { key: string; value: StoredFont };
}
const ready = new Set<string>();
export async function digest(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
const database = () =>
  openDB<FontDatabase>('jjal-personal-fonts-v1', 1, {
    upgrade(db) {
      db.createObjectStore('fonts', { keyPath: 'sha256' });
    },
    blocking(_version, _next, event) {
      (event.target as IDBDatabase).close();
    },
  });
export const personalFontFamily = (sha256: string) => `jjal-uploaded-${sha256}`;

export async function validateFont(
  blob: Blob,
  name: string,
): Promise<{ mimeType: PersonalFont['mimeType']; face: FontFace }> {
  if (!blob.size || blob.size > FONT_BYTES) throw new Error('개인 글꼴은 10MB 이하여야 합니다.');
  const extension = name.toLowerCase().split('.').pop();
  const bytes = await blob.arrayBuffer();
  const head = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  const ttf = head.length === 4 && head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0;
  const otf = String.fromCharCode(...head) === 'OTTO';
  if (!((extension === 'ttf' && ttf) || (extension === 'otf' && otf)))
    throw new Error('실제 TTF 또는 OTF 글꼴 파일을 선택해 주세요.');
  try {
    const hash = await digest(blob);
    const face = await new FontFace(personalFontFamily(hash), bytes).load();
    if (face.status !== 'loaded') throw new Error('FontFace not loaded');
    return { mimeType: ttf ? 'font/ttf' : 'font/otf', face };
  } catch {
    throw new Error('글꼴 파일을 읽지 못했습니다. 기존 글꼴과 카드는 유지됩니다.');
  }
}

export async function importPersonalFont(file: File): Promise<PersonalFont> {
  const { mimeType, face } = await validateFont(file, file.name);
  const hash = await digest(file);
  const blob = new Blob([await file.arrayBuffer()], { type: mimeType });
  const row: StoredFont = { id: `font-${hash}`, name: file.name, sha256: hash, mimeType, blob };
  const db = await database();
  let saved: StoredFont;
  try {
    const tx = db.transaction('fonts', 'readwrite');
    const completed = tx.done;
    void completed.catch(() => undefined);
    try {
      const existing = await tx.store.get(hash);
      saved = existing ?? row;
      if (!existing) await tx.store.add(row);
      await completed;
    } catch (cause) {
      try {
        tx.abort();
      } catch {
        /* Already completed or aborted. */
      }
      await completed.catch(() => undefined);
      throw cause;
    }
  } catch (cause) {
    throw new Error('개인 글꼴을 저장하지 못했습니다. 브라우저 저장 공간을 확인해 주세요.', {
      cause,
    });
  } finally {
    db.close();
  }
  document.fonts.add(face);
  ready.add(hash);
  window.dispatchEvent(new Event('jjal-personal-fonts-changed'));
  const { blob: _body, ...metadata } = saved;
  void _body;
  return metadata;
}

export async function listPersonalFonts(): Promise<PersonalFont[]> {
  const db = await database();
  try {
    return (await db.getAll('fonts'))
      .map(({ blob, ...metadata }) => {
        void blob;
        return metadata;
      })
      .sort((a, b) => a.sha256.localeCompare(b.sha256));
  } finally {
    db.close();
  }
}

export async function readPersonalFont(hash: string): Promise<StoredFont> {
  const db = await database();
  try {
    const row = await db.get('fonts', hash);
    if (!row || (await digest(row.blob)) !== hash)
      throw new Error('개인 글꼴 원본이 없거나 손상되었습니다.');
    return row;
  } finally {
    db.close();
  }
}

export async function ensurePersonalFont(hash: string): Promise<void> {
  if (ready.has(hash)) return;
  const row = await readPersonalFont(hash);
  const { face } = await validateFont(row.blob, row.name);
  document.fonts.add(face);
  ready.add(hash);
}
