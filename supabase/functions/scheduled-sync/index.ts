import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const results: Record<string, any> = {};
  const startTime = Date.now();

  // Helper to call sibling edge functions
  async function callFunction(name: string, extraHeaders: Record<string, string> = {}) {
    const url = `${supabaseUrl}/functions/v1/${name}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify({ time: new Date().toISOString() }),
      });
      const body = await res.json().catch(() => ({ status: res.status }));
      return { status: res.status, ...body };
    } catch (err) {
      return { error: String(err) };
    }
  }

  // 1. Fetch Amazon settlements (multi-user sync)
  console.log("[scheduled-sync] Starting Amazon fetch...");
  results.amazon = await callFunction("fetch-amazon-settlements", { "x-action": "sync" });

  // 2. Fetch Shopify payouts (multi-user sync)
  console.log("[scheduled-sync] Starting Shopify fetch...");
  results.shopify = await callFunction("fetch-shopify-payouts", { "x-action": "sync" });

  // 3. Run validation sweep
  console.log("[scheduled-sync] Starting validation sweep...");
  results.validation = await callFunction("run-validation-sweep");

  const durationMs = Date.now() - startTime;

  // 4. Log to sync_history using a service-role client
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Find all users who had settlements synced to log per-user
  const totalAmazonSynced = results.amazon?.total_synced || 0;
  const totalShopifySynced = results.shopify?.total_synced || 0;
  const totalSynced = totalAmazonSynced + totalShopifySynced;

  // Get all unique user IDs from the sync results
  const userIds = new Set<string>();
  for (const r of results.amazon?.results || []) userIds.add(r.user_id);
  for (const r of results.shopify?.results || []) userIds.add(r.user_id);

  // Log a sync_history entry per user (so RLS-filtered queries work)
  for (const userId of userIds) {
    await adminClient.from("sync_history").insert({
      user_id: userId,
      event_type: "scheduled_sync",
      status: "success",
      settlements_affected: totalSynced,
      details: {
        amazon: results.amazon?.results?.find((r: any) => r.user_id === userId) || null,
        shopify: results.shopify?.results?.find((r: any) => r.user_id === userId) || null,
        duration_ms: durationMs,
      },
    } as any);
  }

  // If no users were processed, log a system-level entry with a placeholder
  if (userIds.size === 0) {
    // No users to sync — skip logging since sync_history requires a real user_id
    console.log("[scheduled-sync] No users with API tokens found. Nothing to sync.");
  }

  console.log(`[scheduled-sync] Complete in ${durationMs}ms. Amazon: ${totalAmazonSynced}, Shopify: ${totalShopifySynced}`);

  return new Response(
    JSON.stringify({
      success: true,
      duration_ms: durationMs,
      amazon_synced: totalAmazonSynced,
      shopify_synced: totalShopifySynced,
      users_processed: userIds.size,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
