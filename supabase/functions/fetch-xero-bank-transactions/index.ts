// ══════════════════════════════════════════════════════════════
// fetch-xero-bank-transactions
// Ingests RECEIVE bank transactions from Xero into local cache.
// Two modes:
//   1. "self" — user-scoped, called from frontend with user JWT
//   2. "batch" — service-role only, called by scheduled-sync
// Never creates accounting entries.
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-action',
}

// ── Keys ──
const COOLDOWN_KEY = 'xero_bank_api_cooldown_until';      // Bank feed cooldown only (set on BankTransactions 429)
const LAST_SUCCESS_KEY = 'bank_feed_last_success_at';      // Set ONLY after real Xero fetch completes (no 429)
const GUARD_MINUTES_BATCH = 30;
const GUARD_MINUTES_SELF = 2;
const CACHE_FRESH_MINUTES_BATCH = 60;
const CACHE_FRESH_MINUTES_SELF = 15;
const LOOKBACK_DAYS_BATCH = 60;
const LOOKBACK_DAYS_SELF = 30;

// formatXeroDateTime removed — no longer used after switching to If-Modified-Since header

type XeroRequestLedgerEntry = {
  timestamp: string;
  function_name: string;
  invoker: string;
  endpoint: string;
  account_id: string | null;
  response_code: number;
  retry_number: number;
  from_wrapper_retry_logic: boolean;
};

async function refreshXeroToken(
  supabase: any,
  userId: string,
  clientId: string,
  clientSecret: string,
  trackRequest?: (entry: XeroRequestLedgerEntry) => void,
  invoker: string = 'unknown',
) {
  // Optimistic locking: re-read token immediately before refresh
  const { data: tokenRow, error } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !tokenRow) return null;

  const expiresAt = new Date(tokenRow.expires_at);
  if (expiresAt > new Date(Date.now() + 60000)) return tokenRow;

  const timestamp = new Date().toISOString();
  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
    }),
  });

  trackRequest?.({
    timestamp,
    function_name: 'fetch-xero-bank-transactions',
    invoker,
    endpoint: 'identity.xero.com/connect/token',
    account_id: null,
    response_code: res.status,
    retry_number: 0,
    from_wrapper_retry_logic: false,
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => 'unknown');
    console.error(`[refreshXeroToken] Token refresh failed for user ${userId}: ${res.status} ${errorBody}`);
    throw new Error(`Xero token refresh failed (${res.status}): ${errorBody}`);
  }
  const tokens = await res.json();
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString();

  await supabase.from('xero_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || tokenRow.refresh_token,
    expires_at: newExpiry,
  }).eq('user_id', userId);

  return { ...tokenRow, access_token: tokens.access_token };
}

/** Parse Retry-After header: integer seconds or HTTP-date. Clamped to 5..300s. */
function parseRetryAfterSeconds(header: string | null): number {
  const DEFAULT = 60;
  const MIN = 5;
  const MAX = 300;
  if (!header) return DEFAULT;
  const asInt = parseInt(header, 10);
  if (!isNaN(asInt) && String(asInt) === header.trim()) {
    return Math.max(MIN, Math.min(MAX, asInt));
  }
  // Try HTTP-date
  const dateMs = Date.parse(header);
  if (!isNaN(dateMs)) {
    const secondsUntil = Math.ceil((dateMs - Date.now()) / 1000);
    return Math.max(MIN, Math.min(MAX, secondsUntil));
  }
  return DEFAULT;
}

/** Compute dynamic date range from outstanding invoices cache. Returns {fromDate, toDate} or null.
 *  Uses asymmetric padding: -7 days before earliest, +21 days after latest
 *  to cover marketplace payout delays (especially Amazon). Capped at 90 days total. */
async function computeDateRangeFromCache(adminSupabase: any, userId: string, padBeforeDays: number = 7, padAfterDays: number = 21): Promise<{ fromDate: Date; toDate: Date; invoiceCount: number } | null> {
  const { data: invoices, error } = await adminSupabase
    .from('outstanding_invoices_cache')
    .select('date, due_date')
    .eq('user_id', userId);

  if (error || !invoices || invoices.length === 0) return null;

  let earliest = Infinity;
  let latest = -Infinity;

  for (const inv of invoices) {
    // Consider both invoice date and due date to cover the full window
    for (const d of [inv.date, inv.due_date]) {
      if (!d) continue;
      const ms = new Date(d).getTime();
      if (isNaN(ms)) continue;
      if (ms < earliest) earliest = ms;
      if (ms > latest) latest = ms;
    }
  }

  if (earliest === Infinity || latest === -Infinity) return null;

  const fromDate = new Date(earliest - padBeforeDays * 86400000);
  const toDate = new Date(latest + padAfterDays * 86400000);

  // Cap toDate at today + padAfterDays (don't query future beyond reason)
  const maxDate = new Date(Date.now() + padAfterDays * 86400000);
  if (toDate > maxDate) toDate.setTime(maxDate.getTime());

  // Cap total range to 90 days max
  const MAX_RANGE_MS = 90 * 86400000;
  if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_MS) {
    fromDate.setTime(toDate.getTime() - MAX_RANGE_MS);
  }

  return { fromDate, toDate, invoiceCount: invoices.length };
}

async function fetchBankTxnsForUser(
  adminSupabase: any,
  userId: string,
  clientId: string,
  clientSecret: string,
  guardMinutes: number,
  cacheFreshMinutes: number,
  fallbackLookbackDays: number,
  invoker: string,
) {
  // ══════════════════════════════════════════════════════════════
  // STEP 1 — Gather facts for guard evaluation (single parallel batch)
  // ══════════════════════════════════════════════════════════════
  const DEST_PREFIX = 'payout_destination:';
  const LEGACY_PREFIX = 'payout_account:';

  const [
    { data: cooldownRow },
    { count: cachedBankRowsRaw },
    { data: lastSuccessRow },
    destResp,
    legacyResp,
  ] = await Promise.all([
    adminSupabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', COOLDOWN_KEY)
      .maybeSingle(),
    adminSupabase
      .from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
    adminSupabase
      .from('app_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', LAST_SUCCESS_KEY)
      .maybeSingle(),
    adminSupabase
      .from('app_settings')
      .select('key, value')
      .eq('user_id', userId)
      .like('key', `${DEST_PREFIX}%`),
    adminSupabase
      .from('app_settings')
      .select('key, value')
      .eq('user_id', userId)
      .like('key', `${LEGACY_PREFIX}%`),
  ]);

  const mappedAccountIds = new Set<string>();
  const destRows = destResp.data || [];
  const legacyRows = legacyResp.data || [];

  // Prefer new keys
  if (destRows.length > 0) {
    for (const row of destRows) {
      if (row.value) mappedAccountIds.add(row.value);
    }
  } else {
    // Fallback to legacy
    for (const row of legacyRows) {
      if (row.value) mappedAccountIds.add(row.value);
    }
  }

  const hasAnyMapping = destRows.length > 0 || legacyRows.length > 0;

  const cachedBankRowsTotal = cachedBankRowsRaw ?? 0;
  const lastSuccessfulBankSyncAt: string | null = lastSuccessRow?.value ?? null;
  const cooldownUntilStored: string | null = cooldownRow?.value ?? null;
  const nowMs = Date.now();

  // Shared diagnostics skeleton (returned on every path)
  const baseDiag = {
    cached_bank_rows_total: cachedBankRowsTotal,
    last_successful_bank_sync_at: lastSuccessfulBankSyncAt,
    cooldown_until: cooldownUntilStored,
    mapped_account_ids_count: mappedAccountIds.size,
    has_any_mapping: hasAnyMapping,
  };

  const outboundRequestLedger: XeroRequestLedgerEntry[] = [];
  const buildRequestAudit = () => {
    const idx429 = outboundRequestLedger.findIndex((entry) => entry.response_code === 429);
    return {
      xero_request_count: outboundRequestLedger.length,
      xero_calls_made: outboundRequestLedger.length,
      xero_endpoints_hit: [...new Set(outboundRequestLedger.map((entry) => entry.endpoint))],
      retry_attempts: outboundRequestLedger.filter((entry) => entry.from_wrapper_retry_logic).length,
      xero_wrapper_retry_attempts: outboundRequestLedger.filter((entry) => entry.from_wrapper_retry_logic).length,
      '429_received_on_request_number': idx429 >= 0 ? idx429 + 1 : null,
      outbound_request_ledger: outboundRequestLedger,
    };
  };

  // ══════════════════════════════════════════════════════════════
  // STEP 2A — Xero 429 cooldown (always respected, never extended on skip)
  // ══════════════════════════════════════════════════════════════
  if (cooldownUntilStored) {
    const cooldownUntilMs = new Date(cooldownUntilStored).getTime();
    if (!isNaN(cooldownUntilMs) && cooldownUntilMs > nowMs) {
      const secondsRemaining = Math.max(1, Math.ceil((cooldownUntilMs - nowMs) / 1000));
      const clampedRetry = Math.max(5, Math.min(300, secondsRemaining));
      console.log(`[fetch-bank-txns] Xero cooldown active for ${userId}: ${clampedRetry}s remaining`);
      // DO NOT write/extend cooldown here — just return skipped
      return {
        user_id: userId,
        skipped: true,
        skip_reason: 'cooldown',
        stopped_reason: 'cooldown',
        xero_rate_limited: false,
        cooldown_applied: true,
        cooldown_key_used: COOLDOWN_KEY,
        cooldown_active: true,
        live_xero_call_attempted: false,
        live_xero_429_received: false,
        recent_success_guard_applied: false,
        xero_api_cooldown_until: cooldownUntilStored,
        retry_after_seconds: clampedRetry,
        pages_fetched: 0,
        transactions_seen_total: 0,
        transactions_seen: 0,
        transactions_in_range: 0,
        fetch_from: null,
        fetch_to: null,
        invoice_range_days: null,
        mapped_account_ids_count: mappedAccountIds.size,
        has_any_mapping: hasAnyMapping,
        ...buildRequestAudit(),
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 2B — Observe recent success (final skip decision happens per-account)
  // ══════════════════════════════════════════════════════════════
  if (cachedBankRowsTotal > 0 && lastSuccessfulBankSyncAt) {
    const lastSuccessMs = new Date(lastSuccessfulBankSyncAt).getTime();
    if (!isNaN(lastSuccessMs)) {
      const minutesSinceSuccess = (nowMs - lastSuccessMs) / 60000;
      if (minutesSinceSuccess < guardMinutes) {
        console.log(`[fetch-bank-txns] Recent success (${Math.round(minutesSinceSuccess)}m ago); applying change-detection checks before deciding to skip`);
      }
    }
  } else if (cachedBankRowsTotal === 0) {
    console.log(`[fetch-bank-txns] Cache empty for ${userId} — bypassing recent-success skips to seed cache`);
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 3 — Refresh Xero token (catch throw → structured error)
  // ══════════════════════════════════════════════════════════════
  let token: any;
  try {
    token = await refreshXeroToken(
      adminSupabase,
      userId,
      clientId,
      clientSecret,
      (entry) => outboundRequestLedger.push(entry),
      invoker,
    );
  } catch (tokenErr: any) {
    console.error(`[fetch-bank-txns] Token refresh threw for ${userId}:`, tokenErr.message);
    token = null;
  }
  if (!token) {
    return {
      user_id: userId,
      error: 'Token refresh failed',
      skip_reason: null,
      stopped_reason: 'token_refresh_failed',
      xero_rate_limited: false,
      cooldown_applied: false,
      cooldown_key_used: COOLDOWN_KEY,
      cooldown_active: false,
      live_xero_call_attempted: false,
      live_xero_429_received: false,
      recent_success_guard_applied: false,
      xero_api_cooldown_until: cooldownUntilStored,
      pages_fetched: 0,
      transactions_seen_total: 0,
      transactions_seen: 0,
      transactions_in_range: 0,
      fetch_from: null,
      fetch_to: null,
      invoice_range_days: null,
      mapped_account_ids_count: 0,
      ...baseDiag,
      ...buildRequestAudit(),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 4 — Compute date range: deterministic seed vs incremental
  // Seed mode (cache empty): fixed 90-day window regardless of invoice cache
  // Incremental mode (cache seeded): max(date) - 7 days overlap → today + 21 days
  // ══════════════════════════════════════════════════════════════
  const SEED_LOOKBACK_DAYS = 90;
  const INCREMENTAL_OVERLAP_DAYS = 7;
  const INCREMENTAL_FORWARD_DAYS = 21;

  let fromDate: Date;
  let toDate: Date;
  let dateRangeSource: string;
  let effectiveDays: number;
  let usedInvoiceRange = false;
  let syncMode: 'seed' | 'incremental';

  if (cachedBankRowsTotal === 0) {
    // ── SEED MODE: cache is empty, fetch a wide deterministic window ──
    syncMode = 'seed';
    // Try invoice-driven range first for smarter coverage
    const dynamicRange = await computeDateRangeFromCache(adminSupabase, userId, 5);
    if (dynamicRange) {
      fromDate = dynamicRange.fromDate;
      toDate = dynamicRange.toDate;
      usedInvoiceRange = true;
      dateRangeSource = `seed_invoice (${dynamicRange.invoiceCount} invoices)`;
    } else {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - SEED_LOOKBACK_DAYS);
      toDate = new Date(Date.now() + INCREMENTAL_FORWARD_DAYS * 86400000);
      dateRangeSource = `seed_fallback (${SEED_LOOKBACK_DAYS} days)`;
    }
    effectiveDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86400000);
    console.log(`[fetch-bank-txns] SEED mode for ${userId}: ${fromDate.toISOString().split('T')[0]} → ${toDate.toISOString().split('T')[0]} (${effectiveDays} days, ${dateRangeSource})`);
  } else {
    // ── INCREMENTAL MODE: start from max(date) - overlap ──
    syncMode = 'incremental';
    const { data: maxDateRow } = await adminSupabase
      .from('bank_transactions')
      .select('date')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(1)
      .single();

    const maxCachedDate = maxDateRow?.date ? new Date(maxDateRow.date) : null;
    if (maxCachedDate && !isNaN(maxCachedDate.getTime())) {
      fromDate = new Date(maxCachedDate.getTime() - INCREMENTAL_OVERLAP_DAYS * 86400000);
    } else {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - fallbackLookbackDays);
    }
    toDate = new Date(Date.now() + INCREMENTAL_FORWARD_DAYS * 86400000);
    effectiveDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / 86400000);
    dateRangeSource = `incremental (from max_date - ${INCREMENTAL_OVERLAP_DAYS}d)`;
    console.log(`[fetch-bank-txns] INCREMENTAL mode for ${userId}: ${fromDate.toISOString().split('T')[0]} → ${toDate.toISOString().split('T')[0]} (${effectiveDays} days)`);
  }

  // Destination account mappings were loaded in Step 1 (for accurate cooldown diagnostics).

  // ── CRITICAL: If no mapped accounts, do NOT call Xero at all ──
  if (mappedAccountIds.size === 0) {
    console.log(`[fetch-bank-txns] No destination accounts mapped for ${userId} — skipping Xero API call`);
    return {
      user_id: userId,
      skipped: true,
      skip_reason: 'no_mapping',
      stopped_reason: 'no_mapping',
      xero_rate_limited: false,
      cooldown_applied: false,
      cooldown_key_used: COOLDOWN_KEY,
      cooldown_active: false,
      live_xero_call_attempted: false,
      live_xero_429_received: false,
      recent_success_guard_applied: false,
      xero_api_cooldown_until: cooldownUntilStored,
      message: 'No destination account mapped. Configure payout mapping first.',
      bank_rows_upserted: 0,
      synced_row_count: 0,
      mapped_account_ids_count: 0,
      has_any_mapping: false,
      used_invoice_range: usedInvoiceRange,
      invoice_range_days: effectiveDays,
      fetch_from: fromDate.toISOString().split('T')[0],
      fetch_to: toDate?.toISOString().split('T')[0] || null,
      endpoint_used: 'BankTransactions?bankAccountID=... (If-Modified-Since DISABLED)',
      if_modified_since_used: false,
      if_modified_since_value: null,
      pages_fetched: 0,
      transactions_seen_total: 0,
      transactions_seen: 0,
      transactions_in_range: 0,
      date_range_source: dateRangeSource,
      ...baseDiag,
      ...buildRequestAudit(),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 5 — Per-account change detection + strict scoped paging
  // ══════════════════════════════════════════════════════════════
  const MAX_PAGES_PER_ACCOUNT = 5;
  const ifModifiedSinceValue = fromDate.toISOString();
  const fetchFromDate = fromDate.toISOString().split('T')[0];
  const fetchToDate = toDate ? toDate.toISOString().split('T')[0] : null;
  const rangeSignature = `${fetchFromDate}|${fetchToDate ?? 'open'}`;
  const cacheFreshMs = cacheFreshMinutes * 60000;

  const accountIds = [...mappedAccountIds];
  const accountSettingKeys = accountIds.flatMap((accountId) => [
    `bank_feed_last_fetched_at:${accountId}`,
    `bank_feed_last_success_at:${accountId}`,
    `bank_feed_last_seen_updated_utc:${accountId}`,
    `bank_feed_last_range:${accountId}`,
  ]);

  const accountSettingsQuery = accountSettingKeys.length > 0
    ? await adminSupabase
        .from('app_settings')
        .select('key, value')
        .eq('user_id', userId)
        .in('key', accountSettingKeys)
    : { data: [], error: null };

  const accountSettingsMap = new Map<string, string>();
  for (const row of (accountSettingsQuery.data || [])) {
    if (row?.key && row?.value) accountSettingsMap.set(row.key, row.value);
  }

  const parseXeroTxnDate = (rawDateInput: string | undefined): string | null => {
    const rawDate = rawDateInput?.replace('/Date(', '').replace(')/', '').split('+')[0];
    if (!rawDate) return null;
    const ts = parseInt(rawDate);
    if (isNaN(ts)) return null;
    return new Date(ts).toISOString().split('T')[0];
  };

  const parseXeroTxnTimestamp = (rawDateInput: string | undefined): string | null => {
    const rawDate = rawDateInput?.replace('/Date(', '').replace(')/', '').split('+')[0];
    if (!rawDate) return null;
    const ts = parseInt(rawDate);
    if (isNaN(ts)) return null;
    return new Date(ts).toISOString();
  };

  // Server-side date filter. No type filter — ingest all types, filter during matching.
  // This ensures TRANSFER/SPEND payouts are captured in cache for broader matching.
  const fromYear = fromDate.getFullYear();
  const fromMonth = fromDate.getMonth() + 1;
  const fromDay = fromDate.getDate();
  let whereClause = `Date >= DateTime(${fromYear},${fromMonth},${fromDay})`;
  if (toDate) {
    const toYear = toDate.getFullYear();
    const toMonth = toDate.getMonth() + 1;
    const toDay = toDate.getDate();
    whereClause += ` AND Date <= DateTime(${toYear},${toMonth},${toDay})`;
  }

  let totalUpserted = 0;
  let totalPagesFetched = 0;
  let totalTransactionsSeen = 0;
  let totalTransactionsInRange = 0;
  let performedRealXeroFetch = false;
  let accountsSkippedByChangeDetection = 0;

  const bankAccountIdsUsed: string[] = [];
  const bankAccountNamesUsed: Record<string, string> = {};

  // Pre-seed account names from local cache so diagnostics always show names
  // even when Xero returns 0 txns or 429s before any data arrives
  if (accountIds.length > 0) {
    const { data: cachedNames } = await adminSupabase
      .from('bank_transactions')
      .select('bank_account_id, bank_account_name')
      .eq('user_id', userId)
      .in('bank_account_id', accountIds)
      .not('bank_account_name', 'is', null)
      .limit(accountIds.length);
    if (cachedNames) {
      for (const row of cachedNames) {
        if (row.bank_account_id && row.bank_account_name && !bankAccountNamesUsed[row.bank_account_id]) {
          bankAccountNamesUsed[row.bank_account_id] = row.bank_account_name;
        }
      }
    }
  }
  const stoppedReasonsByAccount: Record<string, string> = {};
  const perAccountStats: Record<string, {
    pages: number;
    rows: number;
    seen: number;
    in_range: number;
    stop_reason: string;
    skipped_by_change_detection: boolean;
  }> = {};

  const accountSettingsUpserts: Array<{ user_id: string; key: string; value: string }> = [];

  for (const accountId of accountIds) {
    bankAccountIdsUsed.push(accountId);

    const fetchedAtKey = `bank_feed_last_fetched_at:${accountId}`;
    const successAtKey = `bank_feed_last_success_at:${accountId}`;
    const lastSeenUpdatedKey = `bank_feed_last_seen_updated_utc:${accountId}`;
    const rangeKey = `bank_feed_last_range:${accountId}`;

    const lastFetchedAt = accountSettingsMap.get(fetchedAtKey) ?? null;
    const accountLastSuccessAt = accountSettingsMap.get(successAtKey) ?? null;
    const lastRange = accountSettingsMap.get(rangeKey) ?? null;

    const lastFetchedMs = lastFetchedAt ? new Date(lastFetchedAt).getTime() : NaN;
    const accountLastSuccessMs = accountLastSuccessAt ? new Date(accountLastSuccessAt).getTime() : NaN;

    const cacheFresh = !isNaN(lastFetchedMs) && (nowMs - lastFetchedMs) < cacheFreshMs;
    const lastSuccessRecent = !isNaN(accountLastSuccessMs) && (nowMs - accountLastSuccessMs) < guardMinutes * 60000;
    const invoiceRangeUnchanged = lastRange === rangeSignature;

    // Change detection: skip only when we HAVE cached data AND account-level state is fresh
    if (cachedBankRowsTotal > 0 && cacheFresh && invoiceRangeUnchanged && lastSuccessRecent) {
      accountsSkippedByChangeDetection++;
      stoppedReasonsByAccount[accountId] = 'unchanged_recent';
      perAccountStats[accountId] = {
        pages: 0,
        rows: 0,
        seen: 0,
        in_range: 0,
        stop_reason: 'unchanged_recent',
        skipped_by_change_detection: true,
      };
      console.log(`[fetch-bank-txns] Skipping account ${accountId}: cache fresh, range unchanged, success recent`);
      continue;
    }

    let page = 1;
    let hasMore = true;
    let accountRows = 0;
    let accountSeen = 0;
    let accountInRange = 0;
    let accountPagesFetched = 0;
    let accountStopReason = 'completed';
    let accountLastSeenUpdatedUtc = accountSettingsMap.get(lastSeenUpdatedKey) ?? null;

    while (hasMore && page <= MAX_PAGES_PER_ACCOUNT) {
      performedRealXeroFetch = true;

      const url = `https://api.xero.com/api.xro/2.0/BankTransactions?bankAccountID=${accountId}&where=${encodeURIComponent(whereClause)}&page=${page}`;
      const requestTimestamp = new Date().toISOString();
      const endpointLabel = `BankTransactions?bankAccountID=${accountId}&page=${page}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Xero-Tenant-Id': token.tenant_id,
          'Accept': 'application/json',
          // If-Modified-Since DISABLED for testing — uncomment to re-enable
          // 'If-Modified-Since': ifModifiedSinceValue,
        },
      });

      outboundRequestLedger.push({
        timestamp: requestTimestamp,
        function_name: 'fetch-xero-bank-transactions',
        invoker,
        endpoint: endpointLabel,
        account_id: accountId,
        response_code: res.status,
        retry_number: 0,
        from_wrapper_retry_logic: false,
      });

      // ── Audit log to system_events ──
      await adminSupabase.from('system_events').insert({
        user_id: userId,
        event_type: 'xero_api_call',
        severity: res.ok ? 'info' : (res.status === 429 ? 'warning' : 'error'),
        details: {
          timestamp_utc: requestTimestamp,
          function_name: 'fetch-xero-bank-transactions',
          invoker,
          endpoint: endpointLabel,
          attempt_number: 1,
          governor_decision: 'allowed',
          http_status: res.status,
        },
      });

      totalPagesFetched++;
      accountPagesFetched++;

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[fetch-bank-txns] Xero API error [${res.status}] account=${accountId}:`, errText.substring(0, 300));

        if (res.status === 429) {
          const rawRetryAfter = res.headers.get('Retry-After');
          const retryAfterSec = parseRetryAfterSeconds(rawRetryAfter);
          const newCooldownUntil = new Date(Date.now() + retryAfterSec * 1000).toISOString();

          // Set BOTH bank-specific AND shared cooldown so ALL functions respect it
          await Promise.all([
            adminSupabase.from('app_settings').upsert({
              user_id: userId,
              key: COOLDOWN_KEY,
              value: newCooldownUntil,
            }, { onConflict: 'user_id,key' }),
            adminSupabase.from('app_settings').upsert({
              user_id: userId,
              key: 'xero_api_cooldown_until',
              value: newCooldownUntil,
            }, { onConflict: 'user_id,key' }),
            // Audit log
            adminSupabase.from('system_events').insert({
              user_id: userId,
              event_type: 'xero_api_call',
              severity: 'warning',
              details: {
                timestamp_utc: requestTimestamp,
                function_name: 'fetch-xero-bank-transactions',
                invoker,
                endpoint: endpointLabel,
                attempt_number: 1,
                governor_decision: 'rate_limited',
                http_status: 429,
                xero_retry_after_seconds: retryAfterSec,
                cooldown_until: newCooldownUntil,
              },
            }),
          ]);

          // Persist any per-account checkpoints accumulated from prior accounts
          if (accountSettingsUpserts.length > 0) {
            await adminSupabase
              .from('app_settings')
              .upsert(accountSettingsUpserts, { onConflict: 'user_id,key' });
          }

          return {
            user_id: userId,
            xero_rate_limited: true,
            skip_reason: null,
            cooldown_applied: false,
            cooldown_key_used: COOLDOWN_KEY,
            cooldown_active: false,
            live_xero_call_attempted: true,
            live_xero_429_received: true,
            recent_success_guard_applied: false,
            xero_api_cooldown_until: newCooldownUntil,
            retry_after_seconds: retryAfterSec,
            cooldown_until: newCooldownUntil,
            bank_rows_upserted: totalUpserted,
            synced_row_count: totalUpserted,
            partial: totalUpserted > 0,
            stopped_reason: 'rate_limited',
            accounts_checked: accountIds.length,
            mapped_accounts: mappedAccountIds.size,
            pages_fetched: totalPagesFetched,
            transactions_seen_total: totalTransactionsSeen,
            transactions_seen: totalTransactionsSeen,
            transactions_in_range: totalTransactionsInRange,
            bank_account_ids_used: bankAccountIdsUsed,
            bank_account_names_used: bankAccountNamesUsed,
            per_account_stats: perAccountStats,
            mapped_account_ids_count: mappedAccountIds.size,
            has_any_mapping: hasAnyMapping,
            used_invoice_range: usedInvoiceRange,
            invoice_range_days: effectiveDays,
            fetch_from: fetchFromDate,
            fetch_to: fetchToDate,
            date_range_source: dateRangeSource,
            endpoint_used: 'BankTransactions?bankAccountID=... (If-Modified-Since DISABLED)',
            if_modified_since_used: false,
            if_modified_since_value: null,
            cached_bank_rows_total: cachedBankRowsTotal,
            last_successful_bank_sync_at: lastSuccessfulBankSyncAt,
            ...buildRequestAudit(),
          };
        }

        accountStopReason = `http_${res.status}`;
        hasMore = false;
        break;
      }

      const data = await res.json();
      const txns = data?.BankTransactions || [];

      // Capture bank account name from first transaction if available
      if (txns.length > 0 && txns[0]?.BankAccount?.Name && !bankAccountNamesUsed[accountId]) {
        bankAccountNamesUsed[accountId] = txns[0].BankAccount.Name;
      }

      if (txns.length === 0) {
        accountStopReason = 'empty_page';
        hasMore = false;
        break;
      }

      let inRangeThisPage = 0;
      const pageTxnDates: string[] = [];
      const rows: any[] = [];

      for (const txn of txns) {
        accountSeen++;
        totalTransactionsSeen++;

        const txnType = txn?.Type || 'RECEIVE';
        // Ingest ALL types — matching layer filters to RECEIVE later

        const parsedDate = parseXeroTxnDate(txn.Date);
        if (parsedDate) pageTxnDates.push(parsedDate);

        const updatedUtc = parseXeroTxnTimestamp(txn.UpdatedDateUTC);
        if (updatedUtc && (!accountLastSeenUpdatedUtc || updatedUtc > accountLastSeenUpdatedUtc)) {
          accountLastSeenUpdatedUtc = updatedUtc;
        }

        const isInRange = !!parsedDate
          && parsedDate >= fetchFromDate
          && (!fetchToDate || parsedDate <= fetchToDate);

        if (!isInRange) continue;

        inRangeThisPage++;
        accountInRange++;
        totalTransactionsInRange++;

        rows.push({
          user_id: userId,
          xero_transaction_id: txn.BankTransactionID,
          bank_account_id: txn.BankAccount?.AccountID || null,
          bank_account_name: txn.BankAccount?.Name || null,
          date: parsedDate,
          amount: Math.abs(txn.Total || 0),
          currency: txn.CurrencyCode || 'AUD',
          description: txn.LineItems?.[0]?.Description || null,
          reference: txn.Reference || null,
          contact_name: txn.Contact?.Name || null,
          transaction_type: txnType,
          xero_status: txn.Status || null,
          fetched_at: new Date().toISOString(),
        });
      }

      if (rows.length > 0) {
        const { error: upsertErr } = await adminSupabase
          .from('bank_transactions')
          .upsert(rows, { onConflict: 'user_id,xero_transaction_id' });

        if (upsertErr) {
          console.error(`[fetch-bank-txns] Upsert error for ${userId}:`, upsertErr.message);
        } else {
          totalUpserted += rows.length;
          accountRows += rows.length;
        }
      }

      const firstDate = pageTxnDates[0] || null;
      const lastDate = pageTxnDates[pageTxnDates.length - 1] || null;
      const newestToOldest = !!firstDate && !!lastDate ? firstDate >= lastDate : null;

      // With server-side date filtering, no need for client-side date boundary stops.
      // Just paginate until empty or max pages.
      if (page >= MAX_PAGES_PER_ACCOUNT) {
        accountStopReason = 'max_pages';
        hasMore = false;
      } else if (txns.length < 100) {
        accountStopReason = 'last_page';
        hasMore = false;
      } else {
        page++;
      }
    }

    stoppedReasonsByAccount[accountId] = accountStopReason;
    perAccountStats[accountId] = {
      pages: accountPagesFetched,
      rows: accountRows,
      seen: accountSeen,
      in_range: accountInRange,
      stop_reason: accountStopReason,
      skipped_by_change_detection: false,
    };

    // Persist per-account fetch state only when an actual Xero call occurred for this account
    if (accountPagesFetched > 0) {
      const accountSyncAt = new Date().toISOString();
      accountSettingsUpserts.push(
        { user_id: userId, key: fetchedAtKey, value: accountSyncAt },
        { user_id: userId, key: successAtKey, value: accountSyncAt },
        { user_id: userId, key: rangeKey, value: rangeSignature },
      );

      if (accountLastSeenUpdatedUtc) {
        accountSettingsUpserts.push({ user_id: userId, key: lastSeenUpdatedKey, value: accountLastSeenUpdatedUtc });
      }
    }
  }

  if (accountSettingsUpserts.length > 0) {
    await adminSupabase
      .from('app_settings')
      .upsert(accountSettingsUpserts, { onConflict: 'user_id,key' });
  }

  const uniqueStopReasons = [...new Set(Object.values(stoppedReasonsByAccount))];
  const stoppedReason = uniqueStopReasons.length === 1
    ? uniqueStopReasons[0]
    : uniqueStopReasons.join(',');

  if (!performedRealXeroFetch && accountsSkippedByChangeDetection === accountIds.length) {
    return {
      user_id: userId,
      skipped: true,
      skip_reason: 'unchanged_recent',
      stopped_reason: 'unchanged_recent',
      xero_rate_limited: false,
      cooldown_applied: false,
      cooldown_key_used: COOLDOWN_KEY,
      cooldown_active: false,
      live_xero_call_attempted: false,
      live_xero_429_received: false,
      recent_success_guard_applied: true,
      xero_api_cooldown_until: null,
      retry_after_seconds: 0,
      pages_fetched: 0,
      transactions_seen_total: 0,
      transactions_seen: 0,
      transactions_in_range: 0,
      bank_rows_upserted: 0,
      synced_row_count: 0,
      bank_account_ids_used: bankAccountIdsUsed,
      bank_account_names_used: bankAccountNamesUsed,
      mapped_account_ids_count: mappedAccountIds.size,
      has_any_mapping: hasAnyMapping,
      used_invoice_range: usedInvoiceRange,
      invoice_range_days: effectiveDays,
      fetch_from: fetchFromDate,
      fetch_to: fetchToDate,
      date_range_source: dateRangeSource,
      endpoint_used: 'BankTransactions?bankAccountID=... (If-Modified-Since DISABLED)',
      if_modified_since_used: false,
      if_modified_since_value: null,
      per_account_stats: perAccountStats,
      ...baseDiag,
      ...buildRequestAudit(),
    };
  }

  // ══════════════════════════════════════════════════════════════
  // STEP 6 — Persist success timestamp only after real Xero fetch
  // ══════════════════════════════════════════════════════════════
  let effectiveLastSuccess = lastSuccessfulBankSyncAt;
  let refreshedAt: string | null = null;

  if (performedRealXeroFetch) {
    const successAt = new Date().toISOString();
    await adminSupabase.from('app_settings').upsert({
      user_id: userId,
      key: LAST_SUCCESS_KEY,
      value: successAt,
    }, { onConflict: 'user_id,key' });
    effectiveLastSuccess = successAt;
    refreshedAt = successAt;

    await adminSupabase.from('system_events').insert({
      user_id: userId,
      event_type: 'bank_txn_fetch',
      severity: 'info',
      details: {
        transactions_upserted: totalUpserted,
        pages_fetched: totalPagesFetched,
        transactions_seen_total: totalTransactionsSeen,
        transactions_in_range: totalTransactionsInRange,
        stopped_reason: stoppedReason,
        invoice_range_days: effectiveDays,
        date_range_source: dateRangeSource,
        used_invoice_range: usedInvoiceRange,
        bank_account_ids_used: bankAccountIdsUsed,
        bank_account_names_used: bankAccountNamesUsed,
        if_modified_since_used: false,
        if_modified_since_value: null,
        endpoint_used: 'BankTransactions?bankAccountID=... (If-Modified-Since DISABLED)',
        per_account_stats: perAccountStats,
        fetch_from: fetchFromDate,
        fetch_to: fetchToDate || 'open',
      },
    });
  }

  // Final cache row count for diagnostics
  const { count: finalBankRowsCount } = await adminSupabase
    .from('bank_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  return {
    user_id: userId,
    skip_reason: null,
    stopped_reason: stoppedReason,
    xero_rate_limited: false,
    cooldown_applied: false,
    cooldown_key_used: COOLDOWN_KEY,
    cooldown_active: false,
    live_xero_call_attempted: performedRealXeroFetch,
    live_xero_429_received: false,
    recent_success_guard_applied: accountsSkippedByChangeDetection > 0,
    xero_api_cooldown_until: null,
    retry_after_seconds: 0,
    bank_rows_upserted: totalUpserted,
    synced_row_count: totalUpserted,
    mapped_accounts: mappedAccountIds.size,
    accounts_checked: accountIds.length,
    pages_fetched: totalPagesFetched,
    transactions_seen_total: totalTransactionsSeen,
    transactions_seen: totalTransactionsSeen,
    transactions_in_range: totalTransactionsInRange,
    bank_account_ids_used: bankAccountIdsUsed,
    bank_account_names_used: bankAccountNamesUsed,
    per_account_stats: perAccountStats,
    mapped_account_ids_count: mappedAccountIds.size,
    has_any_mapping: hasAnyMapping,
    used_invoice_range: usedInvoiceRange,
    invoice_range_days: effectiveDays,
    fetch_from: fetchFromDate,
    fetch_to: fetchToDate,
    date_range_source: dateRangeSource,
    endpoint_used: 'BankTransactions?bankAccountID=... (If-Modified-Since DISABLED)',
    if_modified_since_used: false,
    if_modified_since_value: null,
    cached_bank_rows_total: finalBankRowsCount || 0,
    last_successful_bank_sync_at: effectiveLastSuccess,
    cooldown_until: null,
    refreshed_at: refreshedAt,
    ...buildRequestAudit(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const clientId = Deno.env.get('XERO_CLIENT_ID');
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Xero credentials not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));

    // ── Determine mode: "self" (user-scoped) or "batch" (service-role) ──
    const action = req.headers.get('x-action') ?? body.action ?? 'batch';

    if (action === 'self') {
      // ── USER-SCOPED MODE ──
      // Requires valid user JWT. Only syncs for the authenticated user.
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized — missing token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const anonClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: authError } = await anonClient.auth.getUser();
      if (authError || !userData?.user) {
        return new Response(JSON.stringify({ error: 'Unauthorized — invalid token' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const userId = userData.user.id;
      const invoker = body.invoker || 'self';
      console.log(`[fetch-bank-txns] Self-mode for user ${userId} (invoker=${invoker})`);

      // Acquire sync lock — prevents overlap with batch/cron/sweep
      const { data: lockResult } = await adminSupabase.rpc('acquire_sync_lock', {
        p_user_id: userId,
        p_integration: 'xero',
        p_lock_key: 'bank_feed_sync',
        p_ttl_seconds: 120,
      });
      if (lockResult && !lockResult.acquired) {
        console.log(`[fetch-bank-txns] Lock held for ${userId} — skipping (invoker=${invoker})`);
        return new Response(JSON.stringify({
          success: false,
          mode: 'self',
          invoker,
          user_id: userId,
          skipped: true,
          skip_reason: 'lock_held',
          lock_expires_at: lockResult.expires_at,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let result: any;
      try {
        result = await fetchBankTxnsForUser(
          adminSupabase,
          userId,
          clientId,
          clientSecret,
          GUARD_MINUTES_SELF,
          CACHE_FRESH_MINUTES_SELF,
          LOOKBACK_DAYS_SELF,
          invoker,
        );
      } finally {
        await adminSupabase.rpc('release_sync_lock', {
          p_user_id: userId,
          p_integration: 'xero',
          p_lock_key: 'bank_feed_sync',
        });
      }

      return new Response(JSON.stringify({
        success: true,
        mode: 'self',
        invoker,
        lock_acquired: true,
        user_id: userId,
        ...result,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── BATCH MODE ──
    // Only allow service-role callers (scheduled-sync, admin)
    const authHeader = req.headers.get('Authorization') || '';
    const callerToken = authHeader.replace('Bearer ', '');
    if (callerToken !== serviceRoleKey) {
      // Also check if it's an internal call by verifying the user has admin role
      // For safety, just check if the token IS the service role key
      return new Response(JSON.stringify({ error: 'Unauthorized — batch mode requires service role' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const targetUserId = body.userId as string | undefined;

    // Get all users with Xero tokens (or specific user)
    let query = adminSupabase.from('xero_tokens').select('user_id');
    if (targetUserId) query = query.eq('user_id', targetUserId);
    const { data: xeroUsers } = await query;

    if (!xeroUsers || xeroUsers.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No Xero users', users_processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userIds = [...new Set(xeroUsers.map(u => u.user_id))];
    const results: any[] = [];

    for (const userId of userIds) {
      try {
        // Acquire sync lock per user in batch mode
        const { data: lockResult } = await adminSupabase.rpc('acquire_sync_lock', {
          p_user_id: userId,
          p_integration: 'xero',
          p_lock_key: 'bank_feed_sync',
          p_ttl_seconds: 120,
        });
        if (lockResult && !lockResult.acquired) {
          console.log(`[fetch-bank-txns] Lock held for ${userId} — skipping in batch (invoker=batch)`);
          results.push({ user_id: userId, skipped: true, skip_reason: 'lock_held', invoker: 'batch' });
          continue;
        }
        try {
          const result = await fetchBankTxnsForUser(
            adminSupabase,
            userId,
            clientId,
            clientSecret,
            GUARD_MINUTES_BATCH,
            CACHE_FRESH_MINUTES_BATCH,
            LOOKBACK_DAYS_BATCH,
            'batch',
          );
          results.push({ ...result, invoker: 'batch', lock_acquired: true });
        } finally {
          await adminSupabase.rpc('release_sync_lock', {
            p_user_id: userId,
            p_integration: 'xero',
            p_lock_key: 'bank_feed_sync',
          });
        }
      } catch (err: any) {
        console.error(`[fetch-bank-txns] Error for ${userId}:`, err.message);
        results.push({ user_id: userId, error: err.message, invoker: 'batch' });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      users_processed: userIds.length,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[fetch-bank-txns] Fatal error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
