// اشتراك الجهاز ده في إشعارات تذكير التمرين (Web Push)
import { supabase } from "./supabase.js";
import { VAPID_PUBLIC_KEY } from "./config.js";
import { isIOS, isInstalled } from "./pwa.js";

const supported = () => !!VAPID_PUBLIC_KEY && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
// getRegistration مش ready: ready بيستنى للأبد لو الـ service worker ما اتسجّلش، وده كان هيعلّق الخروج
const current = async () => (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() ?? null;

export async function pushState() {
  // الآيفون مش بيدّي Push غير للموقع المثبّت على الشاشة الرئيسية
  if (isIOS() && !isInstalled()) return "needs-install";
  if (!supported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return (await current()) ? "on" : "off";
}

// المفتاح لازم يتحوّل من base64url لـ bytes
const key = (b64) => Uint8Array.from(atob((b64 + "===".slice((b64.length + 3) % 4)).replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function enablePush() {
  if (await Notification.requestPermission() !== "granted") throw new Error("لازم تسمح بالإشعارات من المتصفح");
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC_KEY) });
  const { endpoint, keys } = sub.toJSON();
  // لو الجهاز ده كان متسجّل بنفس الحساب قبل كده، نمسح القديم ونسجّل من جديد
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  const { error } = await supabase.from("push_subscriptions").insert({ endpoint, p256dh: keys.p256dh, auth: keys.auth });
  if (error) {
    await sub.unsubscribe();
    // 23505: الجهاز ده متسجّل بحساب تاني
    throw new Error(error.code === "23505" ? "الجهاز ده متسجّل بحساب تاني. سجّل خروج منه الأول" : "ما اتفعّلتش: " + error.message);
  }
}

export async function disablePush() {
  try {
    if (!supported()) return;
    const sub = await current();
    if (!sub) return;
    await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe();
  } catch { /* الخروج أو الإيقاف ما يقفش بسبب الإشعارات */ }
}
