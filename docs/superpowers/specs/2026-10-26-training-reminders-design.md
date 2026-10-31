# تذكير بموعد التمرين (Web Push): التصميم

التاريخ: 2026-10-26 · الحالة: موافق عليه، لسه ما اتنفّذش

## الهدف
المتدرب يختار أيام تمرينه وساعة التذكير من صفحة حسابه، ويوصله إشعار على موبايله في الميعاد ده حتى لو الموقع مقفول.

## القرارات
| القرار | الاختيار | السبب |
|---|---|---|
| مين يحدد الموعد | المتدرب نفسه من `#account` | مفيش مفهوم موعد في الخطة دلوقتي، والمتدرب أعرف بوقته |
| قناة الإرسال | Web Push بس | مجاني، الموقع PWA وفيه `sw.js` أصلاً، ومن غير خدمة خارجية |
| الجدولة | `pg_cron` → `pg_net` → Edge Function كل 15 دقيقة | كله جوه Supabase، ومفيش سيرفر شغال طول الوقت |
| دقة الساعة | ربع ساعة (6:00، 6:15…) | التشغيل كل 15 دقيقة بدل كل دقيقة بيقلل السجل والتشغيل 15 مرة |
| التوقيت | `Africa/Cairo` لكل المتدربين | كل المتدربين في مصر، ومنتخزّنش timezone لكل واحد |
| عدد التذكيرات | مرة واحدة في اليوم كحد أقصى | `last_sent_on` بيمنع التكرار |

**برّه النطاق:** إيميل كبديل، إشعار يدوي من الكوتش، أكتر من ساعة في اليوم، timezone لكل متدرب.

## البنية
```
المتدرب (account.js) ──subscribe──► push_subscriptions
            └──الأيام والساعة──────► training_reminders
pg_cron (كل 15 دقيقة) ──net.http_post + سر من Vault──► Edge Function send-reminders
send-reminders ──service_role──► يقرا الجدولين + profiles
               ──web-push (VAPID)──► سيرفر الـ push (Google / Apple / Mozilla) ──► sw.js ──► إشعار
```

## قاعدة البيانات: قسم `-- 7.14` في `supabase/schema.sql` (قبل `-- 8)`)
كله idempotent (`if not exists` / `drop policy if exists`) زي باقي الملف.

### `training_reminders`
| العمود | النوع | ملاحظات |
|---|---|---|
| `member_id` | `uuid primary key default auth.uid() references profiles(id) on delete cascade` | صف واحد لكل متدرب |
| `days` | `smallint[] not null default '{}'` | أرقام زي `extract(dow)` في Postgres: 0 = الأحد … 6 = السبت. check إن كل قيمة بين 0 و6 |
| `remind_at` | `time not null` | check: `extract(minute from remind_at)::int % 15 = 0` و`extract(second from remind_at) = 0` |
| `enabled` | `boolean not null default true` | |
| `last_sent_on` | `date` | الـ function بس هي اللي بتكتبه |

RLS:
- `select`: صاحب الصف أو الكوتش.
- `insert` / `update` / `delete`: صاحب الصف بس (`member_id = auth.uid()`).
- المتدرب ما يقدرش يغيّر `last_sent_on`: `revoke insert, update on training_reminders from authenticated`، وبعدها `grant insert (member_id, days, remind_at, enabled), update (days, remind_at, enabled)` بس. كده الـ `upsert` من الواجهة شغال، والعمود ده للـ function بس.

### `push_subscriptions`
| العمود | النوع | ملاحظات |
|---|---|---|
| `id` | `bigint generated always as identity primary key` | |
| `member_id` | `uuid not null default auth.uid() references profiles(id) on delete cascade` | |
| `endpoint` | `text not null unique` | check على الطول (≤ 1000) |
| `p256dh` | `text not null` | |
| `auth` | `text not null` | |
| `created_at` | `timestamptz not null default now()` | |

RLS: `select` / `insert` / `delete` لصاحب الصف بس. الكوتش مش محتاجها. الـ function بتستخدم `service_role`.

لو نفس الجهاز اتسجّل بحساب تاني، الـ `endpoint` هيبقى مكرر. الواجهة بتعمل `delete` للـ endpoint بتاعها قبل الـ `insert`. لو الصف القديم بتاع حساب تاني، الـ RLS هيمنع مسحه والـ insert هيفشل بـ unique violation. وقتها بنعرض رسالة، والحالة دي نادرة. ونفس الحاجة لما المتدرب يعمل logout: بنعمل `unsubscribe` ونمسح الصف.

### الـ cron
```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- السر بيتحط يدوياً مرة واحدة في Vault باسم 'reminders_secret' (مش في الملف ده)
select cron.schedule('send-reminders', '*/15 * * * *', $$
  select net.http_post(
    url     := 'https://<project>.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' ||
               (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_secret'))
  ) $$);
select cron.schedule('cleanup-cron-log', '0 3 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);
```
`cron.schedule` بنفس الاسم بيعمل update للـ job، فإعادة تشغيل الملف آمنة.

## الـ Edge Function: `supabase/functions/send-reminders/index.ts`
1. ترفض أي طلب الـ `Authorization` بتاعه مش مطابق لـ `REMINDERS_SECRET`.
2. تحسب "دلوقتي" بتوقيت `Africa/Cairo`، وتقرّبه لأقرب ربع ساعة قبله (`slot`) وتطلّع رقم اليوم (`dow`) وتاريخ النهارده.
3. تعمل query بـ `service_role`: كل المتدربين اللي عندهم:
   - `enabled = true`
   - `dow = any(days)`
   - `remind_at = slot`
   - `last_sent_on` فاضي أو قبل النهارده
   - `profiles.is_active = true`
   - `subscription_end` فاضي أو النهارده أو بعده

   ومعاهم كل صفوف `push_subscriptions` بتاعتهم.
4. لكل جهاز: `webpush.sendNotification(sub, JSON.stringify({ title: "MoFit", body: "ميعاد تمرينك النهارده 💪", url: "/app.html#plan" }))` بمفاتيح VAPID اللي في الـ secrets.
5. لو الرد 404 أو 410: نمسح الصف ده من `push_subscriptions`. أي غلط تاني بيتسجّل في الـ log ونكمّل للي بعده.
6. نعمل `update last_sent_on = today` للمتدربين اللي اتبعتلهم.

**لو الـ cron اتأخر:** المقارنة بـ `remind_at = slot` معناها إن لو تشغيلة فاتت، تذكير الربع ساعة دي مش هيتبعت. ده مقبول، لأن تذكير متأخر نص ساعة أوحش من إنه ما يوصلش. لو اكتشفنا إن ده بيحصل كتير، نغيّرها لـ `remind_at <= slot` مع `last_sent_on`.

Secrets الـ function: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` للمالك), `REMINDERS_SECRET`. أما `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` فموجودين تلقائي.

أول خطوة في التنفيذ: نتأكد إن `npm:web-push` شغال على Deno في Edge Functions. لو مش شغال، نستخدم مكتبة Web Push بتدعم Deno.

## الواجهة
- **`js/config.js`:** نضيف `VAPID_PUBLIC_KEY`. المفتاح العام آمن.
- **`js/views/account.js`:** قسم "تذكير التمرين" يظهر للمتدرب بس:
  - 7 أزرار للأيام بالترتيب المصري (السبت ← الجمعة)، بتتخزّن بأرقام `dow`.
  - `<select>` للساعة بالربع ساعة، بصيغة 12 ساعة (ص/م).
  - زرار حفظ: بيعمل `upsert` في `training_reminders`.
  - زرار "فعّل الإشعارات على الجهاز ده" بيعمل `Notification.requestPermission()`، وبعدها `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`، وبعدها `insert` في `push_subscriptions`.
  - الحالات اللي بنعرضها:
    - لو المتصفح مش بيدعم (`!("PushManager" in window)`): "المتصفح ده مش بيدعم الإشعارات".
    - لو `isIOS() && !isInstalled()`: "ضيف الموقع للشاشة الرئيسية الأول" (من `js/pwa.js`).
    - لو الإذن `denied`: "الإشعارات مقفولة من إعدادات المتصفح".
    - لو مشترك: "الإشعارات شغالة على الجهاز ده"، ومعاها زرار إيقاف.
  - بعد كل `await` نتأكد من `ctx.stale()`، ونستخدم `toast` من `js/ui.js`.
- **`sw.js`:** نزوّد رقم `CACHE`، ونضيف:
  - `push`: `self.registration.showNotification(title, { body, icon, data: { url } })`.
  - `notificationclick`: يقفل الإشعار، ويروح لتاب مفتوح لو فيه، وإلا يفتح `data.url`.
- **CSP (`_headers`):** مش محتاجة تتغيّر، لأن المتصفح بيكلّم سيرفر الـ push لوحده من غير `fetch` من صفحتنا. هنتأكد من ده في التجربة.

## الاختبار
- **`supabase/tests/reminders_rls.sql`:** على نفس طريقة `workout_rls.sql` (جوه transaction وبتنتهي بـ rollback). بنتأكد إن:
  - المتدرب يقرا ويكتب صفه بس، وما يقدرش يقرا صف متدرب تاني.
  - المتدرب ما يقدرش يغيّر `last_sent_on`.
  - الكوتش يقرا `training_reminders`، وما يقراش `push_subscriptions`.
  - الزائر (anon) ما يشوفش أي حاجة.
- **`.github/scripts/health-check.sh`:** نضيف `training_reminders push_subscriptions` للقائمة في سطر `for table in ...`.
- **حساب الـ slot:** دالة صغيرة في الـ function معمولها self-check بـ assert على حالات حدّية: 6:14 ترجع 6:00، و23:59 ترجع 23:45، وعند منتصف الليل اليوم بيتغيّر.
- **يدوي على مشروع Supabase تجريبي:** نضبط ميعاد بعد ربع ساعة على Android (Chrome) وآيفون مثبّت عليه الموقع، ونتأكد إن:
  - الإشعار وصل مرة واحدة.
  - الضغط عليه بيفتح `#plan`.
  - الاشتراك اللي اتلغى بيتمسح بعد الـ 410.

## الاستهلاك (الخطة المجانية)
- **المساحة:** الجدولين أقل من 1MB حتى مع مئات المتدربين. سجل الـ cron بيتمسح كل يوم، ومش هيعدّي أيام قليلة من التشغيل.
- **الـ Edge Function:** حوالي 2,900 تشغيلة في الشهر، والمجاني 500 ألف. كل تشغيلة واخدة أقل بكتير من حد الـ CPU (ثانيتين).
- **مشروع متوقف (paused) = تذكيرات واقفة:** المتدربين بيفتحوا الموقع يومياً، فده مش متوقع يحصل.

## التطبيق على الحقيقي (بعد الدمج، شخص واحد)
1. نشغّل قسم `7.14` من `schema.sql`. لازم الأول نتأكد إن `pg_cron` و`pg_net` بيتفعّلوا على الخطة.
2. نعمل مفاتيح VAPID (`npx web-push generate-vapid-keys`). العام يتحط في `config.js`، والسري يتحط في secrets الـ function.
3. نعمل `REMINDERS_SECRET` عشوائي، ونحطه في secrets الـ function وفي Vault باسم `reminders_secret`.
4. `supabase functions deploy send-reminders --no-verify-jwt`. الحماية هنا بالسر بتاعنا، مش بـ JWT.

## الملفات اللي هتتلمس
`supabase/schema.sql` و`sw.js` و`js/config.js` و`js/views/account.js` و`css/app.css` (لو احتجنا) و`.github/scripts/health-check.sh`، وملفات جديدة: `supabase/functions/send-reminders/index.ts` و`supabase/tests/reminders_rls.sql`.

الملفات اللي بتتعارض كتير ومحتاجين نبلّغ قبل ما نعدّل فيها: `schema.sql` و`sw.js` و`css/app.css`.
