# 제공 글꼴의 출처와 이용 조건

이 프로젝트는 Google Fonts 공식 저장소의 커밋 `47d54ca1ebb14fd864695f1d39dc734f39017c33`에서 아래 글꼴을 원본 바이트 그대로 내려받아 로컬에 포함한다. 글꼴을 변환·서브셋·수정하지 않았다. 브라우저 실행 중 외부 글꼴 서버에 접속하지 않는다.

| 글꼴          | 포함한 실제 버전 | 저작권 표시                                                                                            | 파일·원문                                                                                                                                                            |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Noto Sans KR  | 2.004-H2         | Copyright 2014–2021 Adobe; Reserved Font Name ‘Source’                                                 | [로컬 폴더](apps/demo/public/assets/fonts/notosanskr/) · [공식 원본](https://github.com/google/fonts/tree/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/notosanskr)   |
| Noto Serif KR | 2.003-H1         | OFL 원문: Copyright 2012 Google Inc. All Rights Reserved. 글꼴 내장 표시: © 2017–2024 Adobe            | [로컬 폴더](apps/demo/public/assets/fonts/notoserifkr/) · [공식 원본](https://github.com/google/fonts/tree/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/notoserifkr) |
| Jua           | 1.001            | OFL 원문: Copyright 2018 The Jua Project Authors. 내장 표시: Copyright 2018 The BM JUA Project Authors | [로컬 폴더](apps/demo/public/assets/fonts/jua/) · [공식 원본](https://github.com/google/fonts/tree/47d54ca1ebb14fd864695f1d39dc734f39017c33/ofl/jua)                 |

세 글꼴은 모두 SIL Open Font License 1.1로 제공된다. 글꼴 파일과 함께 각 폴더의 **OFL.txt 전문, 원본 저작권 표시, METADATA.pb**를 보존한다. 출처 커밋·다운로드 URL·SHA-256·바이트 크기·내장 버전과 저작권은 [manifest.json](apps/demo/public/assets/fonts/manifest.json)에 기록한다. Noto Serif KR와 Jua의 라이선스 원문과 내장 표시가 서로 다르므로 둘 다 보존한다.

라이선스에 따라 앱과의 번들 배포, 웹 임베딩, 상업적 디자인 작업에 사용할 수 있다. 글꼴 파일 자체를 단독 판매할 수 없고, 글꼴을 재배포할 때 저작권과 라이선스 원문을 함께 제공해야 한다. 수정판은 원문의 Reserved Font Name 조건 등을 별도로 확인해야 한다. 현재 파일은 수정하지 않은 원본이다. 글꼴로 그린 PNG 등 결과물에 OFL을 적용하거나 결과물에 저작권 문구를 넣을 의무는 없다. 근거: 각 폴더의 OFL 1.1 전문과 [SIL 공식 FAQ 1.1, 1.1.1, 1.3, 1.4](https://openfontlicense.org/ofl-faq/).

글꼴은 운영체제 설치 여부와 관계없이 로컬 FontFace로 불러온다. Sans·Serif의 실제 가변 굵기를 사용하며 Jua는 제공된 400 굵기로 그린다. 기본 글꼴 로드가 실패하면 오류를 표시하고 편집기를 시작하지 않는다. 문자표 실측에서 Sans·Serif는 현대 한글 완성형 11,172자를 포함하지만, Jua 원본에는 이 중 2,367자가 있다. **주아가 지원하지 않는 글자는 함께 포함한 Noto Sans KR로 표시한다.** 이는 UI에도 안내하며, 한글 결과가 운영체제의 설치 글꼴에 따라 달라지는 것을 막는다. 세 글꼴 모두 모든 유니코드 문자(예: 컬러 이모지)의 도형을 제공하지는 않는다.

`python scripts/fetch-fonts.py`는 고정한 공식 커밋의 원본 파일들을 복구하기 위한 수동 개발 도구다. 앱 실행·빌드·다운로드 기능에서 실행하지 않는다.

## 추가 글꼴 10종

추가 파일 10종 모두 공식 배포 파일과 SHA-256이 일치한다. 실제 원본·버전·저작권·공식 페이지·해시는 [추가 명세](apps/demo/public/assets/fonts/additional-manifest.json)에 보존한다. 검증과 출처 확인일은 2026-10-21이다.

2026-10-22 첫 배포의 실제 URL 점검에서 온글잎 9종의 한글 파일명 경로가 404를 반환하여, 배포 파일명만 `Ownglyph…-Regular.ttf`의 ASCII 이름으로 바꿨다. TTF 바이트와 SHA-256·내장 글꼴 이름·저작권·라이선스는 변경하지 않았다. 명세의 `sourceFilename`에 공식 원본 한글 파일명을 보존하고, `filename`·`path`는 현재 배포 이름을 기록한다. 앱의 글꼴 family·표시명도 그대로 유지하므로 기존 템플릿의 글꼴 참조는 바뀌지 않는다.

온글잎 현자체·공부잘하자나·해솜체·이선호·류류체·부흥지혜쌤체·안될과학약체·위씨리스트·풋사과레코드는 **온글잎 오리지널 폰트 라이선스**다. OFL로 분류하지 않는다. [공식 무료폰트 페이지의 라이선스 표시](https://www.ownglyph.com/font)에서 웹폰트·SW 임베딩과 배포를 허용하고, 파일 수정·유료 판매를 금지함을 확인했다. TTF 원본을 변환·서브셋·개작하지 않았으며 [공식 표시 내용의 사본](apps/demo/public/assets/fonts/licenses/OWNGLYPH-LICENSE.txt)과 글꼴별 내장 저작권을 보존한다. 저작재산권은 (주)보이저엑스와 각 손글씨 제공자에게 있다. 업체의 인쇄·광고물 이미지 프로모션 활용 조항도 사본에 포함한다. 앱이 사용자 이미지를 업체에 자동 전송하는 기능은 없다.

춤추는사람들은 **SIL OFL 1.1**이다. [Hada Type 공식 페이지](https://hada-type.com/dancing-peoples)의 v2026.10.21 TTF ZIP에 포함된 파일과 동일하다. [LICENSE 전문](apps/demo/public/assets/fonts/licenses/DancingPeoples-LICENSE.txt)·[전체 저작권 고지](apps/demo/public/assets/fonts/licenses/DancingPeoples-COPYRIGHT.txt)·[원본 사용 안내](apps/demo/public/assets/fonts/licenses/DancingPeoples-WEBFONT-USAGE.txt)를 그대로 보존한다. Hada Type 외 원본 구성요소의 저작권 표시도 제거하지 않는다. OFL 조건으로 웹 임베딩·배포·상업적 결과물 이용이 가능하며 파일 단독 판매는 금지한다.

추가 10종은 선택하거나 문서가 참조할 때 로컬 FontFace로 불러온다. 원본 regular 400을 사용하고 미포함 글자는 동봉한 Noto Sans KR로 표시한다. 춤추는사람들의 DANC 축은 원본 기본값 50이다. 글꼴 변경은 파일의 도형이나 이름 테이블 수정 없이 수행한다. 총 추가 파일 크기는 51,720,368바이트이며 시작 때 한꺼번에 불러오지 않는다.
