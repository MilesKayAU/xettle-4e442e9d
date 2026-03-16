/**
 * auto-post-settlement — Async worker that auto-posts ready settlements to Xero.
 *
 * Triggered:
 *   1. Per-settlement (single mode) from UI retry
 *   2. Batch mode from scheduled-sync (scans all users with auto-post rails)
 *
 * Idempotent: checks posting_state + xero_invoice_id before acting.
 * Uses atomic compare-and-set to prevent duplicate posting.
 *
 * Safety checklist (all must pass before posting):
 *   ✅ status = ready_to_push
 *   ✅ not hidden
 *   ✅ not duplicate
 *   ✅ not pre-boundary
 *   ✅ no existing xero_invoice_id
 *   ✅ posting_state not already posting/posted
 *   ✅ rail configured for auto-post
 *   ✅ reconciliation_status = 'matched' (BLOCKER #1: explicit validated predicate)
 *   ✅ account mapping exists for ALL required categories (BLOCKER #2: hard-fail, no fallback)
 *   ✅ Xero token exists for the user
 *   ✅ bank match exists if require_bank_match = true
 *   ✅ push_retry_count < 3 (prevents infinite retry loops)
 *   ✅ CAS lock includes all eligibility predicates (BLOCKER #3)
 *   ✅ Stale lock recovery via posting_claimed_at (BLOCKER #4)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MAX_RETRY_COUNT = 3;
const STALE_LOCK_MINUTES = 15;

// ══════════════════════════════════════════════════════════════
// CANONICAL VERSION — must match src/utils/xero-posting-line-items.ts
// If you change the category list below, bump this version.
// ══════════════════════════════════════════════════════════════
const CANONICAL_VERSION = 'v2-10cat';

// ⚠️ STALE: This contact map may drift from the canonical source in sync-settlement-to-xero/index.ts.
// If this function is ever re-enabled, sync this map with the canonical version first.
const MARKETPLACE_CONTACTS: Record<string, string> = {
  amazon_au: 'Amazon.com.au',
  amazon_us: 'Amazon.com',
  amazon_uk: 'Amazon.co.uk',
  amazon_ca: 'Amazon.ca',
  shopify_payments: 'Shopify',
  kogan: 'Kogan.com',
  bigw: 'Big W Marketplace',
  bunnings: 'Bunnings Marketplace',
  mydeal: 'MyDeal',
  catch: 'Catch.com.au',
  ebay_au: 'eBay Australia',
  ebay: 'eBay Australia',
  woolworths: 'Woolworths Everyday Market',
  woolworths_marketplus: 'Woolworths MarketPlus',
  everyday_market: 'Everyday Market',
  theiconic: 'THE ICONIC',
  etsy: 'Etsy',
  temu: 'Temu',
};

/** Categories that MUST have explicit user mappings for auto-post */
const REQUIRED_MAPPING_CATEGORIES = [
  'Sales (Principal)', 'Refunds', 'Seller Fees', 'FBA Fees', 'Other Fees',
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ─── Auth: verify caller is authenticated or service-role ─────
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    let callerUserId: string | null = null;
    let isServiceRole = token === serviceRoleKey;

    if (!isServiceRole && token) {
      const { data: userData, error: authErr } = await supabase.auth.getUser(token);
      if (!authErr && userData?.user) {
        callerUserId = userData.user.id;
      }
    }

    // Accept: { settlement_id: string (DB id), user_id: string }
    // OR: no body = scan all users for auto-postable settlements
    let targetSettlementId: string | null = null;
    let targetUserId: string | null = null;

    try {
      const body = await req.json();
      targetSettlementId = body?.settlement_id || null;
      targetUserId = body?.user_id || null;
    } catch {
      // No body — batch mode
    }

    // In single-settlement mode, enforce user_id matches caller (unless service role)
    if (targetSettlementId && targetUserId && !isServiceRole) {
      if (!callerUserId || callerUserId !== targetUserId) {
        return new Response(JSON.stringify({ success: false, error: 'Unauthorized: user_id mismatch' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const results: Array<{ settlement_id: string; result: string; error?: string }> = [];

    // ─── Stale lock recovery (BLOCKER #4) ────────────────────────
    // Reclaim settlements stuck in 'posting' for > STALE_LOCK_MINUTES.
    // SCOPING:
    //   - Single mode (UI retry): scoped to targetUserId only
    //   - Batch mode (scheduled-sync via service-role): global scan across all users
    const staleCutoff = new Date(Date.now() - STALE_LOCK_MINUTES * 60 * 1000).toISOString();
    let staleQuery = supabase
      .from('settlements')
      .select('id, settlement_id, user_id, push_retry_count, marketplace')
      .eq('posting_state', 'posting')
      .lt('posting_claimed_at', staleCutoff);

    // In single mode, scope recovery to the calling user only
    if (targetSettlementId && targetUserId) {
      staleQuery = staleQuery.eq('user_id', targetUserId);
    }

    const { data: staleRows } = await staleQuery;

    if (staleRows && staleRows.length > 0) {
      for (const stale of staleRows) {
        const newRetry = (stale.push_retry_count || 0) + 1;
        const failState = newRetry >= MAX_RETRY_COUNT ? 'push_failed_permanent' : 'failed';
        await supabase.from('settlements').update({
          posting_state: failState,
          posting_error: 'Stale lock recovered — worker crashed or timed out',
          push_retry_count: newRetry,
          posting_claimed_at: null,
        }).eq('id', stale.id).eq('posting_state', 'posting');

        await supabase.from('system_events').insert({
          user_id: stale.user_id,
          event_type: 'auto_post_stale_lock_recovered',
          severity: 'warning',
          marketplace_code: stale.marketplace,
          settlement_id: stale.settlement_id,
          details: { recovered_at: new Date().toISOString(), new_retry_count: newRetry, result_state: failState },
        });
        console.warn(`[auto-post-settlement] Recovered stale lock for ${stale.settlement_id}, retry ${newRetry}`);
      }
    }

    // ─── Single settlement mode ──────────────────────────────────
    if (targetSettlementId && targetUserId) {
      // Load rail setting for invoice_status in single mode
      const result = await processSettlement(supabase, targetSettlementId, targetUserId, 'DRAFT');
      results.push(result);
    } else {
      // ─── Batch mode: scan all users with auto-post rails ───────
      const { data: autoRails } = await supabase
        .from('rail_posting_settings')
        .select('user_id, rail, require_bank_match, auto_post_enabled_at, invoice_status')
        .eq('posting_mode', 'auto');

      if (!autoRails || autoRails.length === 0) {
        return new Response(JSON.stringify({ success: true, processed: 0, message: 'No auto-post rails configured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Group by user
      const userRails = new Map<string, Array<{ rail: string; require_bank_match: boolean; auto_post_enabled_at: string | null; invoice_status: string }>>();
      for (const r of autoRails) {
        const existing = userRails.get(r.user_id) || [];
        existing.push({ rail: r.rail, require_bank_match: r.require_bank_match, auto_post_enabled_at: r.auto_post_enabled_at, invoice_status: r.invoice_status || 'DRAFT' });
        userRails.set(r.user_id, existing);
      }

      for (const [userId, rails] of userRails) {
        const railCodes = rails.map(r => r.rail);

        // BLOCKER #1: require reconciliation_status = 'matched'
        const { data: settlements } = await supabase
          .from('settlements')
          .select('id, settlement_id, marketplace, status, posting_state, posting_claimed_at, xero_invoice_id, is_hidden, is_pre_boundary, duplicate_of_settlement_id, push_retry_count, reconciliation_status, bank_verified, created_at')
          .eq('user_id', userId)
          .eq('status', 'ready_to_push')
          .eq('is_hidden', false)
          .eq('is_pre_boundary', false)
          .is('duplicate_of_settlement_id', null)
          .is('xero_invoice_id', null)
          .eq('reconciliation_status', 'matched')
          .in('marketplace', railCodes);

        if (!settlements || settlements.length === 0) continue;

        // Filter to only postable settlements
        const postable = settlements.filter(s => {
          // Skip already posted
          if (s.posting_state === 'posted') return false;
          // Skip actively posting (unless stale — already recovered above)
          if (s.posting_state === 'posting') return false;
          // Skip manual_hold (repost waiting for manual push)
          if (s.posting_state === 'manual_hold') return false;
          // Skip if over retry limit
          if (s.posting_state === 'failed' && (s.push_retry_count || 0) >= MAX_RETRY_COUNT) return false;
          // Only allow null or failed posting_state
          if (s.posting_state !== null && s.posting_state !== 'failed') return false;
          // Check bank match requirement
          const railConfig = rails.find(r => r.rail === s.marketplace);
          if (railConfig?.require_bank_match && !s.bank_verified) return false;
          // ── DATE GATE (Option A): only auto-post settlements created AFTER auto_post_enabled_at ──
          if (railConfig?.auto_post_enabled_at) {
            const enabledAt = new Date(railConfig.auto_post_enabled_at).getTime();
            const createdAt = new Date(s.created_at).getTime();
            if (createdAt < enabledAt) return false;
          }
          return true;
        });

        // ── Batch throttling: sleep between pushes to avoid Xero rate limits ──
        const BATCH_SLEEP_MS = 2000;
        for (let i = 0; i < postable.length; i++) {
          const s = postable[i];
          const railConfig = rails.find(r => r.rail === s.marketplace);
          const invoiceStatus = railConfig?.invoice_status || 'DRAFT';
          const result = await processSettlement(supabase, s.id, userId, invoiceStatus);
          results.push(result);
          // Throttle: sleep between pushes (not after last one)
          if (i < postable.length - 1) {
            await new Promise(resolve => setTimeout(resolve, BATCH_SLEEP_MS));
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[auto-post-settlement] Error:', err);
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processSettlement(
  supabase: any,
  settlementDbId: string,
  userId: string,
  invoiceStatus: string = 'DRAFT'
): Promise<{ settlement_id: string; result: string; error?: string }> {
  // Load settlement
  const { data: settlement, error: loadErr } = await supabase
    .from('settlements')
    .select('*')
    .eq('id', settlementDbId)
    .eq('user_id', userId)
    .single();

  if (loadErr || !settlement) {
    return { settlement_id: settlementDbId, result: 'error', error: 'Settlement not found' };
  }

  const sid = settlement.settlement_id;

  // ─── Safety check 1: Idempotency ──────────────────────────────
  if (settlement.posting_state === 'posted' || settlement.posting_state === 'posting') {
    return { settlement_id: sid, result: 'skipped', error: `Already ${settlement.posting_state}` };
  }
  // ─── Safety check 2: No existing Xero invoice ─────────────────
  if (settlement.xero_invoice_id) {
    return { settlement_id: sid, result: 'skipped', error: 'Already has xero_invoice_id' };
  }
  // ─── Safety check 3: Status must be ready_to_push ─────────────
  if (settlement.status !== 'ready_to_push') {
    return { settlement_id: sid, result: 'skipped', error: `Status is ${settlement.status}, not ready_to_push` };
  }
  // ─── Safety check 4: Not hidden, pre-boundary, or duplicate ───
  if (settlement.is_hidden || settlement.is_pre_boundary || settlement.duplicate_of_settlement_id) {
    return { settlement_id: sid, result: 'skipped', error: 'Hidden, pre-boundary, or duplicate' };
  }
  // ─── Safety check 5: Retry budget ─────────────────────────────
  if ((settlement.push_retry_count || 0) >= MAX_RETRY_COUNT) {
    return { settlement_id: sid, result: 'skipped', error: `Exceeded max retry count (${MAX_RETRY_COUNT})` };
  }

  // ─── BLOCKER #1: Explicit validated predicate ─────────────────
  if (settlement.reconciliation_status !== 'matched') {
    // Log skip event for audit trail
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'auto_post_skipped_not_validated',
      severity: 'info',
      marketplace_code: settlement.marketplace,
      settlement_id: sid,
      details: { reason: 'reconciliation_status is not matched', actual_status: settlement.reconciliation_status },
    });
    return { settlement_id: sid, result: 'skipped', error: `Not validated: reconciliation_status is '${settlement.reconciliation_status}', required 'matched'` };
  }

  // ─── Safety check 7: Rail posting setting ─────────────────────
  const { data: railSetting } = await supabase
    .from('rail_posting_settings')
    .select('posting_mode, require_bank_match')
    .eq('user_id', userId)
    .eq('rail', settlement.marketplace)
    .single();

  if (!railSetting || railSetting.posting_mode !== 'auto') {
    return { settlement_id: sid, result: 'skipped', error: 'Rail not configured for auto-post' };
  }

  // ─── Safety check 8: Bank match if required ───────────────────
  if (railSetting.require_bank_match && !settlement.bank_verified) {
    return { settlement_id: sid, result: 'skipped', error: 'Bank match required but not verified' };
  }

  // ─── Safety check 9: Xero connection exists ───────────────────
  const { data: xeroToken, error: xeroErr } = await supabase
    .from('xero_tokens')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (xeroErr || !xeroToken) {
    return { settlement_id: sid, result: 'skipped', error: 'No Xero connection found' };
  }

  // ─── BLOCKER #2: Account mapping must exist — hard-fail, no fallback ──
  const marketplace = settlement.marketplace || 'amazon_au';
  const { data: mktMappings } = await supabase
    .from('marketplace_account_mapping')
    .select('category, account_code')
    .eq('user_id', userId)
    .eq('marketplace_code', marketplace);

  const mappingsByCategory: Record<string, string> = {};
  if (mktMappings) {
    for (const m of mktMappings) {
      mappingsByCategory[m.category] = m.account_code;
    }
  }

  // Also check global account codes (user-configured, not hardcoded defaults)
  const { data: accountSettings } = await supabase
    .from('app_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'accounting_xero_account_codes')
    .limit(1);

  let globalAccountCodes: Record<string, string> = {};
  if (accountSettings?.[0]?.value) {
    try { globalAccountCodes = JSON.parse(accountSettings[0].value); } catch {}
  }

  // Merge: marketplace-specific overrides global
  const resolvedMappings: Record<string, string> = { ...globalAccountCodes, ...mappingsByCategory };

  // Determine which categories have non-zero amounts and thus require mappings
  const contactName = MARKETPLACE_CONTACTS[marketplace] || marketplace;
  // ══════════════════════════════════════════════════════════════
  // 10-CATEGORY BREAKDOWN — Canonical source: src/utils/xero-posting-line-items.ts
  // If you change this list, bump CANONICAL_VERSION above.
  //
  // SIGN CONVENTION (Option A — "Use Stored Sign"):
  // All DB fields are stored with their accounting sign.
  // The builder passes values through WITHOUT sign manipulation.
  // No abs(), no -abs(). DB value IS the posted value.
  //
  //   Sales (Principal)     sales_principal        OUTPUT        stored sign (+)
  //   Shipping Revenue      sales_shipping         OUTPUT        stored sign (+)
  //   Promotional Discounts promotional_discounts  OUTPUT        stored sign (-)
  //   Refunds               refunds                OUTPUT        stored sign (-)
  //   Reimbursements        reimbursements         BASEXCLUDED   stored sign (+)
  //   Seller Fees           seller_fees            INPUT         stored sign (-)
  //   FBA Fees              fba_fees               INPUT         stored sign (-)
  //   Storage Fees          storage_fees           INPUT         stored sign (-)
  //   Advertising           advertising_costs      INPUT         stored sign (-)
  //   Other Fees            other_fees             INPUT         stored sign (-)
  // ══════════════════════════════════════════════════════════════
  const categoryAmounts: Record<string, number> = {
    'Sales (Principal)': round2(settlement.sales_principal || 0),
    'Shipping Revenue': round2(settlement.sales_shipping || 0),
    'Promotional Discounts': round2(settlement.promotional_discounts || 0),
    'Refunds': round2(settlement.refunds || 0),
    'Reimbursements': round2(settlement.reimbursements || 0),
    'Seller Fees': round2(settlement.seller_fees || 0),
    'FBA Fees': round2(settlement.fba_fees || 0),
    'Storage Fees': round2(settlement.storage_fees || 0),
    'Advertising': round2(settlement.advertising_costs || 0),
    'Other Fees': round2(settlement.other_fees || 0),
  };

  // Find categories with non-zero amounts that lack explicit mappings
  const missingMappings: string[] = [];
  for (const [cat, amount] of Object.entries(categoryAmounts)) {
    if (Math.abs(amount) > 0.01 && !resolvedMappings[cat]) {
      missingMappings.push(cat);
    }
  }

  if (missingMappings.length > 0) {
    const errMsg = `Missing account mappings for: ${missingMappings.join(', ')}`;
    console.error(`[auto-post-settlement] ${sid}: ${errMsg}`);

    await supabase.from('settlements').update({
      posting_state: 'failed',
      posting_error: `missing_mapping: ${missingMappings.join(', ')}`,
    }).eq('id', settlementDbId);

    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'auto_post_failed_missing_mapping',
      severity: 'warning',
      marketplace_code: marketplace,
      settlement_id: sid,
      details: { missing_categories: missingMappings, resolved_mappings: resolvedMappings },
    });

    return { settlement_id: sid, result: 'failed', error: errMsg };
  }

  // ─── BLOCKER #3: Atomic CAS with full eligibility predicates ──
  const newRetryCount = (settlement.push_retry_count || 0) + (settlement.posting_state === 'failed' ? 1 : 0);
  const claimedAt = new Date().toISOString();

  // Single atomic claim: try null first, then failed — both with full predicates
  const eligibilityUpdate = {
    posting_state: 'posting',
    posting_claimed_at: claimedAt,
    push_retry_count: newRetryCount,
    posting_error: null,
  };

  // Attempt claim from null posting_state
  const { data: claimed } = await supabase
    .from('settlements')
    .update(eligibilityUpdate)
    .eq('id', settlementDbId)
    .eq('user_id', userId)
    .eq('status', 'ready_to_push')
    .eq('is_hidden', false)
    .eq('is_pre_boundary', false)
    .is('duplicate_of_settlement_id', null)
    .is('xero_invoice_id', null)
    .eq('reconciliation_status', 'matched')
    .is('posting_state', null)
    .select('id')
    .single();

  let didClaim = !!claimed;

  // Also allow retry from 'failed' state with same full predicates
  if (!didClaim) {
    const { data: retryClaimed } = await supabase
      .from('settlements')
      .update(eligibilityUpdate)
      .eq('id', settlementDbId)
      .eq('user_id', userId)
      .eq('status', 'ready_to_push')
      .eq('is_hidden', false)
      .eq('is_pre_boundary', false)
      .is('duplicate_of_settlement_id', null)
      .is('xero_invoice_id', null)
      .eq('reconciliation_status', 'matched')
      .eq('posting_state', 'failed')
      .select('id')
      .single();

    didClaim = !!retryClaimed;
  }

  if (!didClaim) {
    return { settlement_id: sid, result: 'skipped', error: 'Could not acquire posting lock — eligibility changed or another worker claimed it' };
  }

  // Log claim event
  await supabase.from('system_events').insert({
    user_id: userId,
    event_type: 'auto_post_claimed',
    severity: 'info',
    marketplace_code: marketplace,
    settlement_id: sid,
    details: { claimed_at: claimedAt, retry_count: newRetryCount },
  });

  // ─── Build and push to Xero via sync-settlement-to-xero ───────
  try {
    const reference = `Xettle-${sid}`;
    const netAmount = settlement.bank_deposit || settlement.net_ex_gst || 0;
    const description = `${contactName} Settlement ${settlement.period_start} → ${settlement.period_end}`;

    // Tax types per category — mirrors POSTING_CATEGORIES from canonical source
    const categoryTaxTypes: Record<string, string> = {
      'Sales (Principal)': 'OUTPUT',
      'Shipping Revenue': 'OUTPUT',
      'Promotional Discounts': 'OUTPUT',
      'Refunds': 'OUTPUT',
      'Reimbursements': 'BASEXCLUDED',
      'Seller Fees': 'INPUT',
      'FBA Fees': 'INPUT',
      'Storage Fees': 'INPUT',
      'Advertising': 'INPUT',
      'Other Fees': 'INPUT',
    };

    const lineItems = Object.entries(categoryAmounts)
      .filter(([_, amount]) => Math.abs(amount) > 0.01)
      .map(([cat, amount]) => ({
        Description: `${contactName} ${cat}`,
        AccountCode: resolvedMappings[cat],
        TaxType: categoryTaxTypes[cat] || 'INPUT',
        UnitAmount: amount,
        Quantity: 1,
      }));

    if (lineItems.length === 0) {
      await supabase.from('settlements').update({
        posting_state: 'failed',
        posting_error: 'No non-zero line items',
        posting_claimed_at: null,
      }).eq('id', settlementDbId);
      return { settlement_id: sid, result: 'failed', error: 'No non-zero line items' };
    }

    // Call sync-settlement-to-xero
    const pushUrl = `${supabaseUrl}/functions/v1/sync-settlement-to-xero`;
    const pushResponse = await fetch(pushUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        userId,
        action: 'create',
        settlementId: sid,
        reference,
        description,
        date: settlement.deposit_date || settlement.period_end,
        dueDate: settlement.deposit_date || settlement.period_end,
        lineItems,
        contactName,
        netAmount,
        invoiceStatus,
        settlementData: {
          settlement_id: sid,
          period_start: settlement.period_start,
          period_end: settlement.period_end,
          marketplace,
          net_ex_gst: settlement.net_ex_gst,
          sales_principal: settlement.sales_principal,
          sales_shipping: settlement.sales_shipping,
          refunds: settlement.refunds,
          reimbursements: settlement.reimbursements,
          seller_fees: settlement.seller_fees,
          fba_fees: settlement.fba_fees,
          storage_fees: settlement.storage_fees,
          advertising_costs: settlement.advertising_costs,
          other_fees: settlement.other_fees,
          promotional_discounts: settlement.promotional_discounts,
          bank_deposit: settlement.bank_deposit,
          status: settlement.status,
        },
      }),
    });

    const pushResult = await pushResponse.json();

    if (!pushResponse.ok || !pushResult.success) {
      const errMsg = pushResult.error || `HTTP ${pushResponse.status}`;
      console.error(`[auto-post-settlement] Failed ${sid}: ${errMsg}`);

      await supabase.from('settlements').update({
        posting_state: 'failed',
        posting_error: errMsg,
        posting_claimed_at: null,
      }).eq('id', settlementDbId);

      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'auto_post_failed',
        severity: 'warning',
        marketplace_code: marketplace,
        settlement_id: sid,
        details: { error: errMsg, marketplace, amount: netAmount, retry_count: newRetryCount },
      });

      return { settlement_id: sid, result: 'failed', error: errMsg };
    }

    // ─── Success: update settlement ──────────────────────────────
    await supabase.from('settlements').update({
      posting_state: 'posted',
      posting_error: null,
      posting_claimed_at: null,
      posted_at: new Date().toISOString(),
      status: 'pushed_to_xero',
      xero_invoice_id: pushResult.invoiceId || null,
      xero_invoice_number: pushResult.invoiceNumber || null,
      xero_journal_id: pushResult.invoiceId || null,
      xero_status: 'DRAFT',
      xero_type: pushResult.xeroType || 'invoice',
    }).eq('id', settlementDbId);

    // Build immutable snapshot of what was posted to Xero
    const normalizedLineItems = lineItems.slice(0, 200).map((li: any) => ({
      description: li.Description || '',
      account_code: li.AccountCode || '',
      tax_type: li.TaxType || '',
      amount: li.UnitAmount ?? 0,
    }));
    const snapshotDetails = {
      posting_mode: 'auto',
      xero_request_payload: {
        lineItems: lineItems.slice(0, 200),
        contactName,
        reference,
        description,
        date: settlement.deposit_date || settlement.period_end,
        dueDate: settlement.deposit_date || settlement.period_end,
        netAmount,
      },
      xero_response: {
        invoice_id: pushResult.invoiceId,
        invoice_number: pushResult.invoiceNumber,
        xero_status: 'DRAFT',
        xero_type: pushResult.xeroType || 'invoice',
      },
      normalized: {
        net_amount: netAmount,
        currency: 'AUD',
        contact_name: contactName,
        line_items: normalizedLineItems,
        truncated: lineItems.length > 200,
      },
      resolved_mappings: resolvedMappings,
      retry_count: newRetryCount,
      canonical_version: CANONICAL_VERSION,
    };

    // Log success
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'auto_post_success',
      severity: 'info',
      marketplace_code: marketplace,
      settlement_id: sid,
      details: snapshotDetails,
    });

    console.log(`[auto-post-settlement] Successfully posted ${sid} to Xero as ${pushResult.invoiceNumber}`);
    return { settlement_id: sid, result: 'posted' };

  } catch (err: any) {
    console.error(`[auto-post-settlement] Error posting ${sid}:`, err);

    await supabase.from('settlements').update({
      posting_state: 'failed',
      posting_error: err.message,
      posting_claimed_at: null,
    }).eq('id', settlementDbId);

    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'auto_post_failed',
      severity: 'error',
      marketplace_code: settlement.marketplace,
      settlement_id: sid,
      details: { error: err.message, retry_count: newRetryCount },
    });

    return { settlement_id: sid, result: 'failed', error: err.message };
  }
}
