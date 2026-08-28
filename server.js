import express from "express";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "board.json");
const TEACHER_PIN = process.env.TEACHER_PIN || "";
const WS_IDS = ["A1","A2","A3","A4","A5","A6","A7","A8","A9","A10","A11",
                "C1","C2","C3","C4","C5","C6","C7","C8","C9","C10"];

/* ---------- storage ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });

let db = { rooms: {} };
try {
  if (fs.existsSync(DATA_FILE)) db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
} catch (err) {
  console.error("อ่านไฟล์ข้อมูลเดิมไม่ได้ เริ่มด้วยกระดานว่าง:", err.message);
}

let writeTimer = null;
function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const tmp = DATA_FILE + ".tmp";
    try {
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
      console.error("บันทึกข้อมูลไม่สำเร็จ:", err.message);
    }
  }, 400);
}

/* ---------- บัญชีนักเรียน ---------- */
function hashPw(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 32).toString("hex");
}
function newToken() {
  return crypto.randomBytes(24).toString("hex");
}
function cleanSid(v) {
  return String(v || "").trim().replace(/\s+/g, "").slice(0, 20);
}

function room(name) {
  const id = String(name || "main").toLowerCase().replace(/[^a-z0-9ก-๙_-]/gi, "").slice(0, 32) || "main";
  if (!db.rooms[id]) db.rooms[id] = { teams: {}, verdicts: {}, users: {}, mods: {} };
  if (!db.rooms[id].users) db.rooms[id].users = {};
  if (!db.rooms[id].mods) db.rooms[id].mods = {};
  return { id, data: db.rooms[id] };
}

/* ---------- derived ---------- */
function ranking(r) {
  const out = {};
  for (const wsId of WS_IDS) {
    const list = [];
    for (const [teamId, v] of Object.entries(r.verdicts)) {
      const x = v[wsId];
      if (x && x.status === "pass" && r.teams[teamId]) {
        list.push({ teamId, name: r.teams[teamId].name, rank: x.rank, stars: x.stars, at: x.at });
      }
    }
    if (list.length) out[wsId] = list.sort((a, b) => a.rank - b.rank);
  }
  return out;
}
function publicTeam(r, t) {
  const members = (t.members || [])
    .map((sid) => r.users[sid])
    .filter(Boolean)
    .map((u) => ({ sid: u.sid, name: u.name, photo: u.photo || "" }));
  return { id: t.id, code: t.code, name: t.name, members, progress: t.progress, updated: t.updated };
}
function snapshot(r) {
  return {
    teams: Object.values(r.teams)
      .map((t) => publicTeam(r, t))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "th")),
    verdicts: r.verdicts,
    ranking: ranking(r),
    mods: r.mods || {},
    at: Date.now(),
  };
}

/* ---------- SSE ---------- */
const clients = new Map(); // roomId -> Set(res)

function broadcast(roomId) {
  const set = clients.get(roomId);
  if (!set || !set.size) return;
  const payload = "data: " + JSON.stringify(snapshot(db.rooms[roomId])) + "\n\n";
  for (const res of set) {
    try { res.write(payload); } catch { /* ปิดไปแล้ว */ }
  }
}

/* ---------- app ---------- */
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));
/* ---------- กันแคชค้างหลัง deploy ---------- */
const PUBLIC = path.join(__dirname, "public");
const BUILD = (() => {
  const h = crypto.createHash("sha1");
  for (const f of ["index.html", "app.js", "style.css", "worksheets.js"]) {
    try {
      const st = fs.statSync(path.join(PUBLIC, f));
      h.update(f + st.size + st.mtimeMs);
    } catch { h.update(f); }
  }
  return h.digest("hex").slice(0, 10);
})();

function sendIndex(_req, res) {
  let html;
  try { html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8"); }
  catch { return res.status(500).send("ไม่พบหน้าเว็บ"); }
  res.set("Cache-Control", "no-store, must-revalidate");
  res.type("html").send(html.replace(/__BUILD__/g, BUILD));
}
app.get("/", sendIndex);
app.get("/index.html", sendIndex);

app.use(express.static(PUBLIC, {
  etag: true,
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/.test(filePath)) {
      // มี ?v= ต่อท้ายอยู่แล้ว จึงแคชยาวได้ แต่ถ้าเรียกตรงต้องไม่แคช
      res.set("Cache-Control", "no-cache");
    } else {
      res.set("Cache-Control", "public, max-age=2592000, immutable");
    }
  },
}));

app.get("/healthz", (_req, res) => res.type("text").send("ok"));

app.get("/api/config", (_req, res) => res.json({ pinRequired: !!TEACHER_PIN }));

app.get("/api/state", (req, res) => {
  const { data } = room(req.query.room);
  res.json(snapshot(data));
});

app.get("/api/stream", (req, res) => {
  const { id, data } = room(req.query.room);
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");
  res.write("data: " + JSON.stringify(snapshot(data)) + "\n\n");

  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);

  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 25000);
  req.on("close", () => {
    clearInterval(ping);
    clients.get(id)?.delete(res);
  });
});


/* ---------- สมัคร / เข้าสู่ระบบ ---------- */
function currentUser(req, res) {
  const { data } = room(req.body.room || req.query.room);
  const token = req.get("x-auth") || req.body.token || "";
  const sid = cleanSid(req.get("x-sid") || req.body.sid);
  const u = data.users[sid];
  if (!u || !token || u.token !== token) {
    res.status(401).json({ error: "ยังไม่ได้เข้าสู่ระบบ หรือเข้าสู่ระบบจากเครื่องอื่นแล้ว" });
    return null;
  }
  return u;
}

app.post("/api/register", (req, res) => {
  const { id, data } = room(req.body.room);
  const sid = cleanSid(req.body.sid);
  const name = String(req.body.name || "").trim().slice(0, 30);
  const pw = String(req.body.password || "");
  if (sid.length < 3) return res.status(400).json({ error: "รหัสนักเรียนต้องยาวอย่างน้อย 3 ตัว" });
  if (!name) return res.status(400).json({ error: "ใส่ชื่อ-นามสกุลด้วย" });
  if (pw.length < 4) return res.status(400).json({ error: "รหัสผ่านต้องยาวอย่างน้อย 4 ตัว" });
  if (data.users[sid]) return res.status(409).json({ error: "รหัสนักเรียนนี้สมัครไว้แล้ว ให้กดเข้าสู่ระบบแทน" });

  const salt = crypto.randomBytes(16).toString("hex");
  const token = newToken();
  data.users[sid] = { sid, name, salt, hash: hashPw(pw, salt), token, photo: "", teamId: "" };
  persist(); broadcast(id);
  res.json({ ok: true, token, user: { sid, name, photo: "", teamId: "" } });
});

app.post("/api/login", (req, res) => {
  const { data } = room(req.body.room);
  const sid = cleanSid(req.body.sid);
  const u = data.users[sid];
  if (!u || u.hash !== hashPw(String(req.body.password || ""), u.salt)) {
    return res.status(401).json({ error: "รหัสนักเรียนหรือรหัสผ่านไม่ถูกต้อง" });
  }
  u.token = newToken();
  persist();
  res.json({ ok: true, token: u.token, user: { sid: u.sid, name: u.name, photo: u.photo || "", teamId: u.teamId || "" } });
});

app.post("/api/me", (req, res) => {
  const u = currentUser(req, res);
  if (!u) return;
  res.json({ ok: true, user: { sid: u.sid, name: u.name, photo: u.photo || "", teamId: u.teamId || "" } });
});

app.post("/api/photo", (req, res) => {
  const { id } = room(req.body.room);
  const u = currentUser(req, res);
  if (!u) return;
  const v = typeof req.body.photo === "string" ? req.body.photo : "";
  if (v && !(/^data:image\/(jpeg|png|webp);base64,/.test(v) && v.length <= 260000)) {
    return res.status(400).json({ error: "รูปไม่ถูกต้องหรือใหญ่เกินไป" });
  }
  u.photo = v;
  persist(); broadcast(id);
  res.json({ ok: true });
});

/* ---------- ทีม ---------- */
function freeCode(data) {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let i = 0; i < 200; i++) {
    const c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join("");
    if (!Object.values(data.teams).some((t) => t.code === c)) return c;
  }
  return "T" + Date.now().toString(36).slice(-3).toUpperCase();
}

app.post("/api/team/create", (req, res) => {
  const { id, data } = room(req.body.room);
  const u = currentUser(req, res);
  if (!u) return;
  const name = String(req.body.name || "").trim().slice(0, 28);
  if (!name) return res.status(400).json({ error: "ใส่ชื่อทีมด้วย" });
  if (u.teamId && data.teams[u.teamId]) return res.status(409).json({ error: "อยู่ในทีมอยู่แล้ว ต้องออกจากทีมเดิมก่อน" });

  const tid = "t" + crypto.randomBytes(4).toString("hex");
  data.teams[tid] = { id: tid, code: freeCode(data), name, members: [u.sid], progress: {}, updated: Date.now() };
  u.teamId = tid;
  persist(); broadcast(id);
  res.json({ ok: true, teamId: tid, code: data.teams[tid].code });
});

app.post("/api/team/join", (req, res) => {
  const { id, data } = room(req.body.room);
  const u = currentUser(req, res);
  if (!u) return;
  const code = String(req.body.code || "").trim().toUpperCase();
  const t = Object.values(data.teams).find((x) => x.code === code);
  if (!t) return res.status(404).json({ error: "ไม่พบทีมที่ใช้รหัสนี้ ลองเช็กตัวอักษรอีกครั้ง" });
  if (t.members.includes(u.sid)) { u.teamId = t.id; persist(); return res.json({ ok: true, teamId: t.id }); }
  if (t.members.length >= 3) return res.status(409).json({ error: "ทีมนี้ครบ 3 คนแล้ว" });
  if (u.teamId && data.teams[u.teamId]) return res.status(409).json({ error: "อยู่ในทีมอยู่แล้ว ต้องออกจากทีมเดิมก่อน" });

  t.members.push(u.sid);
  t.updated = Date.now();
  u.teamId = t.id;
  persist(); broadcast(id);
  res.json({ ok: true, teamId: t.id });
});

app.post("/api/team/leave", (req, res) => {
  const { id, data } = room(req.body.room);
  const u = currentUser(req, res);
  if (!u) return;
  const t = data.teams[u.teamId];
  if (t) {
    t.members = t.members.filter((m) => m !== u.sid);
    t.updated = Date.now();
    if (!t.members.length) { delete data.teams[t.id]; delete data.verdicts[t.id]; }
  }
  u.teamId = "";
  persist(); broadcast(id);
  res.json({ ok: true });
});

app.post("/api/team/rename", (req, res) => {
  const { id, data } = room(req.body.room);
  const u = currentUser(req, res);
  if (!u) return;
  const t = data.teams[u.teamId];
  if (!t) return res.status(404).json({ error: "ยังไม่ได้อยู่ในทีม" });
  const name = String(req.body.name || "").trim().slice(0, 28);
  if (!name) return res.status(400).json({ error: "ใส่ชื่อทีมด้วย" });
  t.name = name; t.updated = Date.now();
  persist(); broadcast(id);
  res.json({ ok: true });
});

/* ---------- ความคืบหน้าใบงาน ---------- */
app.post("/api/progress", (req, res) => {
  const { id, data } = room(req.body.room);
  const u = currentUser(req, res);
  if (!u) return;
  const team = data.teams[u.teamId];
  if (!team) return res.status(404).json({ error: "ยังไม่ได้อยู่ในทีม" });
  const wsId = String(req.body.ws || "");
  if (!WS_IDS.includes(wsId)) return res.status(400).json({ error: "ไม่รู้จักใบงานนี้" });

  const p = req.body.progress || {};
  team.progress[wsId] = {
    c: Array.isArray(p.c) ? p.c.slice(0, 3).map(Boolean) : [false, false, false],
    bonus: !!p.bonus,
    start: Number(p.start) || 0,
    flagAt: Number(p.flagAt) || 0,
    asm: Array.isArray(p.asm) ? p.asm.slice(0, 6).map(Boolean) : [],
    ans: Array.isArray(p.ans) ? p.ans.slice(0, 2).map((a) => String(a).slice(0, 1200)) : ["", ""],
  };
  team.updated = Date.now();
  persist(); broadcast(id);
  res.json({ ok: true });
});

/* ---------- ครู ---------- */
function requirePin(req, res) {
  if (!TEACHER_PIN) return true;
  if (String(req.body.pin || req.query.pin || "") === TEACHER_PIN) return true;
  res.status(401).json({ error: "รหัสครูไม่ถูกต้อง" });
  return false;
}

app.post("/api/verdict", (req, res) => {
  if (!requirePin(req, res)) return;
  const { id, data } = room(req.body.room);
  const teamId = String(req.body.teamId || "");
  const wsId = String(req.body.ws || "");
  if (!data.teams[teamId] || !WS_IDS.includes(wsId)) return res.status(400).json({ error: "ข้อมูลไม่ครบ" });

  if (!data.verdicts[teamId]) data.verdicts[teamId] = {};
  const status = req.body.status;

  if (status === "clear") {
    delete data.verdicts[teamId][wsId];
  } else if (status === "pass") {
    const used = new Set();
    for (const v of Object.values(data.verdicts)) {
      const x = v[wsId];
      if (x && x.status === "pass") used.add(x.rank);
    }
    let rank = 1;
    while (used.has(rank)) rank++;
    data.verdicts[teamId][wsId] = {
      status: "pass",
      rank,
      stars: req.body.stars === 3 ? 3 : 2,
      at: Date.now(),
    };
  } else {
    data.verdicts[teamId][wsId] = {
      status: "fail",
      at: Date.now(),
      note: String(req.body.note || "").slice(0, 300),
    };
    const p = data.teams[teamId].progress?.[wsId];
    if (p) p.flagAt = 0; // ให้ยกป้ายใหม่ได้หลังพ้นคูลดาวน์
  }
  persist(); broadcast(id);
  res.json({ ok: true });
});

// ครูแก้รายการโมดูลของใบงานให้ตรงกับชุดที่โรงเรียนมีจริง
app.post("/api/mod", (req, res) => {
  if (!requirePin(req, res)) return;
  const { id, data } = room(req.body.room);
  const ws = String(req.body.ws || "");
  if (!WS_IDS.includes(ws)) return res.status(400).json({ error: "ไม่รู้จักใบงานนี้" });
  const v = String(req.body.mod || "").trim().slice(0, 200);
  if (v) data.mods[ws] = v; else delete data.mods[ws];
  persist(); broadcast(id);
  res.json({ ok: true });
});

app.post("/api/reset", (req, res) => {
  if (!requirePin(req, res)) return;
  const { id, data } = room(req.body.room);
  const keepUsers = req.body.keepUsers !== false;
  const users = keepUsers ? data.users : {};
  for (const u of Object.values(users)) u.teamId = "";
  db.rooms[id] = { teams: {}, verdicts: {}, users, mods: data.mods || {} };
  persist(); broadcast(id);
  res.json({ ok: true });
});

// ครูดูรายชื่อนักเรียนที่สมัครไว้ และรีเซ็ตรหัสผ่านให้เด็กที่ลืม
app.post("/api/roster", (req, res) => {
  if (!requirePin(req, res)) return;
  const { data } = room(req.body.room);
  res.json({
    ok: true,
    users: Object.values(data.users).map((u) => ({
      sid: u.sid, name: u.name, teamId: u.teamId || "",
      team: (data.teams[u.teamId] || {}).name || "",
    })).sort((a, b) => a.sid.localeCompare(b.sid)),
  });
});

app.post("/api/resetpw", (req, res) => {
  if (!requirePin(req, res)) return;
  const { data } = room(req.body.room);
  const u = data.users[cleanSid(req.body.sid)];
  if (!u) return res.status(404).json({ error: "ไม่พบรหัสนักเรียนนี้" });
  const pw = String(req.body.password || "");
  if (pw.length < 4) return res.status(400).json({ error: "รหัสผ่านใหม่ต้องยาวอย่างน้อย 4 ตัว" });
  u.salt = crypto.randomBytes(16).toString("hex");
  u.hash = hashPw(pw, u.salt);
  u.token = "";
  persist();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`กระดานแข่งใบงานทำงานที่พอร์ต ${PORT}`);
  console.log(`เก็บข้อมูลที่ ${DATA_FILE}`);
  console.log(TEACHER_PIN ? "เปิดใช้รหัสครูแล้ว" : "ยังไม่ได้ตั้งรหัสครู ใครก็เข้าแผงครูได้");
});
