// لوحة الكوتش: كل حسابات المتدربين، وتفعيل أو إيقاف أي حد، وتحديد نهاية الاشتراك
import { supabase, esc, today } from "../supabase.js";
import { toast } from "../ui.js";

let list = [];
let filter = "all";
let search = "";

const STATUS_LABEL = { active: "مفعّل", soon: "بيخلص قريب", expired: "منتهي", inactive: "موقوف", coach: "الكوتش" };

// عدد الأيام الباقية لحد نهاية الاشتراك
function daysLeft(end) {
  if (!end) return null;
  return Math.round((new Date(end) - new Date(today())) / 86400000);
}

export function memberStatus(p) {
  if (p.role === "coach") return "coach";
  if (!p.is_active) return "inactive";
  const d = daysLeft(p.subscription_end);
  if (d !== null && d < 0) return "expired";
  if (d !== null && d <= 7) return "soon";
  return "active";
}

// يزوّد شهور على تاريخ (لو الاشتراك منتهي نبدأ من النهارده)
function addMonths(from, n) {
  const base = from && from > today() ? from : today();
  let [y, m, day] = base.split("-").map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  // لو الشهر الجديد أقصر (31 يناير + شهر) ناخد آخر يوم فيه
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

const fmt = (iso) => iso ? new Date(iso).toLocaleDateString("ar-EG", { day: "numeric", month: "short", year: "numeric" }) : "—";

export async function renderMembers(main, { stale }) {
  main.innerHTML = `<p class="loading">بيحمّل المتدربين…</p>`;
  const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
  if (stale()) return;
  if (error) { main.innerHTML = `<div class="empty">ما قدرناش نجيب الحسابات: ${esc(error.message)}</div>`; return; }
  list = data;
  draw(main);
}

function draw(main) {
  const members = list.filter((p) => p.role !== "coach");
  const counts = { all: members.length, active: 0, soon: 0, expired: 0, inactive: 0 };
  members.forEach((p) => counts[memberStatus(p)]++);

  const q = search.toLowerCase();
  const shown = members.filter((p) =>
    (filter === "all" || memberStatus(p) === filter) &&
    (!q || [p.full_name, p.phone, p.email].some((x) => (x || "").toLowerCase().includes(q))));

  const tile = (k, label) => `<button type="button" data-filter="${k}" aria-pressed="${filter === k}"><b>${counts[k]}</b><span>${label}</span></button>`;

  const rows = shown.map((p) => {
    const st = memberStatus(p), d = daysLeft(p.subscription_end);
    const left = p.is_active && d !== null ? (d >= 0 ? `فاضل ${d} يوم` : `خلص من ${-d} يوم`) : "";
    return `<tr data-id="${p.id}">
      <td class="who"><b>${esc(p.full_name || "من غير اسم")}</b><span>${esc(p.phone)}</span><br><span>${esc(p.email)}</span></td>
      <td>${fmt(p.created_at)}</td>
      <td><input type="date" value="${p.subscription_end || ""}" data-end aria-label="نهاية اشتراك ${esc(p.full_name)}"><span class="days-left">${left}</span></td>
      <td><span class="pill ${st}">${STATUS_LABEL[st]}</span></td>
      <td><div class="acts">
        ${p.is_active
          ? `<button class="btn btn-ghost btn-sm" type="button" data-toggle>إيقاف</button>`
          : `<button class="btn btn-ink btn-sm" type="button" data-toggle>تفعيل</button>`}
        <button class="btn btn-ghost btn-sm" type="button" data-add="1">+ شهر</button>
        <button class="btn btn-ghost btn-sm" type="button" data-add="3">+ ٣ شهور</button>
      </div></td>
    </tr>`;
  }).join("");

  main.innerHTML = `
    <div class="view-head"><div><h1>المتدربين</h1><p>فعّل الحساب أول ما المشترك يدفع، وحدد آخر يوم في اشتراكه. لما التاريخ يعدّي، التمارين بتتقفل عنده لوحدها.</p></div></div>
    <div class="summary">
      ${tile("all", "كل الحسابات")}${tile("active", "مفعّل")}${tile("soon", "بيخلص خلال ٧ أيام")}${tile("expired", "منتهي")}${tile("inactive", "موقوف أو مستني تفعيل")}
    </div>
    <div class="toolbar"><input type="search" id="m-search" placeholder="دوّر بالاسم أو الرقم أو الإيميل" value="${esc(search)}"></div>
    ${shown.length
      ? `<div class="table-wrap"><table class="members"><thead><tr><th>المتدرب</th><th>اتسجّل</th><th>نهاية الاشتراك</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<div class="empty">${members.length ? "مفيش حسابات بالشكل ده." : "لسه محدش عمل حساب. ابعت للمشتركين لينك صفحة الدخول."}</div>`}`;

  main.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => { filter = b.dataset.filter; draw(main); }));
  const s = main.querySelector("#m-search");
  s.oninput = () => { search = s.value; draw(main); const n = main.querySelector("#m-search"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };

  main.querySelectorAll("tr[data-id]").forEach((tr) => {
    const p = list.find((x) => x.id === tr.dataset.id);
    tr.querySelector("[data-toggle]").onclick = () => {
      const patch = { is_active: !p.is_active };
      // أول تفعيل من غير تاريخ؟ نديله شهر
      if (patch.is_active && !p.subscription_end) patch.subscription_end = addMonths(null, 1);
      save(main, p, patch, patch.is_active ? "الحساب اتفعّل" : "الحساب اتوقف");
    };
    tr.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => {
      const n = +b.dataset.add;
      save(main, p, { is_active: true, subscription_end: addMonths(p.subscription_end, n) }, `الاشتراك اتمد ${n === 1 ? "شهر" : n + " شهور"}`);
    }));
    tr.querySelector("[data-end]").onchange = (e) =>
      save(main, p, { subscription_end: e.target.value || null }, "تاريخ النهاية اتغيّر");
  });
}

async function save(main, p, patch, okText) {
  const { data, error } = await supabase.from("profiles").update(patch).eq("id", p.id).select().single();
  if (error) return toast("ما اتحفظش: " + error.message, true);
  Object.assign(p, data);
  draw(main);
  toast(okText);
}
