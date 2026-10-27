import { expect, it } from 'vitest';
import { createEditorDocument } from '@jjal/editor-core';
import { createSavedTemplate, parseTemplateBackup } from '@jjal/template-kit';

it('25MB 이내의 큰 Base64는 정규식 스택 초과 없이 구조 검사한다', () => {
  const document = createEditorDocument();
  const sha256 = 'a'.repeat(64);
  document.assets = [
    {
      id: 'large-image',
      mimeType: 'image/png',
      byteLength: 9_000_000,
      sha256,
      pixelWidth: 2000,
      pixelHeight: 1500,
    },
  ];
  document.panels[0]!.background.imageAssetId = 'large-image';
  const text = JSON.stringify({
    kind: 'jjal-template-backup',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    templates: [createSavedTemplate('큰 본문 구조 검사', document)],
    embeddedAssets: [{ sha256, base64: 'A'.repeat(12_000_000) }],
  });
  expect(parseTemplateBackup(text).embeddedAssets[0]!.base64).toHaveLength(12_000_000);
  // 구조 검사만 확인한다. 이 0바이트 배열을 실제 PNG로 저장하거나 정상 이미지로 인정하지 않는다.
});
