import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? ""
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verify admin
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const { data: isAdmin } = await supabase.rpc('has_role', { _role: 'admin' })
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Service role client for cross-user queries
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Fetch all data in parallel
    const [
      { data: authUsers },
      { data: settlements },
      { data: connections },
      { data: xeroTokens },
      { data: amazonTokens },
      { data: ebayTokens },
      { data: profitData },
      { data: settingsData },
      { data: aiUsageData },
      { data: systemEventsData },
    ] = await Promise.all([
      admin.auth.admin.listUsers({ perPage: 1000 }),
      admin.from('settlements')
        .select('user_id, marketplace, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, advertising_costs, other_fees, refunds, bank_deposit, gst_on_income, period_start, period_end, status, xero_status')
        .eq('is_hidden', false)
        .is('duplicate_of_settlement_id', null),
      admin.from('marketplace_connections')
        .select('user_id, marketplace_code, marketplace_name, connection_status'),
      admin.from('xero_tokens').select('user_id'),
      admin.from('amazon_tokens').select('user_id'),
      admin.from('ebay_tokens').select('user_id'),
      admin.from('settlement_profit')
        .select('user_id, marketplace_code, gross_revenue, gross_profit, margin_percent, orders_count, units_sold, uncosted_sku_count'),
      admin.from('app_settings')
        .select('user_id, key, value')
        .in('key', ['tax_profile', 'accounting_boundary_date', 'trial_started_at']),
      admin.from('ai_usage')
        .select('user_id, month, question_count'),
      admin.from('system_events')
        .select('user_id, event_type'),
    ])

    const xeroSet = new Set((xeroTokens || []).map(t => t.user_id))
    const amazonSet = new Set((amazonTokens || []).map(t => t.user_id))
    const ebaySet = new Set((ebayTokens || []).map(t => t.user_id))

    // Build per-user settings map
    const userSettings: Record<string, Record<string, string>> = {}
    for (const s of settingsData || []) {
      if (!userSettings[s.user_id]) userSettings[s.user_id] = {}
      userSettings[s.user_id][s.key] = s.value || ''
    }

    // Build per-user AI usage map
    const userAiUsage: Record<string, number> = {}
    for (const a of aiUsageData || []) {
      userAiUsage[a.user_id] = (userAiUsage[a.user_id] || 0) + (a.question_count || 0)
    }

    // Build per-user system event counts
    const SYNC_EVENTS = ['xero_sync_complete', 'xero_api_call', 'shopify_fetch_complete', 'shopify_payout_synced', 'amazon_fetch_complete', 'amazon_settlement_synced', 'ebay_fetch_complete', 'ebay_settlement_imported', 'bank_txn_fetch']
    const userEventCounts: Record<string, Record<string, number>> = {}
    for (const e of systemEventsData || []) {
      if (!userEventCounts[e.user_id]) userEventCounts[e.user_id] = {}
      userEventCounts[e.user_id][e.event_type] = (userEventCounts[e.user_id][e.event_type] || 0) + 1
    }

    // Group settlements by user
    const userSettlements: Record<string, typeof settlements> = {}
    for (const s of settlements || []) {
      if (!userSettlements[s.user_id]) userSettlements[s.user_id] = []
      userSettlements[s.user_id].push(s)
    }

    // Group connections by user
    const userConnections: Record<string, Set<string>> = {}
    for (const c of connections || []) {
      if (!userConnections[c.user_id]) userConnections[c.user_id] = new Set()
      if (c.connection_status === 'active' || c.connection_status === 'api_connected') {
        userConnections[c.user_id].add(c.marketplace_code)
      }
    }

    // Group profit data by user
    const userProfit: Record<string, { revenue: number; profit: number; orders: number; units: number }> = {}
    for (const p of profitData || []) {
      if (!userProfit[p.user_id]) userProfit[p.user_id] = { revenue: 0, profit: 0, orders: 0, units: 0 }
      userProfit[p.user_id].revenue += p.gross_revenue || 0
      userProfit[p.user_id].profit += p.gross_profit || 0
      userProfit[p.user_id].orders += p.orders_count || 0
      userProfit[p.user_id].units += p.units_sold || 0
    }

    const users = (authUsers?.users || []).map(u => {
      const setts = userSettlements[u.id] || []
      const conns = userConnections[u.id] || new Set<string>()
      const profit = userProfit[u.id]
      const settings = userSettings[u.id] || {}
      const events = userEventCounts[u.id] || {}

      // Build marketplace breakdown
      const mpMap: Record<string, { marketplace: string; settlement_count: number; gross_sales: number; total_fees: number; refunds: number; net_deposit: number; gst: number }> = {}
      for (const s of setts) {
        const mp = s.marketplace || 'Unknown'
        if (!mpMap[mp]) {
          mpMap[mp] = { marketplace: mp, settlement_count: 0, gross_sales: 0, total_fees: 0, refunds: 0, net_deposit: 0, gst: 0 }
        }
        mpMap[mp].settlement_count++
        mpMap[mp].gross_sales += (s.sales_principal || 0) + (s.sales_shipping || 0)
        mpMap[mp].total_fees += Math.abs(s.seller_fees || 0) + Math.abs(s.fba_fees || 0) + Math.abs(s.storage_fees || 0) + Math.abs(s.advertising_costs || 0) + Math.abs(s.other_fees || 0)
        mpMap[mp].refunds += Math.abs(s.refunds || 0)
        mpMap[mp].net_deposit += s.bank_deposit || 0
        mpMap[mp].gst += s.gst_on_income || 0
      }

      const breakdown = Object.values(mpMap).sort((a, b) => b.gross_sales - a.gross_sales)
      const totalGross = breakdown.reduce((s, m) => s + m.gross_sales, 0)
      const totalFees = breakdown.reduce((s, m) => s + m.total_fees, 0)
      const totalRefunds = breakdown.reduce((s, m) => s + m.refunds, 0)
      const totalNet = breakdown.reduce((s, m) => s + m.net_deposit, 0)
      const totalGst = breakdown.reduce((s, m) => s + m.gst, 0)
      const pushedCount = setts.filter(s => s.xero_status === 'pushed' || s.xero_status === 'posted').length

      const allMarketplaces = [...new Set([...Object.keys(mpMap), ...conns])]

      // Usage metrics
      const aiQuestions = userAiUsage[u.id] || 0
      const xeroApiCalls = events['xero_api_call'] || 0
      const syncsTotal = SYNC_EVENTS.reduce((sum, evt) => sum + (events[evt] || 0), 0)
      const settlementSaves = events['settlement_saved'] || 0

      // Top event types for this user (for breakdown)
      const usageBreakdown: Record<string, number> = {}
      for (const [evt, count] of Object.entries(events)) {
        if (count > 0) usageBreakdown[evt] = count
      }

      return {
        id: u.id,
        email: u.email || '',
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at || null,
        xero_connected: xeroSet.has(u.id),
        amazon_connected: amazonSet.has(u.id),
        ebay_connected: ebaySet.has(u.id),
        marketplace_count: allMarketplaces.length,
        marketplaces: allMarketplaces,
        total_settlements: setts.length,
        total_gross_sales: Math.round(totalGross * 100) / 100,
        total_fees: Math.round(totalFees * 100) / 100,
        total_refunds: Math.round(totalRefunds * 100) / 100,
        total_net_deposit: Math.round(totalNet * 100) / 100,
        total_gst: Math.round(totalGst * 100) / 100,
        fee_rate_pct: totalGross > 0 ? Math.round(totalFees / totalGross * 10000) / 100 : 0,
        profit_margin_pct: profit ? Math.round(profit.profit / Math.max(profit.revenue, 1) * 10000) / 100 : null,
        total_orders: profit?.orders || 0,
        total_units: profit?.units || 0,
        total_gross_profit: profit ? Math.round(profit.profit * 100) / 100 : 0,
        marketplace_breakdown: breakdown,
        tax_profile: settings.tax_profile || null,
        boundary_date: settings.accounting_boundary_date || null,
        trial_started_at: settings.trial_started_at || null,
        pushed_to_xero_count: pushedCount,
        ai_questions_total: aiQuestions,
        xero_api_calls: xeroApiCalls,
        syncs_total: syncsTotal,
        settlement_saves: settlementSaves,
        usage_breakdown: usageBreakdown,
      }
    })

    // Sort by total gross sales descending (most profitable first)
    users.sort((a, b) => b.total_gross_sales - a.total_gross_sales)

    // Compute platform-wide summary
    const summary = {
      total_users: users.length,
      active_users: users.filter(u => u.total_settlements > 0).length,
      total_revenue_processed: Math.round(users.reduce((s, u) => s + u.total_gross_sales, 0) * 100) / 100,
      total_fees_processed: Math.round(users.reduce((s, u) => s + u.total_fees, 0) * 100) / 100,
      total_settlements: users.reduce((s, u) => s + u.total_settlements, 0),
      xero_connected: users.filter(u => u.xero_connected).length,
      amazon_connected: users.filter(u => u.amazon_connected).length,
      ebay_connected: users.filter(u => u.ebay_connected).length,
      total_ai_questions: users.reduce((s, u) => s + u.ai_questions_total, 0),
      total_xero_api_calls: users.reduce((s, u) => s + u.xero_api_calls, 0),
      total_syncs: users.reduce((s, u) => s + u.syncs_total, 0),
    }

    return new Response(JSON.stringify({ users, summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    logger.error('Admin user overview error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})