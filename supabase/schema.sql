-- ============================================================
-- JSS EXAM PORTAL — SCHEMA (v4: multi class-teacher support via class_teachers)
-- Run this whole file in Supabase SQL Editor once, on a fresh project.
--
-- IMPORTANT: Teachers are created via the Admin API (Service Role Key)
-- with email_confirm: true, so NO confirmation emails are ever sent.
-- The "Confirm email" setting in the dashboard can stay ON (default).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- TEACHERS ----------
-- id is the SAME id as the matching row in Supabase's auth.users table.
create table if not exists public.teachers (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  tsc_number text unique,
  phone_number text not null unique,
  role text not null default 'teacher' check (role in ('admin','teacher')),
  is_head_teacher boolean not null default false,
  -- Exactly one manually bootstrapped Auth admin is marked true. The UI
  -- protects only this account from accidental deletion; later admins remain deletable.
  is_bootstrap_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- MIGRATIONS -- safe to re-run against an existing database:
--   alter table public.teachers add column if not exists is_head_teacher boolean not null default false;
--   alter table public.teachers add column if not exists is_bootstrap_admin boolean not null default false;
alter table public.teachers add column if not exists is_head_teacher boolean not null default false;
alter table public.teachers add column if not exists is_bootstrap_admin boolean not null default false;
create unique index if not exists teachers_one_bootstrap_admin_idx
  on public.teachers (is_bootstrap_admin) where is_bootstrap_admin;
-- Exactly one teacher should have is_head_teacher = true at a time; this
-- is enforced in the app (src/pages/admin/Teachers.tsx unsets the
-- previous holder before setting a new one), not by a DB constraint, so
-- the head teacher can be changed in a single admin click without a
-- transaction. The report-form export (src/lib/exportReportDocx.ts)
-- reads whichever teacher has is_head_teacher = true to print their name
-- on every class's report forms.

-- ---------- CLASSES ----------
create table if not exists public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ---------- CLASS TEACHERS ----------
-- A class can now have MORE THAN ONE class teacher (e.g. co-class-teachers
-- sharing a stream). This replaced an earlier design with a single
-- classes.class_teacher_id column -- if you ever see that column
-- referenced anywhere, it's stale, remove it; this join table is the
-- only source of truth for "who is a class teacher of what" now.
-- A teacher can also be class teacher of more than one class.
create table if not exists public.class_teachers (
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, teacher_id)
);

-- ---------- SUBJECTS ----------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ---------- LEARNERS ----------
create table if not exists public.learners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  admission_number text not null unique,
  class_id uuid not null references public.classes(id) on delete restrict,
  created_at timestamptz not null default now()
);

-- ---------- TEACHER ASSIGNMENTS ----------
create table if not exists public.teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (teacher_id, class_id, subject_id)
);

-- ---------- ACADEMIC YEARS ----------
create table if not exists public.academic_years (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  created_at timestamptz not null default now()
);

-- ---------- TERM CALENDAR ----------
-- Admin-controlled dates displayed on report forms. One row per academic year + term.
create table if not exists public.term_calendar (
  id uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete cascade,
  term int not null check (term in (1,2,3)),
  term_ends_on date not null,
  next_term_begins_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_year_id, term),
  check (next_term_begins_on >= term_ends_on)
);

-- ---------- EXAMS ----------
-- Only one exam is ever meant to be open (locked = false) for the whole
-- school at a time -- see exams_enforce_single_open below, which is the
-- real enforcement point. Defaulting locked to TRUE here matters just as
-- much as that trigger: without it, every newly-created exam would start
-- open, silently creating a second open exam the moment admin adds one,
-- before the trigger even gets a chance to close anything for them.
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  term int not null check (term in (1,2,3)),
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  locked boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- EXAM_CLASSES ----------
create table if not exists public.exam_classes (
  exam_id uuid not null references public.exams(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  primary key (exam_id, class_id)
);

-- Only one exam is meant to be open school-wide at a time, so that a
-- teacher opening "Enter Marks" always has exactly one obvious exam to
-- enter into (see the app's MarkEntry page, and AdminDashboard's
-- open-exam status). Whenever a row is set to locked = false (opened),
-- close every other exam in the same transaction -- this is the real
-- enforcement point; the app UI also does this, but this is what stops
-- a bug or a direct SQL edit from ever leaving two exams open at once.
create or replace function public.exams_enforce_single_open()
returns trigger
language plpgsql as $$
begin
  if new.locked = false then
    update public.exams set locked = true where id <> new.id and locked = false;
  end if;
  return new;
end;
$$;

drop trigger if exists exams_single_open on public.exams;
create trigger exams_single_open before insert or update of locked on public.exams
  for each row execute function public.exams_enforce_single_open();

-- ---------- MARKS ----------
create table if not exists public.marks (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  learner_id uuid not null references public.learners(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  score numeric not null check (score >= 0),
  entered_by uuid references public.teachers(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (exam_id, learner_id, subject_id)
);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================
create or replace function public.current_is_admin()
returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.teachers where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_teacher_id()
returns uuid
language sql stable as $$
  select auth.uid();
$$;

-- True if the current user is ONE OF the (possibly several) class
-- teachers for the class a given learner belongs to. Used to scope
-- marklist visibility to "class teacher(s) + admin", not every teacher
-- who has ever taught any subject in that class.
create or replace function public.is_class_teacher_of_learner(p_learner_id uuid)
returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1
    from public.learners l
    join public.class_teachers ct on ct.class_id = l.class_id
    where l.id = p_learner_id and ct.teacher_id = auth.uid()
  );
$$;

-- ============================================================
-- CBC GRADING
-- ============================================================
create or replace function public.cbc_level(p_score numeric)
returns text
language sql immutable as $$
  select case
    when p_score >= 75 then 'EE'
    when p_score >= 50 then 'ME'
    when p_score >= 25 then 'AE'
    else 'BE'
  end;
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.teachers enable row level security;
alter table public.classes enable row level security;
alter table public.class_teachers enable row level security;
alter table public.subjects enable row level security;
alter table public.learners enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.academic_years enable row level security;
alter table public.term_calendar enable row level security;
alter table public.exams enable row level security;
alter table public.exam_classes enable row level security;
alter table public.marks enable row level security;

grant usage on schema public to authenticated;
grant execute on function public.current_is_admin() to authenticated;
grant execute on function public.current_teacher_id() to authenticated;
grant execute on function public.is_class_teacher_of_learner(uuid) to authenticated;
grant execute on function public.cbc_level(numeric) to authenticated;

-- ---------- teachers ----------
-- ============================================================
-- AI / DEVELOPER CRITICAL NOTE — TEACHERS ACCESS MODEL
-- ============================================================
--
-- ROLES:
--   authenticated = browser/session role; access controlled by RLS.
--   service_role = server/Edge Function role; BYPASSRLS != BYPASS GRANTS.
--
-- CREATE-TEACHER FLOW:
--   Admin UI
--     -> src/pages/admin/Teachers.tsx
--     -> callEdgeFunction("create-teacher")
--     -> supabase/functions/create-teacher/index.ts
--     -> adminClient = service_role
--     -> adminClient.from("teachers").insert(...)
--
-- IMPORTANT:
--   auth.admin.createUser() = Auth API; no table GRANT required.
--   .from("teachers").insert() = PostgREST/table operation;
--   service_role MUST have explicit table privileges.
--
-- REQUIRED GRANTS:
--   authenticated -> normal browser CRUD + RLS
--   service_role  -> teachers CRUD because create-teacher's
--                    adminClient.from("teachers").insert(...) call
--                    needs it. reset-teacher-password does NOT need
--                    this grant -- it only calls
--                    adminClient.auth.admin.updateUserById(), which is
--                    the Auth API, not a table operation. Don't cite
--                    reset-teacher-password as a reason to widen this
--                    grant further; if that function ever starts doing
--                    its own .from("teachers") call, update this note
--                    then, not before.
--
-- KNOWN FAILURE:
--   "permission denied for table teachers"
--   => FIRST CHECK TABLE GRANTS, NOT RLS.
--
-- DIAGNOSTIC QUERY:
--   SELECT grantee, privilege_type
--   FROM information_schema.role_table_grants
--   WHERE table_name = 'teachers'
--   ORDER BY grantee, privilege_type;
--
-- EXPECTED:
--   authenticated -> SELECT/INSERT/UPDATE/DELETE
--   service_role  -> SELECT/INSERT/UPDATE/DELETE
--
-- ALSO CHECK:
--   1. src/pages/admin/Teachers.tsx
--   2. supabase/functions/create-teacher/index.ts
--   3. public.teachers GRANTS
--   4. RLS policies only AFTER GRANTS are confirmed
--
-- DO NOT "FIX" A SERVICE_ROLE GRANT ERROR BY:
--   - changing/removing RLS
--   - adding random authenticated privileges
--   - replacing service_role with anon
--   - granting service_role access to every table
--
-- SECURITY RULE:
--   service_role access must remain minimal and match actual
--   adminClient.from(...) usage in Edge Functions -- that's currently
--   ONLY public.teachers, and only from create-teacher/index.ts (see
--   the REQUIRED GRANTS note above for why reset-teacher-password
--   doesn't need it). Don't widen this grant to other tables unless an
--   Edge Function actually starts touching them via adminClient.from(...).
-- ============================================================
grant select, insert, update, delete on public.teachers to authenticated;
grant select, insert, update, delete on public.teachers to service_role;
drop policy if exists "teachers select own or admin" on public.teachers;
-- Was "id = auth.uid() or admin" (a non-admin could only see their OWN
-- row). Widened to everyone logged in, matching teacher_assignments/
-- class_teachers below -- several features need every teacher's NAME
-- visible to a non-admin class teacher, not just admin: "Teachers &
-- submissions" (MyClassLearners.tsx / Dashboard.tsx), and Report Forms
-- (ReportForms.tsx / reportRoster.ts, which prints the subject
-- teacher's name next to each learning area and the head teacher's
-- name on every report form). Under the old policy those all silently
-- rendered blank names for anyone who wasn't admin. Writes are still
-- admin-only (see the three policies below), so this only affects who
-- can READ the roster, not who can change it.
create policy "teachers select all logged in" on public.teachers for select
  to authenticated using (true);
-- MIGRATION -- if you already ran this file with the old restrictive
-- policy, run just this against your existing database (safe to re-run):
--   drop policy if exists "teachers select own or admin" on public.teachers;
--   create policy "teachers select all logged in" on public.teachers for select to authenticated using (true);
drop policy if exists "teachers insert admin only" on public.teachers;
create policy "teachers insert admin only" on public.teachers for insert
  to authenticated with check (public.current_is_admin());
drop policy if exists "teachers update admin only" on public.teachers;
create policy "teachers update admin only" on public.teachers for update
  to authenticated using (public.current_is_admin()) with check (public.current_is_admin());
drop policy if exists "teachers delete admin only" on public.teachers;
create policy "teachers delete admin only" on public.teachers for delete
  to authenticated using (public.current_is_admin());

-- ---------- classes ----------
grant select, insert, update, delete on public.classes to authenticated;
drop policy if exists "classes select all logged in" on public.classes;
create policy "classes select all logged in" on public.classes for select to authenticated using (true);
drop policy if exists "classes write admin only" on public.classes;
create policy "classes write admin only" on public.classes for all
  to authenticated using (public.current_is_admin()) with check (public.current_is_admin());

-- ---------- class_teachers ----------
-- Everyone logged in can SELECT (needed so a subject teacher's UI can
-- show who the class teacher is, and so a class teacher can see their
-- co-class-teachers); only admin can add/remove one, from the Classes
-- page.
grant select, insert, update, delete on public.class_teachers to authenticated;
drop policy if exists "class_teachers select all logged in" on public.class_teachers;
create policy "class_teachers select all logged in" on public.class_teachers for select to authenticated using (true);
drop policy if exists "class_teachers write admin only" on public.class_teachers;
create policy "class_teachers write admin only" on public.class_teachers for all
  to authenticated using (public.current_is_admin()) with check (public.current_is_admin());

-- ---------- subjects ----------
-- Learning areas are FIXED by the CBC curriculum for this grade band.
-- Nobody — not even admin — can add, rename, or delete one through the
-- app: only SELECT is granted, and there is no write policy at all, so
-- Postgres denies every insert/update/delete regardless of role or
-- session. The only way this list changes is by editing this file.
grant select on public.subjects to authenticated;
drop policy if exists "subjects select all logged in" on public.subjects;
create policy "subjects select all logged in" on public.subjects for select to authenticated using (true);
drop policy if exists "subjects write admin only" on public.subjects;

insert into public.subjects (name) values
  ('Math'), ('English'), ('Composition'), ('Kiswahili'), ('Insha'),
  ('Pre-Tech'), ('C/A'), ('Agri'), ('CRE'), ('SST'), ('Int-Sci')
on conflict (name) do nothing;

-- MIGRATION -- safe to re-run, only touches a database that still has
-- the old label. The name changed from "C-A" to "C/A" (Creative Arts).
-- Run as postgres/the SQL Editor's own role (which bypasses RLS and the
-- missing write policy entirely) -- this can NEVER be done from the
-- app, by design (see the note above: subjects has no write policy at
-- all, for any role). src/types.ts SUBJECT_GROUPS was updated to match
-- ("C/A") -- if this migration hasn't been run yet on your database,
-- the report/marklist/mark-entry screens will show no learning area
-- named "C/A" until it has.
update public.subjects set name = 'C/A' where name = 'C-A';

-- ---------- learners ----------
grant select, insert, update, delete on public.learners to authenticated;
drop policy if exists "learners select all logged in" on public.learners;
create policy "learners select all logged in" on public.learners for select to authenticated using (true);
drop policy if exists "learners write admin or class teacher" on public.learners;
create policy "learners write admin or class teacher" on public.learners for all
  to authenticated
  using (
    public.current_is_admin()
    or class_id in (select class_id from public.class_teachers where teacher_id = auth.uid())
  )
  with check (
    public.current_is_admin()
    or class_id in (select class_id from public.class_teachers where teacher_id = auth.uid())
  );

-- ---------- teacher_assignments ----------
grant select, insert, update, delete on public.teacher_assignments to authenticated;
drop policy if exists "assignments select all logged in" on public.teacher_assignments;
create policy "assignments select all logged in" on public.teacher_assignments for select to authenticated using (true);
drop policy if exists "assignments write admin only" on public.teacher_assignments;
create policy "assignments write admin only" on public.teacher_assignments for all
  to authenticated using (public.current_is_admin()) with check (public.current_is_admin());

-- ---------- academic_years ----------
grant select, insert, update, delete on public.academic_years to authenticated;
drop policy if exists "years select all logged in" on public.academic_years;
create policy "years select all logged in" on public.academic_years for select to authenticated using (true);
drop policy if exists "years write admin only" on public.academic_years;
create policy "years write admin only" on public.academic_years for all
  to authenticated using (public.current_is_admin()) with check (public.current_is_admin());

-- ---------- term_calendar ----------
grant select, insert, update, delete on public.term_calendar to authenticated;
drop policy if exists "term_calendar select all logged in" on public.term_calendar;
create policy "term_calendar select all logged in" on public.term_calendar for select to authenticated using (true);
drop policy if exists "term_calendar write admin only" on public.term_calendar;
create policy "term_calendar write admin only" on public.term_calendar for all to authenticated using (public.current_is_admin()) with check (public.current_is_admin());

-- ---------- exams ----------
grant select, insert, update, delete on public.exams to authenticated;
drop policy if exists "exams select all logged in" on public.exams;
create policy "exams select all logged in" on public.exams for select to authenticated using (true);
drop policy if exists "exams write admin only" on public.exams;
create policy "exams write admin only" on public.exams for all
  to authenticated using (public.current_is_admin()) with check (public.current_is_admin());

-- ---------- EXAM SUBJECT CONFIG (max marks) ----------
-- A subject's max marks are set PER EXAM, not fixed globally — e.g. Math
-- might be out of 70 for one exam and 100 for another. Set once (by the
-- assigned teacher or admin) before mark entry; every score for that
-- exam+subject is then validated against it and graded as a percentage
-- of it (see validate_mark_score() below and cbc_level()).
create table if not exists public.exam_subject_config (
  exam_id uuid not null references public.exams(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  max_marks numeric not null default 100 check (max_marks > 0),
  set_by uuid references public.teachers(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (exam_id, subject_id)
);

-- ---------- exam_classes ----------
grant select, insert, update, delete on public.exam_classes to authenticated;
drop policy if exists "exam_classes select all logged in" on public.exam_classes;
create policy "exam_classes select all logged in" on public.exam_classes for select to authenticated using (true);
drop policy if exists "exam_classes write admin only" on public.exam_classes;
create policy "exam_classes write admin only" on public.exam_classes for all
  to authenticated using (public.current_is_admin()) with check (public.current_is_admin());

-- ---------- exam_subject_config ----------
grant select, insert, update, delete on public.exam_subject_config to authenticated;
drop policy if exists "exam_subject_config select all logged in" on public.exam_subject_config;
create policy "exam_subject_config select all logged in" on public.exam_subject_config for select to authenticated using (true);
drop policy if exists "exam_subject_config write admin or assigned teacher" on public.exam_subject_config;
create policy "exam_subject_config write admin or assigned teacher" on public.exam_subject_config for all
  to authenticated
  using (
    public.current_is_admin()
    or exists (select 1 from public.teacher_assignments ta where ta.teacher_id = auth.uid() and ta.subject_id = exam_subject_config.subject_id)
  )
  with check (
    public.current_is_admin()
    or exists (select 1 from public.teacher_assignments ta where ta.teacher_id = auth.uid() and ta.subject_id = exam_subject_config.subject_id)
  );

-- A mark's score can never exceed the max marks configured for its
-- exam+subject (defaults to 100 if nobody has set one yet). This is the
-- real enforcement point — the app UI also blocks it, but this is what
-- stops a bad request or a bug in the UI from ever saving an impossible
-- score.
create or replace function public.validate_mark_score()
returns trigger
language plpgsql as $$
declare
  v_max numeric;
begin
  select max_marks into v_max from public.exam_subject_config
    where exam_id = new.exam_id and subject_id = new.subject_id;
  if v_max is null then
    v_max := 100;
  end if;
  if new.score > v_max then
    raise exception 'Score % exceeds max marks % for this subject/exam', new.score, v_max;
  end if;
  return new;
end;
$$;

drop trigger if exists marks_validate_score on public.marks;
create trigger marks_validate_score before insert or update on public.marks
  for each row execute function public.validate_mark_score();

-- English and Kiswahili are taught as one combined learning area in this
-- school's marklist (English = English + Composition, Kiswahili =
-- Kiswahili + Insha) even though they're two rows in the timetable. A
-- teacher given one half should automatically have the other, so admin
-- never has to remember to assign both.
create or replace function public.pair_learning_area_assignment()
returns trigger
language plpgsql as $$
declare
  v_partner_name text;
  v_this_name text;
  v_partner_id uuid;
begin
  select name into v_this_name from public.subjects where id = new.subject_id;
  v_partner_name := case v_this_name
    when 'English' then 'Composition'
    when 'Composition' then 'English'
    when 'Kiswahili' then 'Insha'
    when 'Insha' then 'Kiswahili'
    else null
  end;
  if v_partner_name is not null then
    select id into v_partner_id from public.subjects where name = v_partner_name;
    if v_partner_id is not null then
      insert into public.teacher_assignments (teacher_id, class_id, subject_id)
        values (new.teacher_id, new.class_id, v_partner_id)
      on conflict (teacher_id, class_id, subject_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists assignments_pair_learning_area on public.teacher_assignments;
create trigger assignments_pair_learning_area after insert on public.teacher_assignments
  for each row execute function public.pair_learning_area_assignment();

-- ---------- marks ----------
-- SELECT is scoped to: admin (sees everything), the class teacher of
-- the learner the mark belongs to (sees the full marklist for their
-- own class), or the teacher who entered that specific mark (so a
-- subject teacher can see their own subject's mark-entry grid without
-- being able to browse every other subject/class's results).
grant select, insert, update, delete on public.marks to authenticated;
drop policy if exists "marks select all logged in" on public.marks;
create policy "marks select admin, class teacher, or own entries" on public.marks for select
  to authenticated using (
    public.current_is_admin()
    or entered_by = auth.uid()
    or public.is_class_teacher_of_learner(learner_id)
  );
drop policy if exists "marks write teacher or admin" on public.marks;
create policy "marks write teacher or admin" on public.marks for all
  to authenticated
  using (public.current_is_admin() or entered_by = auth.uid())
  with check (public.current_is_admin() or entered_by = auth.uid());

-- ============================================================
-- MIGRATION v5: LEARNER LIFECYCLE — STATUS, ENROLLMENT HISTORY,
-- AND BULK CLASS PROMOTION
-- ============================================================
--
-- WHY THIS EXISTS:
-- Before this migration, `learners.class_id` was the ONLY record of what
-- class a learner belongs to, with no notion of academic year and no way
-- to move a whole class up (e.g. 7A -> 8A) without editing every learner
-- one at a time. Deleting a learner also hard-deleted (cascaded) their
-- entire marks history, which is unrecoverable and wrong for a learner
-- who has simply graduated or transferred out.
--
-- This migration adds:
--   1. learners.status — soft-delete / lifecycle state. Leavers are
--      archived (status changed), never hard-deleted, so their marks
--      and past report cards remain intact and reprintable.
--   2. academic_years.is_current — exactly one academic year is "the
--      current one" at a time (same pattern as is_bootstrap_admin
--      above). Promotion and new enrollments are always relative to it.
--   3. public.enrollments — a permanent per-academic-year record of
--      which class a learner was in. learners.class_id remains the
--      CURRENT class (existing code keeps working unmodified), but
--      enrollments is now the source of truth for "what class was this
--      learner in during academic year Y" — needed so that reprinting a
--      report card from a past year still shows the learner in the
--      class they were actually in at the time, even after they've
--      since been promoted or graduated.
--   4. public.promote_class() / public.graduate_class() — the only
--      supported way to bulk-move or bulk-graduate a class. Both are
--      admin-only (enforced inside the function, not just by RLS) and
--      only ever touch status='active' learners, so already-graduated
--      or already-transferred learners are never silently re-promoted.
--
-- SAFE TO RE-RUN against an existing database.
-- ============================================================

-- ---------- learners.status ----------
alter table public.learners add column if not exists status text not null default 'active'
  check (status in ('active', 'graduated', 'transferred', 'withdrawn'));
create index if not exists learners_status_idx on public.learners (status);

-- ---------- academic_years.is_current ----------
alter table public.academic_years add column if not exists is_current boolean not null default false;
create unique index if not exists academic_years_one_current_idx
  on public.academic_years (is_current) where is_current;

-- ---------- enrollments ----------
-- One row per learner per academic year: which class they were in.
-- Kept in sync automatically by the trigger below whenever a learner is
-- created or their class_id changes -- nobody should insert into this
-- table by hand.
create table if not exists public.enrollments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learners(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (learner_id, academic_year_id)
);

alter table public.enrollments enable row level security;
grant select, insert, update, delete on public.enrollments to authenticated;

-- Same visibility shape as learners: everyone logged in can read (report
-- forms / marklists need to look up a learner's historical class), but
-- writes only ever come from the trigger below (running as the table
-- owner) -- the policy still requires admin or class teacher so a
-- direct client-side write can't forge someone else's enrollment.
drop policy if exists "enrollments select all logged in" on public.enrollments;
create policy "enrollments select all logged in" on public.enrollments for select
  to authenticated using (true);
drop policy if exists "enrollments write admin or class teacher" on public.enrollments;
create policy "enrollments write admin or class teacher" on public.enrollments for all
  to authenticated
  using (
    public.current_is_admin()
    or class_id in (select class_id from public.class_teachers where teacher_id = auth.uid())
  )
  with check (
    public.current_is_admin()
    or class_id in (select class_id from public.class_teachers where teacher_id = auth.uid())
  );

-- Keeps enrollments in sync with learners.class_id automatically, for
-- BOTH a manual admin edit and a bulk promote_class() call -- there is
-- only one code path that ever needs to think about enrollments, which
-- is "class_id changed", not "how did it change".
create or replace function public.sync_learner_enrollment()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_year_id uuid;
begin
  select id into v_year_id from public.academic_years where is_current limit 1;
  -- If nobody has marked an academic year current yet, there's nothing
  -- to log against; the learner row itself still saves fine.
  if v_year_id is not null then
    insert into public.enrollments (learner_id, class_id, academic_year_id)
      values (new.id, new.class_id, v_year_id)
    on conflict (learner_id, academic_year_id)
      do update set class_id = excluded.class_id;
  end if;
  return new;
end;
$$;

drop trigger if exists learners_sync_enrollment on public.learners;
create trigger learners_sync_enrollment after insert or update of class_id on public.learners
  for each row execute function public.sync_learner_enrollment();

-- ---------- bulk promotion ----------
-- Moves every ACTIVE learner currently in p_from_class_id into
-- p_to_class_id (e.g. all of 7A -> 8A). Learners who have already
-- graduated/transferred/withdrawn are untouched. The learners.class_id
-- update fires the trigger above, which records the new class against
-- whichever academic year is currently marked is_current -- so mark
-- this year current BEFORE promoting, or the enrollment history will be
-- attributed to the wrong year.
create or replace function public.promote_class(p_from_class_id uuid, p_to_class_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.current_is_admin() then
    raise exception 'Only an admin can promote a class';
  end if;
  update public.learners
    set class_id = p_to_class_id
    where class_id = p_from_class_id and status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.promote_class(uuid, uuid) to authenticated;

-- Marks every ACTIVE learner in p_class_id as graduated (e.g. the whole
-- of 9A leaving school). Their class_id is left as-is -- it, together
-- with enrollments, remains the historical record of the class they
-- graduated from. Marks and report history are untouched; they simply
-- stop appearing in current-roster views once the app filters by
-- status='active' (see updated queries throughout src/).
create or replace function public.graduate_class(p_class_id uuid)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.current_is_admin() then
    raise exception 'Only an admin can graduate a class';
  end if;
  update public.learners
    set status = 'graduated'
    where class_id = p_class_id and status = 'active';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
grant execute on function public.graduate_class(uuid) to authenticated;

-- ============================================================
-- MIGRATION v6: TEACHER LIFECYCLE — SOFT DEACTIVATION
-- ============================================================
--
-- WHY THIS EXISTS:
-- Before this migration, removing a teacher meant deleting their Auth
-- user outright (see supabase/functions/delete-teacher/index.ts). Since
-- teachers.id references auth.users(id) on delete cascade, that also
-- silently deleted their class_teachers and teacher_assignments rows,
-- and nulled out marks.entered_by wherever they had entered a score.
-- For a school with real staff turnover over many years, that means
-- every time a teacher leaves, the report forms and mark-entry audit
-- trail for classes they used to teach quietly lose their name --
-- reportRoster.ts (which prints the subject teacher's name on report
-- forms) and marks.entered_by both read the CURRENT teachers/
-- teacher_assignments rows, not a historical snapshot.
--
-- This migration adds:
--   1. teachers.status ('active' | 'left') -- a departed teacher is
--      deactivated, not deleted. Their row, their class_teachers /
--      teacher_assignments rows, and marks.entered_by all stay intact,
--      so past report forms and mark-entry history keep printing their
--      real name. Deactivation ALSO bans their Supabase Auth account
--      (see deactivate-teacher/index.ts) so they genuinely can't log in
--      -- this is not just a cosmetic flag.
--   2. Permanent deletion (the old delete-teacher behaviour) remains
--      available, but is now only for a teacher who has already been
--      deactivated -- see the added guard in delete-teacher/index.ts.
--      It still does exactly what it did before: frees their phone
--      number for reuse by actually removing the Auth user, cascading
--      away their assignments and nulling entered_by. That's a genuine,
--      deliberate loss of historical attribution and should stay rare.
--
-- NOTE: on its own, this migration does NOT fix reportRoster.ts
-- resolving "who teaches this subject/class" from the CURRENT
-- teacher_assignments table rather than a historical snapshot -- so a
-- deactivated teacher whose assignment is later reassigned could still
-- have an old report reprint show the new teacher's name. That gap is
-- closed by migration v7 immediately below (subject_teacher_history /
-- class_teacher_history / head_teacher_history), which this migration
-- was deliberately scoped to leave for its own change.
--
-- SAFE TO RE-RUN against an existing database.
-- ============================================================

alter table public.teachers add column if not exists status text not null default 'active'
  check (status in ('active', 'left'));
create index if not exists teachers_status_idx on public.teachers (status);


-- ============================================================
-- MIGRATION v7: REPORT ROSTER HISTORY — WHO ACTUALLY TAUGHT/LED
-- A CLASS DURING A GIVEN ACADEMIC YEAR
-- ============================================================
--
-- WHY THIS EXISTS:
-- src/lib/reportRoster.ts resolves the three names printed on a report
-- form -- the subject teacher for each learning area, the class
-- teacher(s), and the head teacher -- by looking at teacher_assignments,
-- class_teachers, and teachers.is_head_teacher AS THEY ARE RIGHT NOW.
-- None of those tables remember who held a role in the past; a change
-- simply overwrites the old assignment.
--
-- Concretely: report forms for class 8A's English exam in 2026 are
-- generated correctly while Teacher A is still assigned to 8A English.
-- If Teacher A later leaves and Teacher B takes over 8A English in
-- 2027, REPRINTING that same 2026 report form afterwards would look up
-- "who teaches 8A English" again, get Teacher B (today's answer), and
-- print B's name on a 2026 document B never taught. The scores and
-- grades are unaffected -- only these three name fields were wrong.
--
-- This migration adds three small history tables, one per name that
-- reportRoster.ts resolves, each kept in sync automatically by a
-- trigger the moment the corresponding "current" table changes. They
-- are populated going forward from whenever this migration is run; they
-- do NOT retroactively reconstruct history from before that point (the
-- old data to do so doesn't exist). src/lib/reportRoster.ts falls back
-- to the current tables when no historical row exists yet for a given
-- academic year, so nothing breaks for years predating this migration.
--
-- DESIGN NOTE -- WHY teacher_name IS STORED AS TEXT, NOT JUST A FK:
-- A first pass at this made teacher_id `not null ... on delete
-- restrict`. That's wrong and was caught before shipping: teachers.id
-- references auth.users(id) on delete cascade (see delete-teacher/
-- index.ts), so permanently deleting ANY teacher who ever appeared on
-- ANY report form would fail with a foreign key violation the moment
-- these history tables existed -- the exact opposite of what
-- delete-teacher is supposed to do. A report form is a historical
-- document: what it says shouldn't change even if the person it names
-- is later edited or removed from the system entirely, the same way
-- deleting a teacher's HR record doesn't rewrite old paper report
-- cards. So each table snapshots teacher_name (plain text) at the
-- moment it's recorded, and teacher_id is nullable with `on delete set
-- null` -- kept only as a convenience reference back to the live row
-- when it still exists, never required for the name to print correctly.
--
-- SAFE TO RE-RUN against an existing database.
-- ============================================================

-- ---------- subject_teacher_history ----------
-- Who taught a given class+subject during a given academic year. One
-- row per (class, subject, year) -- matches reportRoster.ts's existing
-- assumption of a single subject teacher per class (it already does a
-- plain .find() against teacher_assignments, taking the first match).
create table if not exists public.subject_teacher_history (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  teacher_id uuid references public.teachers(id) on delete set null,
  teacher_name text not null,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (class_id, subject_id, academic_year_id)
);
alter table public.subject_teacher_history enable row level security;
grant select on public.subject_teacher_history to authenticated;
drop policy if exists "subject_teacher_history select all logged in" on public.subject_teacher_history;
create policy "subject_teacher_history select all logged in" on public.subject_teacher_history for select
  to authenticated using (true);
-- No insert/update/delete grant to authenticated at all, on purpose --
-- the only writer is the trigger below (runs as the function owner, so
-- it doesn't need one). Don't add a write grant here "to fix a
-- permission error"; nothing in the app should ever write this table
-- directly.

create or replace function public.sync_subject_teacher_history()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_year_id uuid;
  v_teacher_name text;
begin
  select id into v_year_id from public.academic_years where is_current limit 1;
  if v_year_id is not null then
    select name into v_teacher_name from public.teachers where id = new.teacher_id;
    insert into public.subject_teacher_history (class_id, subject_id, teacher_id, teacher_name, academic_year_id)
      values (new.class_id, new.subject_id, new.teacher_id, coalesce(v_teacher_name, 'Unknown'), v_year_id)
    on conflict (class_id, subject_id, academic_year_id)
      do update set teacher_id = excluded.teacher_id, teacher_name = excluded.teacher_name;
  end if;
  return new;
end;
$$;

drop trigger if exists assignments_sync_history on public.teacher_assignments;
create trigger assignments_sync_history after insert on public.teacher_assignments
  for each row execute function public.sync_subject_teacher_history();

-- ---------- class_teacher_history ----------
-- Who was A class teacher of a given class during a given academic
-- year. A class can have co-class-teachers, so unlike the table above
-- this is a set, not a single value -- reportRoster.ts already joins
-- multiple names together for classTeacherName (e.g. "Jane Doe & John
-- Smith"), and the historical lookup preserves that.
create table if not exists public.class_teacher_history (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  teacher_id uuid references public.teachers(id) on delete set null,
  teacher_name text not null,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (class_id, teacher_id, academic_year_id)
);
alter table public.class_teacher_history enable row level security;
grant select on public.class_teacher_history to authenticated;
drop policy if exists "class_teacher_history select all logged in" on public.class_teacher_history;
create policy "class_teacher_history select all logged in" on public.class_teacher_history for select
  to authenticated using (true);

create or replace function public.sync_class_teacher_history()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_year_id uuid;
  v_teacher_name text;
begin
  select id into v_year_id from public.academic_years where is_current limit 1;
  if v_year_id is not null then
    select name into v_teacher_name from public.teachers where id = new.teacher_id;
    insert into public.class_teacher_history (class_id, teacher_id, teacher_name, academic_year_id)
      values (new.class_id, new.teacher_id, coalesce(v_teacher_name, 'Unknown'), v_year_id)
    on conflict (class_id, teacher_id, academic_year_id)
      do update set teacher_name = excluded.teacher_name;
  end if;
  return new;
end;
$$;

drop trigger if exists class_teachers_sync_history on public.class_teachers;
create trigger class_teachers_sync_history after insert on public.class_teachers
  for each row execute function public.sync_class_teacher_history();

-- ---------- head_teacher_history ----------
-- Who was THE head teacher during a given academic year -- a single,
-- school-wide value, unlike the two above. One row per academic year.
create table if not exists public.head_teacher_history (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid references public.teachers(id) on delete set null,
  teacher_name text not null,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (academic_year_id)
);
alter table public.head_teacher_history enable row level security;
grant select on public.head_teacher_history to authenticated;
drop policy if exists "head_teacher_history select all logged in" on public.head_teacher_history;
create policy "head_teacher_history select all logged in" on public.head_teacher_history for select
  to authenticated using (true);

create or replace function public.sync_head_teacher_history()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_year_id uuid;
begin
  if new.is_head_teacher then
    select id into v_year_id from public.academic_years where is_current limit 1;
    if v_year_id is not null then
      insert into public.head_teacher_history (teacher_id, teacher_name, academic_year_id)
        values (new.id, new.name, v_year_id)
      on conflict (academic_year_id)
        do update set teacher_id = excluded.teacher_id, teacher_name = excluded.teacher_name;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists teachers_sync_head_history on public.teachers;
create trigger teachers_sync_head_history after update of is_head_teacher on public.teachers
  for each row execute function public.sync_head_teacher_history();

-- ---------- keepalive_ping ----------
-- Called on a schedule by .github/workflows/keep-alive.yml so the free-tier
-- Supabase project doesn't get paused for inactivity. Does nothing but
-- prove the DB round-trip works; granted to anon specifically so the
-- workflow can call it with only the anon key (no service role needed).
create or replace function public.keepalive_ping()
returns void
language sql
security definer
as $$ select 1; $$;

grant execute on function public.keepalive_ping() to anon;

-- ---------- update_own_name ----------
-- Lets a logged-in teacher/admin rename themselves without opening up
-- general write access to public.teachers (which stays admin-only --
-- see "teachers update admin only" above). This function only ever
-- touches the caller's own row and only ever touches `name`, so it
-- can't be used to change role, status, or anyone else's record.
create or replace function public.update_own_name(new_name text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if new_name is null or length(trim(new_name)) = 0 then
    raise exception 'Name cannot be empty';
  end if;
  update public.teachers set name = trim(new_name) where id = auth.uid();
end;
$$;

grant execute on function public.update_own_name(text) to authenticated;
