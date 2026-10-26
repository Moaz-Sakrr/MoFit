// صفحة الوجبات: كل الوجبات في مكان واحد، وكل وجبة بفيديو (نفس شكل فيديوهات التمارين)، وتحته التصنيف والسعرات والوصف والمكونات
import { supabase, esc } from "../supabase.js";
import { youtubeId, thumbnail, openVideo } from "../youtube.js";
import { toast, openSheet, confirmSheet, loadingView } from "../ui.js";

export const CATEGORIES = [["breakfast", "فطار"], ["lunch", "غدا"], ["dinner", "عشا"], ["snack", "سناك"]];
const CAT_LABEL = Object.fromEntries(CATEGORIES);

let isStale = () => false; // من ctx الصفحة الحالية، عشان أي حفظ بيخلص بعد ما المستخدم يمشي ما يرسمش فوق الصفحة الجديدة
let list = [];
let loadError = null;

const kcal = (n) => Number(n).toLocaleString("ar-EG");
// المكونات بيظهر منها أول اتنين، والباقي ورا زرار عشان الكارت ما ياخدش مساحة كبيرة
const SHOWN_ING = 2;
const CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
const lines = (t) => (t || "").split("\n").map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);

export async function renderMeals(main, { isCoach, stale }) {
  isStale = stale;
  main.innerHTML = `${loadingView("cards")}`;
  const { data, error } = await supabase.from("meals").select("*").order("sort").order("id");
  if (stale()) return;
  loadError = error ? error.message : null;
  list = data || [];
  draw(main, isCoach);
}

function draw(main, isCoach) {
  if (isStale()) return;
  const cards = list.map((m) => {
    const vid = youtubeId(m.youtube_url);
    const thumb = vid
      ? `<button class="thumb" type="button" data-play="${m.id}" aria-label="شغّل فيديو ${esc(m.name)}">
           <img src="${thumbnail(vid)}" alt="" loading="lazy">
           <span class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span></button>`
      : `<div class="thumb none">من غير فيديو</div>`;
    const ing = lines(m.ingredients);
    return `<li class="meal">
      ${thumb}
      <div class="meal-body">
        ${CAT_LABEL[m.category] ? `<span class="meal-cat">${CAT_LABEL[m.category]}</span>` : ""}
        <div class="row-title"><h3>${esc(m.name)}</h3>${m.calories != null ? `<span class="dose">${kcal(m.calories)} <em>سعرة</em></span>` : ""}</div>
        ${m.description ? `<p class="meal-desc">${esc(m.description)}</p>` : ""}
        ${ing.length ? `<h4 class="meal-h">المكونات</h4><ul class="meal-ing" id="ing-${m.id}">${ing.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
          ${ing.length > SHOWN_ING ? `<button class="ing-more" type="button" aria-expanded="false" aria-controls="ing-${m.id}" data-more="${ing.length - SHOWN_ING}"><span>باقي المكونات (${kcal(ing.length - SHOWN_ING)})</span>${CHEVRON}</button>` : ""}` : ""}
      </div>
      ${isCoach ? `<div class="row-acts"><button class="btn btn-ink btn-sm" type="button" data-edit="${m.id}">تعديل</button><button class="btn btn-ghost btn-sm" type="button" data-del="${m.id}">حذف</button></div>` : ""}
    </li>`;
  }).join("");

  const empty = isCoach ? "لسه مفيش وجبات. اضغط «إضافة وجبة»." : "لسه مفيش وجبات.";

  main.innerHTML = `
    <div class="view-head"><div><h1>الوجبات</h1><p>${isCoach
      ? "ضيف الوجبات بفيديو الطبخ من يوتيوب، واختار تصنيفها، واكتب السعرات والمكونات. المتدربين المفعّلين بيشوفوها كلها."
      : "وجبات من الكوتش. اضغط على الصورة عشان تشوف طريقة التحضير، وتحتها السعرات والمكونات."}</p></div>
      ${isCoach ? `<button class="btn btn-tape" type="button" id="add-meal">إضافة وجبة</button>` : ""}</div>
    ${loadError
      ? `<div class="empty">ما قدرناش نجيب الوجبات: ${esc(loadError)}</div>`
      : list.length ? `<ul class="meal-grid">${cards}</ul>` : `<div class="empty">${empty}</div>`}`;

  main.querySelectorAll(".ing-more").forEach((b) => (b.onclick = () => {
    const open = main.querySelector("#" + b.getAttribute("aria-controls")).classList.toggle("open");
    b.setAttribute("aria-expanded", open);
    b.querySelector("span").textContent = open ? "إخفاء" : `باقي المكونات (${kcal(b.dataset.more)})`;
  }));
  main.querySelectorAll("[data-play]").forEach((b) => (b.onclick = () => {
    const m = list.find((x) => x.id == b.dataset.play);
    openVideo(m.youtube_url, m.name);
  }));
  if (!isCoach) return;
  main.querySelector("#add-meal").onclick = () => editMeal(main, null);
  main.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editMeal(main, list.find((x) => x.id == b.dataset.edit))));
  main.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    const m = list.find((x) => x.id == b.dataset.del);
    confirmSheet(`حذف «${m.name}»؟`, "الوجبة هتتشال من عند كل المتدربين.", async () => {
      const { error } = await supabase.from("meals").delete().eq("id", m.id);
      if (error) throw error;
      list = list.filter((x) => x.id !== m.id);
      draw(main, isCoach); toast("الوجبة اتحذفت");
    });
  }));
}

function editMeal(main, m) {
  openSheet({
    title: m ? "تعديل الوجبة" : "وجبة جديدة",
    values: m ? { ...m, calories: m.calories ?? "" } : { category: "lunch", sort: list.length + 1 },
    fields: [
      { k: "name", label: "اسم الوجبة", required: true },
      { k: "category", label: "تصنيف الوجبة", type: "select", options: CATEGORIES },
      { k: "youtube_url", label: "لينك فيديو الطبخ على يوتيوب", ltr: true, ph: "https://youtu.be/...", hint: "ينفع لينك عادي أو Shorts، زي فيديوهات التمارين" },
      { k: "calories", label: "عدد السعرات", type: "number", ph: "450" },
      { k: "ingredients", label: "المكونات", type: "textarea", tall: true, ph: "٢٠٠ جرام صدور فراخ\nكوب رز بسمتي\nملعقة زيت زيتون", hint: "كل مكون في سطر لوحده بالكمية بتاعته" },
      { k: "description", label: "وصف الوجبة", type: "textarea", hint: "اختياري. مثلاً طريقة التحضير أو إمتى تتاكل" },
      { k: "sort", label: "الترتيب", type: "number", hint: "الرقم الأصغر يظهر الأول" },
    ],
    async onSave(v) {
      if (v.youtube_url && !youtubeId(v.youtube_url)) throw new Error("لينك اليوتيوب مش صح. انسخه من زرار Share في يوتيوب.");
      const calories = v.calories === "" ? null : Number(v.calories);
      if (calories !== null && !(Number.isInteger(calories) && calories >= 0 && calories <= 10000)) throw new Error("عدد السعرات لازم يبقى رقم صحيح من 0 لـ 10000.");
      const row = { name: v.name, category: v.category, calories, youtube_url: v.youtube_url, description: v.description, ingredients: v.ingredients, sort: parseInt(v.sort) || 0 };
      const q = m ? supabase.from("meals").update(row).eq("id", m.id) : supabase.from("meals").insert(row);
      const { data, error } = await q.select().single();
      if (error) throw error;
      if (m) Object.assign(m, data); else list.push(data);
      list.sort((a, b) => a.sort - b.sort || a.id - b.id);
      loadError = null;
      draw(main, true);
      toast(m ? "الوجبة اتعدّلت" : "الوجبة اتضافت");
    },
  });
}
