// جلسة تمرين (#workout/<dayId>): المتدرب بيسجّل وزن وعدات كل مجموعة، ويشوف أدائه السابق
import { supabase, esc } from "../supabase.js";
import { youtubeId, thumbnail, openVideo } from "../youtube.js";
import { toast, loadingView } from "../ui.js";
import { pickSet } from "../wheel.js";

const fmtDate = (iso) => new Date(iso).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "short" });
const w = (n) => String(+n); // 25.00 → 25
const SAVED = `<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>اتحفظ`;
const TRASH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`;
const CHEERS = ["برافو يا {n}! خلّصت تمرينك زي الأبطال", "عاش يا {n}! يوم تاني في الجيم وخطوة تانية لهدفك", "تمرين جامد يا {n}! الالتزام ده هو سر النتيجة", "كمّلت للآخر يا {n}! فخورين بيك"];
const setsText = (logs) => logs.map((l) => `${w(l.weight)}×${l.reps}`).join("  ·  ");

// سحب الصف من اليمين لليسار يكشف زرار المسح (بالماوس واللمس). الصف الفاضي بيرجع مكانه لو السحب مش كفاية
function swipeToDelete(wrap, onDelete) {
  const row = wrap.querySelector(".wk-set"), del = wrap.querySelector(".wk-del"), W = 88;
  let x0 = 0, y0 = 0, base = 0, x = 0, down = false, drag = false, moved = false;
  row.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    down = true; drag = false; moved = false; x0 = e.clientX; y0 = e.clientY; base = wrap.classList.contains("open") ? -W : 0;
  });
  row.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!drag) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { down = false; return; } // سكرول عمودي عادي
      if (Math.abs(dx) <= 8) return;
      drag = moved = true; row.setPointerCapture(e.pointerId); wrap.classList.add("drag");
      document.querySelectorAll(".wk-swipe.open").forEach((o) => o !== wrap && o.classList.remove("open"));
    }
    x = Math.max(-W - 16, Math.min(0, base + dx)); row.style.transform = `translateX(${x}px)`;
  });
  const end = () => {
    down = false;
    if (!drag) return;
    drag = false; wrap.classList.remove("drag"); row.style.transform = "";
    wrap.classList.toggle("open", x < -W / 2);
  };
  row.addEventListener("pointerup", end); row.addEventListener("pointercancel", end);
  // بعد السحب ما نفتحش العجلات، ولو الزرار ظاهر الضغطة على الصف تقفله بس
  row.addEventListener("click", (e) => {
    if (moved || wrap.classList.contains("open")) { e.stopPropagation(); e.preventDefault(); if (!moved) wrap.classList.remove("open"); moved = false; }
  }, true);
  del.onclick = async () => {
    del.disabled = true;
    try { await onDelete(); wrap.classList.add("leaving"); setTimeout(() => wrap.dispatchEvent(new Event("gone")), 320); }
    catch (err) { toast("ما اتمسحش: " + err.message, true); del.disabled = false; wrap.dispatchEvent(new Event("gone")); }
  };
}

// آخر جلسة اتسجّل فيها التمرين ده (غير الجلسة الحالية): { date, logs[] }
function lastSession(logs, exId, skipSession) {
  const mine = logs.filter((l) => l.exercise_id === exId && l.session_id !== skipSession);
  if (!mine.length) return null;
  const sid = mine[0].session_id; // الأحدث أولاً
  return { date: mine[0].created_at, logs: mine.filter((l) => l.session_id === sid).sort((a, b) => a.set_no - b.set_no) };
}

export async function renderWorkout(main, { profile, stale }, dayId) {
  main.innerHTML = loadingView("rows");
  const { data: day, error } = await supabase.from("workout_days")
    .select("*, workout_items(*, exercises(id,name,youtube_url))").eq("id", dayId).maybeSingle();
  if (stale()) return;
  if (error || !day) { main.innerHTML = `<div class="empty">اليوم ده مش موجود. <a href="#myplan">رجوع لخطتي</a></div>`; return; }
  const items = day.workout_items.filter((i) => i.exercise_id).sort((a, b) => a.sort - b.sort || a.id - b.id);
  if (!items.length) { main.innerHTML = `<div class="empty">اليوم ده مفيهوش تمارين. <a href="#myplan">رجوع لخطتي</a></div>`; return; }

  // نكمّل جلسة مفتوحة لنفس اليوم (آخر 12 ساعة) عشان اللي يقفل الصفحة ما يخسرش اللي سجّله
  const since = new Date(Date.now() - 12 * 3600e3).toISOString();
  const { data: open } = await supabase.from("workout_sessions").select("*").eq("member_id", profile.id)
    .eq("day_name", day.name).is("finished_at", null).gte("started_at", since).order("started_at", { ascending: false }).limit(1);
  let session = open && open[0] || null;

  const ids = items.map((i) => i.exercise_id);
  const { data: logs, error: e2 } = await supabase.from("set_logs").select("*").eq("member_id", profile.id)
    .in("exercise_id", ids).order("created_at", { ascending: false }).limit(1000);
  if (stale()) return;
  if (e2) { main.innerHTML = `<div class="empty">ما قدرناش نجيب سجل التمارين: ${esc(e2.message)}</div>`; return; }

  const mine = {}; // `${exercise_id}:${set_no}` → صف مسجّل في الجلسة الحالية
  if (session) logs.filter((l) => l.session_id === session.id).forEach((l) => (mine[`${l.exercise_id}:${l.set_no}`] = l));
  const count = {}; // عدد صفوف كل تمرين (المطلوب + أي مجموعات زيادة)
  items.forEach((i) => { count[i.id] = Math.max(i.sets, ...Object.values(mine).filter((l) => l.exercise_id === i.exercise_id).map((l) => l.set_no)); });

  const total = () => items.reduce((s, i) => s + count[i.id], 0);
  const done = () => Object.keys(mine).length;

  function draw() {
    main.innerHTML = `
      <div class="view-head"><div><h1>${esc(day.name)}</h1><p><a href="#myplan">← رجوع لخطتي</a></p></div>
        <div class="dose" id="wk-progress">${done()} <em>من</em> ${total()} مجموعة</div></div>
      ${items.map((it) => {
        const ex = it.exercises, vid = youtubeId(ex.youtube_url), prev = lastSession(logs, it.exercise_id, session && session.id);
        const rows = Array.from({ length: count[it.id] }, (_, k) => {
          const n = k + 1, l = mine[`${it.exercise_id}:${n}`], p = prev && prev.logs.find((x) => x.set_no === n);
          const del = n > it.sets ? `<button class="wk-del" type="button" aria-label="امسح مجموعة ${n}">${TRASH}مسح</button>` : "";
          return `<div class="wk-swipe">${del}<div class="wk-set${l ? " done" : ""}" data-ex="${it.id}" data-n="${n}">
            <span class="n">${n}</span>
            <button class="wk-val${l ? "" : " ph"}" type="button" data-pick aria-label="الوزن بالكجم، مجموعة ${n}">${l ? w(l.weight) : p ? w(p.weight) : "كجم"}</button>
            <button class="wk-val${l ? "" : " ph"}" type="button" data-pick aria-label="العدات، مجموعة ${n}">${l ? l.reps : p ? p.reps : esc(it.reps)}</button>
            <button class="btn ${l ? "btn-ink" : "btn-tape"} btn-sm" type="button" data-pick>${l ? SAVED : "سجّل"}</button></div></div>`;
        }).join("");
        return `<section class="panel wk-ex">
          <div class="row-title">
            ${vid ? `<button class="thumb wk-thumb" type="button" data-play="${it.id}" aria-label="شغّل فيديو ${esc(ex.name)}"><img src="${thumbnail(vid)}" alt="" loading="lazy"><span class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span></button>` : ""}
            <h3>${esc(ex.name)}</h3><span class="dose">${esc(it.sets)} <em>×</em> ${esc(it.reps)}</span>
          </div>
          ${it.note ? `<p class="cues">${esc(it.note)}</p>` : ""}
          <p class="legend">${prev ? `آخر مرة (${fmtDate(prev.date)}): ${esc(setsText(prev.logs))}` : "أول مرة تسجّل التمرين ده."}</p>
          <div class="wk-head"><span>#</span><span>الوزن (كجم)</span><span>العدات</span><span></span></div>
          ${rows}
          <div class="wk-actions">
            <button class="btn btn-ink btn-sm" type="button" data-hist="${it.id}">تطوري</button>
            ${count[it.id] < 20 ? `<button class="btn btn-ghost btn-sm" type="button" data-more="${it.id}">+ مجموعة</button>` : ""}
          </div>
        </section>`;
      }).join("")}
      <div class="foot"><button class="btn btn-tape" type="button" id="finish">خلّصت التمرين</button></div>`;
    bind();
  }

  // يمسح المجموعة n (لو متسجّلة) ويزحّف اللي بعدها مكانها عشان الترقيم ما يبقاش فيه فجوات
  async function removeSet(it, n) {
    const k = (m) => `${it.exercise_id}:${m}`;
    if (mine[k(n)]) {
      const { error } = await supabase.from("set_logs").delete().eq("id", mine[k(n)].id);
      if (error) throw error;
      const i = logs.findIndex((l) => l.id === mine[k(n)].id); if (i >= 0) logs.splice(i, 1);
      delete mine[k(n)];
    }
    for (let m = n + 1; m <= count[it.id]; m++) {
      const l = mine[k(m)]; if (!l) continue;
      const { data, error } = await supabase.from("set_logs").update({ set_no: m - 1 }).eq("id", l.id).select().single();
      if (error) throw error;
      delete mine[k(m)]; mine[k(m - 1)] = data;
      logs[logs.findIndex((x) => x.id === data.id)] = data;
    }
    count[it.id]--;
  }

  function bind() {
    main.querySelectorAll("[data-play]").forEach((b) => (b.onclick = () => { const it = items.find((x) => x.id == b.dataset.play); openVideo(it.exercises.youtube_url, it.exercises.name); }));
    main.querySelectorAll("[data-hist]").forEach((b) => (b.onclick = () => { const it = items.find((x) => x.id == b.dataset.hist); showHistory(it.exercise_id, it.exercises.name); }));
    main.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => {
      count[b.dataset.more]++; draw();
      const rows = main.querySelectorAll(`.wk-set[data-ex="${b.dataset.more}"]`); // الصف الجديد يلمّح إنه بيتسحب
      rows[rows.length - 1].parentElement.classList.add("peek");
    }));
    main.querySelectorAll(".wk-set").forEach((row) => {
      const it = items.find((x) => x.id == row.dataset.ex), n = +row.dataset.n, key = `${it.exercise_id}:${n}`;
      const [wb, rb, btn] = row.querySelectorAll("[data-pick]");
      const save = async (weight, reps) => {
        if (!session) { // الجلسة بتتعمل عند أول مجموعة بتتسجّل
          const r = await supabase.from("workout_sessions").insert({ day_name: day.name }).select().single();
          if (r.error) throw r.error; session = r.data;
        }
        const row_ = { weight, reps };
        const q = mine[key] ? supabase.from("set_logs").update(row_).eq("id", mine[key].id)
          : supabase.from("set_logs").insert({ ...row_, session_id: session.id, exercise_id: it.exercise_id, exercise_name: it.exercises.name, set_no: n });
        const { data, error } = await q.select().single();
        if (error) throw error;
        mine[key] = data;
        const i = logs.findIndex((l) => l.id === data.id); if (i >= 0) logs[i] = data; else logs.unshift(data);
        row.classList.add("done"); btn.className = "btn btn-ink btn-sm"; btn.innerHTML = SAVED;
        wb.textContent = w(weight); rb.textContent = reps; wb.classList.remove("ph"); rb.classList.remove("ph");
        row.classList.remove("pulse"); void row.offsetWidth; row.classList.add("pulse"); // نبضة تأكيد
        main.querySelector("#wk-progress").innerHTML = `${done()} <em>من</em> ${total()} مجموعة`;
      };
      // البداية من المسجّل، وإلا من آخر جلسة، وإلا من آخر مجموعة اتسجّلت في التمرين ده، وإلا من قيم افتراضية
      const open = () => {
        const prev = lastSession(logs, it.exercise_id, session && session.id)?.logs.find((x) => x.set_no === n);
        const last = mine[`${it.exercise_id}:${n - 1}`];
        const src = mine[key] || prev || last;
        pickSet({ title: `${it.exercises.name} · مجموعة ${n}`, weight: src ? +src.weight : 20, reps: src ? src.reps : parseInt(it.reps) || 10, onSave: save });
      };
      [wb, rb, btn].forEach((x) => (x.onclick = open));
      if (n > it.sets) {
        const wrap = row.parentElement;
        wrap.addEventListener("gone", draw, { once: true });
        swipeToDelete(wrap, () => removeSet(it, n));
      }
    });
    main.querySelector("#finish").onclick = async () => {
      if (session) {
        const { error } = await supabase.from("workout_sessions").update({ finished_at: new Date().toISOString() }).eq("id", session.id);
        if (error) return toast("ما اتحفظش: " + error.message, true);
      }
      if (!session) { toast("ما سجّلتش أي مجموعة"); location.hash = "#myplan"; return; }
      celebrate(profile, done(), Object.values(mine), session.started_at);
    };
  }
  draw();
}

// تاريخ تمرين واحد: آخر الجلسات + رسم بسيط لأعلى وزن في كل جلسة (بيظهر لما يبقى فيه جلستين على الأقل)
export async function showHistory(exerciseId, name) {
  const dlg = document.getElementById("sheet"), form = document.getElementById("sheet-form");
  form.onsubmit = (e) => e.preventDefault();
  form.innerHTML = `<h2>تطوري في ${esc(name)}</h2><div id="hist-body">${loadingView("list")}</div>
    <div class="foot"><button class="btn btn-ghost" type="button" id="sheet-cancel">إغلاق</button></div>`;
  form.querySelector("#sheet-cancel").onclick = () => dlg.close();
  dlg.showModal();
  const { data, error } = await supabase.from("set_logs").select("*").eq("exercise_id", exerciseId)
    .order("created_at", { ascending: false }).limit(500);
  const body = form.querySelector("#hist-body");
  if (error) { body.innerHTML = `<div class="empty">${esc(error.message)}</div>`; return; }
  const sessions = [];
  data.forEach((l) => {
    let s = sessions.find((x) => x.id === l.session_id);
    if (!s) sessions.push((s = { id: l.session_id, date: l.created_at, logs: [] }));
    s.logs.push(l);
  });
  if (!sessions.length) { body.innerHTML = `<div class="empty">لسه ما سجّلتش التمرين ده.</div>`; return; }
  sessions.forEach((s) => { s.logs.sort((a, b) => a.set_no - b.set_no); s.max = Math.max(...s.logs.map((l) => +l.weight)); });
  const chron = sessions.slice(0, 12).reverse();
  const best = Math.max(...sessions.map((s) => s.max));
  const delta = sessions.length >= 2 ? sessions[0].max - sessions[sessions.length - 1].max : null;
  const tile = (v, label, cls = "") => `<div class="${cls}"><b dir="ltr">${v}</b><span>${label}</span></div>`;
  const stats = `<div class="hist-stats">${tile(w(best), "أعلى وزن (كجم)")}${tile(sessions.length, "جلسات")}${delta === null ? "" : tile((delta > 0 ? "+" : "") + w(delta), "التغيّر من أول جلسة", delta > 0 ? "up" : delta < 0 ? "down" : "")}</div>`;
  const list = sessions.slice(0, 8).map((s) => `<li><span class="hist-date">${fmtDate(s.date)}</span><span class="hist-sets">${
    s.logs.map((l) => `<span class="chip${+l.weight === s.max ? " top" : ""}" dir="ltr">${w(l.weight)} × ${l.reps}</span>`).join("")}</span></li>`).join("");
  body.innerHTML = `${stats}${sessions.length >= 2 ? chart(chron) : `<p class="legend">الرسم هيظهر بعد ما تسجّل التمرين ده في جلستين على الأقل.</p>`}<ul class="hist">${list}</ul>`;
}

// خط أعلى وزن لكل جلسة (SVG بسيط، من غير مكتبات)
function chart(ss) {
  const W = 320, H = 170, PX = 30, PT = 26, PB = 34, ys = ss.map((s) => s.max);
  const lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1, base = H - PB;
  const pts = ss.map((s, i) => [PX + (i * (W - 2 * PX)) / (ss.length - 1), base - ((s.max - lo) / span) * (base - PT)]);
  const step = Math.ceil(ss.length / 5); // تواريخ أقل لو الجلسات كتير
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="أعلى وزن في كل جلسة من ${w(lo)} إلى ${w(hi)} كجم" dir="ltr">
    <line class="grid" x1="${PX}" x2="${W - PX}" y1="${base}" y2="${base}"/><line class="grid" x1="${PX}" x2="${W - PX}" y1="${PT}" y2="${PT}"/>
    <polygon points="${pts[0][0]},${base} ${pts.map((p) => p.join(",")).join(" ")} ${pts[pts.length - 1][0]},${base}" fill="currentColor" fill-opacity=".1"/>
    <polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<circle class="dot${i === pts.length - 1 ? " last" : ""}" cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 5 : 3.5}"/><text class="val" x="${p[0]}" y="${p[1] - 10}" text-anchor="middle">${w(ss[i].max)}</text>${
      i % step === 0 || i === pts.length - 1 ? `<text class="day" x="${p[0]}" y="${H - 10}" text-anchor="middle">${fmtDate(ss[i].date)}</text>` : ""}`).join("")}</svg>`;
}

// رسالة تشجيع باسم المتدرب + ملخص التمرين، وبعدها يرجع لخطته
function celebrate(profile, sets, logs, startedAt) {
  const name = (profile.full_name || "").trim().split(/\s+/)[0] || "يا بطل";
  const msg = CHEERS[Math.floor(Math.random() * CHEERS.length)].replace("{n}", name);
  const volume = Math.round(logs.reduce((t, l) => t + l.weight * l.reps, 0));
  const mins = Math.max(1, Math.round((Date.now() - new Date(startedAt)) / 60000));
  const dlg = document.getElementById("sheet"), form = document.getElementById("sheet-form");
  form.onsubmit = (e) => { e.preventDefault(); dlg.close(); };
  form.innerHTML = `<div class="cheer"><div class="cheer-badge"><svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg></div>
    <h2>${esc(msg)}</h2>
    <div class="cheer-stats"><div><b>${sets}</b><span>مجموعة</span></div><div><b>${volume.toLocaleString("en")}</b><span>كجم إجمالي</span></div><div><b>${mins}</b><span>دقيقة</span></div></div>
    <div class="foot"><button class="btn btn-tape" type="submit">رجوع لخطتي</button></div></div>`;
  dlg.addEventListener("close", () => { location.hash = "#myplan"; }, { once: true });
  dlg.showModal();
}
