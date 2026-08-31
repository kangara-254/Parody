// Supabase Edge Function: reset-teacher-password
//
// Teachers can't change their own password (see README -- deliberate,
// to keep the number of moving parts small). That means admin MUST have
// a way to set a new one when a teacher forgets theirs, or "no
// self-service" becomes "no service at all" the first time that
// happens. This is that escape hatch, gated the same way create-teacher
// is: caller's own token verifies they're admin, service role key never
// leaves the server.
//
// Deploy with:
//   supabase functions deploy reset-teacher-password

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
    const password = String(body.password ?? "");

    if (!teacher_id || password.length < 6) {
      return new Response(JSON.stringify({ error: "A teacher and a password of at least 6 characters are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { error: updateErr } = await adminClient.auth.admin.updateUserById(teacher_id, { password });
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
