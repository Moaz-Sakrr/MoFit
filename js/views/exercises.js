// صفحة التمارين: متقسمة على العضلات، وكل تمرين معاه فيديو يتفتح جوه الموقع
import { supabase, esc } from "../supabase.js";
import { youtubeId, thumbnail, openVideo, openFile } from "../youtube.js";
import { toast, openSheet, confirmSheet } from "../ui.js";

export const MUSCLES = [
  ["chest", "الصدر"], ["back", "الضهر"], ["shoulders", "الأكتاف"],
  ["arms", "الذراع"], ["legs", "الأرجل"], ["abs", "البطن"],
];

const VIDEOS = "exercise-videos";
const MAX_VIDEO = 50 * 1024 * 1024;
let muscle = "chest";
let list = [];

export async function renderExercises(main, { isCoach, stale }) {
  main.innerHTML = `<p class="loading">بيحمّل التمارين…</p>`;
  const { data, error } = await supabase.from("exercises").select("*").order("sort").order("id");
  if (stale()) return;
  if (error) { main.innerHTML = `<div class="empty">ما قدرناش نجيب التمارين: ${esc(error.message)}</div>`; return; }
  list = data;
  draw(main, isCoach);
}

function draw(main, isCoach) {
  const count = (m) => list.filter((e) => e.muscle === m).length;
  const shown = list.filter((e) => e.muscle === muscle);
  const tabs = MUSCLES.map(([k, n]) =>
    `<button class="mt" role="tab" type="button" data-muscle="${k}" aria-selected="${k === muscle}">${n}<sup>${count(k)}</sup></button>`).join("");

  const rows = shown.map((e) => {
    const vid = youtubeId(e.youtube_url);
    const thumb = e.video_path
      ? `<button class="thumb upload" type="button" data-play="${e.id}" aria-label="شغّل فيديو ${esc(e.name)}">
           <span class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span></button>`
      : vid
      ? `<button class="thumb" type="button" data-play="${e.id}" aria-label="شغّل فيديو ${esc(e.name)}">
           <img src="${thumbnail(vid)}" alt="" loading="lazy">
           <span class="play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span></button>`
      : `<div class="thumb none">من غير فيديو</div>`;
    return `<li class="row">
      ${thumb}
      <div class="row-body">
        <div class="row-title"><h3>${esc(e.name)}</h3>${e.sets || e.reps ? `<span class="dose">${esc(e.sets)} <em>×</em> ${esc(e.reps)}</span>` : ""}</div>
        ${e.cues ? `<p>${esc(e.cues)}</p>` : ""}
      </div>
      ${isCoach ? `<div class="row-acts"><button class="btn btn-ink btn-sm" type="button" data-edit="${e.id}">تعديل</button><button class="btn btn-ghost btn-sm" type="button" data-del="${e.id}">حذف</button></div>` : ""}
    </li>`;
  }).join("");

  main.innerHTML = `
    <div class="view-head"><div><h1>التمارين</h1><p>اختار العضلة، واضغط على الصورة عشان تشوف فيديو طريقة الأداء. الأرقام هي المجموعات × العدات.</p></div>
      ${isCoach ? `<button class="btn btn-tape" type="button" id="add-ex">إضافة تمرين</button>` : ""}</div>
    <div class="index" role="tablist">${tabs}</div>
    ${shown.length ? `<ul class="rows">${rows}</ul>` : `<div class="empty" style="margin-top:24px">مفيش تمارين للعضلة دي لسه.</div>`}`;

  main.querySelectorAll("[data-muscle]").forEach((b) => (b.onclick = () => { muscle = b.dataset.muscle; draw(main, isCoach); }));
  main.querySelectorAll("[data-play]").forEach((b) => (b.onclick = async () => {
    const e = list.find((x) => x.id == b.dataset.play);
    if (!e.video_path) return openVideo(e.youtube_url, e.name);
    const { data, error } = await supabase.storage.from(VIDEOS).createSignedUrl(e.video_path, 3600);
    if (error) return toast("ما قدرناش نفتح الفيديو: " + error.message, true);
    openFile(data.signedUrl, e.name);
  }));
  if (!isCoach) return;
  main.querySelector("#add-ex").onclick = () => editExercise(main, null);
  main.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => editExercise(main, list.find((x) => x.id == b.dataset.edit))));
  main.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => {
    const e = list.find((x) => x.id == b.dataset.del);
    confirmSheet(`حذف «${e.name}»؟`, "التمرين هيتشال من عند كل المتدربين.", async () => {
      const { error } = await supabase.from("exercises").delete().eq("id", e.id);
      if (error) throw error;
      if (e.video_path) await supabase.storage.from(VIDEOS).remove([e.video_path]).catch(() => {});
      list = list.filter((x) => x.id !== e.id);
      draw(main, isCoach); toast("التمرين اتحذف");
    });
  }));
}

function editExercise(main, e) {
  openSheet({
    title: e ? "تعديل التمرين" : "تمرين جديد",
    values: e || { muscle, sort: 0 },
    fields: [
      { k: "name", label: "اسم التمرين", required: true },
      { k: "muscle", label: "العضلة", type: "select", options: MUSCLES },
      { k: "sets", label: "عدد المجموعات", ph: "4" },
      { k: "reps", label: "عدد العدات", ph: "8-12" },
      { k: "cues", label: "طريقة الأداء", type: "textarea" },
      { k: "youtube_url", label: "لينك فيديو اليوتيوب", ltr: true, ph: "https://youtu.be/...", hint: "ينفع لينك عادي أو Shorts" },
      { k: "video", label: "أو ارفع فيديو من جهازك", type: "file", accept: "video/mp4,video/webm,video/quicktime", hint: "MP4 أفضل، وأقصى حجم ٥٠ ميجا. لو رفعت فيديو هو اللي هيظهر بدل لينك اليوتيوب." + (e && e.video_path ? " فيه فيديو مرفوع بالفعل، رفع فيديو جديد هيبدّله." : "") },
      ...(e && e.video_path ? [{ k: "remove_video", label: "الفيديو المرفوع", type: "select", options: [["", "سيبه زي ما هو"], ["1", "احذفه"]] }] : []),
      { k: "sort", label: "الترتيب", type: "number", hint: "الرقم الأصغر يظهر الأول" },
    ],
    async onSave(v) {
      if (v.youtube_url && !youtubeId(v.youtube_url)) throw new Error("لينك اليوتيوب مش صح. انسخه من زرار Share في يوتيوب.");
      const { video, remove_video, ...row } = v;
      row.sort = parseInt(row.sort) || 0;
      if (video && video.size > MAX_VIDEO) throw new Error("الفيديو أكبر من ٥٠ ميجا. صغّره الأول.");
      let newPath = null;
      if (video) {
        newPath = crypto.randomUUID() + "." + ((video.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4");
        const up = await supabase.storage.from(VIDEOS).upload(newPath, video, { contentType: video.type || "video/mp4" });
        if (up.error) throw up.error;
        row.video_path = newPath;
      } else if (remove_video === "1") row.video_path = "";
      const q = e ? supabase.from("exercises").update(row).eq("id", e.id) : supabase.from("exercises").insert(row);
      const { data, error } = await q.select().single();
      if (error) {
        if (newPath) await supabase.storage.from(VIDEOS).remove([newPath]).catch(() => {});
        throw error;
      }
      if (e && e.video_path && e.video_path !== data.video_path) await supabase.storage.from(VIDEOS).remove([e.video_path]).catch(() => {});
      if (e) Object.assign(e, data); else list.push(data);
      muscle = data.muscle;
      draw(main, true);
      toast(e ? "التمرين اتعدّل" : "التمرين اتضاف");
    },
  });
}
