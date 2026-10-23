// صفحة المتدربين: بتتأكد إنك داخل، وبتعرض الصفحة المناسبة من السايد بار
import { supabase, getCurrentProfile, isConfigured, esc } from "./supabase.js";
import { COACH_WHATSAPP } from "./config.js";
import "./pwa.js";
import { renderExercises } from "./views/exercises.js";
import { renderPrograms } from "./views/programs.js";
import { renderAccount } from "./views/account.js";
import { renderMembers, memberStatus } from "./views/members.js";
import { renderResults } from "./views/results.js";
import { renderPhotos } from "./views/photos.js";
import { renderProgress } from "./views/progress.js";

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
}

// هل المتدرب يقدر يشوف التمارين والجداول؟
const canTrain = () => ["active", "soon", "coach"].includes(memberStatus(profile));

let routeId = 0;
function route() {
  const myId = ++routeId;
  const isCoach = profile.role === "coach";
  let view = location.hash.slice(1) || (isCoach ? "members" : "exercises");
  if (["members", "results", "progress"].includes(view) && !isCoach) view = "exercises";
  if (view === "photos" && isCoach) view = "progress";

  document.querySelectorAll("#side-nav a").forEach((a) => {
    if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  closeMenu();
  window.scrollTo(0, 0);

  const ctx = { profile, isCoach, stale: () => myId !== routeId, onProfileChange: (p) => { profile = p; drawSidebar(); } };
  if (view === "account") return renderAccount(main, ctx);
  if (view === "members") return renderMembers(main, ctx);
  if (view === "results") return renderResults(main, ctx);
  if (view === "progress") return renderProgress(main, ctx);
  if (view === "photos") return renderPhotos(main, ctx);
  if (!canTrain()) return drawLocked();
  if (view === "programs") return renderPrograms(main, ctx);
  return renderExercises(main, ctx);
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

// قائمة الموبايل
const app = $("app"), btn = $("menu-btn");
function closeMenu() { app.classList.remove("nav-open"); btn.setAttribute("aria-expanded", "false"); }
btn.onclick = () => { const open = app.classList.toggle("nav-open"); btn.setAttribute("aria-expanded", open); };
$("scrim").onclick = closeMenu;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

$("logout").onclick = async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  location.replace("login.html");
};

// لو الجلسة خلصت في نص الاستخدام
supabase.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") location.replace("login.html"); });

start();
