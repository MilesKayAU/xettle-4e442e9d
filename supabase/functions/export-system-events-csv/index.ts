import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { logger } from '../_shared/logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MAX_ROWS = 5000;
const PAGE_SIZE = 1000;

function summarizeDetails(details: unknown): string {
  if (!details) return '';
  if (typeof details === 'string') return details.slice(0, 120);
  if (typeof details === 'object') {
    const d = details as Record<string, unknown>;
    // Extract safe summary fields only — never tokens/headers/payloads
    const parts: string[] = [];
    if (d.message) parts.push(String(d.message).slice(0, 80));
    if (d.reason) parts.push(String(d.reason).slice(0, 80));
    if (d.error) parts.push(`error: ${String(d.error).slice(0, 60)}`);
    if (d.count !== undefined) parts.push(`count: ${d.count}`);
    if (d.updated !== undefined) parts.push(`updated: ${d.updated}`);
    if (d.status) parts.push(`status: ${String(d.status).slice(0, 30)}`);
    if (parts.length === 0) {
      // Fallback: safe keys only
      const safeKeys = Object.keys(d).filter(k =>
        !['token', 'access_token', 'refresh_token', 'authorization', 'headers', 'payload', 'raw_payload', 'body'].includes(k.toLowerCase())
      ).slice(0, 4);
      return safeKeys.map(k => `${k}: ${String(d[k]).slice(0, 40)}`).join('; ');
    }
    return parts.join('; ');
  }
  return '';
}

function escapeCSV(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = claimsData.claims.sub;

    // Parse filters
    const body = req.method === 'POST' ? await req.json() : {};
    const dateFrom: string | undefined = body.date_from;
    const dateTo: string | undefined = body.date_to;
    const settlementId: string | undefined = body.settlement_id;
    const marketplaceCode: string | undefined = body.marketplace_code;

    // Build query with pagination
    const csvHeader = 'created_at,event_type,settlement_id,marketplace_code,severity,details_summary\n';
    const chunks: string[] = [csvHeader];
    let fetched = 0;
    let page = 0;

    while (fetched < MAX_ROWS) {
      let query = supabase
        .from('system_events')
        .select('created_at, event_type, settlement_id, marketplace_code, severity, details')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (dateFrom) query = query.gte('created_at', dateFrom);
      if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59.999Z');
      if (settlementId) query = query.eq('settlement_id', settlementId);
      if (marketplaceCode) query = query.eq('marketplace_code', marketplaceCode);

      const { data, error } = await query;

      if (error) {
        logger.error('[export-system-events-csv] query error:', error.message);
        return new Response(JSON.stringify({ error: 'Failed to fetch events' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (!data || data.length === 0) break;

      for (const row of data) {
        const line = [
          escapeCSV(row.created_at || ''),
          escapeCSV(row.event_type || ''),
          escapeCSV(row.settlement_id || ''),
          escapeCSV(row.marketplace_code || ''),
          escapeCSV(row.severity || ''),
          escapeCSV(summarizeDetails(row.details)),
        ].join(',');
        chunks.push(line + '\n');
      }

      fetched += data.length;
      if (data.length < PAGE_SIZE) break;
      page++;
    }

    logger.debug(`[export-system-events-csv] Exported ${fetched} rows for user ${userId.slice(0, 8)}`);

    const today = new Date().toISOString().split('T')[0];
    const filename = `xettle-audit-${today}.csv`;

    return new Response(chunks.join(''), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    logger.error('[export-system-events-csv] unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
