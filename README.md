# JSS Exam Portal — Kariobangi South Primary and Junior School

A single-school Junior Secondary exam management portal built with **Vite + React + TypeScript + Tailwind CSS**, using **Supabase PostgreSQL, Supabase Authentication, Row Level Security (RLS), and Supabase Edge Functions**. Vercel hosts the frontend; Supabase is the backend.

> **Important:** This README is the current operating guide. The project has several deliberate architectural decisions and historical security fixes. Do not replace them with a simpler-looking architecture without checking the relevant code first.

## 1. Current product behaviour

- Single school; not multi-tenant.
- Two roles: `admin` and `teacher`. An admin's account **can also** be assigned as a class/subject teacher (nothing in the schema stops this) — see §2.2 for the post-login Admin/Teacher view picker this makes necessary.
- Login: **Phone Number + Password**. TSC number is optional record data and is **not** used for login.
- Every logged-in user (admin or teacher) can change their own name and password from **My Profile** — see §2.3.
- Nine official learning-area outputs: Math, English, Kiswahili, Pre-Tech, C/A, Agri, CRE, SST, Int-Sci.
- English and Composition are stored as separate raw marks but combined everywhere in official output. Kiswahili and Insha work the same way. Mark entry keeps the two halves of a pair fully independent (a tab switcher, not two columns side by side) — a teacher finishes one half for the whole class, then switches to the other; see §5.
- Exam-specific maximum marks are configurable. CBC levels are calculated from percentage: `>=75 EE`, `>=50 ME`, `>=25 AE`, otherwise `BE`.
- Admin manages teachers, classes, learners, exams, assignments, term dates and the head teacher.
- A learner's admission number must be digits only (enforced in `Learners.tsx`); non-digit characters are stripped as the admin types, and save is blocked if the field isn't purely numeric. It is still stored as `text` in the database (see `schema.sql`), which preserves any leading zeros — it is not cast to a numeric column.
- Class teachers can have multiple co-class-teachers through `class_teachers`.
- Learners and teachers who leave are **archived/deactivated, never hard-deleted** — see §4.1. Everyday "this person is gone" workflows keep their history intact; permanent deletion is a separate, rarer action.
- Whole classes are promoted (or graduated) at once from the **Promote Classes** admin page, not by editing learners one at a time — see §4.1.
- Reports include learner results, CBC levels, remarks, teachers, comments, progress history and term dates.
- If there is no previous exam history, the fixed progress box says **“Building today for a brighter tomorrow.”**
- Report footer: **“School Motto: Strive for Excellence.”**
- Login Bible verses retain their scripture references but do not display the Bible version label.

## 2. Authentication architecture — READ THIS BEFORE TOUCHING LOGIN

The visible login form is **Phone Number + Password**. The application converts the entered phone number into an internal Auth email using the only canonical helper:

`src/lib/credentials.ts` → `phoneToEmail(phone)` → `{phone}@jssportal.internal`

Supabase Auth then authenticates that derived email with the real password. The user never needs to know or type the internal email.

After Supabase Auth returns a session, `src/lib/auth.tsx` uses `auth.users.id` to load the matching row in `public.teachers`. The UUID relationship is:

`auth.users.id = public.teachers.id`

The `teachers` row supplies the application's name, phone, TSC record and **role**. The browser does not get to choose its own role. RLS and server-side checks enforce access.

### 2.1 The very first admin is a bootstrap account

There is an intentional chicken-and-egg problem: the `create-teacher` Edge Function only creates accounts for an already-authenticated admin. Therefore the **first admin must be created manually once** in Supabase Authentication.

Bootstrap sequence:

1. Run `supabase/schema.sql` on the target Supabase project.
2. In Supabase Dashboard → **Authentication → Users → Add user**, create the first Auth user.
3. Use email `<phone-number>@jssportal.internal`, matching `phoneToEmail()` exactly.
4. Set a real password and enable **Auto Confirm User**.
5. Copy the Auth user's UUID.
6. Put that UUID and the same phone number into `supabase/seed.sql`.
7. Run `supabase/seed.sql` once. It creates the matching `teachers` row with `role='admin'` and `is_bootstrap_admin=true`.
8. Log in using the phone number + password.

**Only this bootstrap account is special.** Later admins are normal accounts created from the Admin Portal and remain deletable. The UI specifically fades/disables Delete and Reset password only for the `is_bootstrap_admin=true` account. Every other admin (including later ones) can still be deleted and password-reset like any teacher.

If an existing database was created before the bootstrap flag existed, run the migration comments in `schema.sql` and mark the known original bootstrap row `is_bootstrap_admin=true` before relying on the protected-delete UI.

### 2.2 Admin/Teacher view picker

Because an admin account can also be assigned as a class/subject teacher, `App.tsx` shows an `AdminRoleChoice` prompt to **every** admin on **every** login ("Admin Page" or "Teacher Page") — it is not a one-time/remembered choice, and it is not shown to plain teacher accounts. Whichever is picked becomes `effectiveRole` for that session, which drives the sidebar nav (`Shell.tsx`) and which half of `Dashboard.tsx` renders. The underlying `user.role` from `teachers` never changes and still governs all real permissions via RLS — `effectiveRole` is purely a UI lens. An admin can flip between the two at any time via **Switch to Teacher/Admin view** near the top of the sidebar, without signing out; this resets the current view back to Dashboard. Plain teacher accounts never see this switcher.

### 2.3 Self-service profile (My Profile)

Every logged-in user, admin or teacher, has a **My Profile** page (`src/pages/Profile.tsx`) to change their own name and password:

- **Name** goes through the `update_own_name(new_name text)` Postgres function (`schema.sql`), called via `supabase.rpc(...)`. This exists because `public.teachers` UPDATE is admin-only by RLS (§3) — the function is a narrow, `security definer` exception that can only ever update the caller's own row (`auth.uid()`) and only ever the `name` column. It cannot be used to change role, status, phone number, or anyone else's row. Do not widen this function's scope or replace it with a general teachers-table RLS relaxation.
- **Password** goes straight through `supabase.auth.updateUser({ password })` — ordinary Supabase Auth, unrelated to `public.teachers`/RLS, no Edge Function needed.

### 2.4 All later teachers/admins

Admin Portal → Teachers → Add teacher calls:

`create-teacher` Edge Function → verifies caller's Auth token → verifies caller's `teachers.role='admin'` → uses the **server-side Supabase service-role key** → creates Auth user → inserts matching `teachers` row → rolls back the Auth user if the profile insert fails.

The Edge Function explicitly sets `is_bootstrap_admin=false` for every account it creates.

Password resets use `reset-teacher-password`, which independently verifies the caller is an admin and updates the target Auth password server-side.

### 2.5 Deleting a teacher

`public.teachers.id references auth.users(id) on delete cascade` (see `schema.sql`). That means the *correct* way to remove a teacher is to delete their **Auth user** — the matching `public.teachers` row disappears automatically via the cascade, along with their `class_teachers` and `teacher_assignments` rows (also `on delete cascade`), and `marks.entered_by` is nulled out (`on delete set null`) rather than deleting anyone's marks.

Admin Portal → Teachers → Delete calls `delete-teacher`, gated exactly like `create-teacher` and `reset-teacher-password` (caller's session proves admin, then the service-role key deletes the Auth user server-side). It also re-checks server-side that the target isn't the bootstrap admin — the disabled Delete button in the UI is not the real security boundary.

**Do not** "fix" this by calling `supabase.from("teachers").delete()` directly from the frontend again. That only removes the profile row and leaves the Auth login alive on `{phone}@jssportal.internal` forever — which is exactly the bug this function was written to fix: a deleted teacher's phone number could never be reused, because Auth still considered it taken.

## 3. Critical security rule

**Never put the service-role key in a `VITE_` environment variable.** Any `VITE_` variable is bundled into the browser. The service-role key bypasses RLS and must exist only in Supabase Edge Function secrets.

Frontend environment variables are the public project URL and anon key only.

Required Edge Function secret:

```bash
supabase secrets set SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

## 4. Database architecture

Key tables:

- `teachers` — school staff profile, role and Auth UUID bridge.
- `classes` — school classes/streams.
- `class_teachers` — many-to-many class-teacher assignments.
- `subjects` — fixed learning-area/component records.
- `learners` — learners and their class.
- `teacher_assignments` — teacher/class/subject teaching assignments.
- `academic_years` — academic years.
- `term_calendar` — admin-controlled term end and next-term start dates.
- `exams` — named exams, term and academic year, with locking.
- `exam_classes` — classes sitting an exam.
- `exam_subject_config` — exam-specific maximum marks.
- `marks` — learner/exam/subject raw scores.

RLS is enabled on the application tables. The database is the final security boundary; hiding a button in React is not a substitute for RLS.

## 4.1 Learner & teacher lifecycle — status, promotion, enrollment history (migrations v5/v6)

**Read this before "fixing" anything that looks like a missing delete button.** Early versions of this app had no concept of a learner or teacher leaving — removing either one was a hard, cascading DELETE that permanently destroyed their marks history (for a learner) or their assignments and mark-entry attribution (for a teacher). Over a real multi-year run with cohorts graduating and staff turning over, that's actively harmful. Migrations v5 and v6 in `schema.sql` replaced this with soft-delete lifecycles. Do not reintroduce raw `.delete()` calls for learners or teachers from the app UI — go through the paths below.

**Learners** (`learners.status`: `active | graduated | transferred | withdrawn`, migration v5):

- The everyday "this learner is gone" action is **Archive**, in `Learners.tsx` — it sets `status`, never deletes the row. Archived learners disappear from current-roster views (mark entry, dashboard counts) but their marks and past report forms are untouched and reprintable.
- "Delete permanently" is only offered for already-archived learners, and really does cascade-delete their marks — use it only for genuine data-entry mistakes (e.g. a duplicate learner created by accident), not for normal leavers.
- `public.enrollments` is a permanent per-academic-year record of which class a learner was in, kept in sync automatically by the `sync_learner_enrollment` trigger whenever a learner is created or their `class_id` changes. `learners.class_id` is still the learner's *current* class (existing code that reads it directly keeps working); `enrollments` is what historical screens use to reconstruct "who was in 7A during the 2026 academic year" so that a report reprinted after a promotion still shows the right roster. See `src/lib/enrollment.ts` (`fetchHistoricalLearners`), used by `Results.tsx`, `ReportForms.tsx`, and `OverallMarklist.tsx`.
- **Promoting a whole class** (e.g. all of 7A → 8A at year rollover) is done from the admin **Promote Classes** page (`src/pages/admin/Promote.tsx`), which calls the `promote_class(from, to)` Postgres function — never edit every learner's `class_id` by hand. **Graduating** a class (leaving the school entirely) uses the same page and calls `graduate_class(class_id)`, which sets `status = 'graduated'` for everyone active in that class.
- Both functions only ever touch `status = 'active'` learners and are admin-only, enforced *inside* the function (`current_is_admin()`), not just by RLS or a disabled button.
- **Before promoting at year rollover, mark the new academic year current** on the Academic Years page (`AcademicYears.tsx`, `academic_years.is_current`) — `promote_class`/`graduate_class` change `class_id`/`status`, and the enrollment trigger records the move against whichever year is currently marked current. Promoting before flipping the current year attributes the move to the wrong year.

**Teachers** (`teachers.status`: `active | left`, migration v6):

- The everyday "this teacher has left" action is **Deactivate**, in `Teachers.tsx`, which calls the `deactivate-teacher` Edge Function. This **bans their Supabase Auth account** (`ban_duration` via the Admin API) so they genuinely can't log in, and sets `status = 'left'` — but does **not** touch `class_teachers`, `teacher_assignments`, or `marks.entered_by`. Their name keeps printing correctly on report forms and their entered marks keep their real audit trail.
- **Reactivate** (`reactivate-teacher` Edge Function) unbans them and sets `status = 'active'` again.
- **Delete permanently** (the original `delete-teacher` Edge Function) is now only reachable for an already-deactivated teacher — it's gated server-side, not just hidden in the UI. It still does what it always did: deletes the Auth user, which cascades away `class_teachers`/`teacher_assignments` and nulls `marks.entered_by`. Use it only to genuinely free up a phone number or clean up a mistaken entry.
- A deactivated teacher can't be newly assigned as a class teacher (`Classes.tsx` filters them out of the picker) or given new subject assignments (`Teachers.tsx`'s assignment grid disables adding new ones, but still allows removing stale ones) — existing assignments from before they left are left alone so historical reports keep resolving correctly.
- **This gap is closed by migration v7** (see below) — `reportRoster.ts` now resolves the subject teacher, class teacher(s), and head teacher from per-academic-year history tables rather than the current live tables, so a reprint stays accurate even after a teacher leaves and their slot is reassigned.

## 4.2 Report roster history (migration v7)

`src/lib/reportRoster.ts` prints three names on every report form: the subject teacher for each learning area, the class teacher(s), and the head teacher. Migration v6 fixed teacher *deletion* losing that attribution; it deliberately left one thing unfixed: even with a teacher merely deactivated (not deleted), `reportRoster.ts` was still resolving all three names from `teacher_assignments`/`class_teachers`/`teachers.is_head_teacher` **as they are right now**, not as they were when the exam happened. Reassign 8A's English slot from Teacher A (2026) to Teacher B (2027), and reprinting the 2026 report form would show Teacher B — wrong, even though the marks and grades on that form are still correct.

Migration v7 adds three small history tables — `subject_teacher_history`, `class_teacher_history`, `head_teacher_history` — one per name `reportRoster.ts` resolves. Each is kept in sync automatically by a trigger the moment the corresponding live table changes (a new `teacher_assignments` row, a new `class_teachers` row, or `is_head_teacher` being set), recorded against whichever academic year is currently marked current (see §4.1). `reportRoster.ts` looks up the exam's academic year in these tables first, and only falls back to the live tables when no history row exists yet for that year (which is expected and fine for any exam that predates this migration).

**Important design point:** each history table stores the teacher's **name as plain text**, snapshotted at the moment it's recorded — not just a foreign key to `teachers.id`. An earlier draft of this migration used `on delete restrict` on that foreign key, which would have made it *impossible to ever permanently delete a teacher* who'd appeared on any report form, since `delete-teacher` deletes the Auth user, which cascades to `public.teachers`, which the restrict would then block. The foreign key is `on delete set null` and nullable; the name that actually prints comes from the `teacher_name` text column, which survives regardless of what later happens to the teacher's row. This mirrors how a real paper report card works — deleting someone's HR record doesn't rewrite what's already printed on old paper.

These three tables are populated **going forward only** from whenever migration v7 is run — there's no way to retroactively reconstruct who taught what in years before this existed, since that information was never recorded anywhere.




## 5. Subjects and combined components

`subjects` is seeded once from `schema.sql` and has **no write policy at all** — not INSERT, UPDATE, or DELETE, for any role including admin. The only way to change a learning-area name on an already-deployed database is a one-time SQL statement run directly in the Supabase SQL Editor (which runs as `postgres` and isn't subject to RLS), then updating `SUBJECT_GROUPS` in `src/types.ts` and the seed in `schema.sql` to match. `schema.sql` includes the migration that renamed `C-A` to `C/A` as a worked example — follow that same pattern for any future rename.

There is deliberately **no "Learning Areas" admin page any more** (it was removed — the old `src/pages/admin/Subjects.tsx` and its "Learning Areas" nav item are gone). It was a read-only list reflecting a table the UI can't write to anyway, so it was cluttering the admin sidebar for zero admin-facing benefit. Subjects are still fully in the database and drive everything else (mark entry, marklist, reports); only the standalone admin page for viewing the raw list was removed. If a future admin genuinely needs to see the raw subjects list again, re-add it as a small section inside an existing page rather than reintroducing a dedicated sidebar item for it.

The admin sidebar (`Shell.tsx`, `adminGroups`) is also grouped into collapsible sections — **Manage** (Teachers, Classes, Learners), **Academics** (Academic Years, Promote Classes, Class History, Assessments), **Reports** (Marklist, Overall Marklist, Report Forms) — with Dashboard and My Profile left ungrouped at the top/bottom. Only the section containing the current page is expanded by default; navigating into a section auto-expands it. The teacher sidebar stays flat (6 items) — there's no grouping need there. When adding a new admin page, put it in the most fitting existing group rather than adding a 4th group or a new top-level ungrouped item, to keep the sidebar from creeping back up in size.

Teacher mark entry may expose raw **English + Composition** and **Kiswahili + Insha** inputs. Everywhere else these remain combined learning areas.

Mark entry treats each half as a fully separate, independent session — see `src/pages/teacher/MarkEntry.tsx`. Selecting English or Kiswahili shows a tab switcher for the subject and its pair; only one half's score column is on screen and being saved at a time (`activeView` in that file). They are never shown as two columns side by side, and setting the max marks or saving one half never requires the other half to be configured first.

Combined percentage is:

`(sum of component scores / sum of component maximums) × 100`

Never average component percentages when maximums differ.

`src/types.ts` → `SUBJECT_GROUPS` is the frontend grouping source of truth.
`src/lib/marklist.ts` performs the combined calculation and CBC grading.
The database trigger `pair_learning_area_assignment()` handles paired teacher assignments.

## 6. Reports

`src/pages/ReportForms.tsx` loads learners, marks, exam maximums, teacher assignments, class teachers, historical results and term dates. It builds the same marklist calculation used elsewhere.

`src/lib/exportReportDocx.ts` generates the printable DOCX report. Every `Table` in that file sets `layout: TableLayoutType.FIXED`. Without it, Word (and some mobile Word/Word-Online renderers in particular) is free to recompute column widths from cell content instead of honouring the DXA widths set on every cell — on the main results table that showed up as the Teacher column (and several data cells) rendering detached from the table, overlapping other content. If you add a new `Table` to this file, set `layout: TableLayoutType.FIXED` on it too, or you can reintroduce the same class of bug.

The Grand Total uses the **same CBC rubric** as the learning areas, based on the overall `grandTotal / grandMax` percentage.

### 6.1 Analysis PDF export

Both grade-distribution "Analysis" tabs — per-class (`Results.tsx`) and grade-wide (`OverallMarklist.tsx` → Overall Analysis) — have a **Download .pdf** button next to the existing **Download .xlsx** one. Both are generated by `src/lib/exportAnalysisPdf.ts` using `jspdf` + `jspdf-autotable`, and are always rendered **landscape**: the analysis table is only 6 columns but was looking cramped/squeezed on a portrait page, so landscape gives it room regardless of how many learning-area rows it has. If you add more analysis-style tables, reuse this file rather than writing another one-off PDF exporter.

The report displays:

- Term ends: admin-configured date
- Next term begins: admin-configured date
- Grand Total CBC Level
- **School Motto: Strive for Excellence.** in the footer

## 7. Term dates

Admins set dates from **Admin → Exams → Term dates**. Dates are stored by academic year + term in `term_calendar`.

The database requires the next term start date to be on or after the current term end date. Report Forms reads the matching academic-year/term record.

If no dates have been configured, the report safely displays **Not set** rather than inventing dates.

## 7.1 Score entry UX

Score inputs in `MarkEntry.tsx` use the `no-spinner` CSS class (`src/styles.css`) to hide the native number-input up/down arrows, and an `onKeyDown` handler so **Enter** moves focus to the next learner's box instead of nudging the value or doing nothing useful. If you add another numeric entry grid, reuse both.

## 7.2 Mobile

Most teachers use phones, not desktops. `Shell.tsx` already carries all navigation through a single "Menu" button on narrow screens rather than a bottom tab bar. Wide data tables (the Mark Entry grid, the per-learner subject breakdown in Report Forms) are wrapped in a horizontally-scrolling container with a sticky first column rather than left to squeeze every column down to unreadable widths — follow that pattern for any new table-shaped UI rather than relying on text simply wrapping.

## 7.3 Exam creation, auto-assignment and open/closed

Creating an exam (Admin → Exams) automatically inserts an `exam_classes` row for **every** existing class — there is no manual "assign classes" step any more. This only happens at creation time; a class added to the school *after* an exam already exists is not retroactively added to that older exam.

"Open" and "closed" both key off `exams.locked`: `locked = false` means open, `locked = true` means closed. The exam list only ever shows a green **Open** badge when `!locked` — a locked/closed exam intentionally shows **no** badge at all (the absence of the green pill already means closed, so a second "Closed" indicator would be redundant).

Because the per-exam class list is now always "every class", the exam list row shows that exam's term dates (from `term_calendar`, matched by the exam's `academic_year_id` + `term`) instead of a class count, which would otherwise always just read "all classes" and tell the admin nothing new.

**Not yet enforced:** the school's intent is that only one exam can be open (unlocked) at a time. That business rule is not implemented in code yet — nothing currently stops an admin from unlocking more than one exam — and is expected to be added in a future admin-side change. The teacher dashboard's "exam status" pill (§7.4) is already written to correctly display multiple exam names if that happens, but the single-open-exam constraint itself still needs its own implementation (likely a check in `toggleLock`/`exams` policy) once specified.

## 7.4 Dashboard "exam status"

Both dashboards' assessment stat now use the same color language: **green** with the exam name when something is open, **red** when nothing is.

- **Teacher dashboard:** "Open assessments" names the specific exam(s) that are open (e.g. "Mid Term") in green with a dot indicator, so a teacher can see at a glance which exam they should be entering marks for. If nothing is open it now reads **"None" in red** — previously this whole stat was plain grey either way, which is what made it hard to tell apart from every other quiet stat on the page.
- **Admin dashboard:** unchanged in layout — a single "Assessment" stat naming the one open exam in green (there can only ever be one, see `exams_single_open`), or **"No exam open" in red** when there isn't one (previously grey).

## 7.5 Class-teacher-only visibility (teacher portal)

A teacher should only see submissions and analysis for a class where they are that class's class teacher (`class_teachers`), not merely a subject teacher in it (`teacher_assignments`). This is already enforced in two independent places, and both were re-verified rather than changed:

- **UI:** `Results.tsx` (marklist + class analysis) and `ReportForms.tsx` filter `visibleClasses` down to `class_teachers` rows for the logged-in teacher. `MyClassLearners.tsx` / `ClassTeachersStatus` (the "Teachers & submissions" tab, and the equivalent block on the teacher dashboard) are likewise driven only by the teacher's own `class_teachers` rows. `OverallMarklist.tsx` (grade-wide analysis) is admin-only and never reachable from the teacher portal (`App.tsx`).
- **Database (the real boundary):** the `marks` RLS SELECT policy only allows a row through for `current_is_admin()`, `entered_by = auth.uid()` (a teacher's own entered marks, needed for mark entry), or `is_class_teacher_of_learner(learner_id)`. A teacher who is not a class's class teacher cannot read that class's marks at all from the database, regardless of what the UI does.

## 7.6 My Class learner-status tabs (teacher portal only)

`src/pages/admin/Learners.tsx` backs both the admin **Learners** page and the teacher-facing **My Class** tab (via `restrictToClassId`, rendered from `MyClassLearners.tsx`). The two now show different status tabs:

- **Admin Learners page** (`restrictToClassId` unset): all five tabs — Active, Graduated, Transferred, Withdrawn, All.
- **Teacher My Class view** (`restrictToClassId` set): only **Active**, **Transferred**, and, only for a grade 9 class, **Graduated**. **Withdrawn** and **All** are never shown here — those are treated as admin-only concerns. The "Mark as…" archive dropdown is filtered to match (a class teacher is never offered a status they'd have no tab to see again).
- **Grade detection:** classes have no dedicated numeric grade column — their `name` is always written starting with the grade digit (e.g. `9A1`, `7C2`, `8B3`). "Grade 9" is detected as `name` starting with `"9"`. If class-naming conventions ever change (e.g. a class named without a leading grade digit), this check in `Learners.tsx` (`isGrade9`) needs updating, or the schema should gain a real `grade` column instead of inferring it from the name.

## 8. Project map

```text
src/                         React application
src/App.tsx                  Top-level view router; owns effectiveRole (admin vs teacher view) -- see §2.2
src/components/AdminRoleChoice.tsx  Post-login Admin/Teacher page prompt for admin accounts -- see §2.2
src/pages/                   Main screens
src/pages/Profile.tsx        Self-service name + password change for any logged-in user -- see §2.3
src/pages/admin/             Admin screens
src/pages/admin/Learners.tsx Admin Learners page AND the teacher "My Class" tab (via restrictToClassId) -- see §7.6
src/pages/admin/Promote.tsx  Bulk class promotion / graduation (calls promote_class/graduate_class RPCs)
src/pages/admin/AcademicYears.tsx  Academic years + "set current" control
src/pages/teacher/           Teacher screens
src/lib/                     Auth, calculations, exports and helpers
src/lib/enrollment.ts        Historical class-membership lookup (fetchHistoricalLearners) -- see §4.1
src/lib/reportRoster.ts      Resolves subject/class/head teacher names for report forms, history-first -- see §4.2
src/lib/exportAnalysisPdf.ts Landscape PDF export for the Analysis tabs (jspdf + jspdf-autotable)
supabase/schema.sql          Tables, functions, triggers, RLS and grants (includes keepalive_ping, update_own_name)
supabase/seed.sql            Bootstrap admin link
supabase/functions/          Privileged server-side account operations
supabase/functions/deactivate-teacher/  Bans a teacher's Auth login, sets status='left' -- see §4.1
supabase/functions/reactivate-teacher/  Reverses deactivate-teacher
.github/workflows/            Supabase keep-alive workflow -- see §12
```

## 9. Local development

From the project root:

```bash
npm install
npm run dev
npm run build
npm run preview
```

`npm run build` must pass before deployment.

## 10. Supabase deployment order

For a fresh Supabase project:

1. Create/select the Supabase project.
2. Run the entire `supabase/schema.sql`.
3. Set the Edge Function service-role secret.
4. Deploy all three Edge Functions.
5. Manually create the first Auth user.
6. Update and run `supabase/seed.sql` with that Auth UUID and phone.
7. Log in as the bootstrap admin.
8. Create all subsequent admins/teachers from the Admin Portal.
9. Set academic years/classes/exams/term dates.
10. Test teacher creation, deletion, password reset, assignments, mark entry, RLS and reports.

Example function deployment:

```bash
supabase functions deploy create-teacher
supabase functions deploy reset-teacher-password
supabase functions deploy delete-teacher
```

## 11. Vercel deployment

Vercel hosts only the Vite frontend. Configure the two public frontend variables in Vercel:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Do **not** add the service-role key to Vercel frontend environment variables.

After deployment, test the production URL with the bootstrap admin first, then test creation of a normal teacher and a second admin.

## 12. GitHub keep-alive

`.github/workflows/keep-alive.yml` periodically calls the `public.keepalive_ping()` Postgres function (defined in `schema.sql`, granted to `anon`) via PostgREST, so the free-tier Supabase project doesn't get paused for inactivity. **Both halves must exist for this to work** — the workflow calling a function that isn't in the deployed schema will fail silently-ish (a 404-style PostgREST error in the Action log). If you ever recreate the database from `schema.sql`, this function comes with it automatically; if you ever hand-edit the workflow's RPC name, update `keepalive_ping()` (or add a new function) to match.

The GitHub repository secrets are:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

Never use the service-role key for the keep-alive workflow.

## 13. Troubleshooting — check these before changing code

### Login says invalid credentials
Check that the phone number exactly matches the `phone_number` stored in `teachers`, and that the corresponding Auth email is exactly `{phone}@jssportal.internal`. Check that the Auth user exists and is confirmed.

### Login succeeds but no dashboard appears
Check `auth.users.id = teachers.id` and that the matching `teachers` row exists.

### First admin cannot be created from the portal
That is expected. Bootstrap the first Auth user manually, then link it with `seed.sql`.

### create-teacher says admin access required
Check the caller's Auth session and matching `teachers.role`. Then check the Edge Function logs.

### create-teacher says permission denied for teachers
Check the explicit `service_role` grant on `public.teachers` in `schema.sql`. RLS bypass alone does not replace a table GRANT.

### A deleted teacher's phone number can't be reused ("user already exists")
Should not happen any more — permanent deletion goes through `delete-teacher`, which removes the Auth user (and the `public.teachers` row cascades away with it). Note that a *deactivated* (not yet permanently deleted) teacher still legitimately occupies their phone number, since their Auth account still exists, just banned — that's by design (§4.1), not this bug. If you still see this for a teacher who has actually been permanently deleted, check that `delete-teacher` is actually deployed and that `Teachers.tsx`'s `remove()` is calling it rather than a raw `supabase.from("teachers").delete()`.

### Deactivated teacher can still log in
Check that `deactivate-teacher` is actually deployed and that the ban actually took (`auth.users.banned_until` in the Supabase dashboard). A session issued *before* the ban may remain valid until it naturally expires/refreshes; this is a Supabase Auth behaviour, not an app bug.

### A promoted/graduated learner disappeared from an old exam's marklist or report form
Check that migration v5 has actually been run and that `enrollments` has rows for that learner/year — `fetchHistoricalLearners` (`src/lib/enrollment.ts`) falls back to `learners.class_id` only when there are no matching enrollment rows, which is expected for exams predating the migration but not for anything after it.

### An old report form shows the wrong subject/class/head teacher after a reassignment
Check that migration v7 has actually been run and that `subject_teacher_history`/`class_teacher_history`/`head_teacher_history` have rows for that class/year. This is expected (and not a bug) for any exam whose academic year predates migration v7, since that history was never recorded for those years.

### Deleting a teacher fails with a foreign key violation
This means someone reintroduced `on delete restrict` on one of the three report-roster history tables' `teacher_id` column (§4.2, invariant 18). It must be `on delete set null`.


### Edge Function security issue
Search the whole project for `VITE_SERVICE_ROLE_KEY` or `VITE_SUPABASE_SERVICE_ROLE_KEY`. Neither must exist.

### Teacher can see/write something unexpected
Check RLS policies and helper functions in `schema.sql` before changing React.

### Report has wrong totals or levels
Check `src/lib/marklist.ts`, `exam_subject_config`, raw component marks, and `SUBJECT_GROUPS`. Do not duplicate grading logic in the report exporter.

### Report term dates say Not set
Check Admin → Exams → Term dates for the selected academic year and term.

## 14. Important invariants

Do not casually change:

1. Phone + password authentication architecture.
2. `auth.users.id = teachers.id`.
3. First-admin bootstrap process.
4. Edge Function/service-role separation.
5. RLS policies.
6. English/Composition and Kiswahili/Insha grouping.
7. Configurable exam maximum marks.
8. CBC thresholds.
9. Class-teacher many-to-many model.
10. Report progress fallback text.
11. Report footer wording: **School Motto: Strive for Excellence.**
12. Protected-delete/protected-reset behaviour: **only the bootstrap admin's Delete and Reset password are disabled; later admins are not protected in any way.**
13. Exam auto-assignment on creation (every class is seated automatically; there is no manual per-exam class picker any more).
14. The class-teacher-only visibility boundary for marks/analysis/submissions (§7.5) — both the UI filter and the `marks` RLS policy.
15. Learner/teacher soft-delete lifecycles (§4.1) — never reintroduce a raw `.delete()` for a learner or teacher from the app UI in place of Archive/Deactivate.
16. Bulk class promotion goes through `promote_class()`/`graduate_class()` (§4.1) — never re-add a one-by-one "edit every learner's class_id" flow as the primary promotion path.
17. `enrollments` as the source of truth for historical class membership (§4.1) — historical report/marklist screens must keep resolving rosters through `fetchHistoricalLearners`, not `learners.class_id` directly.
18. `subject_teacher_history` / `class_teacher_history` / `head_teacher_history` as the source of truth for who is named on a report form (§4.2) — `reportRoster.ts` must keep resolving these from history-for-the-exam's-year first, live tables only as a fallback. Never give these tables' `teacher_id` an `on delete restrict` foreign key — it must stay `on delete set null`, or permanently deleting a teacher who ever appeared on a report form will fail.
19. `public.teachers` UPDATE stays admin-only in RLS. Self-service name changes must keep going through `update_own_name()` (§2.3), which is scoped to the caller's own row and the `name` column only — never relax the table's own UPDATE policy to let this work.
20. The Admin/Teacher view picker (§2.2) is a UI-only lens (`effectiveRole` in `App.tsx`) — it must never be used as a substitute for the real `role` check anywhere permissions actually matter. Server-side RLS is the only real boundary; the picker just decides what an admin sees first.
21. My Class status-tab restrictions (§7.6) — Withdrawn/All stay admin-only, and Graduated stays gated on the class name starting with the grade digit ("9…"). If class naming conventions ever change, update `isGrade9` in `Learners.tsx` accordingly rather than leaving it silently wrong.

## 15. Final production checklist

- [ ] `npm run build` passes.
- [ ] Supabase schema applied (including migrations v5, v6, v7, and the `keepalive_ping`/`update_own_name` functions at the bottom of `schema.sql`).
- [ ] Edge Function secret set server-side only.
- [ ] All five Edge Functions deployed (create-teacher, reset-teacher-password, delete-teacher, deactivate-teacher, reactivate-teacher).
- [ ] First Auth user manually created and confirmed.
- [ ] An academic year created and marked current (Academic Years page) before the first promotion is ever run.
- [ ] `seed.sql` linked that Auth UUID to `teachers` with `is_bootstrap_admin=true`.
- [ ] Bootstrap admin can log in.
- [ ] Bootstrap admin Delete button is faded/disabled.
- [ ] A second admin can be created and its Delete button remains active.
- [ ] Normal teacher creation works.
- [ ] Password reset works.
- [ ] Admin login shows the Admin/Teacher page prompt; both choices land somewhere sensible; "Switch view" works.
- [ ] My Profile: name change and password change both work for an admin and a teacher account.
- [ ] Term dates can be set by admin and appear on reports.
- [ ] Grand Total receives CBC level.
- [ ] Report footer says **School Motto: Strive for Excellence.**
- [ ] Login verse reference has no `(NIV)`/version label.
- [ ] No service-role key is exposed to the frontend.
- [ ] Vercel has only public Supabase frontend variables.
- [ ] GitHub Action `keep-alive.yml` runs successfully (Actions tab → run manually via workflow_dispatch) against the deployed `keepalive_ping()` function.
