// صفحة جداول التمرين
import { supabase, esc } from "../supabase.js";
import { toast, openSheet, confirmSheet } from "../ui.js";

const LEVELS = { 1: "مبتدئ", 2: "متوسط", 3: "متقدم" };
let list = [];

export async function renderPrograms(main, { isCoach, stale }) {
  main.innerHTML = `<p class="loading">بيحمّل الجداول…</p>`;
  const { data, error } = await supabase.from("programs").select("*").order("sort").order("id");
  if (stale()) return;
  if (error) { main.innerHTML = `<div class="empty">ما قدرناش نجيب الجداول: ${esc(error.message)}</div>`; return; }
  list = data;
  draw(main, isCoach);
}

// 90 → 90s ، 120 → 2m
const rest = (r) => { const n = +r; if (!r) return ""; if (isNaN(n)) return r; return n >= 60 && n % 30 === 0 ? `${n / 60}m` : `${n}s`; };

function draw(main, isCoach) {
  const cards = list.map((p) => `<article class="prog">
    <div class="lvl"><span class="plate l${p.level}"><i></i>${LEVELS[p.level] || ""}</span>${p.weeks ? `<span>${esc(p.weeks)} أسابيع</span>` : ""}${p.per_week ? `<span>${esc(p.per_week)} أيام في الأسبوع</span>` : ""}</div>
    <h3>${esc(p.name)}</h3>
    ${(p.days || []).map((d) => `<div class="day"><h4>${esc(d.name)}</h4><table class="sets"><tbody>
      ${d.items.map((i) => `<tr><td>${esc(i.ex)}</td><td class="n">${esc(i.sets)} × ${esc(i.reps)}${i.rest ? "  ·  " + esc(rest(i.rest)) : ""}</td></tr>`).join("")}
    </tbody></table></div>`).join("")}
    ${isCoach ? `<div class="row-acts"><button class="btn btn-ink btn-sm" type="button" data-edit="${p.id}">تعديل</button><button class="btn btn-ghost btn-sm" type="button" data-del="${p.id}">حذف</button></div>` : ""}
  </article>`).join("");

  main.innerHTML = `
    <div class="view-head"><div><h1>جداول التمرين</h1><p>امشي على الجدول اللي يناسب مستواك، وزوّد الوزن لما تكمّل أعلى عدد عدات في كل المجموعات.</p></div>
      ${isCoach ? `<button class="btn btn-tape" type="button" id="add-prog">جدول جديد</button>` : ""}</div>
    ${list.length ? `<div class="prog-grid">${cards}</div><p class="legend">الأرقام: المجموعات × العدات، وبعدها الراحة بين المجموعات (s ثانية، m دقيقة).</p>` : `<div class="empty">لسه مفيش جداول.</div>`}`;

  if (!isCoach) return;
  main.querySelector("#add-prog").onclick = () => editProgram(main, null);
  main.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editProgram(main, list.find((x) => x.id == b.dataset.edit))));
  main.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    const p = list.find((x) => x.id == b.dataset.del);
    confirmSheet(`حذف «${p.name}»؟`, "الجدول هيتشال من عند كل المتدربين.", async () => {
      const { error } = await supabase.from("programs").delete().eq("id", p.id);
      if (error) throw error;
      list = list.filter((x) => x.id !== p.id); draw(main, true); toast("الجدول اتحذف");
    });
  }));
}

/* الكوتش بيكتب أيام الجدول كنص بالشكل ده:
   # دفع
   بنش برس | 4 | 8 | 90
   رفرفة جانبي | 3 | 12 | 60
*/
const daysToText = (days) => (days || []).map((d) => "# " + d.name + "\n" + d.items.map((i) => [i.ex, i.sets, i.reps, i.rest].join(" | ")).join("\n")).join("\n\n");
function textToDays(t) {
  const out = []; let cur = null;
  t.split("\n").forEach((line) => {
    line = line.trim(); if (!line) return;
    if (line.startsWith("#")) { cur = { name: line.replace(/^#+\s*/, ""), items: [] }; out.push(cur); return; }
    if (!cur) { cur = { name: "اليوم الأول", items: [] }; out.push(cur); }
    const [ex = "", sets = "", reps = "", r = ""] = line.split("|").map((s) => s.trim());
    cur.items.push({ ex, sets, reps, rest: r });
  });
  return out;
}

function editProgram(main, p) {
  openSheet({
    title: p ? "تعديل الجدول" : "جدول جديد",
    values: p ? { ...p, days: daysToText(p.days) } : { level: 1, sort: 0, days: "# اليوم الأول\nسكوات بالبار | 4 | 8 | 120" },
    fields: [
      { k: "name", label: "اسم الجدول", required: true },
      { k: "level", label: "المستوى", type: "select", options: [[1, "مبتدئ"], [2, "متوسط"], [3, "متقدم"]] },
      { k: "weeks", label: "عدد الأسابيع" },
      { k: "per_week", label: "أيام التمرين في الأسبوع" },
      { k: "days", label: "أيام التمرين", type: "textarea", tall: true, hint: "كل يوم يبدأ بسطر فيه # واسم اليوم. وكل تمرين في سطر: الاسم | المجموعات | العدات | الراحة بالثواني" },
      { k: "sort", label: "الترتيب", type: "number" },
    ],
    async onSave(v) {
      const row = { name: v.name, level: +v.level, weeks: v.weeks, per_week: v.per_week, days: textToDays(v.days), sort: parseInt(v.sort) || 0 };
      const q = p ? supabase.from("programs").update(row).eq("id", p.id) : supabase.from("programs").insert(row);
      const { data, error } = await q.select().single();
      if (error) throw error;
      if (p) Object.assign(p, data); else list.push(data);
      draw(main, true); toast(p ? "الجدول اتعدّل" : "الجدول اتضاف");
    },
  });
}
