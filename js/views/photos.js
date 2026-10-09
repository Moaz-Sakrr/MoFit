// صوري: المتدرب يرفع صوره أول الشهر وآخره، ويقرر هل المدرب يقدر يستخدمها في نتايج المشتركين
import { supabase, esc, today } from "../supabase.js";
import { toast, openSheet, confirmSheet, loadingView } from "../ui.js";
import { compressImage } from "../images.js";
import { memberStatus } from "./members.js";

export const BUCKET = "progress-photos";
export const PERIOD_LABEL = { start: "أول الشهر", end: "آخر الشهر" };
export const monthLabel = (m) => new Date(m + "T00:00:00").toLocaleDateString("ar-EG", { month: "long", year: "numeric" });

// روابط مؤقتة للصور (المخزن خاص): {path: url}
export async function signPaths(paths) {
  if (!paths.length) return {};
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
  if (error) throw error;
  return Object.fromEntries(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

let list = [];
let urls = {};

export async function renderPhotos(main, ctx) {
  main.innerHTML = `${loadingView("cards")}`;
  const { data, error } = await supabase.from("progress_photos").select("*").eq("member_id", ctx.profile.id)
    .order("month", { ascending: false }).order("created_at", { ascending: false });
  if (ctx.stale()) return;
  if (error) { main.innerHTML = `<div class="empty">ما قدرناش نجيب صورك: ${esc(error.message)}</div>`; return; }
  list = data;
  try { urls = await signPaths(list.flatMap((r) => r.paths)); } catch { urls = {}; }
  if (ctx.stale()) return;
  draw(main, ctx);
}

function draw(main, ctx) {
  const canUpload = ["active", "soon"].includes(memberStatus(ctx.profile));
  const byMonth = new Map();
  list.forEach((r) => byMonth.set(r.month, [...(byMonth.get(r.month) || []), r]));

  const body = [...byMonth].map(([month, rows]) => `<section class="ph-month"><h2>${esc(monthLabel(month))}</h2>
    <div class="ph-list">${rows.map((r) => `<article class="ph-entry">
      <div class="ph-head"><b>${PERIOD_LABEL[r.period]}</b></div>
      <div class="ph-imgs">${r.paths.map((p) => urls[p]
        ? `<a href="${esc(urls[p])}" target="_blank" rel="noopener"><img src="${esc(urls[p])}" alt="${PERIOD_LABEL[r.period]}" loading="lazy"></a>`
        : `<span class="ph-miss">الصورة مش متاحة</span>`).join("")}</div>
      <label class="ph-consent"><input type="checkbox" data-allow="${r.id}"${r.allow_public ? " checked" : ""}><span>أسمح للمدرب باستخدام الصور دي في نتايج المشتركين</span></label>
      <div class="row-acts"><button class="btn btn-ghost btn-sm" type="button" data-del="${r.id}">حذف</button></div>
    </article>`).join("")}</div></section>`).join("");

  main.innerHTML = `
    <div class="view-head"><div><h1>صوري</h1><p>ارفع صورك أول الشهر وآخره عشان المدرب يتابع تقدمك. صورك خاصة، المدرب بس هو اللي بيشوفها.</p></div>
      ${canUpload ? `<button class="btn btn-tape" type="button" id="add-ph">رفع صور</button>` : ""}</div>
    ${canUpload ? "" : `<p class="notice bad">اشتراكك مش مفعّل، فمش هتقدر ترفع صور جديدة. تقدر تشوف صورك وتحذفها.</p>`}
    <p class="notice">قرارك باستخدام صورك في الموقع بيظهر للمدرب بس، وتقدر تغيّره في أي وقت. لو المدرب نشرها قبل ما تسحب موافقتك، كلّمه عشان يشيلها.</p>
    ${list.length ? body : `<div class="empty">لسه ما رفعتش صور.</div>`}`;

  main.querySelector("#add-ph")?.addEventListener("click", () => add(main, ctx));
  main.querySelectorAll("[data-allow]").forEach((c) => (c.onchange = async () => {
    const r = list.find((x) => x.id == c.dataset.allow);
    c.disabled = true;
    const { error } = await supabase.from("progress_photos").update({ allow_public: c.checked }).eq("id", r.id);
    c.disabled = false;
    if (error) { c.checked = r.allow_public; toast("ما اتحفظش: " + error.message, true); return; }
    r.allow_public = c.checked;
    toast(c.checked ? "تمام، المدرب يقدر يستخدم الصور دي" : "المدرب مش هيقدر يستخدمها");
  }));
  main.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    const r = list.find((x) => x.id == b.dataset.del);
    confirmSheet("حذف الصور دي؟", `هتتحذف صور ${PERIOD_LABEL[r.period]} (${monthLabel(r.month)}) نهائياً.`, async () => {
      const { error } = await supabase.from("progress_photos").delete().eq("id", r.id);
      if (error) throw error;
      await supabase.storage.from(BUCKET).remove(r.paths).catch(() => {});
      list = list.filter((x) => x.id !== r.id); draw(main, ctx); toast("الصور اتحذفت");
    });
  }));
}

function add(main, ctx) {
  openSheet({
    title: "رفع صور جديدة",
    saveLabel: "رفع",
    fields: [
      { k: "period", label: "الصور دي بتاعة", type: "select", options: [["start", "أول الشهر"], ["end", "آخر الشهر"]] },
      { k: "files", label: "الصور", type: "file", multiple: true, required: true, hint: "من 1 لـ 3 صور (مثلاً من قدام وجنب وورا)" },
      { k: "allow", label: "أسمح للمدرب باستخدام الصور دي في نتايج المشتركين", type: "checkbox", hint: "اختياري. القرار ده بيظهر للمدرب بس، وفي كل الحالات المدرب بيشوف الصور للمتابعة." },
    ],
    async onSave(v) {
      if (!v.files.length || v.files.length > 3) throw new Error("اختار من 1 لـ 3 صور");
      const uploaded = [];
      try {
        for (const f of v.files) {
          const path = `${ctx.profile.id}/${crypto.randomUUID()}.jpg`;
          const { error } = await supabase.storage.from(BUCKET).upload(path, await compressImage(f, 1600, 0.85), { contentType: "image/jpeg" });
          if (error) throw error;
          uploaded.push(path);
        }
        const month = today().slice(0, 7) + "-01";
        const { data, error } = await supabase.from("progress_photos")
          .insert({ member_id: ctx.profile.id, period: v.period, month, paths: uploaded, allow_public: v.allow })
          .select().single();
        if (error) throw error;
        list.unshift(data);
        list.sort((a, b) => b.month.localeCompare(a.month) || b.created_at.localeCompare(a.created_at));
        urls = { ...urls, ...(await signPaths(uploaded).catch(() => ({}))) };
        draw(main, ctx); toast("الصور اترفعت");
      } catch (err) {
        if (uploaded.length) await supabase.storage.from(BUCKET).remove(uploaded).catch(() => {});
        throw err;
      }
    },
  });
}
