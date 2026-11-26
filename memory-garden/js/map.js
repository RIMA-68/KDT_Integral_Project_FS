/* 기억 정원 · 지도 어댑터
   카카오맵 JavaScript SDK가 기본이고, 키가 없거나 불러오기에 실패하면
   Leaflet + OpenStreetMap 으로 대신 그려요(개발·시연용). 화면 코드는 둘의 차이를 몰라도 돼요.
   핀·내 위치는 앱이 만든 HTML(기억의 씨앗 핀)을 그대로 지도 위에 올려요. */
(function () {
  "use strict";
  const loadScript = (src, timeout = 9000) => new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.async = true;
    const t = setTimeout(() => rej(new Error("timeout " + src)), timeout);
    s.onload = () => { clearTimeout(t); res(); }; s.onerror = () => { clearTimeout(t); rej(new Error("load " + src)); };
    document.head.appendChild(s);
  });
  const loadCss = href => { if (document.querySelector(`link[href="${href}"]`)) return; const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); };
  const el = html => { const d = document.createElement("div"); d.innerHTML = html.trim(); return d.firstElementChild; };
  const RADIUS_STYLE = { color: "#3D7FD9", fill: "rgba(61,127,217,1)", fillOpacity: .12, opacity: 1 };   // Figma · Map Me

  /* ---------------- Kakao ---------------- */
  async function kakaoAdapter(host, opts) {
    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.LatLng) {
      await loadScript(`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(opts.kakaoKey)}&libraries=services&autoload=false`);
      await new Promise((res, rej) => { if (!window.kakao || !kakao.maps || !kakao.maps.load) return rej(new Error("kakao sdk")); const t = setTimeout(() => rej(new Error("kakao load timeout")), 9000); kakao.maps.load(() => { clearTimeout(t); res(); }); });
    }
    const K = kakao.maps, LL = (lat, lng) => new K.LatLng(lat, lng);
    const map = new K.Map(host, { center: LL(opts.center.lat, opts.center.lng), level: 3 });
    // 카카오 로고·저작권 표시는 가리면 안 돼요 → 오른쪽 아래(지도 영역 안)
    try { map.setCopyrightPosition(K.CopyrightPosition.BOTTOMRIGHT, true); } catch (_) { }
    map.setMaxLevel(9);
    if (opts.onMapClick) K.event.addListener(map, "click", () => opts.onMapClick());
    if (opts.onMove) K.event.addListener(map, "dragend", () => opts.onMove());
    const pins = new Map();
    let me = null, rCircle = null, aCircle = null;
    const circle = (r, dashed) => new K.Circle({ radius: r, strokeWeight: 1.5, strokeColor: RADIUS_STYLE.color, strokeOpacity: RADIUS_STYLE.opacity, strokeStyle: dashed ? "dash" : "shortdash", fillColor: RADIUS_STYLE.fill, fillOpacity: dashed ? .06 : RADIUS_STYLE.fillOpacity });
    const geocoder = K.services ? new K.services.Geocoder() : null;
    return {
      kind: "kakao", map,
      setMe(pos, html, radius, lowAcc) {
        if (!pos) { if (me) me.setMap(null); if (rCircle) rCircle.setMap(null); if (aCircle) aCircle.setMap(null); me = rCircle = aCircle = null; return; }
        const p = LL(pos.lat, pos.lng);
        if (!me) { me = new K.CustomOverlay({ position: p, content: el(html), xAnchor: 0, yAnchor: 0, zIndex: 3 }); me.setMap(map); }
        else { me.setPosition(p); me.setContent(el(html)); }
        if (!rCircle) { rCircle = circle(radius, false); rCircle.setMap(map); }
        rCircle.setPosition(p); rCircle.setRadius(radius);
        if (lowAcc) { if (!aCircle) { aCircle = circle(pos.acc, true); aCircle.setMap(map); } aCircle.setPosition(p); aCircle.setRadius(pos.acc); }
        else if (aCircle) { aCircle.setMap(null); aCircle = null; }
      },
      setPins(items) {
        const keep = new Set();
        items.forEach(it => {
          keep.add(it.id);
          const cur = pins.get(it.id);
          if (cur && cur.html === it.html && cur.lat === it.lat && cur.lng === it.lng) return;
          if (cur) cur.ov.setMap(null);
          const ov = new K.CustomOverlay({ position: LL(it.lat, it.lng), content: el(it.html), xAnchor: 0, yAnchor: 0, clickable: true, zIndex: it.z || 2 });
          ov.setMap(map); pins.set(it.id, { ov, html: it.html, lat: it.lat, lng: it.lng });
        });
        pins.forEach((v, k) => { if (!keep.has(k)) { v.ov.setMap(null); pins.delete(k); } });
      },
      panTo(lat, lng, offsetY = 0, smooth = true) {
        if (smooth) map.panTo(LL(lat, lng)); else map.setCenter(LL(lat, lng));
        if (offsetY) setTimeout(() => map.panBy(0, offsetY), smooth ? 260 : 0);
      },
      center() { const c = map.getCenter(); return { lat: c.getLat(), lng: c.getLng() }; },
      relayout() { map.relayout(); },
      regionName(lat, lng) {
        return new Promise(res => {
          if (!geocoder) return res(null);
          geocoder.coord2RegionCode(lng, lat, (r, st) => {
            if (st !== K.services.Status.OK || !r || !r.length) return res(null);
            const h = r.find(x => x.region_type === "H") || r[0];
            res(h.region_3depth_name || h.region_2depth_name || null);
          });
        });
      }
    };
  }

  /* ---------------- Leaflet (대체) ---------------- */
  async function leafletAdapter(host, opts) {
    loadCss("vendor/leaflet/leaflet.css");
    if (!window.L) await loadScript("vendor/leaflet/leaflet.js");
    const map = L.map(host, { zoomControl: false, attributionControl: false }).setView([opts.center.lat, opts.center.lng], 17);
    L.control.attribution({ position: "bottomright", prefix: false }).addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>').addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, minZoom: 11 }).addTo(map);
    if (opts.onMapClick) map.on("click", () => opts.onMapClick());
    if (opts.onMove) map.on("dragend", () => opts.onMove());
    const icon = html => L.divIcon({ className: "mg-ov", html, iconSize: [0, 0], iconAnchor: [0, 0] });
    const pins = new Map();
    let me = null, rCircle = null, aCircle = null;
    const cOpt = dashed => ({ radius: 1, color: RADIUS_STYLE.color, weight: 1.5, opacity: RADIUS_STYLE.opacity, dashArray: dashed ? "6 6" : "3.6 3.6", fillColor: RADIUS_STYLE.color, fillOpacity: dashed ? .06 : RADIUS_STYLE.fillOpacity, interactive: false });
    return {
      kind: "leaflet", map,
      setMe(pos, html, radius, lowAcc) {
        if (!pos) { [me, rCircle, aCircle].forEach(x => x && x.remove()); me = rCircle = aCircle = null; return; }
        const p = [pos.lat, pos.lng];
        if (!me) me = L.marker(p, { icon: icon(html), interactive: false, zIndexOffset: 1000, keyboard: false }).addTo(map); else { me.setLatLng(p); me.setIcon(icon(html)); }
        if (!rCircle) rCircle = L.circle(p, cOpt(false)).addTo(map);
        rCircle.setLatLng(p); rCircle.setRadius(radius);
        if (lowAcc) { if (!aCircle) aCircle = L.circle(p, cOpt(true)).addTo(map); aCircle.setLatLng(p); aCircle.setRadius(pos.acc); }
        else if (aCircle) { aCircle.remove(); aCircle = null; }
      },
      setPins(items) {
        const keep = new Set();
        items.forEach(it => {
          keep.add(it.id);
          const cur = pins.get(it.id);
          if (cur && cur.html === it.html && cur.lat === it.lat && cur.lng === it.lng) return;
          if (cur) cur.mk.remove();
          const mk = L.marker([it.lat, it.lng], { icon: icon(it.html), keyboard: false, zIndexOffset: (it.z || 2) * 10 }).addTo(map);
          pins.set(it.id, { mk, html: it.html, lat: it.lat, lng: it.lng });
        });
        pins.forEach((v, k) => { if (!keep.has(k)) { v.mk.remove(); pins.delete(k); } });
      },
      panTo(lat, lng, offsetY = 0, smooth = true) {
        const z = map.getZoom(), pt = map.project([lat, lng], z).add([0, offsetY]);
        map.setView(map.unproject(pt, z), z, { animate: smooth });
      },
      center() { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
      relayout() { map.invalidateSize(false); },
      regionName() { return Promise.resolve(null); }
    };
  }

  window.MG_MAP = {
    async create(host, opts) {
      // 비교용 스위치: 주소 뒤 ?map=osm → 예전 지도(OpenStreetMap), ?map=kakao → 카카오맵. 이 기기에 기억돼요.
      let pref = null;
      try {
        const q = new URLSearchParams(location.search).get("map");
        if (q === "osm" || q === "kakao") localStorage.setItem("mg:map", JSON.stringify(q));
        pref = JSON.parse(localStorage.getItem("mg:map") || "null");
      } catch (_) { }
      if (opts.kakaoKey && pref !== "osm") {
        try { return await kakaoAdapter(host, opts); }
        catch (e) { console.warn("[지도] 카카오맵을 불러오지 못해 OpenStreetMap으로 대신 보여 줘요:", e.message); host.innerHTML = ""; }
      }
      return leafletAdapter(host, opts);
    }
  };
})();
