import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const xeroClientId = Deno.env.get('XERO_CLIENT_ID')!;
const xeroClientSecret = Deno.env.get('XERO_CLIENT_SECRET')!;

interface XeroToken {
  id: string;
  user_id: string;
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

async function refreshToken(supabase: any, token: XeroToken): Promise<XeroToken> {
  const expiresAt = new Date(token.expires_at);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return token;

  const resp = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${xeroClientId}:${xeroClientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }),
  });

  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);
  const data = await resp.json();
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase.from('xero_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', token.id);

  return { ...token, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: newExpiresAt };
}

function parseXeroDate(dateField: string | null | undefined): string | null {
  if (!dateField) return null;
  // Already an ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) — return as-is
  if (/^\d{4}-\d{2}-\d{2}/.test(dateField)) return dateField.split('T')[0];
  // Xero .NET JSON date format: /Date(1234567890000+0000)/
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0];
  const ts = parseInt(raw);
  if (!isNaN(ts) && ts > 100000000000) return new Date(ts).toISOString().split('T')[0];
  if (!isNaN(ts)) return null; // Small number = not a valid timestamp
  return null;
}

function extractSettlementId(reference: string): { id: string | null; part: number | null } {
  if (reference.startsWith('Xettle-')) {
    const partMatch = reference.match(/-P([12])$/);
    return { id: reference.slice(7).replace(/-P[12]$/, ''), part: partMatch ? parseInt(partMatch[1]) : null };
  }
  if (reference.startsWith('AMZN-')) return { id: reference.slice(5), part: null };
  // Handle "Amazon AU Settlement {id} - Part {n}" format (split invoices)
  const amazonSettlementMatch = reference.match(/Amazon.*Settlement\s+(\d+)\s*-\s*Part\s+(\d+)/i);
  if (amazonSettlementMatch) return { id: amazonSettlementMatch[1], part: Number(amazonSettlementMatch[2]) };
  const lmbMatch = reference.match(/^LMB-\w+-(\d+)-(\d+)$/);
  if (lmbMatch) return { id: lmbMatch[1], part: parseInt(lmbMatch[2]) };
  const numericMatch = reference.match(/\b(\d{8,})\b/);
  if (numericMatch) return { id: numericMatch[1], part: null };
  const shopifyMatch = reference.match(/(Shopify-[\w]+)/);
  if (shopifyMatch) return { id: shopifyMatch[1], part: null };
  const genericMatch = reference.match(/(\d+_\w+)/);
  if (genericMatch) return { id: genericMatch[1], part: null };
  return { id: null, part: null };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchXeroWithRetry(url: string, headers: Record<string, string>, maxAttempts = 4) {
  let lastStatus = 0;
  let lastBody = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(url, { headers });

    if (resp.ok) {
      return { ok: true as const, data: await resp.json() };
    }

    lastStatus = resp.status;
    lastBody = await resp.text();

    if (resp.status === 429 && attempt < maxAttempts) {
      const retryAfterHeader = resp.headers.get('Retry-After');
      const retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader) : NaN;
      const delayMs = !isNaN(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 120
        ? retryAfterSec * 1000
        : Math.min(2000 * Math.pow(2, attempt - 1), 16000);
      console.warn(`Xero rate limited (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms`);
      await sleep(delayMs);
      continue;
    }

    return { ok: false as const, status: lastStatus, body: lastBody };
  }

  return { ok: false as const, status: lastStatus, body: lastBody };
}

function detectMarketplace(reference: string, contactName: string, currencyCode?: string): string {
  const ref = reference.toLowerCase();
  const contact = contactName.toLowerCase();
  // Amazon US detection: LMB-US refs or USD Amazon invoices
  if (ref.startsWith('lmb-us-')) return 'amazon_us';
  if ((ref.startsWith('amzn-') || ref.includes('amazon') || contact.includes('amazon')) && currencyCode === 'USD') return 'amazon_us';
  if (contact.includes('amazon.com') && !contact.includes('amazon.com.au') && currencyCode === 'USD') return 'amazon_us';
  // Amazon AU
  if (ref.startsWith('amzn-') || ref.includes('amazon') || contact.includes('amazon')) return 'amazon_au';
  if (ref.startsWith('lmb-')) return 'amazon_au';
  if (ref.includes('shopify') || contact.includes('shopify')) return 'shopify_payments';
  if (contact.includes('kogan')) return 'kogan';
  if (contact.includes('big w') || contact.includes('bigw')) return 'bigw';
  if (contact.includes('bunnings')) return 'bunnings';
  if (contact.includes('mydeal') || contact.includes('my deal')) return 'mydeal';
  if (contact.includes('catch')) return 'catch';
  if (contact.includes('ebay')) return 'ebay_au';
  return 'unknown';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    // ─── Parse optional request body params ───
    let forceRecompute = false;
    let forceRefresh = false;
    let lookbackDays = 90;
    try {
      if (req.method === 'POST') {
        const body = await req.json();
        if (body.force_recompute === true) forceRecompute = true;
        if (body.force_refresh === true) forceRefresh = true;
        if (typeof body.lookback_days === 'number') {
          lookbackDays = Math.max(30, Math.min(180, Math.round(body.lookback_days)));
        }
      }
    } catch {
      // No body or invalid JSON — use defaults
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Xero token
    const { data: tokens } = await supabase
      .from('xero_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!tokens?.length) {
      // No Xero connection — return explicit signal so UI shows reconnect state (never false "All clear")
      return new Response(JSON.stringify({
        rows: [],
        total_outstanding: 0,
        invoice_count: 0,
        matched_with_settlement: 0,
        bank_deposit_found: 0,
        ready_to_reconcile: 0,
        sync_info: {
          no_xero_connection: true,
          status: 'no_connection',
          message: 'No Xero connection found — connect Xero to see outstanding invoices.',
        },
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let token = tokens[0] as XeroToken;
    token = await refreshToken(supabase, token);

    // ─── Get accounting boundary date ───
    const { data: boundaryRow } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'accounting_boundary_date')
      .maybeSingle();
    const accountingBoundary = boundaryRow?.value || null;

    // ─── CACHE-FIRST: Check outstanding_invoices_cache before hitting Xero ───
    const CACHE_TTL_MINUTES = 30;
    let allInvoices: any[] = [];
    let usingCacheFallback = false;
    let invoiceCacheAgeMinutes: number | null = null;

    // Check cache freshness
    const { data: cacheAgeRow } = await supabase
      .from('outstanding_invoices_cache')
      .select('fetched_at')
      .eq('user_id', userId)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const cacheIsFresh = cacheAgeRow?.fetched_at
      ? (Date.now() - new Date(cacheAgeRow.fetched_at).getTime()) < CACHE_TTL_MINUTES * 60 * 1000
      : false;

    if (cacheAgeRow?.fetched_at) {
      invoiceCacheAgeMinutes = Math.round((Date.now() - new Date(cacheAgeRow.fetched_at).getTime()) / 60000);
    }

    const shouldHitXero = forceRefresh || !cacheIsFresh;

    if (shouldHitXero) {
      // ─── Fetch ALL outstanding sales invoices (ACCREC) from Xero ───
      const invoiceWhere = encodeURIComponent(`Type=="ACCREC"`);
      const url = `https://api.xero.com/api.xro/2.0/Invoices?Statuses=DRAFT,SUBMITTED,AUTHORISED&where=${invoiceWhere}&order=Date DESC&summaryOnly=true`;

      const xeroResult = await fetchXeroWithRetry(url, {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id,
      });

      if (xeroResult.ok) {
        allInvoices = xeroResult.data.Invoices || [];

        // Upsert into outstanding_invoices_cache
        const now = new Date().toISOString();
        const cacheRows = allInvoices.map((inv: any) => ({
          user_id: userId,
          xero_invoice_id: inv.InvoiceID,
          xero_tenant_id: token.tenant_id,
          invoice_number: inv.InvoiceNumber || null,
          reference: inv.Reference || null,
          contact_name: inv.Contact?.Name || null,
          date: parseXeroDate(inv.Date) || null,
          due_date: parseXeroDate(inv.DueDate) || null,
          amount_due: inv.AmountDue || 0,
          total: inv.Total || 0,
          currency_code: inv.CurrencyCode || 'AUD',
          status: inv.Status || null,
          fetched_at: now,
        }));

        if (cacheRows.length > 0) {
          // Delete stale entries then insert fresh (atomic refresh)
          await supabase.from('outstanding_invoices_cache').delete().eq('user_id', userId);
          // Batch insert in chunks of 500
          for (let i = 0; i < cacheRows.length; i += 500) {
            await supabase.from('outstanding_invoices_cache').insert(cacheRows.slice(i, i + 500));
          }
          invoiceCacheAgeMinutes = 0;
        }
        console.log(`[fetch-outstanding] Xero live: ${allInvoices.length} invoices, cache updated`);
      } else {
        console.error('Xero invoice fetch failed:', xeroResult.status, xeroResult.body);

        // Set cooldown on 429
        if (xeroResult.status === 429) {
          const cooldownUntil = new Date(Date.now() + 90 * 1000).toISOString();
          await supabase.from('app_settings').upsert({
            user_id: userId,
            key: 'xero_api_cooldown_until',
            value: cooldownUntil,
          }, { onConflict: 'user_id,key' });
        }

        // Fall back to outstanding_invoices_cache
        const { data: cachedInvoices } = await supabase
          .from('outstanding_invoices_cache')
          .select('*')
          .eq('user_id', userId);

        if (cachedInvoices && cachedInvoices.length > 0) {
          usingCacheFallback = true;
          allInvoices = cachedInvoices.map((c: any) => ({
            InvoiceID: c.xero_invoice_id,
            InvoiceNumber: c.invoice_number,
            Reference: c.reference || '',
            Contact: { Name: c.contact_name || 'Marketplace' },
            Date: c.date || null,
            DueDate: c.due_date || null,
            AmountDue: Number(c.amount_due || 0),
            Total: Number(c.total || 0),
            CurrencyCode: c.currency_code || 'AUD',
            Status: c.status,
          }));
          if (cachedInvoices[0]?.fetched_at) {
            invoiceCacheAgeMinutes = Math.round((Date.now() - new Date(cachedInvoices[0].fetched_at).getTime()) / 60000);
          }
          console.log(`[fetch-outstanding] 429 fallback: serving ${allInvoices.length} cached invoices (${invoiceCacheAgeMinutes}m old)`);
        } else {
          // No cache at all — also check xero_accounting_matches as last resort
          const { data: cachedOutstanding } = await supabase
            .from('xero_accounting_matches')
            .select('settlement_id, marketplace_code, xero_invoice_id, xero_invoice_number, xero_status, matched_amount, matched_date, matched_contact, matched_reference')
            .eq('user_id', userId)
            .in('xero_status', ['DRAFT', 'SUBMITTED', 'AUTHORISED'])
            .not('xero_invoice_id', 'is', null);

          if (!cachedOutstanding || cachedOutstanding.length === 0) {
            const retryAfter = xeroResult.status === 429 ? 60 : 0;
            return new Response(JSON.stringify({
              invoices: [],
              rows: [],
              total_outstanding: 0,
              invoice_count: 0,
              matched_with_settlement: 0,
              bank_deposit_found: 0,
              ready_to_reconcile: 0,
              sync_info: {
                xero_rate_limited: xeroResult.status === 429,
                xero_auth_error: xeroResult.status === 401 || xeroResult.status === 403,
                xero_error: xeroResult.status !== 429,
                xero_status: xeroResult.status,
                retry_after_seconds: retryAfter,
                from_cache: false,
                invoice_cache_age_minutes: null,
                message: xeroResult.status === 429
                  ? 'Xero rate limited — retrying automatically'
                  : `Xero returned ${xeroResult.status}`,
                status: xeroResult.status === 429 ? 'rate_limited_no_cache' : 'xero_error',
              },
            }), {
              status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          usingCacheFallback = true;
          allInvoices = cachedOutstanding.map((m: any) => ({
            InvoiceID: m.xero_invoice_id,
            InvoiceNumber: m.xero_invoice_number || null,
            Reference: m.matched_reference || (m.settlement_id ? `AMZN-${m.settlement_id}` : ''),
            Contact: { Name: m.matched_contact || m.marketplace_code || 'Marketplace' },
            Date: m.matched_date || null,
            DueDate: null,
            AmountDue: Math.abs(Number(m.matched_amount || 0)),
            Total: Math.abs(Number(m.matched_amount || 0)),
            CurrencyCode: 'AUD',
          }));
          console.log(`[fetch-outstanding] Last-resort fallback from xero_accounting_matches: ${allInvoices.length} invoices`);
        }
      }
    } else {
      // ─── Serve from cache (fresh, no Xero API call) ───
      const { data: cachedInvoices } = await supabase
        .from('outstanding_invoices_cache')
        .select('*')
        .eq('user_id', userId);

      if (cachedInvoices && cachedInvoices.length > 0) {
        allInvoices = cachedInvoices.map((c: any) => ({
          InvoiceID: c.xero_invoice_id,
          InvoiceNumber: c.invoice_number,
          Reference: c.reference || '',
          Contact: { Name: c.contact_name || 'Marketplace' },
          Date: c.date || null,
          DueDate: c.due_date || null,
          AmountDue: Number(c.amount_due || 0),
          Total: Number(c.total || 0),
          CurrencyCode: c.currency_code || 'AUD',
          Status: c.status,
        }));
        usingCacheFallback = true;
        console.log(`[fetch-outstanding] Serving ${allInvoices.length} invoices from fresh cache (${invoiceCacheAgeMinutes}m old)`);
      }
    }

    // ─── Pass ALL outstanding ACCREC invoices through — UI toggle controls marketplace vs all ───
    const invoices = allInvoices;

    // ─── Get user's settlements for matching (including already_recorded) ───
    // Include already_recorded because they exist in Xero and need reconciliation tracking
    // When force_recompute is true, scope to lookback window for bounded re-scan
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
    const lookbackDateStr = lookbackDate.toISOString().split('T')[0];

    let settlementQuery = supabase
      .from('settlements')
      .select('settlement_id, marketplace, period_start, period_end, bank_deposit, net_ex_gst, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, refunds, reimbursements, other_fees, gst_on_income, gst_on_expenses, status, source, bank_verified, bank_verified_amount, xero_journal_id, xero_status, xero_invoice_number, is_split_month, split_month_1_data, split_month_2_data, bank_tx_id, bank_match_method, bank_match_confidence, bank_match_confirmed_at, bank_match_confirmed_by')
      .eq('user_id', userId);

    if (forceRecompute) {
      settlementQuery = settlementQuery.gte('period_end', lookbackDateStr);
    }

    const { data: settlements } = await settlementQuery;

    const settlementMap = new Map<string, any>();
    const allSettlements = settlements || [];
    for (const s of allSettlements) {
      settlementMap.set(s.settlement_id, s);
    }

    // ─── Build marketplace-indexed settlement lists for fuzzy matching ───
    // Key: marketplace code → sorted settlements by period_end DESC
    const settlementsByMarketplace = new Map<string, any[]>();
    for (const s of allSettlements) {
      const mkt = (s.marketplace || 'unknown').toLowerCase();
      if (!settlementsByMarketplace.has(mkt)) settlementsByMarketplace.set(mkt, []);
      settlementsByMarketplace.get(mkt)!.push(s);
    }

    // ─── Also load aliases for cross-reference matching ───
    const { data: aliases } = await supabase
      .from('settlement_id_aliases')
      .select('alias_id, canonical_settlement_id')
      .eq('user_id', userId);
    
    const aliasMap = new Map<string, string>();
    for (const a of (aliases || [])) {
      aliasMap.set(a.alias_id, a.canonical_settlement_id);
    }

    // ─── Load pre-seeded cache from xero_accounting_matches ───
    const { data: preSeededMatches } = await supabase
      .from('xero_accounting_matches')
      .select('settlement_id, marketplace_code, xero_invoice_id, match_method, matched_amount, matched_date')
      .eq('user_id', userId)
      .eq('match_method', 'xero_pre_seed');

    const preSeededSet = new Set<string>();
    for (const m of (preSeededMatches || [])) {
      preSeededSet.add(m.settlement_id);
    }

    // ─── Universal fuzzy matcher: amount + date + marketplace ───
    // Falls back when reference-based extraction fails (Shopify, Bunnings, Kogan, etc.)
    const usedSettlementIds = new Set<string>(); // Prevent double-matching

    function fuzzyMatchSettlement(
      amount: number,
      invoiceDate: string | null,
      marketplace: string,
    ): any | null {
      const candidates = settlementsByMarketplace.get(marketplace);
      if (!candidates || !invoiceDate) return null;

      const invDateMs = new Date(invoiceDate).getTime();
      let bestMatch: any = null;
      let bestScore = 0;

      for (const s of candidates) {
        if (usedSettlementIds.has(s.settlement_id)) continue;

        const settlementAmount = Math.abs(s.bank_deposit || s.net_ex_gst || 0);
        const amountDiff = Math.abs(settlementAmount - amount);
        // Allow up to 5% or $50 tolerance (whichever is larger) for amount matching
        const amountTolerance = Math.max(amount * 0.05, 50);
        if (amountDiff > amountTolerance) continue;

        // Check date proximity: settlement period should overlap or be near invoice date
        const periodEnd = new Date(s.period_end).getTime();
        const periodStart = new Date(s.period_start).getTime();
        const daysDiffFromEnd = Math.abs(invDateMs - periodEnd) / (1000 * 60 * 60 * 24);
        const isWithinPeriod = invDateMs >= periodStart && invDateMs <= periodEnd;
        
        // Score: higher = better match
        let score = 0;
        if (amountDiff <= 0.05) score += 50;       // Exact amount
        else if (amountDiff <= 1.00) score += 40;   // Very close
        else if (amountDiff <= 10) score += 25;     // Close
        else score += 10;                           // Within tolerance

        if (isWithinPeriod) score += 30;            // Invoice date within settlement period
        else if (daysDiffFromEnd <= 3) score += 25; // Within 3 days of period end
        else if (daysDiffFromEnd <= 7) score += 15; // Within a week
        else if (daysDiffFromEnd <= 14) score += 5; // Within 2 weeks
        else continue;                              // Too far apart

        if (score > bestScore) {
          bestScore = score;
          bestMatch = s;
        }
      }

      // Require minimum score of 35 to match
      if (bestMatch && bestScore >= 35) {
        usedSettlementIds.add(bestMatch.settlement_id);
        return bestMatch;
      }
      return null;
    }

    // ─── Rail normalization helper ───
    const RAIL_ALIASES: Record<string, string> = { ebay_au: 'ebay' };
    function toRailCode(marketplace: string): string {
      const lower = marketplace.toLowerCase();
      return RAIL_ALIASES[lower] || lower;
    }

    // ─── Load destination account mappings (new-first, legacy-fallback) ───
    const DEST_PREFIX = 'payout_destination:';
    const DEST_DEFAULT = 'payout_destination:_default';
    const LEGACY_PREFIX = 'payout_account:';
    const LEGACY_DEFAULT = 'payout_account:_default';

    const [destSettingsResp, legacySettingsResp] = await Promise.all([
      supabase.from('app_settings').select('key, value').eq('user_id', userId).like('key', `${DEST_PREFIX}%`),
      supabase.from('app_settings').select('key, value').eq('user_id', userId).like('key', `${LEGACY_PREFIX}%`),
    ]);

    const destinationMappings: Record<string, string> = {};
    let defaultDestinationAccount: string | null = null;
    let mappingSourceUsed: 'new' | 'legacy' | 'none' = 'none';

    // Index new keys first
    for (const row of (destSettingsResp.data || [])) {
      if (row.key === DEST_DEFAULT) {
        defaultDestinationAccount = row.value;
        mappingSourceUsed = 'new';
      } else if (row.key.startsWith(DEST_PREFIX)) {
        const railCode = row.key.slice(DEST_PREFIX.length);
        if (railCode !== '_default') {
          destinationMappings[railCode] = row.value || '';
          mappingSourceUsed = 'new';
        }
      }
    }

    // Fallback to legacy keys if no new keys found
    if (!defaultDestinationAccount && Object.keys(destinationMappings).length === 0) {
      for (const row of (legacySettingsResp.data || [])) {
        if (row.key === LEGACY_DEFAULT) {
          defaultDestinationAccount = row.value;
          mappingSourceUsed = 'legacy';
        } else if (row.key.startsWith(LEGACY_PREFIX)) {
          const rawCode = row.key.slice(LEGACY_PREFIX.length);
          if (rawCode !== '_default') {
            const railCode = toRailCode(rawCode);
            destinationMappings[railCode] = row.value || '';
            mappingSourceUsed = 'legacy';
          }
        }
      }
    }

    const hasAnyMapping = !!defaultDestinationAccount || Object.keys(destinationMappings).length > 0;

    // Helper: get destination account for a rail
    function getDestinationAccount(rail: string): { account_id: string | null; source: string } {
      const normalised = toRailCode(rail);
      if (destinationMappings[normalised]) {
        return { account_id: destinationMappings[normalised], source: 'explicit' };
      }
      if (defaultDestinationAccount) {
        return { account_id: defaultDestinationAccount, source: 'default' };
      }
      // Check legacy with original code as last resort
      if (mappingSourceUsed === 'none') {
        return { account_id: null, source: 'missing' };
      }
      return { account_id: null, source: 'missing' };
    }

    // Build mapping diagnostics
    const { data: userConnections } = await supabase
      .from('marketplace_connections')
      .select('marketplace_code')
      .eq('user_id', userId)
      .eq('connection_status', 'active');
    
    const connectedCodes = (userConnections || []).map((c: any) => c.marketplace_code);
    const missingRails: string[] = [];
    const usedDefaultFor: string[] = [];
    for (const code of connectedCodes) {
      const rail = toRailCode(code);
      const mapping = getDestinationAccount(rail);
      if (mapping.source === 'missing') missingRails.push(rail);
      if (mapping.source === 'default') usedDefaultFor.push(rail);
    }

    const mappingStatus = {
      has_any_mapping: hasAnyMapping,
      mapping_source: mappingSourceUsed,
      missing_rails: missingRails,
      used_default_for: usedDefaultFor,
    };

    // ─── Build destination account name lookup ───
    const allMappedAccountIds = new Set<string>();
    if (defaultDestinationAccount) allMappedAccountIds.add(defaultDestinationAccount);
    for (const v of Object.values(destinationMappings)) {
      if (v) allMappedAccountIds.add(v);
    }
    const destinationAccountNames: Record<string, string> = {};
    if (allMappedAccountIds.size > 0) {
      const { data: coaRows } = await supabase
        .from('xero_chart_of_accounts')
        .select('xero_account_id, account_name')
        .eq('user_id', userId)
        .in('xero_account_id', [...allMappedAccountIds]);
      for (const row of (coaRows || [])) {
        if (row.xero_account_id) destinationAccountNames[row.xero_account_id] = row.account_name;
      }
      // Fallback: use bank_account_name from cached txns
      for (const id of allMappedAccountIds) {
        if (!destinationAccountNames[id]) {
          const txn = (cachedBankTxns || []).find((t: any) => t.bank_account_id === id);
          if (txn?.bank_account_name) destinationAccountNames[id] = txn.bank_account_name;
        }
      }
    }

    // ─── Per-destination bank feed diagnostics ───
    // Build a map: account_id → { has_txns, newest_fetched_at }
    const destinationBankDiag: Record<string, { has_txns: boolean; newest_fetched_at: string | null }> = {};
    for (const accountId of allMappedAccountIds) {
      const txnsForAccount = (cachedBankTxns || []).filter((t: any) => t.bank_account_id === accountId);
      const fetchedAts = txnsForAccount.map((t: any) => t.fetched_at).filter(Boolean).sort();
      destinationBankDiag[accountId] = {
        has_txns: txnsForAccount.length > 0,
        newest_fetched_at: fetchedAts.length > 0 ? fetchedAts[fetchedAts.length - 1] : null,
      };
    }
    // ─── Bank sync timestamp + cooldown diagnostics ───
    const { data: bankSyncRow } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'bank_txn_last_fetched_at')
      .maybeSingle();
    const bankSyncLastSuccessAt = bankSyncRow?.value || null;

    const { data: cooldownRow } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'xero_api_cooldown_until')
      .maybeSingle();
    let bankSyncCooldownUntil: string | null = null;
    let bankSyncCooldownSecondsRemaining: number | null = null;
    if (cooldownRow?.value) {
      const cdMs = new Date(cooldownRow.value).getTime();
      if (cdMs > Date.now()) {
        bankSyncCooldownUntil = cooldownRow.value;
        bankSyncCooldownSecondsRemaining = Math.max(1, Math.ceil((cdMs - Date.now()) / 1000));
      }
    }

    // ─── Get bank matches from cached bank_transactions table (populated by fetch-xero-bank-transactions every 30 min) ───
    // Use lookbackDays for bank txn window too (matches settlement scope)
    const bankLookbackDate = new Date();
    bankLookbackDate.setDate(bankLookbackDate.getDate() - lookbackDays);
    const bankLookbackStr = bankLookbackDate.toISOString().split('T')[0];

    // Only fetch bank txns if we have at least one mapping
    let cachedBankTxns: any[] | null = null;
    let bankCacheError: any = null;
    
    if (hasAnyMapping) {
      const bankQuery = await supabase
        .from('bank_transactions')
        .select('*')
        .eq('user_id', userId)
        .eq('transaction_type', 'RECEIVE')
        .gte('date', bankLookbackStr);
      cachedBankTxns = bankQuery.data;
      bankCacheError = bankQuery.error;
    }

    const bankCacheQueryError = !!bankCacheError;
    if (bankCacheError) {
      console.error('Bank cache query error:', bankCacheError);
    }

    const bankFeedEmpty = !cachedBankTxns || cachedBankTxns.length === 0;

    // Compute cache staleness from fetched_at timestamps
    const bankCacheNewestFetchedAt = cachedBankTxns && cachedBankTxns.length > 0
      ? new Date(Math.max(...cachedBankTxns.map((t: any) => new Date(t.fetched_at || t.created_at).getTime()))).toISOString()
      : null;
    const bankCacheStale = bankCacheNewestFetchedAt
      ? (Date.now() - new Date(bankCacheNewestFetchedAt).getTime()) > 24 * 60 * 60 * 1000
      : !bankFeedEmpty; // if empty, not "stale" — it's missing

    // Map cached rows to the shape downstream code expects (Xero BankTransaction format)
    const bankTxns = (cachedBankTxns || []).map((t: any) => ({
      BankTransactionID: t.xero_transaction_id,
      Total: t.amount,
      Date: t.date, // Already ISO date string from cache
      Reference: t.reference || '',
      Contact: { Name: t.contact_name || '' },
      LineItems: [{ Description: t.description || '' }],
      BankAccount: { Name: t.bank_account_name || '', AccountID: t.bank_account_id || '' },
      CurrencyCode: t.currency || 'AUD',
    }));

    console.log(`[fetch-outstanding] Bank cache: ${bankTxns.length} RECEIVE txns from ${bankLookbackStr}, empty=${bankFeedEmpty}`);

    // ─── Amazon aggregate deposit detection (SUGGESTION mode) ───
    // Nothing is marked as matched until user explicitly confirms.
    // Auto-detection is always a SUGGESTION.
    // Groups Amazon invoices by PAYOUT DATE WINDOW (not settlement period),
    // because Amazon deposits often cross settlement period boundaries.
    interface BankCandidate {
      transaction_id: string;
      amount: number;
      date: string;
      reference: string;
      narration: string;
      bank_account_name: string;
      confidence: 'high' | 'medium' | 'low';
      score: number;
      match_type: 'exact' | 'aggregate';
    }

    interface AggregateGroup {
      id: string;
      invoiceIds: string[];
      settlementIds: string[];
      sum: number;
      dates: string[];
      centreDate: Date;
      candidates: BankCandidate[];
    }

    const amazonInvoices = invoices.filter((inv: any) => {
      const contact = (inv.Contact?.Name || '').toLowerCase();
      const ref = (inv.Reference || '').toLowerCase();
      return ref.startsWith('amzn-') || ref.includes('amazon') || contact.includes('amazon') || ref.startsWith('lmb-');
    });

    // Sort by date
    const sortedAmazon = [...amazonInvoices].sort((a: any, b: any) => {
      const da = parseXeroDate(a.Date) || '';
      const db = parseXeroDate(b.Date) || '';
      return da.localeCompare(db);
    });

    // Group into 5-day payout windows
    const aggregateGroups: AggregateGroup[] = [];
    let currentGroup: AggregateGroup | null = null;

    for (const inv of sortedAmazon) {
      const invDate = parseXeroDate(inv.Date);
      if (!invDate) continue;
      const invDateMs = new Date(invDate).getTime();
      const amount = inv.AmountDue || inv.Total || 0;
      const ref = inv.Reference || '';
      const extracted = extractSettlementId(ref);

      if (!currentGroup || (invDateMs - currentGroup.centreDate.getTime()) > 5 * 24 * 60 * 60 * 1000) {
        currentGroup = {
          id: `agg_${invDate}_${aggregateGroups.length}`,
          invoiceIds: [inv.InvoiceID],
          settlementIds: extracted.id ? [extracted.id] : [],
          sum: amount,
          dates: [invDate],
          centreDate: new Date(invDateMs),
          candidates: [],
        };
        aggregateGroups.push(currentGroup);
      } else {
        currentGroup.invoiceIds.push(inv.InvoiceID);
        if (extracted.id) currentGroup.settlementIds.push(extracted.id);
        currentGroup.sum += amount;
        currentGroup.dates.push(invDate);
        const allMs = currentGroup.dates.map(d => new Date(d).getTime());
        const avgMs = allMs.reduce((a, b) => a + b, 0) / allMs.length;
        currentGroup.centreDate = new Date(avgMs);
      }
    }

    // Score bank transaction candidates for each aggregate group
    for (const group of aggregateGroups) {
      // Single-invoice groups still scored — must meet score ≥ 70 for 'high' confidence
      group.sum = Math.round(group.sum * 100) / 100;

      // Determine group currency from the first invoice (Amazon AU = AUD)
      const groupCurrency = 'AUD'; // Amazon AU invoices are always AUD

      for (const txn of bankTxns) {
        // Currency hard filter — prevent cross-currency false matches
        if ((txn.CurrencyCode || 'AUD') !== groupCurrency) continue;

        const txnAmount = Math.abs(txn.Total || 0);
        const txnDate = parseXeroDate(txn.Date);
        if (!txnDate) continue;

        const amountDiff = Math.abs(txnAmount - group.sum);
        if (amountDiff > 10) continue; // Wider net for candidates

        const daysDiff = Math.abs(
          (new Date(txnDate).getTime() - group.centreDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysDiff > 7) continue;

        const narration = `${txn.LineItems?.[0]?.Description || ''} ${txn.Contact?.Name || ''} ${txn.Reference || ''}`.toLowerCase();
        const narrationMatch = narration.includes('amazon') || narration.includes('amzn');

        // Score: higher = better
        let score = 0;
        if (amountDiff <= 0.05) score += 50;       // Exact amount
        else if (amountDiff <= 1.00) score += 30;   // Close amount
        else score += 10;                           // Within $10
        if (narrationMatch) score += 30;            // Narration bonus
        if (daysDiff <= 2) score += 20;             // Close date
        else if (daysDiff <= 5) score += 10;        // Within window

        const confidence: 'high' | 'medium' | 'low' =
          score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low';

        // Nothing is marked as matched until user explicitly confirms.
        // Auto-detection is always a SUGGESTION.
        group.candidates.push({
          transaction_id: txn.BankTransactionID,
          amount: txnAmount,
          date: txnDate,
          reference: txn.Reference || '',
          narration: txn.LineItems?.[0]?.Description || '',
          bank_account_name: txn.BankAccount?.Name || '',
          confidence,
          score,
          match_type: 'aggregate',
        });
      }

      // Sort by score descending, keep top 3
      group.candidates.sort((a, b) => b.score - a.score);
      group.candidates = group.candidates.slice(0, 3);
    }

    // Build lookup: invoiceId → aggregate group
    const aggregateLookup = new Map<string, AggregateGroup>();
    for (const group of aggregateGroups) {
      for (const invId of group.invoiceIds) {
        aggregateLookup.set(invId, group);
      }
    }

    // ─── Build result rows ───
    const rows: any[] = [];
    let totalOutstanding = 0;
    let matchedWithSettlement = 0;
    let bankDepositFound = 0;
    let readyToReconcile = 0;
    const missingSettlementIds: string[] = []; // Settlement IDs extracted from refs but not in DB

    for (const inv of invoices) {
      const reference = inv.Reference || '';
      const contactName = inv.Contact?.Name || '';
      const invoiceDate = parseXeroDate(inv.Date);
      const dueDate = parseXeroDate(inv.DueDate);
      const amount = inv.AmountDue || inv.Total || 0;
      const invoiceNumber = inv.InvoiceNumber || '';
      const invoiceId = inv.InvoiceID;

      totalOutstanding += amount;

      // Detect marketplace FIRST so fuzzy matching can use it
      const currencyCode = inv.CurrencyCode || 'AUD';
      const marketplace = detectMarketplace(reference, contactName, currencyCode);
      const isMarketplace = marketplace !== 'unknown';

      // Try to match with our settlement:
      // 1) Direct reference-based ID extraction (Amazon AMZN- references)
      // 2) Alias lookup (LMB- references, etc.)
      // 3) Fuzzy amount+date+marketplace match (Shopify, Bunnings, Kogan, etc.)
      const extracted = extractSettlementId(reference);
      let settlementId = extracted.id;
      const splitPart = extracted.part;
      let settlement = settlementId ? settlementMap.get(settlementId) : null;
      
      if (!settlement && settlementId) {
        const canonical = aliasMap.get(settlementId);
        if (canonical) settlement = settlementMap.get(canonical);
      }

      // Fallback: fuzzy match by amount + date + marketplace
      if (!settlement) {
        const fuzzyMatch = fuzzyMatchSettlement(amount, invoiceDate, marketplace);
        if (fuzzyMatch) {
          settlement = fuzzyMatch;
          settlementId = fuzzyMatch.settlement_id;
        }
      }
      
      // Mark reference-matched settlements as used to prevent double-matching
      if (settlement && settlementId) {
        usedSettlementIds.add(settlementId);
      }

      const hasSettlement = !!settlement;
      if (hasSettlement) matchedWithSettlement++;

      // Build settlement evidence
      let settlementEvidence: any = null;
      if (settlement) {
        let splitData = null;
        if (settlement.is_split_month && splitPart) {
          splitData = splitPart === 1 ? settlement.split_month_1_data : settlement.split_month_2_data;
          if (typeof splitData === 'string') splitData = JSON.parse(splitData);
        }

        settlementEvidence = {
          settlement_id: settlement.settlement_id,
          source: settlement.source,
          marketplace: settlement.marketplace,
          period_start: settlement.period_start,
          period_end: settlement.period_end,
          bank_deposit: settlement.bank_deposit,
          net_ex_gst: settlement.net_ex_gst,
          sales_principal: splitData?.salesPrincipal ?? settlement.sales_principal,
          seller_fees: splitData?.sellerFees ?? settlement.seller_fees,
          fba_fees: splitData?.fbaFees ?? settlement.fba_fees,
          refunds: splitData?.refunds ?? settlement.refunds,
          reimbursements: splitData?.reimbursements ?? settlement.reimbursements,
          gst_on_income: splitData?.gstOnIncome ?? settlement.gst_on_income,
          is_split_month: settlement.is_split_month,
          split_part: splitPart,
          split_net: splitData?.netExGst ?? null,
          bank_verified: settlement.bank_verified,
          xero_status: settlement.xero_status,
          xero_invoice_number: settlement.xero_invoice_number,
          status: settlement.status,
        };
      }

      // ─── Check if settlement already has a confirmed bank match ───
      const isConfirmed = settlement?.bank_tx_id && settlement?.bank_match_confirmed_at;

      // Try to find matching bank deposit (exact 1:1 for non-Amazon)
      let bankMatch: any = null;
      let bankDifference: number | null = null;

      // For confirmed matches, load the confirmed bank tx
      if (isConfirmed) {
        const confirmedTxn = bankTxns.find(t => t.BankTransactionID === settlement.bank_tx_id);
        if (confirmedTxn) {
          bankMatch = {
            amount: Math.abs(confirmedTxn.Total || 0),
            date: parseXeroDate(confirmedTxn.Date),
            reference: confirmedTxn.Reference || '',
            narration: confirmedTxn.LineItems?.[0]?.Description || '',
            transaction_id: confirmedTxn.BankTransactionID,
            confirmed: true,
          };
          bankDifference = 0;
        }
      }

      // ─── Unified scored 1:1 bank matcher (replaces exact + fuzzy paths) ───
      const marketplacePatterns: Record<string, string[]> = {
        amazon_au: ['amazon', 'amzn'],
        shopify_payments: ['shopify'],
        kogan: ['kogan'],
        bigw: ['big w', 'bigw'],
        bunnings: ['bunnings'],
        mydeal: ['mydeal'],
        catch: ['catch'],
        ebay_au: ['ebay'],
        everyday_market: ['woolworths', 'everyday', 'edm'],
      };

      if (!bankMatch && !isConfirmed && hasAnyMapping) {
        // Gate: only attempt bank matching when payout mappings exist
        const mappedAccount = getDestinationAccount(toRailCode(marketplace));
        
        let bestCandidate: any = null;
        let bestScore = 0;
        let bestDiff = Infinity;

        // Derive expected currency from invoice or marketplace
        const expectedCurrency = (inv as any).CurrencyCode || 'AUD';

        for (const txn of bankTxns) {
          // Currency hard filter — prevent cross-currency false matches
          if ((txn.CurrencyCode || 'AUD') !== expectedCurrency) continue;
          // Scope to mapped bank account (Rule 3)
          if (mappedAccount.account_id && txn.BankAccount?.AccountID && txn.BankAccount.AccountID !== mappedAccount.account_id) continue;

          const txnAmount = Math.abs(txn.Total || 0);
          const txnDate = parseXeroDate(txn.Date);
          if (!txnDate || !invoiceDate) continue;

          const amountDiff = Math.abs(txnAmount - amount);
          if (amountDiff > 10) continue; // Hard cap: $10 tolerance

          const daysDiff = Math.abs(
            (new Date(txnDate).getTime() - new Date(invoiceDate).getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysDiff > 7) continue;

          // Score: higher = better
          let score = 0;
          if (amountDiff <= 0.05) score += 50;       // Exact amount
          else if (amountDiff <= 1.00) score += 35;   // Very close
          else if (amountDiff <= 5) score += 20;      // Close
          else score += 10;                           // Within $10

          // Narration keyword scoring
          const narration = `${txn.LineItems?.[0]?.Description || ''} ${txn.Contact?.Name || ''} ${txn.Reference || ''}`.toLowerCase();
          const patterns = marketplacePatterns[marketplace] || [];
          if (patterns.some(p => narration.includes(p))) score += 30;

          // Date proximity scoring
          if (daysDiff <= 2) score += 20;
          else if (daysDiff <= 5) score += 10;

          if (score > bestScore) {
            bestScore = score;
            bestDiff = amountDiff;
            bestCandidate = txn;
          }
        }

        // Only populate bankMatch when score ≥ 70 (high confidence)
        if (bestCandidate && bestScore >= 70) {
          const isExact = bestDiff <= 0.05;
          bankMatch = {
            amount: Math.abs(bestCandidate.Total || 0),
            date: parseXeroDate(bestCandidate.Date),
            reference: bestCandidate.Reference || '',
            narration: bestCandidate.LineItems?.[0]?.Description || '',
            transaction_id: bestCandidate.BankTransactionID,
            fuzzy: !isExact,
            score: bestScore,
          };
          bankDifference = bestDiff;
        }
      }

      const hasBankDeposit = !!bankMatch;
      if (hasBankDeposit) bankDepositFound++;

      // ─── Aggregate candidates for Amazon (suggestions, not matches) ───
      const aggGroup = aggregateLookup.get(inv.InvoiceID);
      const hasCandidates = aggGroup && aggGroup.candidates.length > 0;

      // Determine match status
      let matchStatus: string;
      if (isConfirmed) {
        matchStatus = settlement.bank_match_method === 'manual' ? 'confirmed_manual' : 'confirmed';
        bankDepositFound++;
        readyToReconcile++;
      } else if (hasSettlement && hasBankDeposit && (bankDifference || 0) <= 0.05) {
        matchStatus = 'balanced';
        readyToReconcile++;
      } else if (hasSettlement && hasBankDeposit) {
        matchStatus = `gap_${bankDifference?.toFixed(2)}`;
      } else if (hasSettlement && hasCandidates) {
        matchStatus = aggGroup!.candidates.length === 1 && aggGroup!.candidates[0].confidence === 'high'
          ? 'suggestion_high' : 'suggestion_multiple';
      } else if (hasSettlement && !hasBankDeposit) {
        matchStatus = 'no_bank_deposit';
      } else if (!hasSettlement && marketplace === 'amazon_us') {
        // Amazon US invoices — marketplace not connected/supported
        matchStatus = 'unsupported_marketplace';
      } else if (!hasSettlement && hasBankDeposit) {
        matchStatus = 'no_settlement';
      } else if (!hasSettlement && settlementId && preSeededSet.has(settlementId)) {
        // Pre-seeded by sync-xero-status — settlement data is expected from API sync
        matchStatus = 'awaiting_sync';
      } else if (!hasSettlement && settlementId) {
        // Settlement ID extracted from reference but not found in DB — needs backfill
        matchStatus = 'settlement_not_ingested';
        if (!missingSettlementIds.includes(settlementId)) {
          missingSettlementIds.push(settlementId);
        }
      } else {
        matchStatus = 'no_settlement';
      }

      // Determine if pre-boundary
      // currencyCode already declared at line 661 — reuse it
      const isPreBoundary = accountingBoundary && invoiceDate && invoiceDate < accountingBoundary;

      rows.push({
        xero_invoice_id: invoiceId,
        xero_invoice_number: invoiceNumber,
        xero_reference: reference,
        contact_name: contactName,
        marketplace,
        is_marketplace: isMarketplace,
        invoice_date: invoiceDate,
        due_date: dueDate,
        amount,
        currency_code: currencyCode,
        is_pre_boundary: !!isPreBoundary,
        overdue_days: dueDate ? Math.max(0, Math.floor((Date.now() - new Date(dueDate).getTime()) / (1000 * 60 * 60 * 24))) : null,
        has_settlement: hasSettlement,
        settlement_id: settlementId,
        settlement_status: settlement?.status || null,
        settlement_evidence: settlementEvidence,
        has_bank_deposit: hasBankDeposit || isConfirmed,
        bank_match: bankMatch,
        bank_difference: bankDifference,
        match_status: matchStatus,
        // Aggregate candidate fields (suggestions, not confirmed matches)
        aggregate_group_id: aggGroup?.id || null,
        aggregate_sum: aggGroup ? aggGroup.sum : null,
        aggregate_settlement_count: aggGroup ? aggGroup.invoiceIds.length : null,
        aggregate_candidates: aggGroup?.candidates || [],
        // Confirmed match audit trail
        bank_match_method: settlement?.bank_match_method || null,
        bank_match_confidence: settlement?.bank_match_confidence || null,
        bank_match_confirmed_at: settlement?.bank_match_confirmed_at || null,
        // Routing diagnostics
        routing: (() => {
          const rail = toRailCode(marketplace);
          const dest = getDestinationAccount(rail);
          const diag = dest.account_id ? destinationBankDiag[dest.account_id] : null;
          const newestFetch = diag?.newest_fetched_at || null;
          const staleThreshold = 24 * 60 * 60 * 1000; // 24h
          return {
            rail_code: rail,
            destination_account_id: dest.account_id,
            destination_account_name: dest.account_id ? (destinationAccountNames[dest.account_id] || null) : null,
            mapping_source: dest.source,
            bank_feed_empty: diag ? !diag.has_txns : true,
            bank_cache_stale: newestFetch ? (Date.now() - new Date(newestFetch).getTime() > staleThreshold) : true,
            last_bank_refresh_at: newestFetch,
          };
        })(),
        // Recent bank transactions for manual picker — serve for ALL marketplaces, not just Amazon
        recent_bank_txns: matchStatus === 'no_bank_deposit' && isMarketplace
          ? bankTxns
              .filter(t => {
                const n = `${t.LineItems?.[0]?.Description || ''} ${t.Contact?.Name || ''} ${t.Reference || ''}`.toLowerCase();
                const patterns = marketplacePatterns[marketplace] || [];
                return patterns.some(p => n.includes(p));
              })
              .slice(0, 10)
              .map(t => ({
                transaction_id: t.BankTransactionID,
                amount: Math.abs(t.Total || 0),
                date: parseXeroDate(t.Date),
                reference: t.Reference || '',
                narration: t.LineItems?.[0]?.Description || '',
                bank_account_name: t.BankAccount?.Name || '',
              }))
          : [],
      });
    }

    // ─── Structured diagnostics log ───
    const bankDates = bankTxns.map((t: any) => parseXeroDate(t.Date)).filter(Boolean).sort();
    const syncInfo = {
      invoice_count: invoices.length,
      settlement_count_total: allSettlements.length,
      matched_settlement_count: matchedWithSettlement,
      bank_txn_count_cached: bankTxns.length,
      bank_feed_empty: bankFeedEmpty,
      bank_cache_range: bankDates.length > 0
        ? { min: bankDates[0], max: bankDates[bankDates.length - 1] }
        : null,
      bank_matches_count: bankDepositFound,
      candidates_generated: readyToReconcile,
      // Keep top-level source for UI backward compat (refers to invoice source)
      source: usingCacheFallback ? 'cache_fallback' : 'live_xero',
      // Explicit per-layer source labels (Condition 1)
      invoice_source: usingCacheFallback ? 'cache_fallback' : 'live_xero',
      bank_transactions_source: 'cache' as const,
      // Cache staleness diagnostics (Condition 3)
      bank_cache_last_refreshed_at: bankCacheNewestFetchedAt,
      bank_cache_stale: bankCacheStale,
      bank_cache_query_error: bankCacheQueryError,
      // Re-scan diagnostics
      lookback_days_effective: lookbackDays,
      force_recompute_used: forceRecompute,
      mapping_status: mappingStatus,
      missing_settlement_ids: missingSettlementIds,
      // Invoice cache diagnostics
      invoice_cache_age_minutes: invoiceCacheAgeMinutes,
      from_cache: usingCacheFallback,
      xero_rate_limited: usingCacheFallback && !cacheIsFresh,
      // Bank sync diagnostics
      bank_sync_last_success_at: bankSyncLastSuccessAt,
      bank_sync_cooldown_until: bankSyncCooldownUntil,
      bank_sync_cooldown_seconds_remaining: bankSyncCooldownSecondsRemaining,
    };

    console.log(JSON.stringify({
      event: 'fetch_outstanding_complete',
      user_id: userId.slice(0, 8),
      ...syncInfo,
    }));

    return new Response(JSON.stringify({
      success: true,
      source: usingCacheFallback ? 'cache_fallback' : 'live_xero',
      total_outstanding: totalOutstanding,
      invoice_count: invoices.length,
      matched_with_settlement: matchedWithSettlement,
      bank_deposit_found: bankDepositFound,
      ready_to_reconcile: readyToReconcile,
      sync_info: syncInfo,
      rows,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('fetch-outstanding error:', err);
    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
