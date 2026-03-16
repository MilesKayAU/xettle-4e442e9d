// ══════════════════════════════════════════════════════════════
// fetch-xero-bank-accounts
// Returns active bank accounts from Xero for payout mapping UI.
// Falls back to cached Chart of Accounts bank records when Xero is rate-limited.
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightResponse } from '../_shared/cors.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const xeroClientId = Deno.env.get('XERO_CLIENT_ID')!
const xeroClientSecret = Deno.env.get('XERO_CLIENT_SECRET')!

interface XeroToken {
  id: string;
  user_id: string;
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
}

interface XeroBankAccount {
  account_id: string;
  name: string;
  currency_code: string;
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

async function getCachedBankAccounts(supabase: any, userId: string): Promise<XeroBankAccount[]> {
  const { data, error } = await supabase
    .from('xero_chart_of_accounts')
    .select('xero_account_id, account_name')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('account_type', 'BANK')
    .not('xero_account_id', 'is', null)
    .order('account_name', { ascending: true });

  if (error) {
    console.error('[fetch-xero-bank-accounts] Failed to load cached bank accounts:', error.message);
    return [];
  }

  return (data || []).map((row: any) => ({
    account_id: row.xero_account_id,
    name: row.account_name,
    currency_code: 'AUD',
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let authenticatedUserId: string | null = null;
  let adminClient: any = null;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    authenticatedUserId = user.id;
    adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // Get Xero token
    const { data: tokens } = await adminClient
      .from('xero_tokens')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!tokens?.length) {
      return new Response(JSON.stringify({ error: 'No Xero connection', accounts: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let token = tokens[0] as XeroToken;
    token = await refreshToken(adminClient, token);

    // Fetch active bank accounts from Xero
    const url = `https://api.xero.com/api.xro/2.0/Accounts?where=${encodeURIComponent('Type=="BANK"&&Status=="ACTIVE"')}`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id,
      },
    });

    if (!resp.ok) {
      const errText = await resp.text();
      const retryAfter = resp.headers.get('retry-after');
      console.error(`[fetch-xero-bank-accounts] Xero API error [${resp.status}]:`, errText.substring(0, 300));

      const cachedAccounts = await getCachedBankAccounts(adminClient, user.id);
      if (cachedAccounts.length > 0) {
        return new Response(JSON.stringify({
          accounts: cachedAccounts,
          source: 'cache',
          warning: `Xero API error: ${resp.status}${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`,
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ error: `Xero API error: ${resp.status}`, accounts: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json();
    const accounts = (data?.Accounts || []).map((acc: any) => ({
      account_id: acc.AccountID,
      name: acc.Name,
      currency_code: acc.CurrencyCode || 'AUD',
      bank_account_number: acc.BankAccountNumber || null,
      bank_account_type: acc.BankAccountType || null,
      type: acc.Type || null,
    }));

    return new Response(JSON.stringify({ accounts, source: 'xero' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('[fetch-xero-bank-accounts] Error:', err);

    if (authenticatedUserId && adminClient) {
      const cachedAccounts = await getCachedBankAccounts(adminClient, authenticatedUserId);
      if (cachedAccounts.length > 0) {
        return new Response(JSON.stringify({
          accounts: cachedAccounts,
          source: 'cache',
          warning: 'Xero temporarily unavailable. Showing cached bank accounts.',
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err), accounts: [] }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
