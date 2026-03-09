# Xettle Build Plan

## Smart File Ingestion — IMPLEMENTED ✅

3-level intelligent file ingestion: fingerprint detection → heuristic mapping → AI fallback.
Users upload any file, Xettle auto-detects marketplace, warns on wrong files, creates settlements.

**Files created:** `file-fingerprint-engine.ts`, `generic-csv-parser.ts`, `SmartUploadFlow.tsx`, `ai-file-interpreter/index.ts`
**DB:** `marketplace_file_fingerprints` table with RLS

---

# Plan: Extract Accounting Module into Independent App

## What You Have (Module Inventory)

The accounting module is self-contained with these components:

| Layer | Files | Lines |
|-------|-------|-------|
| **UI** | `src/components/admin/accounting/AccountingDashboard.tsx` | ~3,490 |
| **Parser** | `src/utils/settlement-parser.ts` | ~716 |
| **Xero Invoice Sync** | `supabase/functions/sync-amazon-journal/index.ts` | ~450 |
| **Xero OAuth** | `supabase/functions/xero-auth/index.ts` | existing |
| **Xero Connection UI** | `src/components/admin/XeroConnectionStatus.tsx` | existing |
| **Xero Callback Page** | `src/pages/XeroCallback.tsx` | existing |

**Database tables**: `settlements`, `settlement_lines`, `settlement_unmapped`, `xero_tokens`, `app_settings`, `user_roles`, `profiles`

**Secrets needed**: `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `RESEND_API_KEY` (for notifications)

## Recommended Approach

**Create a new Lovable project** and port the accounting module as the primary app. This is the cleanest path because:

1. You get a fresh Supabase instance (clean DB, no legacy tables)
2. Independent deployment and domain
3. Own auth system focused on bookkeeper access
4. No risk of breaking the Miles Kay e-commerce site

## What the New App Would Include

1. **Auth** — Supabase email auth with admin role
2. **Dashboard** — The AccountingDashboard as the main page (upload, review, history, settings tabs)
3. **Settlement Parser** — `settlement-parser.ts` copied directly
4. **Edge Functions** — `sync-amazon-journal` and `xero-auth` deployed to new Supabase
5. **Xero Integration** — OAuth connection UI + callback page
6. **Settings** — Account code configuration, GST rate
7. **Database** — Migrations for `settlements`, `settlement_lines`, `settlement_unmapped`, `xero_tokens`, `app_settings`, `user_roles`, `profiles`

## What I Cannot Do From Here

Lovable cannot programmatically create a separate project or copy files between projects. You would need to:

1. **Create a new Lovable project** (click + New Project)
2. **Come back here** and I can help you prepare all the code as a single prompt to paste into the new project, or you can reference this project
3. Alternatively, **remix this project** (Settings → Remix) and then strip out everything except the accounting module

## Recommended Next Step

**Remix this project**, then in the new remixed project, ask me to strip it down to only the accounting module — removing all e-commerce pages (Products, Blog, Contact, Distributors, Where To Buy, etc.), the Alibaba invoice system, logistics, and Amazon product sync. This preserves all the accounting code, edge functions, and database schema intact while giving you an independent app.

The remix approach is fastest because all code, edge functions, and Supabase config carry over. You'd just need to connect a new Supabase project and run the database migrations.

---

# Marketplace Dashboard Standard

Every new marketplace dashboard MUST include the following features before shipping. This serves as the architectural checklist for building marketplace parsers and their UI.

## Required Features

### 1. CSV Upload & Parse
- File marketplace detection (reject wrong-marketplace files with warning)
- Auto-detect CSV format variations if applicable
- Parse into `StandardSettlement` via marketplace-specific parser

### 2. Duplicate Detection (on parse)
- **Exact match**: Check `settlement_id + marketplace` against existing `settlements` table
- **Fingerprint match**: Same `period_start + period_end + bank_deposit (±$0.01)`
- Show warning banner in review tab for duplicates
- Mark duplicate payouts visually (dimmed, "Duplicate" badge)
- `saveSettlement()` in settlement-engine.ts handles server-side dedup as final guard

### 3. Gap Detection (on parse)
- Compare earliest parsed payout's `period_start` against latest saved settlement's `period_end`
- If gap exists, show orange warning banner: "Gap detected — you may be missing payouts"

### 4. Reconciliation Checks (review tab)
- Run `runUniversalReconciliation()` on each parsed settlement
- Display checks inline with expandable "Checks" button per payout card
- Show pass/warn/fail icons with detail text per check
- Block Xero sync if `canSync === false` (critical failures)
- Checks include: Balance, GST Consistency, Refund Completeness, Sanity, Historical Deviation, Invoice Accuracy

### 5. Review Tab — Individual Payout Management
- Dismiss/remove button (X) on each payout card (removes from parsed array, not DB)
- Persisted state in localStorage across page refreshes
- Clear All button
- Save All → Push All to Xero flow

### 6. History Tab — Bulk Operations
- Select one / Select all checkboxes
- Bulk delete with confirmation dialog
- **Xero sync-aware bulk delete**: Count synced items in selection, show breakdown ("3 selected, 1 synced to Xero"), warn that Xero invoices won't be removed
- Individual delete for ALL statuses including `synced` (with confirmation dialog for synced items)
- "Xero ✓" badge on synced items when selected
- Push to Xero button for saved/parsed items
- Single-item delete for synced items with warning dialog

### 7. Xero Sync
- Use `syncSettlementToXero()` from settlement-engine.ts
- Build marketplace-specific invoice lines via `buildXInvoiceLines()` function
- Run `runUniversalReconciliation()` before sync — skip if `canSync === false`
- Contact name from `MARKETPLACE_CONTACTS` map in settlement-engine.ts

### 8. Fee Observation Engine
- `saveSettlement()` auto-fires `extractFeeObservations()` for intelligence tracking
- No per-dashboard code needed — handled by settlement-engine.ts

## File Structure for New Marketplaces

```
src/utils/{marketplace}-parser.ts          → CSV parser → StandardSettlement[]
src/components/admin/accounting/{Name}Dashboard.tsx  → Dashboard UI
src/utils/settlement-engine.ts             → Shared save/sync/delete (DO NOT DUPLICATE)
src/utils/universal-reconciliation.ts      → Shared recon checks (DO NOT DUPLICATE)
src/utils/file-marketplace-detector.ts     → Add detection pattern for new marketplace
```

## Currently Implemented Marketplaces

| Marketplace | Parser | Dashboard | Dedup | Gap | Recon | Bulk Delete | Xero Sync |
|---|---|---|---|---|---|---|---|
| Amazon AU | ✅ settlement-parser.ts | ✅ AccountingDashboard.tsx | ✅ | ✅ | ✅ | ✅ | ✅ |
| Shopify Payments | ✅ shopify-payments-parser.ts | ✅ ShopifyPaymentsDashboard.tsx | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bunnings | ✅ bunnings-summary-parser.ts | ✅ BunningsDashboard.tsx | ✅ | — | ✅ | ✅ | ✅ |
| Catch / MyDeal / Kogan / Woolworths | — | ✅ GenericMarketplaceDashboard.tsx (placeholder) | — | — | — | — | — |
