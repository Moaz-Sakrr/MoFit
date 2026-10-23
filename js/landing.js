// الصفحة الرئيسية: بتجيب نتايج المشتركين من قاعدة البيانات (لو فشلت بتفضل النسخة الثابتة اللي في HTML)
import { supabase, isConfigured, esc } from "./supabase.js";

const grid = document.querySelector(".res-grid");

function bindSliders() {
  document.querySelectorAll(".compare input").forEach((r) =>
    r.addEventListener("input", () => r.parentElement.style.setProperty("--pos", r.value + "%")));
}

async function load() {
  if (!isConfigured || !grid) return;
  const { data, error } = await supabase.from("results").select("*").order("sort").order("id");
  if (error) return;
  if (!data.length) { document.getElementById("results").hidden = true; return; }
  grid.innerHTML = data.map((r) => `<article class="res">
      <div class="compare">
        <img src="${esc(r.after_url)}" alt="${esc(r.title)} بعد" loading="lazy">
        <img class="before" src="${esc(r.before_url)}" alt="${esc(r.title)} قبل" loading="lazy">
        <input type="range" min="0" max="100" value="50" aria-label="قارن قبل وبعد ${esc(r.title)}">
        <div class="handle"></div><span class="tag b">قبل</span><span class="tag a">بعد</span>
      </div>
      <h3>${esc(r.title)}</h3><p class="meta">${esc(r.goal)}</p>
    </article>`).join("");
  bindSliders();
}
load();

// آراء المشتركين اللي الكوتش اختارها (الاسم الأول والتقييم والنص بس)
async function loadReviews() {
  const box = document.getElementById("reviews");
  if (!isConfigured || !box) return;
  const { data, error } = await supabase.rpc("public_feedback");
  if (error || !data.length) return;
  box.hidden = false;
  rotateReviews(box.querySelector(".rev-grid"), data);
}
loadReviews();

const ROTATE_MS = 2000;
const revCard = (r) => `<span class="rev-stars" role="img" aria-label="التقييم ${r.rating} من 5">${"★".repeat(r.rating)}<i>${"★".repeat(5 - r.rating)}</i></span>
  <blockquote>${esc(r.message)}</blockquote>
  <figcaption>${esc(r.name)}</figcaption>`;

// ٣ مربعات ثابتة (٢ على التابلت وواحد على الموبايل). كل ثانيتين مربع واحد بالدور بياخد الرأي اللي عليه الدور،
// فكل الآراء بتلف عليهم. بيقف لما الماوس أو الكيبورد على الآراء أو التاب مش ظاهر
function rotateReviews(grid, all) {
  const small = matchMedia("(max-width:640px)"), mid = matchMedia("(max-width:900px)");
  let timer, slots, queue, turn, paused = false;

  function setup() {
    clearInterval(timer);
    const n = Math.min(small.matches ? 1 : mid.matches ? 2 : 3, all.length);
    queue = all.slice(n);
    grid.innerHTML = all.slice(0, n).map((r) => `<figure class="rev">${revCard(r)}</figure>`).join("");
    slots = [...grid.children].map((el, i) => ({ el, r: all[i] }));
    turn = 0;
    if (queue.length) timer = setInterval(tick, ROTATE_MS);
  }

  function tick() {
    if (paused || document.hidden) return;
    const s = slots[turn];
    turn = (turn + 1) % slots.length;
    const next = queue.shift();
    queue.push(s.r);
    s.r = next;
    s.el.classList.add("out");
    setTimeout(() => { s.el.innerHTML = revCard(next); s.el.classList.remove("out"); }, 250);
  }

  grid.addEventListener("mouseenter", () => (paused = true));
  grid.addEventListener("mouseleave", () => (paused = false));
  grid.addEventListener("focusin", () => (paused = true));
  grid.addEventListener("focusout", () => (paused = false));
  small.addEventListener("change", setup);
  mid.addEventListener("change", setup);
  setup();
}
