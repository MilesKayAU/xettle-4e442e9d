/**
 * auto-post-settlement — Async worker that auto-posts ready settlements to Xero.
 *
 * Triggered per-settlement when posting_mode='auto' for the rail.
 * Idempotent: checks posting_state before acting.
 * Uses atomic compare-and-set to prevent duplicate posting.
 *
 * This does NOT bypass validation — it only removes the manual click.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MARKETPLACE_CONTACTS: Record<string, string> = {
  amazon_au: 'Amazon.com.au',
  amazon_us: 'Amazon.com',
  shopify_payments: 'Shopify',
  kogan: 'Kogan.com',
  bigw: 'Big W Marketplace',
  bunnings: 'Bunnings Marketplace',
  mydeal: 'MyDeal',
  catch: 'Catch.com.au',
  ebay_au: 'eBay Australia',
  ebay: 'eBay Australia',
  woolworths: 'Woolworths Everyday Market',
  everyday_market: 'Everyday Market',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey);

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

    const results: Array<{ settlement_id: string; result: string; error?: string }> = [];

    // ─── Single settlement mode ──────────────────────────────────
    if (targetSettlementId && targetUserId) {
      const result = await processSettlement(supabase, targetSettlementId, targetUserId);
      results.push(result);
    } else {
      // ─── Batch mode: scan all users with auto-post rails ───────
      const { data: autoRails } = await supabase
        .from('rail_posting_settings')
        .select('user_id, rail')
        .eq('posting_mode', 'auto');

      if (!autoRails || autoRails.length === 0) {
        return new Response(JSON.stringify({ success: true, processed: 0, message: 'No auto-post rails configured' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Group by user
      const userRails = new Map<string, string[]>();
      for (const r of autoRails) {
        const existing = userRails.get(r.user_id) || [];
        existing.push(r.rail);
        userRails.set(r.user_id, existing);
      }

      for (const [userId, rails] of userRails) {
        // Find ready_to_push settlements for auto-post rails
        const { data: settlements } = await supabase
          .from('settlements')
          .select('id, settlement_id, marketplace, status, posting_state, xero_invoice_id, is_hidden, is_pre_boundary, duplicate_of_settlement_id')
          .eq('user_id', userId)
          .eq('status', 'ready_to_push')
          .eq('is_hidden', false)
          .eq('is_pre_boundary', false)
          .is('duplicate_of_settlement_id', null)
          .is('posting_state', null)
          .in('marketplace', rails);

        if (!settlements || settlements.length === 0) continue;

        // Also process failed ones that can retry
        const { data: failedSettlements } = await supabase
          .from('settlements')
          .select('id, settlement_id, marketplace, status, posting_state, xero_invoice_id, is_hidden, is_pre_boundary, duplicate_of_settlement_id')
          .eq('user_id', userId)
          .eq('status', 'ready_to_push')
          .eq('posting_state', 'failed')
          .eq('is_hidden', false)
          .eq('is_pre_boundary', false)
          .is('duplicate_of_settlement_id', null)
          .in('marketplace', rails);

        const allSettlements = [...settlements, ...(failedSettlements || [])];

        for (const s of allSettlements) {
          // Check rail config for bank match requirement
          const railConfig = autoRails.find(r => r.user_id === userId && r.rail === s.marketplace);
          if (!railConfig) continue;

          const { data: railSettings } = await supabase
            .from('rail_posting_settings')
            .select('require_bank_match')
            .eq('user_id', userId)
            .eq('rail', s.marketplace)
            .single();

          if (railSettings?.require_bank_match) {
            // Check if bank matched
            const { data: settlement } = await supabase
              .from('settlements')
              .select('bank_verified')
              .eq('id', s.id)
              .single();
            if (!settlement?.bank_verified) {
              results.push({ settlement_id: s.settlement_id, result: 'skipped', error: 'bank_match_required_not_met' });
              continue;
            }
          }

          const result = await processSettlement(supabase, s.id, userId);
          results.push(result);
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
  userId: string
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

  // ─── Idempotency checks ────────────────────────────────────────
  if (settlement.posting_state === 'posted' || settlement.posting_state === 'posting') {
    return { settlement_id: sid, result: 'skipped', error: `Already ${settlement.posting_state}` };
  }
  if (settlement.xero_invoice_id) {
    return { settlement_id: sid, result: 'skipped', error: 'Already has xero_invoice_id' };
  }
  if (settlement.status !== 'ready_to_push') {
    return { settlement_id: sid, result: 'skipped', error: `Status is ${settlement.status}, not ready_to_push` };
  }
  if (settlement.is_hidden || settlement.is_pre_boundary || settlement.duplicate_of_settlement_id) {
    return { settlement_id: sid, result: 'skipped', error: 'Hidden, pre-boundary, or duplicate' };
  }

  // ─── Safety validations ────────────────────────────────────────
  // Check rail posting setting
  const { data: railSetting } = await supabase
    .from('rail_posting_settings')
    .select('posting_mode, require_bank_match')
    .eq('user_id', userId)
    .eq('rail', settlement.marketplace)
    .single();

  if (!railSetting || railSetting.posting_mode !== 'auto') {
    return { settlement_id: sid, result: 'skipped', error: 'Rail not configured for auto-post' };
  }

  if (railSetting.require_bank_match && !settlement.bank_verified) {
    return { settlement_id: sid, result: 'skipped', error: 'Bank match required but not verified' };
  }

  // Check account mapping exists
  const { data: mappings } = await supabase
    .from('marketplace_account_mapping')
    .select('id')
    .eq('user_id', userId)
    .eq('marketplace_code', settlement.marketplace)
    .limit(1);

  // Not blocking on missing mapping — sync-settlement-to-xero uses defaults

  // ─── Atomic compare-and-set: claim this settlement ─────────────
  const { data: claimed, error: claimErr } = await supabase
    .from('settlements')
    .update({ posting_state: 'posting' })
    .eq('id', settlementDbId)
    .eq('user_id', userId)
    .is('posting_state', null)
    .select('id')
    .single();

  // Also allow retry from 'failed' state
  if (!claimed) {
    const { data: retryClaimed } = await supabase
      .from('settlements')
      .update({ posting_state: 'posting', posting_error: null })
      .eq('id', settlementDbId)
      .eq('user_id', userId)
      .eq('posting_state', 'failed')
      .select('id')
      .single();

    if (!retryClaimed) {
      return { settlement_id: sid, result: 'skipped', error: 'Could not acquire posting lock (another worker may be processing)' };
    }
  }

  // ─── Build and push to Xero via sync-settlement-to-xero ───────
  try {
    const marketplace = settlement.marketplace || 'amazon_au';
    const contactName = MARKETPLACE_CONTACTS[marketplace] || marketplace;
    const reference = `Xettle-${sid}`;
    const netAmount = settlement.bank_deposit || settlement.net_ex_gst || 0;
    const description = `${contactName} Settlement ${settlement.period_start} → ${settlement.period_end}`;

    // Get account codes
    const { data: accountSettings } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'accounting_xero_account_codes')
      .limit(1);

    let accountCodes: Record<string, string> = {};
    if (accountSettings?.[0]?.value) {
      try { accountCodes = JSON.parse(accountSettings[0].value); } catch {}
    }

    // Also check marketplace-specific mappings
    const { data: mktMappings } = await supabase
      .from('marketplace_account_mapping')
      .select('category, account_code')
      .eq('user_id', userId)
      .eq('marketplace_code', marketplace);

    if (mktMappings) {
      for (const m of mktMappings) {
        accountCodes[m.category] = m.account_code;
      }
    }

    const getCode = (cat: string) => accountCodes[cat] || ({
      'Sales': '200', 'Refunds': '205', 'Reimbursements': '271',
      'Seller Fees': '407', 'FBA Fees': '408', 'Storage Fees': '409',
      'Promotional Discounts': '200', 'Other Fees': '405',
      'Advertising Costs': '410',
    }[cat] || '405');

    const lineItems = [
      { Description: `${contactName} Sales`, AccountCode: getCode('Sales'), TaxType: 'OUTPUT', UnitAmount: round2((settlement.sales_principal || 0) + (settlement.sales_shipping || 0)), Quantity: 1 },
      { Description: `${contactName} Promotional Discounts`, AccountCode: getCode('Promotional Discounts'), TaxType: 'OUTPUT', UnitAmount: round2(settlement.promotional_discounts || 0), Quantity: 1 },
      { Description: `${contactName} Refunds`, AccountCode: getCode('Refunds'), TaxType: 'OUTPUT', UnitAmount: round2(settlement.refunds || 0), Quantity: 1 },
      { Description: `${contactName} Reimbursements`, AccountCode: getCode('Reimbursements'), TaxType: 'NONE', UnitAmount: round2(settlement.reimbursements || 0), Quantity: 1 },
      { Description: `${contactName} Seller Fees`, AccountCode: getCode('Seller Fees'), TaxType: 'INPUT', UnitAmount: -Math.abs(round2(settlement.seller_fees || 0)), Quantity: 1 },
      { Description: `${contactName} FBA Fees`, AccountCode: getCode('FBA Fees'), TaxType: 'INPUT', UnitAmount: -Math.abs(round2(settlement.fba_fees || 0)), Quantity: 1 },
      { Description: `${contactName} Storage Fees`, AccountCode: getCode('Storage Fees'), TaxType: 'INPUT', UnitAmount: -Math.abs(round2(settlement.storage_fees || 0)), Quantity: 1 },
      { Description: `${contactName} Advertising Costs`, AccountCode: getCode('Advertising Costs'), TaxType: 'INPUT', UnitAmount: -Math.abs(round2(settlement.advertising_costs || 0)), Quantity: 1 },
      { Description: `${contactName} Other Fees`, AccountCode: getCode('Other Fees'), TaxType: 'INPUT', UnitAmount: -Math.abs(Math.max(round2(settlement.other_fees || 0), 0)), Quantity: 1 },
    ].filter(item => Math.abs(item.UnitAmount) > 0.01);

    if (lineItems.length === 0) {
      await supabase.from('settlements').update({ posting_state: 'failed', posting_error: 'No non-zero line items' }).eq('id', settlementDbId);
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
      }).eq('id', settlementDbId);

      // Log to system_events
      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'auto_post_failed',
        severity: 'warning',
        marketplace_code: marketplace,
        settlement_id: sid,
        details: { error: errMsg, marketplace, amount: netAmount },
      });

      return { settlement_id: sid, result: 'failed', error: errMsg };
    }

    // ─── Success: update settlement ──────────────────────────────
    await supabase.from('settlements').update({
      posting_state: 'posted',
      posting_error: null,
      posted_at: new Date().toISOString(),
      status: 'pushed_to_xero',
      xero_invoice_id: pushResult.invoiceId || null,
      xero_invoice_number: pushResult.invoiceNumber || null,
      xero_journal_id: pushResult.invoiceId || null,
      xero_status: 'DRAFT',
      xero_type: pushResult.xeroType || 'invoice',
    }).eq('id', settlementDbId);

    // Log success
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'auto_post_success',
      severity: 'info',
      marketplace_code: marketplace,
      settlement_id: sid,
      details: {
        marketplace,
        amount: netAmount,
        xero_invoice_id: pushResult.invoiceId,
        xero_invoice_number: pushResult.invoiceNumber,
        posting_mode: 'auto',
      },
    });

    console.log(`[auto-post-settlement] Successfully posted ${sid} to Xero as ${pushResult.invoiceNumber}`);
    return { settlement_id: sid, result: 'posted' };

  } catch (err: any) {
    console.error(`[auto-post-settlement] Error posting ${sid}:`, err);

    await supabase.from('settlements').update({
      posting_state: 'failed',
      posting_error: err.message,
    }).eq('id', settlementDbId);

    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'auto_post_failed',
      severity: 'error',
      marketplace_code: settlement.marketplace,
      settlement_id: sid,
      details: { error: err.message },
    });

    return { settlement_id: sid, result: 'failed', error: err.message };
  }
}
