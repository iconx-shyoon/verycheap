// 배포 설정
window.VC_CONFIG = {
  // 상품 이미지를 우리 서버(/api/img)를 거쳐 불러와요. 외부 이미지 서버가 직접 연결을 막아도 보이게 하는 장치예요.
  imgProxy: '/api/img?u=',
  // Apps Script 웹 앱 URL(…/exec)을 넣으면 시트에서 실시간으로 읽어요. 비워두면 data.json을 써요.
  apiUrl: ''
};
