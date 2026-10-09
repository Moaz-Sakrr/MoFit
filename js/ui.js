// أدوات صغيرة بتستخدمها كل الصفحات: رسالة تحت الشاشة، ونافذة تعديل
import { esc } from "./supabase.js";

let toastTimer;
export function toast(text, bad = false) {
  const t = document.getElementById("toast");
  t.textContent = text;
  t.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = "toast"), 2800);
}

/*
  openSheet: يفتح نافذة فيها فورم
  fields: [{ k: "name", label: "الاسم", type: "text|textarea|select|number|file|checkbox", multiple (للملفات), options: [[value, label]], hint, ltr, tall }]
  onSave(values): بترجع Promise. لو رمت خطأ النافذة بتفضل مفتوحة
*/
export function openSheet({ title, fields, values = {}, saveLabel = "حفظ", onSave }) {
  const dlg = document.getElementById("sheet");
  const form = document.getElementById("sheet-form");
  const html = fields.map((f) => {
    const id = "s-" + f.k, v = values[f.k] ?? "";
    const dir = f.ltr ? ' dir="ltr"' : "";
    const req = f.required ? " required" : "";
    let input;
    if (f.type === "textarea") input = `<textarea id="${id}" name="${f.k}" class="${f.tall ? "tall" : ""}"${dir}${req}>${esc(v)}</textarea>`;
    else if (f.type === "select") input = `<select id="${id}" name="${f.k}">${f.options.map(([ov, ol]) => `<option value="${esc(ov)}"${String(v) === String(ov) ? " selected" : ""}>${esc(ol)}</option>`).join("")}</select>`;
    else if (f.type === "file") input = `<input id="${id}" name="${f.k}" type="file" accept="${f.accept || "image/*"}"${f.multiple ? " multiple" : ""}${req}>`;
    else if (f.type === "checkbox") return `<div class="field check"><label for="${id}"><input id="${id}" name="${f.k}" type="checkbox"${v ? " checked" : ""}><span>${esc(f.label)}</span></label>${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</div>`;
    else input = `<input id="${id}" name="${f.k}" type="${f.type || "text"}" value="${esc(v)}" placeholder="${esc(f.ph || "")}"${dir}${req}>`;
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</div>`;
  }).join("");
  form.innerHTML = `<h2>${esc(title)}</h2>${html}
    <p class="notice bad" id="sheet-err" hidden></p>
    <div class="foot"><button class="btn btn-ink" type="submit">${esc(saveLabel)}</button><button class="btn btn-ghost" type="button" id="sheet-cancel">إلغاء</button></div>`;
  form.querySelector("#sheet-cancel").onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const out = {};
    fields.forEach((f) => {
      const el = form.elements[f.k];
      out[f.k] = f.type === "file" ? (f.multiple ? [...el.files] : el.files[0] || null)
        : f.type === "checkbox" ? el.checked : el.value.trim();
    });
    const btn = e.submitter; btn.disabled = true;
    const label = btn.textContent; btn.textContent = "جاري الحفظ…";
    try { await onSave(out); dlg.close(); }
    catch (err) {
      const box = form.querySelector("#sheet-err");
      box.textContent = "ما اتحفظش: " + (err.message || err);
      box.hidden = false;
    }
    btn.disabled = false; btn.textContent = label;
  };
  dlg.showModal();
  form.querySelector("input,textarea")?.focus();
}

// هيكل رمادي متحرك بيظهر لحد ما البيانات توصل. kind: rows (تمارين) | cards (كروت وصور) | list (متدربين)
const sk = (cls) => `<span class="sk ${cls}"></span>`;
const times = (n, fn) => Array.from({ length: n }, fn).join("");
export function loadingView(kind = "rows") {
  const head = `<div class="sk-head">${sk("sk-title")}${sk("sk-line w60")}</div>`;
  const body = kind === "cards"
    ? `<div class="res-admin-grid">${times(3, () => `<div class="res-admin">${sk("sk-img")}${sk("sk-line w60")}${sk("sk-line w40")}</div>`)}</div>`
    : kind === "list"
      ? `<div class="sk-list">${times(5, () => sk("sk-block"))}</div>`
      : `<ul class="rows">${times(4, () => `<li class="row">${sk("sk-thumb")}<div class="row-body">${sk("sk-line w60")}${sk("sk-line")}${sk("sk-line w40")}</div></li>`)}</ul>`;
  return `<div class="sk-view" role="status" aria-label="بيحمّل"><span class="sr-only">بيحمّل…</span>${head}${body}</div>`;
}

// نافذة تأكيد بسيطة (بدل confirm)
export function confirmSheet(title, text, onYes, yesLabel = "احذف") {
  const dlg = document.getElementById("sheet");
  const form = document.getElementById("sheet-form");
  form.innerHTML = `<h2>${esc(title)}</h2><p class="sheet-text">${esc(text)}</p>
    <div class="foot"><button class="btn btn-ink" type="submit">${esc(yesLabel)}</button><button class="btn btn-ghost" type="button" id="sheet-cancel">إلغاء</button></div>`;
  form.querySelector("#sheet-cancel").onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await onYes(); dlg.close(); } catch (err) { toast("حصلت مشكلة: " + err.message, true); }
  };
  dlg.showModal();
}
