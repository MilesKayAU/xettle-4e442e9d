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

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const results: Record<string, any> = {};
  const startTime = Date.now();

  // Helper to call sibling edge functions
  async function callFunction(name: string, extraHeaders: Record<string, string> = {}, body: any = { time: new Date().toISOString() }) {
    const url = `${supabaseUrl}/functions/v1/${name}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
      });
      const respBody = await res.json().catch(() => ({ status: res.status }));
      return { status: res.status, ...respBody };
    } catch (err) {
      return { error: String(err) };
    }
  }

  // 1. Fetch Amazon settlements (multi-user sync)
  console.log("[scheduled-sync] Step 1: Amazon fetch...");
  results.amazon = await callFunction("fetch-amazon-settlements", { "x-action": "sync" });

  // 2. Fetch Shopify payouts (multi-user sync)
  console.log("[scheduled-sync] Step 2: Shopify fetch...");
  results.shopify = await callFunction("fetch-shopify-payouts", { "x-action": "sync" });

  // 3. Run validation sweep
  console.log("[scheduled-sync] Step 3: Validation sweep...");
  results.validation = await callFunction("run-validation-sweep");

  // 4. Auto-push ready settlements to Xero
  //    Defaults to dry_run unless admin has set auto_push_live_mode=true in app_settings
  console.log("[scheduled-sync] Step 4: Auto-push to Xero (checking live mode)...");
  let autoPushLive = false;
  const { data: liveModeSettings } = await adminClient
    .from('app_settings')
    .select('value')
    .eq('key', 'auto_push_live_mode')
    .eq('value', 'true');
  if (liveModeSettings && liveModeSettings.length > 0) {
    autoPushLive = true;
  }
  console.log(`[scheduled-sync] Auto-push mode: ${autoPushLive ? 'LIVE' : 'DRY RUN'}`);
  results.xero_push = await callFunction("auto-push-xero", {}, { dry_run: !autoPushLive });

  // 5. Sync Xero status back (audit matched invoices)
  console.log("[scheduled-sync] Step 5: Xero status audit...");
  // Run for each user who has xero tokens
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: xeroUsers } = await adminClient
    .from('xero_tokens')
    .select('user_id');
  const xeroUserIds = [...new Set((xeroUsers || []).map(t => t.user_id))];
  results.xero_audit = { users: xeroUserIds.length, results: [] };
  for (const uid of xeroUserIds) {
    const auditResult = await callFunction("sync-xero-status", {}, { userId: uid });
    (results.xero_audit.results as any[]).push({ user_id: uid, ...auditResult });
  }

  const durationMs = Date.now() - startTime;

  // ─── Aggregate totals ──────────────────────────────────────────
  const totalAmazonSynced = results.amazon?.imported || results.amazon?.total_synced || 0;
  const totalShopifySynced = results.shopify?.imported || results.shopify?.total_synced || 0;
  const totalXeroPushed = results.xero_push?.pushed || 0;
  const totalSynced = totalAmazonSynced + totalShopifySynced;

  // Get all unique user IDs from all sync results
  const userIds = new Set<string>();
  for (const r of results.amazon?.results || []) userIds.add(r.user_id);
  for (const r of results.shopify?.results || []) userIds.add(r.user_id);
  for (const r of results.xero_push?.results || []) if (r.userId) userIds.add(r.userId);
  for (const uid of xeroUserIds) userIds.add(uid);

  // Log a sync_history entry per user (so RLS-filtered queries work)
  for (const userId of userIds) {
    await adminClient.from("sync_history").insert({
      user_id: userId,
      event_type: "scheduled_sync",
      status: "success",
      settlements_affected: totalSynced + totalXeroPushed,
      details: {
        amazon: results.amazon?.results?.find((r: any) => r.user_id === userId) || null,
        shopify: results.shopify?.results?.find((r: any) => r.user_id === userId) || null,
        xero_push: results.xero_push?.results?.find((r: any) => r.userId === userId) || null,
        xero_audit: results.xero_audit?.results?.find((r: any) => r.user_id === userId) || null,
        duration_ms: durationMs,
      },
    } as any);
  }

  if (userIds.size === 0) {
    console.log("[scheduled-sync] No users with API tokens found. Nothing to sync.");
  }

  console.log(`[scheduled-sync] Complete in ${durationMs}ms. Amazon: ${totalAmazonSynced}, Shopify: ${totalShopifySynced}, Xero pushed: ${totalXeroPushed}, Xero audited: ${xeroUserIds.length} users`);

  return new Response(
    JSON.stringify({
      success: true,
      duration_ms: durationMs,
      amazon_synced: totalAmazonSynced,
      shopify_synced: totalShopifySynced,
      xero_pushed: totalXeroPushed,
      xero_audited_users: xeroUserIds.length,
      users_processed: userIds.size,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});