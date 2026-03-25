

## Plan: Canonical Data Integrity Scanner Panel on Dashboard Home

### Problem

There is no single place for a bookkeeper to verify that all system data is accurate before working. Scans (validation sweep, bank matching, Xero sync, profit recalculation, eBay re-fetch) are scattered across different pages, buttons, and fire-and-forget calls. The bookkeeper has no visibility into when each was last run or whether data is stale.

### Solution

Add a **"Data Integrity Scanner"** card to the Dashboard Home view (below SystemStatusStrip, above ActionCentre). It shows a list of canonical scan operations, each with:
- Last run timestamp
- Status indicator (green = fresh < 1hr, amber = stale > 1hr, red = never run)
- Individual "Run" button
- A "Run All" button that chains them in sequence

### The 5 Critical Scans

| # | Scan | What it does | Edge function / action | Stores last-run in |
|---|------|-------------|----------------------|-------------------|
| 1 | **Validation Sweep** | Recomputes all settlement statuses, reconciliation gaps, missing periods | `run-validation-sweep` | `app_settings.last_validation_sweep` |
| 2 | **Bank Deposit Matching** | Matches Xero bank transactions to settlements | `match-bank-deposits` | `app_settings.last_bank_match` |
| 3 | **Xero Invoice Sync** | Refreshes invoice statuses from Xero | `sync-xero-status` (via `runXeroSync()`) | `app_settings.last_xero_sync` |
| 4 | **API Settlement Fetch** | Re-fetches latest settlements from eBay/Amazon/Mirakl APIs | `scheduled-sync` (via `runMarketplaceSync()`) | `app_settings.last_marketplace_sync` |
| 5 | **Profit Recalculation** | Rebuilds settlement_profit from authoritative data | `recalculate-profit` | `app_settings.last_profit_recalc` |

### Implementation

**1. New canonical action: `src/actions/dataIntegrity.ts`**

Exports:
- `runDataIntegrityScan(scanKey)` — runs a single scan, updates `app_settings` with timestamp on success
- `runAllDataIntegrityScans()` — runs all 5 in order, returning per-scan results
- `getLastScanTimestamps()` — reads all 5 `app_settings` keys in one query
- `SCAN_DEFINITIONS` — array of `{ key, label, description, edgeFunction }` for the 5 scans

Each scan function calls the existing canonical actions (`runXeroSync`, `runMarketplaceSync`, `triggerValidationSweep`, etc.) and writes a `last_<scan>` timestamp to `app_settings` on success.

**2. New component: `src/components/dashboard/DataIntegrityScanner.tsx`**

UI card with:
- Header: "Data Integrity" with a shield icon
- 5 rows, one per scan, showing: name, description, last-run timestamp (relative, e.g. "12 min ago"), status dot, individual "Run" button
- "Run All Scans" button at bottom that sequentially triggers each scan with a progress indicator
- While a scan is running, its row shows a spinner and the button is disabled
- After completion, timestamps refresh automatically

**3. Wire into Dashboard Home**

File: `src/pages/Dashboard.tsx`

Add `<DataIntegrityScanner />` between SystemStatusStrip and the Kogan missingPdf alert (around line 1059), only visible when `xeroConnected || userMarketplaces.length > 0`.

**4. Export from canonical barrel**

File: `src/actions/index.ts`

Add exports for the new `dataIntegrity` module.

### Timestamp Storage

Uses existing `app_settings` table (key/value per user). Keys:
- `last_validation_sweep`
- `last_bank_match`
- `last_xero_sync`
- `last_marketplace_sync`
- `last_profit_recalc`

No database migration needed — `app_settings` already supports arbitrary keys with RLS per user.

### Files Modified

| File | Changes |
|------|---------|
| `src/actions/dataIntegrity.ts` | **New** — canonical scan orchestrator with 5 scan types |
| `src/actions/index.ts` | Export new data integrity actions |
| `src/components/dashboard/DataIntegrityScanner.tsx` | **New** — scanner card UI with per-scan rows, timestamps, run buttons |
| `src/pages/Dashboard.tsx` | Import and render DataIntegrityScanner on home view |

### No database changes needed

