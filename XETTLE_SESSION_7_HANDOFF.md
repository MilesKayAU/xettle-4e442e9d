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

### ✅ Completed in Session 7

1. Xero Tracking Categories — **BUILT**
   - Opt-in toggle, "Sales Channel" category
   - Per-marketplace option auto-created
   - Enables per-channel P&L inside Xero
   - Caches category/option IDs to avoid repeat API calls

2. Audit CSV attach to Xero invoice — **BUILT**
   - 16-column summary CSV generated from raw_payload
   - PUT to Xero Attachments API on every successful push
   - Both sync-settlement-to-xero and auto-push-xero paths
   - Non-blocking: attachment failure doesn't fail the push
   - Logged to system_events as xero_csv_attachment

### ⏸️ Parked — Needs Real Data

3. Negative rollover detection — **PARKED**
   - Small negative ACCPAY bills (<~$20) sit orphaned
   - Amazon rolls these into next settlement
   - Need: detect repayment line in following settlement
   - **Why parked:** No real Amazon AU settlement data in DB yet.
     Detection string unknown — could be "PreviousReserveAmountBalance",
     "Repayment of negative Amazon balance", or something else.
     Building speculatively risks silent non-firing (never matches)
     or worse — partial match on wrong line causing BAS errors.
   - **Current safety:** Negative settlements create ACCPAY bills
     flagged for review. No auto-post, no auto-net. Safe default.
   - **Unblock:** Push real Amazon AU settlements during testing month,
     inspect raw_payload for exact reserve/repayment field names,
     then build detection logic from real evidence.

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
✅ Audit file attached to Xero invoice
✅ Xero Tracking Categories (per-channel P&L)

### What LMB does that Xettle doesn't yet

❌ Reserved balance account
❌ Negative rollover auto-detection (parked — needs real data)
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

## Session 7 Final Status

### ✅ Task 1: Xero Tracking Categories — BUILT
Files: xero-auth, sync-settlement-to-xero, auto-push-xero,
AccountingDashboard, AccountMapperCard.
Opt-in toggle in Settings + Account Mapper card.
Caches category/option IDs to avoid repeat API calls.
Every line item tagged: Sales Channel → marketplace name.

### ✅ Task 2: Audit CSV attach to Xero invoice — BUILT
Files: sync-settlement-to-xero (buildSettlementCsv + attachSettlementToXero),
auto-push-xero (passes settlementData for CSV generation).
PUT to /Invoices/{id}/Attachments/{filename} with Content-Type: text/csv.
16-column summary: Date, Type, OrderID, SKU, Description, Amount, etc.
Non-blocking — attachment failure logged but doesn't fail the push.

### ⏸️ Task 3: Negative rollover detection — PARKED
Needs real Amazon AU settlement data to identify exact field names.
Speculative build risks BAS errors. Current ACCPAY flagging is safe.

### 🧪 Task 4: Real-world push test — TESTING MONTH
Part of the upcoming testing month. First real push will validate
all Session 6+7 features end-to-end.

---

## Testing Month Roadmap

### Primary Goal
Push real settlements through all paths, validate Xero output,
and collect the raw payload data needed to unblock Task 3.

### While Waiting on Real Data

1. **Deferred Revenue naming** — Surface the split-month feature
   in the UI as "Deferred Revenue Recognition". This is the
   language accountants use and what LMB charges extra for.

2. **Dashboard Insights tab (basic)** — Show per-channel fee %
   and margin from pushed settlements. First step toward the
   benchmarking feature LMB highlights in their AU listing.

### Task 3 Unblock Criteria
- At least one real Amazon AU settlement pushed
- Inspect raw_payload for reserve/repayment line items
- Identify exact field names (likely PreviousReserveAmountBalance
  or similar, but must confirm from real data)
- Build detection logic from evidence, not speculation
