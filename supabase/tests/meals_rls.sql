-- اختبار صلاحيات الوجبات (7.13). شغّله في SQL Editor على مشروع تجريبي (مش الأساسي).
-- كل حاجة جوه transaction وبتتلغي في الآخر (rollback). لو عدّى كله هتشوف NOTICE: ALL PASS
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000c0', 'coach@t.test', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a1', 'a@t.test',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@t.test',     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.profiles set role = 'coach', is_active = true where id = '00000000-0000-0000-0000-0000000000c0';
-- A مفعّل، و B اشتراكه خلص
update public.profiles set is_active = true, subscription_end = current_date + 30 where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set is_active = true, subscription_end = current_date - 1  where id = '00000000-0000-0000-0000-0000000000b2';

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

-- الكوتش يضيف ويعدّل
select public.tst_as_user('00000000-0000-0000-0000-0000000000c0');
insert into public.meals (id, name, calories, ingredients, youtube_url) overriding system value
  values (900001, 'T-meal', 450, 'rice' || chr(10) || 'chicken', 'https://youtu.be/dQw4w9WgXcQ');
update public.meals set calories = 500 where id = 900001;
select public.tst_expect_count('select 1 from public.meals where id = 900001 and calories = 500', 1, 'coach edits meal');
select public.tst_expect_count($$select 1 from public.meals where id = 900001 and category = 'lunch'$$, 1, 'category defaults to lunch');
update public.meals set category = 'breakfast' where id = 900001;
select public.tst_expect_fail($$update public.meals set category = 'brunch' where id = 900001$$, 'unknown category rejected');
select public.tst_expect_fail($$insert into public.meals (name, calories) values ('bad', -1)$$, 'negative calories rejected');
select public.tst_expect_fail($$insert into public.meals (name) values ('   ')$$, 'blank name rejected');
select public.tst_expect_fail($$insert into public.meals (name, ingredients) values ('long', repeat('x', 3001))$$, 'ingredients over 3000 rejected');

-- المتدرب المفعّل يقرا بس
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000a1');
select public.tst_expect_count('select 1 from public.meals where id = 900001', 1, 'active member reads meals');
select public.tst_expect_fail($$insert into public.meals (name) values ('member meal')$$, 'member cannot add meal');
update public.meals set name = 'hacked' where id = 900001;
delete from public.meals where id = 900001;

-- اللي اشتراكه خلص ما يشوفش حاجة
reset role;
select public.tst_as_user('00000000-0000-0000-0000-0000000000b2');
select public.tst_expect_count('select 1 from public.meals', 0, 'expired member sees no meals');

-- محاولات المتدرب ما أثّرتش
reset role;
select public.tst_expect_count($$select 1 from public.meals where id = 900001 and name = 'T-meal'$$, 1, 'member update/delete had no effect');

-- الزائر (anon) ما يشوفش حاجة
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select public.tst_expect_count('select 1 from public.meals', 0, 'anon sees no meals');
reset role;

do $$ begin raise notice 'ALL PASS'; end $$;
rollback;
