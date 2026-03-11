import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STEP_TIMEOUT_MS = 45_000; // 45 seconds per step

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const results: Record<string, any> = {};
  const startTime = Date.now();

  // ─── Collect all user IDs early for interim records ─────────────
  const { data: amazonTokens } = await adminClient.from('amazon_tokens').select('user_id');
  const { data: shopifyTokens } = await adminClient.from('shopify_tokens').select('user_id');
  const { data: xeroTokens } = await adminClient.from('xero_tokens').select('user_id');

  const allUserIds = new Set<string>();
  for (const t of amazonTokens || []) allUserIds.add(t.user_id);
  for (const t of shopifyTokens || []) allUserIds.add(t.user_id);
  for (const t of xeroTokens || []) allUserIds.add(t.user_id);

  // ─── Write interim "running" sync_history per user ─────────────
  const interimIds: Record<string, string> = {};
  for (const userId of allUserIds) {
    const { data } = await adminClient.from("sync_history").insert({
      user_id: userId,
      event_type: "scheduled_sync",
      status: "running",
      settlements_affected: 0,
      details: { started_at: new Date().toISOString() },
    } as any).select('id').single();
    if (data?.id) interimIds[userId] = data.id;
  }

  // Helper to call sibling edge functions with timeout
  async function callFunction(
    name: string,
    extraHeaders: Record<string, string> = {},
    body: any = { time: new Date().toISOString() },
    timeoutMs: number = STEP_TIMEOUT_MS,
  ) {
    const url = `${supabaseUrl}/functions/v1/${name}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const respBody = await res.json().catch(() => ({ status: res.status }));
      if (!res.ok) {
        return { error: respBody?.error || `HTTP ${res.status}`, ...respBody };
      }
      return { status: res.status, ...respBody };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        console.error(`[scheduled-sync] ${name} timed out after ${timeoutMs}ms`);
        return { error: `timed_out after ${timeoutMs}ms`, timed_out: true };
      }
      return { error: String(err) };
    }
  }

  // Track which steps errored
  const stepErrors: string[] = [];

  // 1. Fetch Amazon settlements (check mutex/rate-limit per user first)
  console.log("[scheduled-sync] Step 1: Amazon fetch...");
  
  // Check if any user has an active lock or rate limit
  let amazonSkipped = false;
  for (const uid of [...new Set((amazonTokens || []).map(t => t.user_id))]) {
    const { data: lockData } = await adminClient
      .from('app_settings')
      .select('value')
      .eq('key', 'amazon_sync_lock_expiry')
      .eq('user_id', uid)
      .maybeSingle();
    
    if (lockData?.value && new Date(lockData.value) > new Date()) {
      console.log(`[scheduled-sync] Amazon sync skipped for ${uid} — manual sync in progress`);
      amazonSkipped = true;
    }

    const { data: rlData } = await adminClient
      .from('app_settings')
      .select('value')
      .eq('key', 'amazon_rate_limit_until')
      .eq('user_id', uid)
      .maybeSingle();

    if (rlData?.value && new Date(rlData.value) > new Date()) {
      console.log(`[scheduled-sync] Amazon rate limited for ${uid} — cooldown active`);
      amazonSkipped = true;
    }
  }

  if (!amazonSkipped) {
    results.amazon = await callFunction("fetch-amazon-settlements", { "x-action": "sync" });
    if (results.amazon?.error) stepErrors.push('amazon');
  } else {
    results.amazon = { skipped: true, reason: 'mutex_or_rate_limit' };
  }

  // 2. Fetch Shopify payouts
  console.log("[scheduled-sync] Step 2: Shopify fetch...");
  results.shopify = await callFunction("fetch-shopify-payouts", { "x-action": "sync" });
  if (results.shopify?.error) stepErrors.push('shopify');

  // 2.5. Scan Shopify channels for sub-channel detection
  console.log("[scheduled-sync] Step 2.5: Shopify channel scan...");
  const shopifyUserIds = [...new Set((shopifyTokens || []).map(t => t.user_id))];
  results.channel_scan = { users: shopifyUserIds.length, results: [] };
  for (const uid of shopifyUserIds) {
    const scanResult = await callFunction("scan-shopify-channels", {}, { userId: uid });
    (results.channel_scan.results as any[]).push({ user_id: uid, ...scanResult });
    if (scanResult?.error) stepErrors.push('channel_scan');
  }

  // 3. Run validation sweep
  console.log("[scheduled-sync] Step 3: Validation sweep...");
  results.validation = await callFunction("run-validation-sweep");
  if (results.validation?.error) stepErrors.push('validation');

  // 4. Auto-push ready settlements to Xero
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
  if (results.xero_push?.error || (results.xero_push?.errors && results.xero_push.errors > 0)) stepErrors.push('xero_push');

  // 5. Sync Xero status back
  console.log("[scheduled-sync] Step 5: Xero status audit...");
  const xeroUserIds = [...new Set((xeroTokens || []).map(t => t.user_id))];
  results.xero_audit = { users: xeroUserIds.length, results: [] };
  for (const uid of xeroUserIds) {
    const auditResult = await callFunction("sync-xero-status", {}, { userId: uid });
    (results.xero_audit.results as any[]).push({ user_id: uid, ...auditResult });
    if (auditResult?.error) stepErrors.push('xero_audit');
  }

  const durationMs = Date.now() - startTime;

  // ─── Aggregate totals ──────────────────────────────────────────
  const totalAmazonSynced = results.amazon?.imported || results.amazon?.total_synced || 0;
  const totalShopifySynced = results.shopify?.imported || results.shopify?.total_synced || 0;
  const totalXeroPushed = results.xero_push?.pushed || 0;
  const totalSynced = totalAmazonSynced + totalShopifySynced;

  // ─── Determine overall status ─────────────────────────────────
  const totalSteps = 5;
  const uniqueStepErrors = [...new Set(stepErrors)];
  let overallStatus: string;
  if (uniqueStepErrors.length === 0) {
    overallStatus = 'success';
  } else if (uniqueStepErrors.length >= totalSteps) {
    overallStatus = 'error';
  } else {
    overallStatus = 'partial';
  }

  // ─── Update interim sync_history records with final status ─────
  for (const userId of allUserIds) {
    const interimId = interimIds[userId];
    const details = {
      amazon: results.amazon?.results?.find((r: any) => r.user_id === userId) || (results.amazon?.error ? { error: results.amazon.error, timed_out: results.amazon.timed_out || false } : null),
      shopify: results.shopify?.results?.find((r: any) => r.user_id === userId) || (results.shopify?.error ? { error: results.shopify.error, timed_out: results.shopify.timed_out || false } : null),
      xero_push: results.xero_push?.results?.find((r: any) => r.userId === userId) || null,
      xero_audit: results.xero_audit?.results?.find((r: any) => r.user_id === userId) || null,
      duration_ms: durationMs,
      step_errors: uniqueStepErrors.length > 0 ? uniqueStepErrors : undefined,
    };

    if (interimId) {
      await adminClient.from("sync_history")
        .update({
          status: overallStatus,
          settlements_affected: totalSynced + totalXeroPushed,
          error_message: uniqueStepErrors.length > 0 ? `Steps failed: ${uniqueStepErrors.join(', ')}` : null,
          details,
        } as any)
        .eq('id', interimId);
    } else {
      await adminClient.from("sync_history").insert({
        user_id: userId,
        event_type: "scheduled_sync",
        status: overallStatus,
        settlements_affected: totalSynced + totalXeroPushed,
        error_message: uniqueStepErrors.length > 0 ? `Steps failed: ${uniqueStepErrors.join(', ')}` : null,
        details,
      } as any);
    }
  }

  if (allUserIds.size === 0) {
    console.log("[scheduled-sync] No users with API tokens found. Nothing to sync.");
  }

  console.log(`[scheduled-sync] Complete (${overallStatus}) in ${durationMs}ms. Amazon: ${totalAmazonSynced}, Shopify: ${totalShopifySynced}, Xero pushed: ${totalXeroPushed}, Xero audited: ${xeroUserIds.length} users. Errors: ${uniqueStepErrors.length > 0 ? uniqueStepErrors.join(', ') : 'none'}`);

  return new Response(
    JSON.stringify({
      success: overallStatus !== 'error',
      status: overallStatus,
      duration_ms: durationMs,
      amazon_synced: totalAmazonSynced,
      shopify_synced: totalShopifySynced,
      xero_pushed: totalXeroPushed,
      xero_audited_users: xeroUserIds.length,
      users_processed: allUserIds.size,
      step_errors: uniqueStepErrors,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
