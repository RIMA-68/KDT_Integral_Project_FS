// 기억 정원 · js/config.js 만들기
// Netlify: 빌드 때 자동 실행(netlify.toml). 값은 Site configuration → Environment variables 에서 넣어요.
// 내 컴퓨터: memory-garden/.env 파일에 같은 이름으로 적고 `node tools/write-config.mjs` 실행.
//   MG_KAKAO_JS_KEY=...
//   MG_SUPABASE_URL=https://xxxx.supabase.co
//   MG_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...   (예전 이름 anon key 도 돼요)
// 비밀 키(SUPABASE_SECRET / service_role)는 이 파일이 읽지도, 쓰지도 않아요. 여기 넣으면 빌드를 멈춰요.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
const dot = join(root, ".env");
if (existsSync(dot)) {
  for (const line of readFileSync(dot, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const pick = (...names) => names.map(n => env[n]).find(v => v && v.trim()) || "";
const cfg = {
  kakaoJsKey: pick("MG_KAKAO_JS_KEY"),
  supabaseUrl: pick("MG_SUPABASE_URL").replace(/\/+$/, ""),
  supabaseKey: pick("MG_SUPABASE_PUBLISHABLE_KEY", "MG_SUPABASE_ANON_KEY"),
  unlockRadiusM: Number(pick("MG_UNLOCK_RADIUS_M")) || 50,
  maxAccuracyM: Number(pick("MG_MAX_ACCURACY_M")) || 60
};

// 비밀 키가 공개 설정에 섞이는 실수를 막아요
const looksSecret = v => /^sb_secret_/.test(v) || (() => { try { const p = JSON.parse(Buffer.from(v.split(".")[1] || "", "base64url").toString()); return p.role === "service_role"; } catch { return false; } })();
if (cfg.supabaseKey && looksSecret(cfg.supabaseKey)) {
  console.error("✗ MG_SUPABASE_PUBLISHABLE_KEY 에 비밀(secret/service_role) 키가 들어 있어요. publishable(anon) 키로 바꿔 주세요.");
  process.exit(1);
}
if (cfg.supabaseUrl && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cfg.supabaseUrl)) console.warn("! MG_SUPABASE_URL 모양이 예상과 달라요:", cfg.supabaseUrl);

const out = `/* 자동 생성 파일 · tools/write-config.mjs · 공개용 값만 들어 있어요 */\nwindow.MG_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`;
writeFileSync(join(root, "js", "config.js"), out);
const mode = cfg.supabaseUrl && cfg.supabaseKey ? "실서비스(Supabase)" : "데모(이 기기에만 저장)";
console.log(`✓ js/config.js 작성 · 모드: ${mode} · 지도: ${cfg.kakaoJsKey ? "카카오맵" : "OpenStreetMap"}`);
