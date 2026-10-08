// تثبيت الموقع كتطبيق على الموبايل: تسجيل الـ service worker، وزر التثبيت لما المتصفح يدعمه
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

let deferred = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  dispatchEvent(new Event("mofit-installable"));
});
addEventListener("appinstalled", () => { deferred = null; dispatchEvent(new Event("mofit-installed")); });

export const isInstalled = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const canPrompt = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  return outcome === "accepted";
}
