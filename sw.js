// Service worker بسيط: بيخلّي الموقع يتثبّت كتطبيق، ومش بيخزّن حاجة قديمة.
// بنجيب من النت الأول دايماً، ولو مفيش نت بنرجع لآخر نسخة اتفتحت. طلبات Supabase والفيديو مش بتعدّي عليه.
const CACHE = "mofit-v6";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // no-cache: نسأل السيرفر كل مرة لو الملف اتغيّر، عشان cache المتصفح ما يرجّعش نسخة قديمة بعد أي تحديث
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === "navigate" ? caches.match("app.html") : Response.error())))
  );
});

// إشعار تذكير التمرين جاي من Edge Function send-reminders
self.addEventListener("push", (e) => {
  const d = e.data?.json() ?? {};
  e.waitUntil(self.registration.showNotification(d.title || "MoFit", {
    body: d.body || "", icon: "images/icons/icon-192.png", badge: "images/icons/icon-192.png", lang: "ar", dir: "rtl",
    data: { url: d.url || "/app.html" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data.url, self.location.origin).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
    const tab = all.find((c) => new URL(c.url).origin === self.location.origin);
    // navigate بيفشل لو التاب مش تحت تحكم الـ service worker، فساعتها نفتح تاب جديد
    return tab ? tab.navigate(url).then((c) => (c || tab).focus()).catch(() => clients.openWindow(url)) : clients.openWindow(url);
  }));
});
