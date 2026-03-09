import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

async function queryXeroInvoices(token: XeroToken, whereClause: string): Promise<any[]> {
  const url = `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(whereClause)}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Accept': 'application/json',
      'Xero-tenant-id': token.tenant_id,
    },
  });
  if (!resp.ok) {
    console.error(`Xero query failed (${whereClause}):`, resp.status, await resp.text());
    return [];
  }
  const result = await resp.json();
  return result.Invoices || [];
}

function extractSettlementId(reference: string): string | null {
  // New format: Xettle-{settlement_id} or Xettle-{settlement_id}-P1/P2
  if (reference.startsWith('Xettle-')) {
    const rest = reference.slice(7);
    // Strip split-month suffix (-P1, -P2)
    return rest.replace(/-P[12]$/, '');
  }
  // Old format: ... (settlement_id) or ... Part 1/2
  const match = reference.match(/\(([^)]+)\)/);
  return match ? match[1] : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();
    if (!userId) throw new Error('Missing userId');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get Xero token
    const { data: tokens, error: tokenErr } = await supabase
      .from('xero_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (tokenErr || !tokens?.length) {
      return new Response(JSON.stringify({ success: false, error: 'No Xero connection found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let token = tokens[0] as XeroToken;
    token = await refreshToken(supabase, token);

    // Dual query: new format + old format
    const [newFormatInvoices, oldFormatInvoices] = await Promise.all([
      queryXeroInvoices(token, 'Reference.StartsWith("Xettle-")'),
      queryXeroInvoices(token, 'Reference.Contains("Settlement")'),
    ]);

    // Merge and deduplicate by settlement_id
    const allInvoices = [...newFormatInvoices, ...oldFormatInvoices];
    const seen = new Map<string, any>();

    for (const inv of allInvoices) {
      const sid = extractSettlementId(inv.Reference || '');
      if (!sid) continue;
      // Prefer new format if both exist
      if (!seen.has(sid) || inv.Reference.startsWith('Xettle-')) {
        seen.set(sid, inv);
      }
    }

    // Update settlements in DB
    let updated = 0;
    for (const [settlementId, inv] of seen.entries()) {
      const { error } = await supabase
        .from('settlements')
        .update({
          xero_invoice_number: inv.InvoiceNumber || null,
          xero_status: inv.Status || null,
          xero_journal_id: inv.InvoiceID,
          status: 'synced',
        })
        .eq('settlement_id', settlementId)
        .eq('user_id', userId);

      if (!error) updated++;
    }

    console.log(`Synced ${updated} settlements from Xero for user ${userId}`);

    return new Response(JSON.stringify({ success: true, updated, total: seen.size }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('sync-xero-status error:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
