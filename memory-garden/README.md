# 기억 정원 · 모바일 웹

장소에 사진과 짧은 이야기를 심고, 그 자리에 간 사람이 다른 사람의 기억을 발견하는 위치 기반 기록 서비스예요.
Figma **MG3 · 9(낮)**, **MG3 · 10(밤)** 디자인을 그대로 쓰고, 실제 지도·위치·서버 저장을 붙였어요.

| | 쓰는 것 | 고른 이유 |
|---|---|---|
| 지도 | **카카오맵 JavaScript SDK** | 국내 지명·건물 정보가 가장 익숙하고, 하루 30만 건까지 무료. 키는 등록한 도메인에서만 동작 |
| 저장·인증 | **Supabase** (Postgres · Storage · Auth) | DB·사진·인증이 한곳에, 무료 플랜으로 충분. 권한을 DB 규칙(RLS)과 함수로 서버에서 확인 |
| 로그인 | **카카오 로그인** (Supabase Kakao 공급자) | 국내 사용자에게 가장 익숙. 둘러보기는 익명, **심기·처음 열기 때 로그인**. 익명 기록은 계정에 이어 붙임(linkIdentity) |
| 화면 | 기존 바닐라 JS 그대로 | 빌드 도구 없이 정적 호스팅, 디자인·흐름 유지 |

설정이 비어 있으면 **데모 모드**(이 기기 브라우저에만 저장, 내 위치 주변에 예시 기억)로 열리고,
카카오 키가 없거나 막히면 지도는 **OpenStreetMap**으로 대신 보여 줘요.

---

## 처음 한 번 설정하기

### 1. Supabase
1. supabase.com → New project (Region: Northeast Asia (Seoul))
2. **SQL Editor → New query**에 [`supabase/schema.sql`](supabase/schema.sql) 전체를 붙여 넣고 **Run**
3. **Authentication → Sign In / Providers**
   - **Allow anonymous sign-ins** 켜기 (둘러보기용)
   - **Allow manual linking** 켜기 (익명 기록을 카카오 계정에 이어 붙이기)
   - **Kakao** 공급자 켜기: Client ID = 카카오 **REST API 키**, Client Secret = 카카오 **Client Secret** (비밀용, 여기에만 넣어요)
4. **Authentication → URL Configuration**: Site URL = 배포 주소, Redirect URLs에 배포 주소와 `http://localhost:8080` 추가
5. **Project Settings → API Keys**에서 Project URL과 **publishable(anon)** 키 확인

### 2. 카카오
1. developers.kakao.com → 내 애플리케이션 → 앱 추가
2. 카카오맵 사용 설정 ON
3. 플랫폼(Web) 사이트 도메인에 배포 주소와 `http://localhost:8080` 등록
4. **JavaScript 키** 확인 (지도용, 공개)
5. 카카오 로그인 켜기 → Redirect URI에 `https://<프로젝트>.supabase.co/auth/v1/callback` 등록
6. 동의 항목: 닉네임·프로필 사진. 이메일은 "개인 개발자 비즈 앱" 전환 후 선택 동의(서비스에 꼭 필요하진 않아요)
7. 보안 → **Client Secret** 생성·사용 (비밀용 → Supabase에만)

### 3. Netlify
- Site configuration → Build & deploy: Branch `team`, Base directory `memory-garden`, Publish directory `memory-garden`
  (빌드 명령은 `netlify.toml`에 있어요: `node tools/write-config.mjs`)
- Site configuration → **Environment variables**에 세 개 추가

| 이름 | 값 |
|---|---|
| `MG_KAKAO_JS_KEY` | 카카오 JavaScript 키 |
| `MG_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `MG_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` 또는 anon 키 |

- Deploys → **Trigger deploy**. 배포 주소를 카카오 사이트 도메인에 꼭 추가해요.
- 카카오톡 링크 미리보기용으로 `index.html`의 `og:image`를 전체 주소로 바꾸면 좋아요.

## 키 관리 (공개용 · 비밀용)
- **공개용**: 카카오 JavaScript 키, Supabase URL, publishable(anon) 키. 브라우저에 보이는 게 정상이고, 대신
  카카오는 도메인 제한, Supabase는 DB 규칙이 막아요. 저장소에는 올리지 않고 Netlify 환경 변수 → 빌드 때 `js/config.js` 생성.
- **비밀용**: Supabase secret(service_role) 키, DB 비밀번호, 카카오 Client Secret. **앱은 쓰지 않아요.** 카카오 Client Secret은 Supabase 대시보드에만 넣어요. Netlify·저장소·채팅 어디에도 넣지 마세요.
  `tools/write-config.mjs`는 비밀 키가 섞이면 빌드를 멈춰요. `.env`, `js/config.js`는 `.gitignore`에 들어 있어요.

## 권한은 서버에서 확인해요
화면에서 숨기는 것과 별개로, 데이터를 주는 단계에서 막아요 (`supabase/schema.sql`).
- 다른 사람의 `memories` 행은 직접 읽을 수 없어요(RLS: 내 행만). 타인 기억은 정해진 DB 함수로만 받아요.
- **비공개 기억**: 작성자 외에는 존재·위치·내용 모두 받을 수 없어요. 사진도 Storage 규칙으로 막혀요.
- **발견 전 공개 기억**: 장소명·힌트·대략 위치(약 10m 단위)·거리만. 제목·사진·본문·작성자는 서버가 보내지 않아요.
- **로그인**: 심기 `plant_memory()`와 처음 열기 `open_memory()`는 서버가 익명이 아닌지(`is_member()`) 확인해요. 둘러보기는 익명도 가능.
- **처음 열기** `open_memory()`: 서버가 현재 위치와 기억의 거리(반경), 위치 오차(정확도)를 확인하고 통과해야 발견 기록이 생겨요.
  그 뒤에는 어디서든 다시 볼 수 있어요. 작성자가 비공개로 바꾸거나 지우면 다시 볼 수 없고 정원에는 비식별 흔적만 남아요.
- 공유 링크(`#/s/아이디`)도 같은 함수를 써서 현장 제한을 우회할 수 없어요.
- 좌표·사진 경로·작성자는 심은 뒤 바꿀 수 없어요. 사진은 올리기 전에 1280px JPEG로 줄여 EXIF(촬영 위치 등)가 지워져요.
- 위치는 거리 계산과 서버 확인에만 쓰고, 이동 기록은 저장하지 않아요.

> 한계: 위치는 휴대폰이 알려 주는 값이라 위치 조작 앱으로 속일 수 있어요. 막으려면 별도 부정 사용 탐지가 필요해요.

## 열람 반경 바꾸기
Supabase **Table Editor → app_config**에서 값을 바꾸면 앱과 서버에 바로 적용돼요(재배포 필요 없음).

| key | 기본값 | 뜻 |
|---|---|---|
| `unlock_radius_m` | 50 | 타인 기억을 처음 열 수 있는 반경(m) · 확정 아님 |
| `max_accuracy_m` | 60 | 위치 오차가 이보다 크면 열기·심기를 막아요(m) |
| `nearby_km` | 3 | 지도에 불러오는 범위(km) |
| `require_login` | 1 | 1이면 심기·처음 열기에 로그인 필요, 0이면 익명도 가능 |

## 내 컴퓨터에서 실행
```bash
cd memory-garden
cp .env.example .env      # 값 채우기 (비워 두면 데모 모드)
node tools/write-config.mjs
python3 -m http.server 8080   # → http://localhost:8080
```
위치 권한은 `https` 또는 `localhost`에서만 동작해요. 휴대폰으로 시험할 땐 Netlify 배포 주소를 쓰세요.

## 화면 주소
| 주소 | 화면 |
|---|---|
| `#/welcome` | 첫 화면 · 위치 안내 |
| `#/` | 지도 + 근처의 기억 |
| `#/m/아이디` | 기억 보기 (잠김 · 열 수 있음 · 발견 · 열람 · 사라진 기억 · 내 기억) |
| `#/plant/1`~`3` | 기억 심기 (사진 → 이야기 → 장소 이름·힌트·공개 범위) |
| `#/garden` | 내 정원 · 정원 자수 · 근처 도안 · 화면 테마 · 이름 바꾸기 |
| `#/avatar` | 내 캐릭터 꾸미기 |
| `#/s/아이디` | 공유 링크 |

넓은 화면(860px 이상)에는 오른쪽에 데모 패널이 보여요. 실서비스 모드에서는 화면 이동·테마·데이터 상태만 남아요.

## 폴더 구조
```
index.html            앱 한 장 (해시 주소로 화면 이동)
netlify.toml          빌드(설정 파일 생성) · 보안 헤더 · 캐시
tools/write-config.mjs  환경 변수 → js/config.js (공개용 값만)
supabase/schema.sql   표 · 권한 규칙(RLS) · 열람 함수 · 사진 저장소 규칙
js/config.example.js  공개 설정 예시
js/geo.js             현재 위치(watchPosition) · 거리 · 방향
js/map.js             카카오맵 / OpenStreetMap 어댑터
js/api.js             Supabase 연결 · 데모 저장소
js/app.js             화면과 동작
js/brand.js           기억의 씨앗 · 꽃 · 정원 자수 그래픽
js/avatar.js          캐릭터 꾸미기
js/data.js            데모 모드 예시 기억
css/                  tokens(색·글꼴) · app · v3(밤 테마) · live(지도·입력)
vendor/               supabase-js 2.49.4 · Leaflet 1.9.4 (MIT·BSD, 라이선스 포함)
assets/               그림 · 캐릭터 파츠 · 글꼴(OFL)
```

## 남은 일
- 로그인 전(익명)에는 브라우저 데이터를 지우면 둘러본 기록이 사라져요(심기·열기는 로그인 후라 안전)
- 신고·차단, 부적절한 사진 검수
- 재공개 시 예전 발견자 권한: 지금은 다시 살아나요(정책 미확정)
- 위치 조작 탐지, 요청 횟수 제한 강화(지금은 심기만 1분 5개 제한)
