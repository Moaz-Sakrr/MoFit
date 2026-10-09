// الصفحة الرئيسية: السنة في الفوتر، وسلايدر المقارنة قبل وبعد للصور الثابتة
document.getElementById("year").textContent = new Date().getFullYear();
document.querySelectorAll(".compare input").forEach((r) =>
  r.addEventListener("input", () => r.parentElement.style.setProperty("--pos", r.value + "%")));
