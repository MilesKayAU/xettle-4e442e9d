import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Marketplace → Xero contact name mapping
const MARKETPLACE_CONTACTS: Record<string, string> = {
  amazon_au: 'Amazon.com.au',
  shopify_payments: 'Shopify',
  kogan: 'Kogan.com',
  bigw: 'Big W Marketplace',
  bunnings: 'Bunnings Marketplace',
  mydeal: 'MyDeal',
  catch: 'Catch.com.au',
  ebay_au: 'eBay Australia',
  woolworths: 'Woolworths Everyday Market',
  theiconic: 'THE ICONIC',
  etsy: 'Etsy',
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // ─── Find all users with Xero tokens (only they can push) ────
    const { data: xeroTokens, error: xeroErr } = await supabase
      .from('xero_tokens')
      .select('user_id')

    if (xeroErr || !xeroTokens?.length) {
      console.log('[auto-push-xero] No Xero-connected users found')
      return new Response(JSON.stringify({ success: true, pushed: 0, message: 'No Xero-connected users' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const uniqueUserIds = [...new Set(xeroTokens.map(t => t.user_id))]
    console.log(`[auto-push-xero] Processing ${uniqueUserIds.length} user(s)`)

    let totalPushed = 0
    let totalSkipped = 0
    let totalErrors = 0
    let totalAmountPushed = 0
    const perUserResults: any[] = []

    for (const userId of uniqueUserIds) {
      try {
        // ─── Get all ready_to_push settlements ────────────────────
        const { data: settlements, error: settErr } = await supabase
          .from('settlements')
          .select('*')
          .eq('user_id', userId)
          .eq('status', 'ready_to_push')
          .order('period_start', { ascending: true })

        if (settErr) {
          console.error(`[auto-push-xero] User ${userId}: query error:`, settErr.message)
          totalErrors++
          continue
        }

        if (!settlements || settlements.length === 0) {
          console.log(`[auto-push-xero] User ${userId}: no ready_to_push settlements`)
          perUserResults.push({ userId, pushed: 0, skipped: 0, errors: 0 })
          continue
        }

        console.log(`[auto-push-xero] User ${userId}: ${settlements.length} settlement(s) ready`)

        // ─── Get user's Xero account codes ────────────────────────
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

        const getCode = (cat: string) => accountCodes[cat] || ({
          'Sales': '200', 'Refunds': '205', 'Reimbursements': '271',
          'Seller Fees': '407', 'FBA Fees': '408', 'Storage Fees': '409',
          'Promotional Discounts': '200', 'Other Fees': '405',
        }[cat] || '405')

        let userPushed = 0
        let userSkipped = 0
        let userErrors = 0
        let userAmountPushed = 0

        for (const s of settlements) {
          // ─── Safety check: skip if already has Xero invoice ─────
          if (s.xero_invoice_number) {
            console.log(`[auto-push-xero] Skipping ${s.settlement_id}: already has ${s.xero_invoice_number}`)
            userSkipped++
            continue
          }

          // ─── Safety check: skip if already has journal ID ───────
          if (s.xero_journal_id) {
            console.log(`[auto-push-xero] Skipping ${s.settlement_id}: already has journal ${s.xero_journal_id}`)
            userSkipped++
            continue
          }

          try {
            const marketplace = s.marketplace || 'amazon_au'
            const contactName = MARKETPLACE_CONTACTS[marketplace] || marketplace
            const reference = `Xettle-${s.settlement_id}`
            const netAmount = s.bank_deposit || s.net_ex_gst || 0
            const description = `${contactName} Settlement ${s.period_start} → ${s.period_end}`

            // Build line items from settlement summary
            const lineItems = [
              { Description: `${contactName} Sales`, AccountCode: getCode('Sales'), TaxType: 'OUTPUT', UnitAmount: round2((s.sales_principal || 0) + (s.sales_shipping || 0)), Quantity: 1 },
              { Description: `${contactName} Promotional Discounts`, AccountCode: getCode('Promotional Discounts'), TaxType: 'OUTPUT', UnitAmount: round2(s.promotional_discounts || 0), Quantity: 1 },
              { Description: `${contactName} Refunds`, AccountCode: getCode('Refunds'), TaxType: 'OUTPUT', UnitAmount: round2(s.refunds || 0), Quantity: 1 },
              { Description: `${contactName} Reimbursements`, AccountCode: getCode('Reimbursements'), TaxType: 'NONE', UnitAmount: round2(s.reimbursements || 0), Quantity: 1 },
              { Description: `${contactName} Seller Fees`, AccountCode: getCode('Seller Fees'), TaxType: 'INPUT', UnitAmount: round2(s.seller_fees || 0), Quantity: 1 },
              { Description: `${contactName} FBA Fees`, AccountCode: getCode('FBA Fees'), TaxType: 'INPUT', UnitAmount: round2(s.fba_fees || 0), Quantity: 1 },
              { Description: `${contactName} Storage Fees`, AccountCode: getCode('Storage Fees'), TaxType: 'INPUT', UnitAmount: round2(s.storage_fees || 0), Quantity: 1 },
              { Description: `${contactName} Other Fees`, AccountCode: getCode('Other Fees'), TaxType: 'INPUT', UnitAmount: round2(s.other_fees || 0), Quantity: 1 },
            ].filter(item => Math.abs(item.UnitAmount) > 0.01)

            if (lineItems.length === 0) {
              console.log(`[auto-push-xero] Skipping ${s.settlement_id}: no non-zero line items`)
              userSkipped++
              continue
            }

            // ─── Call sync-settlement-to-xero ─────────────────────
            const pushUrl = `${supabaseUrl}/functions/v1/sync-settlement-to-xero`
            const pushResponse = await fetch(pushUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceRoleKey}`,
              },
              body: JSON.stringify({
                userId,
                action: 'create',
                reference,
                description,
                date: s.deposit_date || s.period_end,
                dueDate: s.deposit_date || s.period_end,
                lineItems,
                contactName,
                netAmount,
              }),
            })

            const pushResult = await pushResponse.json()

            if (!pushResponse.ok || !pushResult.success) {
              const errMsg = pushResult.error || `HTTP ${pushResponse.status}`
              console.error(`[auto-push-xero] Failed ${s.settlement_id}: ${errMsg}`)

              // Mark as push_failed so it's visible in the UI
              await supabase
                .from('settlements')
                .update({ status: 'push_failed' })
                .eq('id', s.id)

              // Log the failure
              await supabase.from('system_events').insert({
                user_id: userId,
                event_type: 'auto_push_xero',
                severity: 'warning',
                marketplace_code: marketplace,
                settlement_id: s.settlement_id,
                details: { error: errMsg, settlement_id: s.settlement_id, marketplace, amount: netAmount },
              })

              userErrors++
              continue
            }

            // ─── Update settlement status ─────────────────────────
            await supabase
              .from('settlements')
              .update({
                status: 'pushed_to_xero',
                xero_journal_id: pushResult.invoiceId,
                xero_invoice_number: pushResult.invoiceNumber || null,
                xero_status: 'AUTHORISED',
                xero_type: pushResult.xeroType || 'invoice',
              })
              .eq('id', s.id)

            // ─── Log success to system_events ─────────────────────
            await supabase.from('system_events').insert({
              user_id: userId,
              event_type: 'auto_push_xero',
              severity: 'info',
              marketplace_code: marketplace,
              settlement_id: s.settlement_id,
              details: {
                settlement_id: s.settlement_id,
                marketplace,
                amount: netAmount,
                xero_invoice_number: pushResult.invoiceNumber || null,
                xero_invoice_id: pushResult.invoiceId,
              },
            })

            userPushed++
            userAmountPushed += netAmount
            console.log(`[auto-push-xero] ✅ ${s.settlement_id} → ${pushResult.invoiceNumber || pushResult.invoiceId}`)

            // Rate-limit: 1 second between pushes to avoid Xero API throttling
            await new Promise(r => setTimeout(r, 1000))
          } catch (pushErr: any) {
            console.error(`[auto-push-xero] Error pushing ${s.settlement_id}:`, pushErr.message)
            userErrors++
          }
        }

        // ─── Log sync_history for this user ───────────────────────
        await supabase.from('sync_history').insert({
          user_id: userId,
          event_type: 'xero_auto_push',
          status: userErrors > 0 ? (userPushed > 0 ? 'partial' : 'error') : 'success',
          settlements_affected: userPushed,
          error_message: userErrors > 0 ? `${userErrors} settlement(s) failed` : null,
          details: {
            pushed: userPushed,
            skipped: userSkipped,
            errors: userErrors,
            total_amount: round2(userAmountPushed),
            total_settlements: settlements.length,
          },
        })

        totalPushed += userPushed
        totalSkipped += userSkipped
        totalErrors += userErrors
        totalAmountPushed += userAmountPushed
        perUserResults.push({ userId, pushed: userPushed, skipped: userSkipped, errors: userErrors, amount: round2(userAmountPushed) })
      } catch (userErr: any) {
        console.error(`[auto-push-xero] User ${userId} failed:`, userErr.message)
        totalErrors++
        perUserResults.push({ userId, pushed: 0, skipped: 0, errors: 1, error: userErr.message })
      }
    }

    const summary = {
      success: true,
      pushed: totalPushed,
      skipped: totalSkipped,
      errors: totalErrors,
      total_amount_pushed: round2(totalAmountPushed),
      users_processed: uniqueUserIds.length,
      results: perUserResults,
    }

    console.log(`[auto-push-xero] Complete: ${totalPushed} pushed, ${totalSkipped} skipped, ${totalErrors} errors, $${round2(totalAmountPushed)} total`)

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[auto-push-xero] Fatal error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})