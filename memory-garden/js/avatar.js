// 내 캐릭터 꾸미기 — 리마가 그린 원본 캐릭터 그림에서 잘라 낸 파츠를 2D로 겹쳐 그려요.
// 모든 파츠는 같은 420×900 정면 프레임 위의 투명 레이어예요(assets/avatar/*.webp).
// 색을 바꿀 때는 원본 픽셀의 밝기 차이(니트 결, 음영)를 그대로 두고 색만 입혀요.

const FRAME = { w: 420, h: 900 };
// B Compact SD 2.60(2026-11-23): 몸통·하의 −15, 다리·신발 −79. 그림이 y≈810에서 끝나서 미리보기는 820까지만 써요.
const CONTENT_H = 820;
// name: [x, y, w, h, 평균 밝기, 평균 색]
// 2026-11-26 눈 3종·볼터치는 Figma "94 · 원본 직접 분리 파츠"의 얼룩 없는 컷으로 교체
const LAYERS = {
  blush_g: [111, 267, 206, 31, 156.7, "#c38e84"],
  bottom_b: [87, 535, 247, 276, 81.2, "#4f524f"], bottom_g: [100, 535, 226, 110, 69.5, "#49424c"], bottom_s: [110, 535, 200, 134, 172.8, "#c2a695"],
  braids_g: [46, 273, 319, 259, 126.3, "#8c7876"], ears: [42, 216, 333, 69, 187.9, "#dcb19d"],
  eyes_b: [111, 223, 207, 59, 64.3, "#493d3c"], eyes_g: [108, 209, 209, 73, 69.5, "#4f4141"], eyes_s: [105, 184, 211, 98, 73.4, "#474b47"],
  face: [91, 80, 241, 254, 211.0, "#ecc9c0"],
  hair_b: [34, 12, 342, 312, 74.2, "#524647"], hair_g: [38, 22, 333, 260, 139.4, "#998585"], hair_s: [34, 12, 347, 339, 123.5, "#7d7b75"],
  hands_g: [58, 540, 301, 65, 192.4, "#dfb6a3"], hands_s: [50, 544, 324, 61, 192.1, "#dfb6a0"], legs: [133, 481, 153, 315, 189.5, "#dbb3a1"],
  mouth_b: [181, 280, 88, 35, 163.8, "#bb9b91"], mouth_g: [190, 290, 52, 20, 134.4, "#9e7d72"], mouth_s: [184, 284, 59, 32, 142.4, "#b77d78"],
  neck: [176, 313, 68, 72, 183.3, "#d6ac9c"],
  shoes_b: [98, 751, 231, 60, 80.9, "#554e51"], shoes_g: [99, 627, 216, 183, 150.1, "#a79085"], shoes_s: [107, 610, 222, 201, 127.3, "#8a7a79"],
  top_b: [77, 309, 266, 278, 100.8, "#6b6066"], top_g: [66, 311, 293, 276, 139.6, "#988391"], top_s: [51, 321, 323, 278, 130.9, "#88817c"],
  // 2026-11-24 신규 파츠 12종: 리마가 만든 원본 그림(Figma MG3·5 신규 파츠 카탈로그)에서 그대로 잘라 낸 것
  hair_wave: [21, 26, 372, 298, 130.4, "#927b7e"], hair_pony: [50, 23, 357, 298, 71.9, "#4f4446"], hair_curly: [27, 20, 361, 251, 120.8, "#7d776f"],
  top_vest: [62, 307, 293, 270, 151.1, "#a78f90"], top_sweat: [76, 320, 269, 253, 97.0, "#6b5c5b"], top_check: [51, 318, 319, 266, 137.6, "#93867e"],
  bottom_denim: [95, 563, 229, 200, 111.4, "#706d74"], bottom_susp: [101, 328, 219, 377, 134.7, "#978175"], bottom_long: [64, 570, 295, 187, 109.2, "#796868"],
  shoes_mary: [110, 731, 196, 79, 127.8, "#907973"], shoes_high: [105, 709, 211, 102, 153.4, "#a8948a"], shoes_fur: [108, 719, 206, 91, 136.6, "#998378"]
};

// 색 목록의 첫 칸 "orig"는 원본 그림의 색 그대로예요.
export const PAL = {
  skin: ["orig", "#F6DED2", "#E6BCA4", "#CF9C7C", "#A9775A", "#7E5640"],
  hair: ["orig", "#3E3438", "#6B5247", "#A98A72", "#C9AE8E", "#8F9C86", "#9D8BA8", "#B98E8A"],
  cloth: ["orig", "#A99BB5", "#6F6670", "#8FA58A", "#D8C8B0", "#C99A90", "#869BB3", "#E3D9C6"],
  bottom: ["orig", "#4B434E", "#5C6555", "#C7AF90", "#6E7F96", "#8A6F66", "#E0D6C8"],
  shoe: ["orig", "#4A4248", "#8A7A79", "#CDB9A2", "#7A6656", "#9BA69B"]
};

export const PARTS = {
  hair: [
    { id: "braids", name: "양갈래 땋은 머리", layers: ["hair_g", "braids_g"] },
    { id: "bangs", name: "일자 앞머리", layers: ["hair_g"] },
    { id: "spiky", name: "삐죽 앞머리", layers: ["hair_b"] },
    { id: "soft", name: "흐트러진 숏컷", layers: ["hair_s"] },
    { id: "wave", name: "웨이브 단발", layers: ["hair_wave"] },
    { id: "pony", name: "포니테일", layers: ["hair_pony"] },
    { id: "curly", name: "짧은 곱슬", layers: ["hair_curly"] }
  ],
  eyes: [
    { id: "round", name: "동글 눈", layer: "eyes_g" },
    { id: "sly", name: "반쯤 감은 눈", layer: "eyes_b" },
    { id: "bright", name: "또렷한 눈", layer: "eyes_s" }
  ],
  mouth: [
    { id: "smile", name: "잔잔한 미소", layer: "mouth_g" },
    { id: "grin", name: "씩 웃는 입", layer: "mouth_b" },
    { id: "open", name: "활짝 웃는 입", layer: "mouth_s" }
  ],
  top: [
    { id: "cardigan", name: "니트 가디건", layer: "top_g", hands: "hands_g" },
    { id: "hoodie", name: "후드 티셔츠", layer: "top_b", hands: null },
    { id: "stripe", name: "줄무늬 니트", layer: "top_s", hands: "hands_s" },
    { id: "vest", name: "니트 조끼+셔츠", layer: "top_vest", hands: "hands_g" },
    { id: "sweat", name: "맨투맨", layer: "top_sweat", hands: null },
    { id: "check", name: "체크 셔츠", layer: "top_check", hands: "hands_s" }
  ],
  bottom: [
    { id: "pleats", name: "플리츠 스커트", layer: "bottom_g", legs: true },
    { id: "cargo", name: "카고 바지", layer: "bottom_b", legs: false },
    { id: "shorts", name: "반바지", layer: "bottom_s", legs: true },
    { id: "denim", name: "와이드 데님", layer: "bottom_denim", legs: false },
    { id: "susp", name: "멜빵 반바지", layer: "bottom_susp", legs: true, over: true },
    { id: "long", name: "롱 플리츠", layer: "bottom_long", legs: false }
  ],
  shoes: [
    { id: "warmer", name: "레그워머와 단화", layer: "shoes_g" },
    { id: "sneakers", name: "운동화", layer: "shoes_b" },
    { id: "boots", name: "버클 부츠", layer: "shoes_s" },
    { id: "mary", name: "메리제인", layer: "shoes_mary" },
    { id: "hightop", name: "하이탑 운동화", layer: "shoes_high" },
    { id: "fur", name: "털 부츠", layer: "shoes_fur" }
  ]
};

// 처음 들어왔을 때의 바탕. 원본 세 캐릭터 중 누구와도 같지 않은 조합이에요.
export const DEFAULT_LOOK = {
  skin: "orig", eyes: "bright", mouth: "smile", blush: true,
  hair: "bangs", hairColor: "orig", top: "stripe", topColor: "orig",
  bottom: "pleats", bottomColor: "orig", shoes: "boots", shoeColor: "orig"
};
const COLOR_KEYS = { skin: "skin", hairColor: "hair", topColor: "cloth", bottomColor: "bottom", shoeColor: "shoe" };
const PART_OF = { hairColor: "hair", topColor: "top", bottomColor: "bottom", shoeColor: "shoes" };

const pick = (k, id) => PARTS[k].find(p => p.id === id) || PARTS[k][0];
export function normalizeLook(l) {
  const o = Object.assign({}, DEFAULT_LOOK);
  if (!l || typeof l !== "object") return o;
  for (const k of ["eyes", "mouth", "hair", "top", "bottom", "shoes"]) if (PARTS[k].some(p => p.id === l[k])) o[k] = l[k];
  for (const [k, pal] of Object.entries(COLOR_KEYS)) if (typeof l[k] === "string" && PAL[pal].some(c => c.toLowerCase() === l[k].toLowerCase())) o[k] = l[k];
  if (typeof l.blush === "boolean") o.blush = l.blush;
  return o;
}
export function randomLook() {
  const r = a => a[Math.floor(Math.random() * a.length)];
  const col = pal => (Math.random() < .45 ? "orig" : r(PAL[pal].slice(1)));
  return {
    skin: Math.random() < .6 ? "orig" : r(PAL.skin.slice(1)), eyes: r(PARTS.eyes).id, mouth: r(PARTS.mouth).id, blush: Math.random() < .85,
    hair: r(PARTS.hair).id, hairColor: col("hair"), top: r(PARTS.top).id, topColor: col("cloth"),
    bottom: r(PARTS.bottom).id, bottomColor: col("bottom"), shoes: r(PARTS.shoes).id, shoeColor: col("shoe")
  };
}
// 색 칩 "원래 색"에 보여 줄 실제 색(지금 고른 파츠의 원본 평균 색)
export function origColor(look, key) {
  const L = normalizeLook(look);
  if (key === "skin") return LAYERS.face[5];
  const part = pick(PART_OF[key], L[PART_OF[key]]);
  return LAYERS[part.layer || part.layers[0]][5];
}

/* ---------- 이미지 불러오기 ---------- */
const IMG = {};
let loading = null;
export function supported() {
  try { const c = document.createElement("canvas"); return !!(c.getContext && c.getContext("2d")); } catch (e) { return false; }
}
const ASSET_V = "20261126";
export function load() {
  if (loading) return loading;
  const base = new URL("../assets/avatar/", import.meta.url);
  loading = Promise.all(Object.keys(LAYERS).map(n => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => { IMG[n] = im; res(); };
    im.onerror = () => rej(new Error("layer " + n));
    // 파츠 그림은 1주일 캐시돼요. 그림을 바꾸면 ASSET_V를 올려 새로 받게 해요.
    im.src = new URL(n + ".webp?v=" + ASSET_V, base).href;
  }))).catch(e => { loading = null; throw e; });
  return loading;
}

/* ---------- 색 입히기 ---------- */
const TINT = new Map();
function hex(c) { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function tinted(name, color) {
  if (!color || color === "orig") return IMG[name];
  const key = name + color;
  if (TINT.has(key)) return TINT.get(key);
  const [x, y, w, h, lumMean] = LAYERS[name], im = IMG[name];
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.drawImage(im, 0, 0);
  const d = g.getImageData(0, 0, w, h), p = d.data, t = hex(color);
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const lum = .299 * p[i] + .587 * p[i + 1] + .114 * p[i + 2];
    // 원본 픽셀이 평균보다 얼마나 밝고 어두운지(결·음영)를 새 색에 그대로 옮겨요
    const k = Math.pow(lum / lumMean, .9);
    for (let j = 0; j < 3; j++) {
      p[i + j] = Math.min(255, t[j] * k);
    }
  }
  g.putImageData(d, 0, 0);
  TINT.set(key, c);
  return c;
}

/* ---------- 조립 ---------- */
function stack(look) {
  const L = normalizeLook(look), out = [];
  const hair = pick("hair", L.hair), top = pick("top", L.top), bottom = pick("bottom", L.bottom), shoes = pick("shoes", L.shoes);
  if (bottom.legs) out.push(["legs", L.skin]);
  out.push([shoes.layer, L.shoeColor]);
  if (!bottom.over) out.push([bottom.layer, L.bottomColor]);
  out.push(["neck", L.skin], [top.layer, L.topColor]);
  if (top.hands) out.push([top.hands, L.skin]);
  if (bottom.over) out.push([bottom.layer, L.bottomColor]); // 멜빵은 상의 위로 지나가요
  out.push(["face", L.skin], [pick("eyes", L.eyes).layer], [pick("mouth", L.mouth).layer]);
  if (L.blush) out.push(["blush_g"]);
  hair.layers.forEach(n => out.push([n, L.hairColor]));
  out.push(["ears", L.skin]);
  return out;
}
// 프레임 좌표의 사각형(src)을 ctx의 (dx, dy, scale) 위치에 그려요
function paint(ctx, look, sx, sy, s, dx, dy) {
  for (const [n, col] of stack(look)) {
    const [x, y] = LAYERS[n], src = tinted(n, col);
    ctx.drawImage(src, dx + (x - sx) * s, dy + (y - sy) * s, src.width * s, src.height * s);
  }
}

const FOCUS = {
  full: { x: 0, y: 0, w: 420, h: CONTENT_H },
  portrait: { x: 0, y: 0, w: 420, h: CONTENT_H },
  head: { x: 20, y: 0, w: 380, h: 400 },
  face: { x: 100, y: 175, w: 220, h: 175 },
  top: { x: 30, y: 300, w: 360, h: 330 },
  bottom: { x: 60, y: 525, w: 300, h: 300 },
  shoes: { x: 80, y: 591, w: 260, h: 230 }
};
export function snapshot(look, focus = "full", w = 132, h = 176) {
  const f = FOCUS[focus] || FOCUS.full, pad = focus === "full" || focus === "portrait" ? .04 : .03;
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high";
  const s = Math.min(w * (1 - pad * 2) / f.w, h * (1 - pad * 2) / f.h);
  // 신발 썸네일은 긴 바지에 가려지지 않게 반바지 차림으로 보여 줘요
  if (focus === "shoes" && !pick("bottom", normalizeLook(look).bottom).legs) look = Object.assign({}, look, { bottom: "shorts", bottomColor: "orig" });
  paint(g, look, f.x, f.y, s, (w - f.w * s) / 2, (h - f.h * s) / 2);
  return c.toDataURL("image/png");
}
export function faceThumb(look) { return snapshot(look, "face", 112, 112); }

/* ---------- 꾸미기 화면의 큰 미리보기 ---------- */
export function createStage(canvas, look) {
  let cur = normalizeLook(look), raf = 0, alive = true;
  const ctx = canvas.getContext("2d");
  function draw() {
    raf = 0; if (!alive) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = "high";
    const top = 62, bottom = 34, s = Math.min((H - top - bottom) / CONTENT_H, (W - 24) / FRAME.w);
    const dx = (W - FRAME.w * s) / 2, dy = H - bottom - CONTENT_H * s;
    // 발밑 그림자
    ctx.save(); ctx.fillStyle = "rgba(90,60,50,.13)"; ctx.beginPath();
    ctx.ellipse(W / 2, dy + 805 * s, 150 * s, 16 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    paint(ctx, cur, 0, 0, s, dx, dy);
  }
  const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(ask) : null;
  ro ? ro.observe(canvas) : window.addEventListener("resize", ask);
  draw();
  return {
    setLook(l) { cur = normalizeLook(l); ask(); },
    dispose() { alive = false; if (raf) cancelAnimationFrame(raf); ro ? ro.disconnect() : window.removeEventListener("resize", ask); }
  };
}
