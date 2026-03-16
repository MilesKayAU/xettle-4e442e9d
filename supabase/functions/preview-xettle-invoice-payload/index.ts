/**
 * preview-xettle-invoice-payload — Generate the exact Xero payload Xettle would post.
 * 
 * Uses the SAME canonical builder as sync-settlement-to-xero:
 *   - SERVER_POSTING_CATEGORIES (10 categories)
 *   - LEGACY_ACCOUNT_KEY_MAP (for account code resolution)
 *   - Contact resolution via SERVER_MARKETPLACE_CONTACTS
 *   - Tier enforcement, tracking, tax mode
 * 
 * NO Xero API calls. NO posting. Preview only.
 * 
 * Input: { settlementId: string }
 * Auth: Bearer token → user_id
 * Tables read: settlements, app_settings, marketplace_account_mapping
 * Tables written: system_events
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// ─── Canonical Version (must match sync-settlement-to-xero) ──
const CANONICAL_VERSION = 'v2-10cat';

// ─── Canonical Posting Categories (exact copy from sync-settlement-to-xero) ──
interface PostingCategoryDef {
  name: string;
  field: string;
  taxType: 'OUTPUT' | 'INPUT' | 'BASEXCLUDED';
  defaultAccountCode: string;
}

const SERVER_POSTING_CATEGORIES: readonly PostingCategoryDef[] = [
  { name: 'Sales (Principal)',     field: 'sales_principal',       taxType: 'OUTPUT',       defaultAccountCode: '200' },
  { name: 'Shipping Revenue',     field: 'sales_shipping',        taxType: 'OUTPUT',       defaultAccountCode: '206' },
  { name: 'Promotional Discounts',field: 'promotional_discounts', taxType: 'OUTPUT',       defaultAccountCode: '200' },
  { name: 'Refunds',              field: 'refunds',               taxType: 'OUTPUT',       defaultAccountCode: '205' },
  { name: 'Reimbursements',       field: 'reimbursements',        taxType: 'BASEXCLUDED',  defaultAccountCode: '271' },
  { name: 'Seller Fees',          field: 'seller_fees',           taxType: 'INPUT',        defaultAccountCode: '407' },
  { name: 'FBA Fees',             field: 'fba_fees',              taxType: 'INPUT',        defaultAccountCode: '408' },
  { name: 'Storage Fees',         field: 'storage_fees',          taxType: 'INPUT',        defaultAccountCode: '409' },
  { name: 'Advertising',          field: 'advertising_costs',     taxType: 'INPUT',        defaultAccountCode: '410' },
  { name: 'Other Fees',           field: 'other_fees',            taxType: 'INPUT',        defaultAccountCode: '405' },
];

const LEGACY_ACCOUNT_KEY_MAP: Record<string, string> = {
  'Sales (Principal)': 'Sales',
  'Shipping Revenue': 'Shipping',
  'Promotional Discounts': 'Promotional Discounts',
  'Refunds': 'Refunds',
  'Reimbursements': 'Reimbursements',
  'Seller Fees': 'Seller Fees',
  'FBA Fees': 'FBA Fees',
  'Storage Fees': 'Storage Fees',
  'Advertising': 'Advertising Costs',
  'Other Fees': 'Other Fees',
};

const SERVER_MARKETPLACE_CONTACTS: Record<string, string> = {
  amazon_au: 'Amazon.com.au',
  amazon_us: 'Amazon.com',
  amazon_uk: 'Amazon.co.uk',
  amazon_ca: 'Amazon.ca',
  shopify_payments: 'Shopify Payments',
  shopify_orders: 'Shopify',
  bunnings: 'Bunnings Marketplace',
  bigw: 'Big W Marketplace',
  catch: 'Catch Marketplace',
  mydeal: 'MyDeal Marketplace',
  kogan: 'Kogan Marketplace',
  woolworths: 'Woolworths Marketplace',
  woolworths_marketplus: 'Woolworths MarketPlus',
  ebay_au: 'eBay Australia',
  everyday_market: 'Everyday Market',
  theiconic: 'THE ICONIC',
  etsy: 'Etsy',
};

const AU_VALIDATED_RAILS = new Set([
  'amazon_au', 'shopify_payments', 'ebay', 'bunnings', 'catch',
  'kogan', 'mydeal', 'everyday_market', 'paypal',
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { settlementId } = await req.json();
    if (!settlementId) return new Response(JSON.stringify({ error: 'settlementId required' }), { status: 400, headers: corsHeaders });

    // Fetch settlement
    const { data: settlement, error: settErr } = await supabase
      .from('settlements')
      .select('*')
      .eq('user_id', user.id)
      .eq('settlement_id', settlementId)
      .maybeSingle();

    if (settErr || !settlement) {
      return new Response(JSON.stringify({ error: 'Settlement not found' }), { status: 404, headers: corsHeaders });
    }

    const marketplace = settlement.marketplace || '';
    const railNormalised = marketplace.toLowerCase();

    // ─── Tier computation (same as sync-settlement-to-xero) ──
    const { data: orgTaxSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'tax_profile')
      .maybeSingle();
    const orgTaxProfile = orgTaxSetting?.value || 'AU_GST';

    const tier = (AU_VALIDATED_RAILS.has(railNormalised) && orgTaxProfile === 'AU_GST')
      ? 'SUPPORTED'
      : AU_VALIDATED_RAILS.has(railNormalised) ? 'EXPERIMENTAL' : 'UNSUPPORTED';

    // ─── Tax mode ──
    const { data: railSetting } = await supabase
      .from('rail_posting_settings')
      .select('tax_mode, invoice_status, support_acknowledged_at')
      .eq('user_id', user.id)
      .eq('rail', railNormalised)
      .maybeSingle();
    const taxMode = railSetting?.tax_mode || 'AU_GST_STANDARD';
    const configuredStatus = railSetting?.invoice_status || 'DRAFT';

    // ─── Enforced status (same rules as sync-settlement-to-xero) ──
    let enforcedStatus = configuredStatus;
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (configuredStatus === 'AUTHORISED' && tier !== 'SUPPORTED') {
      enforcedStatus = 'DRAFT';
      warnings.push(`AUTHORISED blocked — tier is ${tier}, forced to DRAFT`);
    }

    // ─── Contact resolution ──
    const contactName = SERVER_MARKETPLACE_CONTACTS[railNormalised];
    if (!contactName) {
      blockers.push(`No Xero contact mapping for marketplace "${marketplace}"`);
    }

    // ─── Account code resolution (same as sync-settlement-to-xero) ──
    let userAccountCodes: Record<string, string> = {};
    try {
      const { data: acSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_xero_account_codes')
        .maybeSingle();
      if (acSetting?.value) {
        userAccountCodes = JSON.parse(acSetting.value);
      }
    } catch (e) {
      console.error('Failed to load user account codes:', e);
    }

    const getCode = (category: string, mp?: string): string | null => {
      if (mp) {
        const mpKey = `${category}:${mp}`;
        if (userAccountCodes[mpKey]) return userAccountCodes[mpKey];
      }
      if (userAccountCodes[category]) return userAccountCodes[category];
      return null;
    };

    // ─── Build line items (exact same builder as sync-settlement-to-xero) ──
    const lineItems: Array<{
      Description: string;
      AccountCode: string;
      TaxType: string;
      UnitAmount: number;
      Quantity: number;
    }> = [];

    for (const cat of SERVER_POSTING_CATEGORIES) {
      const raw = settlement[cat.field];
      const value = typeof raw === 'number' ? raw : parseFloat(raw) || 0;
      const amount = round2(value);
      if (Math.abs(amount) < 0.01) continue;

      const legacyKey = LEGACY_ACCOUNT_KEY_MAP[cat.name] || cat.name;
      const resolvedCode = getCode(legacyKey, contactName || undefined);

      lineItems.push({
        Description: cat.name,
        AccountCode: resolvedCode || '',
        TaxType: cat.taxType,
        UnitAmount: amount,
        Quantity: 1,
      });
    }

    // Check unmapped
    const unmappedLines = lineItems.filter(li => !li.AccountCode);
    if (unmappedLines.length > 0) {
      blockers.push(`Unmapped categories: ${unmappedLines.map(li => li.Description).join(', ')}`);
    }

    // ─── Tracking ──
    let tracking: any = null;
    try {
      const { data: trackingSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'xero_tracking_enabled')
        .maybeSingle();

      if (trackingSetting?.value === 'true' && contactName) {
        const cacheKey = `xero_tracking_sales_channel_${contactName.toLowerCase().replace(/\s+/g, '_')}`;
        const { data: cachedTracking } = await supabase
          .from('app_settings')
          .select('value')
          .eq('user_id', user.id)
          .eq('key', cacheKey)
          .maybeSingle();

        if (cachedTracking?.value) {
          try {
            const cached = JSON.parse(cachedTracking.value);
            tracking = [{ Name: cached.categoryName, Option: cached.optionName }];
          } catch { /* skip */ }
        }
      }
    } catch { /* non-fatal */ }

    // ─── Build reference ──
    const splitSuffix = settlement.is_split_month ? '' : '';
    const reference = `Xettle-${settlementId}${splitSuffix}`;

    // ─── Net amount / invoice type ──
    const netAmount = typeof settlement.bank_deposit === 'number' ? settlement.bank_deposit
      : typeof settlement.net_ex_gst === 'number' ? settlement.net_ex_gst : 0;
    const invoiceType = netAmount < 0 ? 'ACCPAY' : 'ACCREC';

    // ─── Build final payload (Xero-shaped) ──
    const date = settlement.period_end || new Date().toISOString().split('T')[0];
    const payload = {
      Type: invoiceType,
      Contact: { Name: contactName || `UNMAPPED: ${marketplace}` },
      Date: date,
      DueDate: date,
      CurrencyCode: 'AUD',
      Status: enforcedStatus,
      LineAmountTypes: 'Exclusive',
      Reference: reference,
      LineItems: lineItems.map(li => ({
        Description: li.Description,
        AccountCode: li.AccountCode,
        TaxType: li.TaxType,
        UnitAmount: round2(li.UnitAmount),
        Quantity: li.Quantity,
        ...(tracking ? { Tracking: tracking } : {}),
      })),
    };

    // ─── Log system event ──
    await supabase.from('system_events').insert({
      user_id: user.id,
      event_type: 'xettle_payload_preview_generated',
      severity: 'info',
      settlement_id: settlementId,
      marketplace_code: marketplace,
      details: {
        canonical_version: CANONICAL_VERSION,
        tier,
        tax_mode: taxMode,
        org_tax_profile: orgTaxProfile,
        enforced_status: enforcedStatus,
        line_item_count: lineItems.length,
        blocker_count: blockers.length,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      payload,
      tier,
      tax_mode: taxMode,
      org_tax_profile: orgTaxProfile,
      enforced_status: enforcedStatus,
      blockers,
      warnings,
      canonical_version: CANONICAL_VERSION,
      net_amount: round2(netAmount),
      invoice_type: invoiceType,
      tracking: tracking || null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('preview-xettle-invoice-payload error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
