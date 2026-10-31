-- اختبار حدود الرفع والنصوص. شغّله في SQL Editor على مشروع تجريبي (مش الأساسي).
-- كل حاجة جوه transaction وبتتلغي في الآخر (rollback). لو عدّى كله هتشوف NOTICE: ALL PASS
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.profiles set is_active = true, subscription_end = current_date + 30 where id = '00000000-0000-0000-0000-0000000000a1';

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

-- أسماء الكوتش (بتتنسخ لجلسات المتدرب) لازم تتحدد بنفس الحدود. بنختبرها كـ superuser قبل ما نبدّل الدور
insert into public.workout_plans (id, member_id, name) overriding system value values (900101, '00000000-0000-0000-0000-0000000000a1', 'plan A');
select public.tst_expect_fail($$insert into public.workout_days (plan_id, name) values (900101, repeat('x', 201))$$, 'day name over 200 rejected');
select public.tst_expect_fail($$insert into public.exercises (muscle, name) values ('chest', repeat('x', 301))$$, 'exercise name over 300 rejected');

select public.tst_as_user('00000000-0000-0000-0000-0000000000a1');

-- قبل ما نملى الحد (30): لازم الرفض يكون بسبب فولدر متدرب تاني مش بسبب الحد
select public.tst_expect_fail($$insert into storage.objects (bucket_id, name) values ('progress-photos', '00000000-0000-0000-0000-0000000000b2/x.jpg')$$, 'cannot upload into another member folder');

-- 30 ملف في الشهر مسموح (10 رفعات × 3 صور)، والـ 31 مرفوض. كل insert لوحده زي ما الموقع بيرفع ملف ملف
do $$ begin
  for i in 1..30 loop
    insert into storage.objects (bucket_id, name) values ('progress-photos', '00000000-0000-0000-0000-0000000000a1/' || i || '.jpg');
  end loop;
end $$;
select public.tst_expect_fail($$insert into storage.objects (bucket_id, name) values ('progress-photos', '00000000-0000-0000-0000-0000000000a1/31.jpg')$$, '31st file in 31 days rejected');

-- النصوص الطويلة مرفوضة، والعادية شغالة
select public.tst_expect_fail($$update public.profiles set full_name = repeat('x', 101) where id = '00000000-0000-0000-0000-0000000000a1'$$, 'name over 100 rejected');
select public.tst_expect_fail($$update public.profiles set phone = repeat('1', 31) where id = '00000000-0000-0000-0000-0000000000a1'$$, 'phone over 30 rejected');
update public.profiles set full_name = 'Ahmed Ali' where id = '00000000-0000-0000-0000-0000000000a1';
select public.tst_expect_fail($$insert into public.workout_sessions (day_name) values (repeat('x', 201))$$, 'day_name over 200 rejected');
insert into public.workout_sessions (id, day_name) overriding system value values (900101, 'Push');
select public.tst_expect_fail($$insert into public.set_logs (session_id, exercise_name, set_no, weight, reps) values (900101, repeat('x', 301), 1, 20, 10)$$, 'exercise_name over 300 rejected');
insert into public.set_logs (session_id, exercise_name, set_no, weight, reps) values (900101, 'Bench', 1, 20, 10);

do $$ begin raise notice 'ALL PASS'; end $$;
rollback;
