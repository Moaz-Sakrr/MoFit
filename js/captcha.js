// حماية Cloudflare Turnstile: بتتأكد إن اللي بيسجّل دخول أو بيعمل حساب إنسان مش برنامج.
// لو TURNSTILE_SITE_KEY فاضي في config.js الحماية بتبقى مقفولة والموقع بيشتغل عادي.
import { TURNSTILE_SITE_KEY } from "./config.js";

export const captchaEnabled = !!TURNSTILE_SITE_KEY;

let api;
const loadApi = () => (api ||= new Promise((ok, no) => {
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true; s.onload = ok; s.onerror = () => no(new Error("turnstile"));
  document.head.appendChild(s);
}));

// يرسم الودجت جوه box، ويرجّع token() بيستنى الكود لحد ما يجهز، و reset() بعد كل محاولة (الكود بيتستخدم مرة واحدة)
export function mountCaptcha(box) {
  if (!captchaEnabled) return { token: async () => undefined, reset() {} };
  let tok = null, id = null, waiting = [];
  const done = (t) => { tok = t; if (t) waiting.splice(0).forEach((w) => w(t)); };
  loadApi().then(() => {
    id = window.turnstile.render(box, {
      sitekey: TURNSTILE_SITE_KEY, appearance: "interaction-only", theme: "dark", language: "ar",
      callback: done, "expired-callback": () => done(null), "error-callback": () => done(null),
    });
  }).catch(() => {});
  return {
    token: () => (tok ? Promise.resolve(tok) : new Promise((res) => { waiting.push(res); setTimeout(() => res(null), 15000); })),
    reset() { tok = null; if (id !== null) window.turnstile.reset(id); },
  };
}
