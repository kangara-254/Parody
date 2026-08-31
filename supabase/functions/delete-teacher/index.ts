// Supabase Edge Function: delete-teacher
//
// WHY THIS FUNCTION EXISTS (read before changing):
// public.teachers.id references auth.users(id) ON DELETE CASCADE (see
// schema.sql). That means the *correct* way to delete a teacher is to
// delete their Supabase Auth user -- the matching public.teachers row
// disappears automatically via the cascade.
//
// Previously the frontend called `supabase.from("teachers").delete()`
// directly, which only ever removed the public.teachers row. The Auth
// user (and therefore the login, and the {phone}@jssportal.internal
// email it occupies) was never removed. That's why a deleted teacher's
// phone number could never be reused: Supabase Auth still had a live
// user sitting on that derived email, so create-teacher's
// auth.admin.createUser() call correctly rejected it as a duplicate.
//
// MIGRATION v6 UPDATE: this is now a two-step workflow. A teacher must
// already be deactivated (status = 'left', via deactivate-teacher)
// before they can be permanently deleted here -- see the guard below.
// Deactivation is the everyday "this teacher has left" action and
// keeps their class_teachers/teacher_assignments/marks.entered_by
// history intact; THIS function is only for genuine cleanup (e.g. a
// mistaken duplicate entry, or freeing up their phone number for
// reuse) and really does erase that history via cascade, same as
// before. The UI (Teachers.tsx) only offers this button once a teacher
// is already deactivated, and this check makes that a real server-side
// rule, not just a UI nicety.
//
// This function is gated exactly like reset-teacher-password and
// create-teacher: the caller's own session proves they're an admin,
// then (and only then) the service-role key is used server-side to
// delete the Auth user. The service-role key never reaches the browser.
//
// Deploy with:
//   supabase functions deploy delete-teacher

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: callerUser },
      error: callerErr,
    } = await callerClient.auth.getUser();

    if (callerErr || !callerUser) {
      return new Response(JSON.stringify({ error: "Not authenticated." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile, error: profileErr } = await callerClient
      .from("teachers")
      .select("role")
      .eq("id", callerUser.id)
      .single();

    if (profileErr || callerProfile?.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin access required." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const teacher_id = String(body.teacher_id ?? "");
    if (!teacher_id) {
      return new Response(JSON.stringify({ error: "A teacher is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Server-side re-check that this isn't the protected bootstrap
    // admin -- the React "disabled" button is a UI nicety, not a
    // security boundary. This is the real one.
    const { data: targetProfile, error: targetErr } = await adminClient
      .from("teachers")
      .select("is_bootstrap_admin, status")
      .eq("id", teacher_id)
      .single();

    if (targetErr || !targetProfile) {
      return new Response(JSON.stringify({ error: "Teacher not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (targetProfile.is_bootstrap_admin) {
      return new Response(JSON.stringify({ error: "The original bootstrap administrator can't be deleted." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (targetProfile.status !== "left") {
      return new Response(
        JSON.stringify({ error: "Deactivate this teacher first, then delete them permanently from there." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deleting the Auth user cascades to public.teachers (see schema.sql:
    // teachers.id references auth.users(id) on delete cascade), which
    // also cleans up class_teachers, teacher_assignments (both
    // on delete cascade) and nulls out marks.entered_by (on delete set
    // null). There is deliberately no separate `.from("teachers").delete()`
    // call here -- that would just be doing the cascade's job by hand,
    // and doing it BEFORE deleting the Auth user would defeat the
    // purpose: the phone number would still be stuck on a live Auth
    // account.
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(teacher_id);
    if (deleteErr) {
      return new Response(JSON.stringify({ error: deleteErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
