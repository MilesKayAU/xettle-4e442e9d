import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STEP_TIMEOUT_MS = 90_000; // 90 seconds per step (increased from 45s to match Xero cooldown)

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
      details: { started_at: new Date().toISOString(), pipeline: 'xero_first_v1' },
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
  const xeroUserIds = [...new Set((xeroTokens || []).map(t => t.user_id))];
  const shopifyUserIds = [...new Set((shopifyTokens || []).map(t => t.user_id))];

  // ═══════════════════════════════════════════════════════════════════
  // XERO-FIRST PIPELINE: Discover what exists before fetching marketplace data
  // 4-minute elapsed guard: edge functions have ~5min max, reserve time for final writes
  // ═══════════════════════════════════════════════════════════════════
  const MAX_ELAPSED_MS = 4 * 60 * 1000; // 4 minutes

  // 1. Xero status audit (discover what's already in Xero)
  console.log("[scheduled-sync] Step 1: Xero status audit (discovery)...");
  results.xero_audit = { users: xeroUserIds.length, results: [] };
  for (const uid of xeroUserIds) {
    const auditResult = await callFunction("sync-xero-status", {}, { userId: uid });
    (results.xero_audit.results as any[]).push({ user_id: uid, ...auditResult });
    if (auditResult?.error) stepErrors.push('xero_audit');
  }

  // 2. Fetch Xero bank transactions (with 30-min guard built into the function)
  console.log("[scheduled-sync] Step 2: Bank transaction ingestion...");
  results.bank_txn_fetch = await callFunction("fetch-xero-bank-transactions");
  if (results.bank_txn_fetch?.error) stepErrors.push('bank_txn_fetch');

  // 3. Auto-verify: PAID Xero invoices → bank_verified = true
  //    (This is now handled inside sync-xero-status itself)
  //    Additionally, compute smart sync window per user
  console.log("[scheduled-sync] Step 3: Computing smart sync windows...");
  const userSyncFromMap: Record<string, string> = {};
  const twoMonthsAgo = new Date();
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
  const defaultSyncFrom = twoMonthsAgo.toISOString().split('T')[0];

  for (const uid of allUserIds) {
    try {
      // PRIORITY 1: Use oldest outstanding Xero invoice date (set by sync-xero-status)
      // This ensures Amazon/Shopify sync windows cover all unreconciled Xero invoices
      const { data: xeroOutstandingSetting } = await adminClient
        .from('app_settings')
        .select('value')
        .eq('user_id', uid)
        .eq('key', 'xero_oldest_outstanding_date')
        .maybeSingle();

      let syncFrom = defaultSyncFrom;

      if (xeroOutstandingSetting?.value) {
        const xeroDate = new Date(xeroOutstandingSetting.value + 'T00:00:00Z');
        xeroDate.setUTCDate(xeroDate.getUTCDate() - 7); // 7-day safety buffer for Xero outstanding
        syncFrom = xeroDate.toISOString().split('T')[0];
        console.log(`[scheduled-sync] User ${uid}: sync_from = ${syncFrom} (from Xero outstanding priority)`);
      } else {
        // PRIORITY 2: Fallback to oldest unreconciled settlement
        const { data: oldestGap } = await adminClient
          .from('settlements')
          .select('period_end')
          .eq('user_id', uid)
          .not('status', 'in', '("reconciled_in_xero","bank_verified","push_failed_permanent")')
          .eq('is_pre_boundary', false)
          .is('duplicate_of_settlement_id', null)
          .order('period_end', { ascending: true })
          .limit(1);

        if (oldestGap?.[0]?.period_end) {
          const gapDate = new Date(oldestGap[0].period_end + 'T00:00:00Z');
          gapDate.setUTCDate(gapDate.getUTCDate() - 3);
          syncFrom = gapDate.toISOString().split('T')[0];
          console.log(`[scheduled-sync] User ${uid}: sync_from = ${syncFrom} (from settlement fallback)`);
        } else {
          console.log(`[scheduled-sync] User ${uid}: sync_from = ${syncFrom} (default 2 months)`);
        }
      }

      userSyncFromMap[uid] = syncFrom;
    } catch (err) {
      userSyncFromMap[uid] = defaultSyncFrom;
      console.error(`[scheduled-sync] Sync window calc failed for ${uid}:`, err);
    }
  }
  results.sync_windows = { ...userSyncFromMap };

  // 4. Fetch Amazon settlements (per-user lock/cooldown checks)
  console.log("[scheduled-sync] Step 4: Amazon fetch (per-user locks)...");
  const amazonUserIds = [...new Set((amazonTokens || []).map(t => t.user_id))];

  // Determine eligible Amazon users (no lock, no cooldown)
  const eligibleAmazonUsers: string[] = [];
  for (const uid of amazonUserIds) {
    // Check lock atomically via RPC
    const { data: lockResult } = await adminClient.rpc('acquire_sync_lock', {
      p_user_id: uid,
      p_integration: 'amazon',
      p_lock_key: 'cron_sync',
      p_ttl_seconds: 300, // 5 min for cron
    });

    if (!lockResult?.acquired) {
      console.log(`[scheduled-sync] Amazon skipped for ${uid} — lock held`);
      continue;
    }

    // Check rate limit cooldown
    const { data: cooldownResult } = await adminClient.rpc('check_sync_cooldown', {
      p_user_id: uid,
      p_key: 'amazon_rate_limit_until',
      p_window_seconds: 0,
    });

    if (cooldownResult && !cooldownResult.ok) {
      await adminClient.rpc('release_sync_lock', { p_user_id: uid, p_integration: 'amazon', p_lock_key: 'cron_sync' });
      console.log(`[scheduled-sync] Amazon rate limited for ${uid} — cooldown active`);
      continue;
    }

    eligibleAmazonUsers.push(uid);
  }

  if (eligibleAmazonUsers.length > 0) {
    // Pass the earliest sync_from across eligible Amazon users
    const earliestAmazonSyncFrom = eligibleAmazonUsers.reduce((earliest, uid) => {
      const sf = userSyncFromMap[uid] || defaultSyncFrom;
      return sf < earliest ? sf : earliest;
    }, defaultSyncFrom);

    results.amazon = await callFunction("fetch-amazon-settlements", { "x-action": "sync" }, {
      time: new Date().toISOString(),
      sync_from: earliestAmazonSyncFrom,
    });
    if (results.amazon?.error) stepErrors.push('amazon');

    // Release cron locks for eligible users
    for (const uid of eligibleAmazonUsers) {
      await adminClient.rpc('release_sync_lock', { p_user_id: uid, p_integration: 'amazon', p_lock_key: 'cron_sync' });
    }
  } else {
    results.amazon = { skipped: true, reason: 'all_users_locked_or_rate_limited', users_checked: amazonUserIds.length };
  }

  // 5. Fetch Shopify payouts (with per-user Shopify mutex)
  console.log("[scheduled-sync] Step 5: Shopify payouts fetch (per-user locks)...");
  {
    // Acquire Shopify locks per user
    const eligibleShopifyUsers: string[] = [];
    for (const uid of shopifyUserIds) {
      const { data: lockResult } = await adminClient.rpc('acquire_sync_lock', {
        p_user_id: uid,
        p_integration: 'shopify',
        p_lock_key: 'payout_sync',
        p_ttl_seconds: 300,
      });
      if (lockResult?.acquired) {
        eligibleShopifyUsers.push(uid);
      } else {
        console.log(`[scheduled-sync] Shopify skipped for ${uid} — lock held`);
      }
    }

    if (eligibleShopifyUsers.length > 0) {
      const earliestShopifySyncFrom = eligibleShopifyUsers.reduce((earliest, uid) => {
        const sf = userSyncFromMap[uid] || defaultSyncFrom;
        return sf < earliest ? sf : earliest;
      }, defaultSyncFrom);

      results.shopify = await callFunction("fetch-shopify-payouts", { "x-action": "sync" }, {
        time: new Date().toISOString(),
        sync_from: earliestShopifySyncFrom,
      });
      if (results.shopify?.error) stepErrors.push('shopify');

      // Release Shopify locks
      for (const uid of eligibleShopifyUsers) {
        await adminClient.rpc('release_sync_lock', { p_user_id: uid, p_integration: 'shopify', p_lock_key: 'payout_sync' });
      }
    } else {
      results.shopify = { skipped: true, reason: 'all_users_locked' };
    }
  }

  // 5.5. Scan Shopify channels for sub-channel detection
  console.log("[scheduled-sync] Step 5.5: Shopify channel scan...");
  results.channel_scan = { users: shopifyUserIds.length, results: [] };
  for (const uid of shopifyUserIds) {
    const scanResult = await callFunction("scan-shopify-channels", {}, { userId: uid });
    (results.channel_scan.results as any[]).push({ user_id: uid, ...scanResult });
    if (scanResult?.error) stepErrors.push('channel_scan');
  }

  // 5.6. Auto-generate settlements from Shopify orders
  console.log("[scheduled-sync] Step 5.6: Auto-generate Shopify settlements...");
  results.shopify_settlements = { users: shopifyUserIds.length, results: [] };
  for (const uid of shopifyUserIds) {
    const genResult = await callFunction("auto-generate-shopify-settlements", {}, { userId: uid, days: 60 });
    (results.shopify_settlements.results as any[]).push({ user_id: uid, ...genResult });
    if (genResult?.error) stepErrors.push('shopify_settlements');
  }

  // 6. Shopify orders fetch (always 90-day window for marketplace discovery — unchanged)
  // This is handled by fetch-shopify-orders which already uses its own 90-day window

  // 7. Run validation sweep (skip if elapsed > 4 minutes)
  if (Date.now() - startTime < MAX_ELAPSED_MS) {
    console.log("[scheduled-sync] Step 7: Validation sweep...");
    results.validation = await callFunction("run-validation-sweep");
    if (results.validation?.error) stepErrors.push('validation');
  } else {
    console.log("[scheduled-sync] Step 7: SKIPPED (elapsed > 4 min)");
    results.validation = { skipped: true, reason: 'elapsed_timeout' };
  }

  // 8. Auto-push ready settlements to Xero (skip if elapsed > 4 minutes)
  if (Date.now() - startTime < MAX_ELAPSED_MS) {
    console.log("[scheduled-sync] Step 8: Auto-push to Xero (checking live mode)...");
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
  } else {
    console.log("[scheduled-sync] Step 8: SKIPPED (elapsed > 4 min)");
    results.xero_push = { skipped: true, reason: 'elapsed_timeout' };
  }

  // 9. Match bank deposits against settlements (using local cache)
  console.log("[scheduled-sync] Step 9: Bank deposit matching...");
  results.bank_matching = { users: xeroUserIds.length, results: [] };
  for (const uid of xeroUserIds) {
    const matchResult = await callFunction("match-bank-deposits", {}, { userId: uid });
    (results.bank_matching.results as any[]).push({ user_id: uid, ...matchResult });
    if (matchResult?.error) stepErrors.push('bank_matching');
  }

  const durationMs = Date.now() - startTime;

  // ─── Aggregate totals ──────────────────────────────────────────
  const totalAmazonSynced = results.amazon?.imported || results.amazon?.total_synced || 0;
  const totalShopifySynced = results.shopify?.imported || results.shopify?.total_synced || 0;
  const totalXeroPushed = results.xero_push?.pushed || 0;
  const totalSynced = totalAmazonSynced + totalShopifySynced;

  // ─── Determine overall status ─────────────────────────────────
  const totalSteps = 9;
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
      pipeline: 'xero_first_v1',
      sync_from: userSyncFromMap[userId] || defaultSyncFrom,
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
      pipeline: 'xero_first_v1',
      duration_ms: durationMs,
      amazon_synced: totalAmazonSynced,
      shopify_synced: totalShopifySynced,
      xero_pushed: totalXeroPushed,
      xero_audited_users: xeroUserIds.length,
      users_processed: allUserIds.size,
      sync_windows: userSyncFromMap,
      step_errors: uniqueStepErrors,
      results,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
