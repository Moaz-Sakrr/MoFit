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
-- آخر مرة المتدرب بعت فيها رأيه (بيتحدّث من trigger الـ feedback بس)
alter table public.profiles add column if not exists last_feedback_at timestamptz;

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
  -- وقت آخر feedback محدش يغيّره بإيده (ولا الكوتش)، بيتحدّث بس من trigger الـ feedback (عمق > 1)
  if auth.uid() is not null and pg_trigger_depth() < 2 then
    new.last_feedback_at := old.last_feedback_at;
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

-- 7.5) نتايج المشتركين (صور قبل وبعد) -------------------------------------
-- الصفحة الرئيسية بتقراها لأي زائر، والكوتش بس هو اللي يعدّل
create table if not exists public.results (
  id         bigint generated always as identity primary key,
  title      text not null default '',
  goal       text not null default '',
  before_url text not null,
  after_url  text not null,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
alter table public.results enable row level security;
drop policy if exists "results read"  on public.results;
drop policy if exists "results write" on public.results;
create policy "results read"  on public.results for select using (true);
create policy "results write" on public.results for all using (public.is_coach()) with check (public.is_coach());

-- مخزن الصور: القراءة للكل، والرفع والحذف للكوتش بس
insert into storage.buckets (id, name, public) values ('results', 'results', true)
on conflict (id) do nothing;
drop policy if exists "results files insert" on storage.objects;
drop policy if exists "results files update" on storage.objects;
drop policy if exists "results files delete" on storage.objects;
create policy "results files insert" on storage.objects for insert with check (bucket_id = 'results' and public.is_coach());
create policy "results files update" on storage.objects for update using (bucket_id = 'results' and public.is_coach());
create policy "results files delete" on storage.objects for delete using (bucket_id = 'results' and public.is_coach());

insert into public.results (title, goal, before_url, after_url, sort)
select * from (values
  ('متدرب ١','تنشيف','images/result-1-before.jpg','images/result-1-after.jpg',1),
  ('متدرب ٢','تضخيم','images/result-2-before.jpg','images/result-2-after.jpg',2),
  ('متدرب ٣','تضخيم','images/result-3-before.jpg','images/result-3-after.jpg',3)
) as v(title,goal,before_url,after_url,sort)
where not exists (select 1 from public.results);

-- 7.6) فيديوهات التمارين بقت لينكات يوتيوب بس، فبنشيل بقايا الرفع القديم (المخزن نفسه بيتمسح من الداشبورد)
drop policy if exists "videos read"   on storage.objects;
drop policy if exists "videos insert" on storage.objects;
drop policy if exists "videos update" on storage.objects;
drop policy if exists "videos delete" on storage.objects;
alter table public.exercises drop column if exists video_path;

-- 7.7) صور متابعة المتدربين ------------------------------------------------
-- المتدرب يرفع من 1 لـ 3 صور أول الشهر وآخره. الكوتش يشوفها دايماً للمتابعة،
-- و allow_public هو قرار المتدرب: هل يسمح باستخدامها في نتايج المشتركين؟
create table if not exists public.progress_photos (
  id           bigint generated always as identity primary key,
  member_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  period       text not null check (period in ('start','end')),
  month        date not null,
  paths        text[] not null check (cardinality(paths) between 1 and 3),
  allow_public boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists progress_photos_member_idx on public.progress_photos (member_id, month desc);
alter table public.progress_photos enable row level security;

-- المتدرب يعدّل قراره بس، مش الصور ولا التاريخ ولا صاحب الصف
create or replace function public.protect_progress_photo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id         := old.id;
  new.member_id  := old.member_id;
  new.period     := old.period;
  new.month      := old.month;
  new.paths      := old.paths;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists protect_progress_photo on public.progress_photos;
create trigger protect_progress_photo before update on public.progress_photos
  for each row execute function public.protect_progress_photo();

-- القراءة: صاحب الصور والكوتش. الرفع: المتدرب المفعّل. التعديل والحذف: صاحب الصور بس
drop policy if exists "photos read"   on public.progress_photos;
drop policy if exists "photos insert" on public.progress_photos;
drop policy if exists "photos update" on public.progress_photos;
drop policy if exists "photos delete" on public.progress_photos;
create policy "photos read"   on public.progress_photos for select using (member_id = auth.uid() or public.is_coach());
create policy "photos insert" on public.progress_photos for insert with check (member_id = auth.uid() and public.is_active_member());
create policy "photos update" on public.progress_photos for update using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy "photos delete" on public.progress_photos for delete using (member_id = auth.uid());

-- مخزن خاص: كل متدرب في فولدر باسم رقمه (uid). الحد 5 ميجا للصورة
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('progress-photos', 'progress-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "progress files read"   on storage.objects;
drop policy if exists "progress files insert" on storage.objects;
drop policy if exists "progress files delete" on storage.objects;
create policy "progress files read"   on storage.objects for select
  using (bucket_id = 'progress-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_coach()));
create policy "progress files insert" on storage.objects for insert
  with check (bucket_id = 'progress-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.is_active_member());
-- الحذف: صاحب الصور، والكوتش (بيستخدمها بس لما يحذف حساب متدرب بالكامل، شوف 7.9)
create policy "progress files delete" on storage.objects for delete
  using (bucket_id = 'progress-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_coach()));

-- 7.8) تشديد صور المتابعة -----------------------------------------------------
-- (أ) كل مسارات الصور لازم تكون جوه فولدر صاحب الصف نفسه
create or replace function public.paths_belong(owner uuid, p text[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(x like owner::text || '/%' and x not like '%..%'), true) from unnest(p) as x;
$$;
alter table public.progress_photos drop constraint if exists progress_photos_paths_owner;
alter table public.progress_photos add constraint progress_photos_paths_owner check (public.paths_belong(member_id, paths));

-- (ب) حد أقصى لعدد الرفعات في الشهر (يمنع ملء المخزن)
create or replace function public.limit_progress_uploads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from progress_photos where member_id = new.member_id and month = new.month) >= 10 then
    raise exception 'وصلت للحد الأقصى من رفعات الصور في الشهر ده';
  end if;
  return new;
end $$;
drop trigger if exists limit_progress_uploads on public.progress_photos;
create trigger limit_progress_uploads before insert on public.progress_photos
  for each row execute function public.limit_progress_uploads();

-- 7.9) الكوتش يحذف حساب متدرب نهائياً ----------------------------------------
-- بيمسح المستخدم من auth.users، فبيتمسح معاه صف profiles وصفوف progress_photos (on delete cascade)
-- ومش هيقدر يدخل تاني. ملفات الصور نفسها الموقع بيمسحها من المخزن بعدها (SQL مينفعش يمسح ملفات Storage)
create or replace function public.delete_member(member uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_coach() then
    raise exception 'الكوتش بس اللي يقدر يحذف حسابات';
  end if;
  if exists (select 1 from profiles where id = member and role = 'coach') then
    raise exception 'مينفعش تحذف حساب الكوتش';
  end if;
  delete from auth.users where id = member;
  if not found then
    raise exception 'الحساب ده مش موجود';
  end if;
end $$;
revoke all on function public.delete_member(uuid) from public, anon;
grant execute on function public.delete_member(uuid) to authenticated;

-- 7.10) آراء المتدربين (feedback) -------------------------------------------------
-- المتدرب يبعت تقييم من 1 لـ 5 ورأي مكتوب للكوتش، مرة واحدة كل 24 ساعة.
-- الكوتش يقرا الكل ويعلّم اللي قراه. المتدرب يحذف رأيه، بس الحذف ما بيرجّعش الفرصة.
create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  member_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  rating     int  not null check (rating between 1 and 5),
  message    text not null check (char_length(btrim(message)) between 1 and 1000),
  coach_seen boolean not null default false,
  created_at timestamptz not null default now()
);
-- allow_public: قرار المتدرب إن رأيه يتعرض في الصفحة الرئيسية. featured: اختيار الكوتش
-- الرأي بيظهر للزوار بس لو الاتنين true، فلو المتدرب سحب موافقته بيختفي لوحده
alter table public.feedback add column if not exists allow_public boolean not null default false;
alter table public.feedback add column if not exists featured     boolean not null default false;
create index if not exists feedback_member_idx  on public.feedback (member_id, created_at desc);
create index if not exists feedback_created_idx on public.feedback (created_at desc);
alter table public.feedback enable row level security;

-- مرة كل 24 ساعة، والوقت محفوظ في profiles عشان الحذف ما يصفّرش العداد
create or replace function public.feedback_once_a_day()
returns trigger language plpgsql security definer set search_path = public as $$
declare last timestamptz;
begin
  -- الـ trigger بيشتغل قبل RLS، فنتأكد الأول إن الرأي باسم صاحبه قبل ما نلمس profile حد تاني
  if auth.uid() is not null and new.member_id is distinct from auth.uid() then
    raise exception 'مينفعش تبعت رأي باسم حد تاني';
  end if;
  -- for update: لو اتبعت طلبين في نفس اللحظة، التاني يستنى الأول ويترفض
  select last_feedback_at into last from profiles where id = new.member_id for update;
  if last is not null and now() < last + interval '24 hours' then
    raise exception 'بعت رأيك في آخر ٢٤ ساعة. تقدر تبعت رأي جديد بعد %',
      to_char((last + interval '24 hours') at time zone 'Africa/Cairo', 'YYYY-MM-DD HH24:MI');
  end if;
  new.created_at := now();
  new.coach_seen := false;
  new.featured   := false;
  update profiles set last_feedback_at = now() where id = new.member_id;
  return new;
end $$;
drop trigger if exists feedback_once_a_day on public.feedback;
create trigger feedback_once_a_day before insert on public.feedback
  for each row execute function public.feedback_once_a_day();

-- الرأي نفسه محدش يعدّله. الكوتش يعدّل «اتقرا» و«معروض في الرئيسية»، والمتدرب يعدّل موافقته على النشر بس
create or replace function public.protect_feedback()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.id         := old.id;
  new.member_id  := old.member_id;
  new.rating     := old.rating;
  new.message    := old.message;
  new.created_at := old.created_at;
  if auth.uid() is not null then
    if public.is_coach() then
      new.allow_public := old.allow_public;
    else
      new.coach_seen := old.coach_seen;
      new.featured   := old.featured;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_feedback on public.feedback;
create trigger protect_feedback before update on public.feedback
  for each row execute function public.protect_feedback();

-- القراءة: صاحبه والكوتش. الإضافة: المتدرب لنفسه (حتى لو اشتراكه خلص). التعديل: الاتنين (والـ trigger بيحدد مين يعدّل إيه). الحذف: صاحبه
drop policy if exists "feedback read"   on public.feedback;
drop policy if exists "feedback insert" on public.feedback;
drop policy if exists "feedback update" on public.feedback;
drop policy if exists "feedback delete" on public.feedback;
create policy "feedback read"   on public.feedback for select using (member_id = auth.uid() or public.is_coach());
create policy "feedback insert" on public.feedback for insert with check (member_id = auth.uid() and not public.is_coach());
create policy "feedback update" on public.feedback for update using (member_id = auth.uid() or public.is_coach()) with check (member_id = auth.uid() or public.is_coach());
create policy "feedback delete" on public.feedback for delete using (member_id = auth.uid());

-- آراء الصفحة الرئيسية: الزوار مش بيقروا الجدول نفسه، بياخدوا الاسم الأول والتقييم والنص بس
create or replace function public.public_feedback()
returns table (name text, rating int, message text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), 'متدرب'), f.rating, f.message, f.created_at
  from feedback f join profiles p on p.id = f.member_id
  where f.featured and f.allow_public
  order by f.created_at desc
  limit 50;
$$;
revoke all on function public.public_feedback() from public;
grant execute on function public.public_feedback() to anon, authenticated;

-- 7.11) خطط التمرين الشخصية وتسجيل الأوزان ------------------------------------
-- الكوتش يبني لكل متدرب خطة (أيام ← تمارين من مكتبة التمارين الموجودة). المتدرب يسجّل وزن وعدات كل مجموعة.
-- السجلات (workout_sessions / set_logs) مش مربوطة بصفوف الخطة، فتعديل الخطة أو حذفها ما بيمسحش التاريخ.
create table if not exists public.workout_plans (
  id         bigint generated always as identity primary key,
  member_id  uuid not null unique references public.profiles(id) on delete cascade,
  name       text not null default 'خطتي',
  created_at timestamptz not null default now()
);
create table if not exists public.workout_days (
  id      bigint generated always as identity primary key,
  plan_id bigint not null references public.workout_plans(id) on delete cascade,
  name    text not null,
  sort    int not null default 0
);
create table if not exists public.workout_items (
  id          bigint generated always as identity primary key,
  day_id      bigint not null references public.workout_days(id) on delete cascade,
  exercise_id bigint references public.exercises(id) on delete set null,
  sets        int not null check (sets between 1 and 20),
  reps        text not null check (length(reps) between 1 and 20),
  note        text check (length(note) <= 300),
  sort        int not null default 0
);
create table if not exists public.workout_sessions (
  id          bigint generated always as identity primary key,
  member_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  day_name    text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists public.set_logs (
  id            bigint generated always as identity primary key,
  session_id    bigint not null references public.workout_sessions(id) on delete cascade,
  member_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  exercise_id   bigint references public.exercises(id) on delete set null,
  exercise_name text not null,
  set_no        int not null check (set_no between 1 and 20),
  weight        numeric(6,2) not null check (weight between 0 and 1000),
  reps          int not null check (reps between 0 and 200),
  created_at    timestamptz not null default now(),
  unique (session_id, exercise_id, set_no)
);
create index if not exists workout_days_plan_idx    on public.workout_days (plan_id, sort);
create index if not exists workout_items_day_idx    on public.workout_items (day_id, sort);
create index if not exists workout_sessions_mem_idx on public.workout_sessions (member_id, started_at desc);
create index if not exists set_logs_member_ex_idx   on public.set_logs (member_id, exercise_id, created_at desc);
alter table public.workout_plans    enable row level security;
alter table public.workout_days     enable row level security;
alter table public.workout_items    enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.set_logs         enable row level security;

-- هل الخطة دي بتاعتي؟ (security definer عشان ما نعتمدش على RLS الجداول التانية جوه السياسات)
create or replace function public.owns_plan(pid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workout_plans where id = pid and member_id = auth.uid());
$$;
create or replace function public.owns_day(did bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workout_days d join workout_plans p on p.id = d.plan_id where d.id = did and p.member_id = auth.uid());
$$;
create or replace function public.owns_session(sid bigint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workout_sessions where id = sid and member_id = auth.uid());
$$;

-- الخطة: القراءة للمتدرب صاحبها (لو اشتراكه شغال) وللكوتش. الكتابة للكوتش بس
drop policy if exists "wplans read"  on public.workout_plans;
drop policy if exists "wplans write" on public.workout_plans;
create policy "wplans read"  on public.workout_plans for select using (public.is_coach() or (member_id = auth.uid() and public.is_active_member()));
create policy "wplans write" on public.workout_plans for all using (public.is_coach()) with check (public.is_coach());

drop policy if exists "wdays read"  on public.workout_days;
drop policy if exists "wdays write" on public.workout_days;
create policy "wdays read"  on public.workout_days for select using (public.is_coach() or (public.owns_plan(plan_id) and public.is_active_member()));
create policy "wdays write" on public.workout_days for all using (public.is_coach()) with check (public.is_coach());

drop policy if exists "witems read"  on public.workout_items;
drop policy if exists "witems write" on public.workout_items;
create policy "witems read"  on public.workout_items for select using (public.is_coach() or (public.owns_day(day_id) and public.is_active_member()));
create policy "witems write" on public.workout_items for all using (public.is_coach()) with check (public.is_coach());

-- الجلسات والمجموعات: القراءة لصاحبها والكوتش. التسجيل للمتدرب المفعّل في جلساته هو بس
drop policy if exists "wsess read"   on public.workout_sessions;
drop policy if exists "wsess insert" on public.workout_sessions;
drop policy if exists "wsess update" on public.workout_sessions;
drop policy if exists "wsess delete" on public.workout_sessions;
create policy "wsess read"   on public.workout_sessions for select using (member_id = auth.uid() or public.is_coach());
create policy "wsess insert" on public.workout_sessions for insert with check (member_id = auth.uid() and public.is_active_member());
create policy "wsess update" on public.workout_sessions for update using (member_id = auth.uid()) with check (member_id = auth.uid());
create policy "wsess delete" on public.workout_sessions for delete using (member_id = auth.uid());

drop policy if exists "wlogs read"   on public.set_logs;
drop policy if exists "wlogs insert" on public.set_logs;
drop policy if exists "wlogs update" on public.set_logs;
drop policy if exists "wlogs delete" on public.set_logs;
create policy "wlogs read"   on public.set_logs for select using (member_id = auth.uid() or public.is_coach());
create policy "wlogs insert" on public.set_logs for insert with check (member_id = auth.uid() and public.is_active_member() and public.owns_session(session_id));
create policy "wlogs update" on public.set_logs for update using (member_id = auth.uid()) with check (member_id = auth.uid() and public.owns_session(session_id));
create policy "wlogs delete" on public.set_logs for delete using (member_id = auth.uid());

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
