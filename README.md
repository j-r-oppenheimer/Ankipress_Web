# AnkiPress Web

Anki 덱(`.apkg`)을 인쇄용 **A4 2단 PDF**로 변환하는 웹 애플리케이션입니다.
모든 처리는 브라우저 안에서 이루어지며, 파일은 어떤 서버로도 전송되지 않습니다.

**[바로 사용하기 →](https://j-r-oppenheimer.github.io/Ankipress-Web/)**

---

## 주요 기능

| 구분 | 내용 |
|---|---|
| 카드 유형 | Basic · Cloze · Image Occlusion |
| 덱 포맷 | Anki 23.10+ (`collection.anki21b`, zstd·protobuf) 및 레거시 포맷 (`anki21`, `anki2`) |
| 테마 | 컬러 테마 20종 + 일러스트 테마 3종 (체스 · 테니스 · 스벤) |
| 서식 | 답 필드 선택, 글꼴 선택, 글자 크기 조절 (7–14pt), 덱 제목 표시 여부 |
| 레이아웃 | A4 2단 구성, 덱별 페이지 분리, 페이지 번호 |
| 개인정보 | 업로드·저장 없음 — 100% 클라이언트 사이드 처리 |

## 사용 방법

1. `.apkg` 파일을 끌어다 놓거나 클릭해서 선택합니다.
2. 답으로 표시할 필드, 테마, 글꼴과 글자 크기를 고릅니다.
3. **PDF로 저장**을 누르고, 인쇄 대화상자에서 대상을 **"PDF로 저장"**으로 지정합니다.

> **권장 환경:** Chrome, Edge 등 Chromium 기반 브라우저의 최신 버전.
> 페이지 번호와 배경 인쇄가 가장 정확하게 반영됩니다.

## 로컬 실행

ES 모듈을 사용하므로 `index.html`을 파일로 직접 열면 동작하지 않습니다.
정적 파일 서버를 통해 실행하세요.

```bash
python -m http.server 8000
```

이후 브라우저에서 `http://localhost:8000`에 접속합니다.
별도의 빌드 과정이나 패키지 설치는 필요하지 않습니다.

## 프로젝트 구조

```
.
├── index.html
├── css/
│   ├── app.css              # 앱 화면 스타일
│   └── print.css            # 미리보기·인쇄 공용 레이아웃
├── js/
│   ├── app.js               # UI 및 전체 흐름 제어
│   ├── apkg-parser.js       # .apkg 압축 해제 및 컬렉션 DB 파싱
│   ├── card-processor.js    # HTML 정리, Cloze 변환
│   ├── image-occlusion.js   # Image Occlusion 카드 렌더링
│   ├── render.js            # 인쇄용 HTML 생성
│   ├── themes.js            # 테마 정의
│   └── icons.js             # 일러스트 테마 아이콘 로딩 및 배경 패턴 생성
├── icons/                   # 일러스트 테마 SVG (테마별 하위 폴더)
└── fonts/                   # 커스텀 폰트 및 fonts.json
```

## 커스터마이징

### 폰트 추가

`fonts/` 폴더에 폰트 파일을 넣고 `fonts/fonts.json`에 등록하면 글꼴 목록에 자동으로 표시됩니다.
자세한 내용은 [`fonts/README.md`](fonts/README.md)를 참고하세요.

### 테마 추가

테마는 `js/themes.js`의 `THEMES` 객체에 정의합니다.

- **컬러 테마** — `title_color`, `question_bg`, `answer_bg`, `answer_border` 네 가지 색상만 지정하면 됩니다.
- **일러스트 테마** — 위 색상에 더해 `page_bg`, `icons`, `pattern` 등을 지정합니다.
  아이콘은 `icons/<테마>/<이름>.svg` 경로에 두며, 테마 색상이 적용되도록 `fill`/`stroke`에 `currentColor`를 사용해야 합니다.
  사용 가능한 옵션은 `js/themes.js` 상단 주석에 정리되어 있습니다.

## 기술 스택

- 순수 HTML · CSS · JavaScript (ES Modules), 프레임워크·빌드 도구 없음
- 외부 라이브러리 (CDN)
  - [JSZip](https://stuk.github.io/jszip/) — `.apkg` 압축 해제
  - [sql.js](https://sql.js.org/) — SQLite 컬렉션 조회 (WebAssembly)
  - [fzstd](https://github.com/101arrowz/fzstd) — Anki 23.10+ zstd 압축 해제
- PDF 생성은 브라우저 기본 인쇄 기능(`@page`, CSS 다단 레이아웃)을 사용합니다.
