# 새 폴더 재현

2026-10-27, 실행 소스 `d90a3bae21fc91fcdf04e4ca3ae3628d9820c6a8`을 별도 새 폴더에 로컬 clone했다. 기존 node_modules·브라우저 프로필·실제 사용자 자료를 복사하지 않았다.

환경: Node 24.19.0, npm 11.19.0, Python 3.12.14, macOS의 실제 Chrome headless. 검사 화면은 1440×1000이다. 실제 모바일·Safari 검증은 포함하지 않는다.

1. `npm ci --ignore-scripts`: 190개 패키지 설치 성공. 처음 시도한 추가 옵션 --offline은 새 프로젝트 캐시가 비어 ENOTCACHED로 실패했다. 문서의 일반 설치 명령으로 재시도해 성공했다. 오프라인 설치를 보장하지 않는다.
2. `npm run check`: 타입·ESLint·44파일 673개 단위 검사·정적 빌드 PASS. 기존 500kB 번들 경고는 유지된다.
3. `npm run test:acceptance -- --phase A-reproduction`: 동결 파일25개 검증과 합성 문서/TTF/OTF 사전 검증 PASS. 기능 검사10개 실제 실행, 7 PASS/3 FAIL. 실패 ID는 ZIP-02/05/10으로 UI 미연결 항목이다. 종료코드1을 정상 완료로 바꾸지 않았다.

실행 명령은 인수인계의 실행 절차와 같다. 이 재현은 AI A가 수행한 새 폴더 실행이며, AI B가 인수인계만으로 재개했다는 증거는 아직 아니다.
