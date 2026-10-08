-- =====================================================================
-- MoFit — قاعدة البيانات
-- شغّل الملف ده مرة واحدة في Supabase: SQL Editor ← New query ← Run
-- =====================================================================

-- 1) حسابات المتدربين والكوتش ----------------------------------------
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null default '',
  phone            text not null default '',
  email            text not null default '',
  role             text not null default 'member' check (role in ('member','coach')),
  is_active        boolean not null default false,   -- الكوتش هو اللي يفعّل
  subscription_end date,                              -- آخر يوم في الاشتراك
  notes            text not null default '',
  created_at       timestamptz not null default now()
);

-- 2) التمارين ----------------------------------------------------------
create table if not exists public.exercises (
  id          bigint generated always as identity primary key,
  muscle      text not null check (muscle in ('chest','back','shoulders','arms','legs','abs')),
  name        text not null,
  sets        text not null default '',
  reps        text not null default '',
  cues        text not null default '',
  youtube_url text not null default '',
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);

-- 3) جداول التمرين -----------------------------------------------------
-- days شكلها: [{"name":"دفع","items":[{"ex":"بنش برس","sets":"4","reps":"8","rest":"90"}]}]
create table if not exists public.programs (
  id         bigint generated always as identity primary key,
  name       text not null,
  level      int  not null default 1 check (level between 1 and 3),
  weeks      text not null default '',
  per_week   text not null default '',
  days       jsonb not null default '[]'::jsonb,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

-- 4) دوال مساعدة -------------------------------------------------------
-- هل اللي فاتح الموقع هو الكوتش؟
create or replace function public.is_coach()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'coach');
$$;

-- هل اللي فاتح الموقع متدرب اشتراكه شغال؟
create or replace function public.is_active_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles
    where id = auth.uid()
      and is_active
      -- بتوقيت القاهرة عشان التاريخ يطابق اللي الكوتش شايفه
      and (subscription_end is null or subscription_end >= (now() at time zone 'Africa/Cairo')::date)
  );
$$;

-- 5) لما حد يعمل حساب جديد، نعمله صف في profiles تلقائي -----------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.email, '')
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6) المتدرب يقدر يعدّل اسمه ورقمه بس، مش التفعيل ولا الدور --------------
create or replace function public.protect_profile_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- auth.uid() بيبقى فاضي لما التعديل يتعمل من SQL Editor نفسه، فنسمح بيه
  if auth.uid() is not null and not public.is_coach() then
    new.role             := old.role;
    new.is_active        := old.is_active;
    new.subscription_end := old.subscription_end;
    new.notes            := old.notes;
    new.email            := old.email;
    new.id               := old.id;
    new.created_at       := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- 7) صلاحيات الوصول (Row Level Security) -------------------------------
alter table public.profiles  enable row level security;
alter table public.exercises enable row level security;
alter table public.programs  enable row level security;

-- profiles: كل واحد يشوف نفسه، والكوتش يشوف الكل
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles update" on public.profiles;
drop policy if exists "profiles delete" on public.profiles;
create policy "profiles read"   on public.profiles for select using (id = auth.uid() or public.is_coach());
create policy "profiles update" on public.profiles for update using (id = auth.uid() or public.is_coach()) with check (id = auth.uid() or public.is_coach());
create policy "profiles delete" on public.profiles for delete using (public.is_coach());

-- exercises / programs: المتدرب المفعّل يقرأ، والكوتش يقرأ ويكتب
drop policy if exists "exercises read"  on public.exercises;
drop policy if exists "exercises write" on public.exercises;
create policy "exercises read"  on public.exercises for select using (public.is_coach() or public.is_active_member());
create policy "exercises write" on public.exercises for all    using (public.is_coach()) with check (public.is_coach());

drop policy if exists "programs read"  on public.programs;
drop policy if exists "programs write" on public.programs;
create policy "programs read"  on public.programs for select using (public.is_coach() or public.is_active_member());
create policy "programs write" on public.programs for all    using (public.is_coach()) with check (public.is_coach());

alter table public.programs drop constraint if exists programs_days_is_array;
alter table public.programs add constraint programs_days_is_array check (jsonb_typeof(days) = 'array');

-- 8) بيانات بداية (أمثلة تقدر تعدّلها أو تمسحها من لوحة الكوتش) ----------
insert into public.exercises (muscle, name, sets, reps, cues, sort)
select * from (values
  ('chest','بنش برس بالبار','4','6-10','لوحي الكتف مضمومين، البار ينزل على أسفل الصدر، والكوع بزاوية حوالي ٤٥ درجة.',1),
  ('chest','بنش مائل بالدمبل','3','8-12','الدكة على زاوية ٣٠ درجة. انزل ببطء لحد ما تحس بفرد في الصدر.',2),
  ('chest','تفتيح كابل','3','12-15','كوع مثني خفيف وثابت، والحركة من الكتف بس. اعصر في النص ثانية.',3),
  ('back','عقلة','4','6-10','ابدأ من دراع مفرود، اسحب صدرك للبار بالكوع، وانزل بتحكم.',1),
  ('back','تجديف بالبار','4','8-10','ميل لقدام ٤٥ درجة وضهرك مستقيم، اسحب البار لبطنك.',2),
  ('back','سحب أمامي','3','10-12','اسحب البار لأعلى الصدر من غير ما ترجع بجسمك لورا.',3),
  ('shoulders','ضغط أكتاف بالدمبل','4','8-10','قاعد وضهرك مسنود، ارفع لفوق من غير ما تقفل الكوع.',1),
  ('shoulders','رفرفة جانبي','4','12-15','وزن خفيف، ارفع لحد مستوى الكتف بس ومن غير مرجحة.',2),
  ('arms','باي بالبار','3','8-12','الكوع ثابت جنب جسمك، وانزل ببطء لحد ما الدراع يتفرد.',1),
  ('arms','باي هامر','3','10-12','قبضة محايدة، بالتبادل، من غير ما الكتف يتحرك.',2),
  ('arms','تراي كابل','3','12-15','الكوع ثابت جنب الجسم، افرد لتحت للآخر واعصر.',3),
  ('legs','سكوات بالبار','4','6-10','البار على الترابيس، الصدر لفوق، انزل لحد ما الفخذ يبقى موازي للأرض.',1),
  ('legs','ديدلفت روماني','3','8-10','الحركة من الحوض لورا، البار قريب من رجلك طول الوقت.',2),
  ('legs','دفع أرجل','3','10-15','رجلك في نص المنصة، ما تقفلش الركبة فوق.',3),
  ('abs','بلانك','3','45 ث','جسمك خط مستقيم من الراس للكعب، شد البطن والمؤخرة.',1),
  ('abs','رفع رجل معلّق','3','10-15','من غير مرجحة، ارفع رجلك بالبطن مش بالزخم.',2)
) as v(muscle,name,sets,reps,cues,sort)
where not exists (select 1 from public.exercises);

insert into public.programs (name, level, weeks, per_week, days, sort)
select * from (values
  ('فول بادي للمبتدئين', 1, '8', '3', '[{"name":"اليوم الأول","items":[{"ex":"سكوات بالبار","sets":"3","reps":"8-10","rest":"120"},{"ex":"بنش برس بالبار","sets":"3","reps":"8-10","rest":"90"},{"ex":"سحب أمامي","sets":"3","reps":"10-12","rest":"90"},{"ex":"بلانك","sets":"3","reps":"30 ث","rest":"60"}]},{"name":"اليوم التاني","items":[{"ex":"ديدلفت روماني","sets":"3","reps":"8-10","rest":"120"},{"ex":"ضغط أكتاف بالدمبل","sets":"3","reps":"10","rest":"90"},{"ex":"تجديف بالبار","sets":"3","reps":"10","rest":"90"}]}]'::jsonb, 1),
  ('دفع، سحب، أرجل', 2, '10', '6', '[{"name":"دفع","items":[{"ex":"بنش برس بالبار","sets":"4","reps":"6-8","rest":"150"},{"ex":"بنش مائل بالدمبل","sets":"3","reps":"8-10","rest":"90"},{"ex":"رفرفة جانبي","sets":"4","reps":"12-15","rest":"60"},{"ex":"تراي كابل","sets":"3","reps":"12","rest":"60"}]},{"name":"سحب","items":[{"ex":"عقلة","sets":"4","reps":"6-10","rest":"120"},{"ex":"تجديف بالبار","sets":"4","reps":"8","rest":"120"},{"ex":"باي بالبار","sets":"3","reps":"10","rest":"60"}]},{"name":"أرجل","items":[{"ex":"سكوات بالبار","sets":"4","reps":"6-8","rest":"180"},{"ex":"ديدلفت روماني","sets":"3","reps":"8-10","rest":"120"},{"ex":"دفع أرجل","sets":"3","reps":"12","rest":"90"}]}]'::jsonb, 2)
) as v(name,level,weeks,per_week,days,sort)
where not exists (select 1 from public.programs);

-- =====================================================================
-- 9) خلّي حساب محمد علاء هو الكوتش
-- بعد ما يعمل حساب من صفحة الدخول، شغّل السطر ده بإيميله:
--
-- update public.profiles set role = 'coach', is_active = true
-- where email = 'EMAIL_HERE';
-- =====================================================================
