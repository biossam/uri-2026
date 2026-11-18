// 우리들의 2026 — 칠판 방명록 서버
// 외부 패키지 없이 Node 기본 기능만 씁니다. (Render 무료 서버용)
//  · 앞 화면은 /api/stream (SSE)으로 새 글을 실시간으로 받습니다.
//  · 글은 data/letters.json 에 저장됩니다. Render 무료 서버는 다시 시작되면
//    이 파일이 지워질 수 있으니, 행사가 끝나면 관리자 화면에서 CSV로 받아 두세요.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_PW = process.env.ADMIN_PW || "1234";          // Render 환경변수로 바꿔 주세요
const MAX_CHARS = +process.env.MAX_CHARS || 80;
const MAX_PHOTO = 200 * 1024;                              // 사진 1장 최대 200KB (data URL 길이)
const PUBLIC = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "letters.json");

/* ── 저장 ── */
let letters = [];
try { letters = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); } catch (e) { letters = []; }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(DATA_FILE + ".tmp", JSON.stringify(letters)); fs.renameSync(DATA_FILE + ".tmp", DATA_FILE); }
    catch (e) { console.error("저장 실패", e.message); }
  }, 300);
}

/* ── 실시간 (SSE) ── */
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) {} }
}
setInterval(() => { for (const res of clients) { try { res.write(": ping\n\n"); } catch (e) {} } }, 25000);

const pub = L => ({ key: L.key, name: L.name, text: L.text, color: L.color, photo: L.photo || null, timestamp: L.timestamp });

/* ── 도배 막기: 같은 기기에서 5초에 한 번 ── */
const lastPost = new Map();
function tooFast(ip) {
  const now = Date.now(), t = lastPost.get(ip) || 0;
  if (now - t < 5000) return true;
  lastPost.set(ip, now);
  if (lastPost.size > 5000) lastPost.clear();
  return false;
}

/* ── 도우미 ── */
function send(res, code, obj) { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); }
function readBody(req, limit = 400 * 1024) {
  return new Promise((ok, fail) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { fail(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { ok(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { fail(e); } });
    req.on("error", fail);
  });
}
function isAdmin(req) {
  const k = String(req.headers["x-admin-key"] || "");
  const a = Buffer.from(k), b = Buffer.from(ADMIN_PW);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".json": "application/json" };
function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p === "/") p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("없는 페이지예요"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

/* ── 라우팅 ── */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  try {
    if (p === "/healthz") return send(res, 200, { ok: true, count: letters.length });

    // 앞 화면 실시간 연결
    if (p === "/api/stream" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(`retry: 3000\nevent: init\ndata: ${JSON.stringify(letters.filter(l => !l.hidden).map(pub))}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    // 학생이 글 남기기
    if (p === "/api/letters" && req.method === "POST") {
      const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
      if (tooFast(ip)) return send(res, 429, { error: "조금만 기다렸다가 다시 보내 주세요" });
      const b = await readBody(req);
      const text = String(b.text || "").trim().slice(0, MAX_CHARS);
      const name = String(b.name || "").trim().slice(0, 10) || "익명";
      if (!text) return send(res, 400, { error: "한 마디를 써 주세요" });
      let photo = null;
      if (typeof b.photo === "string" && b.photo) {
        if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(b.photo) || b.photo.length > MAX_PHOTO) return send(res, 400, { error: "사진이 너무 커요" });
        photo = b.photo;
      }
      const color = Number.isInteger(b.color) && b.color >= 0 && b.color < 6 ? b.color : null;
      const L = { key: Date.now().toString(36) + crypto.randomBytes(3).toString("hex"), name, text, color, photo, timestamp: Date.now(), hidden: false };
      letters.push(L); save();
      broadcast("add", pub(L));
      return send(res, 200, { ok: true });
    }

    // 관리자
    if (p.startsWith("/api/admin/")) {
      if (!isAdmin(req)) return send(res, 401, { error: "비밀번호가 틀렸어요" });
      const act = p.slice("/api/admin/".length);
      if (act === "check") return send(res, 200, { ok: true });
      if (act === "letters" && req.method === "GET") return send(res, 200, letters);
      if (req.method !== "POST") return send(res, 405, { error: "method" });
      const b = await readBody(req, 10 * 1024).catch(() => ({}));
      const L = b.key ? letters.find(x => x.key === b.key) : null;
      if (act === "hide" && L) { L.hidden = !!b.hidden; save(); broadcast(L.hidden ? "remove" : "add", L.hidden ? { key: L.key } : pub(L)); return send(res, 200, { ok: true }); }
      if (act === "delete" && L) { letters = letters.filter(x => x !== L); save(); broadcast("remove", { key: L.key }); return send(res, 200, { ok: true }); }
      if (act === "clear-photos") { letters.forEach(x => { x.photo = null; }); save(); broadcast("init", letters.filter(l => !l.hidden).map(pub)); return send(res, 200, { ok: true }); }
      if (act === "reset") { letters = []; save(); broadcast("init", []); return send(res, 200, { ok: true }); }
      return send(res, 404, { error: "없는 기능이에요" });
    }

    if (req.method === "GET") return serveStatic(req, res, p);
    send(res, 404, { error: "not found" });
  } catch (e) {
    console.error(e);
    send(res, 400, { error: "잘못된 요청이에요" });
  }
});

server.listen(PORT, () => console.log(`우리들의 2026 방명록 → http://localhost:${PORT}`));
