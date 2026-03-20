/**
 * fetch-xero-invoice — Fetch a single Xero invoice by ID and cache it.
 * 
 * Input: { xeroInvoiceId: string }
 * Auth: Bearer token → resolves user_id
 * 
 * Tables written: xero_invoice_cache (upsert), system_events (insert)
 * Idempotency: upsert on (user_id, xero_invoice_id)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { getCorsHeaders } from '../_shared/cors.ts';
import { logger } from '../_shared/logger.ts';
import { XERO_TOKEN_URL, XERO_API_BASE, getXeroHeaders } from '../_shared/xero-api-policy.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const xeroClientId = Deno.env.get('XERO_CLIENT_ID')!;
const xeroClientSecret = Deno.env.get('XERO_CLIENT_SECRET')!;

async function refreshXeroToken(supabase: any, token: any): Promise<any> {
  const expiresAt = new Date(token.expires_at);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return token;

  const { data: fresh } = await supabase
    .from('xero_tokens').select('*').eq('id', token.id).single();
  if (fresh && fresh.expires_at !== token.expires_at) return { ...token, ...fresh };

  const resp = await fetch(XERO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${xeroClientId}:${xeroClientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: fresh?.refresh_token || token.refresh_token,
    }),
  });

  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);
  const data = await resp.json();
  const newExpires = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabase.from('xero_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: newExpires,
    updated_at: new Date().toISOString(),
  }).eq('id', token.id);

  return { ...token, access_token: data.access_token, refresh_token: data.refresh_token, expires_at: newExpires };
}

serve(async (req) => {
  const origin = req.headers.get("Origin") ?? "";
  const corsHeaders = getCorsHeaders(origin);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { xeroInvoiceId } = await req.json();
    if (!xeroInvoiceId) return new Response(JSON.stringify({ error: 'xeroInvoiceId required' }), { status: 400, headers: corsHeaders });

    // Cooldown check: skip if fetched < 30s ago
    const { data: cached } = await supabase
      .from('xero_invoice_cache')
      .select('fetched_at')
      .eq('user_id', user.id)
      .eq('xero_invoice_id', xeroInvoiceId)
      .maybeSingle();

    if (cached?.fetched_at) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < 30000) {
        return new Response(JSON.stringify({ success: true, cached: true, message: 'Recently fetched, returning cached' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get Xero token
    const { data: tokens } = await supabase
      .from('xero_tokens').select('*').eq('user_id', user.id).limit(1);
    if (!tokens?.length) return new Response(JSON.stringify({ error: 'No Xero connection' }), { status: 400, headers: corsHeaders });

    const token = await refreshXeroToken(supabase, tokens[0]);

    // Fetch invoice from Xero
    const xeroResp = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${xeroInvoiceId}`, {
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Accept': 'application/json',
        'Xero-tenant-id': token.tenant_id,
      },
    });

    if (xeroResp.status === 429) {
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'xero_invoice_refresh_failed',
        severity: 'warning',
        details: { xero_invoice_id: xeroInvoiceId, reason: 'rate_limited' },
      });
      return new Response(JSON.stringify({ error: 'Xero rate limited. Try again in a minute.' }), { status: 429, headers: corsHeaders });
    }

    if (!xeroResp.ok) {
      const errText = await xeroResp.text();
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'xero_invoice_refresh_failed',
        severity: 'warning',
        details: { xero_invoice_id: xeroInvoiceId, status: xeroResp.status, error: errText.slice(0, 500) },
      });
      return new Response(JSON.stringify({ error: `Xero API error: ${xeroResp.status}` }), { status: 502, headers: corsHeaders });
    }

    const result = await xeroResp.json();
    const inv = result.Invoices?.[0];
    if (!inv) return new Response(JSON.stringify({ error: 'Invoice not found in Xero' }), { status: 404, headers: corsHeaders });

    // Extract line items
    const lineItems = (inv.LineItems || []).map((li: any) => ({
      description: li.Description || '',
      account_code: li.AccountCode || '',
      tax_type: li.TaxType || '',
      unit_amount: li.UnitAmount || 0,
      quantity: li.Quantity || 1,
      line_amount: li.LineAmount || 0,
      tax_amount: li.TaxAmount || 0,
      tracking: li.Tracking || [],
    }));

    // Upsert into cache
    const now = new Date().toISOString();
    const { error: upsertErr } = await supabase
      .from('xero_invoice_cache')
      .upsert({
        user_id: user.id,
        xero_invoice_id: xeroInvoiceId,
        xero_invoice_number: inv.InvoiceNumber || null,
        status: inv.Status || null,
        date: inv.Date ? inv.Date.split('T')[0] : null,
        due_date: inv.DueDate ? inv.DueDate.split('T')[0] : null,
        contact_name: inv.Contact?.Name || null,
        contact_id: inv.Contact?.ContactID || null,
        currency_code: inv.CurrencyCode || 'AUD',
        total: inv.Total ?? null,
        sub_total: inv.SubTotal ?? null,
        total_tax: inv.TotalTax ?? null,
        reference: inv.Reference || null,
        line_items: lineItems,
        raw_json: inv,
        fetched_at: now,
      }, { onConflict: 'user_id,xero_invoice_id' });

    if (upsertErr) console.error('Cache upsert error:', upsertErr);

    // Log success event
    await supabase.from('system_events').insert({
      user_id: user.id,
      event_type: 'xero_invoice_refreshed',
      severity: 'info',
      details: {
        xero_invoice_id: xeroInvoiceId,
        xero_invoice_number: inv.InvoiceNumber,
        status: inv.Status,
        total: inv.Total,
        line_item_count: lineItems.length,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      invoice: {
        xero_invoice_id: xeroInvoiceId,
        xero_invoice_number: inv.InvoiceNumber,
        status: inv.Status,
        date: inv.Date,
        due_date: inv.DueDate,
        contact_name: inv.Contact?.Name,
        currency_code: inv.CurrencyCode,
        total: inv.Total,
        sub_total: inv.SubTotal,
        total_tax: inv.TotalTax,
        reference: inv.Reference,
        line_items: lineItems,
        fetched_at: now,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('fetch-xero-invoice error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
