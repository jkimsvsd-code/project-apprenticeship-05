# 합성 시험 자료

PNG와 TTF/OTF는 generate-fixtures.py에서 처음부터 만든 시험 자료다. 실제 사용자 파일이나 외부 글꼴 원본을 포함하지 않는다. 이 합성 시험 자료에 CC0-1.0을 적용한다. 기존 프로젝트 코드의 권리 조건을 바꾸지 않는다.

sample.ttf / sample.otf는 A·가·공백을 가진 정상 글꼴이다. invalid.ttf는 의도적으로 잘못된 입력 자료이며 제품 코드에 고의 오류를 넣은 것이 아니다. document.json은 고정 문서, templates-101.json은 101개 템플릿이다. 큰 경계 파일은 고정 원본에 NUL padding을 더해 런타임에 생성한다.
