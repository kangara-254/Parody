// Supabase Edge Function: reactivate-teacher
//
// Reverses deactivate-teacher: unbans the Supabase Auth account and
// sets public.teachers.status back to 'active'. Only meaningful for a
// teacher who was deactivated, not one who was permanently deleted --
// once delete-teacher has actually removed the Auth user, there is
// nothing left to reactivate; re-adding them means create-teacher with
// a fresh account.
//
// Deploy with:
//   supabase functions deploy reactivate-teacher

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

    const { data: targetProfile, error: targetErr } = await adminClient
      .from("teachers")
      .select("status")
      .eq("id", teacher_id)
      .single();

    if (targetErr || !targetProfile) {
      return new Response(JSON.stringify({ error: "Teacher not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (targetProfile.status !== "left") {
      return new Response(JSON.stringify({ error: "This teacher is not deactivated." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: unbanErr } = await adminClient.auth.admin.updateUserById(teacher_id, { ban_duration: "none" });
    if (unbanErr) {
      return new Response(JSON.stringify({ error: unbanErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: updateErr } = await adminClient.from("teachers").update({ status: "active" }).eq("id", teacher_id);
    if (updateErr) {
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
