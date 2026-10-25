// تشغيل فيديو اليوتيوب جوه الموقع في نافذة صغيرة
import { supabase, today } from "./supabase.js";

// يطلع كود الفيديو (11 حرف) من أي شكل لينك يوتيوب
// بيقبل: youtube.com/watch?v=ID ، youtu.be/ID ، youtube.com/shorts/ID ، youtube.com/embed/ID
export function youtubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    let id = null;
    if (u.hostname.endsWith("youtu.be")) id = u.pathname.slice(1).split("/")[0];
    else if (u.searchParams.get("v")) id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
      if (m) id = m[2];
    }
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch { return null; }
}

export const isShort = (url) => /\/shorts\//.test(url || "");

export const thumbnail = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

const dlg = document.getElementById("video");
const frame = document.getElementById("video-frame");

export function openVideo(url, title) {
  const id = youtubeId(url);
  if (!id) return;
  document.getElementById("video-title").textContent = title || "";
  dlg.classList.toggle("vertical", isShort(url));
  // youtube-nocookie: نسخة اليوتيوب اللي ما بتحطش كوكيز تتبع
  const f = document.createElement("iframe");
  // fs=0: يشيل زرار التكبير من مشغّل يوتيوب، عشان آيفون بيفتح فيه الفيديو بالـ player بتاعه ويخفي العلامة المائية
  f.src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1&fs=0`;
  f.title = title || "فيديو التمرين";
  // من غير fullscreen: تكبير يوتيوب بيكبّر الفيديو لوحده ويخفي العلامة، فبنكبّر الإطار كله بزرارنا
  f.allow = "autoplay; encrypted-media; picture-in-picture";
  // علامة مائية بإيميل المتدرب عشان لو الفيديو اتسجّل واتنشر نعرف مين
  const mark = document.createElement("div");
  mark.className = "video-mark";
  mark.setAttribute("aria-hidden", "true");
  frame.replaceChildren(f, mark);
  dlg.showModal();
  supabase.auth.getSession().then(({ data: { session } }) => {
    mark.textContent = `${session?.user?.email || ""} · ${today()}`;
  });
}

// التكبير: النافذة بتكبر بـ CSS، وكمان الصفحة كلها بتاخد fullscreen عشان يختفي شريط المتصفح.
// بنكبّر الصفحة مش الإطار، لأن الإطار لو اتكبّر بيتجبر يملا الشاشة والعلامة تقع في الشرايط السودا. آيفون ما بيدعمش ده فبيكتفي بالـ CSS
const exitFull = () => document.fullscreenElement && document.exitFullscreen();
document.getElementById("video-full").onclick = () => {
  if (dlg.classList.toggle("full")) document.documentElement.requestFullscreen?.().catch(() => {});
  else exitFull();
};

// لما النافذة تتقفل نشيل الفيديو عشان الصوت يقف
dlg.addEventListener("close", () => { frame.innerHTML = ""; dlg.classList.remove("full"); exitFull(); });
document.getElementById("video-close").onclick = () => dlg.close();
// الضغط برة الفيديو يقفل النافذة
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
