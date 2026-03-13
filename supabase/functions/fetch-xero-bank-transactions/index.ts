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

const GUARD_KEY = 'bank_txn_last_fetched_at';
const GUARD_MINUTES_BATCH = 30;
const GUARD_MINUTES_SELF = 2; // Allow more frequent manual syncs
const LOOKBACK_DAYS_BATCH = 60;
const LOOKBACK_DAYS_SELF = 30;

function formatXeroDateTime(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  return `DateTime(${y}, ${m}, ${dd})`;
}

async function refreshXeroToken(supabase: any, userId: string, clientId: string, clientSecret: string) {
  // Optimistic locking: re-read token immediately before refresh
  const { data: tokenRow, error } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error || !tokenRow) return null;

  const expiresAt = new Date(tokenRow.expires_at);
  if (expiresAt > new Date(Date.now() + 60000)) return tokenRow;

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

async function fetchBankTxnsForUser(
  adminSupabase: any,
  userId: string,
  clientId: string,
  clientSecret: string,
  guardMinutes: number,
  lookbackDays: number,
) {
  // ── Guard: skip if fetched within guardMinutes ──
  const { data: guardRow } = await adminSupabase
    .from('app_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', GUARD_KEY)
    .maybeSingle();

  if (guardRow?.value) {
    const lastFetched = new Date(guardRow.value);
    const minutesAgo = (Date.now() - lastFetched.getTime()) / 60000;
    if (minutesAgo < guardMinutes) {
      console.log(`[fetch-bank-txns] Skipping ${userId} — fetched ${Math.round(minutesAgo)}m ago`);
      return { user_id: userId, skipped: true, reason: 'guard', minutes_ago: Math.round(minutesAgo) };
    }
  }

  // Refresh Xero token
  const token = await refreshXeroToken(adminSupabase, userId, clientId, clientSecret);
  if (!token) {
    return { user_id: userId, error: 'Token refresh failed' };
  }

  // Build where clause: RECEIVE transactions from lookback period
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - lookbackDays);

  // Load destination account mappings (new-first, legacy-fallback)
  const DEST_PREFIX = 'payout_destination:';
  const LEGACY_PREFIX = 'payout_account:';

  const [destResp, legacyResp] = await Promise.all([
    adminSupabase.from('app_settings').select('key, value').eq('user_id', userId).like('key', `${DEST_PREFIX}%`),
    adminSupabase.from('app_settings').select('key, value').eq('user_id', userId).like('key', `${LEGACY_PREFIX}%`),
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

  let whereClause = `Type=="RECEIVE" AND Date>=${formatXeroDateTime(fromDate)}`;

  // If mappings exist, filter to only those bank accounts
  if (mappedAccountIds.size > 0) {
    const accountFilters = [...mappedAccountIds].map(id => `BankAccount.AccountID==Guid("${id}")`);
    if (accountFilters.length === 1) {
      whereClause += ` AND ${accountFilters[0]}`;
    } else {
      whereClause += ` AND (${accountFilters.join(' OR ')})`;
    }
    console.log(`[fetch-bank-txns] Filtering to ${mappedAccountIds.size} mapped account(s)`);
  }

  let page = 1;
  let totalUpserted = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `https://api.xero.com/api.xro/2.0/BankTransactions?where=${encodeURIComponent(whereClause)}&page=${page}&pageSize=100`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Xero-Tenant-Id': token.tenant_id,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[fetch-bank-txns] Xero API error [${res.status}]:`, errText.substring(0, 300));
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '60', 10);
        // Update cooldown guard so we don't hammer Xero
        await adminSupabase.from('app_settings').upsert({
          user_id: userId,
          key: 'xero_api_cooldown_until',
          value: new Date(Date.now() + retryAfter * 1000).toISOString(),
        }, { onConflict: 'user_id,key' });
        // Count what we already have cached
        const { count } = await adminSupabase
          .from('bank_transactions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId);
        return {
          user_id: userId,
          xero_rate_limited: true,
          retry_after_seconds: retryAfter,
          bank_rows_upserted: totalUpserted,
          bank_rows_cached_total: count || 0,
          partial: page > 1,
          mapped_account_ids_count: mappedAccountIds.size,
          has_any_mapping: hasAnyMapping,
          filtered_to_mapped_accounts: mappedAccountIds.size > 0,
          lookback_days: lookbackDays,
        };
      }
      return { user_id: userId, error: `Xero API ${res.status}` };
    }

    const data = await res.json();
    const txns = data?.BankTransactions || [];

    if (txns.length === 0) {
      hasMore = false;
      break;
    }

    // Parse and upsert
    const rows = txns.map((txn: any) => {
      const rawDate = txn.Date?.replace('/Date(', '').replace(')/', '').split('+')[0];
      const ts = parseInt(rawDate);
      const parsedDate = !isNaN(ts) ? new Date(ts).toISOString().split('T')[0] : null;

      return {
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
        transaction_type: txn.Type || 'RECEIVE',
        fetched_at: new Date().toISOString(),
      };
    });

    const { error: upsertErr } = await adminSupabase
      .from('bank_transactions')
      .upsert(rows, { onConflict: 'user_id,xero_transaction_id' });

    if (upsertErr) {
      console.error(`[fetch-bank-txns] Upsert error for ${userId}:`, upsertErr.message);
    } else {
      totalUpserted += rows.length;
    }

    // Xero returns max 100 per page
    if (txns.length < 100) {
      hasMore = false;
    } else {
      page++;
    }
  }

  // Update guard timestamp
  await adminSupabase.from('app_settings').upsert({
    user_id: userId,
    key: GUARD_KEY,
    value: new Date().toISOString(),
  }, { onConflict: 'user_id,key' });

  // Log to system_events
  await adminSupabase.from('system_events').insert({
    user_id: userId,
    event_type: 'bank_txn_fetch',
    severity: 'info',
    details: { transactions_upserted: totalUpserted, pages_fetched: page, lookback_days: lookbackDays, filtered_accounts: mappedAccountIds.size },
  });

  console.log(`[fetch-bank-txns] ${userId}: upserted ${totalUpserted} transactions (${page} pages)`);
  return {
    user_id: userId,
    bank_rows_upserted: totalUpserted,
    upserted: totalUpserted, // backwards compat for UI
    pages: page,
    mapped_account_ids_count: mappedAccountIds.size,
    has_any_mapping: hasAnyMapping,
    filtered_to_mapped_accounts: mappedAccountIds.size > 0,
    lookback_days: lookbackDays,
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
      console.log(`[fetch-bank-txns] Self-mode for user ${userId}`);

      const result = await fetchBankTxnsForUser(adminSupabase, userId, clientId, clientSecret, GUARD_MINUTES_SELF, LOOKBACK_DAYS_SELF);

      return new Response(JSON.stringify({
        success: true,
        mode: 'self',
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
        const result = await fetchBankTxnsForUser(adminSupabase, userId, clientId, clientSecret, GUARD_MINUTES_BATCH, LOOKBACK_DAYS_BATCH);
        results.push(result);
      } catch (err: any) {
        console.error(`[fetch-bank-txns] Error for ${userId}:`, err.message);
        results.push({ user_id: userId, error: err.message });
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
