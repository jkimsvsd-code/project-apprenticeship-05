import { describe, expect, it } from 'vitest';
import { createSampleDocument } from '@jjal/content';
import { parseTemplateBackup } from '@jjal/template-kit';

const backup = () => ({
  kind: 'jjal-template-backup',
  schemaVersion: 1,
  exportedAt: '2026-10-21T00:00:00Z',
  templates: [
    {
      kind: 'jjal-template',
      schemaVersion: 1,
      id: 'template-1',
      name: '시험 문구',
      createdAt: '2026-10-21T00:00:00Z',
      updatedAt: '2026-10-21T00:00:00Z',
      document: createSampleDocument(),
    },
  ],
  embeddedAssets: [],
});

describe('템플릿 JSON의 저장 전 구조 검사', () => {
  it('정상 JSON을 복원 가능한 구조로 읽는다', () => {
    expect(parseTemplateBackup(JSON.stringify(backup())).templates[0]!.name).toBe('시험 문구');
  });
  it('손상 JSON을 거부한다', () => {
    expect(() => parseTemplateBackup('{broken')).toThrow('올바른 JSON');
  });
  it('필수 항목 누락을 거부한다', () => {
    const bad: Record<string, unknown> = backup();
    delete bad.templates;
    expect(() => parseTemplateBackup(JSON.stringify(bad))).toThrow();
  });
  it('템플릿 중복 ID를 거부한다', () => {
    const bad = backup();
    bad.templates.push(bad.templates[0]!);
    expect(() => parseTemplateBackup(JSON.stringify(bad))).toThrow();
  });
  it('참조되지 않는 소재 본문을 거부한다', () => {
    const bad = { ...backup(), embeddedAssets: [{ sha256: '0'.repeat(64), base64: 'YQ==' }] };
    expect(() => parseTemplateBackup(JSON.stringify(bad))).toThrow();
  });
  it('파일 크기를 파싱 전에 제한한다', () => {
    expect(() => parseTemplateBackup(' '.repeat(25_000_001))).toThrow('25MB');
  });
});
