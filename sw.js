// Service worker بسيط: بيخلّي الموقع يتثبّت كتطبيق، ومش بيخزّن حاجة قديمة.
// بنجيب من النت الأول دايماً، ولو مفيش نت بنرجع لآخر نسخة اتفتحت. طلبات Supabase والفيديو مش بتعدّي عليه.
const CACHE = "mofit-v2";

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
    fetch(req)
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
