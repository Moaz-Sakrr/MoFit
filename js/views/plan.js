// خطة التمرين الشخصية: الكوتش بيبنيها لكل متدرب (#plan/<id>)، والمتدرب بيشوفها في "خطتي" (#myplan)
import { supabase, esc } from "../supabase.js";
import { youtubeId, thumbnail, openVideo } from "../youtube.js";
import { toast, openSheet, confirmSheet, loadingView } from "../ui.js";
import { MUSCLES } from "./exercises.js";
import { showHistory } from "./workout.js";

const bySort = (a, b) => a.sort - b.sort || a.id - b.id;
const PLAN_SELECT = "*, workout_days(*, workout_items(*, exercises(id,name,muscle,cues,youtube_url)))";

async function loadPlan(memberId) {
  const { data, error } = await supabase.from("workout_plans").select(PLAN_SELECT).eq("member_id", memberId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  data.workout_days.sort(bySort).forEach((d) => d.workout_items.sort(bySort));
  return data;
}

function itemRow(it, acts = "") {
  const ex = it.exercises;
  const vid = ex && youtubeId(ex.youtube_url);
  const thumb = vid
    ? `<button class="thumb" type="button" data-play="${it.id}" aria-label="شغّل فيديو ${esc(ex.name)}"><img src="${thumbnail(vid)}" alt="" loading="lazy"><span class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span></button>`
    : `<div class="thumb none">من غير فيديو</div>`;
  return `<li class="xcard">${thumb}<div class="xcard-body">
    <h3>${esc(ex ? ex.name : "تمرين اتحذف من المكتبة")}</h3>
    <div class="xcard-dose"><span><b>${esc(it.sets)}</b> مجموعات</span><span><b dir="ltr">${esc(it.reps)}</b> عدّة</span></div>
    ${it.note ? `<p>${esc(it.note)}</p>` : ""}</div>${acts ? `<div class="xcard-acts">${acts}</div>` : ""}</li>`;
}

function bindPlay(main, items) {
  main.querySelectorAll("[data-play]").forEach((b) => (b.onclick = () => {
    const it = items.find((x) => x.id == b.dataset.play);
    openVideo(it.exercises.youtube_url, it.exercises.name);
  }));
}

/* ---------- المتدرب ---------- */
let dayIdx = 0;

export async function renderMyPlan(main, { profile, stale }) {
  main.innerHTML = loadingView("rows");
  let plan;
  try { plan = await loadPlan(profile.id); } catch (e) { if (!stale()) main.innerHTML = `<div class="empty">ما قدرناش نجيب الخطة: ${esc(e.message)}</div>`; return; }
  if (stale()) return;
  if (!plan || !plan.workout_days.length) {
    main.innerHTML = `<div class="view-head"><div><h1>خطتي</h1></div></div><div class="empty">الكوتش لسه ما جهّزلكش خطة. أول ما يجهزها هتظهر هنا.</div>`;
    return;
  }
  const days = plan.workout_days;
  if (dayIdx >= days.length) dayIdx = 0;
  const day = days[dayIdx];
  const items = day.workout_items;
  main.innerHTML = `
    <div class="view-head"><div><h1>${esc(plan.name)}</h1><p>اختار اليوم، وشوف التمارين والفيديوهات، واضغط «ابدأ التمرين» عشان تسجّل الأوزان.</p></div>
      ${items.length ? `<a class="btn btn-tape" href="#workout/${day.id}">ابدأ التمرين</a>` : ""}</div>
    <div class="index" role="tablist">${days.map((d, i) => `<button class="mt" role="tab" type="button" data-day="${i}" aria-selected="${i === dayIdx}">${esc(d.name)}</button>`).join("")}</div>
    ${items.length ? `<ul class="rows xcards">${items.map((it) => itemRow(it, it.exercise_id ? `<button class="btn btn-ghost btn-sm" type="button" data-hist="${it.id}">تطوري</button>` : "")).join("")}</ul>` : `<div class="empty gap-top">اليوم ده لسه مفيهوش تمارين.</div>`}`;
  main.querySelectorAll("[data-day]").forEach((b) => (b.onclick = () => { dayIdx = +b.dataset.day; renderMyPlan(main, { profile, stale }); }));
  main.querySelectorAll("[data-hist]").forEach((b) => (b.onclick = () => {
    const it = items.find((x) => x.id == b.dataset.hist);
    showHistory(it.exercise_id, it.exercises.name);
  }));
  bindPlay(main, items);
}

/* ---------- الكوتش ---------- */
let ctxC;

export async function renderPlanBuilder(main, ctx, memberId) {
  ctxC = ctx;
  main.innerHTML = loadingView("rows");
  await draw(main, memberId);
}

async function draw(main, memberId) {
  let member, plan, exercises;
  try {
    const [m, p, e] = await Promise.all([
      supabase.from("profiles").select("id,full_name,email").eq("id", memberId).maybeSingle(),
      loadPlan(memberId),
      supabase.from("exercises").select("id,name,muscle").order("muscle").order("sort").order("id"),
    ]);
    if (m.error) throw m.error; if (e.error) throw e.error;
    member = m.data; plan = p; exercises = e.data;
  } catch (err) { if (!ctxC.stale()) main.innerHTML = `<div class="empty">ما قدرناش نجيب الخطة: ${esc(err.message)}</div>`; return; }
  if (ctxC.stale()) return;
  if (!member) { main.innerHTML = `<div class="empty">المتدرب ده مش موجود. <a href="#members">رجوع للمتدربين</a></div>`; return; }

  const name = member.full_name || member.email;
  const reload = () => draw(main, memberId);
  const head = `<div class="view-head"><div><h1>خطة ${esc(name)}</h1><p><a href="#members">← رجوع للمتدربين</a></p></div>
    ${plan ? `<button class="btn btn-tape" type="button" id="add-day">يوم جديد</button>` : ""}</div>`;

  if (!plan) {
    main.innerHTML = `${head}<div class="empty">المتدرب ده معندوش خطة لسه.<br><br><button class="btn btn-tape" type="button" id="new-plan">إنشاء خطة</button></div>`;
    main.querySelector("#new-plan").onclick = async () => {
      const { error } = await supabase.from("workout_plans").insert({ member_id: memberId, name: `خطة ${name}` });
      if (error) return toast("ما اتحفظش: " + error.message, true);
      toast("الخطة اتعملت"); reload();
    };
    return;
  }

  const days = plan.workout_days;
  const allItems = days.flatMap((d) => d.workout_items);
  main.innerHTML = `${head}
    ${days.length ? days.map((d, di) => `<section class="panel plan-day" data-day="${d.id}">
      <div class="view-head"><h2>${esc(d.name)}</h2><div class="row-acts">
        <button class="btn btn-ghost btn-sm" type="button" data-dmove="-1" aria-label="فوق"${di === 0 ? " disabled" : ""}>▲</button>
        <button class="btn btn-ghost btn-sm" type="button" data-dmove="1" aria-label="تحت"${di === days.length - 1 ? " disabled" : ""}>▼</button>
        <button class="btn btn-ink btn-sm" type="button" data-dedit>تسمية</button>
        <button class="btn btn-ghost btn-sm" type="button" data-ddel>حذف اليوم</button></div></div>
      ${d.workout_items.length ? `<ul class="rows xcards">${d.workout_items.map((it, ii) => itemRow(it, `
        <button class="btn btn-ghost btn-sm" type="button" data-imove="-1" data-item="${it.id}" aria-label="فوق"${ii === 0 ? " disabled" : ""}>▲</button>
        <button class="btn btn-ghost btn-sm" type="button" data-imove="1" data-item="${it.id}" aria-label="تحت"${ii === d.workout_items.length - 1 ? " disabled" : ""}>▼</button>
        <button class="btn btn-ink btn-sm" type="button" data-iedit="${it.id}">تعديل</button>
        <button class="btn btn-ghost btn-sm" type="button" data-idel="${it.id}">حذف</button>`)).join("")}</ul>` : `<div class="empty">اليوم ده فاضي. ضيف تمرين.</div>`}
      <div><button class="btn btn-tape btn-sm" type="button" data-iadd>إضافة تمرين</button></div>
    </section>`).join("") : `<div class="empty">لسه مفيش أيام. اضغط «يوم جديد» وابدأ (مثلاً: دفع، سحب، أرجل).</div>`}`;

  const fail = (error) => toast("ما اتحفظش: " + error.message, true);
  // بدّل ترتيب عنصرين (بنبدّل قيمة sort بينهم)
  const swap = async (table, rows, i, dir) => {
    const a = rows[i], b = rows[i + dir];
    if (!b) return;
    const r1 = await supabase.from(table).update({ sort: b.sort }).eq("id", a.id);
    const r2 = await supabase.from(table).update({ sort: a.sort }).eq("id", b.id);
    if (r1.error || r2.error) return fail(r1.error || r2.error);
    reload();
  };
  const nextSort = (rows) => rows.reduce((m, r) => Math.max(m, r.sort), 0) + 1;

  const addDay = main.querySelector("#add-day");
  if (addDay) addDay.onclick = () => openSheet({
    title: "يوم جديد", fields: [{ k: "name", label: "اسم اليوم", required: true, ph: "دفع" }],
    async onSave(v) {
      const { error } = await supabase.from("workout_days").insert({ plan_id: plan.id, name: v.name, sort: nextSort(days) });
      if (error) throw error; toast("اليوم اتضاف"); reload();
    },
  });

  main.querySelectorAll(".plan-day").forEach((sec) => {
    const di = days.findIndex((d) => d.id == sec.dataset.day), day = days[di];
    sec.querySelectorAll("[data-dmove]").forEach((b) => (b.onclick = () => swap("workout_days", days, di, +b.dataset.dmove)));
    sec.querySelector("[data-dedit]").onclick = () => openSheet({
      title: "تسمية اليوم", values: day, fields: [{ k: "name", label: "اسم اليوم", required: true }],
      async onSave(v) {
        const { error } = await supabase.from("workout_days").update({ name: v.name }).eq("id", day.id);
        if (error) throw error; toast("الاسم اتغيّر"); reload();
      },
    });
    sec.querySelector("[data-ddel]").onclick = () => confirmSheet(`حذف «${day.name}»؟`, "اليوم وتمارينه هيتشالوا من الخطة. سجل تمارين المتدرب السابق هيفضل زي ما هو.", async () => {
      const { error } = await supabase.from("workout_days").delete().eq("id", day.id);
      if (error) throw error; toast("اليوم اتحذف"); reload();
    });
    sec.querySelector("[data-iadd]").onclick = () => editItem(day, null);
    sec.querySelectorAll("[data-imove]").forEach((b) => (b.onclick = () => {
      const rows = day.workout_items; swap("workout_items", rows, rows.findIndex((x) => x.id == b.dataset.item), +b.dataset.imove);
    }));
    sec.querySelectorAll("[data-iedit]").forEach((b) => (b.onclick = () => editItem(day, day.workout_items.find((x) => x.id == b.dataset.iedit))));
    sec.querySelectorAll("[data-idel]").forEach((b) => (b.onclick = () => {
      const it = day.workout_items.find((x) => x.id == b.dataset.idel);
      confirmSheet("حذف التمرين من اليوم؟", "سجل أوزان المتدرب السابق للتمرين ده هيفضل محفوظ.", async () => {
        const { error } = await supabase.from("workout_items").delete().eq("id", it.id);
        if (error) throw error; toast("التمرين اتشال"); reload();
      });
    }));
  });
  bindPlay(main, allItems);

  const muscleName = Object.fromEntries(MUSCLES);
  function editItem(day, it) {
    if (!exercises.length) return toast("ضيف تمارين في مكتبة التمارين الأول", true);
    openSheet({
      title: it ? "تعديل التمرين" : "إضافة تمرين",
      values: it || { sets: 3, reps: "8-12" },
      fields: [
        { k: "exercise_id", label: "التمرين (من مكتبة التمارين)", type: "select", options: exercises.map((e) => [e.id, `${muscleName[e.muscle] || ""} · ${e.name}`]) },
        { k: "sets", label: "عدد المجموعات", type: "number", required: true },
        { k: "reps", label: "العدات", required: true, ph: "8-12", hint: "رقم واحد أو مدى، مثلاً 10 أو 8-12" },
        { k: "note", label: "ملاحظة للمتدرب (اختياري)", type: "textarea" },
      ],
      async onSave(v) {
        const sets = parseInt(v.sets);
        if (!(sets >= 1 && sets <= 20)) throw new Error("عدد المجموعات لازم يبقى من 1 لـ 20");
        if (!v.reps || v.reps.length > 20) throw new Error("اكتب العدات (لحد 20 حرف)");
        const row = { exercise_id: +v.exercise_id, sets, reps: v.reps, note: v.note || null };
        const q = it ? supabase.from("workout_items").update(row).eq("id", it.id)
          : supabase.from("workout_items").insert({ ...row, day_id: day.id, sort: nextSort(day.workout_items) });
        const { error } = await q;
        if (error) throw error; toast(it ? "التمرين اتعدّل" : "التمرين اتضاف"); reload();
      },
    });
  }
}
