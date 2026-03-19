/**
 * rls-audit — Returns RLS policy inventory for all public tables.
 * Admin-only. Uses service role to query pg_policies.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const headers = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is authenticated admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const isAdmin = (roles || []).some((r: any) => r.role === "admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Query RLS policies via pg_policies view
    const { data: policies, error: pErr } = await admin.rpc("get_rls_inventory");

    if (pErr) {
      // Fallback: try a direct query on information_schema for table list
      // and pg_policies for policies
      const { data: tables } = await admin
        .from("information_schema.tables" as any)
        .select("table_name")
        .eq("table_schema", "public")
        .eq("table_type", "BASE TABLE");

      return new Response(
        JSON.stringify({
          success: true,
          method: "fallback",
          tables: (tables || []).map((t: any) => ({
            table_name: t.table_name,
            policy_count: null,
            policies: [],
            rls_enabled: null,
          })),
          note: "RPC not available; showing table list only. Create get_rls_inventory() function for full audit.",
        }),
        { headers: { ...headers, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, inventory: policies }),
      { headers: { ...headers, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("rls-audit error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } },
    );
  }
});
