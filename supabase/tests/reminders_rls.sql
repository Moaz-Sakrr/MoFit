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
insert into public.training_reminders (member_id, days, remind_at, enabled) values ('00000000-0000-0000-0000-0000000000a1', '{1}', '07:00', true)
  on conflict (member_id) do update set member_id = excluded.member_id, days = excluded.days, remind_at = excluded.remind_at, enabled = excluded.enabled;
select public.tst_expect_count($$select 1 from public.training_reminders where days = '{1}'$$, 1, 'A upserts own reminder (like PostgREST)');
select public.tst_expect_fail($$update public.training_reminders set last_sent_on = current_date$$, 'member cannot set last_sent_on');
select public.tst_expect_fail($$insert into public.training_reminders (member_id, days, remind_at) values ('00000000-0000-0000-0000-0000000000b2', '{1}', '07:00')$$, 'cannot create reminder for someone else');
select public.tst_expect_fail($$update public.training_reminders set member_id = '00000000-0000-0000-0000-0000000000b2'$$, 'cannot move reminder to someone else');
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
select public.tst_expect_fail($$insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.test/a', 'k', 's')$$, 'same device endpoint cannot be taken by B');

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
