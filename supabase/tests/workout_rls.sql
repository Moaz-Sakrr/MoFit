-- اختبار صلاحيات خطط التمرين. شغّله في SQL Editor على مشروع تجريبي (مش الأساسي).
-- كل حاجة جوه transaction وبتتلغي في الآخر (rollback)، فمفيش بيانات بتفضل.
-- لو أي assert فشل هتطلع رسالة FAIL: ... ولو عدّى كله هتشوف NOTICE: ALL PASS
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000c0', 'coach@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a1', 'a@t.test',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@t.test',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.profiles set role = 'coach', is_active = true where id = '00000000-0000-0000-0000-0000000000c0';
update public.profiles set is_active = true, subscription_end = current_date + 30 where id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2');
insert into public.exercises (id, muscle, name) overriding system value values (900001, 'chest', 'T-bench');

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

-- الكوتش يبني خطة للمتدرب A
select public.tst_as_user('00000000-0000-0000-0000-0000000000c0');
insert into public.workout_plans (id, member_id, name) overriding system value values (900001, '00000000-0000-0000-0000-0000000000a1', 'plan A');
insert into public.workout_days (id, plan_id, name) overriding system value values (900001, 900001, 'Push');
insert into public.workout_items (id, day_id, exercise_id, sets, reps) overriding system value values (900001, 900001, 900001, 3, '8-12');
select public.tst_expect_fail($$insert into public.workout_items (day_id, exercise_id, sets, reps) values (900001, 900001, 0, '10')$$, 'sets=0 rejected');
select public.tst_expect_fail($$insert into public.workout_items (day_id, exercise_id, sets, reps) values (900001, 900001, 21, '10')$$, 'sets=21 rejected');

-- المتدرب A يشوف خطته ومايقدرش يعدّلها
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000a1');
select public.tst_expect_count('select 1 from public.workout_items', 1, 'A reads own items');
select public.tst_expect_fail($$insert into public.workout_items (day_id, exercise_id, sets, reps) values (900001, 900001, 3, '10')$$, 'member cannot add item');
select public.tst_expect_affected($$update public.workout_items set sets = 9$$, 0, 'member cannot update item');
select public.tst_expect_affected($$delete from public.workout_days$$, 0, 'member cannot delete day');

-- المتدرب B مايشوفش خطة A
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000b2');
select public.tst_expect_count('select 1 from public.workout_plans', 0, 'B cannot read A plan');
select public.tst_expect_count('select 1 from public.workout_items', 0, 'B cannot read A items');

-- A يسجّل جلسة ومجموعات
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.workout_sessions (id, day_name) overriding system value values (900001, 'Push');
insert into public.set_logs (session_id, exercise_id, exercise_name, set_no, weight, reps) values (900001, 900001, 'T-bench', 1, 20, 12);
insert into public.set_logs (session_id, exercise_id, exercise_name, set_no, weight, reps) values (900001, 900001, 'T-bench', 2, 25, 10);
select public.tst_expect_fail($$insert into public.set_logs (session_id, exercise_id, exercise_name, set_no, weight, reps) values (900001, 900001, 'T-bench', 3, -5, 8)$$, 'negative weight rejected');
select public.tst_expect_fail($$insert into public.set_logs (session_id, exercise_id, exercise_name, set_no, weight, reps) values (900001, 900001, 'T-bench', 3, 2000, 8)$$, 'weight 2000 rejected');
select public.tst_expect_fail($$insert into public.set_logs (session_id, exercise_id, exercise_name, set_no, weight, reps) values (900001, 900001, 'T-bench', 1, 30, 8)$$, 'duplicate set_no rejected');
select public.tst_expect_fail($$insert into public.workout_sessions (member_id, day_name) values ('00000000-0000-0000-0000-0000000000b2', 'x')$$, 'cannot create session for someone else');

-- B مايقدرش يقرا ولا يضيف على جلسة A
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000b2');
select public.tst_expect_count('select 1 from public.set_logs', 0, 'B cannot read A logs');
select public.tst_expect_count('select 1 from public.workout_sessions', 0, 'B cannot read A sessions');
select public.tst_expect_fail($$insert into public.set_logs (session_id, exercise_id, exercise_name, set_no, weight, reps) values (900001, 900001, 'T-bench', 5, 10, 10)$$, 'B cannot log into A session');
select public.tst_expect_affected($$update public.set_logs set weight = 1$$, 0, 'B cannot update A logs');

-- الكوتش يقرا السجل. وحذف اليوم والتمرين ما بيمسحش السجل
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000c0');
select public.tst_expect_count('select 1 from public.set_logs', 2, 'coach reads logs');
delete from public.workout_items where id = 900001;
delete from public.workout_days  where id = 900001;
reset role;
select public.tst_expect_count('select 1 from public.set_logs where session_id = 900001', 2, 'history intact after plan edit');

do $$ begin raise notice 'ALL PASS'; end $$;
rollback;
