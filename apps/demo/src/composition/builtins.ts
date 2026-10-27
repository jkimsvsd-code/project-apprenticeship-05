import { BUILTIN_ASSETS, BUILTIN_TEMPLATES, createBuiltinDocument } from '@jjal/content';
import { createSavedTemplate } from '@jjal/template-kit';
import { restoreTemplate } from '@jjal/template-kit/browser';
import { prepareImage } from '@jjal/image-io';

export { BUILTIN_ASSETS, BUILTIN_TEMPLATES, createBuiltinDocument };
const bodies = new Map<string, Promise<Blob>>();
export async function loadBuiltinCharacter(id: string) {
  const source = BUILTIN_ASSETS.find(
    (item) => item.asset.id === id && item.category === 'character',
  );
  if (!source) throw new Error('캐릭터 소재를 찾을 수 없습니다.');
  const response = await fetch(new URL(source.url, document.baseURI));
  if (!response.ok) throw new Error('캐릭터를 불러오지 못했습니다. 다시 시도해 주세요.');
  const prepared = await prepareImage(
    new File([await response.arrayBuffer()], `${id}.png`, { type: 'image/png' }),
  );
  if (
    prepared.asset.sha256 !== source.asset.sha256 ||
    prepared.asset.byteLength !== source.asset.byteLength
  )
    throw new Error('캐릭터 파일 검증에 실패했습니다.');
  return { ...prepared, asset: source.asset };
}
export async function loadBuiltinTemplate(id: string) {
  const doc = createBuiltinDocument(id);
  const blobs = new Map<string, Blob>();
  for (const asset of doc.assets) {
    const source = BUILTIN_ASSETS.find((item) => item.asset.sha256 === asset.sha256);
    if (!source) throw new Error('기본 소재를 찾을 수 없습니다.');
    let pending = bodies.get(asset.sha256);
    if (!pending) {
      pending = fetch(new URL(source.url, document.baseURI))
        .then(async (response) => {
          if (!response.ok) throw new Error('기본 소재를 불러오지 못했습니다. 다시 시도해 주세요.');
          return new Blob([await response.arrayBuffer()], { type: asset.mimeType });
        })
        .catch((cause: unknown) => {
          bodies.delete(asset.sha256);
          throw cause;
        });
      bodies.set(asset.sha256, pending);
    }
    blobs.set(asset.sha256, await pending);
  }
  return restoreTemplate(createSavedTemplate(doc.title, doc), blobs);
}
