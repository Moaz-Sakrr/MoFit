// صفحة حسابي: بيانات المتدرب وحالة اشتراكه وتغيير كلمة السر
import { supabase, esc } from "../supabase.js";
import { toast, confirmSheet } from "../ui.js";
import { memberStatus } from "./members.js";
import { isInstalled, isIOS, canPrompt, promptInstall } from "../pwa.js";
import { stars } from "./feedback.js";

const LABEL = { active: "مفعّل", soon: "بيخلص قريب", expired: "منتهي", inactive: "مش مفعّل لسه", coach: "الكوتش" };
const fmt = (d) => d ? new Date(d).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" }) : "مفيش تاريخ";

// كارت تثبيت الموقع كتطبيق: زر على أندرويد، وخطوات على آيفون، وتلميح للباقي
function drawInstall(box) {
  if (isInstalled()) return;
  const how = canPrompt()
    ? `<button class="btn btn-tape" type="button" id="do-install">تثبيت التطبيق</button>`
    : isIOS()
      ? `<p>من متصفح Safari اضغط زر المشاركة <b>⬆︎</b>، وبعدها «إضافة إلى الشاشة الرئيسية».</p>`
      : `<p>من قائمة المتصفح (⋮) اختار «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».</p>`;
  box.innerHTML = `<h2>ثبّت MoFit على موبايلك</h2>
    <p>هيبقى عندك أيقونة على الشاشة، وتفتح تماريني وجدولك بضغطة واحدة زي أي تطبيق.</p>${how}`;
  box.hidden = false;
  box.querySelector("#do-install")?.addEventListener("click", async () => { if (await promptInstall()) box.hidden = true; });
  // لو المتصفح لسه ما بلّغش إن التثبيت متاح، نرسم الزر أول ما يبلّغ
  if (!canPrompt()) addEventListener("mofit-installable", () => box.isConnected && drawInstall(box), { once: true });
  addEventListener("mofit-installed", () => (box.hidden = true), { once: true });
}

// ---------- رأيك في التدريب: رأي واحد كل 24 ساعة ----------
const DAY = 24 * 60 * 60 * 1000;
const nextAllowed = (p) => p.last_feedback_at ? new Date(new Date(p.last_feedback_at).getTime() + DAY) : null;

// «النهارده الساعة ٩:٣٠ م» أو «بكرة الساعة …» أو التاريخ كامل
function when(d) {
  const time = d.toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date())) / DAY);
  if (diff === 0) return `النهارده الساعة ${time}`;
  if (diff === 1) return `بكرة الساعة ${time}`;
  return d.toLocaleDateString("ar-EG", { weekday: "long", day: "numeric", month: "long" }) + ` الساعة ${time}`;
}

let fbList = [];
let fbTimer;

async function drawFeedback(box, ctx) {
  box.innerHTML = `<h2>رأيك في التدريب</h2>
    <p class="fb-sub">رأيك بيوصل للكوتش بس، وبيساعده يطوّر التدريب. تقدر تبعت رأي واحد كل يوم.</p>
    <div id="fb-send"></div>
    <h3 class="fb-h">آرائي السابقة</h3>
    <ul class="fb-list" id="fb-list"><li class="sk sk-block"></li></ul>`;
  drawSend(box, ctx, false);
  const { data, error } = await supabase.from("feedback").select("*").eq("member_id", ctx.profile.id).order("created_at", { ascending: false });
  if (ctx.stale() || !box.isConnected) return;
  if (error) { box.querySelector("#fb-list").innerHTML = `<li class="ph-miss">ما قدرناش نجيب آراءك: ${esc(error.message)}</li>`; return; }
  fbList = data;
  drawList(box, ctx);
}

// الفورم، أو رسالة بموعد الرأي الجاي لو لسه ما عدّاش يوم
function drawSend(box, ctx, justSent) {
  const wrap = box.querySelector("#fb-send");
  const next = nextAllowed(ctx.profile);
  clearTimeout(fbTimer);
  if (next && next > new Date()) {
    wrap.innerHTML = `<p class="notice ok">${justSent ? "شكراً، رأيك وصل للكوتش. " : "بعت رأيك في آخر ٢٤ ساعة. "}تقدر تبعت رأي جديد <b>${when(next)}</b>.</p>`;
    // أول ما الوقت ييجي الفورم يرجع لوحده (لو الصفحة لسه مفتوحة)
    const wait = next - new Date();
    if (wait < DAY + 60000) fbTimer = setTimeout(() => box.isConnected && drawSend(box, ctx, false), wait + 1000);
    return;
  }
  wrap.innerHTML = `<form id="f-fb" class="fb-form">
      <fieldset class="stars"><legend>تقييمك للتدريب</legend>
        ${[1, 2, 3, 4, 5].map((n) => `<input class="sr-only" type="radio" name="rating" id="fb-r${n}" value="${n}" required><label for="fb-r${n}" title="${n} من 5">★<span class="sr-only">${n} من 5</span></label>`).join("")}
      </fieldset>
      <div class="field"><label for="fb-msg">رأيك</label><textarea id="fb-msg" maxlength="1000" required placeholder="إيه اللي عاجبك؟ وإيه اللي محتاج يتحسّن؟"></textarea><small>حد أقصى ١٠٠٠ حرف</small></div>
      <div class="field check"><label for="fb-allow"><input id="fb-allow" type="checkbox"><span>أسمح للكوتش يعرض رأيي في الصفحة الرئيسية للموقع</span></label><small>اختياري. بيظهر اسمك الأول بس، وتقدر تسحب موافقتك في أي وقت.</small></div>
      <button class="btn btn-ink" type="submit">ابعت رأيك</button>
    </form>`;
  wrap.querySelector("#f-fb").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = e.submitter;
    const message = f.querySelector("#fb-msg").value.trim();
    if (!message) return toast("اكتب رأيك الأول", true);
    btn.disabled = true;
    const { data, error } = await supabase.from("feedback")
      .insert({ member_id: ctx.profile.id, rating: +f.elements.rating.value, message, allow_public: f.querySelector("#fb-allow").checked }).select().single();
    btn.disabled = false;
    if (error) return toast("ما اتبعتش: " + error.message, true);
    // الـ trigger سجّل نفس الوقت في last_feedback_at
    ctx.profile = { ...ctx.profile, last_feedback_at: data.created_at };
    ctx.onProfileChange(ctx.profile);
    fbList.unshift(data);
    drawSend(box, ctx, true);
    drawList(box, ctx);
  };
}

function drawList(box, ctx) {
  const ul = box.querySelector("#fb-list");
  if (!fbList.length) { ul.innerHTML = `<li class="ph-miss">لسه ما بعتّش أي رأي.</li>`; return; }
  ul.innerHTML = fbList.map((r) => `<li class="fb-item">
      <div class="fb-top">${stars(r.rating)}<span class="fb-date">${new Date(r.created_at).toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" })}</span>
        ${r.coach_seen ? `<span class="pill active">الكوتش قراه</span>` : `<span class="pill soon">لسه ما اتقراش</span>`}</div>
      <p class="fb-msg">${esc(r.message)}</p>
      <label class="ph-consent"><input type="checkbox" data-fb-allow="${r.id}"${r.allow_public ? " checked" : ""}><span>أسمح للكوتش يعرضه في الصفحة الرئيسية${r.allow_public && r.featured ? " (معروض دلوقتي)" : ""}</span></label>
      <div class="row-acts"><button class="btn btn-ghost btn-sm" type="button" data-fb-del="${r.id}">حذف</button></div>
    </li>`).join("");
  ul.querySelectorAll("[data-fb-allow]").forEach((c) => (c.onchange = async () => {
    const r = fbList.find((x) => x.id == c.dataset.fbAllow);
    c.disabled = true;
    const { error } = await supabase.from("feedback").update({ allow_public: c.checked }).eq("id", r.id);
    c.disabled = false;
    if (error) { c.checked = r.allow_public; toast("ما اتحفظش: " + error.message, true); return; }
    r.allow_public = c.checked;
    drawList(box, ctx);
    toast(c.checked ? "تمام، الكوتش يقدر يعرض رأيك" : "رأيك مش هيظهر في الصفحة الرئيسية");
  }));
  ul.querySelectorAll("[data-fb-del]").forEach((b) => (b.onclick = () => {
    const r = fbList.find((x) => x.id == b.dataset.fbDel);
    confirmSheet("حذف الرأي ده؟", "هيتشال من عندك ومن عند الكوتش. الحذف مش بيرجّعلك فرصة إرسال قبل ميعادها.", async () => {
      const { error } = await supabase.from("feedback").delete().eq("id", r.id);
      if (error) throw error;
      fbList = fbList.filter((x) => x.id !== r.id);
      drawList(box, ctx); toast("الرأي اتحذف");
    });
  }));
}

export function renderAccount(main, ctx) {
  const { profile, onProfileChange } = ctx;
  const st = memberStatus(profile);
  main.innerHTML = `
    <div class="view-head"><div><h1>حسابي</h1></div></div>
    <div class="account">
      <section class="panel">
        <h2>الاشتراك</h2>
        <div class="kv"><span>الحالة</span><span class="pill ${st}">${LABEL[st]}</span></div>
        ${profile.role !== "coach" ? `<div class="kv"><span>آخر يوم في الاشتراك</span><b>${fmt(profile.subscription_end)}</b></div>` : ""}
        <div class="kv"><span>الإيميل</span><b dir="ltr">${esc(profile.email)}</b></div>
      </section>

      <section class="panel" id="install" hidden></section>

      ${profile.role !== "coach" ? `<section class="panel fb" id="feedback"></section>` : ""}

      <form class="panel" id="f-profile">
        <h2>بياناتي</h2>
        <div class="field"><label for="a-name">الاسم</label><input id="a-name" value="${esc(profile.full_name)}" required></div>
        <div class="field"><label for="a-phone">رقم الموبايل</label><input id="a-phone" type="tel" dir="ltr" value="${esc(profile.phone)}"></div>
        <button class="btn btn-ink" type="submit">حفظ البيانات</button>
      </form>

      <form class="panel" id="f-pass">
        <h2>تغيير كلمة السر</h2>
        <div class="field"><label for="a-pass">كلمة السر الجديدة</label><input id="a-pass" type="password" dir="ltr" minlength="6" autocomplete="new-password" required></div>
        <button class="btn btn-ink" type="submit">تغيير كلمة السر</button>
      </form>
    </div>`;

  drawInstall(main.querySelector("#install"));
  const fb = main.querySelector("#feedback");
  if (fb) drawFeedback(fb, ctx);

  main.querySelector("#f-profile").onsubmit = async (e) => {
    e.preventDefault();
    const patch = { full_name: main.querySelector("#a-name").value.trim(), phone: main.querySelector("#a-phone").value.trim() };
    const { data, error } = await supabase.from("profiles").update(patch).eq("id", profile.id).select().single();
    if (error) return toast("ما اتحفظش: " + error.message, true);
    onProfileChange(data);
    toast("البيانات اتحفظت");
  };

  main.querySelector("#f-pass").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: main.querySelector("#a-pass").value });
    if (error) return toast("ما اتغيّرتش: " + error.message, true);
    e.target.reset();
    toast("كلمة السر اتغيّرت");
  };
}
