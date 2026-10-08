// صفحة حسابي: بيانات المتدرب وحالة اشتراكه وتغيير كلمة السر
import { supabase, esc } from "../supabase.js";
import { toast } from "../ui.js";
import { memberStatus } from "./members.js";
import { isInstalled, isIOS, canPrompt, promptInstall } from "../pwa.js";

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

export function renderAccount(main, { profile, onProfileChange }) {
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
