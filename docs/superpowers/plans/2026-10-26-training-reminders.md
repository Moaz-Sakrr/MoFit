# تذكير بموعد التمرين: خطة التنفيذ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** المتدرب يختار أيامه وساعة التذكير من `#account`، وكل 15 دقيقة `pg_cron` بيشغّل Edge Function تبعت Web Push للي ميعادهم جه.

**Architecture:** جدولين جداد في قسم `-- 7.13` في `schema.sql`، وEdge Function `send-reminders` (Deno) بتتنادى من `pg_cron` عن طريق `pg_net` بسر متخزّن في Vault. وفي الواجهة: موديول صغير `js/push.js` للاشتراك وإلغائه، وقسم في `account.js`، وhandlers في `sw.js`.

**Tech Stack:** HTML وES modules من غير build، وSupabase (Postgres وRLS و`pg_cron` و`pg_net` وVault وEdge Functions)، و`npm:web-push` جوه Deno، وNode 20 لتشغيل self-check دالة الوقت.

**Spec:** `docs/superpowers/specs/2026-10-26-training-reminders-design.md`

## Global Constraints
- رقم القسم في `schema.sql` هو **`7.13`**، مش 7.12 زي ما الـ spec كاتب، لأن `7.12` اتاخد في develop لـ "حدود ضد ملء المخزن". القسم الجديد يتحط بعد `7.12` وقبل `-- 8)`.
- `schema.sql` لازم يفضل idempotent: `if not exists` و`drop policy if exists` و`cron.schedule` بالاسم.
- مفيش inline `<script>` ولا `style="..."` ولا CDN في الواجهة، والتنسيق في `css/app.css`.
- كل النصوص اللي بتظهر للمستخدم بالعربي (لهجة مصرية).
- بعد كل `await` في الـ view: `if (ctx.stale() || !box.isConnected) return;`
- رسايل المستخدم بـ `toast` من `js/ui.js`، وأي نص جاي من قاعدة البيانات بيعدّي على `esc()`.
- التوقيت: `Africa/Cairo`. وأرقام الأيام زي `extract(dow)`: 0 = الأحد … 6 = السبت.
- الساعة على ربع ساعة بس (`:00`، `:15`، `:30`، `:45`).
- نص الإشعار: العنوان `MoFit`، والنص `ميعاد تمرينك النهارده 💪`، والرابط `/app.html#plan`.
- الـ commits من غير `Co-Authored-By` ولا أي إشارة لـ Claude. ممنوع `git push`.
- ممنوع commit لأي مفتاح سري أو لتعديل `js/config.js` بتاع مشروع تجريبي. المفتاح العام بتاع VAPID بس هو اللي يتعمله commit، وده في Task 5.

---

### Task 1: الجداول والصلاحيات (قسم 7.13) واختبار RLS

**Files:**
- Modify: `supabase/schema.sql`: نضيف بعد آخر سطر في قسم `7.12` (`exercises_name_len`) وقبل `-- 8)`.
- Create: `supabase/tests/reminders_rls.sql`
- Modify: `.github/scripts/health-check.sh:42`
- Modify: `docs/superpowers/specs/2026-10-26-training-reminders-design.md`: نغيّر `7.12` لـ `7.13` في كل مكان.

**Interfaces:**
- Produces: `public.training_reminders(member_id uuid pk, days smallint[], remind_at time, enabled bool, last_sent_on date)` و`public.push_subscriptions(id, member_id, endpoint unique, p256dh, auth, created_at)`. الأعمدة اللي المتدرب يقدر يكتبها في `training_reminders`: `member_id, days, remind_at, enabled` (في الـ insert والـ update)، يعني كل حاجة ما عدا `last_sent_on`.

- [ ] **Step 1: اكتب اختبار الصلاحيات (هيفشل لأن الجداول مش موجودة)**

`supabase/tests/reminders_rls.sql`:
```sql
-- اختبار صلاحيات تذكير التمرين. شغّله في SQL Editor على مشروع تجريبي (مش الأساسي).
-- كل حاجة جوه transaction وبتتلغي في الآخر (rollback). لو عدّى كله هتشوف NOTICE: ALL PASS
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000c0', 'coach@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a1', 'a@t.test',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@t.test',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.profiles set role = 'coach', is_active = true where id = '00000000-0000-0000-0000-0000000000c0';
update public.profiles set is_active = true, subscription_end = current_date + 30 where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2');

create or replace function public.tst_as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function public.tst_expect_fail(sql text, what text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then return; end;
  raise exception 'FAIL: % (statement succeeded but should have failed)', what;
end $$;
create or replace function public.tst_expect_count(sql text, want int, what text) returns void language plpgsql as $$
declare got int;
begin
  execute 'select count(*) from (' || sql || ') q' into got;
  if got <> want then raise exception 'FAIL: % (got %, want %)', what, got, want; end if;
end $$;
create or replace function public.tst_expect_affected(sql text, want int, what text) returns void language plpgsql as $$
declare got int;
begin
  execute sql; get diagnostics got = row_count;
  if got <> want then raise exception 'FAIL: % (affected %, want %)', what, got, want; end if;
end $$;

-- A يحفظ تذكيره وجهازه
select public.tst_as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.training_reminders (days, remind_at) values ('{0,2,4}', '18:30');
insert into public.training_reminders (days, remind_at) values ('{1}', '07:00')
  on conflict (member_id) do update set days = excluded.days, remind_at = excluded.remind_at;
select public.tst_expect_count($$select 1 from public.training_reminders where days = '{1}'$$, 1, 'A upserts own reminder');
select public.tst_expect_fail($$update public.training_reminders set last_sent_on = current_date$$, 'member cannot set last_sent_on');
select public.tst_expect_fail($$insert into public.training_reminders (member_id, days, remind_at) values ('00000000-0000-0000-0000-0000000000b2', '{1}', '07:00')$$, 'cannot create reminder for someone else');
select public.tst_expect_fail($$update public.training_reminders set remind_at = '18:20'$$, 'time must be on a quarter hour');
select public.tst_expect_fail($$update public.training_reminders set days = '{7}'$$, 'day 7 rejected');
insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.test/a', 'k', 's');
select public.tst_expect_fail($$insert into public.push_subscriptions (member_id, endpoint, p256dh, auth) values ('00000000-0000-0000-0000-0000000000b2', 'https://push.test/x', 'k', 's')$$, 'cannot add device for someone else');

-- B ما يشوفش ولا يعدّل حاجة بتاعة A
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000b2');
select public.tst_expect_count('select 1 from public.training_reminders', 0, 'B cannot read A reminder');
select public.tst_expect_count('select 1 from public.push_subscriptions', 0, 'B cannot read A devices');
select public.tst_expect_affected($$update public.training_reminders set enabled = false$$, 0, 'B cannot update A reminder');
select public.tst_expect_affected($$delete from public.push_subscriptions$$, 0, 'B cannot delete A devices');

-- الكوتش يقرا التذكيرات بس، مش الأجهزة
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000c0');
select public.tst_expect_count('select 1 from public.training_reminders', 1, 'coach reads reminders');
select public.tst_expect_count('select 1 from public.push_subscriptions', 0, 'coach cannot read devices');

-- الزائر ما يشوفش حاجة (لازم نمسح claims الكوتش، وإلا auth.uid() هيفضل الكوتش)
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select public.tst_expect_count('select 1 from public.training_reminders', 0, 'anon cannot read reminders');
select public.tst_expect_count('select 1 from public.push_subscriptions', 0, 'anon cannot read devices');

-- A يمسح جهازه
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000a1');
select public.tst_expect_affected($$delete from public.push_subscriptions$$, 1, 'A deletes own device');

reset role;
do $$ begin raise notice 'ALL PASS'; end $$;
rollback;
```

- [ ] **Step 2: شغّله على المشروع التجريبي وتأكد إنه بيفشل**

افتح SQL Editor في المشروع التجريبي، والصق الملف وشغّله.
المتوقع: `ERROR: relation "public.training_reminders" does not exist`.

- [ ] **Step 3: أضف القسم في `schema.sql` بعد سطر `exercises_name_len` وقبل `-- 8)`**

```sql
-- 7.13) تذكير بموعد التمرين (Web Push) ---------------------------------------
-- المتدرب يختار أيامه وساعة التذكير. الـ Edge Function send-reminders بتتنادى من pg_cron كل 15 دقيقة
-- وبتقرا الجدولين بـ service_role. last_sent_on بتكتبه الـ function بس (عشان ما يتبعتش مرتين في اليوم).
create table if not exists public.training_reminders (
  member_id    uuid primary key default auth.uid() references public.profiles(id) on delete cascade,
  days         smallint[] not null default '{}' check (days <@ array[0,1,2,3,4,5,6]::smallint[]),
  remind_at    time not null check (extract(minute from remind_at)::int % 15 = 0 and extract(second from remind_at) = 0),
  enabled      boolean not null default true,
  last_sent_on date
);
create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  member_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  endpoint   text not null unique check (char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) <= 200),
  auth       text not null check (char_length(auth) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (member_id);
alter table public.training_reminders enable row level security;
alter table public.push_subscriptions enable row level security;

-- المتدرب ما يقدرش يكتب last_sent_on: الكتابة على الأعمدة دي بس
-- (member_id في الـ update لأن upsert بتاع PostgREST بيعمل set لكل أعمدة الطلب، والسياسة بتمنع تغييره لحد تاني)
revoke insert, update on public.training_reminders from anon, authenticated;
grant insert (member_id, days, remind_at, enabled), update (member_id, days, remind_at, enabled) on public.training_reminders to authenticated;

drop policy if exists "reminders read"   on public.training_reminders;
drop policy if exists "reminders insert" on public.training_reminders;
drop policy if exists "reminders update" on public.training_reminders;
drop policy if exists "reminders delete" on public.training_reminders;
create policy "reminders read"   on public.training_reminders for select using (member_id = auth.uid() or public.is_coach());
create policy "reminders insert" on public.training_reminders for insert with check (member_id = auth.uid());
create policy "reminders update" on public.training_reminders for update using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy "reminders delete" on public.training_reminders for delete using (member_id = auth.uid());

drop policy if exists "push subs read"   on public.push_subscriptions;
drop policy if exists "push subs insert" on public.push_subscriptions;
drop policy if exists "push subs delete" on public.push_subscriptions;
create policy "push subs read"   on public.push_subscriptions for select using (member_id = auth.uid());
create policy "push subs insert" on public.push_subscriptions for insert with check (member_id = auth.uid());
create policy "push subs delete" on public.push_subscriptions for delete using (member_id = auth.uid());
```

- [ ] **Step 4: شغّل الجزء الجديد بس من `schema.sql` على التجريبي، وبعده ملف الاختبار**

المتوقع: `NOTICE: ALL PASS`.

لو اختبار `member cannot set last_sent_on` فشل (يعني الـ update عدّى)، اتأكد إن الـ `revoke` اتنفّذ. Supabase بيدّي `authenticated` صلاحيات على الجدول كله افتراضياً.

- [ ] **Step 5: أضف الجدولين لفحص الحماية**

`.github/scripts/health-check.sh:42`:
```bash
for table in profiles exercises programs progress_photos feedback workout_plans workout_days workout_items workout_sessions set_logs training_reminders push_subscriptions; do
```

- [ ] **Step 6: صحّح رقم القسم في الـ spec**

غيّر كل `7.12` لـ `7.13` في `docs/superpowers/specs/2026-10-26-training-reminders-design.md`.

- [ ] **Step 7: اقرا الـ diff واعمل commit**

```bash
git diff
git add supabase/schema.sql supabase/tests/reminders_rls.sql .github/scripts/health-check.sh docs/superpowers/specs/2026-10-26-training-reminders-design.md
git commit -m "جداول تذكير التمرين واشتراكات الإشعارات بصلاحياتها (7.13)، واختبار RLS ليها"
```

---

### Task 2: حساب الربع ساعة بتوقيت القاهرة (دالة نقية + self-check)

**Files:**
- Create: `supabase/functions/send-reminders/slot.js`
- Create: `supabase/functions/send-reminders/slot.test.js`

**Interfaces:**
- Produces: `cairoSlot(date: Date) => { dow: number /*0..6, 0 = الأحد*/, time: string /*"HH:MM:00"*/, today: string /*"YYYY-MM-DD"*/ }`

- [ ] **Step 1: اكتب الـ self-check**

`supabase/functions/send-reminders/slot.test.js`:
```js
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
```

- [ ] **Step 2: شغّله وتأكد إنه بيفشل**

Run: `node supabase/functions/send-reminders/slot.test.js`
المتوقع: `ERR_MODULE_NOT_FOUND` بخصوص `slot.js`.

ملحوظة: مفيش `package.json` في الريبو، فالـ import بالصيغة دي محتاج امتداد `.js` وNode هيقرا الملف كـ ESM لو فيه `import`/`export`. لو Node قال إن الملف CommonJS، شغّله بـ `node --experimental-detect-module`. Node 20.19 بيكتشفها تلقائي.

- [ ] **Step 3: اكتب الدالة**

`supabase/functions/send-reminders/slot.js`:
```js
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
```

- [ ] **Step 4: شغّله وتأكد إنه عدّى**

Run: `node supabase/functions/send-reminders/slot.test.js`
المتوقع: `slot ok`

- [ ] **Step 5: commit**

```bash
git add supabase/functions/send-reminders/slot.js supabase/functions/send-reminders/slot.test.js
git commit -m "حساب الربع ساعة الحالية بتوقيت القاهرة لإرسال التذكيرات، مع self-check"
```

---

### Task 3: الـ Edge Function `send-reminders`

**Files:**
- Create: `supabase/functions/send-reminders/index.ts`

**Interfaces:**
- Consumes: `cairoSlot` (Task 2)، والجداول (Task 1)، و`profiles.is_active` و`profiles.subscription_end`.
- Produces: endpoint `POST /functions/v1/send-reminders`. بيقبل الطلب بس لو فيه `Authorization: Bearer <REMINDERS_SECRET>`، وبيرجّع `{ sent: number, removed: number, failed: number }`.

- [ ] **Step 1: اتأكد إن `npm:web-push` شغال على Deno (spike، الكود ده مش هيتعمله commit)**

على المشروع التجريبي، من Dashboard ← Edge Functions ← Deploy a new function ← Via Editor، اعمل function مؤقتة اسمها `wp-probe`:
```ts
import webpush from "npm:web-push@3.6.7";
Deno.serve(() => Response.json(webpush.generateVAPIDKeys()));
```
افتحها من "Test" في الـ dashboard. المتوقع: JSON فيه `publicKey` و`privateKey`.

احفظ المفتاحين دول، هنستخدمهم كمفاتيح VAPID للمشروع التجريبي. وبعدها امسح `wp-probe`.

لو فشلت بسبب مكتبة `crypto` أو `https`: وقّف واستشير المستخدم. البديل هيبقى مكتبة `jsr:@negrel/webpush`، ودي محتاجة تعديل في الخطوة 2.

- [ ] **Step 2: اكتب الـ function**

`supabase/functions/send-reminders/index.ts`:
```ts
// بتتنادى من pg_cron كل 15 دقيقة (schema.sql 7.13). بتبعت إشعار لكل متدرب ميعاده الربع ساعة دي.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { cairoSlot } from "./slot.js";

const env = (k: string) => Deno.env.get(k) ?? "";
webpush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));
const payload = JSON.stringify({ title: "MoFit", body: "ميعاد تمرينك النهارده 💪", url: "/app.html#plan" });

Deno.serve(async (req) => {
  if (req.headers.get("Authorization") !== `Bearer ${env("REMINDERS_SECRET")}`) return new Response("forbidden", { status: 403 });

  const { dow, time, today } = cairoSlot(new Date());
  // training_reminders.member_id → profiles فالـ inner join شغال. push_subscriptions مالهاش FK مباشر مع التذكيرات، فبتتجاب في query لوحدها
  const { data: due, error } = await db.from("training_reminders")
    .select("member_id, profiles!inner(is_active, subscription_end)")
    .eq("enabled", true).eq("remind_at", time).contains("days", [dow])
    .or(`last_sent_on.is.null,last_sent_on.lt.${today}`)
    .eq("profiles.is_active", true)
    .or(`subscription_end.is.null,subscription_end.gte.${today}`, { referencedTable: "profiles" });
  if (error) { console.error(error); return new Response(error.message, { status: 500 }); }
  const ids = (due ?? []).map((r) => r.member_id);
  if (!ids.length) return Response.json({ sent: 0, removed: 0, failed: 0 });

  const { data: subs, error: subErr } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("member_id", ids);
  if (subErr) { console.error(subErr); return new Response(subErr.message, { status: 500 }); }

  let sent = 0, removed = 0, failed = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (e) {
      // 404/410: الاشتراك اتلغى من المتصفح، فنمسحه
      if (e?.statusCode === 404 || e?.statusCode === 410) { await db.from("push_subscriptions").delete().eq("id", s.id); removed++; }
      else { failed++; console.error(s.endpoint, e?.statusCode, e?.body ?? e); }
    }
  }
  // بنعلّم الكل حتى اللي ما عندوش جهاز، عشان ما نعيدش الـ query عليهم لحد بكرة
  await db.from("training_reminders").update({ last_sent_on: today }).in("member_id", ids);
  return Response.json({ sent, removed, failed });
});
```

لو الـ `.or(..., { referencedTable: "profiles" })` رجّع غلط من PostgREST، شيل الشرطين بتوع `profiles` من الـ query، وفلتر في الكود: `due.filter((r) => r.profiles.is_active && (!r.profiles.subscription_end || r.profiles.subscription_end >= today))`.

- [ ] **Step 3: ارفعها على التجريبي بالـ secrets**

```bash
npx supabase@latest login
npx supabase@latest secrets set --project-ref <test-ref> VAPID_PUBLIC_KEY=<pub> VAPID_PRIVATE_KEY=<priv> VAPID_SUBJECT=mailto:<owner-email> REMINDERS_SECRET=<random-32-chars>
npx supabase@latest functions deploy send-reminders --project-ref <test-ref> --no-verify-jwt
```
لو `npx supabase` مش راضي يشتغل على Windows، ارفعها من Dashboard ← Edge Functions ← Via Editor، بالملفين `index.ts` و`slot.js`.

- [ ] **Step 4: اختبرها يدوي**

```bash
curl -s -X POST -H "Authorization: Bearer wrong" https://<test-ref>.supabase.co/functions/v1/send-reminders
```
المتوقع: `forbidden`.

```bash
curl -s -X POST -H "Authorization: Bearer <REMINDERS_SECRET>" https://<test-ref>.supabase.co/functions/v1/send-reminders
```
المتوقع: `{"sent":0,"removed":0,"failed":0}`.

- [ ] **Step 5: commit**

```bash
git add supabase/functions/send-reminders/index.ts
git commit -m "Edge Function بتبعت إشعار التذكير للمتدربين اللي ميعادهم جه، وبتمسح الاشتراكات الملغية"
```

---

### Task 4: الـ cron اللي بيشغّل الـ function، وتنضيف السجل

**Files:**
- Modify: `supabase/schema.sql`: نكمّل في آخر قسم `7.13`.

**Interfaces:**
- Consumes: الـ function من Task 3، وسر في Vault اسمه `reminders_secret` (نفس قيمة `REMINDERS_SECRET`)، وسر تاني اسمه `project_url`.

- [ ] **Step 1: حط السرّين في Vault على التجريبي (مرة واحدة، ومش في الملف)**

```sql
select vault.create_secret('<REMINDERS_SECRET>', 'reminders_secret');
select vault.create_secret('https://<test-ref>.supabase.co', 'project_url');
```

- [ ] **Step 2: أضف في آخر قسم `7.13` في `schema.sql`**

```sql
-- الجدولة: لازم pg_cron و pg_net يكونوا متفعّلين (Dashboard ← Integrations ← Cron)
-- قبل أول تشغيل حط السرّين في Vault مرة واحدة (مش هنا):
--   select vault.create_secret('<نفس REMINDERS_SECRET اللي في الـ function>', 'reminders_secret');
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('send-reminders', '*/15 * * * *', $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_secret'))
  ) $$);
-- سجل تشغيل الـ cron بيكبر لوحده، فبنمسح الأقدم من أسبوع
select cron.schedule('cleanup-cron-log', '0 3 * * *', $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$);
```

- [ ] **Step 3: شغّله على التجريبي واستنى أول ربع ساعة**

```sql
select jobname, schedule from cron.job;
-- بعد أول ربع ساعة:
select status, return_message, end_time from cron.job_run_details order by end_time desc limit 3;
select status_code, content from net._http_response order by created desc limit 3;
```
المتوقع: `send-reminders` و`cleanup-cron-log` موجودين في `cron.job`، وآخر تشغيلة حالتها `succeeded`، والرد `200` وفيه `{"sent":0,...}`.

شغّل نفس الجزء تاني وتأكد إن مفيش أي job اتكررت. ده بيأكد إن الملف idempotent.

- [ ] **Step 4: commit**

```bash
git diff
git add supabase/schema.sql
git commit -m "pg_cron بيشغّل إرسال التذكيرات كل ربع ساعة وبينضّف سجله يومياً"
```

---

### Task 5: الاشتراك في الإشعارات من الواجهة (`js/push.js`) و`sw.js`

**Files:**
- Create: `js/push.js`
- Modify: `js/config.js`: نضيف `VAPID_PUBLIC_KEY`.
- Modify: `sw.js:3`: نزوّد `CACHE` لـ `mofit-v6`، ونضيف handlers في آخر الملف.
- Modify: `js/app.js:100-104`: الـ logout يلغي اشتراك الجهاز.

**Interfaces:**
- Produces:
  - `pushState(): Promise<"unsupported" | "needs-install" | "denied" | "on" | "off">`
  - `enablePush(): Promise<void>`: بيرمي `Error` برسالة عربي لو فشل.
  - `disablePush(): Promise<void>`: مش بيرمي أبداً.

- [ ] **Step 1: أضف المفتاح العام في `js/config.js` (في آخر الملف)**

```js
// مفتاح VAPID العام بتاع إشعارات التذكير — عام وآمن. المفتاح السري في secrets الـ Edge Function بس
export const VAPID_PUBLIC_KEY = "<المفتاح العام بتاع المشروع الحقيقي>";
```
وأنت بتجرّب على التجريبي حط مفتاحه، ومتعملش commit للتغيير ده. المفتاح الحقيقي بيطلّعه الشخص اللي بيطبّق التغييرات، في خطوة "التطبيق على الحقيقي". لحد ما المفتاح ده يبقى موجود، سيب السطر بقيمة فاضية `""`، و`pushState` هترجّع `"unsupported"`.

- [ ] **Step 2: اكتب `js/push.js`**

```js
// اشتراك الجهاز ده في إشعارات تذكير التمرين (Web Push)
import { supabase } from "./supabase.js";
import { VAPID_PUBLIC_KEY } from "./config.js";
import { isIOS, isInstalled } from "./pwa.js";

const supported = () => !!VAPID_PUBLIC_KEY && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const current = async () => (await navigator.serviceWorker.ready).pushManager.getSubscription();

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
```

- [ ] **Step 3: الـ logout يلغي اشتراك الجهاز (`js/app.js`)**

أضف الـ import جنب باقي الـ imports:
```js
import { disablePush } from "./push.js";
```
وعدّل الـ handler:
```js
$("logout").onclick = async (e) => {
  e.preventDefault();
  await disablePush(); // قبل signOut عشان الـ RLS يسمح بمسح الصف
  await supabase.auth.signOut();
  location.replace("login.html");
};
```

- [ ] **Step 4: `sw.js`: زوّد الـ cache وأضف الـ handlers**

غيّر السطر 3:
```js
const CACHE = "mofit-v6";
```
وأضف في آخر الملف:
```js
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
```

- [ ] **Step 5: تحقق يدوي من الـ console (Chrome على `python -m http.server 8000`)**

اعمل login كمتدرب على التجريبي، بعد ما تحط مفاتيح التجريبي في `config.js` من غير commit. افتح DevTools ← Console وشغّل:
```js
const m = await import("/js/push.js"); await m.pushState()
```
المتوقع: `"off"`.

بعدها شغّل `await m.enablePush()` واقبل الإذن، وبعدها `await m.pushState()`. المتوقع: `"on"`، وصف جديد في `push_subscriptions` على التجريبي.

بعدها من DevTools ← Application ← Service Workers ← "Push" اكتب `{"title":"MoFit","body":"تجربة","url":"/app.html#plan"}`. المتوقع: الإشعار يظهر، والضغط عليه يفتح `#plan`.

ملحوظة: `localhost` بيتعامل كـ secure context، فالـ Push شغال عليه.

- [ ] **Step 6: اقرا الـ diff واعمل commit (من غير تغيير مفاتيح التجريبي)**

```bash
git diff
git add js/push.js js/config.js sw.js js/app.js
git commit -m "اشتراك الجهاز في إشعارات التذكير، وعرض الإشعار من الـ service worker، وإلغاؤه مع تسجيل الخروج"
```
قبل الـ commit اتأكد إن `js/config.js` فيه `VAPID_PUBLIC_KEY = ""` بس، ومفيش أي تغيير تاني بتاع المشروع التجريبي.

---

### Task 6: قسم "تذكير التمرين" في صفحة حسابي

**Files:**
- Modify: `js/views/account.js`: import، ودالة `drawReminder`، و`<section>` جنب `#feedback`.
- Modify: `css/app.css`: نضيف بعد قواعد `.stars` (حوالي السطر 321).

**Interfaces:**
- Consumes: `pushState`، `enablePush`، `disablePush` (Task 5)، وجدول `training_reminders` (Task 1).

- [ ] **Step 1: أضف الـ CSS بعد قواعد `.stars`**

```css
.days{border:0;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px;min-width:0}
.days legend{font-weight:600;font-size:.9rem;padding:0;margin-bottom:4px;width:100%}
.days label{padding:6px 12px;border-radius:999px;background:var(--paper-2);cursor:pointer;font-size:.92rem;user-select:none}
.days input:checked + label{background:var(--tape);color:var(--tape-ink);font-weight:700}
.days input:focus-visible + label{outline:2px solid var(--ink);outline-offset:2px}
```

- [ ] **Step 2: أضف الـ import وثوابت الأيام والساعات في `account.js`**

جنب باقي الـ imports:
```js
import { pushState, enablePush, disablePush } from "../push.js";
```
وتحت `const fmt = ...`:
```js
// ترتيب الأسبوع في مصر، والأرقام زي extract(dow) في Postgres (0 = الأحد)
const DAYS = [[6, "السبت"], [0, "الأحد"], [1, "الاتنين"], [2, "التلات"], [3, "الأربع"], [4, "الخميس"], [5, "الجمعة"]];
const SLOTS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
const slotLabel = (t) => new Date(`2000-01-01T${t}`).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" });
```

- [ ] **Step 3: أضف `drawReminder` فوق `export function renderAccount`**

```js
// ---------- تذكير التمرين: الأيام والساعة، وتفعيل الإشعارات على الجهاز ده ----------
const PUSH_MSG = {
  unsupported: `<p class="notice bad">المتصفح ده مش بيدعم الإشعارات.</p>`,
  "needs-install": `<p class="notice">على الآيفون لازم تثبّت MoFit على الشاشة الرئيسية الأول (الخطوات في كارت التثبيت)، وتفتحه من الأيقونة.</p>`,
  denied: `<p class="notice bad">الإشعارات مقفولة للموقع ده من إعدادات المتصفح. افتحها من هناك وارجع هنا.</p>`,
  on: `<p class="notice ok">الإشعارات شغالة على الجهاز ده.</p><button class="btn btn-ghost btn-sm" type="button" id="push-off">وقّف الإشعارات على الجهاز ده</button>`,
  off: `<button class="btn btn-tape" type="button" id="push-on">فعّل الإشعارات على الجهاز ده</button>`,
};

async function drawPush(wrap, ctx) {
  const st = await pushState();
  if (ctx.stale() || !wrap.isConnected) return;
  wrap.innerHTML = PUSH_MSG[st];
  wrap.querySelector("#push-on")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try { await enablePush(); toast("تمام، هيوصلك التذكير في ميعاده"); }
    catch (err) { toast(err.message, true); }
    drawPush(wrap, ctx);
  });
  wrap.querySelector("#push-off")?.addEventListener("click", async () => {
    await disablePush(); toast("الإشعارات اتوقفت على الجهاز ده"); drawPush(wrap, ctx);
  });
}

async function drawReminder(box, ctx) {
  box.innerHTML = `<h2>تذكير التمرين</h2><div class="sk sk-block"></div>`;
  const { data, error } = await supabase.from("training_reminders").select("days, remind_at, enabled").eq("member_id", ctx.profile.id).maybeSingle();
  if (ctx.stale() || !box.isConnected) return;
  if (error) { box.innerHTML = `<h2>تذكير التمرين</h2><p class="notice bad">ما قدرناش نجيب التذكير: ${esc(error.message)}</p>`; return; }
  const r = data || { days: [], remind_at: "18:00:00", enabled: true };
  const at = r.remind_at.slice(0, 5);
  box.innerHTML = `<h2>تذكير التمرين</h2>
    <p class="fb-sub">اختار أيام تمرينك والساعة، وهيوصلك إشعار على موبايلك في الميعاد.</p>
    <form id="f-rem">
      <fieldset class="days"><legend>أيام التمرين</legend>
        ${DAYS.map(([n, name]) => `<input class="sr-only" type="checkbox" id="rd-${n}" value="${n}"${r.days.includes(n) ? " checked" : ""}><label for="rd-${n}">${name}</label>`).join("")}
      </fieldset>
      <div class="field"><label for="r-at">ساعة التذكير</label>
        <select id="r-at">${SLOTS.map((t) => `<option value="${t}"${t === at ? " selected" : ""}>${slotLabel(t)}</option>`).join("")}</select></div>
      <div class="field check"><label for="r-on"><input id="r-on" type="checkbox"${r.enabled ? " checked" : ""}><span>التذكير شغال</span></label></div>
      <button class="btn btn-ink" type="submit">حفظ التذكير</button>
    </form>
    <div id="push-box"></div>`;
  drawPush(box.querySelector("#push-box"), ctx);
  box.querySelector("#f-rem").onsubmit = async (e) => {
    e.preventDefault();
    const days = [...box.querySelectorAll(".days input:checked")].map((c) => +c.value);
    if (!days.length) return toast("اختار يوم واحد على الأقل", true);
    const btn = e.submitter; btn.disabled = true;
    const { error } = await supabase.from("training_reminders")
      .upsert({ member_id: ctx.profile.id, days, remind_at: box.querySelector("#r-at").value, enabled: box.querySelector("#r-on").checked });
    btn.disabled = false;
    if (error) return toast("ما اتحفظش: " + error.message, true);
    toast("التذكير اتحفظ");
  };
}
```

- [ ] **Step 4: اعرض القسم للمتدرب بس في `renderAccount`**

في الـ template، بعد سطر `#feedback`:
```js
      ${profile.role !== "coach" ? `<section class="panel" id="reminder"></section>` : ""}
```
وبعد `if (fb) drawFeedback(fb, ctx);`:
```js
  const rem = main.querySelector("#reminder");
  if (rem) drawReminder(rem, ctx);
```

- [ ] **Step 5: تحقق في المتصفح (`python -m http.server 8000`، والـ config بتاع التجريبي محلياً)**

- اعمل login كمتدرب وافتح `#account`. المتوقع: قسم "تذكير التمرين" ظاهر، و`SLOTS` فيها 96 اختيار.
- احفظ من غير ما تختار يوم. المتوقع: toast "اختار يوم واحد على الأقل".
- اختار السبت والاتنين والساعة 6:30 م واحفظ. المتوقع: صف في `training_reminders` فيه `days = {6,1}` و`remind_at = 18:30:00`.
- اعمل reload. المتوقع: نفس الاختيارات راجعة.
- ادخل بحساب الكوتش وافتح `#account`. المتوقع: القسم مش ظاهر.
- غيّر حجم الشاشة لـ mobile (375px). المتوقع: أزرار الأيام بتنزل سطر جديد من غير scroll أفقي.
- افتح الـ console. المتوقع: مفيش أي error، ولا CSP violation.

- [ ] **Step 6: اقرا الـ diff واعمل commit**

```bash
git diff
git add js/views/account.js css/app.css
git commit -m "قسم تذكير التمرين في صفحة حسابي: الأيام والساعة وتفعيل الإشعارات على الجهاز"
```

---

### Task 7: تجربة كاملة على التجريبي، ووثيقة التطبيق

**Files:**
- Modify: `docs/setup.md`: نضيف قسم "إشعارات التذكير" بخطوات التطبيق على الحقيقي.

- [ ] **Step 1: تجربة كاملة على Android (Chrome)**

اعمل deploy للفرع على أي رابط HTTPS للتجربة (Cloudflare preview للـ branch بيشتغل)، أو استخدم `localhost` من الموبايل عن طريق port forwarding في `chrome://inspect`.

اختار ميعاد بعد أول ربع ساعة جاية، وفعّل الإشعارات، واقفل الموقع. المتوقع:
- إشعار واحد في الميعاد.
- الضغط عليه بيفتح `#plan`.
- `last_sent_on = النهارده` في الجدول.
- ومفيش إشعار تاني لو غيّرت الساعة لربع ساعة بعدها في نفس اليوم.

- [ ] **Step 2: تجربة على آيفون (iOS 16.4 أو أحدث)**

- من Safari من غير ما تثبّت الموقع. المتوقع: الرسالة بتاعة `needs-install`.
- بعد "إضافة إلى الشاشة الرئيسية" وفتحه من الأيقونة. المتوقع: زرار التفعيل بيشتغل، والإشعار بيوصل.

- [ ] **Step 3: الاشتراك الملغي بيتمسح**

من إعدادات المتصفح امسح إذن الإشعارات للموقع، أو امسح بيانات الموقع، وبعدها نادي الـ function بالـ curl بتاع Task 3 في ميعاد مطابق. المتوقع: `removed: 1` والصف اتمسح.

- [ ] **Step 4: أضف خطوات التطبيق في `docs/setup.md`**

```markdown
## إشعارات تذكير التمرين (قسم 7.13)
بتتعمل مرة واحدة بعد دمج الـ PR، وشخص واحد بس هو اللي يعملها:
1. Dashboard ← Integrations ← Cron: فعّل `pg_cron`. واتأكد إن `pg_net` متفعّل من Database ← Extensions.
2. اطلّع مفاتيح VAPID: `npx web-push generate-vapid-keys`. العام يتحط في `VAPID_PUBLIC_KEY` في `js/config.js` ويتعمله commit. السري ميتعملوش commit أبداً.
3. اعمل سر عشوائي (32 حرف) لـ `REMINDERS_SECRET`.
4. `npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... REMINDERS_SECRET=...`
5. `npx supabase functions deploy send-reminders --no-verify-jwt`
6. SQL Editor:
   `select vault.create_secret('<REMINDERS_SECRET>', 'reminders_secret');`
   `select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');`
7. شغّل قسم 7.13 من `schema.sql`، واتأكد من `select * from cron.job;`
```

- [ ] **Step 5: commit**

```bash
git add docs/setup.md
git commit -m "خطوات تطبيق إشعارات التذكير على مشروع Supabase الحقيقي"
```

---

## بعد الخطة
- الـ PR يتفتح على **`develop`**: `gh pr create --base develop`. ومحدش يعمل push أو يفتح PR غير لما المستخدم يطلب.
- ملفات كتير التعارض بنلمسها: `schema.sql` و`js/app.js` و`css/app.css` و`sw.js`. بلّغ اللي شغال معاك قبل ما تبدأ Task 1 و5 و6.
