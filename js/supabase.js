// اتصال واحد بـ Supabase بيستخدمه الموقع كله
// المكتبة متحمّلة محلياً (supabase-js 2.117.3) بدل CDN، عشان محدش من بره يقدر يبدّل الكود اللي بيشوف جلسة الدخول
import { createClient } from "./vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const isConfigured = !SUPABASE_URL.includes("YOUR-PROJECT");

// يجيب بيانات الحساب اللي داخل دلوقتي (أو null لو مش داخل)
export async function getCurrentProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data, error } = await supabase
    .from("profiles").select("*").eq("id", session.user.id).single();
  if (error) throw error;
  return data;
}

export function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// يحوّل أي حرف خاص لنص عادي قبل ما نحطه في الصفحة
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
