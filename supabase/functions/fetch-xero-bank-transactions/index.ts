// ══════════════════════════════════════════════════════════════
// fetch-xero-bank-transactions
// Ingests RECEIVE bank transactions from Xero into local cache.
// Runs via scheduled-sync. Never creates accounting entries.
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GUARD_KEY = 'bank_txn_last_fetched_at';
const GUARD_MINUTES = 30;
const LOOKBACK_DAYS = 60;

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

  if (!res.ok) return null;
  const tokens = await res.json();
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString();

  await supabase.from('xero_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || tokenRow.refresh_token,
    expires_at: newExpiry,
  }).eq('user_id', userId);

  return { ...tokenRow, access_token: tokens.access_token };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const clientId = Deno.env.get('XERO_CLIENT_ID');
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Xero credentials not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json().catch(() => ({}));
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
        // ── Guard: skip if fetched within GUARD_MINUTES ──
        const { data: guardRow } = await adminSupabase
          .from('app_settings')
          .select('value')
          .eq('user_id', userId)
          .eq('key', GUARD_KEY)
          .maybeSingle();

        if (guardRow?.value) {
          const lastFetched = new Date(guardRow.value);
          const minutesAgo = (Date.now() - lastFetched.getTime()) / 60000;
          if (minutesAgo < GUARD_MINUTES) {
            console.log(`[fetch-bank-txns] Skipping ${userId} — fetched ${Math.round(minutesAgo)}m ago`);
            results.push({ user_id: userId, skipped: true, reason: 'guard', minutes_ago: Math.round(minutesAgo) });
            continue;
          }
        }

        // Refresh Xero token
        const token = await refreshXeroToken(adminSupabase, userId, clientId, clientSecret);
        if (!token) {
          results.push({ user_id: userId, error: 'Token refresh failed' });
          continue;
        }

        // Build where clause: RECEIVE transactions from last 60 days
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - LOOKBACK_DAYS);
        const whereClause = `Type=="RECEIVE" AND Date>=${formatXeroDateTime(fromDate)}`;

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
            results.push({ user_id: userId, error: `Xero API ${res.status}` });
            break;
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
          details: { transactions_upserted: totalUpserted, pages_fetched: page, lookback_days: LOOKBACK_DAYS },
        });

        console.log(`[fetch-bank-txns] ${userId}: upserted ${totalUpserted} transactions (${page} pages)`);
        results.push({ user_id: userId, upserted: totalUpserted, pages: page });

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
