/* 기억 정원 · 지도 어댑터
   2026-11-26 리마 결정: 지도는 Leaflet + OpenStreetMap으로 고정해요(카카오맵 API는 쓰지 않아요).
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

  /* ---------------- Leaflet + OpenStreetMap ---------------- */
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

  /* ---------------- 내 발자취: 내가 심은 기억만 사진 핀으로 모아 보기 ----------------
     사진첩 지도처럼, 화면에서 가까운 핀(약 64px 안)은 한 묶음으로 합쳐 개수를 보여 줘요.
     묶음을 누르면 그 묶음이 보이게 확대하고, 더 확대할 수 없으면 onGroup으로 목록을 열어요. */
  async function trailMap(host, opts) {
    loadCss("vendor/leaflet/leaflet.css");
    if (!window.L) await loadScript("vendor/leaflet/leaflet.js");
    const c = opts.center || { lat: 37.5556, lng: 126.9019 };
    const map = L.map(host, { zoomControl: false, attributionControl: false, minZoom: 6, maxZoom: 19 }).setView([c.lat, c.lng], 15);
    L.control.attribution({ position: "bottomright", prefix: false }).addAttribution('&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>').addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, minZoom: 6 }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    const GAP = 64, MAXZ = 18;
    let items = [];
    const icon = html => L.divIcon({ className: "mg-ov", html, iconSize: [0, 0], iconAnchor: [0, 0] });
    function groups() {
      const z = map.getZoom(), out = [];
      items.forEach(it => {
        const pt = map.project([it.lat, it.lng], z);
        let g = null;
        for (const o of out) { if (Math.abs(o.pt.x - pt.x) < GAP && Math.abs(o.pt.y - pt.y) < GAP) { g = o; break; } }
        if (g) { g.list.push(it); g.pt = g.pt.multiplyBy((g.list.length - 1) / g.list.length).add(pt.divideBy(g.list.length)); }
        else out.push({ pt, list: [it] });
      });
      return out.map(g => ({ ll: map.unproject(g.pt, z), list: g.list }));
    }
    function draw() {
      layer.clearLayers();
      groups().forEach(g => {
        const n = g.list.length, top = g.list.find(x => x.photo) || g.list[0];
        const mk = L.marker(g.ll, { icon: icon(opts.html(top, n)), keyboard: false, zIndexOffset: n * 10 });
        mk.on("click", () => {
          if (n === 1) return opts.onOpen(top.id);
          const b = L.latLngBounds(g.list.map(x => [x.lat, x.lng]));
          const tight = map.getBoundsZoom(b, false, L.point(80, 80)) <= map.getZoom() || map.getZoom() >= MAXZ;
          if (tight) opts.onGroup(g.list.map(x => x.id));
          else map.flyToBounds(b, { padding: [80, 80], maxZoom: MAXZ, duration: .45 });
        });
        layer.addLayer(mk);
      });
    }
    map.on("zoomend", draw);
    const api = {
      map,
      setItems(list) { items = list.filter(x => typeof x.lat === "number" && typeof x.lng === "number"); draw(); },
      fit(animate) {
        if (!items.length) return;
        const b = L.latLngBounds(items.map(x => [x.lat, x.lng]));
        const pad = opts.padding || [70, 70];
        if (items.length === 1) map.setView([items[0].lat, items[0].lng], 16, { animate: !!animate });
        else map.fitBounds(b, { paddingTopLeft: [pad[0], pad[1]], paddingBottomRight: [pad[0], opts.bottomPad || pad[1]], maxZoom: 17, animate: !!animate });
      },
      focus(lat, lng, offsetY) {
        const z = Math.max(map.getZoom(), 17), pt = map.project([lat, lng], z).add([0, offsetY || 0]);
        map.flyTo(map.unproject(pt, z), z, { duration: .5 });
      },
      relayout() { map.invalidateSize(false); },
      destroy() { map.remove(); }
    };
    return api;
  }

  window.MG_MAP = {
    trail: trailMap,
    async create(host, opts) {
      try { localStorage.removeItem("mg:map"); } catch (_) { }   // 예전 비교용 스위치 값 정리
      return leafletAdapter(host, opts);
    }
  };
})();
