/**
 * VeryCheap 데모 데이터 API (Google Apps Script)
 *
 * 하는 일
 *  1) 웹 앱 GET 한 번으로 4개 탭(products, new_offers, used_offers, price_history)을 JSON으로 내려줌
 *     - Sheets API batchGet 한 번에 읽고, 결과를 CacheService에 나눠 저장 → 두 번째 요청부터 빠름
 *     - 시트를 고치면 onChange 트리거가 캐시를 비우고 버전을 올림
 *  2) data.json 스냅샷을 Google Drive에 저장 (정적 호스팅·Claude가 읽어가기용)
 *  3) 상품 이미지 썸네일을 받아 Drive의 images.json(data URI 모음)으로 저장
 *
 * 설치
 *  1. 시트에서 확장 프로그램 → Apps Script → 이 파일 내용을 Code.gs에 붙여넣기
 *  2. 왼쪽 "서비스 +" → Google Sheets API 추가 (식별자: Sheets)
 *  3. 함수 목록에서 setup 실행 → 권한 승인 (메뉴·트리거 생성)
 *  4. 배포 → 새 배포 → 유형: 웹 앱 / 실행 사용자: 나 / 액세스 권한: 모든 사용자 → URL 복사
 *
 * 사용 (배포 URL 뒤에 붙이기)
 *  ?                        전체 데이터 (4개 탭 + meta)
 *  ?sheets=products,new_offers   일부 탭만
 *  ?view=meta               행 수·버전·검증 결과만 (가벼움)
 *  ?view=images             이미지 data URI 맵 {product_id: "data:image/jpeg;base64,..."}
 *  ?refresh=1               캐시 무시하고 다시 읽기
 *  ?callback=fn             JSONP (fetch를 못 쓰는 환경용)
 */

const CONFIG = {
  SHEETS: ['products', 'new_offers', 'used_offers', 'price_history'],
  NUMERIC: {
    products: ['list_price'],
    new_offers: ['price', 'shipping_fee'],
    used_offers: ['price'],
    price_history: ['new_lowest', 'used_avg'],
  },
  CACHE_TTL_SEC: 21600,          // 6시간 (CacheService 최대값)
  CHUNK_CHARS: 90000,            // 캐시 값 1개 한도(100KB) 아래로 쪼갬
  DRIVE_FOLDER: 'VeryCheap_export',
  IMAGE_SIZE: '240:240',         // 다나와 이미지 URL의 shrink 파라미터
  IMAGE_BATCH: 20,               // fetchAll 한 번에 받을 개수
  TIME_BUDGET_MS: 5 * 60 * 1000, // Apps Script 6분 제한 전에 멈추고 이어서 하기
};

/* ===================== 웹 앱 ===================== */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.refresh === '1') clearCache_();

  let body;
  try {
    if (p.view === 'meta') body = JSON.stringify(getMeta_());
    else if (p.view === 'images') body = getImagesJson_();
    else body = getDataJson_(p.sheets);
  } catch (err) {
    body = JSON.stringify({ error: String(err && err.message || err) });
  }

  if (p.callback) {
    const cb = String(p.callback).replace(/[^\w.$]/g, '');
    return ContentService.createTextOutput(cb + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

/* ===================== 데이터 읽기 ===================== */

function getDataJson_(sheetsParam) {
  const want = sheetsParam
    ? String(sheetsParam).split(',').map(s => s.trim()).filter(s => CONFIG.SHEETS.indexOf(s) >= 0)
    : CONFIG.SHEETS;
  const key = 'data:' + want.join('+') + ':v' + getVersion_();
  const cached = cacheGet_(key);
  if (cached) return cached;

  const data = readSheets_(want);
  data.meta = buildMeta_(data);
  const json = JSON.stringify(data);
  cachePut_(key, json);
  return json;
}

/** Sheets API batchGet 한 번으로 여러 탭을 읽음. 서비스가 없으면 SpreadsheetApp으로 대체. */
function readSheets_(names) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let tables = {};

  if (typeof Sheets !== 'undefined') {
    const res = Sheets.Spreadsheets.Values.batchGet(ss.getId(), {
      ranges: names,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    (res.valueRanges || []).forEach((vr, i) => { tables[names[i]] = vr.values || []; });
  } else {
    names.forEach(n => {
      const sh = ss.getSheetByName(n);
      tables[n] = sh ? sh.getDataRange().getDisplayValues() : [];
    });
  }

  const out = {};
  names.forEach(n => { out[n] = toObjects_(n, tables[n]); });
  return out;
}

function toObjects_(sheet, rows) {
  if (!rows || !rows.length) return [];
  const head = rows[0].map(h => String(h).trim());
  const nums = CONFIG.NUMERIC[sheet] || [];
  const list = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(v => v === '' || v === null)) continue;
    const o = {};
    head.forEach((h, c) => {
      if (!h) return;
      let v = row[c] === undefined ? '' : row[c];
      if (typeof v === 'string') v = v.trim();
      if (nums.indexOf(h) >= 0) {
        if (v === '' || v === null) v = null;
        else {
          const n = Number(String(v).replace(/[^\d.\-]/g, ''));
          v = isFinite(n) ? Math.round(n) : null;
        }
      }
      o[h] = v;
    });
    if (String(o.product_id || '').indexOf('EX-') === 0) continue; // 템플릿 예시 행 제외
    list.push(o);
  }
  return list;
}

/* ===================== 메타·검증 ===================== */

function getMeta_() {
  const key = 'meta:v' + getVersion_();
  const cached = cacheGet_(key);
  if (cached) return JSON.parse(cached);
  const meta = buildMeta_(readSheets_(CONFIG.SHEETS));
  cachePut_(key, JSON.stringify(meta));
  return meta;
}

function buildMeta_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const counts = {};
  Object.keys(data).forEach(k => { if (Array.isArray(data[k])) counts[k] = data[k].length; });

  const checks = {};
  if (data.products) {
    const ids = {};
    let dup = 0;
    data.products.forEach(p => { if (ids[p.product_id]) dup++; ids[p.product_id] = true; });
    checks.duplicate_product_id = dup;
    ['new_offers', 'used_offers', 'price_history'].forEach(s => {
      if (data[s]) checks['orphan_' + s] = data[s].filter(r => !ids[r.product_id]).length;
    });
    ['new_offers', 'used_offers'].forEach(s => {
      if (data[s]) checks['price_missing_' + s] = data[s].filter(r => r.price == null).length;
    });
  }
  return {
    source: ss.getName(),
    spreadsheet_id: ss.getId(),
    exported_at: Utilities.formatDate(new Date(), 'Asia/Seoul', "yyyy-MM-dd'T'HH:mm:ssXXX"),
    version: getVersion_(),
    counts: counts,
    checks: checks,
  };
}

/* ===================== 캐시·버전 ===================== */

function getVersion_() {
  return PropertiesService.getScriptProperties().getProperty('DATA_VERSION') || '1';
}

function bumpVersion_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('DATA_VERSION', String(Number(getVersion_()) + 1));
}

function clearCache_() { bumpVersion_(); } // 버전이 바뀌면 이전 캐시 키는 쓰이지 않음

function cachePut_(key, text) {
  const cache = CacheService.getScriptCache();
  const parts = {};
  const n = Math.ceil(text.length / CONFIG.CHUNK_CHARS);
  for (let i = 0; i < n; i++) parts[key + ':' + i] = text.slice(i * CONFIG.CHUNK_CHARS, (i + 1) * CONFIG.CHUNK_CHARS);
  parts[key + ':n'] = String(n);
  try { cache.putAll(parts, CONFIG.CACHE_TTL_SEC); } catch (e) { /* 너무 크면 캐시 없이 동작 */ }
}

function cacheGet_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + ':n') || 0);
  if (!n) return null;
  const keys = [];
  for (let i = 0; i < n; i++) keys.push(key + ':' + i);
  const got = cache.getAll(keys);
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = got[key + ':' + i];
    if (part == null) return null;
    out += part;
  }
  return out;
}

/** 시트가 바뀌면 캐시 무효화 (setup에서 설치형 트리거로 연결) */
function onSheetChange(e) { clearCache_(); }

/* ===================== Drive 내보내기 ===================== */

/** data.json 스냅샷을 Drive 폴더에 저장 (같은 이름 파일은 덮어씀) */
function exportDataJsonToDrive() {
  clearCache_();
  const json = getDataJson_();
  const file = writeDriveFile_('data.json', json, 'application/json');
  SpreadsheetApp.getActive().toast('data.json 저장 완료: ' + file.getUrl(), 'VeryCheap', 8);
  return file.getUrl();
}

function writeDriveFile_(name, content, mime) {
  const folder = getFolder_();
  const it = folder.getFilesByName(name);
  if (it.hasNext()) { const f = it.next(); f.setContent(content); return f; }
  return folder.createFile(name, content, mime);
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CONFIG.DRIVE_FOLDER);
}

/* ===================== 이미지 썸네일 ===================== */

/**
 * products.image_url을 작은 크기로 받아 base64 data URI로 바꿔 Drive의 images.json에 모음.
 * 6분 제한 때문에 TIME_BUDGET_MS가 지나면 멈추고, 다시 실행하면 이어서 진행.
 */
function buildImageThumbnails() {
  const props = PropertiesService.getScriptProperties();
  const start = Date.now();
  const products = readSheets_(['products']).products;
  const map = JSON.parse(readDriveFile_('images.json') || '{}');
  const failed = JSON.parse(props.getProperty('IMG_FAILED') || '{}');

  const todo = products.filter(p => p.image_url && !map[p.product_id] && !failed[p.product_id]);
  for (let i = 0; i < todo.length; i += CONFIG.IMAGE_BATCH) {
    if (Date.now() - start > CONFIG.TIME_BUDGET_MS) break;
    const batch = todo.slice(i, i + CONFIG.IMAGE_BATCH);
    const reqs = batch.map(p => ({
      url: resizeUrl_(p.image_url),
      muteHttpExceptions: true,
      headers: { Referer: 'https://prod.danawa.com/' },
    }));
    const res = UrlFetchApp.fetchAll(reqs);
    res.forEach((r, k) => {
      const id = batch[k].product_id;
      const blob = r.getBlob();
      if (r.getResponseCode() === 200 && /^image\//.test(blob.getContentType())) {
        map[id] = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
      } else {
        failed[id] = r.getResponseCode();
      }
    });
    writeDriveFile_('images.json', JSON.stringify(map), 'application/json');
  }
  props.setProperty('IMG_FAILED', JSON.stringify(failed));

  const remain = products.filter(p => p.image_url && !map[p.product_id] && !failed[p.product_id]).length;
  const msg = '이미지 ' + Object.keys(map).length + '개 저장 · 실패 ' + Object.keys(failed).length + '개' +
    (remain ? ' · 남은 ' + remain + '개 (다시 실행하세요)' : ' · 완료');
  SpreadsheetApp.getActive().toast(msg, 'VeryCheap', 10);
  return msg;
}

/** 실패 목록 초기화 후 다시 시도할 때 */
function resetImageFailures() {
  PropertiesService.getScriptProperties().deleteProperty('IMG_FAILED');
}

function resizeUrl_(url) {
  if (/[?&]shrink=/.test(url)) return url.replace(/shrink=\d+:\d+/, 'shrink=' + CONFIG.IMAGE_SIZE);
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'shrink=' + CONFIG.IMAGE_SIZE;
}

function getImagesJson_() {
  const key = 'images:v' + getVersion_();
  const cached = cacheGet_(key);
  if (cached) return cached;
  const json = readDriveFile_('images.json') || '{}';
  cachePut_(key, json);
  return json;
}

function readDriveFile_(name) {
  const it = getFolder_().getFilesByName(name);
  return it.hasNext() ? it.next().getBlob().getDataAsString() : null;
}

/* ===================== 메뉴·설치 ===================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('VeryCheap')
    .addItem('API 캐시 새로고침', 'menuRefresh')
    .addItem('data.json을 Drive에 저장', 'exportDataJsonToDrive')
    .addItem('이미지 썸네일 만들기 (이어서 실행 가능)', 'buildImageThumbnails')
    .addItem('데이터 점검 결과 보기', 'menuShowMeta')
    .addToUi();
}

function menuRefresh() {
  clearCache_();
  getDataJson_();
  SpreadsheetApp.getActive().toast('캐시를 새로 만들었어요 (버전 ' + getVersion_() + ')', 'VeryCheap', 5);
}

function menuShowMeta() {
  const m = getMeta_();
  SpreadsheetApp.getUi().alert('VeryCheap 데이터 점검', JSON.stringify(m.counts, null, 1) + '\n\n' + JSON.stringify(m.checks, null, 1), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** 한 번만 실행: 시트 변경 시 캐시 무효화 트리거 설치 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'onSheetChange')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onSheetChange').forSpreadsheet(ss).onChange().create();
  onOpen();
  menuRefresh();
}
