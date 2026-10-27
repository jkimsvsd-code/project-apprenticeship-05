# 과제5 대화가 끊겨도 이어지는 짤 카드 스튜디오

사용자 자원 전체, 미저장 현재 카드, 저장 템플릿 전체, 개인 글꼴 전체를 ZIP으로 내보내는 기능을 서로 다른 두 AI가 순서대로 완성한다. AI A는 종료했고 기능 검사는 7/10 통과다. 개인 글꼴·다운로드 UI 연결을 다른 모델/서비스의 AI B가 이어받아야 한다. 최종 기능 완료나 공개 제출 완료 상태가 아니다.

## 시작

Node 24.x, npm 11.x, Python 3, Chrome 또는 Playwright Chromium이 필요하다.

```sh
npm ci --ignore-scripts
npm run dev
npm run check
npm run freeze:verify
npm run test:acceptance -- --phase B
node tools/progress/status.mjs
node tools/report/build.mjs
node tools/preflight/check.mjs
```

기본 검사는 설치된 Chrome을 사용한다. 다른 설치에서는 PLAYWRIGHT_CHANNEL을 지정한다. 원시 ZIP·브라우저 결과는 .local/에 보관하고, 익명화한 회차 요약만 evidence/에 기록한다. Python 경로는 PYTHON으로 지정할 수 있다.

## 기준과 증거

- protocol/zip-spec.md: 사용자 승인 동작
- protocol/acceptance-cases.json: 고정 검사 10개
- protocol/limits.json: AI별 60분/12요청 및 글꼴10MB/아카이브100MB
- protocol/frozen-files.json: 동결 해시와 시작 소스
- evidence/runs/run-001/: 실제 실행 결과·사용량·버전
- handoff/runs/run-001/A-to-B.md: B가 읽을 원본 인수인계

동결 후 protocol/ 및 tests/acceptance/와 고정 실행 도구를 변경하지 않는다. 검사 실패는 미완료로 기록한다. B는 다른 모델/서비스의 새 대화에서 저장소와 인수인계만 받는다.

## 기반과 권리

과제3의 검토된 [공개 소스 스냅샷](https://github.com/jkimsvsd-code/jjal-card-studio-portfolio/tree/70bcebd60cca76b08821aa7aec62fafd55f22c18)을 가져와 독립된 로컬 Git 이력으로 작업한다. 기존 실행 코드는 private 원본 커밋 394af73d와 대조했다. private 원본 Git 이력이나 실제 사용자 자료는 포함하지 않는다.

기존 코드의 권리는 COPYRIGHT.md, 소재/글꼴은 THIRD-PARTY-NOTICES.md를 따른다. tests/acceptance/fixtures는 직접 만든 합성 자료이며 별도 고지를 따른다. docs/portfolio 및 기존 검사 문서는 과제3의 당시 기록이며 과제5의 통과 증거로 합산하지 않는다.

## AI A 종료 결과

- 동결: task05-freeze / 815aa41b, 25개 파일 해시 유지
- 시간: 1,046.944초(약17분27초), 작업 지시1회. 사전 준비 시간은 별도 기록
- 고정 기능 검사: 7/10 PASS, 남은 ID ZIP-02/05/10
- 기존 타입/lint/단위673개/빌드: PASS
- 새 폴더 설치와 같은7/10 재현: 완료
- B와 공개URL 검증: 아직 시작/완료하지 않음

인수인계는 handoff/runs/run-001/A-to-B.md, 상세 구현 경로는 docs/b-resume.md다. task05-A-end에서 `node tools/handoff/export.mjs`를 실행하면 .local/handoff/run-001에 Git bundle과 원본 문서·전달 해시가 준비된다. 실제 B 수신은 별도로 확인한다.
