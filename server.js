import express from "express";
import fs from "node:fs";
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

function room(name) {
  const id = String(name || "main").toLowerCase().replace(/[^a-z0-9ก-๙_-]/gi, "").slice(0, 32) || "main";
  if (!db.rooms[id]) db.rooms[id] = { teams: {}, verdicts: {} };
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
function snapshot(r) {
  return {
    teams: Object.values(r.teams).sort((a, b) => String(a.name).localeCompare(String(b.name), "th")),
    verdicts: r.verdicts,
    ranking: ranking(r),
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
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

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

/* ---------- นักเรียน ---------- */
app.post("/api/team", (req, res) => {
  const { id, data } = room(req.body.room);
  const teamId = String(req.body.id || "").slice(0, 24);
  const name = String(req.body.name || "").trim().slice(0, 28);
  if (!teamId || !name) return res.status(400).json({ error: "ต้องมีรหัสทีมและชื่อทีม" });

  const members = Array.isArray(req.body.members)
    ? req.body.members.map((m) => String(m).trim().slice(0, 24)).filter(Boolean).slice(0, 3)
    : [];

  const prev = data.teams[teamId];
  data.teams[teamId] = {
    id: teamId,
    name,
    members,
    progress: prev?.progress || {},
    updated: Date.now(),
  };
  persist(); broadcast(id);
  res.json({ ok: true });
});

app.post("/api/progress", (req, res) => {
  const { id, data } = room(req.body.room);
  const team = data.teams[String(req.body.id || "")];
  if (!team) return res.status(404).json({ error: "ไม่พบทีมนี้ ให้ตั้งชื่อทีมใหม่" });
  const wsId = String(req.body.ws || "");
  if (!WS_IDS.includes(wsId)) return res.status(400).json({ error: "ไม่รู้จักใบงานนี้" });

  const p = req.body.progress || {};
  team.progress[wsId] = {
    c: Array.isArray(p.c) ? p.c.slice(0, 3).map(Boolean) : [false, false, false],
    bonus: !!p.bonus,
    start: Number(p.start) || 0,
    flagAt: Number(p.flagAt) || 0,
    ans: Array.isArray(p.ans) ? p.ans.slice(0, 2).map((a) => String(a).slice(0, 1200)) : ["", ""],
  };
  team.updated = Date.now();
  persist(); broadcast(id);
  res.json({ ok: true });
});

app.post("/api/leave", (req, res) => {
  const { id, data } = room(req.body.room);
  const teamId = String(req.body.id || "");
  delete data.teams[teamId];
  delete data.verdicts[teamId];
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

app.post("/api/reset", (req, res) => {
  if (!requirePin(req, res)) return;
  const { id } = room(req.body.room);
  db.rooms[id] = { teams: {}, verdicts: {} };
  persist(); broadcast(id);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`กระดานแข่งใบงานทำงานที่พอร์ต ${PORT}`);
  console.log(`เก็บข้อมูลที่ ${DATA_FILE}`);
  console.log(TEACHER_PIN ? "เปิดใช้รหัสครูแล้ว" : "ยังไม่ได้ตั้งรหัสครู ใครก็เข้าแผงครูได้");
});
