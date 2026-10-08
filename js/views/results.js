// نتايج المشتركين (صور قبل وبعد): الكوتش يضيف ويعدّل ويحذف، والصفحة الرئيسية بتعرضهم
import { supabase, esc } from "../supabase.js";
import { toast, openSheet, confirmSheet } from "../ui.js";
import { compressImage } from "../images.js";

const BUCKET = "results";
let list = [];

export async function renderResults(main, { stale }) {
  main.innerHTML = `<p class="loading">بيحمّل النتايج…</p>`;
  const { data, error } = await supabase.from("results").select("*").order("sort").order("id");
  if (stale()) return;
  if (error) { main.innerHTML = `<div class="empty">ما قدرناش نجيب النتايج: ${esc(error.message)}</div>`; return; }
  list = data;
  draw(main);
}

async function upload(file) {
  const blob = await compressImage(file);
  const path = crypto.randomUUID() + ".jpg";
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// الصور القديمة اللي في فولدر images/ مش في المخزن، فنتجاهلها عند الحذف
async function removeFiles(urls) {
  const paths = urls.map((u) => (u.match(/\/object\/public\/results\/(.+)$/) || [])[1]).filter(Boolean).map(decodeURIComponent);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
}

function draw(main) {
  const cards = list.map((r) => `<article class="res-admin">
    <div class="pair-img"><figure><img src="${esc(r.before_url)}" alt="قبل" loading="lazy"><figcaption>قبل</figcaption></figure>
      <figure><img src="${esc(r.after_url)}" alt="بعد" loading="lazy"><figcaption>بعد</figcaption></figure></div>
    <h3>${esc(r.title || "من غير اسم")}</h3><p>${esc(r.goal)}</p>
    <div class="row-acts"><button class="btn btn-ink btn-sm" type="button" data-edit="${r.id}">تعديل</button><button class="btn btn-ghost btn-sm" type="button" data-del="${r.id}">حذف</button></div>
  </article>`).join("");

  main.innerHTML = `
    <div class="view-head"><div><h1>نتايج المشتركين</h1><p>الصور دي بتظهر في الصفحة الرئيسية للموقع. أي تغيير بيظهر على طول.</p></div>
      <button class="btn btn-tape" type="button" id="add-res">إضافة نتيجة</button></div>
    ${list.length ? `<div class="res-admin-grid">${cards}</div>` : `<div class="empty">لسه مفيش نتايج.</div>`}`;

  main.querySelector("#add-res").onclick = () => edit(main, null);
  main.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => edit(main, list.find((x) => x.id == b.dataset.edit))));
  main.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    const r = list.find((x) => x.id == b.dataset.del);
    confirmSheet(`حذف «${r.title || "النتيجة"}»؟`, "النتيجة هتتشال من الصفحة الرئيسية.", async () => {
      const { error } = await supabase.from("results").delete().eq("id", r.id);
      if (error) throw error;
      await removeFiles([r.before_url, r.after_url]).catch(() => {});
      list = list.filter((x) => x.id !== r.id); draw(main); toast("النتيجة اتحذفت");
    });
  }));
}

function edit(main, r) {
  const keep = r ? "سيبها فاضية لو مش عايز تغيّرها" : "";
  openSheet({
    title: r ? "تعديل النتيجة" : "نتيجة جديدة",
    values: r || { sort: list.length + 1 },
    fields: [
      { k: "title", label: "الاسم", ph: "مثلاً: أحمد" },
      { k: "goal", label: "الهدف", ph: "تنشيف أو تضخيم" },
      { k: "before", label: "صورة قبل", type: "file", required: !r, hint: keep },
      { k: "after", label: "صورة بعد", type: "file", required: !r, hint: keep },
      { k: "sort", label: "الترتيب", type: "number", hint: "الرقم الأصغر يظهر الأول" },
    ],
    async onSave(v) {
      const uploaded = [], replaced = [];
      try {
        const row = { title: v.title, goal: v.goal, sort: parseInt(v.sort) || 0 };
        if (v.before) { row.before_url = await upload(v.before); uploaded.push(row.before_url); if (r) replaced.push(r.before_url); }
        if (v.after) { row.after_url = await upload(v.after); uploaded.push(row.after_url); if (r) replaced.push(r.after_url); }
        const q = r ? supabase.from("results").update(row).eq("id", r.id) : supabase.from("results").insert(row);
        const { data, error } = await q.select().single();
        if (error) throw error;
        if (r) Object.assign(r, data); else list.push(data);
        list.sort((a, b) => a.sort - b.sort || a.id - b.id);
        await removeFiles(replaced).catch(() => {});
        draw(main); toast(r ? "النتيجة اتعدّلت" : "النتيجة اتضافت");
      } catch (err) {
        await removeFiles(uploaded).catch(() => {});
        throw err;
      }
    },
  });
}
