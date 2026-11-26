/* 기억 정원 · 모바일 웹
   빌드 없이 정적 호스팅(Netlify 등)에 그대로 올리는 바닐라 JS.
   - 지도: js/map.js (카카오맵, 없으면 OpenStreetMap)
   - 위치: js/geo.js (watchPosition)
   - 데이터: js/api.js (Supabase · 설정이 없으면 이 기기에만 저장하는 데모 모드)
   - 라우팅: 해시(#/...) */
(function () {
  "use strict";
  const D = window.MG_DATA;
  const API = window.MG_API, GEO = window.MG_GEO, CFG = window.MG_CONFIG || {};
  const DEMO = API.mode === "demo";
  const $app = document.getElementById("app");
  const HOME_CENTER = { lat: 37.5556, lng: 126.9019 };   // 위치를 모를 때 지도를 여는 곳(망원동)

  /* ---------------- storage (never trusted to exist) ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem("mg:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("mg:" + k, JSON.stringify(v)); return 1; } catch (e) { return 0; /* private mode · 용량 초과 */ } }
  };

  /* ---------------- state ---------------- */
  const S = {
    boot: "loading", bootErr: null,                       // 서버 연결 상태
    set: API.defaults,                                    // { radius, maxAcc, nearbyKm } — 서버 설정값이 기준
    profile: { nickname: "정원사", avatar: "char-lavender" },
    onboarded: store.get("onboarded", false),
    locWanted: store.get("locWanted", false),             // 사용자가 위치 사용에 동의했는지(이 기기)
    near: [], nearState: "idle", nearAt: null,            // 지도·목록의 기억
    status: {},                                           // id → mine|discovered|locked|gone|unavailable|error|loading
    garden: null, gardenState: "idle",
    forced: null,                                         // 데모 패널에서 강제한 데이터 상태
    filter: "all", sheetMode: "peek", selected: null, gardenTab: "mine",
    theme: store.get("theme", "system"),
    found: null, region: null, regionAt: null,
    avatar: store.get("avatar", "char-lavender"),
    look: store.get("look", null), portrait: store.get("portrait", null),
    draft: { photo: null, blob: null, text: "", vis: "all", place: "", hint: "", noPhoto: false },
    lastPlanted: null, plantErr: null, busy: false, nav: 0
  };
  const BLOOM_N = 3;   // 꽃 한 송이를 완성하는 발견 수(리마 결정 2026-11-25)
  const FRESH_MS = 10 * 60 * 1000;   // 사진은 찍은 지 10분 안의 것만
  const SHEET_MIN = 76;   // 접힌 시트 높이: 손잡이 + "근처의 기억" 제목 줄

  /* ---------------- helpers ---------------- */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // 사용자 프로필: 직접 꾸민 캐릭터 또는 올린 사진만 보여요. 없으면 기본 실루엣(예전 프리셋 캐릭터 그림은 쓰지 않아요).
  const AV_DEFAULT = "assets/img/avatar-default.svg";
  const img = id => !id ? AV_DEFAULT : /^(https?:|data:|blob:)/.test(id) ? id : id === "me" ? (S.portrait || AV_DEFAULT) : id === "cat" ? "assets/img/cat.webp" : /^char-|^photo$/.test(id) ? AV_DEFAULT : `assets/img/${id}.webp`;
  const pos = () => GEO.state === "ok" ? GEO.pos : null;
  const member = () => !S.set.requireLogin || API.member();   // 심기·처음 열기는 로그인한 사람만(서버도 같은 기준)
  const locOk = () => !!pos();
  const accOk = () => locOk() && pos().acc <= S.set.maxAcc;
  const distOf = m => (pos() && m && m.lat != null) ? Math.round(GEO.distance(pos(), m)) : null;
  const fmtDist = d => d == null ? "" : d < 1000 ? d + "m" : (d / 1000).toFixed(d < 10000 ? 1 : 0) + "km";
  const allMemories = () => S.near;
  const byId = id => S.near.find(m => m.id === id) || (S.garden && [...S.garden.mine, ...S.garden.collected].find(m => m.id === id)) || (S.cache && S.cache[id]);
  S.cache = {};
  const remember = m => { if (!m) return m; S.cache[m.id] = m; const i = S.near.findIndex(x => x.id === m.id); if (i >= 0) S.near[i] = Object.assign({}, S.near[i], m); return m; };
  const BR = window.MG_BRAND;
  // 발견(=재열람 권한) · 지금 열 수 있음 · 잠김 — 정책: 현장 제한은 타인 공개 기억의 '최초' 발견에만
  const isGone = m => !!m && (m.gone || S.status[m.id] === "gone");
  const discovered = m => !!m && (m.mine || m.state === "discovered") && !isGone(m);
  const canOpen = m => !!m && m.state === "undiscovered" && accOk() && distOf(m) <= S.set.radius;
  const isOpen = m => discovered(m) || canOpen(m);
  const seedState = m => m.mine ? "mine" : discovered(m) ? "discovered" : canOpen(m) ? "available" : "dormant";
  const WD = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const dateParts = m => { const d = new Date(m.date || Date.now()); const p = n => String(n).padStart(2, "0"); return { y: d.getFullYear(), md: `${p(d.getMonth() + 1)}.${p(d.getDate())}`, wd: WD[d.getDay()], hm: `${p(d.getHours())}:${p(d.getMinutes())}`, full: `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}` }; };
  const dateBlock = m => { const t = dateParts(m); return `<span class="date-block" aria-label="${t.full} ${t.hm}"><i>${t.y}</i><b>${t.md}</b><em>${t.wd} · ${t.hm}</em></span>`; };
  function relTime(iso, fallback) {
    if (!iso) return fallback || "";
    const d = new Date(iso), now = new Date(), s = (now - d) / 1000;
    if (s < 60 && s > -60) return "방금";
    if (s < 3600) return Math.floor(s / 60) + "분 전";
    const hm = `${d.getHours() < 12 ? "오전" : "오후"} ${(d.getHours() % 12) || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const n = Math.round(day / 864e5);
    if (n === 0) return "오늘 " + hm;
    if (n === 1) return "어제 " + hm;
    if (n < 7) return n + "일 전";
    if (n < 14) return "지난주";
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  }
  const visLabel = v => v === "me" ? "나만 보기" : v === "key" ? "비밀번호를 아는 사람만" : "모두에게 공개";
  const visIc = v => v === "me" ? I.lock : v === "key" ? I.key : I.users;
  const SECRET_OK = v => typeof v === "string" && v.length >= 4 && v.length <= 20;
  const dirOf = m => {
    const b = GEO.bearing(pos(), m);
    const names = ["북쪽", "북동쪽", "동쪽", "남동쪽", "남쪽", "남서쪽", "서쪽", "북서쪽"];
    return { name: names[Math.round(b / 45) % 8], deg: b };
  };
  const walkMin = d => Math.max(1, Math.round(d / 70));
  const dataState = () => S.forced || (S.nearState === "idle" ? "loading" : S.nearState === "ok" && !S.near.length ? "empty" : S.nearState);
  let toastTimer;
  function toast(msg) {
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    $app.appendChild(t); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2900);
  }

  /* ---------------- icons ---------------- */
  const I = {
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="9" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="15" r="1.3" fill="currentColor" stroke="none"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    front: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z"/><path d="M9 4v14M15 6v14"/></svg>',
    garden: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21v-7"/><path d="M12 14c-4 0-6-2.5-6-6 3.5 0 6 2 6 6Z"/><path d="M12 12c0-3.5 2.5-6 6-6 0 3.5-2 6-6 6Z"/><path d="M5 21h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6h14v-6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5S3.5 15.3 3.5 9.3A4.4 4.4 0 0 1 12 7.1a4.4 4.4 0 0 1 8.5 2.2c0 6-8.5 11.2-8.5 11.2Z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 19 4M16 7l2.5 2.5M14 9l2 2"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 19 20l-7-4-7 4 7-17Z"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/></svg>',
    alert: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.5"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 7.8a4.2 4.2 0 0 1 0 8.4Z" fill="currentColor"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.2a3 3 0 0 1 0 5.6M17.5 14.2a5 5 0 0 1 3 4.8"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.5"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>',
    sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/></svg>',
    crosshair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="6"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/><path d="M4 4l16 16"/></svg>'
  };

  I.check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  I.unlock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/></svg>';
  I.nav = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 19 20l-7-4-7 4 7-17Z"/></svg>';
  I.locOff = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.2 3.6A7 7 0 0 1 19 9c0 2.3-1.3 5-2.9 7.3M13.8 19.9c-1 1.2-1.8 2.1-1.8 2.1S5 14.4 5 9c0-1 .2-1.9.6-2.8"/><path d="M3 3l18 18"/></svg>';
  I.trash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13"/></svg>';

  /* ---------------- Figma MG3·9 공통 조각 (배경·궤도·언덕) ---------------- */
  const AMB = h => `<div class="f-amb" style="height:${h}px" aria-hidden="true"></div>`;
  const HILLS = top => `<img class="f-hills" src="assets/brand/hills.svg" alt="" aria-hidden="true" style="top:${top}px">`;
  const ORBIT = (x, y, w) => `<img class="f-orbit" src="assets/brand/orbit.svg" alt="" aria-hidden="true" style="left:${x}px;top:${y}px;width:${w}px;height:${w}px">`;
  const AT = (x, y, w, html, cls) => `<span class="f-at ${cls || ""}" style="left:${x}px;top:${y}px;width:${w}px;height:${w}px">${html}</span>`;
  const LUMI = (x, y, w) => `<img class="f-lumi" src="${img("cat")}" alt="" style="left:${x}px;top:${y}px;width:${w}px">`;
  const stamp = m => { const t = dateParts(m); return `<span class="f-stamp" aria-label="${t.full} ${t.hm}"><i>${t.y}</i><b>${t.md}</b><em>${t.wd} · ${t.hm}</em></span>`; };
  const badge = (cls, ic, txt) => `<span class="f-badge ${cls}">${ic || ""}${txt}</span>`;
  const stateBlock = (tone, ic, h, p, btn) => `<div class="f-state" ${tone === "err" ? 'role="alert"' : ""}><span class="f-sic ${tone}">${ic}</span><h3>${h}</h3><p>${p}</p>${btn || ""}</div>`;

  /* ---------------- real map (persistent) ---------------- */
  // 지도는 화면을 다시 그릴 때마다 새로 만들지 않고, 한 번 만든 걸 자리만 옮겨 붙여요.
  const mapHost = document.createElement("div"); mapHost.className = "map-host";
  let MAP = null, mapLoading = false, mapFailed = false, lastPinTap = 0;
  function ensureMap() {
    if (MAP || mapLoading) return;
    mapLoading = true;
    const c = pos() || S.nearAt || HOME_CENTER;
    window.MG_MAP.create(mapHost, {
      kakaoKey: CFG.kakaoJsKey, center: c,
      onMapClick: () => setTimeout(() => { if (Date.now() - lastPinTap > 400 && S.selected) { S.selected = null; render(); } }, 0),
      onMove: () => { if (!locOk() && MAP) { const ce = MAP.center(); if (!S.nearAt || GEO.distance(S.nearAt, ce) > 400) fetchNear(ce); } }
    }).then(m => {
      MAP = m; mapLoading = false; mapFailed = false;
      if (S.mapFocus) { const f = S.mapFocus; S.mapFocus = null; MAP.panTo(f.lat, f.lng, f.off || 0, false); }
      syncMap(); updateRegion();
    }).catch(e => { console.error(e); mapLoading = false; mapFailed = true; if ((route() || {}).name === "home") render(); });
  }
  const meHTML = () => `<div class="me ${accOk() ? "" : "low"}"><span class="me-label">나</span><div class="me-dot"></div></div>`;
  function pinItems() {
    if (dataState() !== "ok" && dataState() !== "empty") return [];
    // 씨앗 핀 v3: 잠김 · 열 수 있음 · 선택 · 발견 · 내가 심음 ('?' 핀 없음, 위치를 모르면 거리만 숨김)
    return S.near.filter(m => !isGone(m)).map(m => {
      const st = seedState(m), d = distOf(m), sel = S.selected === m.id;
      const label = m.mine ? "내 기억" : d != null ? fmtDist(d) : "";
      const name = m.mine ? "내가 심은 기억" : discovered(m) ? m.title : canOpen(m) ? "지금 열 수 있는 기억" : "아직 발견하지 않은 기억";
      return {
        id: m.id, lat: m.lat, lng: m.lng, z: sel ? 5 : st === "available" ? 4 : 2,
        html: `<div class="pin chip-pin is-${st}${sel ? " active" : ""}"><button data-act="pin" data-id="${m.id}" aria-label="${esc(name)}${label ? ", " + label : ""}"><span class="ic">${BR.seedPin(st, sel ? 22 : 18)}</span>${label || st === "discovered" ? `<b>${m.mine || st === "discovered" ? "" : st === "available" ? I.unlock : I.lock}${label || "발견함"}</b>` : ""}<i class="tail"></i></button></div>`
      };
    });
  }
  function syncMap() {
    if (!MAP) return;
    MAP.setMe(pos(), meHTML(), S.set.radius, locOk() && !accOk());
    MAP.setPins(pinItems());
  }
  const sheetOffset = () => -Math.round(Math.min(window.innerHeight * .22, 150));   // 아래 시트에 가리지 않게 조금 위로
  function focusOn(m) { if (!m) return; if (MAP) MAP.panTo(m.lat, m.lng, 0); else S.mapFocus = { lat: m.lat, lng: m.lng }; }
  function recenter() {
    const p = pos();
    if (!p) { toast(GEO.state === "asking" ? "위치를 확인하는 중이에요" : "현재 위치를 몰라서 이동할 수 없어요"); return; }
    if (MAP) MAP.panTo(p.lat, p.lng, -sheetOffset());
  }
  function updateRegion() {
    const p = pos(); if (!p || !MAP) return;
    if (S.regionAt && GEO.distance(S.regionAt, p) < 300) return;
    S.regionAt = { lat: p.lat, lng: p.lng };
    MAP.regionName(p.lat, p.lng).then(n => { if (n && n !== S.region) { S.region = n; softRender(true); } });
  }

  /* ---------------- data loading ---------------- */
  let nearReq = 0;
  function fetchNear(at) {
    if (!at || S.boot !== "ok") return;
    const req = ++nearReq;
    if (!S.near.length || S.nearState === "error") S.nearState = "loading";
    S.nearAt = { lat: at.lat, lng: at.lng };
    API.nearby(at).then(list => {
      if (req !== nearReq) return;
      S.near = list.map(m => S.status[m.id] === "gone" ? Object.assign(m, { gone: true }) : m);
      S.nearState = "ok"; syncMap(); softRender(true);
    }).catch(e => { if (req !== nearReq) return; console.error(e); S.nearState = "error"; softRender(true); });
  }
  function refreshNear() { fetchNear(pos() || (MAP && MAP.center()) || S.nearAt || HOME_CENTER); }
  function loadGarden() {
    if (S.boot !== "ok") return;
    if (!S.garden) S.gardenState = "loading";
    API.garden().then(g => { S.garden = g; S.gardenState = "ok"; g.collected.forEach(c => { if (c.gone) return; S.status[c.id] = "discovered"; }); softRender(true); })
      .catch(e => { console.error(e); S.gardenState = "error"; softRender(true); });
  }
  function loadDetail(id) {
    if (S.status[id] === "loading") return;
    S.status[id] = "loading";
    API.detail(id).then(r => { S.status[id] = r.status; if (r.memory) remember(r.memory); if (r.status === "gone") { const m = byId(id); if (m) m.gone = true; } render(); })
      .catch(e => { console.error(e); S.status[id] = "error"; render(); });
  }

  /* ---------------- shared pieces ---------------- */
  function tabbar(cur) {
    return `<nav class="tabbar" aria-label="주요 메뉴">
      <a class="tab" href="#/" ${cur === "map" ? 'aria-current="page"' : ""}>${I.map}<span>지도</span></a>
      <a class="tab-plant" href="#/plant/1" aria-label="이 자리에 기억 심기">${I.plus}</a>
      <a class="tab" href="#/garden" ${cur === "garden" ? 'aria-current="page"' : ""}>${I.garden}<span>내 정원</span></a>
    </nav>`;
  }
  function memoryCard(m) {
    const st = seedState(m), d = distOf(m), locKnown = d != null;
    if (st === "dormant" || st === "available") {
      const can = st === "available";
      const status = can ? `${I.unlock}열 수 있어요${locKnown ? " · " + fmtDist(d) : ""}`
        : !locOk() ? `${I.lock}잠김 · 거리 확인 필요` : !accOk() ? `${I.crosshair}거리 확인 중` : `${I.lock}잠김 · ${fmtDist(d)}`;
      return `<button class="mcard f-mcard" data-act="open" data-id="${m.id}">
        <span class="f-thumb ${can ? "amber" : "lilac"}">${BR.seed(can ? "available" : "dormant", 68)}</span>
        <span class="f-mtxt"><b>아직 발견하지 않은 기억</b><span class="f-status ${can ? "amber" : "lilac"}">${status}</span>
          <span class="f-meta">${esc(m.place)} · ${m.hint ? "힌트 있음" : "힌트 없음"}</span></span></button>`;
    }
    const tag = m.mine ? badge("soft", "", "내 기억") : badge("rose", BR.pinFlower(14), "발견함");
    return `<button class="mcard f-mcard" data-act="open" data-id="${m.id}">
      <span class="f-thumb photo">${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy">` : BR.seed("planted", 68)}</span>
      <span class="f-mtxt"><b>${esc(m.title)}</b>${tag}
        <span class="f-meta">${esc(m.place)}${locKnown ? " · " + (d < 15 && m.mine ? "여기" : fmtDist(d)) : ""}</span></span></button>`;
  }
  // 위치 상태별 안내(오류 ≠ 빈 화면). 위도·경도는 어디에도 보여 주지 않아요.
  function locBanner(top) {
    const st = GEO.state, at = `style="top:${top}"`;
    const b = (ic, title, sub, act, btn) => `<div class="banner f-banner" ${at} role="status"><span class="ic">${ic}</span><div><b>${title}</b><span>${sub}</span></div>${btn ? `<button data-act="${act}">${btn}</button>` : ""}</div>`;
    if (st === "ok") return accOk() ? "" : b(I.locOff, "위치 확인 중이에요", `아직 열 수 있는지 몰라요 · 오차 ±${pos().acc}m`, "loc-retry", "다시 확인");
    if (st === "asking") return b(I.crosshair, "위치 확인 중이에요", "위치 권한을 물으면 ‘허용’을 눌러 주세요", "", "");
    if (st === "denied") return b(I.locOff, "위치를 확인할 수 없어요", "둘러보기만 할 수 있어요", "loc-help", "방법 보기");
    if (st === "timeout") return b(I.locOff, "위치 확인이 늦어지고 있어요", "창가나 바깥에서 다시 시도해 주세요", "loc-retry", "다시 확인");
    if (st === "unavailable") return b(I.locOff, "현재 위치를 찾지 못했어요", "GPS와 Wi-Fi를 켜 주세요", "loc-retry", "다시 확인");
    if (st === "insecure") return b(I.locOff, "https에서만 위치를 써요", "보안 주소(https)로 열어 주세요", "", "");
    if (st === "unsupported") return b(I.locOff, "위치를 쓸 수 없는 브라우저예요", "둘러보기만 할 수 있어요", "", "");
    return b(I.locOff, "위치를 확인할 수 없어요", "둘러보기만 할 수 있어요", "loc-retry", "다시 확인");
  }
  function locHelp() {
    openModal(`<h3>위치 권한 켜는 방법</h3>
      <div class="help-steps"><b>아이폰 · Safari</b><ol><li>설정 앱 → 개인정보 보호 및 보안 → <em>위치 서비스</em>를 켜요</li><li>같은 화면 아래 <em>Safari 웹 사이트</em> → ‘앱을 사용하는 동안’</li><li>Safari 주소창 왼쪽 <em>aA</em>(또는 ⋯) → 웹 사이트 설정 → 위치 ‘허용’</li></ol>
      <b>안드로이드 · Chrome</b><ol><li>휴대폰 빠른 설정에서 <em>위치</em>를 켜요</li><li>주소창 왼쪽 <em>사이트 정보 아이콘</em> → 권한 → 위치 ‘허용’</li></ol>
      <p>바꾼 뒤에도 그대로면 페이지를 새로고침해 주세요.</p></div>
      <button class="btn btn-primary btn-block" data-act="loc-retry">다시 확인하기</button><button class="btn btn-ghost" data-act="reload">새로고침</button>`);
  }

  /* ---------------- 로그인 (카카오) ---------------- */
  const KAKAO_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#000" d="M12 3.5c-5 0-9 3.1-9 7 0 2.5 1.7 4.7 4.2 6l-1 3.7c-.1.3.3.6.6.4l4.4-2.9c.3 0 .5.1.8.1 5 0 9-3.1 9-7s-4-7.3-9-7.3Z"/></svg>';
  const kakaoBtn = (label) => `<button class="btn btn-kakao btn-block" data-act="login">${KAKAO_ICON}${label || "카카오로 시작하기"}</button>`;
  const MAIL_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></svg>';
  const hasEmail = () => typeof API.loginEmail === "function";
  const emailBtn = (label) => hasEmail() ? `<button class="btn btn-outline btn-block btn-mail" data-act="email-open">${MAIL_ICON}${label || "이메일로 시작하기"}</button>` : "";
  // 이메일 링크 로그인: 비밀번호 없이 메일로 받은 링크를 눌러 로그인
  function emailSheet(prefill) {
    openModal(`<h3>이메일로 로그인</h3><p class="av-note" style="margin:0">입력한 주소로 로그인 링크를 보내 드려요.<br>비밀번호는 필요하지 않아요.</p>
      <label class="field"><span>이메일 주소</span><input id="emailInput" type="email" inputmode="email" autocomplete="email" placeholder="name@example.com" value="${esc(prefill || "")}"></label>
      <button class="btn btn-primary btn-block" data-act="email-send">로그인 링크 받기</button><button class="btn btn-ghost" data-act="close">취소</button>
      <p class="reassure">메일의 링크는 지금 쓰는 이 브라우저에서 열어 주세요.</p>`);
    setTimeout(() => { const i = document.getElementById("emailInput"); if (i) i.focus(); }, 60);
  }
  function emailSent(email) {
    openModal(`<div class="login-sheet"><img src="${img("cat")}" alt=""><h3>메일함을 확인해 주세요</h3><p class="av-note" style="margin:0"><b>${esc(email)}</b>(으)로 로그인 링크를 보냈어요.<br>링크를 누르면 이 화면으로 돌아와 로그인돼요.</p></div>
      <button class="btn btn-outline btn-block" data-act="email-open" data-v="${esc(email)}">주소 다시 입력하기</button><button class="btn btn-ghost" data-act="close">닫기</button>
      <p class="reassure">메일은 영어로 와요.<br>보낸 사람 <b>Supabase Auth</b>, 제목 "Your sign-in link" 또는 "Confirm…" 메일이에요.<br>메일 안의 <b>Sign in</b>(또는 Confirm) 링크를 눌러 주세요.<br>메일이 안 보이면 스팸함도 확인해 주세요.<br>링크는 이 브라우저에서 열어야 해요.</p>`);
  }
  function sendEmailLink(email, fresh) {
    API.loginEmail(email, { fresh }).then(() => emailSent(email)).catch(e => {
      console.error(e);
      if (e.code === "email_exists") openModal(`<div class="login-sheet"><img src="${img("cat")}" alt=""><h3>이미 정원이 있는 이메일이에요</h3><p class="av-note" style="margin:0">해당 이메일로 로그인하면 원래 정원을 볼 수 있어요.<br>이 기기에서 로그인 없이 남긴 기록은 옮겨지지 않아요.</p></div>
        <button class="btn btn-primary btn-block" data-act="email-fresh" data-v="${esc(email)}">해당 이메일로 로그인</button><button class="btn btn-ghost" data-act="close">지금은 로그인 안 할게요</button>`, { alert: true });
      else toast(e.code === "rate" ? "잠시 뒤에 다시 보내 주세요" : "링크를 보내지 못했어요. 주소를 확인해 주세요");
    });
  }
  const LOGIN_WHY = {
    plant: ["기억을 심으려면 로그인이 필요해요", "심은 기억은 내 계정에 저장돼서, 휴대폰을 바꿔도 내 정원에서 다시 볼 수 있어요."],
    open: ["처음 열려면 로그인이 필요해요", "발견한 기억은 내 정원에 담겨요. 로그인하면 어느 기기에서든 다시 볼 수 있어요."],
    account: ["로그인하고 내 정원 지키기", "지금은 이 기기에만 연결된 임시 정원이에요. 로그인하면 지금까지의 기록이 계정에 그대로 이어져요."]
  };
  function loginSheet(kind) {
    const [h, p] = LOGIN_WHY[kind] || LOGIN_WHY.account;
    openModal(`<div class="login-sheet"><img src="${img("cat")}" alt=""><h3>${h}</h3><p class="av-note" style="margin:0">${p}</p></div>
      ${kakaoBtn()}${emailBtn()}<button class="btn btn-ghost" data-act="close">${kind === "account" ? "닫기" : "둘러보기 계속하기"}</button>
      <p class="reassure">지도와 근처 기억 둘러보기는 로그인 없이도 할 수 있어요.</p>`);
  }
  function viewLoginGate() {
    const [h, p] = LOGIN_WHY.plant;
    return `<section class="screen" aria-label="로그인 필요">${flowHead(1)}<div class="center-state login-gate"><img src="${img("cat")}" alt="" style="width:132px"><h2>${h}</h2><p>${p}</p>
      <div style="display:flex;flex-direction:column;gap:6px;width:100%;max-width:320px;margin-top:8px">${kakaoBtn()}${emailBtn()}<a class="btn btn-ghost" href="#/">지도 둘러보기</a></div></div></section>`;
  }
  // 광고성 정보 수신 동의: 로그인 동의와 별개, 선택. 처음 로그인한 뒤 한 번만 물어봐요.
  function marketingSheet() {
    const email = API.memberEmail();
    openModal(`<div class="login-sheet"><img src="${img("cat")}" alt=""><h3>새 기억 소식을 이메일로 받아 볼래요?</h3><p class="av-note" style="margin:0">근처에 새로 심긴 기억, 이벤트 소식을 가끔 보내 드려요. 받지 않아도 서비스는 똑같이 쓸 수 있어요.</p></div>
      <dl class="consent-box"><div><dt>받는 곳</dt><dd>${esc(email)}</dd></div><div><dt>목적</dt><dd>서비스 소식·이벤트 등 광고성 정보 안내</dd></div><div><dt>보관</dt><dd>동의를 철회할 때까지</dd></div></dl>
      <button class="btn btn-primary btn-block" data-act="mkt-set" data-v="1">(선택) 동의하고 받기</button><button class="btn btn-ghost" data-act="mkt-set" data-v="0">받지 않을게요</button>
      <p class="reassure">내 정원 → 설정에서 언제든 바꿀 수 있어요.</p>`);
  }
  // 임시 정원에 남긴 게 없으면(새 기기 등) 이어 붙일 필요가 없어 바로 로그인해요 → '이미 정원이 있는 계정' 안내와 두 번째 로그인이 생기지 않아요
  async function anonEmpty() {
    if (API.member()) return false;
    try { const g = S.garden || await API.garden(); return !!g && !g.mine.length && !g.collected.length; } catch (_) { return false; }
  }
  async function doLogin() {
    toast("카카오 로그인 화면으로 이동해요");
    const fresh = await anonEmpty();
    API.loginKakao({ fresh }).catch(e => { console.error(e); toast(e.code === "linking_disabled" ? "서버 설정이 필요해요: Supabase에서 manual linking을 켜 주세요" : "로그인을 시작하지 못했어요. 다시 시도해 주세요"); });
  }

  /* ---------------- HOME / MAP ---------------- */
  function viewHome() {
    const ds = dataState();
    const all = allMemories().filter(m => !isGone(m));
    const sortD = (a, b) => (distOf(a) ?? 1e9) - (distOf(b) ?? 1e9);
    const list = all.filter(m => S.filter === "all" || (S.filter === "open" ? canOpen(m) : !isOpen(m))).sort(sortD);
    const openN = all.filter(isOpen).length, lockedN = all.length - openN, availN = all.filter(canOpen).length;
    const nearest = all.filter(m => !m.mine).sort(sortD)[0];
    const R = S.set.radius;

    let body;
    if (ds === "loading") body = [1, 2, 3].map(() => `<div class="f-skel" aria-hidden="true"><span class="t"></span><span class="l"><i></i><i></i></span><span class="r"></span></div>`).join("");
    else if (ds === "error") body = stateBlock("err", I.wifi, "기억을 불러오지 못했어요", "근처에 기억이 없다는 뜻은 아니에요. 연결을 확인하고 다시 시도해 주세요.", `<button class="btn btn-outline f-sbtn" data-act="retry">다시 시도</button>`);
    else if (ds === "empty") body = stateBlock("soft", I.garden, "이 근처엔 아직 심어진 기억이 없어요", "여기에 첫 기억을 심어 보세요.<br>다음에 이곳에 온 누군가가 발견할 거예요.", `<a class="btn btn-primary f-sbtn" href="#/plant/1">첫 기억 심기</a>`);
    else body = list.length ? list.map(memoryCard).join("") : stateBlock("soft", I.lock, S.filter === "open" ? "지금 열 수 있는 기억이 없어요" : "잠긴 기억이 없어요", "필터를 바꿔 보세요.", "");

    let catLine;
    if (!locOk()) catLine = GEO.state === "asking" ? "지금 어디 있는지 찾는 중이야…" : "위치를 몰라서 거리는 알 수 없어.<br>둘러보기는 할 수 있어!";
    else if (ds === "loading") catLine = "근처 기억을 찾는 중이야…";
    else if (ds === "error") catLine = "신호가 약한가 봐.<br>다시 찾아볼게!";
    else if (ds === "empty" || !nearest) catLine = "여긴 아직 남겨진 기억이 없어.<br>네가 처음이 되어 볼래?";
    else if (!accOk()) catLine = "하늘이 트인 곳에서 잠시 기다리면<br>위치가 더 정확해져!";
    else catLine = `가장 가까운 기억은 ${fmtDist(distOf(nearest))} 앞이야.<br>다가가 볼래?`;
    const note = !locOk() ? "위치를 켜면 거리가 보여요" : !accOk() ? "오차가 줄면 거리가 보여요" : `반경 ${R}m 안에서 열려요`;

    const sel = S.selected && byId(S.selected);
    const peek = (ds === "empty" || ds === "error") ? 340 : 280;   // Figma: 시트 위끝 y480 (빈·오류 y420)
    const base = "var(--tab-h) + var(--safe-bottom)";
    // 시트 3단계: full(72%) · peek(중간) · min(제목만, 지도 전체 보기). 손잡이를 끌거나 눌러서 바꿔요.
    const mode = S.sheetMode;
    const sheetTop = mode === "full" ? "72%" : `calc(${base} + ${mode === "min" ? SHEET_MIN : peek}px)`;
    const sheetH = sheetTop;
    const mapBottom = sel ? `calc(${base})` : mode === "min" ? `calc(${base} + ${SHEET_MIN - 24}px)` : sheetH;
    // 루미 말풍선·내 위치 버튼은 시트 위끝보다 12px 위에 떠서 시트와 겹치지 않아요
    const floatBottom = sel ? `calc(${base} + 152px)` : `calc(${sheetTop} + 12px)`;
    const locateBottom = sel ? `calc(${base} + 156px)` : `calc(${sheetTop} + 12px)`;
    const bannerTop = "calc(var(--safe-top) + 72px)";
    // 시트를 내리면 루미도 작은 아이콘으로 접혀 지도를 가리지 않아요. 아이콘을 누르면 접힌 채로도 힌트 말풍선이 열려요.
    if (S.sheetMode !== "min") S.lumiPeek = false;
    const mini = sel || S.lumiHidden || (S.sheetMode === "min" && !S.lumiPeek);
    const chip = (f, label, n) => `<button class="chip" data-act="filter" data-f="${f}" aria-pressed="${S.filter === f}">${S.filter === f ? I.check : ""}${label} <span class="n">${n}</span></button>`;

    return `<section class="screen home" aria-label="지도 홈">
      <div class="map" id="map" style="bottom:${mapBottom}">${mapFailed ? `<div class="map-fallback">${stateBlock("soft", I.map, "지도를 불러오지 못했어요", "목록에서 근처 기억을 볼 수 있어요.", `<button class="btn btn-outline f-sbtn" data-act="map-retry">다시 불러오기</button>`)}</div>` : ""}</div>
      <header class="topbar f-top">
        <a class="f-logo" href="#/" aria-label="기억 정원 홈"><span class="f-lumi-c"><img src="${img("cat")}" alt=""></span><b>기억 정원</b></a>
        <span class="spacer"></span>
        <button class="f-locchip ${locOk() ? "" : "off"}" data-act="loc"><span class="dot"></span>${locOk() ? esc(S.region || "내 위치") : GEO.state === "asking" ? "위치 확인 중" : "위치 꺼짐"}</button>
      </header>
      ${locBanner(bannerTop)}
      ${mini ? `<button class="f-bubble-min" style="bottom:${floatBottom}" data-act="lumi-show" aria-label="루미의 안내 보기"><img src="${img("cat")}" alt=""><i></i></button>`
        : `<div class="f-bubble" style="bottom:${floatBottom}" role="status"><span class="f-lumi-c l40"><img src="${img("cat")}" alt="수집가 루미"></span><p><span class="spk">LUMI</span><span class="msg">${catLine}</span></p><button class="f-x" data-act="lumi-hide" aria-label="안내 닫기">${I.close}</button></div>`}
      <button class="f-locate" style="bottom:${locateBottom}" data-act="recenter" aria-label="내 위치로">${I.target}</button>
      ${sel ? peekHTML(sel) : `<section class="sheet f-sheet is-${mode}" style="height:${sheetH}" aria-label="근처의 기억" data-peek="${peek}">
        <div class="sheet-handle" data-act="sheet" role="button" aria-label="${mode === "full" ? "목록 줄이기" : mode === "min" ? "목록 펼치기" : "목록 크게 보기"} (위아래로 끌어서 조절)" tabindex="0"></div>
        <div class="sheet-head"><div class="sheet-title"><h2>근처의 기억</h2><span class="count">${ds === "ok" ? all.length : ds === "empty" ? 0 : ""}</span><span class="sub">${note}</span></div>
          ${ds === "ok" ? `<div class="chips" role="group" aria-label="필터">${chip("all", "전체", all.length)}${chip("open", "열 수 있어요", availN)}${chip("locked", "잠김", lockedN)}</div>` : ""}
        </div>
        <div class="sheet-body" id="sheetBody" aria-busy="${ds === "loading"}">${body}</div></section>`}
      ${tabbar("map")}
    </section>`;
  }
  function peekHTML(m) {
    const st = seedState(m), d = distOf(m), undisc = st === "dormant" || st === "available";
    const locTxt = d != null ? `${fmtDist(d)} · 걸어서 ${walkMin(d)}분` : "거리 확인 불가";
    const btn = !undisc ? `<button class="btn btn-primary" data-act="open" data-id="${m.id}">${m.mine ? "내 기억 보기" : "다시 보기"}</button>`
      : st === "available" ? `<button class="btn btn-primary" data-act="open" data-id="${m.id}">열어보기</button>`
      : `<button class="btn btn-outline" data-act="open" data-id="${m.id}">자세히 보기</button>`;
    return `<div class="peek f-peek" role="dialog" aria-label="기억 미리보기">
      <span class="f-seedtile ${st === "dormant" ? "lilac" : "amber"}">${undisc ? BR.seed(st, 86) : m.photo ? `<img src="${esc(m.photo)}" alt="">` : BR.seed("planted", 86)}</span>
      <div class="f-pk"><b>${undisc ? "아직 발견하지 않은 기억" : esc(m.title)}</b><span class="f-meta">${esc(m.place)}${undisc && m.secret ? " · 비밀번호" : ""}${undisc && m.hint ? " · 힌트 있음" : ""}</span>
        <div class="f-row">${btn}<span class="f-meta">${m.mine ? "" : locTxt}</span></div></div>
      <button class="f-x" data-act="unselect" aria-label="닫기">${I.close}</button></div>`;
  }

  /* ---------------- MEMORY DETAIL ---------------- */
  const loadingScreen = label => `<section class="screen" aria-label="${label}" aria-busy="true"><header class="plain-head"><a class="icon-btn" href="#/" data-act="back" aria-label="뒤로">${I.back}</a></header><div class="center-state"><div class="sprout"><span class="seed"></span><span class="stem"></span><span class="bud"></span></div><p>기억을 불러오는 중…</p></div></section>`;
  const errorScreen = id => `<section class="screen"><header class="plain-head"><a class="icon-btn" href="#/" data-act="back" aria-label="뒤로">${I.back}</a></header><div class="center-state" role="alert"><span class="icon" style="width:72px;height:72px;border-radius:50%;display:grid;place-items:center;background:var(--color-danger-soft);color:var(--color-danger)">${I.wifi}</span><h2>기억을 불러오지 못했어요</h2><p>연결을 확인하고 다시 시도해 주세요.</p><button class="btn btn-primary" data-act="detail-retry" data-id="${esc(id)}">다시 시도</button></div></section>`;
  function viewMemory(id) {
    const st = S.status[id];
    if (st === "gone") return viewGone();
    if (st === "unavailable") return `<section class="screen"><div class="center-state"><img src="${img("cat")}" alt="" style="width:120px"><h2>기억을 찾을 수 없어요</h2><p>지워졌거나 볼 수 없는 기억이에요.</p><a class="btn btn-primary" href="#/">지도로 돌아가기</a></div></section>`;
    if (st === "error") return errorScreen(id);
    const m = byId(id);
    if (S.found === id && m && m.full) return viewFound(m);
    // 목록 정보만 있는 내 기억·발견한 기억은 본문·답장을 서버에서 한 번 더 받아요
    if (!m || st === "loading" || ((m.mine || m.state === "discovered") && !m.full)) { if (st !== "loading") loadDetail(id); return loadingScreen("기억 불러오는 중"); }
    if (isGone(m)) return viewGone();
    if (m.mine) return viewOpen(m, true);
    return discovered(m) ? viewOpen(m) : viewLocked(m);
  }
  function viewGone() {
    return `<section class="screen" aria-label="열람할 수 없는 기억"><header class="plain-head"><a class="icon-btn" href="#/garden" aria-label="뒤로">${I.back}</a></header>
      <div class="center-state"><span class="gone-stitch">${BR.stitch(120, "trace")}</span><h2>더 이상 열람할 수 없는 기억이에요</h2>
      <p>작성자가 기억을 지웠거나 비공개로 바꿨어요.<br>사진·글·작성자는 볼 수 없고, 발견했던 흔적만 회색 자수로 남아요.</p>
      <a class="btn btn-primary" href="#/garden">내 정원으로</a></div></section>`;
  }
  // M09 열린 기억 · M32 내 기억 상세(공개 범위)
  function viewOpen(m, mine) {
    const liked = !!m.liked;
    const replies = m.replies || [];
    const hearts = m.hearts || 0;
    const vis = m.vis || "all";
    const tags = `${badge("soft", visIc(vis), visLabel(vis))}${!mine && m.firstDist != null ? badge("coral", I.unlock, `${m.firstDist}m 거리에서 처음 열었어요`) : ""}`;
    return `<section class="screen" aria-label="${mine ? "내 기억 상세" : "기억 열람"}">
      <div class="detail-photo">${m.photo ? `<img src="${esc(m.photo)}" alt="${esc(m.title)} 사진">` : `<div class="nophoto">${BR.seed("planted", 180)}</div>`}
        <div class="detail-top"><a class="icon-btn" href="${mine || discovered(m) ? "#/garden" : "#/"}" data-act="back" aria-label="뒤로">${I.back}</a><button class="icon-btn" data-act="share" data-id="${m.id}" aria-label="공유">${I.share}</button></div></div>
      <div class="detail-sheet"><div class="detail-body">
        <div class="when-row">${stamp(m)}<div class="when-info"><span class="place">${I.pin}${esc(m.place)}</span><div class="tags">${tags}</div></div></div>
        <div class="author"><span class="avatar"><img src="${esc(img(mine ? (S.avatar === "me" ? "me" : S.avatar) : m.author.avatar))}" alt=""></span><div><b>${mine ? "내가 심은 기억" : esc(m.author.name)}</b><span>${(t => t === "방금" ? "방금 심음" : esc(t) + "에 심음")(relTime(m.date, m.when))}</span></div></div>
        ${mine ? `<button class="vis-card f-vis" data-act="vis-open" data-id="${m.id}"><span class="ic">${visIc(vis)}</span><span><small>공개 범위</small><b>${visLabel(vis)}</b></span><span class="chg">변경${I.fwd}</span></button>
          <p class="fine">${vis === "me" ? "다른 사람에게는 보이지 않아요." : vis === "key" ? "이 장소에서 비밀번호까지 맞힌 사람만 열 수 있어요." : "이 장소 가까이 온 사람이 발견할 수 있어요."}<br>나는 공개 범위와 상관없이 언제든 볼 수 있어요.</p>` : ""}
        <h1 class="mem-title">${esc(m.title)}</h1>
        <p class="story">${esc(m.story)}</p>
        ${mine && m.hint ? `<div class="hint-card"><span class="ic">HINT</span><p>${esc(m.hint)}</p></div>` : ""}
        <div class="divider"></div>
        <div class="replies"><h3>답장 <span class="n">${replies.length}</span></h3>
          ${replies.length ? replies.map(r => `<div class="reply f-reply"><span class="avatar"><img src="${esc(img(r.avatar))}" alt=""></span><div><div class="rh"><b>${esc(r.name)}</b><span>${esc(relTime(r.date, r.when))}</span></div><p>${esc(r.text)}</p></div></div>`).join("") : `<p style="font-size:14px;color:var(--color-text-faint)">${mine ? "아직 받은 답장이 없어요." : "아직 답장이 없어요. 이 자리에 온 첫 사람이 되어 볼래요?"}</p>`}
        </div>
        ${mine ? `<button class="del-link" data-act="del-open" data-id="${m.id}">${I.trash}이 기억 지우기</button>` : `<button class="del-link rep-link" data-act="report-open" data-id="${m.id}">${I.flag}이 기억 신고하기</button>`}</div>
        <div class="detail-bar f-actbar"><button class="heart-btn" data-act="like" data-id="${m.id}" aria-pressed="${liked}" aria-label="마음 ${hearts}">${I.heart}<span>${hearts}</span></button>
          <button class="btn btn-primary" data-act="reply" data-id="${m.id}">답장 남기기</button></div></div>
    </section>`;
  }
  // M10 잠긴 기억 · M10-2 열 수 있음 — 발견 전에는 사진·제목·본문·작성자를 보여 주지 않아요(서버도 보내지 않아요)
  function viewLocked(m) {
    const d = distOf(m), lOk = locOk(), can = canOpen(m), aOk = accOk(), R = S.set.radius;
    let big, sub, chip = "";
    if (!lOk) { big = `<span class="f-dist small">위치 확인 필요</span>`; sub = GEO.state === "asking" ? "지금 위치를 확인하고 있어요" : "지금 어디에 있는지 알아야 열 수 있어요"; }
    else if (!aOk) { big = `<span class="f-dist" id="lockDist">${fmtDist(d)}</span>`; sub = "위치 정확도가 낮아서 지금은 열 수 없어요"; chip = `<span class="f-dir">${I.crosshair}오차 ±${pos().acc}m</span>`; }
    else if (can) { big = `<span class="f-dist" id="lockDist">${fmtDist(d)}</span>`; sub = "열람 반경 안이에요. 지금 열 수 있어요"; chip = `<span class="f-dir">${I.nav}바로 이 근처</span>`; }
    else { const dir = dirOf(m); big = `<span class="f-dist" id="lockDist">${fmtDist(d)}</span>`; sub = `약 ${R}m 안으로 가면 열 수 있어요`; chip = `<span class="f-dir">${I.nav.replace("<svg", `<svg style="transform:rotate(${dir.deg}deg)"`)}${dir.name} · 걸어서 ${walkMin(d)}분</span>`; }
    const label = can ? "열 수 있는 기억" : "잠긴 기억";
    return `<section class="screen f-lock" aria-label="${label}"><div class="f-scroll">
      <div class="f-stage" style="height:440px">${AMB(470)}
        <a class="f-glass" style="left:20px;top:16px" href="#/" data-act="back" aria-label="뒤로">${I.back}</a><h1 class="f-scrlabel">${label}</h1>
        ${ORBIT(70, 58, 250)}${AT(103, 90, 184, BR.seed(can ? "available" : "dormant", 184))}
        <div class="f-lockc">${big}<p id="lockSub">${sub}</p>${chip}</div></div>
      <div class="f-info">
        ${m.hint ? `<div class="f-hint"><span class="tag">HINT</span><p>${esc(m.hint)}</p></div>` : ""}
        <div class="f-urow"><div><b>아직 발견하지 않은 기억</b><span>${esc(m.place)}</span></div>${can ? badge("coral", I.unlock, "열 수 있어요") : badge("lilac", I.lock, "잠김")}</div>
        ${m.secret ? `<div class="f-secretnote"><span class="ic">${I.key}</span><p><b>비밀번호가 걸린 기억이에요</b>심은 사람이 알려 준 비밀번호를 그 장소에서 입력하면 열려요.</p></div>` : ""}
        <p class="f-rule">처음 한 번은 그 장소에서 열 수 있어요. 열고 나면 내 정원에서 어디서든 다시 볼 수 있어요.</p>
        ${lOk ? `<p class="f-acc">${I.crosshair}내 위치 오차 ±${pos().acc}m · 열람 반경 약 ${R}m</p>` : ""}
        ${m.hint ? `<button class="del-link rep-link" data-act="report-open" data-id="${m.id}">${I.flag}힌트 신고하기</button>` : ""}
      </div></div>
      <div class="f-actbar">${!lOk ? `<button class="btn btn-outline" data-act="focus" data-id="${m.id}">지도</button><button class="btn btn-primary" data-act="${GEO.state === "denied" ? "loc-help" : "loc-retry"}">${GEO.state === "denied" ? "위치 권한 켜는 방법" : "위치 다시 확인하기"}</button>`
        : !aOk ? `<button class="btn btn-outline" data-act="focus" data-id="${m.id}">지도</button><button class="btn btn-primary" data-act="loc-retry">위치 다시 확인하기</button>`
        : can ? `<button class="btn btn-outline" data-act="focus" data-id="${m.id}">지도</button><button class="btn btn-primary" data-act="discover" data-id="${m.id}" ${S.busy ? "disabled" : ""}>${I.unlock}${S.busy ? "여는 중…" : "기억 열기"}</button>`
        : DEMO ? `<button class="btn btn-outline" data-act="focus" data-id="${m.id}">지도</button><button class="btn btn-primary" data-act="walk" data-id="${m.id}" id="walkBtn">가까이 걸어가기</button>`
        : `<button class="btn btn-outline" data-act="focus" data-id="${m.id}">지도</button><button class="btn btn-primary" data-act="focus" data-id="${m.id}">가까이 걸어가기</button>`}</div>
    </section>`;
  }
  // 데모 전용: 위치를 기억 쪽으로 옮겨 보는 연출
  function walkTo(m) {
    const btn = document.getElementById("walkBtn"); if (btn) { btn.disabled = true; btn.textContent = "걷는 중…"; }
    const R = S.set.radius; let d = distOf(m);
    const step = Math.max(2, Math.round((d - R) / 22));
    const tick = setInterval(() => {
      d = Math.max(R - 12, d - step);
      const el = document.getElementById("lockDist"), bar = document.getElementById("walkBar"), pc = document.getElementById("walkPct");
      if (!el) { clearInterval(tick); return; }
      const pct = Math.min(100, Math.round(R / d * 100));
      el.textContent = d + "m"; if (bar) bar.style.width = pct + "%"; if (pc) pc.textContent = pct + "%";
      if (d <= R - 12) {
        clearInterval(tick);
        const p = pos(), f = (R - 12) / Math.max(1, GEO.distance(p, m));
        GEO.simulate({ lat: m.lat + (p.lat - m.lat) * f, lng: m.lng + (p.lng - m.lng) * f, acc: 12 });
      }
    }, 70);
  }
  // M11 최초 발견: 서버가 거리·정확도를 확인한 뒤에만 내용을 받아요 → 씨앗이 꽃으로 → 정원 자수 +1
  function discover(id, secret) {
    if (S.busy) return;
    if (!member()) { loginSheet("open"); return; }
    S.busy = true; if (!secret) render();
    API.open(id, pos(), secret).then(r => {
      S.busy = false;
      if (r.status === "secret_required") { render(); secretSheet(id); return; }
      if (r.status === "secret_wrong") { secretSheet(id, `비밀번호가 맞지 않아요. ${r.left}번 더 시도할 수 있어요`); return; }
      if (r.status === "secret_locked") { closeModal(); render(); toast(`여러 번 틀려서 ${r.retry_min || 10}분 뒤에 다시 시도할 수 있어요`); return; }
      if (secret) closeModal();
      if (r.memory) { remember(Object.assign(r.memory, { state: r.memory.mine ? "mine" : "discovered" })); S.status[id] = r.status; }
      if (r.status === "discovered" && r.first) { S.found = id; S.foundN = S.garden ? S.garden.collected.length + 1 : null; S.garden = null; syncMap(); }
      else if (r.status === "too_far") toast(`아직 조금 멀어요 · ${r.distance_m}m (반경 ${r.radius_m}m)`);
      else if (r.status === "low_accuracy") toast("위치 정확도가 낮아서 열 수 없어요. 잠시 뒤 다시 시도해 주세요");
      else if (r.status === "need_location") toast("현재 위치를 확인한 뒤에 열 수 있어요");
      else if (r.status === "login_required") { render(); loginSheet("open"); return; }
      else if (r.status === "gone" || r.status === "unavailable") { S.status[id] = r.status; toast("이 기억은 지금 열 수 없어요"); }
      render();
    }).catch(e => { console.error(e); S.busy = false; render(); toast("기억을 열지 못했어요. 연결을 확인해 주세요"); });
  }
  function viewFound(m) {
    const t = dateParts(m);
    return `<section class="screen f-found" aria-label="기억 발견">${AMB(844)}<button class="f-skip" data-act="found-done" data-id="${m.id}">건너뛰기</button>
      <div class="f-scroll"><div class="f-stage" style="height:430px">${ORBIT(38, 96, 315)}${AT(65, 112, 260, BR.photoOrb(m.photo, 260, true), "pop")}${LUMI(227, 326, 105)}</div>
      <div class="f-copy"><span class="f-kick">MEMORY FOUND</span><h1>새로운 기억이 피어났어요</h1><p class="t">「${esc(m.title)}」</p><p class="d">${t.full} · ${esc(m.place)}</p>
        ${badge("ok", I.check, S.foundN == null ? "모은 기억에 담겼어요 · 정원 자수 한 땀" : S.foundN % BLOOM_N === 0 ? "정원에 꽃 한 송이가 완성됐어요" : `정원 자수 한 땀 · 꽃 완성까지 ${BLOOM_N - S.foundN % BLOOM_N}번 남았어요`)}</div></div>
      <div class="flow-foot"><button class="btn btn-primary btn-block" data-act="found-done" data-id="${m.id}">기억 열어보기</button></div></section>`;
  }

  /* ---------------- SHARE LINK (S01~S04) ---------------- */
  // 링크로는 현장 제한을 우회할 수 없어요. 서버(memory_detail)도 미발견자에게는 장소명·존재·힌트만 줘요.
  function viewShare(id) {
    const st = S.status[id];
    const shell = (orb, body, foot) => `<section class="screen f-share" aria-label="공유 링크">${AMB(480)}<div class="f-scroll">
      <div class="f-stage" style="height:300px"><a class="f-brandbar" href="#/"><img src="${img("cat")}" alt=""><b>기억 정원</b></a>${AT(100, 86, 190, orb)}</div>
      <div class="f-sbody">${body}</div></div><div class="f-sfoot">${foot}</div></section>`;
    const shared = badge("soft", I.share, "공유받은 기억");
    if (S.boot !== "ok" || !st || st === "loading") { if (S.boot === "ok" && st !== "loading") loadDetail(id); return shell(BR.seed("dormant", 190), `${shared}<h1>기억을 확인하는 중…</h1>`, ""); }
    if (st === "error") return errorScreen(id);
    const m = byId(id);
    if (!m || st === "gone" || st === "unavailable") return shell(BR.seed("dormant", 190), `${shared}<h1>현재 열람할 수 없는 기억이에요</h1>
      <div class="f-note sunk">${I.info}<span>기억이 지워졌거나 더 이상 공개되지 않아요. 사진과 이야기는 볼 수 없어요.</span></div>`,
      `<a class="btn btn-primary btn-block" href="#/">지도에서 다른 기억 찾기</a>`);
    if (m.mine) return shell(BR.photoOrb(m.photo, 190), `${badge("soft", I.share, "내가 공유한 기억")}<h1>${esc(m.title)}</h1><p class="f-place">${I.pin}${esc(m.place)} · ${visLabel(m.vis)}</p>
      <div class="f-note sky">${I.info}<span>받은 사람은 이 장소 가까이 와야 처음 열 수 있어요. 링크로는 사진과 이야기를 볼 수 없어요.</span></div>`,
      `<a class="btn btn-primary btn-block" href="#/m/${m.id}">내 기억 보기</a>`);
    if (discovered(m)) return shell(BR.photoOrb(m.photo, 190), `${badge("rose", BR.pinFlower(14), "이미 발견한 기억")}<h1>${esc(m.title)}</h1><p class="f-place">${I.pin}${esc(m.place)}</p>
      <div class="f-note ok">${I.check}<span>내 정원에 담긴 기억이라 어디서든 다시 볼 수 있어요.</span></div>`,
      `<a class="btn btn-primary btn-block" href="#/m/${m.id}">다시 보기</a>`);
    return shell(BR.seed("dormant", 190), `${shared}<h1>이 장소에 아직 발견하지 않은<br>기억이 하나 있어요</h1><p class="f-place">${I.pin}${esc(m.place)}</p>
      ${m.hint ? `<div class="f-hint"><span class="tag">HINT</span><p>${esc(m.hint)}</p></div>` : ""}
      <div class="f-note sky">${I.lock}<span>이 기억은 그 장소 가까이 가야 처음 열 수 있어요. 링크로는 사진과 이야기를 볼 수 없어요.</span></div>`,
      `<button class="btn btn-primary btn-block" data-act="focus" data-id="${m.id}">지도에서 위치 보기</button><a class="btn btn-ghost" href="#/">기억 정원 둘러보기</a>`);
  }

  /* ---------------- PLANT FLOW ---------------- */
  function flowHead(n) {
    return `<header class="flow-head f-flowhead"><a class="icon-btn" href="${n === 1 ? "#/" : "#/plant/" + (n - 1)}" aria-label="${n === 1 ? "닫기" : "이전"}">${n === 1 ? I.close : I.back}</a><span class="stepn">${n}/3</span></header>
      <div class="f-steps" aria-hidden="true">${[1, 2, 3].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</div>`;
  }
  const placeGuess = () => S.region || "";
  function viewPlant(step) {
    const dr = S.draft;
    if (step === "1") return `<section class="screen" aria-label="기억 심기 1단계">${flowHead(1)}<div class="flow-body f-flow">
      <h1 class="flow-title">지금 이 자리를<br>한 장 찍어 주세요<small>꾸민 사진보다 지금 이 순간 그대로가 좋아요. 앨범 사진은 올릴 수 없어요.</small></h1>
      <label class="drop f-drop ${dr.photo ? "has-img" : ""}">${dr.photo ? `<img src="${dr.photo}" alt="찍은 사진"><span class="change">${I.camera}다시 찍기</span>` : `<span class="plus">${I.camera}</span><b>카메라로 찍기</b><span class="s">그 자리에서 찍은 한 장만 남길 수 있어요</span>`}
        <input type="file" accept="image/*" capture="environment" data-act="file" aria-label="카메라로 사진 찍기"></label>
      ${DEMO ? `<p class="samples-label">예시 사진으로 체험하기</p>
      <div class="samples f-samples">${D.samplePhotos.map(p => `<button data-act="sample" data-src="${p}" aria-label="예시 사진" aria-pressed="${dr.photo === p}"><img src="${p}" alt="">${dr.photo === p ? `<i>${I.check}</i>` : ""}</button>`).join("")}</div>` : ""}
      </div><div class="flow-foot"><button class="btn btn-primary btn-block" data-act="go" data-to="#/plant/2" ${dr.photo || dr.noPhoto ? "" : "disabled"}>다음</button>
      <button class="btn btn-ghost" data-act="nophoto">사진 없이 글만 남길게요</button></div></section>`;
    if (step === "2") {
      const n = dr.text.length;
      return `<section class="screen" aria-label="기억 심기 2단계">${flowHead(2)}<div class="flow-body f-flow">
      <h1 class="flow-title">여기서 어떤 일이<br>있었나요?<small>짧아도 괜찮아요. 120자까지 쓸 수 있어요.</small></h1>
      <div class="compose f-compose"><span class="f-cplace">${I.pin}${esc(dr.place || placeGuess() || "지금 있는 곳")}</span>
        <textarea id="story" maxlength="120" placeholder="이 자리에서 있었던 일을 짧게 남겨 주세요" aria-label="이야기">${esc(dr.text)}</textarea>
        <span class="cnt ${n > 110 ? "warn" : ""}" id="cnt">${n}/120</span></div>
      <div class="prompts f-prompts">${D.prompts.map(p => `<button class="chip" data-act="prompt" data-p="${esc(p)}">${esc(p)}…</button>`).join("")}</div>
      </div><div class="flow-foot"><button class="btn btn-primary btn-block" id="next2" data-act="go" data-to="#/plant/3" ${dr.text.trim().length >= 2 ? "" : "disabled"}>다음</button></div></section>`;
    }
    if (step === "3") {
      const lOk = locOk(), aOk = accOk();
      if (!dr.place && placeGuess()) dr.place = placeGuess();
      const ready = aOk && dr.place.trim().length >= 1 && (dr.vis !== "key" || SECRET_OK(dr.secret));
      const opt = (v, ic, t, d) => `<button class="option f-opt" data-act="vis" data-v="${v}" aria-pressed="${dr.vis === v}"><span class="oi">${ic}</span><div><b>${t}</b><span>${d}</span></div><span class="radio">${dr.vis === v ? I.check : ""}</span></button>`;
      return `<section class="screen" aria-label="기억 심기 3단계">${flowHead(3)}<div class="flow-body f-flow">
      <h1 class="flow-title">누구와 이 기억을<br>나눌까요?<small>내가 남긴 기억은 공개 범위와 상관없이 내 정원에서 언제든 다시 볼 수 있어요.</small></h1>
      ${aOk ? `<div class="f-plantplace"><span class="ic">${I.pin}</span><div><b>${esc(dr.place || "지금 있는 곳")}</b><span>지금 여기에 심어요 · 내 위치 오차 ±${pos().acc}m</span></div></div>`
        : `<div class="f-plantplace err" role="alert"><span class="ic">${I.locOff}</span><div><b>${lOk ? `위치 정확도가 낮아요 · ±${pos().acc}m` : "현재 위치를 확인할 수 없어요"}</b><span>${lOk ? `오차가 ${S.set.maxAcc}m 안으로 줄면 심을 수 있어요` : "기억은 지금 서 있는 자리에만 심을 수 있어요"}</span></div><button class="btn btn-soft" data-act="${!lOk && GEO.state === "denied" ? "loc-help" : "loc-retry"}">${!lOk && GEO.state === "denied" ? "방법 보기" : "다시 확인"}</button></div>`}
      <div class="f-opts" role="radiogroup" aria-label="공개 범위">${opt("all", I.users, "모두에게", "이 장소에 가까이 온 누구나 발견할 수 있어요")}${opt("key", I.key, "비밀번호를 아는 사람만", "이 장소에서 비밀번호까지 맞힌 사람만 열 수 있어요")}${opt("me", I.lock, "나만 보기", "다른 사람에게 공개되지 않는 나만의 기억이에요")}</div>
      ${dr.vis === "key" ? `<label class="field f-secretfield"><span>비밀번호 <em>4~20자</em></span><input id="secretText" maxlength="20" value="${esc(dr.secret || "")}" placeholder="함께 나눌 사람에게만 알려 줄 말" autocomplete="off" autocapitalize="off" spellcheck="false"><small>비밀번호는 다시 볼 수 없어요. 알려 줄 사람에게 따로 전해 주세요.</small></label>` : ""}
      <p class="f-noteline">${I.info}심은 뒤에도 내 정원에서 언제든 바꿀 수 있어요.</p>
      <label class="field"><span>장소 이름</span><input id="placeName" maxlength="40" value="${esc(dr.place)}" placeholder="예: 망원동 골목 카페 창가" autocomplete="off"></label>
      <label class="field"><span>발견 힌트 <em>선택</em></span><input id="hintText" maxlength="60" value="${esc(dr.hint)}" placeholder="발견 전에 보여 줄 한 줄. 사진·글은 안 보여요" autocomplete="off"></label>
      </div><div class="flow-foot"><button class="btn btn-primary btn-block" id="plantBtn" data-act="plant" ${ready ? "" : "disabled"}>이 자리에 기억 심기</button></div></section>`;
    }
    if (step === "doing") return `<section class="screen f-doing" aria-label="심는 중" aria-busy="true"><div class="f-stage" style="height:420px">${ORBIT(110, 250, 170)}${AT(125, 265, 140, BR.seed("planted", 140), "breathe")}</div>
      <div class="f-copy"><h2>기억을 심는 중…</h2><p>이 자리에 조심스럽게 묻고 있어요</p></div></section>`;
    if (step === "fail") {
      const e = S.plantErr || "";
      const msg = e === "low_accuracy" ? "위치 정확도가 낮아서 심지 못했어요.<br>잠시 뒤 하늘이 트인 곳에서 다시 시도해 주세요."
        : e === "no_location" ? "현재 위치를 확인할 수 없어 심지 못했어요.<br>위치를 켜고 다시 시도해 주세요."
        : e === "too_many" ? "짧은 시간에 너무 많이 심었어요.<br>1분 뒤에 다시 시도해 주세요."
        : "연결이 불안정해서 확인을 받지 못했어요.<br>쓴 내용은 그대로 남아 있으니 다시 시도해 주세요.";
      return `<section class="screen" aria-label="심기 실패"><header class="flow-head f-flowhead"><a class="icon-btn" href="#/" aria-label="닫기">${I.close}</a></header>
      <div class="f-fail" role="alert"><span class="f-sic err big">${e === "low_accuracy" || e === "no_location" ? I.locOff : I.wifi}</span><h1>아직 심어지지 않았어요</h1><p>${msg}</p>
      ${dr.text ? `<div class="f-draft">${dr.photo ? `<img src="${dr.photo}" alt="">` : `<span class="noimg">${BR.seed("planted", 40)}</span>`}<div><b>${esc(dr.text.slice(0, 40))}${dr.text.length > 40 ? "…" : ""}</b><span>임시 저장됨 · ${dr.vis === "me" ? "나만 보기" : dr.vis === "key" ? "비밀번호" : "모두에게"}</span></div></div>` : ""}</div>
      <div class="flow-foot"><button class="btn btn-primary btn-block" data-act="plant">다시 시도</button><a class="btn btn-ghost" href="#/plant/3">내용 확인하기</a></div></section>`;
    }
    if (step === "done") {
      const m = S.lastPlanted;
      if (!m) { location.hash = "#/"; return ""; }
      return `<section class="screen f-done" aria-label="심기 완료"><div class="f-scroll"><div class="f-stage" style="height:440px">${AMB(440)}<span class="f-wordmark">MEMORY PLANTED</span>
        ${ORBIT(70, 52, 250)}${AT(97, 80, 196, BR.seed("planted", 196), "pop")}${LUMI(272, 60, 87)}${HILLS(290)}<span class="f-sprout">${I.garden}</span></div>
      <div class="f-datecard">${stamp(m)}<div><b>${esc(m.place)}</b>${badge("soft", visIc(m.vis), visLabel(m.vis))}</div></div>
      <div class="f-copy"><h1>기억을 심었어요</h1><p>${m.vis === "me" ? "다른 사람에게는 보이지 않아요.<br>내 정원에서 언제든 다시 볼 수 있어요." : m.vis === "key" ? "비밀번호를 아는 사람이 이 장소에 오면<br>당신의 기억을 발견할 수 있어요." : "누군가 이 장소 가까이 오면<br>당신의 기억을 발견할 수 있어요."}</p></div></div>
      <div class="flow-foot"><a class="btn btn-primary btn-block" href="#/" data-act="after-plant">지도에서 보기</a><a class="btn btn-ghost" href="#/garden">내 정원 보기</a></div></section>`;
    }
    return "";
  }
  function doPlant() {
    const dr = S.draft, p = pos();
    if (!p) { S.plantErr = "no_location"; location.hash = "#/plant/fail"; return; }
    if (!accOk()) { S.plantErr = "low_accuracy"; location.hash = "#/plant/fail"; return; }
    location.hash = "#/plant/doing";
    const story = dr.text.trim(), firstLine = story.split("\n")[0];
    API.plant({
      title: firstLine.length > 22 ? firstLine.slice(0, 22) + "…" : firstLine, story, place: (dr.place || placeGuess() || "이름 없는 장소").trim(), hint: dr.hint.trim(),
      vis: dr.vis, secret: dr.vis === "key" ? dr.secret : undefined, photoBlob: dr.blob, photoDataUrl: dr.photo, pos: { lat: p.lat, lng: p.lng, acc: p.acc }
    }).then(m => {
      S.lastPlanted = remember(Object.assign(m, { state: "mine", mine: true }));
      if (!S.near.some(x => x.id === m.id)) S.near.unshift(m);
      S.garden = null; S.plantErr = null;
      S.draft = { photo: null, blob: null, text: "", vis: "all", place: "", hint: "", noPhoto: false };
      location.hash = "#/plant/done";
    }).catch(e => { console.error(e); if (e.code === "login_required") { location.hash = "#/plant/3"; loginSheet("plant"); return; } if (e.code === "secret_unsupported" || e.code === "bad_secret") { location.hash = "#/plant/3"; toast(e.code === "bad_secret" ? "비밀번호는 4~20자로 정해 주세요" : "비밀번호 기억은 서버 준비가 끝나면 쓸 수 있어요"); return; } S.plantErr = e.code || "net"; location.hash = "#/plant/fail"; });
  }

  /* ---------------- GARDEN (M19 · M20 · M21 · M22) ---------------- */
  // ---- 정원 두 개 (2026-11-25 리마 결정) ----
  // 나의 정원: 내가 심은 기억 3개 = 내 꽃잎 색 꽃 한 송이. 발견의 정원: 발견한 기억 3개 = 한 송이, 꽃잎마다 그 기억을 남긴 사람의 색.
  // 꽃잎 색: 프로필에서 고르는 개인 색(BR.PETALS 8가지). 색을 안 고른 사람은 이름으로 정해진 색.
  const PETAL_KEYS = BR.PETALS.map(p => p[0]);
  const petalOfName = n => { let h = 0; for (const ch of String(n || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return PETAL_KEYS[h % PETAL_KEYS.length]; };
  const myPetal = () => PETAL_KEYS.includes(S.profile.petal) ? S.profile.petal : "bloom";
  const petalOf = m => m.mine ? myPetal() : PETAL_KEYS.includes(m.author && m.author.petal) ? m.author.petal : petalOfName(m.author && m.author.name);
  const petalName = k => (BR.PETALS.find(p => p[0] === k) || [, ""])[1];
  const bedList = kind => { const g = S.garden || { mine: [], collected: [] }; return S.forced === "empty" ? [] : kind === "mine" ? g.mine.slice().reverse() : g.collected; };
  function flowers(list) {
    const out = [];
    for (let i = 0; i < list.length; i += BLOOM_N) out.push(list.slice(i, i + BLOOM_N));
    return out;
  }
  const flowerParts = f => Array.from({ length: BLOOM_N }, (_, k) => !f[k] ? "off" : f[k].gone ? "gone" : petalOf(f[k]));
  function samplerHTML(kind) {
    const list = bedList(kind);
    if (!list.length) return kind === "mine"
      ? `<div class="f-cloth"><div class="f-cloth-empty"><b>첫 기억을 심어 볼까요?</b><span>기억을 ${BLOOM_N}개 심으면 내 색 꽃 한 송이가 피어요</span></div></div>`
      : `<div class="f-cloth"><div class="f-cloth-empty"><b>첫 땀을 놓아 볼까요?</b><span>다른 사람의 기억을 ${BLOOM_N}번 발견하면 꽃 한 송이가 피어요</span></div></div>`;
    return `<div class="f-cloth"><div class="f-cloth-in">${flowers(list).map((f, i) => {
      const done = f.length === BLOOM_N, allGone = f.every(m => m.gone);
      const label = done ? `${i + 1}번째 꽃, 완성${allGone ? ", 더 이상 열람할 수 없는 기억" : ""}` : `${i + 1}번째 꽃, ${f.length}/${BLOOM_N} 수놓음`;
      return `<button class="st${done ? " done" : " grow"}${allGone ? " trace" : ""}" data-act="flower" data-k="${kind}" data-i="${i}" aria-label="${label}">${BR.stitch(78, myPetal(), true, flowerParts(f))}${done ? "" : `<em class="st-n">${f.length}/${BLOOM_N}</em>`}</button>`;
    }).join("")}</div></div>`;
  }
  function openGone() { openModal(`<div class="gone-modal"><span class="ic">${I.info}</span><div><h3>더 이상 열람할 수 없는 기억이에요</h3><p class="av-note" style="margin:0">작성자가 기억을 지웠거나 비공개로 바꿨어요.<br>사진·글·작성자는 볼 수 없고, 발견했던 꽃잎만 흐린 흔적 실로 남아요.</p></div></div><button class="btn btn-soft btn-block" data-act="close">확인</button>`); }
  function flowerSheet(kind, i) {
    const f = flowers(bedList(kind))[i]; if (!f) return;
    const done = f.length === BLOOM_N, PART = ["첫 꽃잎", "둘째 꽃잎", "셋째 꽃잎"];
    const rows = Array.from({ length: BLOOM_N }, (_, k) => {
      const m = f[k];
      if (!m) return `<li class="fl-row off"><span class="fl-part"><i class="fl-dot empty"></i>${PART[k]}</span><div><b>아직 비어 있어요</b><span>${kind === "mine" ? "다음에 심는 기억이 여기에 수놓여요" : "다음에 발견하는 기억이 여기에 수놓여요"}</span></div></li>`;
      if (m.gone) return `<li><button class="fl-row gone" data-act="fl-gone"><span class="fl-part"><i class="fl-dot gone"></i>${PART[k]}</span><div><b>더 이상 열람할 수 없는 기억</b><span>흔적만 남아 있어요</span></div></button></li>`;
      const pk = petalOf(m);
      return `<li><button class="fl-row" data-act="fl-open" data-id="${m.id}"><span class="fl-part"><i class="fl-dot" style="background:var(--st-${pk}-petal,${BR.PAL[pk].petal})"></i>${PART[k]}</span><div><b>${esc(m.title)}</b><span>${kind === "mine" ? esc(m.place) : `${esc(m.author ? m.author.name : "정원사")}의 ${petalName(pk)} 실 · ${esc(m.place)}`}</span></div><i class="fl-go" aria-hidden="true">›</i></button></li>`;
    }).join("");
    const left = BLOOM_N - f.length;
    openModal(`<div class="fl-head">${BR.stitch(64, myPetal(), true, flowerParts(f))}<div><h3>${done ? `${i + 1}번째 꽃` : `피어나는 중인 꽃`}</h3><p class="av-note" style="margin:0">${done ? (kind === "mine" ? `내가 심은 기억 ${BLOOM_N}개로 피운 꽃이에요.` : `기억 ${BLOOM_N}개가 함께 피운 꽃이에요.`) : kind === "mine" ? `${left}번 더 심으면 꽃이 완성돼요.` : `${left}번 더 발견하면 꽃이 완성돼요.`}</p></div></div><ul class="fl-list">${rows}</ul>`);
  }
  function nearbyHTML() {
    const list = S.near.filter(m => m.state === "undiscovered" && !isGone(m)).sort((a, b) => (distOf(a) ?? 1e9) - (distOf(b) ?? 1e9)).slice(0, 3);
    if (!list.length) return "";
    return `<section class="f-nearby" aria-label="근처의 발견 가능한 도안"><div class="h"><b>${I.crosshair}근처의 발견 가능한 도안</b><span>${locOk() ? "지금 위치 기준" : "지도 기준"}</span></div>
      <div class="row">${list.map(m => { const can = canOpen(m), d = distOf(m); return `<button class="f-pat ${can ? "can" : ""}" data-act="open" data-id="${m.id}">${BR.stitch(26, "locked")}<span>${can ? I.unlock : I.lock}<b>${d != null ? fmtDist(d) : "?"}</b><em>${can ? "열 수 있음" : "잠김"}</em></span></button>`; }).join("")}</div>
      <p>위치가 바뀌면 이 목록은 달라져요.<br>위의 발견의 정원은 그대로 남아요.</p></section>`;
  }
  function gardenCount(list) {
    if (!list.length) return "아직 비어 있어요";
    const doneN = Math.floor(list.length / BLOOM_N), left = BLOOM_N - list.length % BLOOM_N;
    return (doneN ? `${doneN}송이 완성` : "") + (left < BLOOM_N ? `${doneN ? " · " : ""}다음 꽃까지 ${left}번` : "");
  }
  function viewGarden() {
    if (!S.garden && S.gardenState !== "loading" && S.gardenState !== "error") loadGarden();
    const g = S.garden || { mine: [], collected: [] };
    const gs = S.forced === "loading" ? "loading" : S.forced === "error" ? "error" : S.gardenState === "error" && !S.garden ? "error" : !S.garden ? "loading" : "ok";
    const mine = S.forced === "empty" ? [] : g.mine, colAll = S.forced === "empty" ? [] : g.collected;
    const col = colAll.filter(m => !m.gone);
    const tab = S.gardenTab, list = tab === "mine" ? mine : col;
    const received = mine.reduce((a, m) => a + (m.hearts || 0), 0);
    const grid = gs === "loading" ? [1, 2].map(() => `<span class="polaroid f-tile sk-card" aria-hidden="true"><span class="sk" style="aspect-ratio:1;border-radius:10px"></span><span class="sk" style="height:14px;width:70%"></span></span>`).join("")
      : gs === "error" ? stateBlock("err", I.wifi, "정원을 불러오지 못했어요", "심은 기억과 모은 기억은 그대로 있어요. 연결을 확인하고 다시 시도해 주세요.", `<button class="btn btn-outline f-sbtn" data-act="garden-retry">다시 시도</button>`)
      : list.length ? list.map(m => `<button class="polaroid f-tile" data-act="open" data-id="${m.id}">${m.photo ? `<img src="${esc(m.photo)}" alt="" loading="lazy">` : `<span class="noimg">${BR.seed("planted", 90)}</span>`}<b>${esc(m.title)}</b><span>${esc(m.place)}</span>${m.mine && m.vis === "me" ? `<i class="vis-me">${I.lock}나만 보기</i>` : m.mine && m.vis === "key" ? `<i class="vis-me">${I.key}비밀번호</i>` : ""}</button>`).join("")
      : tab === "mine" ? stateBlock("soft", I.garden, "아직 심은 기억이 없어요", "좋아하는 장소에서 첫 기억을 심어 보세요. 그 자리에 온 누군가가 발견할 거예요.", `<a class="btn btn-primary f-sbtn" href="#/plant/1">첫 기억 심기</a>`)
        : stateBlock("soft", I.map, "아직 모은 기억이 없어요", "지도에서 가까운 기억을 찾아가 열어 보세요.", `<a class="btn btn-primary f-sbtn" href="#/">지도 보기</a>`);
    // 프로필 수정은 이름 아래 '프로필 바꾸기' 버튼 하나로 모아요(사진·이름 옆 연필 버튼 없음)
    const av = S.avatar === "me"
      ? `<span class="f-av"><img src="${img("me")}" alt="내 프로필"></span>`
      : `<span class="f-av f-av-none"><img src="${AV_DEFAULT}" alt=""></span>`;
    return `<section class="screen f-garden" aria-label="내 정원"><div class="scroll" id="gardenScroll">
      <header class="f-ghead">${AMB(250)}${HILLS(60)}${av}
        <div class="f-prof"><h1>${esc(S.profile.nickname)}의 정원</h1><p>${S.region ? esc(S.region) + "에서 " : ""}기억을 모으는 중</p><button class="f-profbtn" data-act="profile-open">${I.edit}${S.avatar === "me" ? "프로필 바꾸기" : "프로필 만들기"}</button></div>
        <a class="f-glass f-themebtn" href="#/settings" aria-label="설정">${I.gear}</a>
        <div class="f-stats"><div><b>${mine.length}</b><span>심은 기억</span></div><div><b>${col.length}</b><span>발견한 기억</span></div><div><b>${received}</b><span>받은 마음</span></div></div></header>
      <div class="seg f-seg f-bedtabs" role="group" aria-label="정원 전환"><button data-act="gtab" data-t="mine" aria-pressed="${tab === "mine"}">나의 정원 ${mine.length}</button><button data-act="gtab" data-t="col" aria-pressed="${tab === "col"}">발견의 정원 ${col.length}</button></div>
      <section class="f-gsec" aria-label="${tab === "mine" ? "나의 정원" : "발견의 정원"}"><div class="f-sech"><h2>${tab === "mine" ? `나의 정원 <button class="f-mypetal" data-act="profile-open" aria-label="내 꽃잎 색 ${petalName(myPetal())}, 바꾸기"><i style="background:var(--st-${myPetal()}-petal,${BR.PAL[myPetal()].petal})"></i>${petalName(myPetal())}</button>` : "발견의 정원"}</h2><i></i><span>${gardenCount(tab === "mine" ? mine : colAll)}</span></div>
        <p class="f-bednote">${tab === "mine" ? `내가 심은 기억 ${BLOOM_N}개가 내 색 꽃 한 송이가 돼요.` : `발견한 기억 ${BLOOM_N}개가 한 송이가 돼요.<br>꽃잎마다 그 기억을 남긴 사람의 색으로 수놓여요.`}</p>
        ${samplerHTML(tab === "mine" ? "mine" : "col")}${tab === "col" ? nearbyHTML() : ""}</section>
      <div class="f-listh"><h2>${tab === "mine" ? "내가 심은 기억" : "발견한 기억"}</h2></div>
      <div class="grid f-grid">${grid}</div></div>${tabbar("garden")}</section>`;
  }
  // M31 화면 테마 — 하나만 고를 수 있고, 바꿔도 화면·위치·글·캐릭터·자수는 그대로
  const THEMES = [["system", "phone", "시스템 설정 따르기", "기기의 라이트/다크 설정에 맞춰요"], ["day", "sun", "낮 테마 · Dusk Paper", "항상 낮 화면으로 봐요"], ["night", "moon", "밤 테마 · Night Garden", "항상 밤 화면으로 봐요"], ["auto", "clock", "시간대에 따라 자동", "해 질 녘엔 밤, 해 뜰 녘엔 낮으로 바뀌어요"]];
  function themeSheet() {
    openModal(`<h3>화면 테마</h3><div class="theme-opts f-themeopts" role="radiogroup" aria-label="화면 테마">${THEMES.map(([k, ic, t, d]) => `<button class="option" role="radio" data-act="theme-set" data-v="${k}" aria-checked="${S.theme === k}" aria-pressed="${S.theme === k}"><span class="oi">${I[ic]}</span><div><b>${t}</b><span>${d}</span></div><span class="radio"></span></button>`).join("")}</div>
      <p class="reassure">하나만 고를 수 있어요. 테마를 바꿔도 보던 화면, 지도 위치, 쓰던 글, 내 캐릭터와 정원 자수는 그대로예요.</p>`);
  }
  /* ---------------- 프로필 바꾸기: 캐릭터 · 사진 · 이름 ---------------- */
  function profileSheet() {
    const has = S.avatar === "me";
    openModal(`<div class="prof-head"><span class="prof-pic"><img src="${img(has ? "me" : "")}" alt="지금 프로필"></span><div><h3>${esc(S.profile.nickname)}</h3><p class="av-note" style="margin:0">다른 사람이 내 기억을 발견하면<br>이 프로필과 이름이 보여요.</p></div></div>
      <div class="prof-opts">
        ${S.look ? `<button class="option" data-act="set-avatar"><span class="oi">${I.edit}</span><div><b>지금 캐릭터 고치기</b><span>저장해 둔 캐릭터에서 파츠만 바꿔요</span></div></button>
        <button class="option" data-act="set-avatar" data-v="new"><span class="oi">${I.plus}</span><div><b>새 캐릭터 만들기</b><span>기본 모습부터 다시 꾸며요.<br>저장하기 전까지 지금 캐릭터는 그대로예요.</span></div></button>`
        : `<button class="option" data-act="set-avatar"><span class="oi">${I.edit}</span><div><b>캐릭터 만들기</b><span>머리·옷·신발을 골라 나만의 캐릭터를 만들어요</span></div></button>`}
        <label class="option"><span class="oi">${I.camera}</span><div><b>사진으로 바꾸기</b><span>앨범에서 사진 한 장을 골라요</span></div><input type="file" accept="image/*" data-act="prof-photo" aria-label="프로필 사진 고르기" hidden></label>
        <div class="petal-pick"><b>내 꽃잎 색</b><span>나의 정원의 꽃과, 다른 사람의 발견의 정원에 놓인<br>내 꽃잎이 이 색이에요</span>
          <div class="petal-row" role="radiogroup" aria-label="내 꽃잎 색">${BR.PETALS.map(([k, n]) => `<button role="radio" aria-checked="${myPetal() === k}" aria-label="${n}" data-act="petal-set" data-v="${k}" style="--pc:var(--st-${k}-petal,${BR.PAL[k].petal})"><i></i><span>${n}</span></button>`).join("")}</div></div>
        <button class="option" data-act="nick"><span class="oi">${I.users}</span><div><b>정원 이름 바꾸기</b><span>지금 이름 · ${esc(S.profile.nickname)}</span></div></button>
      </div><button class="btn btn-ghost" data-act="close">닫기</button>`);
  }
  // 사진은 가운데를 정사각형으로 잘라 400px PNG로 올려요(촬영 정보 등 메타데이터는 남지 않아요)
  function squarePhoto(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => { const n = Math.min(im.naturalWidth, im.naturalHeight), c = document.createElement("canvas"); c.width = c.height = 400;
        c.getContext("2d").drawImage(im, (im.naturalWidth - n) / 2, (im.naturalHeight - n) / 2, n, n, 0, 0, 400, 400); URL.revokeObjectURL(url); res(c.toDataURL("image/png")); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
      im.src = url;
    });
  }
  function setProfilePhoto(file) {
    squarePhoto(file).then(url => {
      S.portrait = url; S.avatar = "me"; store.set("avatar", "me"); store.set("portrait", url);
      closeModal(); render(); toast("프로필 사진을 바꿨어요");
      return API.uploadAvatar(url).then(u => { S.profile.avatar = "me"; S.profile.avatar_url = u; S.portrait = u; store.set("portrait", u); });
    }).catch(e => { console.warn("[profile photo]", e); toast("이 사진은 쓸 수 없어요. 다른 사진(JPG·PNG)을 골라 주세요"); });
  }

  /* ---------------- 설정 ---------------- */
  function viewSettings() {
    const row = (ic, t, sub, right, act) => `<${act ? `button data-act="${act}"` : "div"} class="set-row">${ic ? `<span class="set-ic">${ic}</span>` : ""}<span class="set-tx"><b>${t}</b>${sub ? `<small>${sub}</small>` : ""}</span>${right || ""}</${act ? "button" : "div"}>`;
    const chev = `<i class="set-go" aria-hidden="true">›</i>`;
    const name = !DEMO && API.member() ? API.memberName() : null;
    const byMail = !DEMO && API.member() && typeof API.memberProvider === "function" && API.memberProvider() === "email";
    const account = DEMO ? row(I.info, "데모 모드", "기록은 이 기기에만 저장돼요")
      : API.member() ? (byMail ? row(MAIL_ICON, "이메일로 로그인됨", esc(API.memberEmail() || "")) : row(KAKAO_ICON, "카카오 계정으로 로그인됨", esc(name || API.memberEmail() || ""))) + row("", "다른 계정으로 로그인", "", chev, "switch-open") + row("", "로그아웃", "", chev, "logout-open")
      : row(I.info, "임시 정원이에요", "로그인하지 않아서 이 기기에서만 볼 수 있어요") + `<div class="set-pad set-btns">${kakaoBtn("카카오로 로그인")}${emailBtn("이메일로 로그인")}</div>`;
    const geo = GEO.state === "ok" ? "켜짐" : GEO.state === "denied" ? "꺼짐 · 브라우저 설정에서 켤 수 있어요" : GEO.state === "asking" ? "확인 중" : "아직 사용하지 않음";
    return `<section class="screen f-settings" aria-label="설정"><header class="flow-head f-flowhead"><a class="icon-btn" href="#/garden" aria-label="뒤로">${I.back}</a><h1 class="set-title">설정</h1><span style="width:44px"></span></header>
      <div class="scroll set-body">
        <section class="set-sec" aria-label="프로필"><h2>프로필</h2><div class="set-card"><button class="set-row set-prof" data-act="profile-open"><span class="set-pic"><img src="${img(S.avatar === "me" ? "me" : "")}" alt=""></span><span class="set-tx"><b>${esc(S.profile.nickname)}</b><small>캐릭터·사진·이름 바꾸기</small></span>${chev}</button></div></section>
        <section class="set-sec" aria-label="계정"><h2>계정</h2><div class="set-card">${account}</div></section>
        <section class="set-sec" aria-label="화면 테마"><h2>화면 테마</h2><div class="theme-opts f-themeopts" role="radiogroup" aria-label="화면 테마">${THEMES.map(([k, ic, t, d]) => `<button class="option" role="radio" data-act="theme-set" data-v="${k}" aria-checked="${S.theme === k}" aria-pressed="${S.theme === k}"><span class="oi">${I[ic]}</span><div><b>${t}</b><span>${d}</span></div><span class="radio"></span></button>`).join("")}</div></section>
        <section class="set-sec" aria-label="위치와 알림"><h2>위치와 알림</h2><div class="set-card">${row(I.crosshair, "위치 사용", geo, GEO.state === "ok" ? "" : chev, GEO.state === "ok" ? "" : "loc")}${!DEMO && API.member() && API.memberEmail() ? row("", "이메일 소식 받기", `선택 · ${S.mkt ? "동의함" : "받지 않음"}`, `<span class="av-switch" role="switch" aria-checked="${!!S.mkt}"></span>`, "mkt-toggle") : ""}</div>
          <p class="set-note">현재 위치는 가까운 기억을 찾고, 열고, 심을 때 사용해요.</p></section>
      </div></section>`;
  }
  function isNight() {
    const t = S.theme;
    if (t === "night") return true; if (t === "day") return false;
    if (t === "auto") { const h = new Date().getHours(); return h >= 18 || h < 6; }
    return !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function applyTheme() {
    const n = isNight();
    document.documentElement.setAttribute("data-theme", n ? "night" : "day");
    const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.content = n ? "#17182F" : "#FBF6EE";
  }
  // 비밀번호 기억 열기: 현장(반경 안)에서 서버가 거리 확인 → 비밀번호 확인
  function secretSheet(id, err) {
    openModal(`<div class="secret-sheet"><span class="secret-ic">${I.key}</span><h3>비밀번호가 걸린 기억이에요</h3>
      <p class="sub">심은 사람이 알려 준 비밀번호를 입력해 주세요.</p>
      <label class="field"><input id="secretOpen" maxlength="20" placeholder="비밀번호" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="비밀번호" aria-invalid="${!!err}"></label>
      ${err ? `<p class="secret-err" role="alert">${esc(err)}</p>` : ""}
      <button class="btn btn-primary btn-block" id="secretOpenBtn" data-act="secret-submit" data-id="${id}" disabled>${I.unlock}기억 열기</button><button class="btn btn-ghost" data-act="close">취소</button></div>`);
    setTimeout(() => { const i = document.getElementById("secretOpen"); if (i) i.focus(); }, 60);
  }
  // 신고: 다른 사람 기억(또는 발견 전 힌트)
  const REPORT_REASONS = [["spam", "스팸·광고"], ["abuse", "욕설·혐오·괴롭힘"], ["privacy", "개인정보가 드러나요"], ["sexual", "불쾌하거나 위험한 사진·글"], ["other", "그 밖의 이유"]];
  function reportSheet(id, pick) {
    openModal(`<h3>이 기억을 신고할까요?</h3><p class="sub">신고하면 이 기억은 나에게 더 이상 보이지 않아요.<br>여러 사람이 신고하면 확인할 때까지 모두에게 숨겨져요.</p>
      <div class="f-opts rep-opts" role="radiogroup" aria-label="신고 이유">${REPORT_REASONS.map(([k, t]) => `<button class="option f-opt" data-act="report-pick" data-id="${id}" data-v="${k}" aria-pressed="${pick === k}"><div><b>${t}</b></div><span class="radio">${pick === k ? I.check : ""}</span></button>`).join("")}</div>
      <button class="btn btn-primary btn-block" data-act="report-send" data-id="${id}" data-v="${pick || ""}" ${pick ? "" : "disabled"}>신고하기</button><button class="btn btn-ghost" data-act="close">취소</button>`);
  }
  function reportDone(id) {
    S.near = S.near.filter(m => m.id !== id); delete S.cache[id]; S.status[id] = "unavailable"; S.garden = null; S.selected = null;
    closeModal(); location.hash = "#/"; syncMap(); toast("신고했어요. 이 기억은 이제 보이지 않아요");
  }
  // 비밀번호 새로 정하기(내 기억 공개 범위 → 비밀번호를 아는 사람만)
  function secretNewSheet(id) {
    openModal(`<div class="secret-sheet"><span class="secret-ic">${I.key}</span><h3>비밀번호를 정해 주세요</h3>
      <p class="sub">이 장소에서 비밀번호까지 맞힌 사람만 열 수 있어요.<br>이미 발견한 사람은 그대로 다시 볼 수 있어요.</p>
      <label class="field"><input id="secretNew" maxlength="20" placeholder="4~20자" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="새 비밀번호"></label>
      <p class="fine">비밀번호는 다시 볼 수 없어요. 알려 줄 사람에게 따로 전해 주세요.</p>
      <button class="btn btn-primary btn-block" id="secretNewBtn" data-act="secret-set" data-id="${id}" disabled>이 비밀번호로 바꾸기</button><button class="btn btn-ghost" data-act="close">취소</button></div>`);
    setTimeout(() => { const i = document.getElementById("secretNew"); if (i) i.focus(); }, 60);
  }
  function applyVis(id, v, secret) {
    const m = byId(id), prev = m ? m.vis || "all" : "all";
    return API.setVisibility(id, v, secret, prev).then(() => { [byId(id), S.cache[id]].forEach(x => { if (x) x.vis = v; }); if (S.garden) S.garden.mine.forEach(x => { if (x.id === id) x.vis = v; }); closeModal(); render(); toast(v === "me" ? "나만 보기로 바꿨어요" : v === "key" ? "비밀번호를 아는 사람만 열 수 있게 바꿨어요" : "모두에게 공개했어요"); })
      .catch(err => { console.error(err); closeModal(); toast(err && err.code === "PGRST202" ? "비밀번호 기억은 서버 준비가 끝나면 쓸 수 있어요" : "공개 범위를 바꾸지 못했어요"); });
  }
  // M32-2 · M32-3 공개 범위 변경(양방향) — 바꾸기 전에 꼭 안내
  function visSheet(id) {
    const m = byId(id); if (!m) return;
    const cur = m.vis || "all";
    openModal(`<h3>공개 범위</h3>
      <button class="option" data-act="vis-pick" data-id="${id}" data-v="all" aria-pressed="${cur === "all"}"><span class="oi">${I.users}</span><div><b>모두에게 공개</b><span>이 장소 가까이 온 사람이 발견할 수 있어요</span></div><span class="radio"></span></button>
      <button class="option" data-act="vis-pick" data-id="${id}" data-v="key" aria-pressed="${cur === "key"}"><span class="oi">${I.key}</span><div><b>비밀번호를 아는 사람만</b><span>${cur === "key" ? "비밀번호를 새로 바꾸려면 다시 눌러 주세요" : "이 장소에서 비밀번호까지 맞힌 사람만 열 수 있어요"}</span></div><span class="radio"></span></button>
      <button class="option" data-act="vis-pick" data-id="${id}" data-v="me" aria-pressed="${cur === "me"}"><span class="oi">${I.lock}</span><div><b>나만 보기</b><span>나만 볼 수 있어요. 지도에도 보이지 않아요</span></div><span class="radio"></span></button>`);
  }
  function visConfirm(id, v) {
    const toMe = v === "me";
    openModal(`<h3>${toMe ? "나만 보기로 바꿀까요?" : "모두에게 공개할까요?"}</h3>
      <ul class="confirm-list">${toMe ? `<li>새로 발견하는 사람이 없어져요.</li><li>이미 발견한 사람도 다시 볼 수 없어요. 그 사람의 정원에는 누구의 기억인지 알 수 없는 회색 자수 흔적만 남아요.</li><li>공유한 링크로도 열 수 없어요.</li>`
        : `${(byId(id) || {}).vis === "key" ? "<li>비밀번호가 없어져서 누구나 발견할 수 있어요.</li>" : ""}<li>이 장소 가까이 온 사람이 처음 발견할 수 있게 돼요.</li><li>사진과 이야기는 현장에서 처음 열 때만 보여요. 링크로는 열 수 없어요.</li><li>예전에 이 기억을 발견했던 사람은 다시 볼 수 있게 돼요.</li>`}</ul>
      <button class="btn btn-primary btn-block" data-act="vis-apply" data-id="${id}" data-v="${v}">${toMe ? "나만 보기로 바꾸기" : "공개하기"}</button><button class="btn btn-ghost" data-act="close">취소</button>`);
  }
  function delConfirm(id) {
    openModal(`<h3>이 기억을 지울까요?</h3>
      <ul class="confirm-list"><li>사진과 이야기, 받은 답장이 모두 지워지고 되돌릴 수 없어요.</li><li>이 기억을 발견했던 사람의 정원에는 누구의 기억인지 알 수 없는 회색 자수 흔적만 남아요.</li></ul>
      <button class="btn btn-danger btn-block" data-act="del-apply" data-id="${id}">지우기</button><button class="btn btn-ghost" data-act="close">취소</button>`);
  }

  /* ---------------- AVATAR · 내 캐릭터 꾸미기 ---------------- */
  // 파츠 합성(js/avatar.js + assets/avatar)은 이 화면에 들어올 때만 불러와요.
  const AV = { mod: null, stage: null, draft: null, base: null, hist: [], tab: null, status: "idle", err: "", thumbs: {}, job: 0 };
  const AV_TABS = [["face", "얼굴"], ["hair", "헤어"], ["top", "상의"], ["bottom", "하의"], ["shoes", "신발"]];
  const avFirst = () => !S.look || S.forced === "empty";
  const avDirty = () => AV.draft && JSON.stringify(AV.draft) !== JSON.stringify(AV.base);
  function avTeardown() { if (AV.stage) { AV.stage.dispose(); AV.stage = null; } AV.job++; }

  function viewAvatar() {
    return `<section class="screen av" aria-label="내 캐릭터 꾸미기">
      <header class="av-head"><button class="icon-btn" data-act="av-back" aria-label="뒤로">${I.back}</button><h1>${route().arg === "new" ? "새 캐릭터 만들기" : "내 캐릭터 꾸미기"}</h1><button class="icon-btn" data-act="av-random" aria-label="무작위로 꾸미기" id="avRand" disabled>${I.dice}</button></header>
      <div class="av-stage"><canvas id="avCanvas" role="img" aria-label="내 캐릭터 미리보기"></canvas>
        <div class="av-veil" id="avVeil"></div>
        <div class="av-ctrl" id="avCtrl" hidden>
          <button class="av-mini av-u" data-act="av-undo" id="avUndo" aria-label="되돌리기" disabled>${I.undo}</button></div>
      </div>
      <div class="av-panel"><div class="av-tabs" role="tablist" aria-label="꾸밀 부분" id="avTabs"></div><div class="av-body" id="avBody" role="tabpanel"></div>
        <div class="av-foot"><button class="btn btn-primary btn-block" data-act="av-save" id="avSave" disabled>이 모습으로 저장</button></div></div>
    </section>`;
  }
  function avVeil(kind) {
    const v = document.getElementById("avVeil"); if (!v) return;
    v.hidden = !kind;
    if (kind === "loading") v.innerHTML = `<div class="av-ghost" aria-hidden="true"><i></i><b></b></div><p class="av-wait">옷장을 여는 중이에요…</p>`;
    else if (kind === "error") v.innerHTML = `<div class="state"><span class="icon">${I.alert}</span><h3>${AV.err === "webgl" ? "이 브라우저에서는 꾸미기를 열 수 없어요" : "꾸미기 화면을 불러오지 못했어요"}</h3>
      <p>${AV.err === "webgl" ? "그림을 겹쳐 그리는 기능을 지원하지 않는 브라우저예요." : (S.look ? "지금 쓰는 캐릭터는 그대로예요. " : "") + "연결을 확인하고 다시 시도해 주세요."}</p>
      ${AV.err === "webgl" ? "" : `<div class="actions"><button class="btn btn-soft" data-act="av-retry">다시 시도</button></div>`}</div>`;
  }
  function mountAvatar() {
    avTeardown();
    const job = AV.job;
    // #/avatar = 지금 캐릭터에서 이어 고치기, #/avatar/new = 기본 모습부터 새로 만들기(저장 전엔 지금 캐릭터 그대로)
    const fresh = route().arg === "new";
    AV.draft = Object.assign({}, (!fresh && S.look) || (AV.mod ? AV.mod.DEFAULT_LOOK : null));
    AV.base = S.look ? Object.assign({}, S.look) : null; AV.hist = [];
    if (!AV.tab) AV.tab = "face";
    AV.status = "loading"; AV.err = "";
    avTabs(); avBodyLoading(); avVeil("loading");
    if (S.forced === "loading") return;                                   // 데모: 로딩 상태 고정
    if (S.forced === "error") { AV.err = "net"; avFail(); return; }      // 데모: 오류 상태
    import("./avatar.js").then(m => {
      if (job !== AV.job) return;
      if (!m.supported()) { AV.mod = m; AV.err = "webgl"; avFail(); return; }
      return m.load().then(() => m);
    }).then(m => {
      if (!m || job !== AV.job || AV.status === "error") return;
      AV.mod = m;
      AV.draft = m.normalizeLook(fresh ? null : S.look);
      AV.base = S.look ? m.normalizeLook(S.look) : null;
      try { AV.stage = m.createStage(document.getElementById("avCanvas"), AV.draft); }
      catch (e) { AV.err = "webgl"; avFail(); return; }
      AV.status = "ready"; avVeil(null);
      document.getElementById("avCtrl").hidden = false; document.getElementById("avRand").disabled = false;
      avPanel(); avSync();
    }).catch(() => { if (job !== AV.job) return; AV.err = "net"; avFail(); });
  }
  function avFail() {
    AV.status = "error"; avVeil("error");
    const b = document.getElementById("avBody"); if (!b) return;
    document.getElementById("avTabs").innerHTML = "";
    b.innerHTML = `<div class="av-sec"><p class="av-note">${AV.err === "webgl" ? "다른 브라우저나 기기에서 열면 캐릭터를 만들 수 있어요." : "다시 시도해도 안 되면 잠시 뒤에 다시 들어와 주세요."}</p></div>`;
    document.getElementById("avSave").parentNode.style.display = "none";
  }
  function avTabs() {
    const t = document.getElementById("avTabs"); if (!t) return;
    t.innerHTML = AV_TABS.map(([k, n]) => `<button role="tab" data-act="av-tab" data-t="${k}" aria-selected="${AV.tab === k}">${n}</button>`).join("");
  }
  function avBodyLoading() {
    const b = document.getElementById("avBody"); if (!b) return;
    b.innerHTML = `<div class="av-sec"><h3><b class="sk-line"></b></h3><div class="av-grid">${'<span class="av-tile" aria-hidden="true"><span class="th sk"></span><span class="nm sk-line"></span></span>'.repeat(8)}</div></div>`;
  }
  function avTile(k, p, focus, tall) {
    const on = AV.draft[k] === p.id;
    return `<button class="av-tile" data-act="av-set" data-k="${k}" data-v="${p.id}" aria-pressed="${on}"><span class="th sk${tall ? " tall" : ""}"><img alt="" data-th="${focus}" data-k="${k}" data-v="${p.id}"></span><span class="nm">${esc(p.name)}</span></button>`;
  }
  function avSw(k, list, label) {
    return `<div class="av-sws" role="group" aria-label="${label}">${list.map((c, i) => {
      const orig = c === "orig", sw = orig ? AV.mod.origColor(AV.draft, k) : c;
      return `<button class="av-sw${orig ? " av-sw-orig" : ""}" data-act="av-set" data-k="${k}" data-v="${c}" style="--sw:${sw}" aria-pressed="${AV.draft[k].toLowerCase() === c.toLowerCase()}" aria-label="${orig ? `${label} 원래 색` : `${label} ${i}`}"><i></i></button>`;
    }).join("")}</div>`;
  }
  const avName = (k, id) => (AV.mod.PARTS[k].find(p => p.id === id) || {}).name || "";
  function avPanel() {
    const b = document.getElementById("avBody"); if (!b || !AV.mod) return;
    const m = AV.mod, P = m.PARTS, L = AV.draft, keep = b.scrollTop, t = AV.tab;
    const sec = (title, cur, inner) => `<section class="av-sec"><h3>${title}${cur ? `<span>${esc(cur)}</span>` : ""}</h3>${inner}</section>`;
    const grid = (k, focus) => `<div class="av-grid">${P[k].map(p => avTile(k, p, focus)).join("")}</div>`;
    let h = "";
    if (t === "face") {
      h = (avFirst() ? `<div class="av-intro"><img src="${img("cat")}" alt=""><div><b>나만의 캐릭터를 만들어 볼까요?</b><p>얼굴부터 신발까지 하나씩 골라 보세요. 막히면 위의 주사위로 섞어 봐도 돼요.</p></div></div>` : "")
        + sec("피부색", "", avSw("skin", m.PAL.skin, "피부색"))
        + sec("눈", avName("eyes", L.eyes), `<div class="av-grid">${P.eyes.map(p => avTile("eyes", p, "face")).join("")}</div>`)
        + sec("입", avName("mouth", L.mouth), `<div class="av-grid">${P.mouth.map(p => avTile("mouth", p, "face")).join("")}</div>`)
        + `<section class="av-sec av-row"><h3>볼터치</h3><button class="av-switch" role="switch" data-act="av-set" data-k="blush" data-v="${!L.blush}" aria-checked="${!!L.blush}" aria-label="볼터치"></button></section>`;
    } else if (t === "hair") {
      h = sec("헤어스타일", avName("hair", L.hair), grid("hair", "head")) + sec("머리색", "", avSw("hairColor", m.PAL.hair, "머리색"));
    } else if (t === "top") {
      h = sec("상의", avName("top", L.top), grid("top", "top")) + sec("색", "", avSw("topColor", m.PAL.cloth, "상의 색"));
    } else if (t === "bottom") {
      h = sec("하의", avName("bottom", L.bottom), grid("bottom", "bottom")) + sec("색", "", avSw("bottomColor", m.PAL.bottom, "하의 색"));
    } else if (t === "shoes") {
      h = sec("신발", avName("shoes", L.shoes), grid("shoes", "shoes")) + sec("색", "", avSw("shoeColor", m.PAL.shoe, "신발 색"));
    }
    b.innerHTML = h; b.scrollTop = keep;
    avThumbs();
  }
  // 썸네일은 화면을 막지 않게 몇 개씩 나눠서 그려요. 같은 조합은 다시 그리지 않아요.
  function avThumbs() {
    const job = AV.job, imgs = [...document.querySelectorAll("#avBody img[data-th]")];
    const next = () => {
      if (job !== AV.job || !AV.mod) return;
      const batch = imgs.splice(0, 3);
      batch.forEach(el => {
        let look = AV.draft;
        if (el.dataset.k) look = Object.assign({}, AV.draft, { [el.dataset.k]: el.dataset.v });
        const f = el.dataset.th, key = f + JSON.stringify(look);
        try {
          if (!AV.thumbs[key]) AV.thumbs[key] = f === "face" ? AV.mod.faceThumb(look) : AV.mod.snapshot(look, f, f === "full" ? 132 : 112, f === "full" ? 176 : 112);
          el.src = AV.thumbs[key]; el.parentNode.classList.remove("sk");
        } catch (e) { el.parentNode.classList.remove("sk"); el.parentNode.classList.add("th-off"); }
      });
      if (imgs.length) setTimeout(next, 16);
    };
    setTimeout(next, 30);
  }
  function avSync() {
    const u = document.getElementById("avUndo"), s = document.getElementById("avSave");
    if (u) u.disabled = !AV.hist.length;
    if (s) { const can = avFirst() || avDirty(); s.disabled = !can; s.textContent = can ? "이 모습으로 저장" : "지금 모습으로 저장되어 있어요"; }
  }
  function avApply(next) {
    AV.hist.push(AV.draft); if (AV.hist.length > 40) AV.hist.shift();
    AV.draft = next; AV.stage && AV.stage.setLook(next); avPanel(); avSync();
  }
  function avSave(thenGo) {
    const s = document.getElementById("avSave");
    if (!AV.mod || !AV.draft) return;
    if (s) { s.disabled = true; s.textContent = "저장하는 중…"; }
    setTimeout(() => {
      let url;
      try { url = AV.mod.snapshot(AV.draft, "portrait", 272, 520); }
      catch (e) { avSync(); toast("캐릭터 사진을 만들지 못했어요. 다시 눌러 주세요"); return; }
      const ok = store.set("look", AV.draft) & store.set("portrait", url) & store.set("avatar", "me");
      S.look = Object.assign({}, AV.draft); S.portrait = url; S.avatar = "me"; AV.base = Object.assign({}, AV.draft);
      // 다른 사람이 내 기억을 발견했을 때 보일 작성자 그림(공개 버킷). 실패해도 이 기기에서는 그대로 보여요.
      API.uploadAvatar(url).then(u => { S.profile.avatar = "me"; S.profile.avatar_url = u; }).catch(e => console.warn("[avatar upload]", e));
      API.saveLook(Object.assign({}, AV.draft)).catch(e => console.warn("[look save]", e));
      toast(ok ? "내 캐릭터를 저장했어요" : "이 기기에 저장하지 못해서, 이번 방문 동안만 유지돼요");
      location.hash = thenGo || "#/garden";
    }, 40);
  }
  function avLeave() {
    if (AV.status === "ready" && avDirty()) {
      openModal(`<h3>꾸민 모습을 저장할까요?</h3><p class="av-note" style="margin:0">저장하지 않고 나가면 이번에 바꾼 내용은 사라져요.</p>
        <button class="btn btn-primary btn-block" data-act="av-save-leave">저장하고 나가기</button><button class="btn btn-ghost" data-act="av-discard">저장하지 않고 나가기</button>`);
    } else location.hash = "#/garden";
  }
  function avClick(a, t) {
    switch (a) {
      case "av-back": avLeave(); return true;
      case "av-discard": closeModal(); AV.draft = AV.base; location.hash = "#/garden"; return true;
      case "av-save-leave": closeModal(); avSave(); return true;
      case "av-retry": mountAvatar(); return true;
      case "av-tab": AV.tab = t.dataset.t; avTabs(); avPanel(); const b = document.getElementById("avBody"); if (b) b.scrollTop = 0; return true;
    }
    if (AV.status !== "ready") return a.startsWith("av-");
    switch (a) {
      case "av-set": { let v = t.dataset.v; if (t.dataset.k === "blush") v = v === "true"; if (AV.draft[t.dataset.k] === v) return true; avApply(Object.assign({}, AV.draft, { [t.dataset.k]: v })); return true; }
      case "av-random": avApply(AV.mod.randomLook()); return true;
      case "av-undo": if (AV.hist.length) { AV.draft = AV.hist.pop(); AV.stage.setLook(AV.draft); avPanel(); avSync(); } return true;
      case "av-save": avSave(); return true;
    }
    return false;
  }

  /* ---------------- WELCOME ---------------- */
  function viewWelcome(step) {
    if (step === "location") return `<section class="screen f-welcome" aria-label="위치 권한 안내"><div class="f-scroll">
      <div class="f-stage" style="height:430px">${AMB(440)}${ORBIT(70, 24, 250)}
        <span class="f-me" style="left:125px;top:79px"><i></i></span><span class="f-pill" style="left:143px;top:53px">열람 반경 약 ${S.set.radius}m</span>
        ${AT(208, 82, 72, BR.seed("available", 72))}${AT(300, 204, 68, BR.seed("dormant", 68))}${AT(28, 160, 60, BR.seed("planted", 60))}
        ${HILLS(280)}<span class="f-pill dot" style="left:98px;top:227px"><i></i>점선 원 = 기억을 열 수 있는 범위</span></div>
      <div class="f-intro"><h1>가까이 가야<br>열리는 기억이에요</h1><p>다른 사람의 기억은 약 ${S.set.radius}m 안에서 열려요.</p></div>
      <div class="f-purpose"><p>${I.pin}근처 기억까지 거리를 보여줄 때</p><p>${I.unlock}근처에서 기억을 처음 열 때</p><p>${I.garden}지금 이 자리에 기억을 심을 때</p>
        <small>현재 위치는 가까운 기억을 찾고, 열고, 심을 때 사용해요. 위치 권한은 설정에서 언제든 끌 수 있어요.</small></div></div>
      <div class="flow-foot"><button class="btn btn-primary btn-block" data-act="allow">위치 허용하고 시작하기</button><button class="btn btn-ghost" data-act="deny">나중에 할게요, 둘러보기만</button></div></section>`;
    return `<section class="screen f-welcome" aria-label="시작"><div class="f-scroll">
      <div class="f-stage" style="height:440px">${AMB(440)}<span class="f-wordmark" style="top:28px">MEMORY GARDEN</span>
        ${ORBIT(45, 22, 300)}${ORBIT(85, 62, 220)}${AT(97, 74, 196, BR.seed("available", 196), "breathe")}${AT(26, 52, 88, BR.seed("planted", 88))}${AT(282, 216, 76, BR.seed("dormant", 76))}
        ${HILLS(280)}${LUMI(16, 215, 115)}</div>
      <div class="f-intro"><span class="f-kicker">우주에서 온 기록수집가 · LUMI</span><h1>장소에 기억을 심고,<br><em>누군가의 기억</em>을 발견해요</h1><p>오늘을 이 자리에 심어 두면,<br>여기 온 다음 사람이 열어 볼 수 있어요.</p></div></div>
      <div class="flow-foot"><a class="btn btn-primary btn-block" href="#/welcome/location">시작하기</a></div></section>`;
  }

  /* ---------------- modals ---------------- */
  // opts.alert: 꼭 골라야 하는 안내(이미 정원이 있는 계정 등) — 손잡이 없음, 바깥을 눌러도·끌어도 닫히지 않고 버튼으로만 닫혀요
  function openModal(html, opts = {}) {
    closeModal();
    const s = document.createElement("div"); s.className = "scrim" + (opts.alert ? " is-alert" : ""); s.dataset.act = "scrim";
    s.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${opts.alert ? "" : `<div class="sheet-handle" aria-hidden="true"></div>`}${html}</div>`;
    $app.appendChild(s);
    const f = s.querySelector("textarea,button"); if (f) setTimeout(() => f.focus(), 50);
  }
  // 모달이 떠 있는 동안 미뤄 둔 화면 갱신(위치 변화 등)은 닫을 때 반영해요
  function closeModal() { const open = document.querySelectorAll(".scrim"); open.forEach(n => n.remove()); if (open.length && typeof softRender === "function") softRender(); }

  /* ---------------- boot / error screens ---------------- */
  function viewBoot() {
    if (S.boot === "loading") return `<section class="screen" aria-busy="true"><div class="center-state"><img src="${img("cat")}" alt="" style="width:120px"><p>기억 정원을 여는 중…</p></div></section>`;
    const anon = S.bootErr === "anon_disabled";
    return `<section class="screen"><div class="center-state" role="alert"><span class="icon" style="width:72px;height:72px;border-radius:50%;display:grid;place-items:center;background:var(--color-danger-soft);color:var(--color-danger)">${I.wifi}</span>
      <h2>기억 정원에 연결하지 못했어요</h2><p>${anon ? "서버에서 익명 로그인이 꺼져 있어요.<br>관리자: Supabase → Authentication → Sign In / Providers → Allow anonymous sign-ins 를 켜 주세요." : "인터넷 연결을 확인하고 다시 시도해 주세요."}</p>
      <button class="btn btn-primary" data-act="boot-retry">다시 시도</button></div></section>`;
  }

  /* ---------------- router ---------------- */
  function route() {
    const h = location.hash || "#/";
    if (!S.onboarded && !h.startsWith("#/welcome") && !h.startsWith("#/s/")) { location.replace("#/welcome"); return null; }
    const p = h.slice(2).split("/");
    return { name: p[0] || "home", arg: p[1] ? decodeURIComponent(p[1]) : p[1] };
  }
  let sig = "";
  function render() {
    const r = route(); if (!r) return;
    applyTheme();
    if (S.found && !(r.name === "m" && r.arg === S.found)) S.found = null;
    const keep = { sheet: (document.getElementById("sheetBody") || {}).scrollTop, garden: (document.getElementById("gardenScroll") || {}).scrollTop, route: location.hash };
    closeModal();
    if (r.name !== "avatar") avTeardown();
    let html = "";
    const needsData = !["welcome", "avatar", "plant"].includes(r.name);
    if (needsData && S.boot !== "ok") html = viewBoot();
    else if (r.name === "welcome") html = viewWelcome(r.arg);
    else if (r.name === "m") html = viewMemory(r.arg);
    else if (r.name === "s") html = viewShare(r.arg);
    else if (r.name === "plant") html = S.boot === "ok" && !member() && !["done", "doing"].includes(r.arg) ? viewLoginGate() : viewPlant(r.arg || "1");
    else if (r.name === "garden") html = viewGarden();
    else if (r.name === "avatar") html = viewAvatar();
    else if (r.name === "settings") html = viewSettings();
    else html = viewHome();
    $app.innerHTML = html;
    if (r.name === "avatar") mountAvatar();
    if (r.name === "home" && S.boot === "ok") {
      const slot = document.getElementById("map");
      if (slot && !mapFailed) { slot.appendChild(mapHost); ensureMap(); if (MAP) { MAP.relayout(); syncMap(); } }
      if (S.nearState === "idle") refreshNear();
    }
    // 같은 화면을 다시 그린 경우 스크롤 위치를 지켜요(위치가 바뀌며 자주 다시 그려지니까요)
    if (keep.route === location.hash) {
      const sb = document.getElementById("sheetBody"); if (sb && keep.sheet) sb.scrollTop = keep.sheet;
      const gs = document.getElementById("gardenScroll"); if (gs && keep.garden) gs.scrollTop = keep.garden;
    }
    sig = signature();
    syncPanel();
  }
  // 위치가 바뀔 때: 화면에 보이는 값이 실제로 달라졌을 때만, 입력·모달 중이 아닐 때만 다시 그려요.
  function signature() {
    const p = pos();
    return [GEO.state, accOk(), p ? p.acc > 30 ? Math.round(p.acc / 10) : 0 : -1, S.nearState, S.near.length, S.region, S.set.radius,
      S.near.slice(0, 40).map(m => m.id + seedState(m) + (distOf(m) == null ? "" : Math.round(distOf(m) / 5))).join(",")].join("|");
  }
  let softTimer = null;
  function softRender(force) {
    clearTimeout(softTimer);
    softTimer = setTimeout(() => {
      const r = route(); if (!r) return;
      if (!["home", "m", "garden", "s"].includes(r.name) && !(r.name === "plant" && r.arg === "3")) return;
      if (document.querySelector(".scrim")) return;
      const ae = document.activeElement; if (ae && /INPUT|TEXTAREA/.test(ae.tagName)) { if (r.name === "plant") syncPlantBtn(); return; }
      if (!force && signature() === sig) return;
      render();
    }, force ? 30 : 250);
  }
  function syncPlantBtn() { const b = document.getElementById("plantBtn"); if (b) b.disabled = !(accOk() && S.draft.place.trim() && (S.draft.vis !== "key" || SECRET_OK(S.draft.secret))); }

  GEO.on(() => {
    const p = pos();
    if (p && (!S.nearAt || GEO.distance(S.nearAt, p) > 150 || S.nearState === "error")) fetchNear(p);
    if (p) updateRegion();
    if (MAP) MAP.setMe(p, meHTML(), S.set.radius, !!p && !accOk());
    softRender();
  });

  /* ---------------- events ---------------- */
  const goBack = (fallback) => { if (S.nav > 1) history.back(); else location.hash = fallback || "#/"; };
  $app.addEventListener("click", e => {
    const t = e.target.closest("[data-act]"); if (!t) return;
    const a = t.dataset.act, id = t.dataset.id;
    if (a.startsWith("av-") && avClick(a, t)) return;
    switch (a) {
      case "pin": { lastPinTap = Date.now(); S.selected = id; if (S.sheetMode === "full") S.sheetMode = "peek"; render(); const m = byId(id); if (m) focusOn(m); break; }
      case "unselect": S.selected = null; render(); break;
      case "open": S.selected = null; location.hash = "#/m/" + id; break;
      case "back": e.preventDefault(); goBack(t.getAttribute("href")); break;
      case "sheet": if (sheetDragged) { sheetDragged = false; break; } S.sheetMode = S.sheetMode === "min" ? "peek" : S.sheetMode === "peek" ? "full" : "peek"; render(); break;
      case "filter": S.filter = t.dataset.f; render(); break;
      case "recenter": recenter(); break;
      case "retry": S.forced = null; S.nearState = "loading"; render(); refreshNear(); break;
      case "map-retry": mapFailed = false; render(); break;
      case "garden-retry": S.forced = null; S.gardenState = "loading"; loadGarden(); render(); break;
      case "detail-retry": delete S.status[id]; render(); break;
      case "boot-retry": boot(); break;
      case "reload": location.reload(); break;
      case "loc": if (locOk()) recenter(); else if (GEO.state === "denied") locHelp(); else startLocation(); break;
      case "loc-retry": closeModal(); startLocation(); break;
      case "loc-help": locHelp(); break;
      case "like": {
        const m = byId(id); if (!m) break;
        const on = !m.liked; m.liked = on; m.hearts = (m.hearts || 0) + (on ? 1 : -1); render();
        API.heart(id, on).catch(() => { m.liked = !on; m.hearts += on ? -1 : 1; render(); toast("마음을 전하지 못했어요"); });
        break;
      }
      case "share": shareMemory(id); break;
      case "reply": openModal(`<h3>답장 남기기</h3><div class="compose" style="box-shadow:inset 0 0 0 1.5px var(--color-line)"><textarea id="replyText" maxlength="80" style="min-height:90px" placeholder="이 기억에 따뜻한 한마디를 남겨 주세요" aria-label="답장"></textarea></div><button class="btn btn-primary btn-block" data-act="send-reply" data-id="${id}">보내기</button>`); break;
      case "send-reply": {
        const v = ((document.getElementById("replyText") || {}).value || "").trim(); if (v.length < 1) { toast("한 글자 이상 써 주세요"); break; }
        t.disabled = true;
        API.reply(id, v).then(() => API.detail(id)).then(r => { if (r.memory) remember(Object.assign(r.memory, { state: r.memory.mine ? "mine" : "discovered" })); closeModal(); render(); toast("답장을 남겼어요"); })
          .catch(err => { console.error(err); t.disabled = false; toast("답장을 보내지 못했어요. 다시 시도해 주세요"); });
        break;
      }
      case "scrim": if (e.target === t && scrimDown === t && !t.classList.contains("is-alert")) closeModal(); break;
      case "walk": walkTo(byId(id)); break;
      case "discover": { const m = byId(id); if (m && canOpen(m)) discover(id); break; }
      case "found-done": S.found = null; render(); break;
      case "flower": flowerSheet(t.dataset.k, +t.dataset.i); break;
      case "fl-open": closeModal(); S.selected = null; location.hash = "#/m/" + id; break;
      case "fl-gone": closeModal(); openGone(); break;
      case "gone-info": openGone(); break;
      case "theme-open": themeSheet(); break;
      case "theme-set": S.theme = t.dataset.v; store.set("theme", S.theme); applyTheme(); if (route().name === "settings") render(); else themeSheet(); if (MAP) syncMap(); break;
      case "vis-open": visSheet(id); break;
      case "vis-pick": { const m = byId(id), v = t.dataset.v; if (v === "key") secretNewSheet(id); else if (m && (m.vis || "all") !== v) visConfirm(id, v); else closeModal(); break; }
      case "vis-apply": { t.disabled = true; applyVis(id, t.dataset.v); break; }
      case "secret-set": { const v = (document.getElementById("secretNew") || {}).value || ""; if (!SECRET_OK(v)) break; t.disabled = true; applyVis(id, "key", v); break; }
      case "secret-submit": { const v = (document.getElementById("secretOpen") || {}).value || ""; if (!SECRET_OK(v)) break; t.disabled = true; discover(id, v); break; }
      case "report-open": if (!member()) { loginSheet("open"); break; } reportSheet(id); break;
      case "report-pick": reportSheet(id, t.dataset.v); break;
      case "report-send": {
        if (!t.dataset.v) break; t.disabled = true;
        API.report(id, t.dataset.v).then(r => { if (r && r.status === "login_required") { closeModal(); loginSheet("open"); return; } reportDone(id); })
          .catch(err => { console.error(err); closeModal(); toast(err && err.code === "PGRST202" ? "신고 기능은 서버 준비가 끝나면 쓸 수 있어요" : "신고하지 못했어요. 잠시 뒤 다시 시도해 주세요"); });
        break;
      }
      case "del-open": delConfirm(id); break;
      case "del-apply": {
        t.disabled = true;
        API.remove(id).then(() => { S.near = S.near.filter(m => m.id !== id); delete S.cache[id]; S.status[id] = "unavailable"; S.garden = null; closeModal(); location.hash = "#/garden"; toast("기억을 지웠어요"); syncMap(); })
          .catch(err => { console.error(err); closeModal(); toast("기억을 지우지 못했어요"); });
        break;
      }
      case "nick": openModal(`<h3>정원 이름</h3><label class="field"><span>닉네임 · 12자까지</span><input id="nickInput" maxlength="12" value="${esc(S.profile.nickname)}" autocomplete="off"></label><p class="reassure">내가 심은 기억을 발견한 사람에게 이 이름이 보여요.</p><button class="btn btn-primary btn-block" data-act="nick-save">저장</button>`); break;
      case "login": doLogin(); break;
      case "set-avatar": closeModal(); location.hash = t.dataset.v === "new" ? "#/avatar/new" : "#/avatar"; break;
      case "profile-open": profileSheet(); break;
      case "petal-set": {
        const v = t.dataset.v, prev = S.profile.petal; S.profile.petal = v; profileSheet(); softRender(true);
        API.updateProfile({ petal: v }).then(() => toast(`꽃잎 색을 ${petalName(v)}(으)로 바꿨어요`)).catch(e => { console.warn(e); S.profile.petal = prev; profileSheet(); softRender(true); toast("꽃잎 색을 저장하지 못했어요. 서버 설정(SQL)이 필요해요"); });
        break;
      }
      case "mkt-set": case "mkt-toggle": {
        const on = a === "mkt-set" ? t.dataset.v === "1" : !S.mkt;
        API.setMarketing(on).then(() => { S.mkt = on; closeModal(); if (a === "mkt-toggle") render(); toast(on ? "이메일 소식 받기에 동의했어요" : a === "mkt-set" ? "이메일 소식은 받지 않아요" : "이메일 소식 받기를 껐어요"); })
          .catch(() => toast("저장하지 못했어요. 다시 시도해 주세요"));
        break;
      }
      case "login-open": loginSheet("account"); break;
      case "login-other": API.switchToKakao().catch(() => toast("로그인을 시작하지 못했어요")); break;
      case "switch-open": openModal(`<h3>다른 계정으로 로그인할까요?</h3><p class="av-note" style="margin:0">지금 계정에서 로그아웃한 뒤 다른 계정으로 로그인해요.<br>지금 계정의 정원은 그대로 남아 있어요.</p>
        <button class="btn btn-kakao btn-block" data-act="login-other">${KAKAO_ICON}카카오 계정으로 로그인</button>${emailBtn("이메일로 로그인")}<button class="btn btn-ghost" data-act="close">취소</button>`); break;
      case "email-open": emailSheet(t.dataset.v); break;
      case "email-send": {
        const v = ((document.getElementById("emailInput") || {}).value || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { toast("이메일 주소를 확인해 주세요"); break; }
        t.disabled = true; t.textContent = "보내는 중…"; (API.member() ? Promise.resolve(true) : anonEmpty()).then(fresh => sendEmailLink(v, fresh)); break;
      }
      case "email-fresh": sendEmailLink(t.dataset.v, true); break;
      case "logout-open": openModal(`<h3>로그아웃할까요?</h3><p class="av-note" style="margin:0">정원은 계정에 그대로 남아 있어요.<br>다시 로그인하면 이어서 볼 수 있어요.</p>
        <button class="btn btn-primary btn-block" data-act="logout">로그아웃</button><button class="btn btn-ghost" data-act="close">취소</button>`); break;
      case "login-switch": API.switchToKakao({ pick: false }).catch(() => toast("로그인을 시작하지 못했어요")); break;
      case "logout": API.logout().then(() => { try { localStorage.removeItem("mg:avatar"); localStorage.removeItem("mg:look"); localStorage.removeItem("mg:portrait"); } catch (_) { } location.hash = "#/"; location.reload(); }); break;
      case "nick-save": {
        const v = ((document.getElementById("nickInput") || {}).value || "").trim(); if (!v) { toast("한 글자 이상 써 주세요"); break; }
        API.updateProfile({ nickname: v }).then(() => { S.profile.nickname = v; closeModal(); render(); toast("이름을 바꿨어요"); }).catch(() => toast("이름을 바꾸지 못했어요"));
        break;
      }
      case "close": closeModal(); break;
      case "focus": {
        const m = byId(id); S.selected = id; if (S.sheetMode === "full") S.sheetMode = "peek";
        if (!S.onboarded) { S.onboarded = true; store.set("onboarded", true); }
        if (m && !S.near.some(x => x.id === id)) { S.near.push(m); }
        if (m) { if (MAP) S.mapFocus = null; focusOn(m); if (!locOk() && (!S.nearAt || GEO.distance(S.nearAt, m) > 400)) fetchNear(m); }
        location.hash = "#/"; break;
      }
      case "go": if (!t.disabled) location.hash = t.dataset.to; break;
      case "sample": S.draft.photo = t.dataset.src; S.draft.blob = null; S.draft.noPhoto = false; render(); break;
      case "nophoto": S.draft.photo = null; S.draft.blob = null; S.draft.noPhoto = true; location.hash = "#/plant/2"; break;
      case "prompt": { S.draft.text = (S.draft.text ? S.draft.text.replace(/\s*$/, " ") : "") + t.dataset.p + " "; render(); const n = document.getElementById("story"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } break; }
      case "vis": S.draft.vis = t.dataset.v; render(); break;
      case "plant": doPlant(); break;
      case "after-plant": if (S.lastPlanted) focusOn(S.lastPlanted); break;
      case "gtab": S.gardenTab = t.dataset.t; render(); break;
      case "avatar": location.hash = "#/avatar"; break;
      case "lumi-hide": S.lumiHidden = true; S.lumiPeek = false; render(); break;
      case "lumi-show": S.lumiHidden = false; S.lumiPeek = true; S.selected = null; render(); break;
      case "allow": S.onboarded = true; store.set("onboarded", true); startLocation(); location.hash = "#/"; break;
      case "deny": S.onboarded = true; store.set("onboarded", true); S.locWanted = false; store.set("locWanted", false); location.hash = "#/"; break;
    }
  });
  $app.addEventListener("input", e => {
    const id = e.target.id;
    if (id === "story") {
      S.draft.text = e.target.value;
      const c = document.getElementById("cnt"); c.textContent = e.target.value.length + "/120"; c.classList.toggle("warn", e.target.value.length > 110);
      document.getElementById("next2").disabled = e.target.value.trim().length < 2;
    }
    if (id === "placeName") { S.draft.place = e.target.value; syncPlantBtn(); }
    if (id === "hintText") S.draft.hint = e.target.value;
    if (id === "secretText") { S.draft.secret = e.target.value; syncPlantBtn(); }
    if (id === "secretOpen" || id === "secretNew") { const b = document.getElementById(id + "Btn"); if (b) b.disabled = !SECRET_OK(e.target.value); }
  });
  $app.addEventListener("change", e => {
    if (e.target.dataset.act === "prof-photo" && e.target.files[0]) { const f = e.target.files[0]; if (!/^image\//.test(f.type)) { toast("사진 파일만 고를 수 있어요"); return; } setProfilePhoto(f); return; }
    if (e.target.dataset.act === "file" && e.target.files[0]) {
      const f = e.target.files[0]; e.target.value = "";
      if (!/^image\//.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) { toast("사진 파일만 올릴 수 있어요"); return; }
      // 그 자리에서 찍은 사진만: 카메라로 막 찍은 파일은 만든 시각이 지금이에요. 10분보다 오래된 파일(앨범 사진)은 받지 않아요.
      if (f.lastModified && Date.now() - f.lastModified > FRESH_MS) { toast("지금 이 자리에서 찍은 사진만 남길 수 있어요. 카메라로 다시 찍어 주세요"); return; }
      downscale(f).then(r => { S.draft.photo = r.url; S.draft.blob = r.blob; S.draft.noPhoto = false; render(); })
        .catch(() => toast("이 사진은 읽지 못했어요. 다른 사진(JPG·PNG)을 골라 주세요"));
    }
  });
  $app.addEventListener("keydown", e => {
    if (e.target.dataset.act !== "sheet") return;
    const order = ["min", "peek", "full"], i = order.indexOf(S.sheetMode);
    if (e.key === "ArrowUp" && i < 2) { e.preventDefault(); S.sheetMode = order[i + 1]; render(); }
    else if (e.key === "ArrowDown" && i > 0) { e.preventDefault(); S.sheetMode = order[i - 1]; render(); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); S.sheetMode = S.sheetMode === "min" ? "peek" : S.sheetMode === "peek" ? "full" : "peek"; render(); }
    if (/^Arrow|Enter| /.test(e.key)) requestAnimationFrame(() => document.querySelector(".f-sheet .sheet-handle")?.focus());
  });

  // 아래 시트(모달): 바깥은 '눌렀다 뗀 곳이 둘 다 바깥'일 때만 닫혀요(끌다가 바깥에서 손을 떼도 안 닫힘).
  // 손잡이는 아래로 끌어 닫기만 해요. 위로 끌면 살짝 따라오다 제자리로 돌아와요.
  let scrimDown = null;
  $app.addEventListener("pointerdown", e => {
    scrimDown = e.target.classList && e.target.classList.contains("scrim") ? e.target : null;
    const h = e.target.closest(".modal .sheet-handle"); if (!h) return;
    const modal = h.parentElement, scrim = modal.parentElement, y0 = e.clientY;
    let dy = 0; modal.style.transition = "none"; modal.style.animation = "none";
    const move = ev => { dy = ev.clientY - y0; modal.style.transform = `translateY(${dy > 0 ? dy : dy / 6}px)`; };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      modal.style.transition = "transform .2s ease-out";
      if (dy > 90) { modal.style.transform = "translateY(100%)"; setTimeout(() => { if (scrim.isConnected) closeModal(); }, 180); }
      else modal.style.transform = "";
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  });

  // 시트 끌기: 손잡이나 제목 줄을 위아래로 끌면 가장 가까운 높이(min·peek·full)로 붙어요. 빠르게 튕기면 그 방향으로 한 단계.
  let sheetDragged = false;
  $app.addEventListener("pointerdown", e => {
    const sheet = e.target.closest(".f-sheet");
    if (!sheet || !e.target.closest(".sheet-handle, .sheet-title") || e.target.closest("button")) return;
    if (e.button !== undefined && e.button !== 0) return;
    const startY = e.clientY, startH = sheet.getBoundingClientRect().height, t0 = performance.now();
    const screenH = sheet.parentElement.getBoundingClientRect().height;
    const baseH = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;   // 탭 바 높이만큼의 아래 여백
    const peekPx = +sheet.dataset.peek || 280;
    const snaps = { min: baseH + SHEET_MIN, peek: baseH + peekPx, full: screenH * 0.72 };
    const floats = [...document.querySelectorAll(".home .f-bubble, .home .f-bubble-min, .home .f-locate")];
    let moved = false, lastY = startY, lastT = t0, vy = 0;
    const move = ev => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < 6) return;
      if (!moved) { moved = true; sheet.style.transition = "none"; floats.forEach(f => f.style.transition = "none"); }
      const h = Math.max(snaps.min - 12, Math.min(snaps.full + 12, startH - dy));
      sheet.style.height = h + "px";
      floats.forEach(f => f.style.bottom = (h + 12) + "px");
      const now = performance.now(); vy = (ev.clientY - lastY) / Math.max(1, now - lastT); lastY = ev.clientY; lastT = now;
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      if (!moved) return;
      sheetDragged = true; setTimeout(() => { sheetDragged = false; }, 350);
      const h = sheet.getBoundingClientRect().height, order = ["min", "peek", "full"];
      let pick = order.reduce((a, k) => Math.abs(snaps[k] - h) < Math.abs(snaps[a] - h) ? k : a, "peek");
      if (pick === S.sheetMode && Math.abs(vy) > 0.5) { const i = order.indexOf(S.sheetMode); pick = order[Math.max(0, Math.min(2, i + (vy > 0 ? -1 : 1)))]; }
      sheet.style.transition = ""; floats.forEach(f => f.style.transition = "");
      S.sheetMode = pick; render();
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  });

  // 사진은 올리기 전에 긴 변 1280px JPEG로 줄여요(데이터·저장 공간 절약, 촬영 위치 등 EXIF 메타데이터도 함께 사라져요)
  function downscale(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); };
      im.onload = () => {
        URL.revokeObjectURL(url);
        const s = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        c.toBlob(b => b ? res({ blob: b, url: c.toDataURL("image/jpeg", .82) }) : rej(new Error("encode")), "image/jpeg", .82);
      };
      im.src = url;
    });
  }
  function startLocation() {
    S.locWanted = true; store.set("locWanted", true);
    if (DEMO && GEO.simulated) { GEO.simulate({ lat: GEO.pos ? GEO.pos.lat : HOME_CENTER.lat, lng: GEO.pos ? GEO.pos.lng : HOME_CENTER.lng, acc: 12 }); return; }
    GEO.start();
  }
  function shareMemory(id) {
    const m = byId(id);
    const url = location.href.split("#")[0] + "#/s/" + id;
    // 공유 문구에도 사진·제목·본문을 넣지 않아요(장소명만)
    const data = { title: m ? `${m.place}에 숨은 기억 | 기억 정원` : "기억 정원", text: "가까이 가야 열리는 기억이에요.", url };
    if (navigator.share) navigator.share(data).catch(() => { });
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => toast("링크를 복사했어요 · 받은 사람은 현장에서만 열 수 있어요"), () => toast("링크를 복사하지 못했어요"));
    else toast("이 브라우저에서는 공유를 지원하지 않아요");
  }

  /* ---------------- demo panel (desktop) ---------------- */
  const panel = document.getElementById("demo");
  function syncPanel() {
    if (!panel) return;
    panel.classList.toggle("live", !DEMO);
    const p = pos();
    panel.querySelectorAll("[data-loc]").forEach(b => b.setAttribute("aria-pressed", b.dataset.loc === "low" ? !!p && !accOk() : b.dataset.loc === "ok" ? accOk() : GEO.state === "denied"));
    panel.querySelectorAll("[data-theme]").forEach(b => b.setAttribute("aria-pressed", b.dataset.theme === S.theme));
    panel.querySelectorAll("[data-revoke]").forEach(b => b.setAttribute("aria-pressed", !!(API.demoRevoked && API.demoRevoked("bridge"))));
    panel.querySelectorAll("[data-ds]").forEach(b => b.setAttribute("aria-pressed", b.dataset.ds === (S.forced || "ok")));
    const mode = panel.querySelector("#demoMode"); if (mode) mode.textContent = DEMO ? "데모 모드 · 이 기기에만 저장돼요" : "실서비스 연결됨 · Supabase";
  }
  if (panel) panel.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.go) { if (b.dataset.go.startsWith("#/welcome")) { S.onboarded = false; } else if (!S.onboarded) { S.onboarded = true; store.set("onboarded", true); } S.selected = null; if (location.hash === b.dataset.go) render(); else location.hash = b.dataset.go; }
    if (b.dataset.loc && DEMO) {
      const at = GEO.pos || S.nearAt || HOME_CENTER;
      if (b.dataset.loc === "ok") GEO.simulate({ lat: at.lat, lng: at.lng, acc: 12 });
      else if (b.dataset.loc === "low") GEO.simulate({ lat: at.lat, lng: at.lng, acc: 80 });
      else { GEO.stop(); GEO.simulated = true; GEO.pos = null; GEO.set("denied"); }
      render();
    }
    if (b.dataset.theme) { S.theme = b.dataset.theme; store.set("theme", S.theme); render(); }
    if (b.dataset.revoke && API.demoToggleRevoke) { const gone = API.demoToggleRevoke("bridge"); S.status.bridge = gone ? "gone" : "discovered"; S.near.forEach(m => { if (m.id === "bridge") m.gone = gone; }); S.garden = null; refreshNear(); render(); }
    if (b.dataset.ds) { S.forced = b.dataset.ds === "ok" ? null : b.dataset.ds; if ((route() || {}).name === "avatar") AV.tab = null; render(); }
    if (b.dataset.reset) { try { Object.keys(localStorage).filter(k => k.startsWith("mg:")).forEach(k => localStorage.removeItem(k)); } catch (_) { } if (API.demoReset) API.demoReset(); location.hash = "#/welcome"; location.reload(); }
  });

  /* ---------------- boot ---------------- */
  async function boot() {
    S.boot = "loading"; render();
    try {
      const info = await API.init();
      const [set, prof] = await Promise.all([API.settings(), API.profile().catch(() => null)]);
      S.set = set; if (prof) S.profile = prof;
      // 다른 기기(휴대폰)에서 만든 캐릭터·사진도 보이게: 서버 프로필의 이미지를 이 기기에도 반영
      if (prof && prof.avatar === "me" && prof.avatar_url) { S.avatar = "me"; S.portrait = prof.avatar_url; store.set("avatar", "me"); store.set("portrait", prof.avatar_url); }
      // 캐릭터 파츠도 계정 기준으로 맞춰요. 계정에 없고 이 기기에만 있으면(예전 저장분) 계정으로 올려 둬요
      const sLook = API.look();
      if (sLook) { S.look = sLook; store.set("look", sLook); }
      else if (S.look && prof && prof.avatar === "me") API.saveLook(S.look).catch(e => console.warn("[look sync]", e));
      S.boot = "ok"; S.loginError = info && info.loginError; S.justLoggedIn = info && info.justLoggedIn;
      // 카카오로 처음 로그인했으면 기본 닉네임 대신 카카오 이름을 써요(정원에서 바꿀 수 있어요)
      const kname = API.member() && API.memberName();
      if (kname && /^정원사 \d{4}$/.test(S.profile.nickname)) { const n = String(kname).slice(0, 12); API.updateProfile({ nickname: n }).then(() => { S.profile.nickname = n; softRender(true); }).catch(() => { }); }
    } catch (e) { console.error("[boot]", e); S.boot = "error"; S.bootErr = e.code || "net"; }
    render();
    if (S.boot !== "ok") return;
    if (S.loginError) {
      const le = S.loginError; S.loginError = null;
      if (/already|exists/i.test(le.code + le.message)) openModal(`<div class="login-sheet"><img src="${img("cat")}" alt=""><h3>이미 정원이 있는 카카오 계정이에요</h3><p class="av-note" style="margin:0">해당 계정으로 로그인하면 원래 정원을 볼 수 있어요.<br>이 기기에서 로그인 없이 남긴 기록은 옮겨지지 않아요.</p></div>
        <button class="btn btn-kakao btn-block" data-act="login-switch">${KAKAO_ICON}해당 계정으로 로그인</button><button class="btn btn-outline btn-block" data-act="login-other">다른 카카오 계정으로 로그인</button><button class="btn btn-ghost" data-act="close">지금은 로그인 안 할게요</button>`, { alert: true });
      else toast(/cancel|denied/i.test(le.message) ? "로그인을 취소했어요" : "로그인하지 못했어요. 다시 시도해 주세요");
    } else if (S.justLoggedIn) toast(typeof API.memberProvider === "function" && API.memberProvider() === "email" ? "이메일로 로그인했어요" : "카카오 계정으로 로그인했어요");
    // 로그인한 사람에게 이메일이 있으면 수신 동의를 한 번만 물어봐요
    if (!DEMO && API.member() && API.memberEmail()) API.marketing().then(c => { S.mkt = !!(c && c.opt_in); if (!c && !document.querySelector(".scrim")) marketingSheet(); }).catch(() => { });
    // 위치: 이미 허용했거나 이전에 쓰겠다고 한 경우에만 바로 시작(묻지 않고 켜지 않아요)
    if (S.onboarded && GEO.state === "idle") {
      const perm = await GEO.permission();
      if (perm === "granted" || (S.locWanted && perm !== "denied")) GEO.start();
      else if (perm === "denied") GEO.set("denied");
    }
    if (!pos() && (route() || {}).name === "home") refreshNear();
  }

  window.addEventListener("hashchange", () => { S.nav++; render(); });
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (S.theme === "system") applyTheme(); }); } catch (_) { }
  window.addEventListener("resize", () => { if (MAP) MAP.relayout(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.boot === "ok" && (route() || {}).name === "home") { if (S.locWanted && GEO.state !== "ok" && GEO.state !== "denied") GEO.start(); refreshNear(); } });
  boot();
})();
