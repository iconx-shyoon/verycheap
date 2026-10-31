# VeryCheap 데모

새상품 최저가와 중고 시세를 한곳에서 비교하는 웹앱 데모입니다. 빌드 과정 없는 정적 사이트(HTML 1개 + 데이터 JSON)라 Vercel에 그대로 올라갑니다.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 웹앱 전체 (홈 · 상품 상세 · 내 지갑 · 팔기 · 데이터) |
| `data.json` | 구글 시트 `VeryCheap_demo_data_20261029` 스냅샷 (상품 180 · 새상품 878 · 중고 1,559 · 가격 이력 1,065) |
| `config.js` | `apiUrl`에 Apps Script 웹 앱 URL을 넣으면 시트에서 실시간으로 읽음 |
| `apps-script/Code.gs` | 시트에 붙이는 Apps Script (JSON API, 캐시, Drive 내보내기, 이미지 썸네일) |
| `vercel.json` | 캐시 헤더 |

## 데이터 불러오는 순서

1. 데이터 탭에서 올린 .xlsx (브라우저에 저장된 경우)
2. `config.js`의 `apiUrl` (또는 데이터 탭에서 저장한 URL)
3. `data.json`
4. 내장 샘플 데이터

## 로컬 실행

```bash
npx serve .
```

`index.html`을 파일로 바로 열면 브라우저가 `data.json` 읽기를 막을 수 있어요. 간단한 서버로 여세요.

## Vercel 배포

1. Vercel → Add New → Project → 이 GitHub 레포 Import
2. Framework Preset: **Other**, Build Command: 비움, Output Directory: 비움(루트)
3. Deploy

이후 `main`에 푸시할 때마다 자동 배포됩니다.

## 데이터 갱신

- 실시간: `apps-script/Code.gs`를 시트에 설치 → 웹 앱 배포 → URL을 `config.js`의 `apiUrl`에 넣고 푸시
- 스냅샷: 시트 메뉴 **VeryCheap → data.json을 Drive에 저장** → 받은 파일로 `data.json` 교체 후 푸시
