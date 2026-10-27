import type { Asset, StudioDocument, CustomBubbleResource } from '@jjal/document-model';
import type { SavedTemplate } from '@jjal/template-kit';

export interface TemplateRepository {
  list(): Promise<SavedTemplate[]>;
  read(id: string): Promise<TemplateContents>;
  /** 모든 참조 소재를 SHA-256 키로 제공한다. 호출자가 해시·디코딩 검사를 마쳐야 한다. */
  save(
    template: SavedTemplate,
    assets: ReadonlyMap<string, Blob>,
    mode: 'create' | 'update',
  ): Promise<void>;
  remove(id: string): Promise<void>;
  /** 기존 ID를 덮어쓰지 않으며, 한 항목이라도 실패하면 전체 묶음을 취소한다. */
  addMany(templates: SavedTemplate[], assets: ReadonlyMap<string, Blob>): Promise<void>;
}

export interface TemplateContents {
  template: SavedTemplate;
  assets: Map<string, Blob>;
}

export interface CachedResourceMetadata {
  id: string;
  name: string;
  origin: 'builtin' | 'user';
  category: 'image' | 'character' | 'background';
  createdAt: string;
  asset: Asset;
  customBubble?: CustomBubbleResource;
}

export interface CachedResource extends CachedResourceMetadata {
  blob: Blob;
}

export interface ResourceRepository {
  list(): Promise<CachedResourceMetadata[]>;
  read(id: string): Promise<CachedResource>;
  /** 해시별로 중복을 제거하며 전체 묶음이 하나의 트랜잭션으로 저장된다. */
  addMany(resources: readonly CachedResource[]): Promise<CachedResourceMetadata[]>;
}

export interface DraftRecord {
  documentId: string;
  baseRevision: number | null;
  savedAt: string;
  document: StudioDocument;
}

// 실행 취소·선택·확대율은 세션 상태다. 서버 권한과 API 키는 저장하지 않는다.
export interface SessionState {
  selectedElementIds: string[];
  zoom: number;
  dirty: boolean;
}
