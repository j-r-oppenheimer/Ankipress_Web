# 폰트 추가하기

이 폴더에 `.ttf` / `.otf` / `.woff` / `.woff2` 파일을 넣고 `fonts.json`에 등록하면
웹사이트 글꼴 드롭다운에 자동으로 추가됩니다.

## 사용법

1. 폰트 파일을 이 폴더(`fonts/`)에 업로드
2. `fonts.json`을 열어서 항목 추가:

```json
[
  {
    "family": "내가 올린 폰트",
    "file": "MyFont.ttf"
  },
  {
    "family": "Pretendard Variable",
    "file": "PretendardVariable.woff2",
    "weight": "100 900",
    "style": "normal",
    "label": "Pretendard Variable"
  }
]
```

## 필드 설명

| 필드     | 필수 | 설명                                               |
|----------|:---:|----------------------------------------------------|
| `family` | ✓   | CSS `font-family`로 쓸 이름 (아무거나 정해도 됨)    |
| `file`   | ✓   | `fonts/` 폴더 안에 있는 실제 파일 이름              |
| `label`  |     | 드롭다운에 표시될 이름 (생략하면 `family` 사용)     |
| `weight` |     | `"400"`, `"700"`, `"100 900"` 등 (기본 `"normal"`)  |
| `style`  |     | `"normal"` / `"italic"` (기본 `"normal"`)           |

커밋 후 GitHub Pages가 갱신되면 (1-2분) 브라우저에서 바로 선택 가능합니다.
