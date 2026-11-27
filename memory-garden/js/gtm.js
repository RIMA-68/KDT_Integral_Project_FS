/* 기억 정원 GTM 이벤트
   정의서의 이름과 키만 보냅니다. 글 본문·이메일 전체·비밀번호·닉네임은 넣지 않아요.
   page_name, step은 화면 표 기준이고, 시트는 화면으로 세지 않아요. */
(function () {
  "use strict";
  window.MG_GTM = function (api) {
    let modalName = "";
    let loginContext = "account";
    let lastScreen = "";

    const S = () => api.state();
    const GEO = () => api.geo();

    function locState() {
      const g = GEO();
      if (g.state === "asking") return "asking";
      if (g.state === "denied") return "denied";
      if (api.locOk() && !api.accOk()) return "low_accuracy";
      if (api.locOk()) return "on";
      return g.state && g.state !== "ok" ? g.state : "off";
    }
    function distM(m) {
      if (!m) return undefined;
      const d = api.distOf(m);
      return d == null ? undefined : Math.round(d);
    }
    function hashRoute() {
      const h = location.hash || "#/";
      const p = h.slice(2).split("/");
      return { hash: h, name: p[0] || "home", arg: p[1] ? decodeURIComponent(p[1]) : "" };
    }
    function pack(screen, page_name, step, extra) {
      return { screen, page_name, step, extra: extra || {} };
    }
    function memoryScreen(id) {
      const st = S().status[id];
      const m = api.byId(id);
      if (st === "gone" || (m && api.isGone(m))) return pack("memory_gone", "기억 없음", "기억-없음");
      if (st === "unavailable") return pack("memory_unavailable", "열람 불가 기억", "기억-열람불가");
      if (st === "error") return pack("memory_error", "기억 오류", "기억-오류", { memory_id: id });
      if (S().found === id && m && m.full) return pack("memory_found", "기억 발견", "발견-2 연출", { memory_id: id });
      if (!m || st === "loading" || ((m.mine || m.state === "discovered") && !m.full)) return pack("memory_loading", "기억 로딩", "기억-로딩", { memory_id: id });
      if (m.mine) return pack("memory_mine", "내 기억 상세", "기억-내것", { memory_id: id, visibility: m.vis || "all", reply_count: (m.replies || []).length, heart_count: m.hearts || 0 });
      if (api.discovered(m)) return pack("memory_open", "기억 열람", "발견-3 열람", { memory_id: id, visibility: m.vis || "all" });
      return pack("memory_locked", "잠긴 기억", "발견-1 잠김", { memory_id: id, can_open: api.canOpen(m), secret: !!(m.secret || m.vis === "key"), distance_m: distM(m) });
    }
    function shareState(id) {
      const st = S().status[id], m = api.byId(id);
      if (!m || st === "gone" || st === "unavailable") return "unavailable";
      if (m.mine) return "mine";
      if (api.discovered(m)) return "discovered";
      return "locked";
    }
    function screenNow() {
      const r = hashRoute();
      const bootSkip = ["welcome", "avatar", "plant"].indexOf(r.name) >= 0;
      if (!bootSkip && S().boot !== "ok") {
        if (S().boot === "error") return pack("boot_error", "연결 오류", "앱-연결실패", S().bootErr ? { error_code: S().bootErr } : {});
        return pack("boot", "앱 로딩", "앱-부트");
      }
      if (r.name === "welcome") {
        return r.arg === "location"
          ? pack("welcome_location", "온보딩화면", "온보딩-2 위치")
          : pack("welcome", "웰컴화면", "온보딩-1 시작");
      }
      if (r.name === "plant") {
        if (S().boot === "ok" && !api.member() && ["done", "doing"].indexOf(r.arg) < 0) return pack("login_gate", "로그인 게이트", "심기>로그인게이트");
        const step = r.arg || "1";
        const rows = {
          "1": ["plant_1", "심기-1 사진"], "2": ["plant_2", "심기-2 본문"], "3": ["plant_3", "심기-3 공개"],
          doing: ["plant_doing", "심기-진행"], fail: ["plant_fail", "심기-실패"], done: ["plant_done", "심기-완료"]
        };
        const row = rows[step] || rows["1"];
        const extra = {};
        if (step === "3") extra.loc_state = locState();
        if (step === "fail" && S().plantErr) extra.error_code = S().plantErr;
        if (step === "done" && S().lastPlanted) extra.visibility = S().lastPlanted.vis || "all";
        return pack(row[0], "기억 심기", row[1], extra);
      }
      if (r.name === "m") return memoryScreen(r.arg);
      if (r.name === "s") return pack("share", "공유 링크", "공유-진입", { share_state: shareState(r.arg), memory_id: r.arg });
      if (r.name === "garden") {
        const g = S().garden;
        const extra = {};
        if (g) { extra.planted_count = (g.mine || []).length; extra.collected_count = (g.collected || []).length; }
        return pack("garden", "내 정원", "정원-홈", extra);
      }
      if (r.name === "settings") return pack("settings", "설정", "설정-화면");
      if (r.name === "alerts") {
        if (!api.notifOn()) return pack("alerts_gate", "알림", "알림-게이트");
        return pack("alerts", "알림", "알림-목록", { unread_count: (S().notif && S().notif.unread) || 0 });
      }
      if (r.name === "avatar") return pack("avatar", "캐릭터 꾸미기", "아바타-스테이지", { is_first: api.avFirst() });
      if (r.name === "trail") {
        const g = S().garden;
        if (!g) return pack("trail_loading", "내 발자취", "발자취-로딩");
        const mine = S().forced === "empty" ? [] : (g.mine || []);
        return pack("trail", "내 발자취", "발자취-지도", { planted_count: mine.length, place_count: api.trailSpots(mine) });
      }
      return pack("map", "메인화면", "메인-홈", { loc_state: locState(), data_state: api.dataState(), sheet_mode: S().sheetMode });
    }
    function screenKeyFromHash(href) {
      const h = href || "";
      if (h === "#/" || h === "") return "map";
      if (h.indexOf("#/garden") === 0) return "garden";
      if (h.indexOf("#/settings") === 0) return "settings";
      if (h.indexOf("#/alerts") === 0) return "alerts";
      if (h.indexOf("#/avatar") === 0) return "avatar";
      if (h.indexOf("#/trail") === 0) return "trail";
      if (h.indexOf("#/welcome/location") === 0) return "welcome_location";
      if (h.indexOf("#/welcome") === 0) return "welcome";
      if (h.indexOf("#/plant/") === 0) return "plant_" + h.split("/")[2];
      if (h.indexOf("#/m/") === 0) return "memory";
      if (h.indexOf("#/s/") === 0) return "share";
      return "";
    }
    function track(event, extra) {
      try {
        const sc = screenNow();
        const payload = { event: event, page_name: sc.page_name, step: sc.step, logged_in: !!api.member() };
        const add = extra || {};
        Object.keys(add).forEach(k => { if (add[k] !== undefined && add[k] !== "") payload[k] = add[k]; });
        window.dataLayer = window.dataLayer || [];
        window.dataLayer.push(payload);
      } catch (e) { console.warn("[gtm]", e); }
    }
    function onRender() {
      const sc = screenNow();
      if (sc.screen === lastScreen) return;
      lastScreen = sc.screen;
      const extra = Object.assign({ screen: sc.screen }, sc.extra);
      track("screen_view", extra);
      if (sc.screen === "settings" && api.member() && api.provider()) track("view_logged_in_account", { provider: api.provider() });
    }
    function loginCtx() {
      return screenNow().screen === "login_gate" ? "plant" : (loginContext || "account");
    }
    function markMethod(method) {
      try { sessionStorage.setItem("mg:loginMethod", method); } catch (_) { }
    }
    const CANCEL_MODALS = ["email", "report", "vis", "delete", "logout", "avatar_leave", "avatar_reset", "profile", "nickname", "secret", "plant_secret"];

    function onClick(a, t) {
      const id = t.dataset.id;
      const text = (t.textContent || "").replace(/\s+/g, " ").trim();
      if (a === "pin") {
        const m = api.byId(id);
        track("click_map_pin", { memory_id: id, secret: !!(m && (m.secret || m.vis === "key")) });
      } else if (a === "unselect") track("click_peek_close", { memory_id: S().selected });
      else if (a === "open") {
        if (t.closest(".f-pat")) {
          const m = api.byId(id);
          track("click_nearby_pattern", { memory_id: id, can_open: t.classList.contains("can"), distance_m: distM(m) });
        } else if (t.closest(".f-peek")) track("click_peek_cta", { cta: text, memory_id: id });
        else if (t.closest(".mcard, .polaroid")) {
          const m = api.byId(id);
          const extra = { memory_id: id, source: t.closest(".polaroid") ? "garden" : "map_sheet" };
          if (m && m.vis) extra.visibility = m.vis;
          const d = distM(m); if (d != null) extra.distance_m = d;
          track("click_memory_card", extra);
        }
      } else if (a === "back") track("click_back", { from_screen: screenNow().screen, to_screen: screenKeyFromHash(t.getAttribute("href")) });
      else if (a === "sheet") {
        if (api.wasSheetDrag()) return;
        const from = S().sheetMode;
        const to = from === "min" ? "peek" : from === "peek" ? "full" : "peek";
        track("click_nearby_sheet", { from_mode: from, to_mode: to });
      } else if (a === "filter") track("click_filter", { filter: t.dataset.f });
      else if (a === "recenter") track("click_recenter");
      else if (a === "retry") track("click_near_retry");
      else if (a === "map-retry") track("click_map_retry");
      else if (a === "garden-retry") track("click_garden_retry", { source: hashRoute().name === "trail" ? "trail" : "garden" });
      else if (a === "detail-retry") track("click_detail_retry", { memory_id: id });
      else if (a === "boot-retry") track("click_boot_retry", { error_code: S().bootErr || undefined });
      else if (a === "reload") track("click_reload");
      else if (a === "loc") {
        if (hashRoute().name === "settings") track("click_loc", { loc_state: locState() });
        else if (api.locOk()) track("click_loc_on", { region: S().region || undefined });
        else if (GEO().state === "asking") track("click_loc_asking");
        else track("click_loc_off", { loc_state: locState() });
      } else if (a === "loc-retry") {
        const extra = { loc_state: locState() };
        if (api.locOk() && !api.accOk()) extra.accuracy_m = Math.round(api.pos().acc);
        track("click_loc_retry", extra);
      } else if (a === "loc-help") track("click_loc_help");
      else if (a === "like") {
        const m = api.byId(id); if (!m) return;
        const on = !m.liked;
        track("click_like", { memory_id: id, liked: on, heart_count: (m.hearts || 0) + (on ? 1 : -1) });
      } else if (a === "reply") track("click_reply_open", { memory_id: id });
      else if (a === "send-reply") {
        const v = ((document.getElementById("replyText") || {}).value || "").trim();
        if (v.length < 1) return;
        track("click_reply_send", { memory_id: id, length: v.length });
      } else if (a === "walk") track("click_walk_closer", { memory_id: id, distance_m: distM(api.byId(id)) });
      else if (a === "discover") {
        const m = api.byId(id);
        if (m && api.canOpen(m)) track("click_discover", { memory_id: id, secret: !!(m.secret || m.vis === "key") });
      } else if (a === "found-done") track("click_found_done", { memory_id: id, label: text });
      else if (a === "flower") {
        const bed = t.dataset.k === "col" ? "collected" : "mine";
        track("click_flower", { bed: bed, flower_index: Number(t.dataset.i) + 1, filled: t.classList.contains("done") });
      } else if (a === "trail-fit") track("click_trail_fit");
      else if (a === "go-alerts") track("click_alerts", { source: "settings", unread_count: (S().notif && S().notif.unread) || 0 });
      else if (a === "notif-retry") track("click_notif_retry");
      else if (a === "notif-read-all") track("click_notif_read_all", { unread_count: (S().notif && S().notif.unread) || 0 });
      else if (a === "npref") {
        const cur = S().nprefs || {};
        track("click_notif_pref", { pref: t.dataset.k, on: cur[t.dataset.k] === false });
      } else if (a === "trail-go") {
        const list = api.trailList();
        const m = list.find(x => x.id === id);
        if (!m || !api.trailReady()) return;
        const chips = [...document.querySelectorAll(".tr-chip")];
        track("click_trail_go", { memory_id: id, index: chips.indexOf(t) + 1, action: t.getAttribute("aria-pressed") === "true" ? "open" : "focus" });
      } else if (a === "fl-open") {
        if (t.classList.contains("tr-li")) track("click_trail_memory", { memory_id: id });
        else {
          const li = t.closest("li");
          const items = li && li.parentElement ? [...li.parentElement.children] : [];
          track("click_flower_memory", { memory_id: id, petal_index: items.indexOf(li) + 1 });
        }
      } else if (a === "fl-gone") track("click_flower_gone");
      else if (a === "fl-folded") track("click_flower_folded");
      else if (a === "theme-set") track("click_theme_set", { theme: t.dataset.v });
      else if (a === "vis-open") {
        const m = api.byId(id);
        track("click_vis_open", { memory_id: id, visibility: (m && m.vis) || "all" });
      } else if (a === "vis-pick") track("click_vis_pick", { memory_id: id, visibility: t.dataset.v });
      else if (a === "vis-apply") track("click_vis_apply", { memory_id: id, visibility: t.dataset.v });
      else if (a === "secret-set") {
        const v = (document.getElementById("secretNew") || {}).value || "";
        if (!api.secretOk(v)) return;
        track("click_secret_set", { memory_id: id });
      } else if (a === "report-open") {
        if (!api.member()) return;
        track("click_report_open", { memory_id: id, target: text.indexOf("힌트") >= 0 ? "hint" : "memory" });
      } else if (a === "report-pick") track("click_report_reason", { reason: t.dataset.v });
      else if (a === "del-open") track("click_delete_open", { memory_id: id });
      else if (a === "del-apply") track("click_delete", { memory_id: id });
      else if (a === "nick") track("click_nickname_open");
      else if (a === "nick-save") {
        const v = ((document.getElementById("nickInput") || {}).value || "").trim();
        if (!v) return;
        track("click_nickname_save", { length: v.length });
      } else if (a === "login") {
        markMethod("kakao");
        track("click_login_kakao", { login_context: loginCtx(), method: "kakao" });
      } else if (a === "set-avatar") track("click_avatar_open", { is_first: !S().look });
      else if (a === "profile-open") {
        const source = t.classList.contains("f-mypetal") ? "petal" : "garden";
        track("click_profile_open", { source: source, has_avatar: S().avatar === "me" });
      } else if (a === "petal-set") track("click_petal", { petal: t.dataset.v });
      else if (a === "mkt-set") track("click_marketing_set", { consent: t.dataset.v === "1" ? 1 : 0 });
      else if (a === "mkt-toggle") track("click_marketing", { on: !S().mkt });
      else if (a === "login-other") { markMethod("kakao"); track("click_login_other", { method: "kakao" }); }
      else if (a === "switch-open") track("click_switch_open");
      else if (a === "email-open") {
        if (modalName === "email_sent") track("click_login_email_retry");
        else track("click_login_email_open", { login_context: loginCtx() });
      } else if (a === "email-send") {
        const v = ((document.getElementById("emailInput") || {}).value || "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
        const domain = (v.split("@")[1] || "").toLowerCase();
        track("click_login_email_send", { email_domain: domain });
      } else if (a === "email-fresh") { markMethod("email"); track("click_login_email_fresh", { method: "email" }); }
      else if (a === "logout-open") track("click_logout_open");
      else if (a === "login-switch") { markMethod("kakao"); track("click_login_switch", { method: "kakao" }); }
      else if (a === "logout") track("click_logout");
      else if (a === "close") {
        if (modalName === "existing_account") track("click_login_cancel", { method: "kakao", label: text });
        else if (modalName === "login" || modalName === "email_sent") track("click_login_dismiss", { login_context: loginContext, label: text });
        else if (modalName === "gone" || modalName === "folded") track("click_modal_confirm", { modal: modalName });
        else if (CANCEL_MODALS.indexOf(modalName) >= 0) track("click_modal_cancel", { modal: modalName });
      } else if (a === "focus") {
        if (text.indexOf("가까이") >= 0) track("click_walk_closer", { memory_id: id, distance_m: distM(api.byId(id)) });
        else track("click_focus_map", { memory_id: id });
      } else if (a === "go") {
        if (t.disabled) return;
        const from = (location.hash.match(/#\/plant\/(\d)/) || [])[1] || "";
        const to = (t.dataset.to || "").match(/plant\/(\d)/);
        track("click_plant_next", { from_step: from, to_step: to ? to[1] : "" });
      } else if (a === "nophoto") track("click_plant_nophoto");
      else if (a === "prompt") track("click_plant_prompt", { prompt: t.dataset.p });
      else if (a === "vis") track("click_plant_vis", { visibility: t.dataset.v });
      else if (a === "plant") {
        const dr = S().draft || {};
        track("click_plant", { visibility: dr.vis || "all", has_photo: !!(dr.photo || dr.blob), has_hint: !!(dr.hint && dr.hint.trim()), retry: screenNow().screen === "plant_fail" });
      } else if (a === "after-plant") track("click_after_plant", { visibility: (S().lastPlanted && S().lastPlanted.vis) || "all" });
      else if (a === "gtab") track("click_garden_tab", { tab: t.dataset.t === "col" ? "collected" : t.dataset.t });
      else if (a === "lumi-hide") track("click_mori_hide");
      else if (a === "lumi-show") track("click_mori_show");
      else if (a === "allow") track("click_allow_location");
      else if (a === "deny") track("click_browse_only");
    }
    function onAvatar(a, t, dirty) {
      if (a === "av-back") track("click_avatar_back", { dirty: !!dirty });
      else if (a === "av-discard") track("click_avatar_discard");
      else if (a === "av-save-leave") track("click_avatar_save_leave");
      else if (a === "av-retry") track("click_avatar_retry");
      else if (a === "av-tab") track("click_avatar_tab", { avatar_tab: t.dataset.t });
      else if (a === "av-set") track("click_avatar_option", { option_key: t.dataset.k, option_value: String(t.dataset.v) });
      else if (a === "av-random") track("click_avatar_random");
      else if (a === "av-reset") track("click_avatar_reset");
      else if (a === "av-reset-go") track("click_avatar_reset_go");
      else if (a === "av-undo") track("click_avatar_undo");
      else if (a === "av-save") track("click_avatar_save");
    }
    function onLink(a) {
      if (a.closest("[data-act]") || a.closest(".demo-panel")) return;
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").replace(/\s+/g, " ").trim();
      const sc = screenNow();
      if (a.closest(".tabbar")) {
        if (href === "#/") track("click_tab_map", { destination: "#/" });
        else if (href.indexOf("#/plant") === 0) track("click_tab_plant", { destination: "#/plant/1" });
        else if (href.indexOf("#/garden") === 0) track("click_tab_garden", { destination: "#/garden" });
        return;
      }
      if (a.classList.contains("f-logo") || a.classList.contains("f-brandbar")) { track("click_logo_home"); return; }
      if (href === "#/welcome/location") { track("click_welcome_start"); return; }
      if (a.classList.contains("f-trailcard")) {
        const mine = (S().garden && S().garden.mine) || [];
        track("click_trail_open", { planted_count: mine.length });
        return;
      }
      if (a.classList.contains("f-bellbtn")) {
        const source = sc.screen === "garden" ? "garden" : "map";
        track("click_alerts", { source: source, unread_count: (S().notif && S().notif.unread) || 0 });
        return;
      }
      if (a.classList.contains("nt-row")) {
        const mid = (href.match(/#\/m\/([^?#]+)/) || [])[1];
        const kind = a.querySelector(".k-reply") ? "reply" : a.querySelector(".k-heart") ? "heart" : "collect";
        track("click_notif", { kind: kind, memory_id: mid ? decodeURIComponent(mid) : undefined, read: !a.classList.contains("unread") });
        return;
      }
      if (href.indexOf("#/settings") === 0) {
        const source = text.indexOf("알림 설정") >= 0 ? "alerts_empty" : a.closest(".nt-foot") ? "alerts_foot" : "garden";
        track("click_settings", { source: source });
        return;
      }
      if (text.indexOf("첫 기억 심기") >= 0) {
        const source = sc.screen === "garden" ? "garden" : (sc.screen === "trail" || sc.screen === "trail_loading") ? "trail" : "map";
        track("click_first_plant", { source: source });
        return;
      }
      if (sc.screen === "login_gate" && a.getAttribute("aria-label") === "닫기") { track("click_login_close"); return; }
      if (a.closest(".f-flowhead") && href.indexOf("#/plant/") === 0) {
        track("click_plant_back", { from_step: (location.hash.match(/#\/plant\/(\d)/) || [])[1] || "" });
        return;
      }
      if (a.closest(".f-flowhead") && a.getAttribute("aria-label") === "닫기") {
        const from = sc.screen === "plant_fail" ? "fail" : ((location.hash.match(/#\/plant\/(\d)/) || [])[1] || "1");
        track("click_plant_close", { from_step: from });
        return;
      }
      if (href === "#/plant/3") { track("click_plant_review"); return; }
      if (sc.screen === "plant_done" && href.indexOf("#/garden") === 0) {
        track("click_after_plant_garden", { visibility: (S().lastPlanted && S().lastPlanted.vis) || "all" });
        return;
      }
      if (text === "내 정원으로") { track("click_back_garden"); return; }
      if (text.indexOf("지도") === 0) {
        let source = sc.screen;
        if (sc.screen === "memory_unavailable") source = "memory_gone";
        if (sc.screen === "garden" && S().gardenTab === "col") source = "garden_collected";
        track("click_back_map", { source: source });
        return;
      }
      if (sc.screen === "share" && href.indexOf("#/m/") === 0) {
        const mid = decodeURIComponent(href.slice(4));
        const m = api.byId(mid);
        track("click_open_memory", { memory_id: mid, owner: m && m.mine ? "me" : "other" });
        return;
      }
      if (text.indexOf("둘러보기") >= 0) { track("click_browse_map", { source: sc.screen === "share" ? "share" : "login_gate" }); return; }
      if (a.classList.contains("icon-btn") && (a.getAttribute("aria-label") === "뒤로" || a.getAttribute("aria-label") === "닫기")) {
        track("click_back", { from_screen: sc.screen, to_screen: screenKeyFromHash(href) });
      }
    }
    function onBlur(el) {
      const map = {
        story: "input_plant_story", titleText: "input_plant_title", secretText: "input_plant_secret",
        placeName: "input_plant_place", hintText: "input_plant_hint", secretOpen: "input_secret_open",
        secretNew: "input_secret_new", replyText: "input_reply", nickInput: "input_nickname", emailInput: "input_login_email"
      };
      const ev = map[el.id]; if (!ev) return;
      const v = (el.value || "").trim();
      if (!v) return;
      const key = v.length + "";
      if (el.dataset.gtmLen === key) return;
      el.dataset.gtmLen = key;
      if (ev === "input_login_email") track(ev);
      else track(ev, { length: v.length });
    }
    function nameModal(html) {
      if (/이미 정원이 있는/.test(html)) return "existing_account";
      if (/메일함을 확인/.test(html)) return "email_sent";
      if (/이메일로 로그인/.test(html)) return "email";
      if (/로그인이 필요해요|로그인하고 내 정원/.test(html)) return "login";
      if (/이 기억을 신고할까요/.test(html)) return "report";
      if (/로그아웃할까요/.test(html)) return "logout";
      if (/이 기억을 지울까요/.test(html)) return "delete";
      if (/나만 보기로 바꿀까요|모두에게 공개할까요/.test(html)) return "vis";
      if (/비밀번호를 정해/.test(html)) return "plant_secret";
      if (/비밀번호/.test(html)) return "secret";
      if (/정원 이름/.test(html)) return "nickname";
      if (/꾸민 모습을 저장할까요/.test(html)) return "avatar_leave";
      if (/처음부터 다시 만들까요/.test(html)) return "avatar_reset";
      if (/prof-head/.test(html)) return "profile";
      if (/더 이상 열람할 수 없는 기억이에요/.test(html)) return "gone";
      if (/씨앗 속에 품었어요/.test(html)) return "folded";
      return "";
    }
    return {
      track: track,
      onRender: onRender,
      onClick: onClick,
      onAvatar: onAvatar,
      onLink: onLink,
      onBlur: onBlur,
      locState: locState,
      setModal: html => { modalName = nameModal(html); },
      clearModal: () => { modalName = ""; },
      setLoginContext: k => { loginContext = k || "account"; },
      noteScrim: t => { if (!t.classList.contains("is-alert")) track("click_scrim", { modal: modalName || undefined }); }
    };
  };
})();
