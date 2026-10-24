// آراء المتدربين (للكوتش): التقييم والرأي المكتوب، وعلامة على اللي اتقرا
import { supabase, esc } from "../supabase.js";
import { toast, loadingView } from "../ui.js";

// ★★★★☆ مع نص لقارئ الشاشة
export const stars = (n) => `<span class="fb-stars" role="img" aria-label="التقييم ${n} من 5">${"★".repeat(n)}<i>${"★".repeat(5 - n)}</i></span>`;

let list = [];
let filter = "all"; // all | new | shown

// معروض فعلاً للزوار: الكوتش اختاره وصاحبه لسه موافق
const shown = (r) => r.featured && r.allow_public;

export async function renderFeedback(main, { stale }) {
  main.innerHTML = `${loadingView("list")}`;
  const { data, error } = await supabase.from("feedback").select("*, profiles(full_name,email)")
    .order("created_at", { ascending: false }).limit(300);
  if (stale()) return;
  if (error) { main.innerHTML = `<div class="empty">ما قدرناش نجيب الآراء: ${esc(error.message)}</div>`; return; }
  list = data;
  draw(main);
}

const who = (r) => r.profiles?.full_name || r.profiles?.email || "متدرب";
const fmt = (iso) => new Date(iso).toLocaleString("ar-EG", { day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" });

// زرار العرض في الرئيسية، أو سبب إنه مش متاح
function publicActs(r) {
  if (!r.allow_public) return `<span class="fb-note">صاحبه مش موافق على عرضه في الرئيسية${r.featured ? " (سحب موافقته فاتشال)" : ""}</span>`;
  return r.featured
    ? `<span class="pill coach">معروض في الرئيسية</span><button class="btn btn-ghost btn-sm" type="button" data-feature="${r.id}">شيله من الرئيسية</button>`
    : `<span class="pill active">موافق على النشر</span><button class="btn btn-ghost btn-sm" type="button" data-feature="${r.id}">اعرضه في الرئيسية</button>`;
}

function draw(main) {
  const rows = filter === "new" ? list.filter((r) => !r.coach_seen) : filter === "shown" ? list.filter(shown) : list;
  const unseen = list.filter((r) => !r.coach_seen).length;
  const avg = list.length ? (list.reduce((s, r) => s + r.rating, 0) / list.length).toLocaleString("ar-EG", { maximumFractionDigits: 1 }) : "—";

  const cards = rows.map((r) => `<article class="fb-item fb-card${r.coach_seen ? "" : " new"}">
    <div class="fb-top"><b>${esc(who(r))}</b>${stars(r.rating)}<span class="fb-date">${fmt(r.created_at)}</span></div>
    <p class="fb-msg">${esc(r.message)}</p>
    <div class="row-acts">${r.coach_seen
      ? `<span class="pill active">اتقرا</span>`
      : `<button class="btn btn-ink btn-sm" type="button" data-seen="${r.id}">تم القراءة</button>`}</div>
    <div class="row-acts fb-public">${publicActs(r)}</div>
  </article>`).join("");
  const empty = !list.length ? "لسه محدش بعت رأيه." : filter === "shown" ? "مفيش آراء معروضة في الرئيسية. اختار من الآراء اللي أصحابها موافقين." : "قريت كل الآراء.";

  main.innerHTML = `
    <div class="view-head"><div><h1>آراء المتدربين</h1><p>تقييم المتدربين ورأيهم في التدريب. كل متدرب يقدر يبعت رأي واحد في اليوم.</p></div>
      ${unseen ? `<button class="btn btn-ghost" type="button" id="seen-all">علّم الكل كمقروء</button>` : ""}</div>
    <div class="summary">
      <button type="button" data-f="all" aria-pressed="${filter === "all"}"><b>${list.length}</b><span>كل الآراء</span></button>
      <button type="button" data-f="new" aria-pressed="${filter === "new"}"><b>${unseen}</b><span>لسه ما اتقراش</span></button>
      <button type="button" data-f="shown" aria-pressed="${filter === "shown"}"><b>${list.filter(shown).length}</b><span>معروض في الرئيسية</span></button>
      <div class="stat"><b>${avg}</b><span>متوسط التقييم من ٥</span></div>
    </div>
    ${rows.length ? `<div class="fb-grid">${cards}</div>` : `<div class="empty">${empty}</div>`}`;

  main.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { filter = b.dataset.f; draw(main); }));
  main.querySelectorAll("[data-seen]").forEach((b) => (b.onclick = () => markSeen(main, list.filter((r) => r.id == b.dataset.seen))));
  main.querySelector("#seen-all")?.addEventListener("click", () => markSeen(main, list.filter((r) => !r.coach_seen)));
  main.querySelectorAll("[data-feature]").forEach((b) => (b.onclick = async () => {
    const r = list.find((x) => x.id == b.dataset.feature);
    b.disabled = true;
    const { error } = await supabase.from("feedback").update({ featured: !r.featured }).eq("id", r.id);
    b.disabled = false;
    if (error) return toast("ما اتحفظش: " + error.message, true);
    r.featured = !r.featured;
    draw(main);
    toast(r.featured ? "الرأي ظهر في الصفحة الرئيسية" : "الرأي اتشال من الصفحة الرئيسية");
  }));
}

async function markSeen(main, rows) {
  const { error } = await supabase.from("feedback").update({ coach_seen: true }).in("id", rows.map((r) => r.id));
  if (error) return toast("ما اتحفظش: " + error.message, true);
  rows.forEach((r) => (r.coach_seen = true));
  draw(main);
  toast(rows.length > 1 ? "كل الآراء اتعلّمت كمقروءة" : "اتعلّم كمقروء");
}
