/**
 * Xero COA Mapping Readiness Checker
 * 
 * After the first successful save for a new marketplace via SmartUpload,
 * checks whether the user's Xero setup is ready to push that marketplace.
 * 
 * Does NOT create or modify Xero accounts — read-only checks + CTAs.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeKeyLabel } from '@/utils/marketplace-codes';

export interface XeroReadinessCheck {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  cta?: 'open_mapper' | 'refresh_coa' | 'fix_contact';
}

export interface XeroReadinessResult {
  xeroConnected: boolean;
  checks: XeroReadinessCheck[];
  missingCategories?: string[];
}

/** The minimum categories required for a safe push */
const REQUIRED_CATEGORIES = ['Sales', 'Seller Fees', 'Refunds', 'Other Fees', 'Shipping'];

/** Default fallback code that indicates "not configured" */
const DEFAULT_FALLBACK = '400';

/**
 * Marketplace contact names used by the push engine.
 * Mirrors the canonical MARKETPLACE_CONTACTS constant.
 */
const KNOWN_CONTACT_MARKETPLACES = new Set([
  'amazon_au', 'shopify_payments', 'shopify_orders', 'bunnings',
  'catch', 'mydeal', 'kogan', 'woolworths', 'everyday_market',
  'ebay_au', 'etsy', 'theiconic', 'bigw', 'tiktok_shop', 'temu', 'shein',
  'woolworths_marketplus', 'woolworths_marketplus_bigw',
  'woolworths_marketplus_woolworths', 'woolworths_marketplus_mydeal',
  'woolworths_marketplus_everyday_market',
]);

export async function checkXeroReadinessForMarketplace(params: {
  marketplaceCode: string;
  userId: string;
}): Promise<XeroReadinessResult> {
  const { marketplaceCode, userId } = params;
  const checks: XeroReadinessCheck[] = [];

  // 1. Xero connected?
  const { data: tenantSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'xero_tenant_id')
    .maybeSingle();

  if (!tenantSetting?.value) {
    return { xeroConnected: false, checks: [] };
  }

  // 2. Contact mapping readiness
  // The push engine uses MARKETPLACE_CONTACTS constants — if the marketplace
  // is in the known set, contact is handled. Otherwise it's unknown.
  if (KNOWN_CONTACT_MARKETPLACES.has(marketplaceCode)) {
    checks.push({
      key: 'contact_mapping',
      label: 'Contact mapping',
      status: 'pass',
      message: 'Known marketplace — contact name is pre-configured.',
    });
  } else {
    checks.push({
      key: 'contact_mapping',
      label: 'Contact mapping',
      status: 'fail',
      message: `No contact mapping for "${marketplaceCode}". Configure before pushing.`,
      cta: 'fix_contact',
    });
  }

  // 3. COA cache
  try {
    const { count } = await supabase
      .from('app_settings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('key', 'xero_chart_of_accounts');

    if (!count || count === 0) {
      checks.push({
        key: 'coa_cache',
        label: 'Chart of Accounts',
        status: 'warn',
        message: 'No Chart of Accounts cached. Refresh to enable account mapping validation.',
        cta: 'refresh_coa',
      });
    } else {
      checks.push({
        key: 'coa_cache',
        label: 'Chart of Accounts',
        status: 'pass',
      });
    }
  } catch {
    checks.push({
      key: 'coa_cache',
      label: 'Chart of Accounts',
      status: 'warn',
      message: 'Could not verify CoA cache.',
      cta: 'refresh_coa',
    });
  }

  // 4. Account mapping completeness
  const missingCategories: string[] = [];
  try {
    const { data: acSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'accounting_xero_account_codes')
      .maybeSingle();

    const userCodes: Record<string, string> = acSetting?.value ? JSON.parse(acSetting.value) : {};
    let allMapped = true;
    let hasMarketplaceSpecific = false;

    for (const cat of REQUIRED_CATEGORIES) {
      const mpKey = `${cat}:${marketplaceCode}`;
      const code = userCodes[mpKey] || userCodes[cat] || DEFAULT_FALLBACK;
      if (userCodes[mpKey]) hasMarketplaceSpecific = true;
      if (code === DEFAULT_FALLBACK || !code) {
        missingCategories.push(cat);
        allMapped = false;
      }
    }

    if (!allMapped) {
      checks.push({
        key: 'account_mapping',
        label: 'Account mappings',
        status: 'fail',
        message: `Missing account codes for: ${missingCategories.join(', ')}`,
        cta: 'open_mapper',
      });
    } else if (!hasMarketplaceSpecific) {
      checks.push({
        key: 'account_mapping',
        label: 'Account mappings',
        status: 'warn',
        message: 'Using global mappings — consider setting marketplace-specific codes.',
        cta: 'open_mapper',
      });
    } else {
      checks.push({
        key: 'account_mapping',
        label: 'Account mappings',
        status: 'pass',
      });
    }
  } catch {
    checks.push({
      key: 'account_mapping',
      label: 'Account mappings',
      status: 'warn',
      message: 'Could not verify account mappings.',
      cta: 'open_mapper',
    });
  }

  // Log readiness check (non-blocking)
  try {
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: missingCategories.length > 0
        ? 'xero_mapping_missing_for_marketplace'
        : 'xero_mapping_readiness_checked',
      severity: missingCategories.length > 0 ? 'warning' : 'info',
      marketplace_code: marketplaceCode,
      details: {
        checks: checks.map(c => ({ key: c.key, status: c.status })),
        missingCategories: missingCategories.length > 0 ? missingCategories : undefined,
      },
    } as any);
  } catch { /* non-blocking */ }

  return {
    xeroConnected: true,
    checks,
    missingCategories: missingCategories.length > 0 ? missingCategories : undefined,
  };
}
