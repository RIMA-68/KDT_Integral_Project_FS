/* 기억 정원 · 현재 위치
   - 브라우저 위치 권한을 받아 watchPosition 으로 계속 갱신해요.
   - 위치는 화면 계산과 서버 확인(열기·심기)에만 쓰고, 이동 기록은 어디에도 저장하지 않아요.
   - 상태: idle(아직 안 물어봄) · asking · ok · denied · unavailable · timeout · insecure · unsupported */
(function () {
  "use strict";
  const R = 6371008.8, rad = d => d * Math.PI / 180;
  function distance(a, b) {
    if (!a || !b) return null;
    const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  // 북쪽 0°, 시계 방향
  function bearing(a, b) {
    const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  // a에서 동쪽 east m, 북쪽 north m 떨어진 점
  function offset(a, east, north) {
    return { lat: a.lat + north / 111320, lng: a.lng + east / (111320 * Math.cos(rad(a.lat))) };
  }

  const listeners = new Set();
  const G = {
    state: "idle", pos: null, error: null, simulated: false, watchId: null,
    distance, bearing, offset,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit() { listeners.forEach(fn => { try { fn(G); } catch (e) { console.error(e); } }); },
    supported() { return !!navigator.geolocation; },
    secure() { return window.isSecureContext !== false; },
    // 권한이 이미 허용돼 있으면 묻지 않고 바로 시작할 수 있어요(새로고침 때)
    async permission() {
      try { const p = await navigator.permissions.query({ name: "geolocation" }); return p.state; } catch (_) { return "unknown"; }
    },
    start() {
      if (G.simulated) return;
      if (!G.secure()) { G.set("insecure"); return; }
      if (!G.supported()) { G.set("unsupported"); return; }
      if (G.watchId != null) { navigator.geolocation.clearWatch(G.watchId); G.watchId = null; }
      if (G.state !== "ok") G.set("asking");
      try {
        G.watchId = navigator.geolocation.watchPosition(p => {
          if (G.simulated) return;
          G.pos = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 9999), ts: p.timestamp || Date.now() };
          G.error = null; G.set("ok");
        }, err => {
          if (G.simulated) return;
          G.error = err;
          if (err.code === 1) { G.stop(); G.pos = null; G.set("denied"); }
          else if (G.pos && Date.now() - G.pos.ts < 120000) G.emit();     // 잠깐 놓친 것: 마지막 위치 유지
          else G.set(err.code === 3 ? "timeout" : "unavailable");
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      } catch (_) { G.set("unavailable"); }
    },
    stop() { if (G.watchId != null) { try { navigator.geolocation.clearWatch(G.watchId); } catch (_) { } G.watchId = null; } },
    set(st) { G.state = st; G.emit(); },
    // 데모 모드 전용: 실제 위치 대신 정한 위치로
    simulate(pos) {
      if (!pos) { G.simulated = false; G.pos = null; G.set("idle"); G.start(); return; }
      G.stop(); G.simulated = true; G.pos = Object.assign({ acc: 12, ts: Date.now() }, pos); G.error = null; G.set("ok");
    }
  };
  window.MG_GEO = G;
})();
