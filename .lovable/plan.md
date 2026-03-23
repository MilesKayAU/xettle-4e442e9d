
## Mirakl Settlement Rail — IMPLEMENTED

### What was built

1. **Database**: `mirakl_tokens` table with RLS policies for per-user credential storage
2. **Edge Functions**:
   - `mirakl-auth` — connect/status/disconnect actions
   - `fetch-mirakl-settlements` — fetches Mirakl transaction logs, maps to standard settlement format
   - `scheduled-sync` — updated to include Mirakl users in sync pipeline (Step 4.7)
3. **Shared helper**: `_shared/mirakl-token.ts` — OAuth token refresh with API-key fallback
4. **UI**: `MiraklConnectionPanel.tsx` — connection form with marketplace dropdown (Bunnings, Catch, MyDeal, Kogan, Decathlon, Other)
5. **Integration points**:
   - Added to `BunningsDashboard.tsx` (rendered above PDF upload as primary option)
   - Added to `ApiConnectionsPanel.tsx` (settings page)
   - Added `mirakl_marketplace` to `settlement-rails.ts` with alias `mirakl`
   - Updated `MarketplaceSwitcher.tsx` — Bunnings now shows `mirakl_api` + `manual_csv`, phase `live`

### Safety rules implemented in fetch-mirakl-settlements

1. **Numeric coercion**: `Number(txn.amount) || 0` before accumulation
2. **Flexible payout detection**: `type.includes('PAYMENT') || type.includes('PAYOUT') || type.includes('TRANSFER')`
3. **Tolerant reconciliation**: <$0.05 exact, <$1 warning-only, >$1 blocks auto-push
4. **Unknown type logger**: `mirakl_unknown_transaction_type` system_event with full metadata
5. **Empty settlement guard**: `hasActivity` check skips settlements with no meaningful values
