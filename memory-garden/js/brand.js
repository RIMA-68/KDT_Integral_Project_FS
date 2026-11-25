/* 기억 정원 · 브랜드 그래픽 (Figma MG3·8 Brand Assets v3에서 그대로 옮김)
   - 기억의 씨앗(A안): 유리 구슬 + 안의 씨앗. 상태 dormant(잠김) · available(열 수 있음) · planted(내가 심음)
   - 씨앗 핀 v3: dormant · available · selected · discovered · mine
   - 기억 꽃 A+B v2 Refined(최초 개화 때만 C 빛), 지도용 단순 꽃 아이콘
   - 정원 자수: 꽃 도안 + 짧은 줄기·잎 (긴 줄기·잔디 없음)
   값과 좌표는 Figma 컴포넌트에서 내보낸 것과 같아요. */
(function () {
  "use strict";
  const C = { pink: "#E9B8BB", pinkL: "#F4D6D5", pinkM: "#EFC5C6", pinkD: "#E2A7A9", coral: "#E99A8D", lav: "#B5ADD0", lavL: "#D6D0E8", lavM: "#CEC8E2", lavD: "#C2BADB", blue: "#A9C8E2", sage: "#A9BDA0", sageD: "#8FA586", butter: "#E0CB9B", ivory: "#F1E8D8", gold: "#E9CA88", goldD: "#D2AE6A" };
  let uid = 0;
  const nid = p => p + (++uid);

  /* ---------- 꽃 (A+B v2 Refined) ---------- */
  const front = [[0, 64, 21], [71, 58, 20], [143, 62, 22], [217, 57, 19], [290, 60, 21]];
  const back = [[36, 52, 17], [107, 49, 16], [180, 53, 17], [254, 48, 16], [325, 51, 17]];
  const poly = a => "M" + a.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L") + "Z";
  const g = (rot, inner, cx = 100, cy = 100) => `<g transform="translate(${cx} ${cy}) rotate(${rot})">${inner}</g>`;
  const pts2 = (l, w) => ({ B: [0, 0], Ls: [-w, -0.46 * l], Lt1: [-0.8 * w, -0.86 * l], Lt2: [-0.36 * w, -0.99 * l], N: [0, -0.94 * l], Rt2: [0.36 * w, -0.99 * l], Rt1: [0.8 * w, -0.86 * l], Rs: [w, -0.5 * l], M: [0, -0.52 * l] });
  const facet2 = (l, w, c, edge = 0, op = 1) => {
    const p = pts2(l, w), e = edge ? ` stroke="#FFFFFF" stroke-opacity="${edge}" stroke-width="0.7" stroke-linejoin="round"` : "";
    return `<path d="${poly([p.B, p.Ls, p.M])}" fill="${c[1]}" fill-opacity="${op}"${e}/><path d="${poly([p.M, p.Ls, p.Lt1, p.Lt2, p.N])}" fill="${c[0]}" fill-opacity="${op}"${e}/><path d="${poly([p.B, p.M, p.Rs])}" fill="${c[3]}" fill-opacity="${op}"${e}/><path d="${poly([p.M, p.N, p.Rt2, p.Rt1, p.Rs])}" fill="${c[2]}" fill-opacity="${op}"${e}/>`;
  };
  const starFacet = (r = 13, ri = 6) => {
    let i = "";
    for (let k = 0; k < 5; k++) {
      const a = (-90 + k * 72) * Math.PI / 180, b1 = (-90 + k * 72 - 36) * Math.PI / 180, b2 = (-90 + k * 72 + 36) * Math.PI / 180;
      const T = [Math.cos(a) * r, Math.sin(a) * r], L1 = [Math.cos(b1) * ri, Math.sin(b1) * ri], L2 = [Math.cos(b2) * ri, Math.sin(b2) * ri];
      i += `<path d="${poly([[0, 0], L1, T])}" fill="#FFF3D0"/><path d="${poly([[0, 0], T, L2])}" fill="${C.gold}"/>`;
    }
    return g(0, `<circle r="${ri + 1}" fill="${C.goldD}" fill-opacity="0.55"/>` + i);
  };
  function flowerInner() {
    let i = "";
    for (const [r, l, w] of back) i += g(r, facet2(l * 0.9, w * 0.78, [C.lavL, C.lavM, C.lavD, C.lav], 0, 0.55));
    for (const [r, l, w] of front) i += g(r, facet2(l, w * 1.12, [C.pinkL, "#F6E4DF", C.pink, C.pinkM], 0.28, 0.9) + `<path d="M${(-w * 0.6).toFixed(1)} ${(-l * 0.58).toFixed(1)} L${(-w * 0.42).toFixed(1)} ${(-l * 0.8).toFixed(1)}" stroke="#FFFFFF" stroke-opacity="0.7" stroke-width="1.3" stroke-linecap="round"/>`);
    return i + starFacet(12, 5.5);
  }
  const FLOWER_INNER = flowerInner();
  const flower = (s = 200, cls = "") => `<svg class="mg-flower ${cls}" width="${s}" height="${s}" viewBox="0 0 200 200" fill="none" aria-hidden="true">${FLOWER_INNER}</svg>`;
  // C 빛: 최초 개화 순간에만 꽃 뒤에 깔리는 빛
  function glow(s = 200) {
    const id = nid("fg");
    const st = (x, y, r) => { const k = r * 0.18; return `<path d="M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z" fill="#FFF3D0"/>`; };
    let rays = ""; for (const [r] of back) rays += g(r, `<path d="M0 -16 L0 -86" stroke="${C.gold}" stroke-opacity="0.45" stroke-width="1" stroke-linecap="round"/>`);
    return `<svg class="mg-glow" width="${s}" height="${s}" viewBox="0 0 200 200" fill="none" aria-hidden="true"><defs><radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.gold}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.gold}" stop-opacity="0"/></radialGradient></defs><circle cx="100" cy="100" r="96" fill="url(#${id})"/>${rays}${st(40, 52, 6)}${st(160, 46, 5)}${st(170, 140, 4)}${st(34, 150, 4)}${st(118, 22, 3)}</svg>`;
  }
  function pinFlower(s = 24) {
    let i = "";
    for (let k = 0; k < 5; k++) i += `<g transform="translate(12 12.6) rotate(${k * 72})"><path d="M0 0 L-4.6 -4.4 L-3.2 -9.6 L0 -10.6 Z" fill="#E9B8BB"/><path d="M0 0 L0 -10.6 L3.2 -9.6 L4.6 -4.4 Z" fill="#D99AA0"/></g>`;
    let d = ""; for (let k = 0; k < 10; k++) { const a = (-90 + k * 36) * Math.PI / 180, rr = k % 2 ? 1.6 : 3.6; d += (k ? "L" : "M") + (12 + Math.cos(a) * rr).toFixed(2) + " " + (12.6 + Math.sin(a) * rr).toFixed(2); }
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" aria-hidden="true">${i}<circle cx="12" cy="12.6" r="3.4" fill="#C9984F"/><path d="${d}Z" fill="#E9CA88"/></svg>`;
  }

  /* ---------- 기억의 씨앗 (구슬 + 씨앗) ---------- */
  function seed(state = "dormant", s = 200) {
    const a = nid("sa"), b = nid("sb"), c = nid("sc"), d = nid("sd");
    const orbit = { dormant: .3, available: .6, planted: .45 }[state] || .3;
    const ring = { dormant: .5, available: 1, planted: 1 }[state] || .5;
    let core;
    if (state === "available") core = `<ellipse cx="99.6" cy="121.4" rx="33.6" ry="29.4" fill="url(#${d})"/><path d="M100.3 103C111.8 111.4 115 124 110.8 134.5C106.6 142.9 94 142.9 89.8 134.5C85.6 124 88.7 111.4 100.3 103Z" fill="url(#${c})"/><path d="M99.2 109.8C96 119.3 96 129.8 99.2 137.1" stroke="#fff" stroke-opacity=".6" stroke-width="1.7" stroke-linecap="round"/><path d="M101.3 104.5C101.3 92 106.3 83.3 113.8 78.3" stroke="#BFD6AE" stroke-width="2.5" stroke-linecap="round"/><path d="M102.5 91.8C93.8 86.8 87.5 89.3 85 93C91.3 95.5 96.3 95.5 102.5 91.8Z" fill="#A9BDA0" fill-opacity=".9"/><path d="M112.3 69C113 74.5 113 74.5 118.5 75.3C113 76 113 76 112.3 81.5C111.5 76 111.5 76 106 75.3C111.5 74.5 111.5 74.5 112.3 69Z" fill="#FFF3D0"/><path d="M64 79C64.8 83.3 64.8 83.3 69 84C64.8 84.8 64.8 84.8 64 89C63.3 84.8 63.3 84.8 59 84C63.3 83.3 63.3 83.3 64 79Z" fill="#FFF3D0"/><path d="M136 128C136.6 131.4 136.6 131.4 140 132C136.6 132.6 136.6 132.6 136 136C135.4 132.6 135.4 132.6 132 132C135.4 131.4 135.4 131.4 136 128Z" fill="#FFF3D0"/>`;
    else if (state === "planted") core = `<ellipse cx="100" cy="120" rx="32" ry="28" fill="url(#${d})"/><path d="M99.7 102C110.7 110 113.7 122 109.7 132C105.7 140 93.7 140 89.7 132C85.7 122 88.7 110 99.7 102Z" fill="url(#${c})"/><path d="M99 108.8C96 117.8 96 127.8 99 134.8" stroke="#fff" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round"/>`;
    else core = `<path d="M99.5 104C109.4 111.2 112.1 122 108.5 131C104.9 138.2 94.1 138.2 90.5 131C86.9 122 89.6 111.2 99.5 104Z" fill="var(--seed-core,#CDC4DC)"/><path d="M98.7 110.7C96 118.8 96 127.8 98.7 134.1" stroke="#fff" stroke-opacity=".6" stroke-width="1.44" stroke-linecap="round"/>`;
    const seedGrad = state === "planted" ? `<linearGradient id="${c}" x1="0" y1="102" x2="0" y2="138" gradientUnits="userSpaceOnUse"><stop stop-color="#FFB8AA"/><stop offset="1" stop-color="#FF6B57"/></linearGradient>` : `<linearGradient id="${c}" x1="0" y1="103" x2="0" y2="141" gradientUnits="userSpaceOnUse"><stop stop-color="#FFF8E4"/><stop offset=".55" stop-color="#F3D9A0"/><stop offset="1" stop-color="#D9AE66"/></linearGradient>`;
    return `<svg class="mg-seed is-${state}" width="${s}" height="${s}" viewBox="0 0 200 200" fill="none" aria-hidden="true"><defs>
      <radialGradient id="${a}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(100 104) scale(92)"><stop offset=".62" stop-color="var(--seed-halo,#FFE3D3)" stop-opacity=".9"/><stop offset="1" stop-color="var(--seed-halo,#FFE3D3)" stop-opacity="0"/></radialGradient>
      <radialGradient id="${b}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(81.76 73.6) scale(121.6)"><stop stop-color="#fff" stop-opacity=".95"/><stop offset=".55" stop-color="#F6F1FA" stop-opacity=".6"/><stop offset="1" stop-color="#C9BFE3" stop-opacity=".75"/></radialGradient>
      ${seedGrad}<radialGradient id="${d}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(100 120) scale(33 29)"><stop stop-color="#FFE9B0" stop-opacity=".95"/><stop offset="1" stop-color="#E9CA88" stop-opacity="0"/></radialGradient></defs>
      <path d="M188.3 122.5C191.5 135.3 152.4 156.1 100.9 169C49.5 181.8 5.2 181.8 2 168.9C-1.2 156.1 37.9 135.2 89.3 122.4C140.8 109.6 185.1 109.6 188.3 122.5Z" stroke="#E9CA88" stroke-opacity="${orbit}" stroke-width="1.6"/>
      <circle cx="100" cy="104" r="92" fill="url(#${a})"/>
      <circle cx="100" cy="104" r="76" fill="url(#${b})" ${state === "dormant" ? 'opacity=".85"' : ""}/>
      ${core}
      ${state === "dormant" ? `<circle cx="100" cy="104" r="76" fill="#fff" fill-opacity=".35"/>` : ""}
      <circle cx="100.75" cy="104.75" r="76" stroke="#fff" stroke-opacity=".85" stroke-width="1.5"/>
      <path d="M72.8 91.1C83.4 84.4 89.9 75.5 87.3 71.3C84.6 67 73.8 68.9 63.1 75.6C52.4 82.3 45.9 91.2 48.6 95.4C51.3 99.7 62.1 97.8 72.8 91.1Z" fill="#fff" fill-opacity=".9"/>
      <path d="M51.5 140.5C60.7 153.8 74.8 163 90.7 166.1C106.6 169.2 123 166 136.6 157.2" stroke="#F1B9AD" stroke-opacity=".75" stroke-width="3" stroke-linecap="round"/>
      <path d="M7.9 182.3C9.4 188.5 20.7 192 39.3 192C57.8 192 82.2 188.6 106.9 182.4C131.6 176.3 154.6 167.9 171 159.2C187.4 150.4 195.7 142.1 194.2 135.9" stroke="#E9CA88" stroke-opacity="${ring}" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M182 67C183.1 73 183.1 73 189 74C183.1 75.1 183.1 75.1 182 81C181 75.1 181 75.1 175 74C181 73 181 73 182 67Z" fill="#E9CA88" fill-opacity="${state === "dormant" ? .5 : 1}"/></svg>`;
  }
  // 발견한 기억: 같은 유리 구슬 안에 사진이 담긴 형태 (Discovered Orb v3 · Settled / First Bloom)
  function photoOrb(src, s = 200, bloom = false) {
    return `<div class="mg-orb${bloom ? " bloom" : ""}" style="--orb:${s}px">${bloom ? `<span class="mg-orb-glow">${glow(s * 1.3)}</span>` : ""}
      <svg class="mg-orb-ring" viewBox="0 0 200 200" fill="none" aria-hidden="true"><path d="M7.9 182.3C9.4 188.5 20.7 192 39.3 192C57.8 192 82.2 188.6 106.9 182.4C131.6 176.3 154.6 167.9 171 159.2C187.4 150.4 195.7 142.1 194.2 135.9" stroke="#E9CA88" stroke-width="1.8" stroke-linecap="round"/><path d="M188.3 122.5C191.5 135.3 152.4 156.1 100.9 169C49.5 181.8 5.2 181.8 2 168.9C-1.2 156.1 37.9 135.2 89.3 122.4C140.8 109.6 185.1 109.6 188.3 122.5Z" stroke="#E9CA88" stroke-opacity=".5" stroke-width="1.6"/></svg>
      <span class="mg-orb-photo">${src ? `<img src="${src}" alt="">` : ""}<i></i></span>
      <span class="mg-orb-flower">${flower(Math.round(s * .36))}</span></div>`;
  }

  /* ---------- 씨앗 핀 v3 ---------- */
  const PIN_BODY = "M20 40.5L14.5 29.9C11.5336 28.6328 9.09588 26.38 7.59889 23.5227C6.10191 20.6654 5.63753 17.3788 6.28429 14.2186C6.93104 11.0584 8.64924 8.21847 11.1484 6.17899C13.6475 4.13951 16.7743 3.0256 20 3.0256C23.2257 3.0256 26.3525 4.13951 28.8516 6.17899C31.3508 8.21847 33.069 11.0584 33.7157 14.2186C34.3625 17.3788 33.8981 20.6654 32.4011 23.5227C30.9041 26.38 28.4664 28.6328 25.5 29.9L20 40.5Z";
  const SHADOW = '<ellipse cx="20" cy="41.5" rx="5" ry="1.6" fill="black" fill-opacity="0.18"/>';
  const SPROUT = '<path d="M20 12C24 15 25 20 23.5 23C22 25.5 18 25.5 16.5 23C15 20 16 15 20 12Z" fill="#D9A65A"/><path d="M20 12C20 9 22 7 25 6" stroke-width="1.6" stroke-linecap="round" stroke="#5F9150"/><path d="M25 6C27 4 29.5 4.5 30 5.5C28.5 7 26.5 7 25 6Z" fill="#5F9150"/>';
  const PINS = {
    dormant: `${SHADOW}<path d="${PIN_BODY}" fill="var(--pin-fill,#FFFCF7)" stroke-width="2" stroke-linejoin="round" stroke="var(--pin-dormant,#9C8F84)"/><path d="M20 9C24 12 25 17 23.5 20.5C22 23 18 23 16.5 20.5C15 17 16 12 20 9Z" fill="#B8AEC8"/><circle cx="31" cy="8" r="6.5" fill="var(--pin-badge,#302B3C)"/><rect x="28.6" y="7.6" width="4.8" height="3.8" rx=".8" fill="var(--pin-lock,#000)"/><path d="M29.4 7.6V6.6a1.6 1.6 0 0 1 3.2 0v1" stroke="var(--pin-lock,#000)"/>`,
    available: `${SHADOW}<path d="${PIN_BODY}" fill="var(--pin-fill,#FFFCF7)" stroke-width="2.6" stroke-linejoin="round" stroke="var(--state-available,#8A6100)"/>${SPROUT}`,
    selected: `${SHADOW}<path d="${PIN_BODY}" fill="var(--pin-fill,#FFFCF7)" stroke-width="3" stroke-linejoin="round" stroke="var(--pin-selected,#302B3C)"/>${SPROUT}`,
    discovered: `${SHADOW}<path d="${PIN_BODY}" fill="var(--pin-fill,#FFFCF7)" stroke-width="2" stroke-linejoin="round" stroke="var(--state-discovered,#C9566F)"/><g transform="translate(8 4.45) scale(1)">${pinFlower(24).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g>`,
    mine: `${SHADOW}<path d="${PIN_BODY}" fill="var(--pin-fill,#FFFCF7)" stroke-width="2" stroke-linejoin="round" stroke="#FF6B57"/><path d="M20 9C24 12 25 17 23.5 20.5C22 23 18 23 16.5 20.5C15 17 16 12 20 9Z" fill="#FF6B57"/><circle cx="31" cy="8" r="6.5" fill="#FF6B57"/><circle cx="31" cy="6.4" r="1.7" fill="white"/><path d="M27.8 11C28.4 9 33.6 9 34.2 11" stroke-width="1.3" stroke-linecap="round" stroke="white"/>`
  };
  // 지도 핀 v4 · 칩 핀 + 씨앗 구슬 (2026-11-24 리마 확정): 구슬 → 씨앗 → 개화 → 자수 메타포를 작은 핀에서도 유지.
  // 잠김 = 씨앗 구슬, 열 수 있음 = 씨앗 구슬 + 작은 반짝임, 내 기억 = 코랄(밤 아이리스) 씨앗 구슬, 발견함 = 단순화한 Frosted Facet 꽃.
  const PIN_ORB = { dormant: ["#B5ADD0", "#A79FC6"], available: ["#E2B866", "#D19A45"], mine: ["var(--pin-mine,#FF6B57)", "var(--pin-mine,#FF6B57)"] };
  const pinStar = (x, y, r, c) => { const k = r * .24; return `<path d="M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z" fill="${c}"/>`; };
  const seedPin = (state, w = 18) => {
    if (state === "discovered") return pinFlower(w).replace("<svg ", `<svg class="mg-pin is-${state}" `);
    const [ring, seedC] = PIN_ORB[state] || PIN_ORB.dormant;
    const spark = state === "available" ? pinStar(18.6, 3.4, 3.2, "#E9A93A") + '<circle cx="15.2" cy="1.6" r=".9" fill="#E9A93A"/>' : "";
    return `<svg class="mg-pin is-${state}" width="${w}" height="${w}" viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="11.5" r="8.6" fill="#FFFFFF" stroke="${ring}" stroke-width="1.4"/><path d="M11 6.4C13.9 8.4 14.7 11.6 13.7 14.1C12.8 16 9.2 16 8.3 14.1C7.3 11.6 8.1 8.4 11 6.4Z" fill="${seedC}"/><path d="M10.1 8.9C9.5 10.6 9.5 12.4 10 13.7" stroke="#fff" stroke-opacity=".8" stroke-width="1" stroke-linecap="round"/><path d="M5.6 9.6C6.1 8.2 7.1 7.2 8.3 6.6" stroke="${ring}" stroke-opacity=".45" stroke-width="1.1" stroke-linecap="round"/>${spark}</svg>`;
  };



  /* ---------- 정원 자수 (꽃 도안 + 짧은 줄기·잎) ---------- */
  const CELLS = [[6, 5, "center"], [5, 6, "center"], [6, 6, "center"], [7, 6, "center"], [6, 7, "center"], [5, 0, "petalL"], [7, 0, "petal"], [4, 1, "petalL"], [5, 1, "petalL"], [7, 1, "petal"], [8, 1, "petal"], [4, 2, "petalL"], [5, 2, "petalL"], [6, 2, "petalL"], [7, 2, "petal"], [8, 2, "petal"], [5, 3, "petalL"], [6, 3, "petal"], [7, 3, "petal"], [6, 4, "petal"], [12, 3, "petalL"], [12, 5, "petal"], [11, 2, "petalL"], [11, 3, "petalL"], [11, 5, "petal"], [11, 6, "petal"], [10, 2, "petalL"], [10, 3, "petalL"], [10, 4, "petalL"], [10, 5, "petal"], [10, 6, "petal"], [9, 3, "petalL"], [9, 4, "petal"], [9, 5, "petal"], [8, 4, "petal"], [0, 3, "petal"], [0, 5, "petalL"], [1, 2, "petal"], [1, 3, "petal"], [1, 5, "petalL"], [1, 6, "petalL"], [2, 2, "petal"], [2, 3, "petal"], [2, 4, "petal"], [2, 5, "petalL"], [2, 6, "petalL"], [3, 3, "petal"], [3, 4, "petalL"], [3, 5, "petalL"], [4, 4, "petalL"], [10, 11, "petalL"], [4, 11, "petalL"], [8, 11, "petal"], [2, 11, "petal"], [11, 10, "petalL"], [5, 10, "petalL"], [10, 10, "petalL"], [4, 10, "petalL"], [8, 10, "petal"], [2, 10, "petal"], [7, 10, "petal"], [1, 10, "petal"], [11, 9, "petalL"], [5, 9, "petalL"], [10, 9, "petalL"], [4, 9, "petalL"], [9, 9, "petalL"], [3, 9, "petalL"], [8, 9, "petal"], [2, 9, "petal"], [7, 9, "petal"], [1, 9, "petal"], [10, 8, "petalL"], [4, 8, "petalL"], [9, 8, "petal"], [3, 8, "petal"], [8, 8, "petal"], [2, 8, "petal"], [9, 7, "petal"], [3, 7, "petal"], [4, 7, "back"], [8, 7, "back"], [6, 9, "back"]];
  const STEM = [[6, 10, "stem"], [6, 11, "stem"], [6, 12, "stem"], [6, 13, "stem"], [6, 14, "stem"], [5, 13, "leaf"], [4, 13, "leafL"], [4, 12, "leaf"], [3, 12, "leafL"], [7, 12, "leaf"], [8, 12, "leafL"], [8, 11, "leaf"], [9, 11, "leafL"]];
  // 꽃 아래쪽 행(9~11)은 줄기와 겹치니 줄기 버전에서는 꽃 도안의 윗부분(0~8행)만 씀 — Figma Stem=Short와 같음
  const PAL = {
    bloom: { petal: "#D99AA0", petalL: "#EEC4C4", back: "#A39BC6", center: C.goldD, stem: C.sageD, leaf: C.sage, leafL: "#C3D3B8" },
    blue: { petal: "#8FB3D6", petalL: "#BFD6EC", back: "#A39BC6", center: C.goldD, stem: C.sageD, leaf: C.sage, leafL: "#C3D3B8" },
    lav: { petal: "#A39BC6", petalL: "#CFC8E4", back: "#D99AA0", center: C.goldD, stem: C.sageD, leaf: C.sage, leafL: "#C3D3B8" },
    trace: { petal: "#C8C1B8", petalL: "#DDD7CF", back: "#C8C1B8", center: "#BDB5AA", stem: "#C8C1B8", leaf: "#D3CDC4", leafL: "#DDD7CF" },
    locked: { petal: "#C9BFA9", petalL: "#DCD3C0", back: "#C9BFA9", center: "#BFB39A", stem: "#C9BFA9", leaf: "#D3CAB6", leafL: "#DCD3C0" }
  };
  // 꽃 한 송이 = 발견 3번: 0 줄기·잎 → 1 꽃잎 → 2 가운데. parts = ["on"|"gone"|"off", …] (생략하면 다 수놓인 꽃)
  // off = 아직 안 놓인 부분(연한 밑그림 점), gone = 지워진·비공개 기억이 놓았던 부분(흔적 색)
  const PART_OF = k => (k === "stem" || k === "leaf" || k === "leafL") ? 0 : k === "center" ? 2 : 1;
  function stitch(s = 120, pal = "bloom", withStem = true, parts = null) {
    if (!PAL[pal]) pal = "bloom";
    const cols = PAL[pal], cell = 200 / 13, rows = withStem ? 15 : 13;
    const cells = withStem ? CELLS.filter(c => c[1] <= 8).concat(STEM.map(c => [c[0], c[1] - 1, c[2]])) : CELLS;
    let i = "";
    for (const [x, y, k] of cells) {
      const X = x * cell, Y = y * cell, d = cell * 0.2;
      const st = parts ? (parts[PART_OF(k)] || "off") : "on";
      if (st === "off") { i += `<circle class="guide" cx="${(X + cell / 2).toFixed(1)}" cy="${(Y + cell / 2).toFixed(1)}" r="${(cell * 0.14).toFixed(1)}" style="fill:var(--st-guide,#CFC3B4)"/>`; continue; }
      const p = st === "gone" ? "trace" : pal, c = PAL[p][k];
      i += `<path d="M${(X + d).toFixed(1)} ${(Y + d).toFixed(1)} L${(X + cell - d).toFixed(1)} ${(Y + cell - d).toFixed(1)} M${(X + cell - d).toFixed(1)} ${(Y + d).toFixed(1)} L${(X + d).toFixed(1)} ${(Y + cell - d).toFixed(1)}" style="stroke:var(--st-${p}-${k},${c})" stroke="${c}" stroke-width="${(cell * 0.26).toFixed(1)}" stroke-linecap="round"/>`;
    }
    const h = Math.round(s * (rows - 1) / 13);
    return `<svg class="mg-stitch" width="${s}" height="${h}" viewBox="0 0 200 ${((rows - 1) * cell).toFixed(1)}" fill="none" aria-hidden="true">${i}</svg>`;
  }

  window.MG_BRAND = { seed, photoOrb, seedPin, flower, glow, pinFlower, stitch, C };
})();
