// شغّله: node supabase/functions/send-reminders/slot.test.js
import assert from "node:assert/strict";
import { cairoSlot } from "./slot.js";

// 2026-12-07 الاتنين. القاهرة UTC+2 في الشتا (التوقيت الصيفي بيخلص آخر خميس في أكتوبر)
assert.deepEqual(cairoSlot(new Date("2026-12-07T04:14:59Z")), { dow: 1, time: "06:00:00", today: "2026-12-07" });
assert.deepEqual(cairoSlot(new Date("2026-12-07T04:15:00Z")), { dow: 1, time: "06:15:00", today: "2026-12-07" });
assert.deepEqual(cairoSlot(new Date("2026-12-07T21:59:00Z")), { dow: 1, time: "23:45:00", today: "2026-12-07" });
// بعد منتصف الليل في القاهرة اليوم بيتغيّر حتى لو لسه نفس اليوم بـ UTC
assert.deepEqual(cairoSlot(new Date("2026-12-07T22:05:00Z")), { dow: 2, time: "00:00:00", today: "2026-12-08" });
// التوقيت الصيفي (UTC+3) في يوليو
assert.deepEqual(cairoSlot(new Date("2026-07-15T15:31:00Z")), { dow: 3, time: "18:30:00", today: "2026-07-15" });
console.log("slot ok");
