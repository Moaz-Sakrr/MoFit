// صفحة المتدربين: بتتأكد إنك داخل، وبتعرض الصفحة المناسبة من السايد بار
import { supabase, getCurrentProfile, isConfigured, esc } from "./supabase.js";
import { COACH_WHATSAPP } from "./config.js";
import "./pwa.js";
import { renderExercises } from "./views/exercises.js";
import { renderAccount } from "./views/account.js";
import { renderMembers, memberStatus } from "./views/members.js";
import { renderResults } from "./views/results.js";
import { renderPhotos } from "./views/photos.js";
import { renderProgress } from "./views/progress.js";
import { renderFeedback } from "./views/feedback.js";
import { renderMyPlan, renderPlanBuilder } from "./views/plan.js";
import { renderWorkout } from "./views/workout.js";
import { renderMeals } from "./views/meals.js";
import { disablePush } from "./push.js";

const $ = (id) => document.getElementById(id);
const main = $("main");
let profile = null;

const STATUS_LABEL = { active: "اشتراك مفعّل", soon: "الاشتراك بيخلص قريب", expired: "الاشتراك خلص", inactive: "مستني التفعيل", coach: "الكوتش" };

async function start() {
  if (!isConfigured) {
    main.innerHTML = `<div class="locked"><h1>الموقع مش متوصّل لسه</h1><p>حط بيانات مشروع Supabase في ملف js/config.js. الخطوات في README.</p></div>`;
    return;
  }
  try { profile = await getCurrentProfile(); }
  catch (e) { main.innerHTML = `<div class="locked"><h1>حصلت مشكلة</h1><p>${esc(e.message)}</p></div>`; return; }
  if (!profile) return location.replace("login.html");

  drawSidebar();
  window.addEventListener("hashchange", route);
  route();
}

function drawSidebar() {
  const st = memberStatus(profile);
  $("me-name").textContent = profile.full_name || profile.email;
  $("me-status").innerHTML = `<span class="pill ${st}">${STATUS_LABEL[st]}</span>`;
  $("coach-nav").hidden = profile.role !== "coach";
  $("photos-nav").hidden = profile.role === "coach";
  $("plan-nav").hidden = profile.role === "coach";
  $("more-btn").hidden = profile.role !== "coach";
  // الكوتش عنده صفحات أكتر من مساحة الشريط، فدول بيروحوا «المزيد» على الموبايل
  ["account-nav", "progress-nav", "results-nav"].forEach((id) => $(id).classList.toggle("in-more", profile.role === "coach"));
  $("meals-nav").classList.toggle("late", profile.role === "coach");
}

// هل المتدرب يقدر يشوف التمارين والجداول؟
const canTrain = () => ["active", "soon", "coach"].includes(memberStatus(profile));

let routeId = 0;
function route() {
  const myId = ++routeId;
  const isCoach = profile.role === "coach";
  const [hashView, arg] = (location.hash.slice(1) || (isCoach ? "members" : "myplan")).split("/");
  let view = hashView;
  if (["members", "results", "progress", "plan", "feedback", "exercises"].includes(view) && !isCoach) view = "myplan";
  if (["myplan", "workout"].includes(view) && isCoach) view = "members";
  if (view === "photos" && isCoach) view = "progress";

  // التمرين جزء من خطتي، وبناء الخطة جزء من المتدربين
  const tab = { workout: "myplan", plan: "members" }[view] || view;
  document.querySelectorAll(".side-nav a").forEach((a) => {
    if (a.dataset.view === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  moveIndicator();
  closeMore();
  window.scrollTo(0, 0);

  const ctx = { profile, isCoach, stale: () => myId !== routeId, onProfileChange: (p) => { profile = p; drawSidebar(); } };
  if (view === "account") return renderAccount(main, ctx);
  if (view === "members") return renderMembers(main, ctx);
  if (view === "results") return renderResults(main, ctx);
  if (view === "progress") return renderProgress(main, ctx);
  if (view === "feedback") return renderFeedback(main, ctx);
  if (view === "photos") return renderPhotos(main, ctx);
  if (view === "plan") return arg ? renderPlanBuilder(main, ctx, arg) : renderMembers(main, ctx);
  if (view === "exercises") return renderExercises(main, ctx);
  if (!canTrain()) return drawLocked();
  if (view === "meals") return renderMeals(main, ctx);
  if (view === "workout" && arg) return renderWorkout(main, ctx, arg);
  return isCoach ? renderMembers(main, ctx) : renderMyPlan(main, ctx);
}

// شاشة بتظهر لو الحساب مش مفعّل أو الاشتراك خلص
function drawLocked() {
  const st = memberStatus(profile);
  const msg = st === "expired"
    ? "اشتراكك خلص. كلّم محمد يجدده، وأول ما يتجدد التمارين هترجعلك على طول."
    : "حسابك اتعمل، بس محمد لسه ما فعّلهوش. ابعتله على واتساب عشان يفعّله.";
  main.innerHTML = `<div class="locked">
    <span class="pill ${st}">${STATUS_LABEL[st]}</span>
    <h1>${st === "expired" ? "الاشتراك خلص" : "مستني التفعيل"}</h1>
    <p>${msg}</p>
    <div class="actions">
      <a class="btn btn-tape" href="https://wa.me/${COACH_WHATSAPP}?text=${encodeURIComponent("أهلاً يا كوتش، أنا " + (profile.full_name || "") + " وعايز أفعّل اشتراكي في MoFit")}" target="_blank" rel="noopener">كلّم محمد على واتساب</a>
      <a class="btn btn-ghost" href="#account">حسابي</a>
    </div></div>`;
}

// شريط الموبايل: الدايرة الصفرا بتروح للتاب المفتوح، ولو الصفحة جوه «المزيد» بتقف عليه
function moveIndicator() {
  const nav = $("side-nav");
  // بالترتيب اللي ظاهر (CSS order بيغيّره عند الكوتش)، من اليمين للشمال
  const tabs = [...nav.querySelectorAll("a, .more-btn")].filter((t) => t.getClientRects().length)
    .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
  let i = tabs.findIndex((t) => t.hasAttribute("aria-current"));
  if (i < 0) i = tabs.indexOf($("more-btn"));
  $("more-btn").classList.toggle("on", i >= 0 && tabs[i] === $("more-btn"));
  nav.style.setProperty("--n", tabs.length);
  nav.style.setProperty("--i", Math.max(i, 0));
  if (!nav.classList.contains("ready")) { nav.offsetWidth; nav.classList.add("ready"); } // أول مرة تترسم في مكانها من غير ما تتزحلق
}
window.matchMedia("(max-width:900px)").addEventListener("change", moveIndicator);

const more = $("more"), moreBtn = $("more-btn");
// القفل بيستنى حركة الخروج تخلص (ولو الحركة مقفولة بيقفل على طول، ولو اتعطلت بيقفل بعد ربع ثانية)
function closeMore() {
  if (!more.open || more.classList.contains("closing")) return;
  more.classList.add("closing");
  const done = Promise.all(more.getAnimations().map((a) => a.finished));
  Promise.race([done, new Promise((r) => setTimeout(r, 250))]).finally(() => {
    more.close(); more.classList.remove("closing"); moreBtn.setAttribute("aria-expanded", "false");
  });
}
moreBtn.onclick = () => { more.showModal(); moreBtn.setAttribute("aria-expanded", "true"); };
more.addEventListener("cancel", (e) => { e.preventDefault(); closeMore(); }); // Escape
more.onclick = (e) => { if (e.target === more) closeMore(); }; // دوسة برّه القائمة تقفلها

document.addEventListener("click", async (e) => {
  if (!e.target.closest(".logout")) return;
  e.preventDefault();
  await disablePush(); // قبل signOut عشان الـ RLS يسمح بمسح الصف
  await supabase.auth.signOut();
  location.replace("login.html");
});

// لو الجلسة خلصت في نص الاستخدام
supabase.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.replace("login.html"); });

start();
