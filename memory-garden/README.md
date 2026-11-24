# 기억 정원 · Netlify 배포본

Figma **MG3 · 9 최종 마스터(낮)**와 **MG3 · 10(밤)**을 기준으로 만든 정적 웹사이트예요.
빌드 과정이 없어서 이 폴더를 그대로 올리면 바로 열려요.

## Netlify에 올리는 방법 (3분)

1. https://app.netlify.com/drop 에 접속해 로그인해요.
2. 이 폴더(`memory-garden-netlify`)를 통째로 화면에 끌어다 놓아요.
   zip을 쓰려면 먼저 압축을 풀고 **폴더**를 끌어다 놓아요.
3. 잠시 뒤 `https://무작위이름.netlify.app` 주소가 생겨요.
4. Site configuration → Change site name 에서 주소 앞부분을 바꿀 수 있어요. (예: `memory-garden`)
5. 고친 파일을 다시 올릴 때는 Deploys 탭 아래 칸에 폴더를 다시 끌어다 놓아요.

> 위치 권한은 https 주소에서만 동작해요. Netlify 주소는 자동으로 https라 따로 할 일이 없어요.

### 배포 후 한 가지만 고치면 좋아요
카카오톡·인스타 링크 미리보기는 그림 주소가 전체 주소여야 잘 나와요.
`index.html` 13번째 줄 `assets/img/og-generic.png` 앞에 내 사이트 주소를 붙여 다시 올려 주세요.
예: `https://memory-garden.netlify.app/assets/img/og-generic.png`

## 화면 주소

| 주소 | 화면 |
|---|---|
| `#/welcome` | 첫 화면 · 위치 안내 |
| `#/` | 지도 + 근처의 기억 목록 |
| `#/m/아이디` | 기억 보기 (잠김 · 열 수 있음 · 발견 · 열람 · 사라진 기억) |
| `#/plant/1`~`3` | 기억 심기 3단계 |
| `#/garden` | 내 정원 · 정원 자수 · 근처 도안 · 화면 테마 |
| `#/avatar` | 내 캐릭터 꾸미기 |
| `#/s/아이디` | 공유 링크로 들어온 화면 |

예시 기억 아이디: `toast`(34m, 열 수 있음), `sunset`, `bridge`(이미 모음), `alley`(142m, 잠김)

## 낮과 밤
한 사이트 안에서 테마만 바뀌어요. 내 정원 오른쪽 위 해 아이콘에서
시스템 설정 · 낮(Dusk Paper) · 밤(Night Garden) · 시간대 자동 중에 고를 수 있어요.

## 데모 패널
노트북처럼 넓은 화면(860px 이상)에서는 오른쪽에 데모 패널이 보여요.
화면 이동, 테마, 위치 허용/거부, 정확도 낮음, 데이터 상태(로딩 · 빈 · 오류),
사라진 기억 만들기, 초기화를 눌러 볼 수 있어요. 휴대폰에서는 보이지 않아요.

## 폴더 구조
```
index.html        앱 한 장 (해시 주소로 화면 이동)
404.html          없는 주소일 때
netlify.toml      Netlify 설정 (보안 헤더 · 캐시)
css/tokens.css    색 · 글꼴 · 간격 (낮 기준)
css/app.css       기본 화면
css/v3.css        MG3 추가 화면 + 밤 테마 값
js/data.js        예시 기억 데이터
js/brand.js       기억의 씨앗 · 꽃 · 정원 자수 그래픽
js/app.js         화면과 동작
js/avatar.js      캐릭터 꾸미기 (원본 그림을 잘라 낸 파츠를 겹쳐 그림)
assets/avatar/    캐릭터 파츠 38개 (Figma 원본에서 그대로 잘라 냄)
assets/fonts/     Pretendard · Galmuri11 (둘 다 OFL, 라이선스 파일 포함)
```

## 알아 두면 좋은 점
- 서버가 없는 시연용이에요. 심은 기억 · 모은 기억 · 캐릭터는 그 기기 브라우저에만 저장돼요.
- 다른 사람의 기억, 지도, 거리는 예시 데이터예요. 실제 서비스로 이으려면 `js/data.js`를 서버 응답으로 바꾸면 돼요.
- 열람 반경 50m는 아직 확정되지 않은 설정값이라 `js/data.js`의 `unlockRadius` 한 곳에서 바꿀 수 있어요.
