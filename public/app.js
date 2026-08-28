/* กระดานแข่งใบงาน WOM Sensor Kit — ฝั่งเบราว์เซอร์ */

const WS = window.WS, WSMAP = window.WSMAP;
const REJECT_COOLDOWN = 120000; // 2 นาที ตามกติกาในใบงาน

const params = new URLSearchParams(location.search);
const ROOM = (params.get("room") || "main").toLowerCase();

const $ = (s) => document.querySelector(s);
const el = (t, c, x) => { const n = document.createElement(t); if (c) n.className = c; if (x !== undefined) n.textContent = x; return n; };
const esc = (s) => String(s).replace(/[&<>"]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m]));
const hhmm = (t) => new Date(t).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const elapsed = (from) => {
  const s = Math.max(0, Math.floor((Date.now() - from) / 1000));
  return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
};
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem("wom." + ROOM + "." + k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem("wom." + ROOM + "." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("wom." + ROOM + "." + k); } catch {} },
};

const S = {
  role: "team",
  me: null,          // {id,name,members} ของเครื่องนี้
  local: {},         // progress ที่กำลังแก้อยู่ ยังไม่ถูกเซิร์ฟเวอร์เขียนทับ
  teams: [],
  verdicts: {},
  ranking: {},
  ws: "A1",
  wsT: "A1",
  pin: LS.get("pin") || "",
  pinRequired: false,
  saveT: null,
};

/* ---------- โลโก้ LED ---------- */
(function () {
  const c = $("#chipmark");
  const on = new Set([2, 6, 8, 10, 12, 14, 16, 18, 22]);
  for (let i = 0; i < 25; i++) { const d = el("i"); if (on.has(i)) d.className = "on"; c.appendChild(d); }
  $("#roomtag").textContent = "ห้อง " + ROOM;
})();

function setSync(ok, msg) {
  $("#syncdot").className = "dot" + (ok ? "" : " bad");
  $("#synctxt").textContent = msg;
}
function alertBox(kind, html) {
  $("#alerts").innerHTML = html ? '<div class="banner ' + kind + '">' + html + "</div>" : "";
}

/* ---------- เรียก API ---------- */
async function api(path, body) {
  const res = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room: ROOM, ...body }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "เซิร์ฟเวอร์ตอบกลับผิดพลาด");
  }
  return res.json();
}

/* ---------- สลับมุมมอง ---------- */
$("#btnTeam").onclick = () => setRole("team");
$("#btnTeacher").onclick = () => setRole("teacher");
async function setRole(r) {
  if (r === "teacher" && S.pinRequired && !S.pin) {
    const pin = prompt("ใส่รหัสครู");
    if (pin === null) return;
    S.pin = pin.trim();
    LS.set("pin", S.pin);
  }
  S.role = r;
  $("#btnTeam").setAttribute("aria-pressed", r === "team");
  $("#btnTeacher").setAttribute("aria-pressed", r === "teacher");
  $("#viewTeam").classList.toggle("hide", r !== "team");
  $("#viewTeacher").classList.toggle("hide", r !== "teacher");
  LS.set("role", r);
  render();
}

/* ---------- ตัวเลือกใบงาน ---------- */
(function fillSelects() {
  const opts = WS.map((w) => '<option value="' + w.id + '">' + w.id + " · " + esc(w.title) + "  (บทที่ " + w.ref + ")</option>").join("");
  $("#selWs").innerHTML = opts;
  $("#selWsT").innerHTML = opts;
})();
$("#selWs").onchange = (e) => { S.ws = e.target.value; renderWorksheet(); renderRank(); };
$("#selWsT").onchange = (e) => { S.wsT = e.target.value; renderTeacher(); };

/* ============================================================
   ฝั่งทีม
   ============================================================ */
$("#btnJoin").onclick = async () => {
  const name = $("#inName").value.trim();
  if (!name) { alertBox("err", "ใส่ชื่อทีมก่อนจึงจะเข้าร่วมได้"); $("#inName").focus(); return; }
  const members = [$("#inM1").value, $("#inM2").value, $("#inM3").value].map((v) => v.trim()).filter(Boolean);
  const id = LS.get("teamId") || "t" + Math.random().toString(36).slice(2, 8);
  S.me = { id, name, members };
  LS.set("teamId", id);
  LS.set("me", S.me);
  try {
    await api("team", S.me);
    alertBox("");
  } catch (e) {
    alertBox("err", "เข้าร่วมไม่สำเร็จ: " + esc(e.message));
  }
};

$("#btnLeave").onclick = async () => {
  if (!confirm("ออกจากทีมและลบข้อมูลของทีมนี้ออกจากกระดาน?")) return;
  try { await api("leave", { id: S.me.id }); } catch {}
  LS.del("me"); LS.del("teamId");
  S.me = null; S.local = {};
  render();
};

function serverTeam() {
  return S.me ? S.teams.find((t) => t.id === S.me.id) : null;
}
function prog() {
  const wid = S.ws;
  if (!S.local[wid]) {
    const srv = serverTeam();
    const p = srv && srv.progress && srv.progress[wid];
    S.local[wid] = p
      ? { c: p.c.slice(), bonus: p.bonus, start: p.start, flagAt: p.flagAt, ans: (p.ans || ["", ""]).slice() }
      : { c: [false, false, false], bonus: false, start: 0, flagAt: 0, ans: ["", ""] };
  }
  return S.local[wid];
}
function myVerdict() { return (S.me && S.verdicts[S.me.id]) || {}; }
function totalStars(v) {
  let n = 0;
  for (const k in v) if (v[k] && v[k].status === "pass") n += v[k].stars || 2;
  return n;
}

function renderTeam() {
  const joined = !!S.me;
  $("#joinCard").classList.toggle("hide", joined);
  $("#teamHead").classList.toggle("hide", !joined);
  $("#wsCard").classList.toggle("hide", !joined);
  $("#rankCard").classList.toggle("hide", !joined);
  if (!joined) return;
  $("#tName").textContent = S.me.name;
  $("#tMem").textContent = S.me.members.length ? S.me.members.join(" · ") : "ยังไม่ได้ใส่ชื่อสมาชิก";
  $("#selWs").value = S.ws;
  $("#tStars").textContent = "⭐ " + totalStars(myVerdict());
  renderWorksheet();
  renderRank();
}

function renderWorksheet() {
  if (!S.me || S.role !== "team") return;
  const w = WSMAP[S.ws], p = prog(), v = myVerdict()[S.ws] || {};
  const c = $("#wsCard");
  const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ans : null;
  const caret = focusId != null ? document.activeElement.selectionStart : null;
  c.innerHTML = "";

  const head = el("div", "row");
  head.style.justifyContent = "space-between";
  head.style.alignItems = "flex-start";
  const left = el("div"); left.style.minWidth = "0";
  left.appendChild(el("p", "eyebrow", "ใบงาน " + w.id + " · อ้างอิงบทที่ " + w.ref + " · เวลา " + w.min + " นาที"));
  left.appendChild(el("h2", null, w.title));
  head.appendChild(left);
  const st = el("div", "row");
  if (v.status === "pass") st.appendChild(el("span", "pill on", "ผ่านแล้ว · อันดับ " + (v.rank || "-") + " · ⭐" + (v.stars || 2)));
  else if (p.flagAt) st.appendChild(el("span", "pill wait", "ยกป้ายแล้ว รอครูตรวจ"));
  head.appendChild(st);
  c.appendChild(head);

  const tw = el("div", "row"); tw.style.marginTop = "12px";
  const tdisp = el("span", "pill mono"); tdisp.id = "tdisp";
  tdisp.textContent = p.start ? "⏱ " + elapsed(p.start) : "⏱ ยังไม่เริ่มจับเวลา";
  tw.appendChild(tdisp);
  const tbtn = el("button", "btn ghost sm", p.start ? "เริ่มจับเวลาใหม่" : "เริ่มจับเวลา");
  tbtn.onclick = () => { p.start = Date.now(); save(); renderWorksheet(); };
  tw.appendChild(tbtn);
  c.appendChild(tw);

  c.appendChild(el("div", "hr"));
  c.appendChild(el("h3", null, "จุดประสงค์"));
  const ul = el("ul", "plain"); w.obj.forEach((o) => ul.appendChild(el("li", null, o))); c.appendChild(ul);
  c.appendChild(el("h3", null, "โมดูลที่ใช้"));
  c.appendChild(el("p", null, w.mod));
  c.appendChild(el("h3", null, "แบ่งงานในทีม"));
  c.appendChild(el("p", null, w.roles));
  c.appendChild(el("h3", null, "ขั้นตอน"));
  const ol = el("ol", "steps"); w.steps.forEach((s) => ol.appendChild(el("li", null, s))); c.appendChild(ol);

  c.appendChild(el("h3", null, "เกณฑ์ผ่านด่าน — แตะเพื่อติ๊ก"));
  w.chk.forEach((t, i) => {
    const b = el("button", "tick");
    b.dataset.on = p.c[i] ? "1" : "0";
    b.innerHTML = '<span class="box"></span><span class="txt"><b>checkpoint ' + (i + 1) + "</b>" + esc(t) + "</span>";
    b.onclick = () => { p.c[i] = !p.c[i]; save(); renderWorksheet(); };
    c.appendChild(b);
  });
  const bb = el("button", "tick bonus");
  bb.dataset.on = p.bonus ? "1" : "0";
  bb.innerHTML = '<span class="box"></span><span class="txt"><b>ภารกิจเสริม</b>' + esc(w.bonus) + "</span>";
  bb.onclick = () => { p.bonus = !p.bonus; save(); renderWorksheet(); };
  c.appendChild(bb);

  c.appendChild(el("h3", null, "คำถามท้ายใบงาน"));
  w.q.forEach((q, i) => {
    const row = el("div", "ansrow");
    row.appendChild(el("p", null, i + 1 + ". " + q));
    const ta = el("textarea");
    ta.dataset.ans = String(i);
    ta.value = (p.ans && p.ans[i]) || "";
    ta.placeholder = "พิมพ์คำตอบของทีม";
    ta.oninput = () => { p.ans = p.ans || ["", ""]; p.ans[i] = ta.value; save(); };
    row.appendChild(ta);
    c.appendChild(row);
  });

  c.appendChild(el("div", "hr"));
  const allChecked = p.c.every(Boolean);
  const cooling = v.status === "fail" && v.at && Date.now() - v.at < REJECT_COOLDOWN;
  const foot = el("div");
  if (v.status === "pass") {
    foot.appendChild(el("p", "sub", "ครูตรวจผ่านแล้วเมื่อ " + hhmm(v.at) + " ทำภารกิจเสริมต่อ หรือไปช่วยทีมอื่นเพื่อรับ Helper Award"));
  } else {
    const btn = el("button", "btn blue", "ยกป้ายตรวจ");
    btn.disabled = !allChecked || !!p.flagAt || cooling;
    btn.onclick = () => { p.flagAt = Date.now(); save(true); renderWorksheet(); };
    foot.appendChild(btn);
    let hint;
    if (!allChecked) hint = "ติ๊กเกณฑ์ผ่านด่านให้ครบทั้ง 3 ข้อก่อน จึงจะยกป้ายเรียกครูได้";
    else if (cooling) hint = "ครูตรวจไม่ผ่าน ยกป้ายได้อีกครั้งใน " + Math.ceil((REJECT_COOLDOWN - (Date.now() - v.at)) / 1000) + " วินาที";
    else if (p.flagAt) hint = "ยกป้ายไว้เมื่อ " + hhmm(p.flagAt) + " ชื่อทีมอยู่ในคิวของครูแล้ว";
    else hint = "กดเมื่อพร้อมให้ครูมาตรวจ ระบบจะบันทึกเวลาที่กดเป็นเวลาที่ใช้แข่ง";
    const ph = el("p", "sub", hint); ph.style.margin = "10px 0 0"; foot.appendChild(ph);
    if (v.status === "fail" && v.note) {
      const pn = el("p", "sub", "ครูบันทึกไว้ว่า: " + v.note);
      pn.style.cssText = "margin:6px 0 0;color:var(--warn)";
      foot.appendChild(pn);
    }
  }
  c.appendChild(foot);

  if (focusId != null) {
    const back = c.querySelector('textarea[data-ans="' + focusId + '"]');
    if (back) { back.focus(); try { back.setSelectionRange(caret, caret); } catch {} }
  }
}

function renderRank() {
  if (!S.me) return;
  $("#rankTitle").textContent = "อันดับใบงาน " + S.ws;
  const list = S.ranking[S.ws] || [];
  const b = $("#rankBody");
  if (!list.length) { b.innerHTML = '<div class="empty"><b>ยังไม่มีทีมไหนผ่าน</b>เป็นทีมแรกที่ยกป้ายสิ</div>'; return; }
  let h = '<table class="board"><tr><th>อันดับ</th><th>ทีม</th><th>เวลาที่ผ่าน</th><th>ดาว</th></tr>';
  list.forEach((r) => {
    h += '<tr><td class="rank">' + r.rank + "</td><td>" + esc(r.name) + '</td><td class="mono">' + hhmm(r.at) + "</td><td>" + "⭐".repeat(r.stars || 2) + "</td></tr>";
  });
  b.innerHTML = h + "</table>";
}

function save(now) {
  if (!S.me) return;
  clearTimeout(S.saveT);
  const go = async () => {
    try {
      await api("progress", { id: S.me.id, ws: S.ws, progress: prog() });
    } catch (e) {
      if (String(e.message).includes("ไม่พบทีม")) { await api("team", S.me).catch(() => {}); }
      else setSync(false, "บันทึกไม่สำเร็จ");
    }
  };
  if (now) go(); else S.saveT = setTimeout(go, 800);
}

/* ============================================================
   ฝั่งครู
   ============================================================ */
function renderTeacher() {
  if (S.role !== "teacher") return;
  const wid = S.wsT;
  $("#selWsT").value = wid;

  const q = $("#queue");
  const rows = [];
  for (const t of S.teams) {
    const p = (t.progress || {})[wid];
    const v = (S.verdicts[t.id] || {})[wid];
    if (v && v.status === "pass") rows.push({ t, p, v, sort: 1, at: v.at });
    else if (p && p.flagAt) rows.push({ t, p, v, sort: 0, at: p.flagAt });
  }
  rows.sort((a, b) => a.sort - b.sort || a.at - b.at);

  if (!rows.length) {
    q.innerHTML = '<div class="empty"><b>ยังไม่มีทีมยกป้าย</b>คิวจะขึ้นที่นี่ทันทีที่มีทีมกดยกป้ายตรวจ</div>';
  } else {
    q.innerHTML = "";
    rows.forEach((r) => {
      const d = el("div", "q" + (r.v && r.v.status === "pass" ? " done" : ""));
      const info = el("div", "qi");
      info.appendChild(el("b", null, r.t.name));
      const meta = el("span");
      if (r.v && r.v.status === "pass") {
        meta.textContent = "ผ่านแล้ว · อันดับ " + r.v.rank + " · ⭐" + (r.v.stars || 2) + " · ผ่านเมื่อ " + hhmm(r.v.at);
      } else {
        meta.textContent = "ยกป้าย " + hhmm(r.p.flagAt) + " · รอมาแล้ว " + elapsed(r.p.flagAt) + (r.p.bonus ? " · แจ้งว่าทำ Bonus แล้ว" : "");
      }
      info.appendChild(meta);
      d.appendChild(info);

      const acts = el("div", "row");
      if (r.v && r.v.status === "pass") {
        const un = el("button", "btn ghost sm", "ยกเลิกผลตรวจ");
        un.onclick = () => verdict(r.t.id, wid, { status: "clear" });
        acts.appendChild(un);
      } else {
        const p2 = el("button", "btn ok sm", "ผ่าน ⭐⭐");
        p2.onclick = () => verdict(r.t.id, wid, { status: "pass", stars: 2 });
        const p3 = el("button", "btn ok sm", "ผ่าน + Bonus ⭐⭐⭐");
        p3.onclick = () => verdict(r.t.id, wid, { status: "pass", stars: 3 });
        const no = el("button", "btn warn sm", "ยังไม่ผ่าน");
        no.onclick = () => {
          const note = prompt("บอกทีมว่ายังขาดอะไร (ปล่อยว่างได้)");
          if (note === null) return;
          verdict(r.t.id, wid, { status: "fail", note });
        };
        acts.appendChild(p2); acts.appendChild(p3); acts.appendChild(no);
      }
      d.appendChild(acts);
      q.appendChild(d);
    });
  }

  const tiles = $("#tiles");
  if (!S.teams.length) {
    tiles.innerHTML = '<div class="empty" style="grid-column:1/-1"><b>ยังไม่มีทีมเข้าร่วม</b>ให้นักเรียนเปิดลิงก์นี้ เลือกโหมดทีมนักเรียน แล้วตั้งชื่อทีม</div>';
  } else {
    tiles.innerHTML = "";
    S.teams.forEach((t) => {
      const v = S.verdicts[t.id] || {};
      const tile = el("div", "tile");
      tile.appendChild(el("p", "tname", t.name));
      tile.appendChild(el("p", "tmem", (t.members || []).join(" · ") || "—"));
      const m = el("div", "matrix");
      for (let i = 0; i < 25; i++) {
        const dot = el("i");
        if (i >= WS.length) dot.className = "dead";
        else {
          const id = WS[i].id, vv = v[id], pp = (t.progress || {})[id];
          if (vv && vv.status === "pass") dot.className = vv.stars === 3 ? "bonus" : "on";
          else if (pp && pp.flagAt) dot.className = "wait";
          dot.title = id + " · " + WSMAP[id].title;
        }
        m.appendChild(dot);
      }
      tile.appendChild(m);
      const passed = Object.values(v).filter((x) => x.status === "pass").length;
      const stat = el("div", "stat");
      stat.innerHTML = "<span>ผ่าน <b>" + passed + "</b>/" + WS.length + "</span><span>⭐ <b>" + totalStars(v) + "</b></span>";
      tile.appendChild(stat);
      tiles.appendChild(tile);
    });
  }

  const sum = $("#summary");
  if (!S.teams.length) { sum.innerHTML = '<div class="empty">ยังไม่มีข้อมูล</div>'; }
  else {
    const ranked = S.teams
      .map((t) => {
        const v = S.verdicts[t.id] || {};
        const passes = Object.values(v).filter((x) => x.status === "pass");
        const firsts = passes.filter((x) => x.rank === 1).length;
        return { t, passed: passes.length, stars: totalStars(v), firsts };
      })
      .sort((a, b) => b.stars - a.stars || b.firsts - a.firsts);
    let h = '<table class="board"><tr><th>ที่</th><th>ทีม</th><th>ใบงานที่ผ่าน</th><th>ดาวรวม</th><th>ได้ที่ 1</th></tr>';
    ranked.forEach((r, i) => {
      h += '<tr><td class="rank">' + (i + 1) + "</td><td>" + esc(r.t.name) + "</td><td>" + r.passed + "</td><td>⭐ " + r.stars + "</td><td>" + r.firsts + "</td></tr>";
    });
    sum.innerHTML = h + "</table>";
  }
}

async function verdict(teamId, ws, extra) {
  try {
    await api("verdict", { teamId, ws, pin: S.pin, ...extra });
  } catch (e) {
    if (String(e.message).includes("รหัสครู")) {
      S.pin = ""; LS.del("pin");
      alertBox("err", "รหัสครูไม่ถูกต้อง กดปุ่มครูอีกครั้งเพื่อใส่ใหม่");
    } else alertBox("err", esc(e.message));
  }
}

$("#btnReset").onclick = async () => {
  if (!confirm("ลบทุกทีมและผลตรวจทั้งหมดของห้อง " + ROOM + "? ย้อนกลับไม่ได้")) return;
  try { await api("reset", { pin: S.pin }); } catch (e) { alertBox("err", esc(e.message)); }
};

$("#btnCsv").onclick = () => {
  const head = ["ทีม", "สมาชิก", "ใบงาน", "สถานะ", "อันดับ", "ดาว", "เวลาที่ผ่าน"];
  const rows = [head];
  for (const t of S.teams) {
    const v = S.verdicts[t.id] || {};
    for (const w of WS) {
      const x = v[w.id];
      if (!x || x.status !== "pass") continue;
      rows.push([t.name, (t.members || []).join(" "), w.id + " " + w.title, "ผ่าน", x.rank, x.stars, new Date(x.at).toLocaleString("th-TH")]);
    }
  }
  const csv = "\uFEFF" + rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = "wom-scores-" + ROOM + ".csv";
  a.click();
  URL.revokeObjectURL(a.href);
};

/* ============================================================
   สตรีมข้อมูลสด
   ============================================================ */
function render() {
  if (S.role === "team") renderTeam(); else renderTeacher();
}

function applyState(st) {
  S.teams = st.teams || [];
  S.verdicts = st.verdicts || {};
  S.ranking = st.ranking || {};
  // ให้ค่าจากเซิร์ฟเวอร์ชนะ ยกเว้นใบงานที่กำลังแก้อยู่ตรงหน้า
  const mine = serverTeam();
  if (mine) {
    for (const wid in mine.progress) {
      if (wid === S.ws && document.activeElement && document.activeElement.dataset.ans != null) continue;
      const p = mine.progress[wid];
      S.local[wid] = { c: p.c.slice(), bonus: p.bonus, start: p.start, flagAt: p.flagAt, ans: (p.ans || ["", ""]).slice() };
    }
  }
  render();
}

let es = null;
function connect() {
  if (es) es.close();
  es = new EventSource("/api/stream?room=" + encodeURIComponent(ROOM));
  es.onopen = () => setSync(true, "เชื่อมต่อสด");
  es.onmessage = (ev) => {
    setSync(true, "อัปเดต " + hhmm(Date.now()));
    try { applyState(JSON.parse(ev.data)); } catch {}
  };
  es.onerror = () => setSync(false, "หลุดการเชื่อมต่อ กำลังต่อใหม่");
}

setInterval(() => {
  if (S.role !== "team" || !S.me) return;
  const p = S.local[S.ws];
  const d = document.getElementById("tdisp");
  if (d && p && p.start) d.textContent = "⏱ " + elapsed(p.start);
}, 1000);

/* ============================================================
   บูต
   ============================================================ */
(async function init() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    S.pinRequired = !!cfg.pinRequired;
  } catch {}
  const me = LS.get("me");
  if (me && me.id) S.me = me;
  const role = LS.get("role");
  S.role = role === "teacher" ? "teacher" : "team";
  $("#btnTeam").setAttribute("aria-pressed", S.role === "team");
  $("#btnTeacher").setAttribute("aria-pressed", S.role === "teacher");
  $("#viewTeam").classList.toggle("hide", S.role !== "team");
  $("#viewTeacher").classList.toggle("hide", S.role !== "teacher");
  render();
  connect();
  // เครื่องที่เคยเข้าร่วมแล้ว ให้ประกาศตัวกับเซิร์ฟเวอร์อีกครั้งเผื่อข้อมูลถูกล้าง
  if (S.me) api("team", S.me).catch(() => {});
})();
