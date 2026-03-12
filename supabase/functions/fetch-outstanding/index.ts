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
      // No Xero connection — return empty result instead of error
      return new Response(JSON.stringify({
        invoices: [],
        summary: { total_outstanding: 0, matched_with_settlement: 0, bank_deposit_found: 0, ready_to_reconcile: 0, total_invoices: 0 },
        aggregate_groups: [],
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

    // ─── Get user's settlements for matching (including bank match fields) ───
    const { data: settlements } = await supabase
      .from('settlements')
      .select('settlement_id, marketplace, period_start, period_end, bank_deposit, net_ex_gst, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, refunds, reimbursements, other_fees, gst_on_income, gst_on_expenses, status, source, bank_verified, bank_verified_amount, xero_journal_id, xero_status, xero_invoice_number, is_split_month, split_month_1_data, split_month_2_data, bank_tx_id, bank_match_method, bank_match_confidence, bank_match_confirmed_at, bank_match_confirmed_by')
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

    // ─── Load pre-seeded cache from xero_accounting_matches ───
    // When sync-xero-status pre-seeds outstanding invoices before settlement data arrives,
    // we can use this to show "Awaiting sync" instead of "No settlement"
    const { data: preSeededMatches } = await supabase
      .from('xero_accounting_matches')
      .select('settlement_id, marketplace_code, xero_invoice_id, match_method, matched_amount, matched_date')
      .eq('user_id', userId)
      .eq('match_method', 'xero_pre_seed');

    const preSeededSet = new Set<string>();
    for (const m of (preSeededMatches || [])) {
      preSeededSet.add(m.settlement_id);
    }

    // ─── Read Amazon rate-limit cooldown (for UI messaging) ───
    const { data: amazonRateLimitSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', 'amazon_rate_limit_until')
      .maybeSingle();

    const amazonRateLimitUntil = amazonRateLimitSetting?.value || null;
    const amazonRateLimited = !!amazonRateLimitUntil && new Date(amazonRateLimitUntil) > new Date();

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
      if (group.invoiceIds.length < 2) continue;
      group.sum = Math.round(group.sum * 100) / 100;

      for (const txn of bankTxns) {
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
      const splitPart = extracted.part;
      let settlement = settlementId ? settlementMap.get(settlementId) : null;
      
      if (!settlement && settlementId) {
        const canonical = aliasMap.get(settlementId);
        if (canonical) settlement = settlementMap.get(canonical);
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
      const marketplace = detectMarketplace(reference, contactName);
      const isMarketplace = marketplace !== 'unknown';
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

      // Only do auto-detection for non-confirmed
      if (!bankMatch) {
        for (const txn of bankTxns) {
          const txnAmount = Math.abs(txn.Total || 0);
          const txnDate = parseXeroDate(txn.Date);
          const amountDiff = Math.abs(txnAmount - amount);

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
      }

      // Fuzzy match for non-confirmed, non-Amazon
      if (!bankMatch && !isConfirmed) {
        for (const txn of bankTxns) {
          const txnAmount = Math.abs(txn.Total || 0);
          const txnDate = parseXeroDate(txn.Date);
          const amountDiff = Math.abs(txnAmount - amount);
          const narration = `${txn.LineItems?.[0]?.Description || ''} ${txn.Contact?.Name || ''}`.toLowerCase();

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
      } else if (!hasSettlement && hasBankDeposit) {
        matchStatus = 'no_settlement';
      } else if (!hasSettlement && settlementId && preSeededSet.has(settlementId)) {
        // Pre-seeded by sync-xero-status — settlement data is expected from API sync
        matchStatus = 'awaiting_sync';
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
        // Recent bank transactions for manual picker
        recent_bank_txns: matchStatus === 'no_bank_deposit' && marketplace === 'amazon_au'
          ? bankTxns
              .filter(t => {
                const n = `${t.LineItems?.[0]?.Description || ''} ${t.Contact?.Name || ''} ${t.Reference || ''}`.toLowerCase();
                return n.includes('amazon') || n.includes('amzn');
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
