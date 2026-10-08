// تشغيل فيديو اليوتيوب جوه الموقع في نافذة صغيرة

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
  frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1"
    title="${title ? title.replace(/"/g, "") : "فيديو التمرين"}"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`;
  dlg.showModal();
}

// فيديو مرفوع من جهاز الكوتش (رابط مؤقت من Supabase)
export function openFile(src, title) {
  document.getElementById("video-title").textContent = title || "";
  dlg.classList.remove("vertical");
  frame.innerHTML = "";
  const v = document.createElement("video");
  v.src = src; v.controls = true; v.autoplay = true; v.playsInline = true;
  frame.appendChild(v);
  dlg.showModal();
}

// لما النافذة تتقفل نشيل الفيديو عشان الصوت يقف
dlg.addEventListener("close", () => (frame.innerHTML = ""));
document.getElementById("video-close").onclick = () => dlg.close();
// الضغط برة الفيديو يقفل النافذة
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
