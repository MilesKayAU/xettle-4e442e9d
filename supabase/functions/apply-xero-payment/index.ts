import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const ALLOWED_ORIGINS = [
  'https://xettle.app',
  'https://xettle.lovable.app',
  'https://id-preview--7fd99b7a-85b4-49c3-9197-4e0e88f0fa66.lovable.app',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  };
}

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

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
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

    const body = await req.json();
    const { invoice_id, bank_transaction_id, amount, date, settlement_id } = body;

    if (!invoice_id || !amount) {
      return new Response(JSON.stringify({ error: 'Missing invoice_id or amount' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
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
      return new Response(JSON.stringify({ error: 'No Xero connection' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let token = tokens[0] as XeroToken;
    token = await refreshToken(supabase, token);

    // ─── First, get the invoice to find the correct account ───
    const invResp = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${invoice_id}`, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id,
      },
    });

    if (!invResp.ok) {
      return new Response(JSON.stringify({ error: 'Failed to fetch invoice from Xero' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const invData = await invResp.json();
    const invoice = invData.Invoices?.[0];
    if (!invoice) {
      return new Response(JSON.stringify({ error: 'Invoice not found in Xero' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (invoice.Status !== 'AUTHORISED') {
      return new Response(JSON.stringify({ error: `Invoice is ${invoice.Status}, not AUTHORISED` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── Get the bank account to apply payment to ───
    // Use the first bank account found, or a specific one if bank_transaction_id is provided
    let bankAccountId: string | null = null;

    if (bank_transaction_id) {
      // Get the bank account from the transaction
      const txnResp = await fetch(`https://api.xero.com/api.xro/2.0/BankTransactions/${bank_transaction_id}`, {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': token.tenant_id,
        },
      });
      if (txnResp.ok) {
        const txnData = await txnResp.json();
        bankAccountId = txnData.BankTransactions?.[0]?.BankAccount?.AccountID || null;
      }
    }

    // If no bank account from transaction, get the first bank account
    if (!bankAccountId) {
      const accountsResp = await fetch(`https://api.xero.com/api.xro/2.0/Accounts?where=Type=="BANK"`, {
        headers: {
          'Authorization': `Bearer ${token.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': token.tenant_id,
        },
      });
      if (accountsResp.ok) {
        const accountsData = await accountsResp.json();
        bankAccountId = accountsData.Accounts?.[0]?.AccountID || null;
      }
    }

    if (!bankAccountId) {
      return new Response(JSON.stringify({ error: 'No bank account found in Xero' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── Apply payment via POST /Payments ───
    const paymentDate = date || new Date().toISOString().split('T')[0];
    const paymentBody = {
      Invoice: { InvoiceID: invoice_id },
      Account: { AccountID: bankAccountId },
      Amount: amount,
      Date: paymentDate,
      Reference: `Xettle auto-reconciliation`,
    };

    const payResp = await fetch('https://api.xero.com/api.xro/2.0/Payments', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Xero-tenant-id': token.tenant_id,
      },
      body: JSON.stringify(paymentBody),
    });

    const payResult = await payResp.json();

    if (!payResp.ok) {
      console.error('Xero payment failed:', JSON.stringify(payResult));
      return new Response(JSON.stringify({
        error: 'Xero payment failed',
        detail: payResult.Message || payResult.Elements?.[0]?.ValidationErrors?.[0]?.Message || 'Unknown error',
      }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const paymentId = payResult.Payments?.[0]?.PaymentID;

    // ─── Update our settlement to reflect the payment ───
    if (settlement_id) {
      await supabase.from('settlements').update({
        status: 'synced_external',
        xero_status: 'PAID',
        bank_verified: true,
        bank_verified_amount: amount,
        bank_verified_at: new Date().toISOString(),
        bank_verified_by: userId,
      }).eq('settlement_id', settlement_id).eq('user_id', userId);

      // Update marketplace_validation
      const { data: sett } = await supabase
        .from('settlements')
        .select('marketplace, period_start, period_end')
        .eq('settlement_id', settlement_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (sett) {
        const periodLabel = `${sett.period_start} → ${sett.period_end}`;
        await supabase.from('marketplace_validation').upsert({
          user_id: userId,
          marketplace_code: sett.marketplace || 'unknown',
          period_label: periodLabel,
          period_start: sett.period_start,
          period_end: sett.period_end,
          xero_pushed: true,
          bank_matched: true,
          bank_amount: amount,
          bank_matched_at: new Date().toISOString(),
        }, { onConflict: 'user_id,marketplace_code,period_label' });
      }
    }

    // Log event
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'xero_payment_applied',
      settlement_id: settlement_id || null,
      severity: 'success',
      details: {
        invoice_id,
        payment_id: paymentId,
        amount,
        date: paymentDate,
        bank_transaction_id: bank_transaction_id || null,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      payment_id: paymentId,
      invoice_id,
      amount,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('apply-xero-payment error:', err);
    return new Response(JSON.stringify({ error: 'Internal error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
