// 우리들의 2026 — 칠판 방명록 서버
// 외부 패키지 없이 Node 기본 기능만 씁니다. (Render 무료 서버용)
//  · 앞 화면은 /api/stream (SSE)으로 새 글을 실시간으로 받습니다.
//  · 한 기기(브라우저)에 글 1개. 처음 쓰면 '수정 열쇠' 쿠키를 받고, 그 뒤로는 고치기만 됩니다.
//  · 욕설이 의심되는 글과 사진이 붙은 글은 선생님이 확인한 뒤에 칠판에 써집니다.
//  · 글은 data/letters.json 에 저장됩니다. Render 무료 서버는 다시 시작되면
//    이 파일이 지워질 수 있으니, 행사가 끝나면 관리자 화면에서 CSV로 받아 두세요.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ── 설정 (Render 환경변수로 바꿀 수 있어요) ── */
const PORT = process.env.PORT || 3000;
const ADMIN_PW = process.env.ADMIN_PW || "1234";
const MAX_CHARS = +process.env.MAX_CHARS || 80;
const MAX_LETTERS = +process.env.MAX_LETTERS || 600;          // 게시판 전체 글 수 한도
const REVIEW_ALL = process.env.REVIEW_ALL === "1";            // 1이면 모든 글을 확인 후 공개
const PHOTO_REVIEW = process.env.PHOTO_REVIEW !== "0";        // 기본: 사진 글은 확인 후 공개
const PHOTOS = process.env.PHOTOS !== "0";                    // 0이면 사진 받지 않음
const EXTRA_BANNED = (process.env.BANNED_WORDS || "").split(",").map(s => s.trim()).filter(Boolean);
const MAX_PHOTO = 200 * 1024;                                  // 사진 1장 data URL 최대 길이
const MAX_SSE = 400;                                           // 앞 화면 동시 연결 한도
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "letters.json");
const IS_PROD = !!process.env.RENDER;

/* ── 저장 ── */
// letters: {key, tok(수정 열쇠의 해시), name, text, color, photo, timestamp, edited, hidden, hold}
//   hidden = 선생님이 숨김 / hold = 확인 대기(욕설 의심·사진)
let db = { letters: [], revoked: [] };
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))); } catch (e) {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE + ".tmp", JSON.stringify(db)); fs.renameSync(DATA_FILE + ".tmp", DATA_FILE); }
    catch (e) { console.error("저장 실패", e.message); }
  }, 300);
}
const sha = s => crypto.createHash("sha256").update(String(s)).digest("hex");
const visible = L => !L.hidden && !L.hold;
// 확인 대기 이유: 욕설 의심 > 확인 안 된 사진 > (모두 확인 모드) 확인 안 된 글
function holdFor(L) {
  if (suspicious(L.name, L.text) && !L.textOk) return "words";
  if (L.photo && PHOTO_REVIEW && !L.photoOk) return "photo";
  if (REVIEW_ALL && !L.textOk) return "all";
  return "";
}

/* ── 실시간 (SSE) ── */
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) {} }
}
setInterval(() => { for (const res of clients) { try { res.write(": ping\n\n"); } catch (e) {} } }, 25000);
const pub = L => ({ key: L.key, name: L.name, text: L.text, color: L.color, photo: L.photo || null, timestamp: L.timestamp });
const adminView = L => ({ key: L.key, name: L.name, text: L.text, color: L.color, photo: L.photo || null, timestamp: L.timestamp, edited: L.edited || 0, hidden: !!L.hidden, hold: L.hold || "" });
// 글이 바뀐 뒤 앞 화면에 알리기 (보이게 됐는지 / 사라졌는지 / 내용만 바뀌었는지)
function announce(L, wasVisible) {
  const now = visible(L);
  if (now && !wasVisible) broadcast("add", pub(L));
  else if (!now && wasVisible) broadcast("remove", { key: L.key });
  else if (now) broadcast("update", pub(L));
}

/* ── 글 다듬기 · 거르기 ── */
function clean(s, max) {
  return String(s || "")
    .normalize("NFC")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, "") // 제어·투명·방향 바꾸기 문자
    .replace(/[̀-ͯ᪰-᫿⃐-⃿︠-︯]{2,}/g, "")              // 글자 위에 겹겹이 쌓는 장식 문자
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}
const BANNED = ["씨발","시발","씨바","시바","ㅅㅂ","ㅆㅂ","ㅅ ㅂ","병신","븅신","ㅂㅅ","ㅄ","개새","새끼","ㅅㄲ","좆","존나","졸라","ㅈㄴ","지랄","ㅈㄹ","닥쳐","꺼져","죽어","죽을래","뒤져","미친","ㅁㅊ","썅","엿먹","느금","니애미","니미","애미","애비","등신","찐따","장애인","fuck","shit","bitch","sex","섹스","야동",...EXTRA_BANNED];
const squash = s => s.toLowerCase().replace(/[\s\d.,!?~_\-*^'"`·:;/\\|()\[\]{}<>@#$%&+=]/g, "");
function suspicious(...parts) {
  const raw = parts.join(" ").toLowerCase(), sq = squash(raw);
  return BANNED.some(w => raw.includes(w.toLowerCase()) || sq.includes(squash(w)));
}

/* ── 횟수 제한 ── */
function clientIp(req) {
  // Render 앞에는 늘 Cloudflare가 있고, CF-Connecting-IP는 Cloudflare가 직접 덮어써서 속일 수 없어요.
  // (X-Forwarded-For는 Render가 뒤에 덧붙이기만 해서 앞부분은 누구나 꾸며 넣을 수 있어요)
  const t = String(req.headers["cf-connecting-ip"] || req.headers["true-client-ip"] || "").trim();
  if (t) return t;
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : (req.socket.remoteAddress || "");
}
function makeLimiter(windowMs, max) {
  const m = new Map();
  return key => {
    const now = Date.now(); let a = (m.get(key) || []).filter(t => now - t < windowMs);
    if (a.length >= max) { m.set(key, a); return false; }
    a.push(now); m.set(key, a); if (m.size > 20000) m.clear(); return true;
  };
}
const newPerIp = makeLimiter(60 * 1000, 30);      // 학교는 한 IP를 같이 써서 넉넉하게
const newGlobal = makeLimiter(60 * 1000, 120);    // 전체 새 글: 1분에 120개
const editPerTok = makeLimiter(10 * 1000, 2);     // 고치기: 10초에 2번
const adminFail = new Map();                      // ip → {n, until}
function adminLocked(ip) { const a = adminFail.get(ip); return a && a.until > Date.now(); }
function adminFailed(ip) {
  const a = adminFail.get(ip) || { n: 0, until: 0 }; a.n++;
  if (a.n >= 5) { a.until = Date.now() + 10 * 60 * 1000; a.n = 0; }
  adminFail.set(ip, a);
}

/* ── 도우미 ── */
const SEC = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  ...(IS_PROD ? { "Strict-Transport-Security": "max-age=15552000" } : {}),
};
function send(res, code, obj, extra = {}) { res.writeHead(code, { ...SEC, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra }); res.end(JSON.stringify(obj)); }
function readBody(req, limit) {
  return new Promise((ok, fail) => {
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return fail(new Error("type"));
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { fail(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { const o = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); ok(o && typeof o === "object" ? o : {}); } catch (e) { fail(e); } });
    req.on("error", fail);
  });
}
function cookies(req) { const o = {}; String(req.headers.cookie || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function tokCookie(tok) { return `uri_tok=${tok}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${60 * 60 * 24 * 14}${IS_PROD ? "; Secure" : ""}`; }
function myLetter(req) {
  const tok = cookies(req).uri_tok; if (!tok || !/^[a-f0-9]{48}$/.test(tok)) return { tok: null, L: null, revoked: false };
  const h = sha(tok);
  return { tok, L: db.letters.find(x => x.tok === h) || null, revoked: db.revoked.includes(h) };
}
function isAdmin(req) {
  const k = String(req.headers["x-admin-key"] || "");
  const a = Buffer.from(sha(k)), b = Buffer.from(sha(ADMIN_PW));
  return crypto.timingSafeEqual(a, b);
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
function serveStatic(req, res, urlPath) {
  let p; try { p = decodeURIComponent(urlPath); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { ...SEC, "Content-Type": "text/plain; charset=utf-8" }); return res.end("없는 페이지예요"); }
    res.writeHead(200, { ...SEC, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

/* ── 라우팅 ── */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p === "/healthz") return send(res, 200, { ok: true });

    // 앞 화면 실시간 연결
    if (p === "/api/stream" && req.method === "GET") {
      if (clients.size >= MAX_SSE) return send(res, 503, { error: "busy" });
      res.writeHead(200, { ...SEC, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(`retry: 3000\nevent: init\ndata: ${JSON.stringify(db.letters.filter(visible).map(pub))}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    // 내가 쓴 글 (고치기 화면용)
    if (p === "/api/mine" && req.method === "GET") {
      const { L, revoked } = myLetter(req);
      if (revoked) return send(res, 200, { revoked: true });
      if (!L) return send(res, 200, { mine: null });
      return send(res, 200, { mine: { name: L.name, text: L.text, color: L.color, photo: L.photo || null, hold: L.hold || "", hidden: !!L.hidden } });
    }

    // 글 쓰기 / 고치기 (한 기기에 1개)
    if (p === "/api/letters" && req.method === "POST") {
      const b = await readBody(req, 400 * 1024);
      const ip = clientIp(req);
      const me = myLetter(req);
      if (me.revoked) return send(res, 403, { error: "선생님이 이 기기의 글을 지웠어요. 더 이상 쓸 수 없어요." });

      const text = clean(b.text, MAX_CHARS);
      const name = clean(b.name, 10).replace(/\n/g, " ") || "익명";
      if (!text) return send(res, 400, { error: "한 마디를 써 주세요" });
      const color = Number.isInteger(b.color) && b.color >= 0 && b.color < 6 ? b.color : null;
      let photo = null, keep = false;
      if (b.photo === "keep") keep = true;
      else if (typeof b.photo === "string" && b.photo) {
        if (!PHOTOS) return send(res, 400, { error: "이번 행사는 사진을 받지 않아요" });
        if (b.photo.length > MAX_PHOTO || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(b.photo)) return send(res, 400, { error: "사진이 너무 크거나 형식이 맞지 않아요" });
        const bin = Buffer.from(b.photo.slice(23), "base64");
        if (bin[0] !== 0xFF || bin[1] !== 0xD8) return send(res, 400, { error: "사진 형식이 맞지 않아요" });
        photo = b.photo;
      }

      // 고치기
      if (me.L) {
        if (!editPerTok(me.L.key)) return send(res, 429, { error: "조금만 기다렸다가 다시 고쳐 주세요" });
        const L = me.L, was = visible(L);
        const photoChanged = !keep && photo !== (L.photo || null);
        const textChanged = L.text !== text || L.name !== name;
        L.name = name; L.text = text; L.color = color; if (!keep) L.photo = photo;
        if (photoChanged) L.photoOk = false;
        if (textChanged) L.textOk = false;
        L.edited = Date.now();
        L.hold = holdFor(L);              // 선생님이 숨긴 글(hidden)은 고쳐도 계속 숨김
        save(); announce(L, was);
        return send(res, 200, { ok: true, edited: true, pending: !!L.hold, hidden: !!L.hidden });
      }

      // 새 글
      if (!newPerIp(ip) || !newGlobal("all")) return send(res, 429, { error: "지금 글이 너무 많이 들어오고 있어요. 잠시 뒤에 다시 보내 주세요" });
      if (db.letters.length >= MAX_LETTERS) return send(res, 507, { error: "칠판이 가득 찼어요" });
      const tok = crypto.randomBytes(24).toString("hex");
      const L = { key: Date.now().toString(36) + crypto.randomBytes(4).toString("hex"), tok: sha(tok), name, text, color, photo, timestamp: Date.now(), edited: 0, hidden: false, photoOk: false, textOk: false };
      L.hold = holdFor(L);
      const hold = L.hold;
      db.letters.push(L); save();
      if (visible(L)) broadcast("add", pub(L));
      return send(res, 200, { ok: true, edited: false, pending: !!hold }, { "Set-Cookie": tokCookie(tok) });
    }

    // 관리자
    if (p.startsWith("/api/admin/")) {
      const ip = clientIp(req);
      if (adminLocked(ip)) return send(res, 429, { error: "비밀번호를 여러 번 틀려서 10분 동안 잠겼어요" });
      if (!isAdmin(req)) { adminFailed(ip); return send(res, 401, { error: "비밀번호가 틀렸어요" }); }
      adminFail.delete(ip);
      const act = p.slice("/api/admin/".length);
      if (act === "check") return send(res, 200, { ok: true });
      if (act === "letters" && req.method === "GET") return send(res, 200, db.letters.map(adminView));
      if (req.method !== "POST") return send(res, 405, { error: "method" });
      const b = await readBody(req, 10 * 1024);
      const L = typeof b.key === "string" ? db.letters.find(x => x.key === b.key) : null;
      if (act === "show" && L) { const was = visible(L); L.hidden = false; L.hold = ""; L.textOk = true; L.photoOk = true; save(); announce(L, was); return send(res, 200, { ok: true }); }
      if (act === "hide" && L) { const was = visible(L); L.hidden = true; save(); announce(L, was); return send(res, 200, { ok: true }); }
      if (act === "delete" && L) {
        const was = visible(L);
        db.letters = db.letters.filter(x => x !== L);
        if (b.block) db.revoked.push(L.tok);          // 이 기기는 다시 못 쓰게
        save(); if (was) broadcast("remove", { key: L.key }); return send(res, 200, { ok: true });
      }
      if (act === "clear-photos") { db.letters.forEach(x => { x.photo = null; x.hold = holdFor(x); }); save(); broadcast("init", db.letters.filter(visible).map(pub)); return send(res, 200, { ok: true }); }
      if (act === "reset") { db = { letters: [], revoked: [] }; save(); broadcast("init", []); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: "없는 기능이에요" });
    }

    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, p);
    send(res, 404, { error: "not found" });
  } catch (e) {
    if (e && e.message === "type") return send(res, 415, { error: "잘못된 요청이에요" });
    if (e && e.message === "too big") return send(res, 413, { error: "보낸 내용이 너무 커요" });
    console.error(e);
    send(res, 400, { error: "잘못된 요청이에요" });
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(PORT, () => console.log(`우리들의 2026 방명록 → http://localhost:${PORT}`));
