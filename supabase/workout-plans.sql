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

