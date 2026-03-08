import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Find all Pro users (role = 'pro' or 'admin')
    const { data: proUsers, error: rolesError } = await supabase
      .from('user_roles')
      .select('user_id, role')
      .in('role', ['pro', 'admin'])

    if (rolesError) {
      console.error('Failed to fetch pro users:', rolesError)
      throw rolesError
    }

    const uniqueUserIds = [...new Set((proUsers || []).map(r => r.user_id))]
    console.log(`Found ${uniqueUserIds.length} pro/admin user(s) for auto-push`)

    const results: Array<{ userId: string; pushed: number; errors: number; skipped: number }> = []

    for (const userId of uniqueUserIds) {
      try {
        // Check user's cron schedule preference
        const { data: settings } = await supabase
          .from('app_settings')
          .select('value')
          .eq('user_id', userId)
          .eq('key', 'cron_schedule_hours')
          .limit(1)

        const scheduleHours = parseInt(settings?.[0]?.value || '6', 10)
        
        // Check last auto-push time
        const { data: lastPush } = await supabase
          .from('sync_history')
          .select('created_at')
          .eq('user_id', userId)
          .eq('event_type', 'xero_auto_push')
          .order('created_at', { ascending: false })
          .limit(1)

        if (lastPush && lastPush.length > 0) {
          const lastPushTime = new Date(lastPush[0].created_at).getTime()
          const hoursSinceLastPush = (Date.now() - lastPushTime) / (1000 * 60 * 60)
          if (hoursSinceLastPush < scheduleHours) {
            console.log(`User ${userId}: Last push ${hoursSinceLastPush.toFixed(1)}h ago, schedule is ${scheduleHours}h. Skipping.`)
            results.push({ userId, pushed: 0, errors: 0, skipped: 1 })
            continue
          }
        }

        // Get unpushed settlements (status = 'parsed' or 'saved', reconciliation_status = 'matched')
        const { data: unpushed, error: settError } = await supabase
          .from('settlements')
          .select('*')
          .eq('user_id', userId)
          .in('status', ['parsed', 'saved'])
          .eq('reconciliation_status', 'matched')
          .is('xero_journal_id', null)
          .order('period_start', { ascending: true })

        if (settError) {
          console.error(`User ${userId}: Failed to fetch settlements:`, settError)
          continue
        }

        if (!unpushed || unpushed.length === 0) {
          console.log(`User ${userId}: No unpushed settlements found`)
          // Log a sync event anyway
          await supabase.from('sync_history').insert({
            user_id: userId,
            event_type: 'xero_auto_push',
            status: 'success',
            settlements_affected: 0,
            details: { message: 'No unpushed settlements found' },
          })
          results.push({ userId, pushed: 0, errors: 0, skipped: 0 })
          continue
        }

        console.log(`User ${userId}: Found ${unpushed.length} unpushed settlement(s)`)

        // Get user's Xero account codes
        const { data: accountSettings } = await supabase
          .from('app_settings')
          .select('value')
          .eq('user_id', userId)
          .eq('key', 'accounting_xero_account_codes')
          .limit(1)

        let accountCodes: Record<string, string> = {}
        if (accountSettings?.[0]?.value) {
          try { accountCodes = JSON.parse(accountSettings[0].value) } catch {}
        }

        // Default account codes
        const getCode = (cat: string) => accountCodes[cat] || ({
          'Sales': '200', 'Refunds': '205', 'Reimbursements': '271',
          'Seller Fees': '407', 'FBA Fees': '408', 'Storage Fees': '409',
          'Tax Collected by Amazon': '824', 'Split Month Rollover': '612',
        }[cat] || '000')

        let pushed = 0
        let errors = 0

        for (const s of unpushed) {
          try {
            // Build line items for this settlement
            const lineItems = [
              { Description: 'Amazon Sales (Principal)', AccountCode: getCode('Sales'), TaxType: 'OUTPUT', UnitAmount: s.sales_principal + s.sales_shipping + (s.promotional_discounts || 0), Quantity: 1 },
              { Description: 'Amazon Refunds', AccountCode: getCode('Refunds'), TaxType: 'OUTPUT', UnitAmount: s.refunds || 0, Quantity: 1 },
              { Description: 'Amazon Reimbursements', AccountCode: getCode('Reimbursements'), TaxType: 'NONE', UnitAmount: s.reimbursements || 0, Quantity: 1 },
              { Description: 'Amazon Seller Fees', AccountCode: getCode('Seller Fees'), TaxType: 'INPUT', UnitAmount: s.seller_fees || 0, Quantity: 1 },
              { Description: 'Amazon FBA Fees', AccountCode: getCode('FBA Fees'), TaxType: 'INPUT', UnitAmount: s.fba_fees || 0, Quantity: 1 },
              { Description: 'Amazon Storage Fees', AccountCode: getCode('Storage Fees'), TaxType: 'INPUT', UnitAmount: s.storage_fees || 0, Quantity: 1 },
            ].filter(item => Math.abs(item.UnitAmount) > 0.01)

            // Push to Xero via sync-amazon-journal
            const { data: pushResult, error: pushError } = await supabase.functions.invoke('sync-amazon-journal', {
              body: {
                userId,
                reference: `AMZN-${s.settlement_id}`,
                date: s.deposit_date || s.period_end,
                dueDate: s.deposit_date || s.period_end,
                lineItems,
                country: s.marketplace,
              }
            })

            if (pushError || !pushResult?.success) {
              console.error(`User ${userId}: Failed to push ${s.settlement_id}:`, pushError?.message || pushResult?.error)
              errors++
              continue
            }

            // Update settlement with Xero journal ID
            await supabase
              .from('settlements')
              .update({
                status: 'pushed_to_xero',
                xero_journal_id: pushResult.invoiceId,
              })
              .eq('id', s.id)
              .eq('user_id', userId)

            pushed++
            console.log(`User ${userId}: Pushed ${s.settlement_id} → ${pushResult.invoiceId}`)
          } catch (err: any) {
            console.error(`User ${userId}: Error pushing ${s.settlement_id}:`, err.message)
            errors++
          }
        }

        // Log sync history
        await supabase.from('sync_history').insert({
          user_id: userId,
          event_type: 'xero_auto_push',
          status: errors > 0 ? (pushed > 0 ? 'partial' : 'error') : 'success',
          settlements_affected: pushed,
          error_message: errors > 0 ? `${errors} settlement(s) failed to push` : null,
          details: { pushed, errors, total: unpushed.length },
        })

        results.push({ userId, pushed, errors, skipped: 0 })
      } catch (userErr: any) {
        console.error(`User ${userId}: Unexpected error:`, userErr.message)
        await supabase.from('sync_history').insert({
          user_id: userId,
          event_type: 'xero_auto_push',
          status: 'error',
          settlements_affected: 0,
          error_message: userErr.message,
        })
        results.push({ userId, pushed: 0, errors: 1, skipped: 0 })
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('Auto-push cron error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
