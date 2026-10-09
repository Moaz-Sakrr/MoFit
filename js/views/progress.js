// صور المتدربين (للكوتش): كل الصور للمتابعة، وعلامة على اللي وافق صاحبها يستخدمها في الموقع
import { supabase, esc } from "../supabase.js";
import { toast, loadingView } from "../ui.js";
import { BUCKET, PERIOD_LABEL, monthLabel, signPaths } from "./photos.js";

let list = [];
let urls = {};
let onlyAllowed = false;

export async function renderProgress(main, { stale }) {
  main.innerHTML = `${loadingView("cards")}`;
  const { data, error } = await supabase.from("progress_photos").select("*, profiles(full_name,email)")
    .order("created_at", { ascending: false }).limit(200);
  if (stale()) return;
  if (error) { main.innerHTML = `<div class="empty">ما قدرناش نجيب الصور: ${esc(error.message)}</div>`; return; }
  list = data;
  try { urls = await signPaths(list.flatMap((r) => r.paths)); } catch { urls = {}; }
  if (stale()) return;
  draw(main);
}

const who = (r) => r.profiles?.full_name || r.profiles?.email || "متدرب";

function draw(main) {
  const rows = onlyAllowed ? list.filter((r) => r.allow_public) : list;
  const allowedCount = list.filter((r) => r.allow_public).length;

  const cards = rows.map((r) => `<article class="ph-entry">
    <div class="ph-head"><b>${esc(who(r))}</b><span>${PERIOD_LABEL[r.period]} · ${esc(monthLabel(r.month))}</span>
      ${r.allow_public ? `<span class="pill active">موافق على النشر</span>` : ""}</div>
    <div class="ph-imgs">${r.paths.map((p, i) => urls[p]
      ? `<figure><a href="${esc(urls[p])}" target="_blank" rel="noopener"><img src="${esc(urls[p])}" alt="${esc(who(r))}" loading="lazy"></a>
          <button class="btn btn-ink btn-sm" type="button" data-dl="${esc(p)}" data-name="${esc(`${who(r)}-${r.month.slice(0, 7)}-${r.period}-${i + 1}.jpg`)}">تنزيل</button></figure>`
      : `<span class="ph-miss">الصورة مش متاحة</span>`).join("")}</div>
  </article>`).join("");

  main.innerHTML = `
    <div class="view-head"><div><h1>صور المتدربين</h1><p>صور المتابعة اللي رفعها المتدربين. العلامة الخضرا معناها إن صاحب الصور سمح باستخدامها في نتايج المشتركين.</p></div></div>
    <div class="summary ph-filter">
      <button type="button" data-f="all" aria-pressed="${!onlyAllowed}"><b>${list.length}</b><span>كل الرفعات</span></button>
      <button type="button" data-f="ok" aria-pressed="${onlyAllowed}"><b>${allowedCount}</b><span>الموافقين على النشر</span></button>
    </div>
    ${rows.length ? `<div class="ph-list">${cards}</div>` : `<div class="empty">${list.length ? "مفيش صور موافق عليها لسه." : "لسه مفيش متدرب رفع صور."}</div>`}`;

  main.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => { onlyAllowed = b.dataset.f === "ok"; draw(main); }));
  main.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(b.dataset.dl, 120, { download: b.dataset.name });
    b.disabled = false;
    if (error) return toast("ما قدرناش ننزّلها: " + error.message, true);
    const a = document.createElement("a"); a.href = data.signedUrl; a.rel = "noopener"; a.click();
  }));
}
