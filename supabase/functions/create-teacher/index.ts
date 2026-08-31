// Supabase Edge Function: create-teacher
//
// Holds the service role key server-side only. The frontend calls this
// over HTTPS with the caller's own session token; this function
// re-checks (server-side, can't be spoofed) that the caller is actually
// an admin before doing anything.
//
// Login identity is now just PHONE NUMBER + a real password that admin
// sets here directly (no more deriving the password from the phone
// number -- see credentials.ts for why). TSC number is optional,
// record-keeping only, and is never used for login.
//
// Deploy with:
//   supabase functions deploy create-teacher
//
// Required secrets (NOT prefixed with VITE_, so they never reach the
// browser bundle):
//   supabase secrets set SERVICE_ROLE_KEY=your-service-role-key
// (SUPABASE_URL and SUPABASE_ANON_KEY are already injected automatically
// by the Supabase runtime for every Edge Function.)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function phoneToEmail(phoneNumber: string): string {
  return `${phoneNumber.trim().replace(/\s+/g, "")}@jssportal.internal`;
}

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
    const name = String(body.name ?? "").trim();
    const phone_number = String(body.phone_number ?? "").trim();
    const password = String(body.password ?? "");
    const tsc_number = body.tsc_number ? String(body.tsc_number).trim() : null;
    const role = body.role === "admin" ? "admin" : "teacher";

    if (!name || !phone_number) {
      return new Response(JSON.stringify({ error: "Name and phone number are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (password.length < 6) {
      return new Response(JSON.stringify({ error: "Password must be at least 6 characters." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authErr } = await adminClient.auth.admin.createUser({
      email: phoneToEmail(phone_number),
      password,
      email_confirm: true,
      user_metadata: { name, phone_number },
    });

    if (authErr || !authData.user) {
      return new Response(
        JSON.stringify({ error: authErr?.message || "Could not create a login for this teacher." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: insertErr } = await adminClient.from("teachers").insert({
      id: authData.user.id,
      name,
      tsc_number,
      phone_number,
      role,
      is_bootstrap_admin: false,
    });

    if (insertErr) {
      await adminClient.auth.admin.deleteUser(authData.user.id);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ id: authData.user.id }), {
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
