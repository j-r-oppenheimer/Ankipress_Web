# AnkiPress Web

Anki `.apkg` 파일을 브라우저에서 바로 2단 A4 PDF로 변환합니다.
파일은 업로드되지 않고 모든 처리가 브라우저에서 이루어집니다.

**👉 [바로 사용하기](https://j-r-oppenheimer.github.io/Ankipress-Web/)**

## 기능

- Basic · Cloze · Image Occlusion 카드 지원
- Anki 23.10+ (zstd·protobuf) 및 레거시 포맷 호환
- 20가지 컬러 테마
- 필드 선택 · 글꼴/크기 조절
- A4 2단 레이아웃

## 사용법

1. `.apkg` 파일을 올리기
2. 답으로 보여줄 필드, 테마, 글꼴 고르기
3. **PDF로 저장** → 브라우저 인쇄 대화상자에서 "PDF로 저장" 선택

## 로컬 실행

ES 모듈을 쓰므로 파일을 바로 열면 안 되고 간단한 서버가 필요합니다.

```bash
python -m http.server 8000
```

그 뒤 `http://localhost:8000` 접속.

## 커스텀 폰트 추가

`fonts/` 폴더에 폰트 파일을 넣고 `fonts/fonts.json`에 등록하면
웹사이트 글꼴 드롭다운에 자동으로 나타납니다. 자세한 방법은
[`fonts/README.md`](fonts/README.md) 참고.

## 기술 스택

순수 HTML/CSS/JS · 외부 라이브러리는 CDN 로드 (JSZip · sql.js · fzstd)

## 라이선스

MIT
