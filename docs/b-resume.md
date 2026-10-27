# B 구현 경로와 상세 재현 안내

## 목표

사용자 자원 전체, 미저장 현재 카드(JSON/PNG), 저장 템플릿 전체, 개인 TTF/OTF 전체를 ZIP 하나로 내려받게 한다. 글꼴10MB·비압축 전체100MB, AI별60분·12요청이다. 승인 동작은 protocol/zip-spec.md, 공통 최초 요청은 protocol/initial-request.md다.

## 현재 상태

전달 저장소 버전 ID는 `task05-A-end` 태그다. 실행 검증에 사용한 기능 소스 커밋은 `d90a3bae21fc91fcdf04e4ca3ae3628d9820c6a8`이며, 이후 전달 커밋은 기록·인수인계 도구만 추가한다. 동결 기준은 `815aa41b9ec25f99cb794109fb930b0acfed8d70` (`task05-freeze`)다.

A는 packages/project-archive/src/에 ZIP 코어, SHA-256/CRC, 참조/원본/용량 검증, TTF/OTF 실제 FontFace 검증과 별도 IndexedDB 글꼴 보관을 구현했다. UI는 기존 과제3 상태다. ZIP 가져오기는 범위 밖이다. 원격 게시·배포·B 실행은 하지 않았다.

개인 글꼴 DB는 jjal-personal-fonts-v1/fonts이며 SHA-256 키다. importPersonalFont/listPersonalFonts/readPersonalFont/ensurePersonalFont/personalFontFamily를 재사용한다. family는 jjal-uploaded-<sha>다. 세션과 소스 기록은 evidence/runs/run-001/에 있다. A 서비스는 Codex이며 정확한 모델 표시는 런타임에서 제공되지 않았다. B 시작 전에 다른 서비스 또는 다른 모델임을 실제로 기록한다.

## 실행 명령

Node24.x·npm11.x·Python3 및 Chrome이 필요하다. 환경 준비 후 같은 작업 폴더에서 실행한다.

```sh
git clone repository.bundle task05
cd task05
git checkout task05-A-end
npm ci --ignore-scripts
npm run freeze:verify
npm run dev
```

검사는 별도 터미널에서 실행한다. 기존 dev 서버는5173, 고정 검사는 자체4175 서버를 쓴다. 기본 Chrome 외 설치는 PLAYWRIGHT_CHANNEL을 지정하고, Python 경로는 PYTHON으로 지정한다.

```sh
npm run test:acceptance -- --phase B
npm run check
node tools/progress/status.mjs
node tools/report/build.mjs
node tools/preflight/check.mjs
```

현재 기능 검사는 미완료3개 때문에 종료코드1이 예상된다. 독립 새 폴더에서 npm ci/check/동결검사/같은10개 실행을 재현했다. 상세는 evidence/runs/run-001/reproduction.md다.

## 통과 검사

최종 A 새 폴더 결과는 ZIP-01/03/04/06/07/08/09 PASS(7/10), ZIP-02/05/10 FAIL이다. ZIP은 독립 Python zipfile로 CRC·중복 경로·원본 해시·manifest·실제 바이트 합계를 검사했다. 실제10MB 글꼴과 +1바이트, 100MB 경계 함수, 실제100MB 초과 snapshot을 검사했다.

기존 타입·lint·44파일673개 단위 검사·빌드도 PASS다. 실제 기능 검사 회차는 test-runs의 phase A로 시작하는 완전한10개 결과를 모두 포함한다. 준비 회차는 별도다. 실패 회차를 삭제하거나 재시도 전 결과를 성공으로 덮지 않는다.

## 남은 문제

1. ZIP-02: 전체 자료 ZIP 다운로드 버튼과 실제 현재 카드/저장소 snapshot 수집이 없다.
2. ZIP-05: 개인 글꼴 파일/선택 UI, 업로드 글꼴 렌더링·측정, 템플릿 저장/복원 연결이 없다. 원래 문서 스키마의 uploaded 참조는 있으나 다음 계층은 아직 기본 글꼴만 허용한다.
3. ZIP-10: 생성 중 busy 가드와 같은 클릭의 중복 다운로드 차단이 없다.

최종 보고서·본인 판단·B 실제 사용량·무로그인 공개URL 검증은 아직 미완료다. report/index.html은 익명 중간 보고서이며 공개 배포되지 않았다. 새 오픈소스 라이선스를 부여하지 않는다.

## 다음 행동

1. B는 이전 대화 없이 저장소와 이 문서만 받는다. 이 원본의 SHA-256이 handoff-check.json과 같은지 확인해 B-received.md로 보존하고 실제 수신을 기록한다. 동결 태그815aa41b와 파일25개를 검증한다. 누락은 없음 또는 수정 전후로 기록한다.
2. apps/demo/src/app/에 ZIP/개인 글꼴 UI를 추가하고 App.tsx의 export 페이지에 연결한다. frozen 계약의 정확한 레이블을 쓴다. snapshot은 현재 문서/원본 이미지·전체 템플릿·자원·개인 글꼴을 읽어 createArchive에 전달한다. 템플릿/자원/이미지는 가능하면 하나의 readonly IndexedDB transaction으로 수집하고 폴더 분류를 보존한다. 현재 카드 저장을 대신 호출하지 않는다. 내보내기 시작 시점 복사본을 고정하고 즉시 중복 실행을 막는다.
3. packages/renderer/src/index.ts의 canvasFont와 renderer/src/fonts.ts, apps/demo/src/composition/textBounds.ts 등 측정 경로에서 uploaded 글꼴을 준비/조회한다. assetId와 SHA-256을 구분한다. 템플릿 복사에서 asset ID를 바꿀 경우 글꼴 참조도 다시 연결한다.
4. packages/template-kit/src/index.ts의 validateEditorDocument/cloneTemplateDocument, browser.ts의 이미지 전용 codec, apps/demo/src/app/TemplateLibrary.tsx의 imageBodies, packages/persistence/browser/index.ts의 원본 검증을 확인한다. 개인 글꼴 원본도 템플릿과 연결하고 새로고침 후 글꼴 준비→불러오기를 수행한다. 기존 기본 글꼴 JSON 흐름을 유지하고, 개인 글꼴을 기존 JSON 형식에서 조용히 누락하지 않는다.
5. 같은10개 검사를 실행하고 모두 통과시킨다. 추가로 실제 UI에서 저장 템플릿 원본 미변경, 내보내는 동안 편집한 내용의 snapshot 분리, 개인 글꼴의 실제 A/가 표시를 확인한다. 이 보조 확인은 고정10개의 통과 수에 합산하지 않는다.
6. B 시작/종료 소스·시간·실제 요청 수, 회차별 결과·문서 누락을 기록한다. AI별 상한은 그대로 적용한다. B 종료 뒤 report를 다시 생성하고 사용자 판단/공개URL 검증을 완료한다.

## 건드리지 말 것

protocol/, tests/acceptance/, 고정된 실행 도구·package.json/lockfile·AGENTS.md의 해시를 바꾸지 않는다. 테스트 삭제·완화·기대값 변경 금지. UI나 제품 코드에서 검사 환경을 감지해 성공을 반환하지 않는다. 기존 private 원본과 과제3 공개 정본을 수정하거나 push하지 않는다. 실제 사용자 자료·환경값·개인 경로·원시 trace를 공개하지 않는다. 기존 권리 고지는 보존한다.
