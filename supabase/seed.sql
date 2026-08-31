-- ============================================================
-- KARIOBANGI SOUTH PRIMARY AND JUNIOR SCHOOL -- EXAM PORTAL
-- SEED DATA -- run this after schema.sql to create the bootstrap admin.
--
-- Every OTHER teacher/admin account is created through the app itself
-- (Teachers page -> "Add teacher"), which goes through the
-- create-teacher Edge Function -- but that function requires the
-- caller to ALREADY be an admin, so the very first admin account has
-- to be created manually, once, here. See README.md section 2 for the
-- full step-by-step.
-- ============================================================

-- STEP 1 -- create the auth user by hand, in the Supabase Dashboard:
--   Authentication -> Users -> Add user
--     Email:    <phone-number>@jssportal.internal
--               (e.g. phone 0712345678 -> 0712345678@jssportal.internal
--               -- this MUST exactly match what phoneToEmail() in
--               src/lib/credentials.ts would produce for the real
--               phone number you're going to log in with)
--     Password: pick a real password -- this is what you'll actually
--               type into the login screen, there is no formula
--     Auto Confirm User: ON (so no confirmation email is required)
-- Then copy the UUID Supabase shows for the new user and paste it below
-- in place of the placeholder UUID.

-- STEP 2 -- link that auth user to a teachers row with role='admin':
insert into public.teachers (id, name, tsc_number, phone_number, role, is_bootstrap_admin)
values (
  '00000000-0000-0000-0000-000000000001',  -- REPLACE with the real auth user UUID from Step 1
  'System Admin',
  null,           -- TSC number is optional and not used for login
  '0712345678',   -- REPLACE with the same phone number used in Step 1
  'admin',
  true
)
on conflict (id) do update set
  name = excluded.name,
  tsc_number = excluded.tsc_number,
  phone_number = excluded.phone_number,
  role = excluded.role,
  is_bootstrap_admin = true;

-- Once this admin can log in (phone + the password you set in Step 1),
-- every other account -- more admins included -- should be created
-- from the Teachers page in the app, not by repeating this file.
