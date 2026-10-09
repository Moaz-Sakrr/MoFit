import { supabase, isConfigured } from "./supabase.js";
import { mountCaptcha, captchaEnabled } from "./captcha.js";

const $ = (id) => document.getElementById(id);
// نحفظ الهاش قبل ما Supabase يمسحه (لينك تغيير كلمة السر بيبقى فيه type=recovery)
const isRecovery = /type=recovery|#reset/.test(location.hash);
const forms = { login: $("form-login"), signup: $("form-signup"), reset: $("form-reset") };

// ودجت التحقق بيترسم أول ما الفورم يظهر (مش وهو مخفي)
const caps = {};
const capFor = (k) => (caps[k] ||= mountCaptcha($("cap-" + k)));
async function captchaToken(k) {
  const t = await capFor(k).token();
  if (captchaEnabled && !t) notice("التحقق الأمني لسه ما خلصش. استنى ثانية وجرب تاني.", "bad");
  return t;
}

function show(which) {
  if (which === "login" || which === "signup") capFor(which);
  Object.entries(forms).forEach(([k, f]) => (f.hidden = k !== which));
  $("tab-login").setAttribute("aria-selected", which === "login");
  $("tab-signup").setAttribute("aria-selected", which === "signup");
  document.querySelector(".auth-tabs").hidden = which === "reset";
}

function notice(text, kind = "info") {
  const n = $("notice");
  n.textContent = text;
  n.className = "notice " + kind;
  n.hidden = !text;
}

// ترجمة أشهر رسايل الخطأ من Supabase
function arabicError(err) {
  const m = (err && err.message) || "";
  if (/Invalid login credentials/i.test(m)) return "الإيميل أو كلمة السر غلط.";
  if (/Email not confirmed/i.test(m)) return "لازم تأكد الإيميل الأول. افتح الرسالة اللي وصلتك واضغط على اللينك، ولو مش لاقيها دوّر في الـ Spam.";
  if (/already registered|already exists/i.test(m)) return "الإيميل ده عليه حساب بالفعل. جرب تسجيل الدخول.";
  if (/Password should be/i.test(m)) return "كلمة السر لازم تبقى ٦ حروف على الأقل.";
  if (/captcha/i.test(m)) return "فشل التحقق الأمني. جرب تاني.";
  if (/rate limit/i.test(m)) return "محاولات كتير ورا بعض. استنى دقيقة وجرب تاني.";
  return "حصلت مشكلة: " + m;
}

$("tab-login").onclick = () => { notice(""); show("login"); };
$("tab-signup").onclick = () => { notice(""); show("signup"); };
if (location.hash === "#signup") show("signup");

if (!isConfigured) notice("الموقع لسه مش متوصّل بـ Supabase. حط بيانات المشروع في js/config.js.", "bad");

// لو داخل بالفعل، روح على صفحة التمارين على طول
supabase.auth.getSession().then(({ data }) => {
  if (data.session && !isRecovery) location.replace("app.html");
});
if (isRecovery) show("reset");
else if (location.hash !== "#signup") capFor("login");

// لينك "نسيت كلمة السر" بيرجع هنا ومعاه جلسة مؤقتة
supabase.auth.onAuthStateChange((event) => {
  if (event === "PASSWORD_RECOVERY") { notice(""); show("reset"); }
});

forms.login.onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; notice("");
  const token = await captchaToken("login");
  if (captchaEnabled && !token) { btn.disabled = false; return; }
  const { error } = await supabase.auth.signInWithPassword({
    email: $("li-email").value.trim(),
    password: $("li-pass").value,
    options: { captchaToken: token },
  });
  btn.disabled = false;
  capFor("login").reset();
  if (error) return notice(arabicError(error), "bad");
  location.replace("app.html");
};

forms.signup.onsubmit = async (e) => {
  e.preventDefault();
  const btn = e.submitter; btn.disabled = true; notice("");
  const token = await captchaToken("signup");
  if (captchaEnabled && !token) { btn.disabled = false; return; }
  const { data, error } = await supabase.auth.signUp({
    email: $("su-email").value.trim(),
    password: $("su-pass").value,
    options: {
      data: { full_name: $("su-name").value.trim(), phone: $("su-phone").value.trim() },
      emailRedirectTo: new URL("login.html", location.href).href,
      captchaToken: token,
    },
  });
  btn.disabled = false;
  capFor("signup").reset();
  if (error) return notice(arabicError(error), "bad");
  // لو الإيميل مسجّل قبل كده، Supabase بيرجّع مستخدم من غير identities
  if (data.user && data.user.identities && data.user.identities.length === 0)
    return notice(arabicError({ message: "already registered" }), "bad");
  if (data.session) return location.replace("app.html");
  forms.signup.reset();
  show("login");
  notice("الحساب اتعمل. افتح الإيميل وأكّد الحساب، وبعدين ادخل من هنا. لو مش لاقي الرسالة، دوّر عليها في الـ Spam (الرسايل غير المرغوب فيها).", "ok");
};

$("forgot").onclick = async () => {
  const email = $("li-email").value.trim();
  if (!email) return notice("اكتب الإيميل الأول وبعدين اضغط «نسيت كلمة السر».", "bad");
  const token = await captchaToken("login");
  if (captchaEnabled && !token) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("login.html#reset", location.href).href,
    captchaToken: token,
  });
  capFor("login").reset();
  notice(error ? arabicError(error) : "بعتنالك لينك على الإيميل تغيّر بيه كلمة السر.", error ? "bad" : "ok");
};

forms.reset.onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.updateUser({ password: $("rs-pass").value });
  if (error) return notice(arabicError(error), "bad");
  location.replace("app.html");
};
