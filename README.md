# VeryCheap 데모

새상품 최저가와 중고 시세를 한곳에서 비교하는 웹앱 데모입니다. 빌드 과정 없는 정적 사이트(HTML 1개 + 데이터 JSON)라 Vercel에 그대로 올라갑니다.

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 웹앱 전체 (홈 · 상품 상세 · 내 지갑 · 팔기 · 데이터) |
| `data.json` | 구글 시트 `VeryCheap_demo_data_20261029` 스냅샷 (상품 180 · 새상품 878 · 중고 1,559 · 가격 이력 1,065) |
| `config.js` | 이미지 프록시 경로(`imgProxy`), 선택적으로 Apps Script URL(`apiUrl`) |
| `api/img.js` | 상품 이미지 프록시 (Vercel Function, 30일 CDN 캐시) |
| `apps-script/Code.gs` | 시트에 붙이는 Apps Script (JSON API, 캐시, Drive 내보내기, 이미지 썸네일) |
| `vercel.json` | 캐시 헤더 |

## 데이터 불러오는 순서

1. `config.js`의 `apiUrl` (설정한 경우)
2. `data.json`
3. 내장 샘플 데이터

## 상품 이미지

`images.json`(상품 ID → 이미지 주소)이 있으면 그걸 먼저 쓰고, 없으면 원본 이미지 URL을 `/api/img` 프록시로 불러와요. 둘 다 실패하면 카테고리 아이콘을 보여줘요.

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

## 쿠팡 파트너스 연동

1. **가입 3단계 "웹사이트 목록"**: Vercel 대표 주소(예: `https://verycheap-xxx.vercel.app`)를 넣어요.
2. **가입 후 링크 만들기**: 파트너스 대시보드 → 링크 생성에서 쿠팡 상품 URL을 넣으면 `https://link.coupang.com/a/…` 링크가 나와요.
3. **`coupang.json`에 넣기**: `coupang.example.json` 형식대로 `items`에 추가해요.
   - `product_id`를 우리 상품 ID(예: `DIG-010`)와 맞추면 그 상품 상세에 "쿠팡에서 보기" 버튼이 생겨요.
   - `product_id` 없이 넣으면 홈의 "쿠팡 오늘의 최저가"에만 보여요.
   - 배너를 쓰려면 파트너스 배너 코드의 iframe `src` 주소를 `banner_iframe`에 넣어요.
4. **푸시 → 배포 → 스크린샷**: 홈의 쿠팡 영역(고지 문구 포함)이 보이게 캡처해서 파트너스 마이페이지에 올리면 최종 승인 심사에 써요.

`items`가 비어 있으면 쿠팡 영역은 화면에 나오지 않아요. 고지 문구("쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다")는 하단과 쿠팡 영역에 항상 표시돼요.
