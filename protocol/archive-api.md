# 검사 어댑터 계약

실제 Chromium에서 제품 모듈 `packages/project-archive/src/index.ts`를 가져온다. UI 검사는 별도로 포함한다.

`createArchive(snapshot)` → `{blob: Blob, manifest}`. snapshot:

```
current: {document: StudioDocument, preview: Blob}
templates: SavedTemplate[]
resources: {id, name, sha256, folders?: string[]}[]
fonts: {id, name, sha256, mimeType}[]
files: Map<sha256, Blob>
```

manifest: `kind: jjal-archive`, `schemaVersion: 1`, `counts: {resources, templates, fonts, current: 1}`, `files: [{path, sha256, byteLength}]`. files는 manifest 자신을 제외한 모든 파일을 나열한다. 경로는 ZIP 루트 jjal-export/ 기준 상대경로다. 원본 asset ID·SHA·글꼴 참조를 유지하고 파일 경로를 연결한다.

`validateArchiveSize(sizes: number[])`는 합계 100,000,000까지 허용하고 초과/음수/비정상 숫자는 거부한다. 실제 createArchive도 manifest 포함 실제 크기에 적용한다.

`importPersonalFont(file: File)`은 TTF/OTF·10MB·실제 FontFace 로드를 검증한 뒤 브라우저에 원본을 보관한다. `{id,name,sha256,mimeType}` 반환. `listPersonalFonts()`는 미사용 글꼴도 포함한 전체 메타데이터 목록을 반환한다.

생성 ZIP은 Python zipfile로 독립 CRC·경로·바이트 검사를 한다. PNG는 브라우저에서 디코딩한다. 용량 경계는 함수 경계와 실제 초과 snapshot을 함께 검사한다.

개인 글꼴의 브라우저 내부 family는 `jjal-uploaded-` 접두사를 사용해 기본 글꼴과 이름 충돌을 방지한다. ZIP JSON은 이 구현용 family 대신 원본 asset 참조를 보존한다.
