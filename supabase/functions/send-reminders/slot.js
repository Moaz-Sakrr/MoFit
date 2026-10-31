// الربع ساعة الحالية بتوقيت القاهرة: رقم اليوم (0 = الأحد زي extract(dow))، والساعة، وتاريخ النهارده
const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "Africa/Cairo", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
});
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function cairoSlot(date) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const min = String(Math.floor(+p.minute / 15) * 15).padStart(2, "0");
  return { dow: DOW[p.weekday], time: `${p.hour}:${min}:00`, today: `${p.year}-${p.month}-${p.day}` };
}
