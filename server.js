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
const QRCode = require("./vendor/QRCode");
const QRErrorCorrectLevel = require("./vendor/QRCode/QRErrorCorrectLevel");

/* ── 설정 (Render 환경변수로 바꿀 수 있어요) ── */
const PORT = process.env.PORT || 3000;
const ADMIN_PW = String(process.env.ADMIN_PW || "");
// GitHub에 코드가 공개돼 있어서 기본 비밀번호는 누구나 알 수 있어요 → 실제 서버에서는 8자 이상이 아니면 관리자 화면을 막아요
const WEAK_PW = ADMIN_PW.length < 8 || /^(\d)\1+$|^(1234|12345678|password|admin)/i.test(ADMIN_PW);
const MAX_CHARS = +process.env.MAX_CHARS || 80;
const MAX_LETTERS = +process.env.MAX_LETTERS || 600;          // 게시판 전체 글 수 한도
const REVIEW_ALL = process.env.REVIEW_ALL === "1";            // 1이면 모든 글을 확인 후 공개
const PHOTO_REVIEW = process.env.PHOTO_REVIEW !== "0";        // 기본: 사진 글은 확인 후 공개
const PHOTOS = process.env.PHOTOS !== "0";                    // 0이면 사진 받지 않음
const EXTRA_BANNED = (process.env.BANNED_WORDS || "").split(",").map(s => s.trim()).filter(Boolean);
const RETAIN_DAYS = process.env.RETAIN_DAYS === undefined ? 3 : +process.env.RETAIN_DAYS; // 쓴 지 며칠 뒤 자동 삭제 (0 = 끄기)
const MAX_PHOTO = 200 * 1024;                                  // 사진 1장 data URL 최대 길이
const MAX_SSE = 400;                                           // 앞 화면 동시 연결 한도
const MAX_SSE_PER_IP = 8;                                      // 한 곳(IP)에서 여는 앞 화면 수 한도
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "letters.json");
const IS_PROD = !!process.env.RENDER || process.env.NODE_ENV === "production";   // Render·onpod(Dockerfile) 실제 서버

/* ── 저장 ── */
// letters: {key, tok(수정 열쇠의 해시), name, text, color, photo, timestamp, edited, hidden, hold}
//   hidden = 선생님이 숨김 / hold = 확인 대기(욕설 의심·사진)
let db = { letters: [], revoked: [], code: "", closed: false };
try { const d = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); if (d && Array.isArray(d.letters)) db = Object.assign(db, d); } catch (e) {}
// 행사 코드: 환경변수 EVENT_CODE가 있으면 그것, 없으면 처음 켤 때 만들어 저장 (헷갈리는 0/O, 1/I/L 뺌)
function newCode() { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let c = ""; for (const b of crypto.randomBytes(6)) c += A[b % A.length]; return c; }
const ENV_CODE = String(process.env.EVENT_CODE || "").trim().toUpperCase();
if (!ENV_CODE && !db.code) { db.code = newCode(); setTimeout(() => save(), 0); }
const eventCode = () => ENV_CODE || db.code;
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
  if (personalInfo(L.name, L.text) && !L.textOk) return "privacy";
  if (suspicious(L.name, L.text) && !L.textOk) return "words";
  if (L.photo && PHOTO_REVIEW && !L.photoOk) return "photo";
  if (REVIEW_ALL && !L.textOk) return "all";
  return "";
}

/* ── 실시간 (SSE) ── */
const clients = new Set();
function dropAll() { for (const res of clients) { try { res.end(); } catch (e) {} } clients.clear(); }   // 코드가 바뀌거나 칠판을 닫으면 모두 끊기
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

// 전화번호·주소·이메일처럼 보이는 글 (실수로 개인정보를 쓰는 걸 막기)
function personalInfo(...parts) {
  const t = parts.join(" ");
  return /01[016789][\s.\-)]*\d{3,4}[\s.\-]*\d{4}/.test(t)          // 휴대전화
    || /\d[\d\s.\-]{8,}\d/.test(t.replace(/20\d\d/g, ""))             // 숫자가 길게 이어짐 (연도 2026 등은 빼고)
    || /\d+\s*동\s*\d+\s*호/.test(t) || /[가-힣]+(로|길)\s*\d+/.test(t) || /(아파트|빌라|번지)/.test(t)
    || /[\w.+-]+@[\w-]+\.[\w.]+/.test(t);
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
// 로그인하면 12시간짜리 관리자 열쇠(세션)를 줘요. 비밀번호 잠금은 '로그인'에만 걸려서,
// 같은 학교 와이파이에서 누가 비밀번호를 틀려도 이미 들어와 있는 선생님은 쫓겨나지 않아요.
const sessions = new Map();                       // 열쇠 해시 → 만료 시각
function newSession() { const t = crypto.randomBytes(32).toString("hex"); sessions.set(sha(t), Date.now() + 12 * 3600 * 1000); return t; }
function sessionOk(req) {
  const t = String(req.headers["x-admin-session"] || ""); if (!/^[a-f0-9]{64}$/.test(t)) return false;
  const exp = sessions.get(sha(t)); if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(sha(t)); return false; }
  return true;
}
function adminLocked(ip) { const a = adminFail.get(ip); return a && a.until > Date.now(); }
function adminFailed(ip) {
  const a = adminFail.get(ip) || { n: 0, until: 0 }; a.n++;
  if (a.n >= 5) { a.until = Date.now() + 10 * 60 * 1000; a.n = 0; }
  adminFail.set(ip, a);
}

const codeFail = makeLimiter(10 * 60 * 1000, 20); // 틀린 행사 코드: 10분에 20번까지
function codeOk(req, url) {
  const c = String(req.headers["x-event-code"] || url.searchParams.get("c") || "").trim().toUpperCase();
  const a = Buffer.from(sha(c)), b = Buffer.from(sha(eventCode()));
  return crypto.timingSafeEqual(a, b);
}
function qrSVG(text) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), m = 2; let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + m * 2} ${n + m * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fffdf6"/><path d="${d}" fill="#2f3a33"/></svg>`;
}

/* ── 자동 삭제: 쓴 지 RETAIN_DAYS일이 지난 글과 사진 ── */
function sweep() {
  if (!RETAIN_DAYS) return;
  const limit = Date.now() - RETAIN_DAYS * 86400000;
  const old = db.letters.filter(L => L.timestamp < limit);
  if (!old.length) return;
  db.letters = db.letters.filter(L => L.timestamp >= limit); save();
  old.forEach(L => { if (visible(L)) broadcast("remove", { key: L.key }); });
  console.log(`자동 삭제: ${old.length}개`);
}
setInterval(sweep, 10 * 60 * 1000); setTimeout(sweep, 5000);

/* ── 도우미 ── */
const SEC = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
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
function pwOk(k) {
  const a = Buffer.from(sha(String(k || ""))), b = Buffer.from(sha(ADMIN_PW));
  return ADMIN_PW.length > 0 && crypto.timingSafeEqual(a, b);
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml; charset=utf-8", ".ico": "image/x-icon" };
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

    // 화면이 처음 물어보는 기본 정보 (코드 없이)
    if (p === "/api/info" && req.method === "GET") return send(res, 200, { closed: !!db.closed, retainDays: RETAIN_DAYS, photos: PHOTOS, photoReview: PHOTO_REVIEW, reviewAll: REVIEW_ALL, maxChars: MAX_CHARS });

    // 여기부터는 행사 코드가 있어야 해요 (보기·쓰기·QR)
    if (p === "/api/stream" || p === "/api/mine" || p === "/api/letters" || p === "/api/qr.svg" || p === "/api/join" || p === "/api/forget") {
      const ip = clientIp(req);
      if (!codeOk(req, url)) {
        if (!codeFail(ip)) return send(res, 429, { error: "코드를 여러 번 틀렸어요. 10분 뒤에 다시 해 주세요" });
        return send(res, 403, { error: "행사 코드가 맞지 않아요. 앞 화면의 QR을 다시 찍어 주세요", code: "bad_code" });
      }
      if (db.closed && p !== "/api/forget") return send(res, 403, { error: "방명록이 닫혔어요. 참여해 줘서 고마워요!", code: "closed" });
      if (p === "/api/join") return send(res, 200, { ok: true });
      // 공용 기기: 이 기기와 내 글의 연결 끊기 (글은 그대로 남고, 다음 친구가 새로 쓸 수 있어요)
      if (p === "/api/forget" && req.method === "POST") return send(res, 200, { ok: true }, { "Set-Cookie": `uri_tok=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${IS_PROD ? "; Secure" : ""}` });
      if (p === "/api/qr.svg") {
        const host = String(req.headers.host || "").replace(/[^a-z0-9.:-]/gi, "");
        const proto = IS_PROD ? "https" : (req.headers["x-forwarded-proto"] === "https" ? "https" : "http");
        res.writeHead(200, { ...SEC, "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" });
        return res.end(qrSVG(`${proto}://${host}/letter.html?c=${eventCode()}`));
      }
    }

    // 앞 화면 실시간 연결
    if (p === "/api/stream" && req.method === "GET") {
      if (clients.size >= MAX_SSE) return send(res, 503, { error: "busy" });
      const ip = clientIp(req);
      if ([...clients].filter(r => r._ip === ip).length >= MAX_SSE_PER_IP) return send(res, 429, { error: "앞 화면을 너무 많이 열었어요" });
      res.writeHead(200, { ...SEC, "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(`retry: 3000\nevent: init\ndata: ${JSON.stringify(db.letters.filter(visible).map(pub))}\n\n`);
      res._ip = ip; clients.add(res);
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

    // 관리자 로그인 (비밀번호 → 관리자 열쇠)
    if (p === "/api/admin/login" && req.method === "POST") {
      const ip = clientIp(req);
      if (IS_PROD && WEAK_PW) return send(res, 503, { error: "Render 환경변수 ADMIN_PW를 8자 이상(글자+숫자)으로 정해 주세요. 그 전에는 관리자 화면이 잠겨 있어요.", code: "weak_pw" });
      if (adminLocked(ip)) return send(res, 429, { error: "비밀번호를 여러 번 틀려서 이 기기는 10분 동안 잠겼어요" });
      const b = await readBody(req, 2 * 1024);
      if (!pwOk(b.pw)) { adminFailed(ip); return send(res, 401, { error: "비밀번호가 틀렸어요 (5번 틀리면 10분 잠겨요)" }); }
      adminFail.delete(ip);
      return send(res, 200, { session: newSession(), weak: WEAK_PW });
    }

    // 관리자 기능 (관리자 열쇠 필요)
    if (p.startsWith("/api/admin/")) {
      if (!sessionOk(req)) return send(res, 401, { error: "다시 로그인해 주세요" });
      const act = p.slice("/api/admin/".length);
      if (act === "check") return send(res, 200, { ok: true });
      if (act === "info") return send(res, 200, { code: eventCode(), fromEnv: !!ENV_CODE, retainDays: RETAIN_DAYS, closed: !!db.closed, viewers: clients.size, weak: WEAK_PW });
      if (act === "letters" && req.method === "GET") return send(res, 200, db.letters.map(adminView));
      if (req.method !== "POST") return send(res, 405, { error: "method" });
      const b = await readBody(req, 10 * 1024);
      if (act === "logout") { sessions.delete(sha(String(req.headers["x-admin-session"]))); return send(res, 200, { ok: true }); }
      if (act === "close") { db.closed = !!b.closed; save(); if (db.closed) dropAll(); return send(res, 200, { ok: true, closed: db.closed }); }
      if (act === "rotate-code") {
        if (ENV_CODE) return send(res, 400, { error: "코드를 Render 환경변수 EVENT_CODE로 정해 두셨어요. Render에서 바꿔 주세요." });
        db.code = newCode(); save(); dropAll(); return send(res, 200, { ok: true, code: db.code });
      }
      const L = typeof b.key === "string" ? db.letters.find(x => x.key === b.key) : null;
      if (act === "show" && L) { const was = visible(L); L.hidden = false; L.hold = ""; L.textOk = true; L.photoOk = true; save(); announce(L, was); return send(res, 200, { ok: true }); }
      if (act === "hide" && L) { const was = visible(L); L.hidden = true; save(); announce(L, was); return send(res, 200, { ok: true }); }
      if (act === "delete" && L) {
        const was = visible(L);
        db.letters = db.letters.filter(x => x !== L);
        if (b.block && !db.revoked.includes(L.tok)) db.revoked.push(L.tok);          // 이 기기는 다시 못 쓰게
        save(); if (was) broadcast("remove", { key: L.key }); return send(res, 200, { ok: true });
      }
      if (act === "clear-photos") { db.letters.forEach(x => { x.photo = null; x.hold = holdFor(x); }); save(); broadcast("init", db.letters.filter(visible).map(pub)); return send(res, 200, { ok: true }); }
      if (act === "reset") { db = { letters: [], revoked: [], code: ENV_CODE ? "" : newCode(), closed: false }; save(); dropAll(); return send(res, 200, { ok: true }); }
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
