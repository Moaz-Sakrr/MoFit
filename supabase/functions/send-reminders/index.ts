// بتتنادى من pg_cron كل 15 دقيقة (schema.sql 7.13). بتبعت إشعار لكل متدرب ميعاده الربع ساعة دي.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { cairoSlot } from "./slot.js";

const env = (k: string) => (Deno.env.get(k) ?? "").trim();
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const payload = JSON.stringify({ title: "MoFit", body: "ميعاد تمرينك النهارده 💪", url: "/app.html#plan" });

Deno.serve(async (req) => {
  if (!env("REMINDERS_SECRET") || req.headers.get("Authorization") !== `Bearer ${env("REMINDERS_SECRET")}`) return new Response("forbidden", { status: 403 });
  // جوه الطلب مش برّه: لو مفاتيح VAPID غلط نرجّع السبب بدل ما الـ function كلها تقع
  try { webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY")); }
  catch (e) { console.error("VAPID config:", e); return new Response("VAPID config: " + (e as Error).message, { status: 500 }); }

  const { dow, time, today } = cairoSlot(new Date());
  // training_reminders.member_id → profiles فالـ inner join شغال. push_subscriptions مالهاش FK مباشر مع التذكيرات، فبتتجاب في query لوحدها
  const { data: due, error } = await db.from("training_reminders")
    .select("member_id, profiles!inner(is_active, subscription_end)")
    .eq("enabled", true).eq("remind_at", time).contains("days", [dow])
    .or(`last_sent_on.is.null,last_sent_on.lt.${today}`)
    .eq("profiles.is_active", true)
    .or(`subscription_end.is.null,subscription_end.gte.${today}`, { referencedTable: "profiles" });
  if (error) { console.error(error); return new Response(error.message, { status: 500 }); }
  const ids = (due ?? []).map((r) => r.member_id);
  if (!ids.length) return Response.json({ sent: 0, removed: 0, failed: 0 });

  const { data: subs, error: subErr } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("member_id", ids);
  if (subErr) { console.error(subErr); return new Response(subErr.message, { status: 500 }); }

  let sent = 0, removed = 0, failed = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      // 404/410: الاشتراك اتلغى من المتصفح، فنمسحه
      if (e?.statusCode === 404 || e?.statusCode === 410) { await db.from("push_subscriptions").delete().eq("id", s.id); removed++; }
      else { failed++; console.error(s.endpoint, e?.statusCode, e?.body ?? e); }
    }
  }
  // بنعلّم الكل حتى اللي ما عندوش جهاز، عشان ما نعيدش الـ query عليهم لحد بكرة
  await db.from("training_reminders").update({ last_sent_on: today }).in("member_id", ids);
  return Response.json({ sent, removed, failed });
});
