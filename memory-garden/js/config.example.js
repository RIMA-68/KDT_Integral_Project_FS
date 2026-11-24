/* 기억 정원 · 공개 설정 (예시)
   실제 js/config.js 는 tools/write-config.mjs 가 환경 변수로 만들어요(저장소에는 올리지 않아요).
   여기 들어가는 값은 모두 "공개용"이에요. 브라우저에 그대로 보이는 값이라 숨길 수 없고, 숨길 필요도 없어요.
   - 카카오 JavaScript 키: 카카오 콘솔에 등록한 도메인에서만 동작
   - Supabase URL · publishable(anon) 키: 데이터 접근은 DB의 RLS·함수가 막아요
   비밀용 값(Supabase secret/service_role 키, DB 비밀번호)은 절대 여기에 넣지 마세요. 앱은 그 값 없이 동작해요.
   값이 비어 있으면 데모 모드(이 기기에만 저장, 예시 기억)로 열려요. */
window.MG_CONFIG = {
  kakaoJsKey: "",        // 카카오 개발자 콘솔 → 앱 키 → JavaScript 키
  supabaseUrl: "",       // https://xxxx.supabase.co
  supabaseKey: "",       // sb_publishable_... 또는 anon public 키
  unlockRadiusM: 50,     // 서버 설정(app_config)을 못 읽을 때만 쓰는 기본값
  maxAccuracyM: 60
};
