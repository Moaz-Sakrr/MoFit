// اختيار وزن وعدات المجموعة بعجلات سحب (زي ظبط المنبّه في الآيفون) مع صوت واهتزاز خفيف عند كل رقم
import { esc } from "./supabase.js";
import { toast } from "./ui.js";

const H = 40; // ارتفاع الرقم الواحد، لازم يطابق .wheel-i في app.css
const DEC = [0, 0.25, 0.5, 0.75];
const range = (max) => Array.from({ length: max + 1 }, (_, i) => String(i));

let audio = null;

// نقرة قصيرة من WebAudio (من غير ملفات صوت)، ونظام الموبايل هو اللي بيكتمها لو في وضع الصامت. الاهتزاز شغال على أندرويد؛ سفاري آيفون مش بيدعم vibrate
function tick() {
  navigator.vibrate?.(6);
  if (!audio) return;
  const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
  o.frequency.value = 1400;
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
  o.connect(g).connect(audio.destination);
  o.start(t); o.stop(t + 0.035);
}

function wheel(labels, idx, label) {
  const el = document.createElement("div");
  el.className = "wheel"; el.tabIndex = 0; el.setAttribute("role", "listbox"); el.setAttribute("aria-label", label);
  el.innerHTML = labels.map((t, i) => `<div class="wheel-i" role="option" data-i="${i}">${esc(t)}</div>`).join("");
  let cur = idx;
  const mark = () => el.querySelectorAll(".wheel-i").forEach((n, i) => n.classList.toggle("sel", i === cur));
  el.addEventListener("scroll", () => {
    const i = Math.min(labels.length - 1, Math.max(0, Math.round(el.scrollTop / H)));
    if (i !== cur) { cur = i; mark(); tick(); }
  }, { passive: true });
  el.onclick = (e) => { const n = e.target.closest(".wheel-i"); if (n) el.scrollTo({ top: n.dataset.i * H, behavior: "smooth" }); };
  return { el, get value() { return cur; }, init() { el.scrollTop = idx * H; mark(); } };
}

// onSave(weight, reps) بترجع Promise؛ لو رمت خطأ النافذة بتفضل مفتوحة
export function pickSet({ title, weight, reps, onSave }) {
  const dlg = document.getElementById("sheet"), form = document.getElementById("sheet-form");
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch { audio = null; }
  const wn = Math.floor(weight), wd = Math.max(0, DEC.findIndex((d) => d === Math.round((weight - wn) * 4) / 4));
  const whole = wheel(range(Math.max(500, wn)), wn, "الوزن بالكيلو"), dec = wheel(DEC.map((d) => String(d).slice(1) || ".0"), wd, "كسور الكيلو"),
    rp = wheel(range(Math.max(100, reps)), reps, "العدات");
  form.innerHTML = `<h2>${esc(title)}</h2>
    <div class="wheel-labels"><span>الوزن (كجم)</span><span>العدات</span></div>
    <div class="wheels"></div>
    <div class="foot"><button class="btn btn-tape" type="submit">سجّل المجموعة</button><button class="btn btn-ghost" type="button" id="sheet-cancel">إلغاء</button></div>`;
  form.querySelector(".wheels").append(whole.el, dec.el, rp.el);
  form.querySelector("#sheet-cancel").onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.submitter; btn.disabled = true;
    try { await onSave(whole.value + DEC[dec.value], rp.value); dlg.close(); }
    catch (err) { toast("ما اتحفظش: " + (err.message || err), true); }
    btn.disabled = false;
  };
  dlg.showModal();
  [whole, dec, rp].forEach((x) => x.init());
}
