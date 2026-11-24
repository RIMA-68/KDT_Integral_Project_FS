/* 기억 정원 · 프로토타입 데이터
   실제 서비스에서는 이 파일 대신 API 응답이 들어옵니다.
   좌표는 일러스트 지도(900×1200) 위의 픽셀이며, 1px = 0.8m 로 계산합니다. */
window.MG_DATA = {
  scale: 0.8,          // m per px
  unlockRadius: 50,    // m · 디자인 기준값. 실서비스에서는 시스템 설정값으로 관리(확정 아님)
  accuracy: 12,        // m · 현재 위치 오차(정확도) — 열람 반경과 별개
  me: { x: 430, y: 640, place: "망원동 · 한강공원 입구" },
  avatars: [
    { id: "char-lavender", name: "라벤더 니트" },
    { id: "char-hoodie", name: "차콜 후드" },
    { id: "char-stripe", name: "초록 줄무늬" }
  ],
  memories: [
    {
      id: "toast", x: 395, y: 615,
      title: "버터가 녹던 창가 자리",
      place: "망원동 골목 카페 창가",
      photo: "assets/img/toast.webp",
      story: "혼자 들어온 카페에서 창가 자리를 얻었다.\n버터가 천천히 녹는 걸 보고 있으니\n괜히 좋은 하루가 될 것 같았다.",
      author: { name: "모모", avatar: "char-hoodie" },
      when: "오늘 오후 2:40", date: "2026-11-24T14:40", vis: "all", firstDist: 34, hearts: 12,
      hint: "창가 자리, 버터가 녹던 오후",
      replies: [{ name: "하루", avatar: "char-lavender", text: "여기 토스트 진짜 맛있죠!", when: "1시간 전" }]
    },
    {
      id: "sunset", x: 455, y: 690,
      title: "노을이 유난히 길었던 날",
      place: "망원 한강공원 계단",
      photo: "assets/img/sunset.webp",
      story: "노을이 유난히 길었던 날.\n계단 위 주황빛이 오래 머물렀다.\n다음 노을도 여기서 보고 싶다.",
      author: { name: "하루", avatar: "char-lavender" },
      when: "어제 오후 5:12", date: "2026-11-23T17:12", vis: "all", firstDist: 45, hearts: 24,
      hint: "계단 위로 주황빛이 내려앉은 시간",
      replies: [
        { name: "J", avatar: "char-stripe", text: "저도 어제 여기서 노을 봤어요. 같은 시간이었을지도!", when: "어제" },
        { name: "모모", avatar: "char-hoodie", text: "다음엔 돗자리 들고 올게요", when: "오늘" }
      ]
    },
    {
      id: "alley", x: 560, y: 520,
      title: "파란 대문 앞의 고양이",
      place: "망원동 꽃 골목",
      photo: "assets/img/alley.webp",
      story: "철쭉이 핀 골목에서 고양이가 나를 한참 봤다.\n이름도 모르는데 인사하고 왔다.",
      author: { name: "J", avatar: "char-stripe" },
      when: "3일 전", date: "2026-11-21T16:05", vis: "all", firstDist: 32, hearts: 41,
      hint: "파란 대문 앞에서 누군가 기다리고 있어요",
      replies: []
    },
    {
      id: "bridge", x: 248, y: 940,
      title: "다리 위에 두고 온 편지",
      place: "성산대교 보행로",
      photo: "assets/img/bridge.webp",
      story: "부치지 못한 편지를 난간 위에 두고 왔다.\n언젠가 이 자리에 다시 오면\n그때는 조금 덜 아프길.",
      author: { name: "J", avatar: "char-stripe" },
      when: "지난주", date: "2026-11-17T20:30", vis: "all", firstDist: 41, hearts: 87,
      hint: "다리 난간 위, 접힌 종이 한 장",
      replies: []
    }
  ],
  samplePhotos: ["assets/img/sunset.webp", "assets/img/toast.webp", "assets/img/alley.webp"],
  prompts: ["오늘 여기서", "이 자리에서 생각난 사람", "다시 오고 싶은 이유"]
};
