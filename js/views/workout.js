// جلسة تمرين (#workout/<dayId>): المتدرب بيسجّل وزن وعدات كل مجموعة، ويشوف أدائه السابق
import { supabase, esc } from "../supabase.js";
import { youtubeId, thumbnail, openVideo } from "../youtube.js";
import { toast, loadingView } from "../ui.js";

const fmtDate = (iso) => new Date(iso).toLocaleDateString("ar-EG-u-nu-latn", { day: "numeric", month: "short" });
const w = (n) => String(+n); // 25.00 → 25
const SAVED = `<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7"/></svg>اتحفظ`;
const CHEERS = ["برافو يا {n}! خلّصت تمرينك زي الأبطال", "عاش يا {n}! يوم تاني في الجيم وخطوة تانية لهدفك", "تمرين جامد يا {n}! الالتزام ده هو سر النتيجة", "كمّلت للآخر يا {n}! فخورين بيك"];
const setsText = (logs) => logs.map((l) => `${w(l.weight)}×${l.reps}`).join("  ·  ");

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
          return `<div class="wk-set${l ? " done" : ""}" data-ex="${it.id}" data-n="${n}">
            <span class="n">${n}</span>
            <input type="number" inputmode="decimal" step="0.5" min="0" max="1000" dir="ltr" placeholder="${p ? w(p.weight) : "كجم"}" value="${l ? w(l.weight) : ""}" aria-label="الوزن بالكجم، مجموعة ${n}">
            <input type="number" inputmode="numeric" step="1" min="0" max="200" dir="ltr" placeholder="${p ? p.reps : it.reps}" value="${l ? l.reps : ""}" aria-label="العدات، مجموعة ${n}">
            <button class="btn ${l ? "btn-ink" : "btn-tape"} btn-sm" type="button" data-save>${l ? SAVED : "سجّل"}</button></div>`;
        }).join("");
        return `<section class="panel wk-ex">
          <div class="row-title">
            ${vid ? `<button class="thumb wk-thumb" type="button" data-play="${it.id}" aria-label="شغّل فيديو ${esc(ex.name)}"><img src="${thumbnail(vid)}" alt="" loading="lazy"><span class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span></button>` : ""}
            <h3>${esc(ex.name)}</h3><span class="dose">${esc(it.sets)} <em>×</em> ${esc(it.reps)}</span>
            <button class="btn btn-ghost btn-sm" type="button" data-hist="${it.id}">تطوري</button></div>
          ${it.note ? `<p class="cues">${esc(it.note)}</p>` : ""}
          <p class="legend">${prev ? `آخر مرة (${fmtDate(prev.date)}): ${esc(setsText(prev.logs))}` : "أول مرة تسجّل التمرين ده."}</p>
          <div class="wk-head"><span>#</span><span>الوزن (كجم)</span><span>العدات</span><span></span></div>
          ${rows}
          ${count[it.id] < 20 ? `<button class="btn btn-ghost btn-sm" type="button" data-more="${it.id}">+ مجموعة</button>` : ""}
        </section>`;
      }).join("")}
      <div class="foot"><button class="btn btn-tape" type="button" id="finish">خلّصت التمرين</button></div>`;
    bind();
  }

  function bind() {
    main.querySelectorAll("[data-play]").forEach((b) => (b.onclick = () => { const it = items.find((x) => x.id == b.dataset.play); openVideo(it.exercises.youtube_url, it.exercises.name); }));
    main.querySelectorAll("[data-hist]").forEach((b) => (b.onclick = () => { const it = items.find((x) => x.id == b.dataset.hist); showHistory(it.exercise_id, it.exercises.name); }));
    main.querySelectorAll("[data-more]").forEach((b) => (b.onclick = () => { count[b.dataset.more]++; draw(); }));
    main.querySelectorAll(".wk-set").forEach((row) => {
      const it = items.find((x) => x.id == row.dataset.ex), n = +row.dataset.n, key = `${it.exercise_id}:${n}`;
      const [wi, ri] = row.querySelectorAll("input");
      row.querySelector("[data-save]").onclick = async (e) => {
        const weight = parseFloat(wi.value), reps = parseInt(ri.value);
        if (!(weight >= 0 && weight <= 1000)) return toast("اكتب الوزن (من 0 لـ 1000 كجم)", true);
        if (!(reps >= 0 && reps <= 200)) return toast("اكتب العدات (من 0 لـ 200)", true);
        const btn = e.currentTarget; btn.disabled = true;
        try {
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
          row.classList.remove("pulse"); void row.offsetWidth; row.classList.add("pulse"); // نبضة تأكيد
          main.querySelector("#wk-progress").innerHTML = `${done()} <em>من</em> ${total()} مجموعة`;
        } catch (err) { toast("ما اتحفظش: " + err.message, true); }
        btn.disabled = false;
      };
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
