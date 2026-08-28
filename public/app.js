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
  user: null,        // {sid,name,photo,teamId} ของคนที่เข้าสู่ระบบ
  token: "",
  authMode: "login",
  local: {},         // progress ที่กำลังแก้อยู่ ยังไม่ถูกเซิร์ฟเวอร์เขียนทับ
  teams: [],
  verdicts: {},
  ranking: {},
  mods: {},
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



/* ---------- ตัวดูภาพขั้นตอนการประกอบ ---------- */
const stepAt = {}; // จำขั้นที่ดูค้างไว้ของแต่ละใบงาน
function padNum(n) { return String(n).padStart(3, "0"); }

function buildStepper(w) {
  const total = w.asm.n;
  let i = Math.min(stepAt[w.id] || 1, total);
  const box = el("div", "stepper");

  const bar = el("div", "stepbar");
  const prev = el("button", "navbtn", "◀ ก่อนหน้า");
  const lbl = el("span", "lbl");
  const next = el("button", "navbtn", "ถัดไป ▶");
  bar.appendChild(prev); bar.appendChild(lbl); bar.appendChild(next);

  const view = el("div", "stepview");
  const img = el("img");
  img.alt = "ขั้นตอนการประกอบ";
  img.decoding = "async";
  img.fetchPriority = "high";
  view.appendChild(img);
  const zoom = el("button", "zoom", "ขยายเต็มจอ");
  view.appendChild(zoom);

  const rangeWrap = el("div");
  rangeWrap.style.padding = "10px 12px 4px";
  const range = el("input", "slider");
  range.type = "range"; range.min = "1"; range.max = String(total); range.step = "1";
  range.setAttribute("aria-label", "เลื่อนเลือกขั้นตอน");
  rangeWrap.appendChild(range);

  const thumbs = el("div", "thumbs");
  for (let k = 1; k <= total; k++) {
    const t = el("img");
    t.dataset.src = w.asm.dir + "t/" + padNum(k) + ".jpg";
    t.alt = "ขั้นที่ " + k;
    t.loading = "lazy";
    t.decoding = "async";
    t.onclick = () => go(k);
    thumbs.appendChild(t);
  }
  // เริ่มโหลดรูปย่อหลังภาพหลักขึ้นแล้ว เพื่อไม่ให้แย่งแบนด์วิดท์กัน
  const loadThumbs = () => {
    [...thumbs.children].forEach((t) => { if (t.dataset.src) { t.src = t.dataset.src; delete t.dataset.src; } });
  };
  img.addEventListener("load", loadThumbs, { once: true });
  img.addEventListener("error", loadThumbs, { once: true });
  setTimeout(loadThumbs, 2500);

  function go(k) {
    i = Math.max(1, Math.min(total, k));
    stepAt[w.id] = i;
    img.src = w.asm.dir + padNum(i) + ".jpg";
    lbl.innerHTML = "ขั้นที่ <b>" + i + "</b> จาก " + total;
    prev.disabled = i <= 1;
    next.disabled = i >= total;
    range.value = String(i);
    [...thumbs.children].forEach((t, idx) => { t.dataset.cur = idx + 1 === i ? "1" : "0"; });
    const cur = thumbs.children[i - 1];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    // โหลดล่วงหน้าหนึ่งขั้นเพื่อให้กดถัดไปแล้วขึ้นทันที
    if (i < total) { const pre = new Image(); pre.src = w.asm.dir + padNum(i + 1) + ".jpg"; }
  }
  prev.onclick = () => go(i - 1);
  next.onclick = () => go(i + 1);
  range.oninput = () => go(Number(range.value));
  zoom.onclick = () => openLightbox(w, i, go);
  img.onclick = () => openLightbox(w, i, go);
  img.style.cursor = "zoom-in";

  box.appendChild(bar); box.appendChild(view); box.appendChild(rangeWrap); box.appendChild(thumbs);
  go(i);
  return box;
}

function openLightbox(w, start, sync) {
  let i = start;
  const lb = el("div", "lightbox");
  const img = el("img");
  img.alt = "ขั้นตอนการประกอบ";
  const close = el("button", null, "ปิด");
  lb.appendChild(img); lb.appendChild(close);
  function draw() { img.src = w.asm.dir + padNum(i) + ".jpg"; }
  function shut() { document.removeEventListener("keydown", key); lb.remove(); sync(i); }
  function key(e) {
    if (e.key === "Escape") shut();
    else if (e.key === "ArrowRight" && i < w.asm.n) { i++; draw(); }
    else if (e.key === "ArrowLeft" && i > 1) { i--; draw(); }
  }
  img.onclick = () => { if (i < w.asm.n) { i++; draw(); } else shut(); };
  close.onclick = shut;
  lb.onclick = (e) => { if (e.target === lb) shut(); };
  document.addEventListener("keydown", key);
  draw();
  document.body.appendChild(lb);
}

/* ---------- รูปประจำตัว ---------- */
const AVATAR_PX = 220;
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("ไฟล์นี้ไม่ใช่รูปภาพ"));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("เปิดรูปนี้ไม่ได้"));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const cv = document.createElement("canvas");
        cv.width = cv.height = AVATAR_PX;
        cv.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
        resolve(cv.toDataURL("image/jpeg", 0.72));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function faces(members, cls) {
  const w = el("div", cls);
  (members || []).forEach((m) => {
    if (m.photo) { const im = el("img"); im.src = m.photo; im.alt = m.name; im.title = m.name; w.appendChild(im); }
    else { const sp = el("span", null, (m.name || "?").slice(0, 1)); sp.title = m.name; w.appendChild(sp); }
  });
  return w;
}

/* ---------- เรียก API ---------- */
async function api(path, body) {
  const res = await fetch("/api/" + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(S.token ? { "x-auth": S.token, "x-sid": S.user ? S.user.sid : "" } : {}),
    },
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
$("#btnScore").onclick = () => setRole("score");
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
  $("#btnScore").setAttribute("aria-pressed", r === "score");
  $("#viewTeam").classList.toggle("hide", r !== "team");
  $("#viewTeacher").classList.toggle("hide", r !== "teacher");
  $("#viewScore").classList.toggle("hide", r !== "score");
  LS.set("role", r);
  render();
}

/* ---------- ตัวเลือกใบงาน ---------- */
(function fillSelects() {
  const opts = WS.map((w) => '<option value="' + w.id + '">' + w.id + " · " + esc(w.title) + "</option>").join("");
  $("#selWs").innerHTML = opts;
  $("#selWsT").innerHTML = opts;
})();
$("#selWs").onchange = (e) => { S.ws = e.target.value; renderWorksheet(); renderRank(); };
$("#selWsT").onchange = (e) => { S.wsT = e.target.value; renderTeacher(); };
$("#selWsM").innerHTML = WS.map((w) => '<option value="' + w.id + '">' + w.id + " · " + esc(w.title) + "</option>").join("");
$("#selWsM").onchange = () => { $("#inMod").value = S.mods[$("#selWsM").value] || WSMAP[$("#selWsM").value].mod; };
$("#btnSaveMod").onclick = async () => {
  const ws = $("#selWsM").value;
  const v = $("#inMod").value.trim();
  try { await api("mod", { ws, mod: v === WSMAP[ws].mod ? "" : v, pin: S.pin }); alertBox("info", "บันทึกรายการโมดูลของ " + ws + " แล้ว"); }
  catch (e) { alertBox("err", esc(e.message)); }
};
$("#btnResetMod").onclick = async () => {
  const ws = $("#selWsM").value;
  try { await api("mod", { ws, mod: "", pin: S.pin }); $("#inMod").value = WSMAP[ws].mod; alertBox("info", "คืนค่าเดิมของ " + ws + " แล้ว"); }
  catch (e) { alertBox("err", esc(e.message)); }
};

/* ============================================================
   เข้าสู่ระบบ
   ============================================================ */
function setAuthMode(m) {
  S.authMode = m;
  const reg = m === "register";
  $("#authTitle").textContent = reg ? "สมัครใช้งานด้วยรหัสนักเรียน" : "เข้าสู่ระบบด้วยรหัสนักเรียน";
  $("#authHint").textContent = reg
    ? "สมัครครั้งเดียวพอ ครั้งต่อไปใช้รหัสนักเรียนกับรหัสผ่านเดิมเข้าได้เลย"
    : "ใช้รหัสนักเรียนของตัวเองเป็นชื่อผู้ใช้ ถ้ายังไม่เคยใช้ให้กดสมัครก่อน";
  $("#fldName").classList.toggle("hide", !reg);
  $("#btnAuth").textContent = reg ? "สมัครและเข้าใช้งาน" : "เข้าสู่ระบบ";
  $("#btnSwitchAuth").textContent = reg ? "มีบัญชีแล้ว กลับไปเข้าสู่ระบบ" : "ยังไม่มีบัญชี สมัครใหม่";
  $("#inPw").autocomplete = reg ? "new-password" : "current-password";
}
$("#btnSwitchAuth").onclick = () => setAuthMode(S.authMode === "login" ? "register" : "login");

$("#btnAuth").onclick = async () => {
  const sid = $("#inSid").value.trim();
  const password = $("#inPw").value;
  const name = $("#inFullName").value.trim();
  if (!sid) { alertBox("err", "ใส่รหัสนักเรียนก่อน"); $("#inSid").focus(); return; }
  if (!password) { alertBox("err", "ใส่รหัสผ่านก่อน"); $("#inPw").focus(); return; }
  try {
    const r = await api(S.authMode === "register" ? "register" : "login", { sid, password, name });
    S.token = r.token; S.user = r.user;
    LS.set("auth", { token: r.token, sid: r.user.sid });
    $("#inPw").value = "";
    alertBox("");
    render();
  } catch (e) { alertBox("err", esc(e.message)); }
};
[$("#inSid"), $("#inPw"), $("#inFullName")].forEach((n) => {
  n.onkeydown = (e) => { if (e.key === "Enter") $("#btnAuth").click(); };
});

$("#btnLogout").onclick = () => {
  S.token = ""; S.user = null;
  LS.del("auth");
  render();
};

$("#myAvatar").onclick = () => $("#myPhotoFile").click();
$("#myPhotoFile").onchange = async () => {
  const f = $("#myPhotoFile").files && $("#myPhotoFile").files[0];
  if (!f) return;
  try {
    const photo = await shrinkImage(f);
    await api("photo", { photo });
    S.user.photo = photo;
    alertBox(""); render();
  } catch (e) { alertBox("err", "ใส่รูปไม่สำเร็จ: " + esc(e.message)); }
  $("#myPhotoFile").value = "";
};

/* ============================================================
   จับทีม
   ============================================================ */
$("#btnCreateTeam").onclick = async () => {
  const name = $("#inTeamName").value.trim();
  if (!name) { alertBox("err", "ใส่ชื่อทีมก่อน"); return; }
  try { const r = await api("team/create", { name }); S.user.teamId = r.teamId; alertBox(""); render(); }
  catch (e) { alertBox("err", esc(e.message)); }
};
$("#btnJoinTeam").onclick = async () => {
  const code = $("#inTeamCode").value.trim().toUpperCase();
  if (code.length !== 4) { alertBox("err", "รหัสทีมมี 4 ตัว"); return; }
  try { const r = await api("team/join", { code }); S.user.teamId = r.teamId; alertBox(""); render(); }
  catch (e) { alertBox("err", esc(e.message)); }
};
$("#inTeamCode").oninput = (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };

$("#btnLeave").onclick = async () => {
  if (!confirm("ออกจากทีมนี้? ถ้าเป็นคนสุดท้ายในทีม ทีมและคะแนนจะถูกลบทั้งหมด")) return;
  try { await api("team/leave", {}); S.user.teamId = ""; S.local = {}; render(); }
  catch (e) { alertBox("err", esc(e.message)); }
};
$("#btnRename").onclick = async () => {
  const t = myTeam();
  const name = prompt("ชื่อทีมใหม่", t ? t.name : "");
  if (name === null) return;
  try { await api("team/rename", { name: name.trim() }); }
  catch (e) { alertBox("err", esc(e.message)); }
};

function myTeam() {
  if (!S.user || !S.user.teamId) return null;
  return S.teams.find((t) => t.id === S.user.teamId) || null;
}
function prog() {
  const wid = S.ws;
  if (!S.local[wid]) {
    const t = myTeam();
    const p = t && t.progress && t.progress[wid];
    S.local[wid] = p
      ? { c: p.c.slice(), bonus: p.bonus, start: p.start, flagAt: p.flagAt, ans: (p.ans || ["", ""]).slice() }
      : { c: [false, false, false], bonus: false, start: 0, flagAt: 0, ans: ["", ""] };
  }
  return S.local[wid];
}
function myVerdict() {
  const t = myTeam();
  return (t && S.verdicts[t.id]) || {};
}
function totalStars(v) {
  let n = 0;
  for (const k in v) if (v[k] && v[k].status === "pass") n += v[k].stars || 2;
  return n;
}

function renderTeam() {
  const logged = !!S.user;
  const t = myTeam();
  $("#authCard").classList.toggle("hide", logged);
  $("#lobbyCard").classList.toggle("hide", !logged || !!t);
  $("#teamHead").classList.toggle("hide", !t);
  $("#wsCard").classList.toggle("hide", !t);
  $("#rankCard").classList.toggle("hide", !t);
  if (!logged) return;

  $("#myName").textContent = S.user.name;
  $("#mySid").textContent = "รหัสนักเรียน " + S.user.sid;
  const av = $("#myAvatar");
  av.innerHTML = "";
  if (S.user.photo) { av.dataset.has = "1"; const im = el("img"); im.src = S.user.photo; im.alt = ""; av.appendChild(im); }
  else { av.dataset.has = "0"; av.textContent = "ใส่รูป"; }
  if (!t) return;

  $("#tCode").textContent = t.code;
  $("#tName").textContent = t.name;
  $("#selWs").value = S.ws;
  $("#tStars").textContent = "⭐ " + totalStars(myVerdict());
  const fr = $("#tFaces");
  const nf = faces(t.members, "facerow");
  nf.id = "tFaces";
  fr.replaceWith(nf);
  $("#tMem").textContent = t.members.map((m) => m.name).join(" · ") + " · " + t.members.length + "/3 คน";
  renderWorksheet();
  renderRank();
}

function renderWorksheet() {
  if (!myTeam() || S.role !== "team") return;
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
  c.appendChild(el("p", null, S.mods[w.id] || w.mod));
  c.appendChild(el("h3", null, "แบ่งงานในทีม"));
  c.appendChild(el("p", null, w.roles));
  if (w.asm) {
    c.appendChild(el("h3", null, "ขั้นตอนการประกอบชิ้นส่วน"));
    const wrap = el("div", "asmwrap");

    const fig = el("figure", "asmimg");
    fig.style.margin = "0";
    const im = el("img");
    im.src = w.asm.img; im.alt = "ชิ้นงาน " + w.id + " ที่ประกอบเสร็จแล้ว"; im.loading = "lazy";
    fig.appendChild(im);
    fig.appendChild(el("figcaption", null, "หน้าตาชิ้นงานเมื่อประกอบเสร็จ"));
    wrap.appendChild(fig);

    const right = el("div");
    right.appendChild(buildStepper(w));
    wrap.appendChild(right);
    c.appendChild(wrap);
  }

  c.appendChild(el("h3", null, "ขั้นตอนการเขียนโปรแกรม"));
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
  if (!myTeam()) return;
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
  if (!myTeam()) return;
  clearTimeout(S.saveT);
  const go = async () => {
    try { await api("progress", { ws: S.ws, progress: prog() }); }
    catch (e) { setSync(false, "บันทึกไม่สำเร็จ"); }
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
        meta.textContent = "ยกป้าย " + hhmm(r.p.flagAt) + " · รอมาแล้ว " + elapsed(r.p.flagAt)
          + (r.p.bonus ? " · แจ้งว่าทำ Bonus แล้ว" : "");
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
      tile.appendChild(faces(t.members, "faces"));
      tile.appendChild(el("p", "tmem", (t.members || []).map((m) => m.name).join(" · ") || "—"));
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

  // รายการโมดูลที่ครูแก้ไว้
  const sel = $("#selWsM").value;
  if (document.activeElement !== $("#inMod")) $("#inMod").value = S.mods[sel] || WSMAP[sel].mod;
  const edited = Object.keys(S.mods);
  $("#modList").innerHTML = edited.length
    ? '<p class="sub" style="margin:0 0 6px">แก้ไว้แล้ว ' + edited.length + " ใบงาน</p><ul class=\"plain\">" +
      edited.sort().map((k) => "<li><b>" + k + "</b> — " + esc(S.mods[k]) + "</li>").join("") + "</ul>"
    : '<p class="sub" style="margin:0">ยังไม่ได้แก้ใบงานไหน</p>';

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
  if (!confirm("ลบทุกทีมและผลตรวจของห้อง " + ROOM + "? บัญชีนักเรียนยังอยู่")) return;
  try { await api("reset", { pin: S.pin, keepUsers: true }); } catch (e) { alertBox("err", esc(e.message)); }
};
$("#btnResetAll").onclick = async () => {
  if (!confirm("ลบทุกอย่างรวมบัญชีนักเรียนของห้อง " + ROOM + "? เด็กต้องสมัครใหม่ทั้งหมด")) return;
  try { await api("reset", { pin: S.pin, keepUsers: false }); LS.del("auth"); S.user = null; S.token = ""; render(); }
  catch (e) { alertBox("err", esc(e.message)); }
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
   หน้าคะแนนรวม
   ============================================================ */
function tally() {
  return S.teams
    .map((t) => {
      const v = S.verdicts[t.id] || {};
      const passes = Object.values(v).filter((x) => x.status === "pass");
      return {
        t,
        v,
        passed: passes.length,
        stars: passes.reduce((a, x) => a + (x.stars || 2), 0),
        firsts: passes.filter((x) => x.rank === 1).length,
        bonus: passes.filter((x) => x.stars === 3).length,
        last: passes.reduce((a, x) => Math.max(a, x.at || 0), 0),
      };
    })
    .sort((a, b) => b.stars - a.stars || b.firsts - a.firsts || a.last - b.last);
}

function renderScore() {
  if (S.role !== "score") return;
  const rows = tally();
  const pod = $("#podium");
  const tab = $("#scoreTable");
  const mtx = $("#matrixTable");

  if (!rows.length) {
    pod.innerHTML = "";
    tab.innerHTML = '<div class="empty"><b>ยังไม่มีทีมเข้าร่วม</b>ตารางจะขึ้นเองทันทีที่มีทีมแรกผ่านใบงาน</div>';
    mtx.innerHTML = "";
    return;
  }

  // แท่นสามอันดับแรก
  pod.innerHTML = "";
  const podium = el("div", "podium");
  const medals = ["🥇", "🥈", "🥉"];
  rows.slice(0, 3).forEach((r, i) => {
    const d = el("div", "pod" + (i === 0 ? " p1" : ""));
    d.appendChild(el("div", "medal", medals[i]));
    d.appendChild(el("div", "nm", r.t.name));
    d.appendChild(el("div", "sc", "⭐ " + r.stars));
    d.appendChild(el("div", "sub2", "ผ่าน " + r.passed + " ใบงาน · ได้ที่ 1 จำนวน " + r.firsts + " ครั้ง"));
    d.appendChild(faces(r.t.members, "facerow"));
    podium.appendChild(d);
  });
  pod.appendChild(podium);

  // ตารางอันดับเต็ม
  let h = '<table class="board"><tr><th>ที่</th><th>ทีม</th><th>ดาวรวม</th><th>ผ่าน</th><th>ได้ที่ 1</th><th>ทำ Bonus</th></tr>';
  rows.forEach((r, i) => {
    h += "<tr>" +
      '<td class="rank">' + (i + 1) + "</td>" +
      "<td>" + esc(r.t.name) + "</td>" +
      '<td class="mono">⭐ ' + r.stars + "</td>" +
      '<td class="mono">' + r.passed + "/" + WS.length + "</td>" +
      '<td class="mono">' + r.firsts + "</td>" +
      '<td class="mono">' + r.bonus + "</td></tr>";
  });
  tab.innerHTML = h + "</table>";

  // ตารางรายใบงาน
  let m = '<table class="matrix"><tr><th>ทีม</th>';
  WS.forEach((w) => { m += "<th>" + w.id + "</th>"; });
  m += "<th>⭐</th></tr>";
  rows.forEach((r) => {
    m += "<tr><td>" + esc(r.t.name) + "</td>";
    WS.forEach((w) => {
      const x = r.v[w.id];
      if (x && x.status === "pass") {
        m += '<td class="' + (x.stars === 3 ? "gold" : "pass") + '" title="' + esc(w.title) + '">' + x.rank + "</td>";
      } else m += "<td></td>";
    });
    m += '<td class="mono"><b>' + r.stars + "</b></td></tr>";
  });
  mtx.innerHTML = m + "</table>";
}

$("#btnFull").onclick = () => {
  document.body.classList.toggle("projector");
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.();
};

/* ============================================================
   สตรีมข้อมูลสด
   ============================================================ */
function render() {
  if (S.role === "team") renderTeam();
  else if (S.role === "teacher") renderTeacher();
  else renderScore();
}

function applyState(st) {
  S.teams = st.teams || [];
  S.verdicts = st.verdicts || {};
  S.ranking = st.ranking || {};
  S.mods = st.mods || {};
  const t = myTeam();
  if (t) {
    for (const wid in t.progress) {
      if (wid === S.ws && document.activeElement && document.activeElement.dataset.ans != null) continue;
      const p = t.progress[wid];
      S.local[wid] = { c: p.c.slice(), bonus: p.bonus, start: p.start, flagAt: p.flagAt, ans: (p.ans || ["", ""]).slice() };
    }
    const me = t.members.find((m) => m.sid === S.user.sid);
    if (me && S.user) S.user.photo = me.photo;
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
  if (S.role !== "team" || !myTeam()) return;
  const p = S.local[S.ws];
  const d = document.getElementById("tdisp");
  if (d && p && p.start) d.textContent = "⏱ " + elapsed(p.start);
}, 1000);

/* ============================================================
   บูต
   ============================================================ */
/* ---------- รายชื่อนักเรียนสำหรับครู ---------- */
$("#btnRoster").onclick = async () => {
  try {
    const r = await api("roster", { pin: S.pin });
    if (!r.users.length) { $("#rosterBox").innerHTML = '<div class="empty">ยังไม่มีใครสมัคร</div>'; return; }
    let h = '<table class="roster"><tr><th>รหัสนักเรียน</th><th>ชื่อ</th><th>ทีม</th><th></th></tr>';
    r.users.forEach((u) => {
      h += '<tr><td class="mono">' + esc(u.sid) + "</td><td>" + esc(u.name) + "</td><td>" +
challenge(u.team) + '</td><td><button class="btn ghost sm" data-pw="' + esc(u.sid) + '">ตั้งรหัสใหม่</button></td></tr>';
    });
    $("#rosterBox").innerHTML = h + "</table>";
    $("#rosterBox").querySelectorAll("[data-pw]").forEach((b) => {
      b.onclick = async () => {
        const pw = prompt("รหัสผ่านใหม่ของ " + b.dataset.pw + " (อย่างน้อย 4 ตัว)");
        if (!pw) return;
        try { await api("resetpw", { sid: b.dataset.pw, password: pw, pin: S.pin }); alertBox("info", "ตั้งรหัสใหม่ให้ " + esc(b.dataset.pw) + " แล้ว บอกเด็กว่า " + esc(pw)); }
        catch (e) { alertBox("err", esc(e.message)); }
      };
    });
  } catch (e) { alertBox("err", esc(e.message)); }
};
function challenge(v) { return v ? esc(v) : '<span style="color:var(--faint)">ยังไม่มีทีม</span>'; }

(async function init() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    S.pinRequired = !!cfg.pinRequired;
  } catch {}
  setAuthMode("login");
  const a = LS.get("auth");
  if (a && a.token && a.sid) {
    S.token = a.token;
    S.user = { sid: a.sid, name: a.sid, photo: "", teamId: "" };
    try { const r = await api("me", {}); S.user = r.user; }
    catch { S.token = ""; S.user = null; LS.del("auth"); }
  }
  const role = LS.get("role");
  S.role = ["teacher", "score"].includes(role) ? role : "team";
  $("#btnTeam").setAttribute("aria-pressed", S.role === "team");
  $("#btnTeacher").setAttribute("aria-pressed", S.role === "teacher");
  $("#btnScore").setAttribute("aria-pressed", S.role === "score");
  $("#viewTeam").classList.toggle("hide", S.role !== "team");
  $("#viewTeacher").classList.toggle("hide", S.role !== "teacher");
  $("#viewScore").classList.toggle("hide", S.role !== "score");
  render();
  connect();
})();
