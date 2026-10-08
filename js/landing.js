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
