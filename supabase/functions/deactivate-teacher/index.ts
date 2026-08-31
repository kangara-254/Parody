// Supabase Edge Function: deactivate-teacher
//
// WHY THIS FUNCTION EXISTS (read before changing):
// This is the "a teacher has left" action, and it is DELIBERATELY not
// the same thing as delete-teacher. Deleting the Auth user cascades
// away class_teachers and teacher_assignments (on delete cascade) and
// nulls out marks.entered_by (on delete set null) -- see schema.sql.
// That's fine for genuine cleanup of a mistaken entry, but wrong for a
// teacher who has simply left the school: it erases their name from
// every past report form and mark-entry record they're attached to.
//
// Deactivating instead:
//   1. Bans their Supabase Auth account so they genuinely cannot log
//      in anymore (this is real access revocation, not a cosmetic
//      flag -- see the updateUserById call below).
//   2. Sets public.teachers.status = 'left'.
//   3. Touches NOTHING else. class_teachers, teacher_assignments, and
//      every mark they ever entered keep pointing at their real row,
//      so historical reports and audit trails stay accurate.
//
// Their phone number stays reserved while deactivated (their Auth user
// still exists, just banned) -- if the school needs that exact number
// free for a new teacher, use delete-teacher afterwards (only allowed
// once a teacher is already deactivated -- see that function).
//
// Deploy with:
//   supabase functions deploy deactivate-teacher

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Effectively permanent (~100 years) -- there is no dedicated "forever"
// value in the Admin API, only a duration string. reactivate-teacher
// undoes this with ban_duration: "none" rather than waiting it out.
const PERMANENT_BAN_DURATION = "876000h";

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
      return new Response(JSON.stringify({ error: "The original bootstrap administrator can't be deactivated." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (targetProfile.status === "left") {
      return new Response(JSON.stringify({ error: "This teacher is already deactivated." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: banErr } = await adminClient.auth.admin.updateUserById(teacher_id, {
      ban_duration: PERMANENT_BAN_DURATION,
    });
    if (banErr) {
      return new Response(JSON.stringify({ error: banErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await adminClient.from("teachers").update({ status: "left" }).eq("id", teacher_id);
    if (updateErr) {
      // Roll the ban back so we don't end up with a banned account that
      // the app still thinks is active.
      await adminClient.auth.admin.updateUserById(teacher_id, { ban_duration: "none" });
      return new Response(JSON.stringify({ error: updateErr.message }), {
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
