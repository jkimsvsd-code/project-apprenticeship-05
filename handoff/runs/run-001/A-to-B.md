# AI A → AI B 인수인계

## 목표

사용자 자원 전체·미저장 현재 카드(JSON/PNG)·저장 템플릿 전체·개인 TTF/OTF 전체의 ZIP 다운로드. 글꼴10MB·비압축 전체100MB, AI별60분·12요청. 승인 명세는 protocol/zip-spec.md다.

## 현재 상태

전달 버전은 `task05-A-end` 태그. 기능 실행 검증 소스는 `d90a3bae21fc91fcdf04e4ca3ae3628d9820c6a8`, 동결 기준은 `815aa41b9ec25f99cb794109fb930b0acfed8d70` (`task05-freeze`). A가 ZIP 코어·해시/CRC·용량·개인 글꼴 검증/보관을 구현했다. 제품 UI는 미연결이다. 실제 사용량·버전·순서는 evidence/runs/run-001/에 있다. 정확한 A 모델 표시는 런타임에서 제공되지 않았다.

## 실행 명령

Node24·npm11·Python3·Chrome 필요. bundle에서 clone한 저장소 루트에서 실행한다.

```sh
git checkout task05-A-end
npm ci --ignore-scripts
npm run freeze:verify
npm run test:acceptance -- --phase B
npm run check
```

편집기 실행은 npm run dev. Python 경로는 PYTHON, 브라우저는 PLAYWRIGHT_CHANNEL로 지정한다. 상세 환경/구현 경로는 docs/b-resume.md, 실제 새 폴더 재현은 evidence/runs/run-001/reproduction.md다.

## 통과 검사

고정10개 중 ZIP-01/03/04/06/07/08/09 PASS(7/10), ZIP-02/05/10 FAIL. 독립 ZIP 파서와 실제 Chrome으로 검증했다. 새 폴더에서 설치·타입·lint·단위673개·빌드 및 같은7/10을 재현했다. A의 모든 실행 회차 원본은 test-runs/에 보존했다.

## 남은 문제

ZIP-02 전체 다운로드 UI/현재 카드 snapshot, ZIP-05 개인 글꼴 UI·렌더링·템플릿 저장/복원, ZIP-10 busy/중복 실행 방지가 남았다. report/는 미완료 중간 보고서다. B 실행·본인 판단·공개URL 검증은 아직 하지 않았다.

## 다음 행동

다른 모델/서비스의 무료 B 새 대화에서 저장소와 이 원본만 받는다. 원본 SHA를 evidence/runs/run-001/handoff-check.json과 비교해 B-received.md에 실제 수신을 보존한다. 공통 요청 protocol/initial-request.md와 docs/b-resume.md를 읽고 A의 createArchive/importPersonalFont API에 UI를 연결한다. 이미지 전용 template-kit/TemplateLibrary/persistence와 renderer/측정의 업로드 글꼴 경로를 확인한다. 같은10개를 실행해 완성하고 실제 사용량·소스·문서 누락(없으면 없음)을 기록한다.

## 건드리지 말 것

동결된 protocol/·tests/acceptance/·실행 도구·package/lockfile·AGENTS.md, 검사/기대값을 바꾸지 않는다. 기존 편집·기본 글꼴 JSON·권리 고지를 유지한다. 검사 환경을 감지해 가짜 성공을 반환하지 않는다. 기존 private 원본/과제3 공개 정본 수정·push, 실제 사용자 자료·비밀값·원시 trace 공개를 하지 않는다.
