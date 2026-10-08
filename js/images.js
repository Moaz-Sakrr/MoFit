// تصغير الصورة قبل الرفع عشان الصفحات تفضل خفيفة والرفع يخلص بسرعة
export async function compressImage(file, max = 1200, quality = 0.82) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("الصورة مش مقروءة"))), "image/jpeg", quality));
}
