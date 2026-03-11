# Xettle.app — Session 7 Handoff

**Date: March 12, 2026**

**Combines: Sessions 1-6 complete history**

---

## Confirmed Account Code Mapping (all 3 push paths)

| Category | Account | Tax Type | Notes |
|---|---|---|---|
| Sales | 200 | OUTPUT | AU domestic + international blended |
| Refunds | 205 | OUTPUT | Revenue contra |
| Reimbursements | 271 | NONE | BAS Excluded — not taxable |
| Promotional Discounts | 200 | OUTPUT | Reduces sales base |
| Seller Fees | 407 | INPUT | GST on purchases |
| FBA Fees | 408 | INPUT | GST on purchases |
| Storage Fees | 409 | INPUT | GST on purchases |
| Advertising Costs | 410 | INPUT | CostOfAdvertising — added Session 6 |
| Other Fees | 405 | INPUT | Catch-all fees |
| ACCPAY Bill (negative) | 405 | INPUT | Fixed Session 6 (was OUTPUT — BAS bug) |

All 3 push paths read from accounting_xero_account_codes
in app_settings via getCode(). Falls back to above defaults.

---

## Confirmed Working Features (audit-verified Session 6)

### Xero Push

- 9-category multi-line invoice on every settlement push
- User account code overrides respected across ALL push paths
- AI Account Mapper auto-runs on first Xero connect
  (Gemini 2.5 Flash via LOVABLE_API_KEY — production ready)
- Mapper saves to accounting_xero_account_codes
- Dashboard banner when ai_mapper_status = 'suggested'

### Split-Month Handling (Amazon only)

- detectSplitMonth() in settlement-parser.ts
- Journal 1: $0.00 with rollover line → Account 612
- Journal 2: full amount matching bank deposit
- xero_journal_id_1 + xero_journal_id_2 stored separately
- LMB9A equivalent: Account 612 (Current Asset, BAS Excluded)

### Rollback / Resend

- Full rollback voids invoice in Xero via API
- Resets status → 'saved', clears all journal IDs
- Granular scope: all / journal_1 / journal_2
- Available in both Amazon and Generic marketplace UIs

### Outstanding Tab

- Fetches AUTHORISED ACCREC from Xero only
- Filtered by accounting_boundary_date (fallback: 12 months)
- Server-side contact whitelist: amazon, shopify, ebay, 
  catch, kogan, bigw, big w, everyday market, mydeal, 
  bunnings, woolworths, mirakl, tradesquare, temu, walmart
- Summary counts accurate (noise excluded server-side)

### GST / BAS

- AU hardcoded: OUTPUT / INPUT / NONE — correct for all paths
- Reimbursements: NONE (BAS Excluded) — matches LMB AU spec
- International sales: GST base correctly excludes non-AU
  orders at calculation level (presentation split = Phase 2)
- ACCPAY bill: INPUT fixed (was OUTPUT — critical BAS bug)
- Advertising Costs: INPUT (GST on purchases)

### Parser

- settlement-parser.ts v1.7.1
- 9-category CATEGORY_MAP including CostOfAdvertising
- Two-pass AU vs international detection
- Split-month aggregation with per-category accumulators
- fetch-amazon-settlements edge function mirrors same map

---

## LMB AU Complete Account Reference

| LMB Code | Name | Type | Xettle Equivalent |
|---|---|---|---|
| LMB1 | Amazon Sales | Revenue | 200 |
| LMB10 | Amazon Refunds | Revenue | 205 |
| LMB2 | FBA Reimbursements | Other Income | 271 |
| LMB3 | Seller Fees | Expenses | 407 |
| LMB4 | FBA Fees | Expenses | 408 |
| LMB5 | Storage Fees | Expenses | 409 |
| LMB6 | Advertising Costs | Expenses | 410 ✅ added S6 |
| LMB7 | Sales Tax | Current Liability | N/A for AU |
| LMB8 | Amazon Loans | Current Liability | N/A for AU |
| LMB9 | Reserved Balances | Current Asset | ❌ not built |
| LMB9A | Split Month Rollovers | Current Asset | 612 ✅ |

LMB AU GST defaults (our implementation matches):
- AU Sales → GST on Income (OUTPUT)
- International Sales → GST Free (Phase 2 presentation)
- Reimbursements → BAS Excluded (NONE) ✅
- Fees → GST on Expenses (INPUT) ✅

---

## Known Gaps (priority order for Session 7+)

### 🔴 High Priority

1. Xero Tracking Categories
   - Built in this session (confirm status)
   - opt-in toggle, "Sales Channel" category
   - Per-marketplace option auto-created
   - Enables per-channel P&L inside Xero

2. Audit CSV attach to Xero invoice
   - Not built
   - LMB does this within 48hrs automatically  
   - Xero API: PUT /Invoices/{id}/Attachments
   - Attach raw settlement CSV to invoice on push
   - Major accountant trust signal

3. Negative rollover detection
   - Small negative ACCPAY bills (<~$20) sit orphaned
   - Amazon rolls these into next settlement
   - Need: detect repayment line in following settlement
   - Net the bill to $0.00 using Account 612

### 🟡 Medium Priority

4. Reserved Balance account
   - No LMB9 equivalent exists
   - Amazon reserves affect settlement totals
   - Current approach: absorbed into net (works but not ideal)
   - Low urgency for AU sellers

5. Split-month for generic marketplaces
   - Currently Amazon-only
   - Bunnings/Catch/MyDeal use fixed payment schedules
   - Lower risk of cross-month splits

6. International sales presentation split (Phase 2)
   - GST calculation already correct
   - Just needs two Sales lines on Xero invoice
   - Requires au_sales + intl_sales columns on settlements
   - Schema change — do carefully

### 🟢 Lower Priority  

7. Industry benchmarking
8. Accountant partner dashboard
9. Stripe billing (Phase 4)

---

## LMB Competitive Intelligence Summary

### What LMB does that Xettle now also does

✅ Multi-line settlement invoice (9 categories)
✅ Per-user account code mapping
✅ GST correct per line (OUTPUT/INPUT/NONE)
✅ Split-month rollover invoices
✅ Rollback and resend
✅ Advertising costs separated
✅ Reimbursements BAS-excluded
✅ Boundary date protection

### What LMB does that Xettle doesn't yet

❌ Audit file attached to Xero invoice
❌ Xero Tracking Categories (building)
❌ Reserved balance account
❌ Negative rollover auto-detection
❌ COGS tracking (deferred)
❌ Industry benchmarking
❌ Accountant partner dashboard

### What Xettle does that LMB cannot

✅ AI account mapper (reads CoA, no wizard needed)
✅ Accounting boundary detection (never double-posts)
✅ Pre-push validation summary
✅ Multi-marketplace from single Shopify connection
✅ Flat pricing regardless of order volume
✅ Settlement-based (LMB bug: includes cancelled orders)

---

## LMB Pricing vs Xettle (AU)

| Plan | LMB AUD/mo | Xettle AUD/mo |
|---|---|---|
| Entry | $32 (200 orders, 1 channel) | $129 (all channels) |
| Mid | $102 (5k orders, 2 channels) | $129 flat |
| High | $176 (10k orders, 5 channels) | $229 flat |

LMB charges per order volume + per channel.
Xettle is flat rate — advantage grows with volume/channels.

---

## Architecture Rules (unchanged — never break)

1. Orders NEVER create accounting entries directly
2. Settlements are the ONLY source of accounting entries
3. Never auto-post historical entries
4. Always require user approval before Xero push
5. Never touch anything before accounting_boundary_date
6. Confidence below 70% → ask user, never auto-process
7. Negative net → ACCPAY Bill / Positive net → ACCREC Invoice
8. source='api' settlements NEVER show as Upload Needed
9. already_recorded settlements never show as missing
10. Never auto-post. Never assume. Always show first.

---

## Session 7 First Tasks

1. Confirm Xero Tracking Categories build status
   - Was sent to Lovable this session, result not confirmed
   - If complete: test with a real settlement push
   - If incomplete: resend prompt from session 6 notes

2. Audit CSV attach to Xero invoice
   - Write and send prompt
   - Edge function: after successful push, 
     PUT /api.xro/2.0/Invoices/{xeroId}/Attachments
   - File: raw settlement CSV from settlements.raw_payload

3. Negative rollover detection
   - Detect 'Repayment of negative Amazon Balance' line
   - Auto-net the previous ACCPAY bill to $0.00

4. Real-world push test
   - Push Big W $534.94 settlement to Xero
   - Verify line items, GST, bank matching auto-triggers
   - Check system_events for correct event logging
