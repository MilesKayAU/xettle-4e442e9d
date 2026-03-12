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
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0];
  const ts = parseInt(raw);
  if (!isNaN(ts)) return new Date(ts).toISOString().split('T')[0];
  return raw.split('T')[0];
}

function extractSettlementId(reference: string): { id: string | null; part: number | null } {
  if (reference.startsWith('Xettle-')) {
    const partMatch = reference.match(/-P([12])$/);
    return { id: reference.slice(7).replace(/-P[12]$/, ''), part: partMatch ? parseInt(partMatch[1]) : null };
  }
  if (reference.startsWith('AMZN-')) return { id: reference.slice(5), part: null };
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

function detectMarketplace(reference: string, contactName: string): string {
  const ref = reference.toLowerCase();
  const contact = contactName.toLowerCase();
  if (ref.startsWith('amzn-') || ref.includes('amazon') || contact.includes('amazon')) return 'amazon_au';
  if (ref.includes('shopify') || contact.includes('shopify')) return 'shopify_payments';
  if (contact.includes('kogan')) return 'kogan';
  if (contact.includes('big w') || contact.includes('bigw')) return 'bigw';
  if (contact.includes('bunnings')) return 'bunnings';
  if (contact.includes('mydeal') || contact.includes('my deal')) return 'mydeal';
  if (contact.includes('catch')) return 'catch';
  if (contact.includes('ebay')) return 'ebay_au';
  if (ref.startsWith('lmb-')) return 'amazon_au';
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Xero token
    const { data: tokens } = await supabase
      .from('xero_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!tokens?.length) {
      return new Response(JSON.stringify({ error: 'No Xero connection' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    // ─── Fetch ALL outstanding sales invoices (ACCREC) from Xero ───
    // No boundary filter — outstanding invoices must always be visible regardless of accounting boundary
    const invoiceWhere = encodeURIComponent(`Type=="ACCREC"`);
    const url = `https://api.xero.com/api.xro/2.0/Invoices?Statuses=DRAFT,AUTHORISED&where=${invoiceWhere}&order=Date DESC`;
    const xeroResp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id,
      },
    });

    if (!xeroResp.ok) {
      const errText = await xeroResp.text();
      console.error('Xero invoice fetch failed:', xeroResp.status, errText);
      return new Response(JSON.stringify({ error: 'Failed to fetch Xero invoices', detail: errText.substring(0, 500) }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const xeroData = await xeroResp.json();
    const allInvoices = xeroData.Invoices || [];

    // ─── Filter to known marketplace contacts only ───
    const MARKETPLACE_CONTACT_PATTERNS = [
      'amazon', 'shopify', 'ebay', 'catch', 'kogan', 'bigw', 'big w',
      'everyday market', 'mydeal', 'bunnings', 'woolworths', 'mirakl',
      'tradesquare', 'temu', 'walmart',
    ];

    const invoices = allInvoices.filter((inv: any) => {
      const contact = (inv.Contact?.Name || '').toLowerCase();
      return MARKETPLACE_CONTACT_PATTERNS.some(p => contact.includes(p));
    });

    // ─── Get user's settlements for matching ───
    const { data: settlements } = await supabase
      .from('settlements')
      .select('settlement_id, marketplace, period_start, period_end, bank_deposit, net_ex_gst, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, refunds, reimbursements, other_fees, gst_on_income, gst_on_expenses, status, source, bank_verified, bank_verified_amount, xero_journal_id, xero_status, xero_invoice_number, is_split_month, split_month_1_data, split_month_2_data')
      .eq('user_id', userId);

    const settlementMap = new Map<string, any>();
    for (const s of (settlements || [])) {
      settlementMap.set(s.settlement_id, s);
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

    // ─── Get bank matches from Xero (RECEIVE transactions from last 90 days) ───
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const [y, m, d] = ninetyDaysAgo.toISOString().split('T')[0].split('-');
    const bankWhere = `Type=="RECEIVE" AND Date>=DateTime(${y}, ${m}, ${d})`;

    let bankTxns: any[] = [];
    try {
      const bankUrl = `https://api.xero.com/api.xro/2.0/BankTransactions?where=${encodeURIComponent(bankWhere)}`;
      const bankResp = await fetch(bankUrl, {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': token.tenant_id,
        },
      });
      if (bankResp.ok) {
        const bankData = await bankResp.json();
        bankTxns = bankData?.BankTransactions || [];
      }
    } catch (e) {
      console.error('Bank txn fetch error:', e);
    }

    // ─── Build result rows ───
    const rows: any[] = [];
    let totalOutstanding = 0;
    let matchedWithSettlement = 0;
    let bankDepositFound = 0;
    let readyToReconcile = 0;

    for (const inv of invoices) {
      const reference = inv.Reference || '';
      const contactName = inv.Contact?.Name || '';
      const invoiceDate = parseXeroDate(inv.Date);
      const dueDate = parseXeroDate(inv.DueDate);
      const amount = inv.AmountDue || inv.Total || 0;
      const invoiceNumber = inv.InvoiceNumber || '';
      const invoiceId = inv.InvoiceID;

      totalOutstanding += amount;

      // Try to match with our settlement (direct ID, then alias lookup)
      const extracted = extractSettlementId(reference);
      const settlementId = extracted.id;
      const splitPart = extracted.part; // 1 or 2 for LMB/Xettle split-month refs
      let settlement = settlementId ? settlementMap.get(settlementId) : null;
      
      // Try alias lookup if direct match failed
      if (!settlement && settlementId) {
        const canonical = aliasMap.get(settlementId);
        if (canonical) settlement = settlementMap.get(canonical);
      }
      
      const hasSettlement = !!settlement;
      if (hasSettlement) matchedWithSettlement++;

      // Build settlement evidence for the UI
      let settlementEvidence: any = null;
      if (settlement) {
        // For split-month settlements, show the relevant part's data
        let splitData = null;
        if (settlement.is_split_month && splitPart) {
          splitData = splitPart === 1 ? settlement.split_month_1_data : settlement.split_month_2_data;
          if (typeof splitData === 'string') splitData = JSON.parse(splitData);
        }

        settlementEvidence = {
          settlement_id: settlement.settlement_id,
          source: settlement.source, // 'api', 'manual', 'csv'
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

      // Try to find matching bank deposit
      const marketplace = detectMarketplace(reference, contactName);
      const isMarketplace = marketplace !== 'unknown';
      let bankMatch: any = null;
      let bankDifference: number | null = null;

      for (const txn of bankTxns) {
        const txnAmount = Math.abs(txn.Total || 0);
        const txnDate = parseXeroDate(txn.Date);
        const amountDiff = Math.abs(txnAmount - amount);

        // Match within $0.05 and ±3 days
        if (amountDiff <= 0.05 && txnDate && invoiceDate) {
          const daysDiff = Math.abs(
            (new Date(txnDate).getTime() - new Date(invoiceDate).getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysDiff <= 7) {
            bankMatch = {
              amount: txnAmount,
              date: txnDate,
              reference: txn.Reference || '',
              narration: txn.LineItems?.[0]?.Description || '',
              transaction_id: txn.BankTransactionID,
            };
            bankDifference = amountDiff;
            break;
          }
        }
      }

      // Also check fuzzy bank match (within $10)
      if (!bankMatch) {
        for (const txn of bankTxns) {
          const txnAmount = Math.abs(txn.Total || 0);
          const txnDate = parseXeroDate(txn.Date);
          const amountDiff = Math.abs(txnAmount - amount);
          const narration = `${txn.LineItems?.[0]?.Description || ''} ${txn.Contact?.Name || ''}`.toLowerCase();

          // Check if narration mentions the marketplace
          const marketplacePatterns: Record<string, string[]> = {
            amazon_au: ['amazon', 'amzn'],
            shopify_payments: ['shopify'],
            kogan: ['kogan'],
            bigw: ['big w', 'bigw'],
            bunnings: ['bunnings'],
            mydeal: ['mydeal'],
            catch: ['catch'],
            ebay_au: ['ebay'],
          };

          const patterns = marketplacePatterns[marketplace] || [];
          const narrationMatch = patterns.some(p => narration.includes(p));

          if (amountDiff <= 10 && narrationMatch && txnDate) {
            bankMatch = {
              amount: txnAmount,
              date: txnDate,
              reference: txn.Reference || '',
              narration: txn.LineItems?.[0]?.Description || '',
              transaction_id: txn.BankTransactionID,
              fuzzy: true,
            };
            bankDifference = amountDiff;
            break;
          }
        }
      }

      const hasBankDeposit = !!bankMatch;
      if (hasBankDeposit) bankDepositFound++;

      // Determine match status
      let matchStatus: string;
      if (hasSettlement && hasBankDeposit && (bankDifference || 0) <= 0.05) {
        matchStatus = 'balanced';
        readyToReconcile++;
      } else if (hasSettlement && hasBankDeposit) {
        matchStatus = `gap_${bankDifference?.toFixed(2)}`;
      } else if (hasSettlement && !hasBankDeposit) {
        matchStatus = 'no_bank_deposit';
      } else if (!hasSettlement && hasBankDeposit) {
        matchStatus = 'no_settlement';
      } else {
        matchStatus = 'no_settlement';
      }

      // Determine if pre-boundary
      const currencyCode = inv.CurrencyCode || 'AUD';
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
        has_bank_deposit: hasBankDeposit,
        bank_match: bankMatch,
        bank_difference: bankDifference,
        match_status: matchStatus,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      total_outstanding: totalOutstanding,
      invoice_count: invoices.length,
      matched_with_settlement: matchedWithSettlement,
      bank_deposit_found: bankDepositFound,
      ready_to_reconcile: readyToReconcile,
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
