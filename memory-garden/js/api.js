/* 기억 정원 · 데이터 계층
   - live: Supabase(익명 로그인 + DB 함수 + 사진 저장소). 권한 확인은 서버(supabase/schema.sql)에서 해요.
   - demo: 설정이 없을 때. 이 기기 브라우저에만 저장하고, 같은 규칙을 흉내 내요(시연·개발용).
   화면 코드는 아래 같은 모양의 기억 객체만 다뤄요.
   { id, mine, state: mine|discovered|undiscovered, lat, lng, title, story, place, hint, photo, vis: all|me,
     date, author: { name, avatar }, hearts, liked, replies: [{ name, avatar, text, date, mine }], firstDist } */
(function () {
  "use strict";
  const CFG = window.MG_CONFIG || {};
  const G = window.MG_GEO;
  const DEFAULTS = { radius: +CFG.unlockRadiusM || 50, maxAcc: +CFG.maxAccuracyM || 60, nearbyKm: 3, requireLogin: true };

  class ApiError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }

  const visIn = v => v === "private" ? "me" : "all";
  const visOut = v => v === "me" ? "private" : "public";
  const authorOf = a => a ? { name: a.nickname || "정원사", avatar: a.avatar === "me" && a.avatar_url ? a.avatar_url : (a.avatar && a.avatar !== "me" ? a.avatar : "char-lavender") } : { name: "정원사", avatar: "char-lavender" };

  /* =================================================================== */
  /* Supabase                                                              */
  /* =================================================================== */
  function SupabaseApi() {
    // 카카오 로그인 후 돌아오면(?code=...) supabase-js가 세션으로 바꿔요(PKCE).
    const urlErr = (() => { const q = new URLSearchParams(location.search + "&" + location.hash.replace(/^#/, "").replace(/^\/[^?]*\??/, "")); const d = q.get("error_description") || q.get("error"); return d ? { code: q.get("error_code") || q.get("error") || "", message: d } : null; })();
    const hadCode = /[?&]code=/.test(location.search);
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "mg-auth" } });
    const signed = new Map();   // photo_path → { url, exp }
    let uid = null, user = null;
    const back = () => location.origin + location.pathname;
    function cleanUrl() {
      // 로그인 뒤 주소창의 ?code= · 오류 문구를 지우고, 로그인 전에 보던 화면으로 돌아가요
      let h = location.hash; try { const saved = sessionStorage.getItem("mg:afterLogin"); if (saved) { h = saved; sessionStorage.removeItem("mg:afterLogin"); } } catch (_) { }
      if (location.search || /error|access_token/.test(location.hash)) history.replaceState(null, "", back() + (h && !/error|access_token/.test(h) ? h : "#/"));
      else if (h !== location.hash) history.replaceState(null, "", back() + h);
    }

    const call = async (fn, args) => {
      const { data, error } = await sb.rpc(fn, args || {});
      if (error) throw new ApiError(error.code || "rpc", error.message);
      return data;
    };
    async function sign(paths) {
      const now = Date.now(), need = [...new Set(paths.filter(p => p && !(signed.has(p) && signed.get(p).exp > now)))];
      if (need.length) {
        const { data, error } = await sb.storage.from("memory-photos").createSignedUrls(need, 3600);
        if (!error && data) data.forEach(d => { if (d.signedUrl) signed.set(d.path, { url: d.signedUrl, exp: now + 50 * 60 * 1000 }); });
      }
      return p => (p && signed.has(p)) ? signed.get(p).url : null;
    }
    const full = (j, url) => ({
      id: j.id, mine: !!j.mine, state: j.mine ? "mine" : "discovered", lat: +j.lat, lng: +j.lng,
      title: j.title, story: j.story, place: j.place_name, hint: j.hint || "", photoPath: j.photo_path, photo: url(j.photo_path),
      vis: visIn(j.visibility), date: j.created_at, author: authorOf(j.author), hearts: j.hearts || 0, liked: !!j.liked,
      firstDist: j.first_dist_m, replies: (j.replies || []).map(r => ({ id: r.id, name: r.nickname || "정원사", avatar: authorOf(r).avatar, text: r.body, date: r.created_at, mine: r.mine })), full: true
    });

    // 카카오 로그인 때마다 계정 고르기 화면을 띄워요(브라우저에 남은 카카오 로그인으로 예전 계정에 자동으로 붙지 않게)
    const KAKAO_PICK = { prompt: "select_account" };
    return {
      mode: "live",
      async init() {
        let { data: { session } } = await sb.auth.getSession();
        if (!session) {
          const { data, error } = await sb.auth.signInAnonymously();
          if (error) throw new ApiError(/anonymous/i.test(error.message) ? "anon_disabled" : "auth", error.message);
          session = data.session;
        }
        uid = session.user.id; user = session.user;
        sb.auth.onAuthStateChange((_e, s) => { if (s && s.user) { uid = s.user.id; user = s.user; } });
        cleanUrl();
        return { uid, loginError: urlErr, justLoggedIn: hadCode && user.is_anonymous === false };
      },
      // 로그인(익명 아님)했는가 — 심기·처음 열기는 서버도 같은 기준으로 막아요
      member() { return !!user && user.is_anonymous === false; },
      memberName() { const m = (user && user.user_metadata) || {}; return m.nickname || m.name || m.full_name || m.preferred_username || m.user_name || null; },
      // 익명으로 쓰던 기록을 그대로 카카오 계정에 이어 붙여요. 카카오 화면으로 이동했다가 돌아와요.
      async loginKakao() {
        try { sessionStorage.setItem("mg:afterLogin", location.hash || "#/"); } catch (_) { }
        const opts = { provider: "kakao", options: { redirectTo: back(), queryParams: KAKAO_PICK } };
        const { error } = user && user.is_anonymous ? await sb.auth.linkIdentity(opts) : await sb.auth.signInWithOAuth(opts);
        if (error) throw new ApiError(/manual linking/i.test(error.message) ? "linking_disabled" : "login", error.message);
      },
      // 이 카카오 계정에 이미 다른 정원이 있을 때: 그 계정으로 로그인(이 기기의 익명 기록은 옮겨지지 않아요)
      async switchToKakao() {
        await sb.auth.signOut({ scope: "local" });
        try { sessionStorage.setItem("mg:afterLogin", location.hash || "#/"); } catch (_) { }
        const { error } = await sb.auth.signInWithOAuth({ provider: "kakao", options: { redirectTo: back(), queryParams: KAKAO_PICK } });
        if (error) throw new ApiError("login", error.message);
      },
      async logout() { await sb.auth.signOut({ scope: "local" }); },
      memberEmail() { return (user && user.is_anonymous === false && user.email) || null; },
      // 광고성 이메일 수신 동의(선택). 동의·철회 시각은 서버 트리거가 기록해요.
      async marketing() {
        const { data, error } = await sb.from("marketing_consents").select("opt_in, consented_at").eq("user_id", uid).maybeSingle();
        if (error) throw new ApiError("consent", error.message);
        return data;   // null = 아직 안 물어봄
      },
      async setMarketing(on) {
        const cur = await this.marketing();
        const q = cur ? sb.from("marketing_consents").update({ opt_in: on }).eq("user_id", uid) : sb.from("marketing_consents").insert({ opt_in: on });
        const { error } = await q;
        if (error) throw new ApiError("consent", error.message);
      },
      async settings() {
        try { const s = await call("app_settings"); return { radius: +s.unlock_radius_m || DEFAULTS.radius, maxAcc: +s.max_accuracy_m || DEFAULTS.maxAcc, nearbyKm: +s.nearby_km || 3, requireLogin: s.require_login !== false }; }
        catch (_) { return DEFAULTS; }
      },
      async profile() {
        const { data, error } = await sb.from("profiles").select("nickname, avatar, avatar_url").eq("id", uid).maybeSingle();
        if (error) throw new ApiError("profile", error.message);
        return data || { nickname: "정원사", avatar: "char-lavender" };
      },
      async updateProfile(patch) {
        const { error } = await sb.from("profiles").update(patch).eq("id", uid);
        if (error) throw new ApiError("profile", error.message);
      },
      async uploadAvatar(dataUrl) {
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${uid}/portrait.png`;
        const { error } = await sb.storage.from("avatars").upload(path, blob, { contentType: "image/png", upsert: true, cacheControl: "60" });
        if (error) throw new ApiError("upload", error.message);
        const url = sb.storage.from("avatars").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
        await this.updateProfile({ avatar: "me", avatar_url: url });
        return url;
      },
      async nearby(pos) {
        const rows = await call("nearby_memories", { p_lat: pos.lat, p_lng: pos.lng });
        const url = await sign(rows.map(r => r.photo_path));
        return rows.map(r => r.state === "undiscovered"
          ? { id: r.id, mine: false, state: "undiscovered", lat: r.lat, lng: r.lng, place: r.place_name, hint: r.hint || "" }
          : { id: r.id, mine: r.state === "mine", state: r.state, lat: r.lat, lng: r.lng, place: r.place_name, hint: r.hint || "", title: r.title, photoPath: r.photo_path, photo: url(r.photo_path), vis: r.state === "mine" ? visIn(r.visibility) : "all", date: r.created_at, author: authorOf({ nickname: r.author_nickname, avatar: r.author_avatar, avatar_url: r.author_avatar_url }) });
      },
      async detail(id) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) return { status: "unavailable" };
        const r = await call("memory_detail", { p_id: id });
        if (r.status === "mine" || r.status === "discovered") { const url = await sign([r.memory.photo_path]); return { status: r.status, memory: full(r.memory, url) }; }
        if (r.status === "locked") return { status: "locked", memory: { id: r.memory.id, mine: false, state: "undiscovered", lat: +r.memory.lat, lng: +r.memory.lng, place: r.memory.place_name, hint: r.memory.hint || "" } };
        return { status: r.status };
      },
      async open(id, pos) {
        const r = await call("open_memory", { p_id: id, p_lat: pos ? pos.lat : null, p_lng: pos ? pos.lng : null, p_accuracy: pos ? pos.acc : null });
        if (r.memory) { const url = await sign([r.memory.photo_path]); r.memory = full(r.memory, url); }
        return r;
      },
      async garden() {
        const g = await call("my_garden");
        const url = await sign([...g.mine.map(m => m.photo_path), ...g.collected.filter(c => !c.gone).map(c => c.memory.photo_path)]);
        return {
          mine: g.mine.map(m => full(m, url)),
          collected: g.collected.map(c => c.gone ? { gone: true, id: "trace-" + c.trace_id, at: c.discovered_at } : Object.assign(full(c.memory, url), { gone: false, at: c.discovered_at }))
        };
      },
      async plant(d) {
        let path = null;
        if (d.photoBlob) {
          path = `${uid}/${(crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2))}.jpg`;
          const { error } = await sb.storage.from("memory-photos").upload(path, d.photoBlob, { contentType: "image/jpeg", upsert: false });
          if (error) throw new ApiError("upload", error.message);
        }
        try {
          const j = await call("plant_memory", { p_title: d.title, p_story: d.story, p_place: d.place, p_hint: d.hint || null, p_photo_path: path, p_lat: d.pos.lat, p_lng: d.pos.lng, p_accuracy: d.pos.acc, p_visibility: visOut(d.vis) });
          const url = await sign([j.photo_path]);
          return full(j, url);
        } catch (e) {
          if (path) sb.storage.from("memory-photos").remove([path]).catch(() => { });
          if (/low accuracy/.test(e.message)) e.code = "low_accuracy";
          if (/too many/.test(e.message)) e.code = "too_many";
          if (/login required/.test(e.message)) e.code = "login_required";
          throw e;
        }
      },
      async setVisibility(id, vis) {
        const { error } = await sb.from("memories").update({ visibility: visOut(vis), updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw new ApiError("update", error.message);
      },
      async remove(id) {
        const { data } = await sb.from("memories").select("photo_path").eq("id", id).maybeSingle();
        const { error } = await sb.from("memories").delete().eq("id", id);
        if (error) throw new ApiError("delete", error.message);
        if (data && data.photo_path) await sb.storage.from("memory-photos").remove([data.photo_path]).catch(() => { });
      },
      async reply(id, text) {
        const { error } = await sb.from("replies").insert({ memory_id: id, body: text });
        if (error) throw new ApiError("reply", error.message);
      },
      async heart(id, on) {
        const q = on ? sb.from("hearts").insert({ memory_id: id }) : sb.from("hearts").delete().eq("memory_id", id).eq("user_id", uid);
        const { error } = await q;
        if (error && error.code !== "23505") throw new ApiError("heart", error.message);
      }
    };
  }

  /* =================================================================== */
  /* Demo (이 기기에만 저장)                                               */
  /* =================================================================== */
  function LocalApi() {
    const KEY = "mg:demo-db";
    const D = window.MG_DATA;
    const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (_) { return null; } };
    let db = load() || { anchor: null, memories: [], discoveries: {}, hearts: {}, replies: {}, profile: { nickname: "리마", avatar: "char-lavender" } };
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (_) { /* 용량 초과 · 사생활 보호 모드 */ } };
    const wait = (ms = 250) => new Promise(r => setTimeout(r, ms));
    const S = DEFAULTS;
    // 예시 기억을 처음 받은 위치 주변에 심어요(일러스트 지도 좌표 → 미터)
    function seed(anchor) {
      db.anchor = { lat: anchor.lat, lng: anchor.lng };
      db.memories = db.memories.filter(m => m.owner === "me");
      D.memories.forEach(s => {
        const p = G.offset(anchor, (s.x - D.me.x) * D.scale, -(s.y - D.me.y) * D.scale);
        db.memories.push({ id: s.id, owner: "other", lat: p.lat, lng: p.lng, title: s.title, story: s.story, place: s.place, hint: s.hint || "", photo: s.photo, vis: s.vis || "all", date: s.date, author: s.author, baseHearts: s.hearts || 0, seedReplies: s.replies || [] });
      });
      ["sunset", "bridge"].forEach(id => { if (!db.discoveries[id]) db.discoveries[id] = { at: new Date().toISOString(), firstDist: (D.memories.find(m => m.id === id) || {}).firstDist || 30 }; });
      persist();
    }
    const canView = m => m.owner === "me" || (m.vis === "all" && db.discoveries[m.id]);
    const fullOf = m => ({
      id: m.id, mine: m.owner === "me", state: m.owner === "me" ? "mine" : "discovered", lat: m.lat, lng: m.lng, title: m.title, story: m.story, place: m.place, hint: m.hint,
      photo: m.photo, vis: m.vis, date: m.date, author: m.owner === "me" ? { name: db.profile.nickname, avatar: db.profile.avatar === "me" && db.profile.avatar_url ? db.profile.avatar_url : db.profile.avatar } : m.author,
      hearts: (m.baseHearts || 0) + (db.hearts[m.id] ? 1 : 0), liked: !!db.hearts[m.id], firstDist: db.discoveries[m.id] ? db.discoveries[m.id].firstDist : null,
      replies: [...(m.seedReplies || []).map(r => ({ name: r.name, avatar: r.avatar, text: r.text, date: null, when: r.when })), ...(db.replies[m.id] || [])], full: true
    });
    const r4 = v => Math.round(v * 1e4) / 1e4;
    return {
      mode: "demo",
      async init() { return { uid: "demo" }; },
      member() { return true; },          // 데모 모드는 로그인 없이 모두 체험
      memberName() { return null; },
      async loginKakao() { }, async switchToKakao() { }, async logout() { },
      memberEmail() { return null; }, async marketing() { return { opt_in: false }; }, async setMarketing() { },
      async settings() { return S; },
      async profile() { return db.profile; },
      async updateProfile(p) { Object.assign(db.profile, p); persist(); },
      async uploadAvatar(dataUrl) { db.profile.avatar = "me"; db.profile.avatar_url = dataUrl; persist(); return dataUrl; },
      async nearby(pos) {
        await wait(350);
        if (!db.anchor || G.distance(db.anchor, pos) > S.nearbyKm * 1000) seed(pos);
        return db.memories.filter(m => m.owner === "me" || m.vis === "all").filter(m => G.distance(pos, m) <= S.nearbyKm * 1000).map(m => {
          if (canView(m)) return fullOf(m);
          return { id: m.id, mine: false, state: "undiscovered", lat: r4(m.lat), lng: r4(m.lng), place: m.place, hint: m.hint };
        });
      },
      async detail(id) {
        await wait(150);
        const m = db.memories.find(x => x.id === id);
        if (!m) return { status: db.discoveries[id] ? "gone" : "unavailable" };
        if (m.owner === "me") return { status: "mine", memory: fullOf(m) };
        if (m.vis !== "all") return { status: db.discoveries[id] ? "gone" : "unavailable" };
        if (db.discoveries[id]) return { status: "discovered", memory: fullOf(m) };
        return { status: "locked", memory: { id: m.id, mine: false, state: "undiscovered", lat: r4(m.lat), lng: r4(m.lng), place: m.place, hint: m.hint } };
      },
      async open(id, pos) {
        await wait(300);
        const d = await this.detail(id);
        if (d.status !== "locked") return d;
        if (!pos) return { status: "need_location" };
        if (pos.acc > S.maxAcc) return { status: "low_accuracy", max_accuracy_m: S.maxAcc };
        const m = db.memories.find(x => x.id === id), dist = G.distance(pos, m);
        if (dist > S.radius) return { status: "too_far", distance_m: Math.round(dist), radius_m: S.radius };
        db.discoveries[id] = { at: new Date().toISOString(), firstDist: Math.round(dist) }; persist();
        return { status: "discovered", first: true, memory: fullOf(m) };
      },
      async garden() {
        await wait(250);
        const mine = db.memories.filter(m => m.owner === "me").sort((a, b) => b.date.localeCompare(a.date)).map(fullOf);
        const collected = Object.entries(db.discoveries).sort((a, b) => a[1].at.localeCompare(b[1].at)).map(([id, d]) => {
          const m = db.memories.find(x => x.id === id);
          return m && m.vis === "all" ? Object.assign(fullOf(m), { gone: false, at: d.at }) : { gone: true, id: "trace-" + id, at: d.at };
        });
        return { mine, collected };
      },
      async plant(d) {
        await wait(900);
        if (navigator.onLine === false) throw new ApiError("offline");
        if (!d.pos || d.pos.acc > S.maxAcc) throw new ApiError("low_accuracy");
        const m = { id: "mine-" + Date.now(), owner: "me", lat: d.pos.lat, lng: d.pos.lng, title: d.title, story: d.story, place: d.place, hint: d.hint || "", photo: d.photoDataUrl || null, vis: d.vis, date: new Date().toISOString(), baseHearts: 0 };
        db.memories.push(m); persist();
        return fullOf(m);
      },
      async setVisibility(id, vis) { const m = db.memories.find(x => x.id === id && x.owner === "me"); if (!m) throw new ApiError("update"); m.vis = vis; persist(); },
      async remove(id) { db.memories = db.memories.filter(x => !(x.id === id && x.owner === "me")); persist(); },
      async reply(id, text) { const m = db.memories.find(x => x.id === id); if (!m || !canView(m)) throw new ApiError("reply"); (db.replies[id] = db.replies[id] || []).push({ name: db.profile.nickname, avatar: db.profile.avatar === "me" && db.profile.avatar_url ? db.profile.avatar_url : db.profile.avatar, text, date: new Date().toISOString(), mine: true }); persist(); },
      async heart(id, on) { if (on) db.hearts[id] = 1; else delete db.hearts[id]; persist(); },
      // 데모 패널: 작성자가 '다리 위 편지'를 비공개로 바꾼 상황
      demoToggleRevoke(id) { const m = db.memories.find(x => x.id === id); if (!m) return false; m.vis = m.vis === "all" ? "me" : "all"; persist(); return m.vis === "me"; },
      demoRevoked(id) { const m = db.memories.find(x => x.id === id); return !!m && m.vis === "me"; },
      demoReset() { try { localStorage.removeItem(KEY); } catch (_) { } }
    };
  }

  const live = !!(CFG.supabaseUrl && CFG.supabaseKey && window.supabase);
  window.MG_API = live ? SupabaseApi() : LocalApi();
  window.MG_API.Error = ApiError;
  window.MG_API.defaults = DEFAULTS;
})();
