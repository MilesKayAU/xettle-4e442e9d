

## Plan: Build Setup Hub at `/setup`

### Current State
- All edge functions exist and work: `scan-xero-history`, `fetch-amazon-settlements`, `fetch-shopify-payouts`, `fetch-shopify-orders`, `scan-shopify-channels`, `match-bank-deposits`, `run-validation-sweep`
- `detectCapabilities()` and `callEdgeFunctionSafe()` in `sync-capabilities.ts` — ready to use
- `provisionAllMarketplaceConnections()` in `marketplace-token-map.ts` — already uses `upsert` with `onConflict`
- `SubChannelSetupModal` exists with `DetectedSubChannel` interface
- `SetupStepResults.tsx` already has Phase A/B scan orchestration inside the wizard modal — Setup Hub replaces this as the post-wizard experience
- Dashboard first-load trigger already exists at lines 218-293

### Files to Create/Modify

| File | Action | Size |
|------|--------|------|
| `src/pages/Setup.tsx` | **Create** | ~450 lines |
| `src/App.tsx` | **Modify** | Add 2 lines (import + route) |
| `src/components/onboarding/SetupWizard.tsx` | **Modify** | Change `onComplete` to navigate to `/setup` when APIs connected |
| `src/pages/Dashboard.tsx` | **Modify** | Add slim "Continue setup" banner |

### Setup.tsx Architecture

**Phase 1 — Auto-runs on mount, parallel per API**

Uses `detectCapabilities()` to determine which rows to show. Each row has:
- Time-based progress bar (Xero 30s, Shopify 60s, Amazon 120s)
- Three visible states per `callEdgeFunctionSafe()` call: ✅ success with data summary, ⏭️ skipped with reason, ⚠️ error with [Retry] and actual error message

Shopify enforces A→B→C sequence:
- Step A: `fetch-shopify-payouts`
- Step B: `fetch-shopify-orders`
- Step C: Before calling `scan-shopify-channels`, query `shopify_orders` count. If 0: show "⚠️ Orders fetch returned 0 results — sub-channel detection skipped." Do NOT call `scan-shopify-channels`.

Each completed scan writes its `app_settings` flag. Progress bars jump to 100% when flag detected (poll every 5s).

**Phase 2 — Button unlocks when ANY Phase 1 complete**

Button: `[Identify my marketplaces →]` — disabled with tooltip until at least one Phase 1 flag exists.

When clicked:
1. Call `provisionAllMarketplaceConnections(userId)` 
2. Query `channel_alerts` and `marketplace_connections` for display
3. Show: "Found: Shopify Payments, Amazon AU, BigW (64 orders)..."
4. "Missing something? [+ Add manually]" opens `SubChannelSetupModal`
5. Write `setup_phase2_complete` to `app_settings`

**Phase 3 — Button unlocks when Phase 2 complete**

When clicked, calls in order:
1. `match-bank-deposits` (triangulates Xero bank feed against payouts/deposits)
2. `run-validation-sweep` (full picture with bank matching data)

Then queries `marketplace_validation` for 5-category breakdown:
- Already in Xero and verified (`overall_status = 'complete'`)
- Pushed to Xero, no bank match (`overall_status = 'pushed_to_xero'`)
- Ready to push (`overall_status = 'ready_to_push'`)
- Unmatched deposits (from `channel_alerts` where `alert_type = 'unmatched_deposit'`)
- Upload needed (`overall_status = 'missing'` or `'settlement_needed'`)

Write `setup_phase3_complete`. Show "Go to Dashboard" (sets `setup_hub_dismissed = true`, navigates to `/dashboard`).

**Polling**: Every 5s, query `app_settings` for phase flags. Stop when all Phase 1 flags present.

### Error Handling Standard

Every `callEdgeFunctionSafe()` result handled:
```typescript
const result = await callEdgeFunctionSafe(name, token, body);
if (result.ok) {
  setStatus('success'); setMessage(`✅ ${summary}`);
} else {
  setStatus('error'); setMessage(result.error || 'Unknown error');
  // Render [Retry] button
}
```

Skipped steps show ⏭️ with reason (e.g. "Shopify not connected").

### Route & Navigation

**App.tsx**: Add `/setup` inside `AuthenticatedLayout` route group, lazy-loaded.

**SetupWizard.tsx**: In `handleComplete` (line 96-100), check if any API connected. If yes, navigate to `/setup`. If CSV-only, call existing `onComplete()` which goes to dashboard. Requires adding `useNavigate` and the `hasXero/hasAmazon/hasShopify` props are already available.

**Dashboard.tsx**: At the top of the dashboard view (before `PostSetupBanner` at line 553), add a slim banner:
- Query `app_settings` for `setup_hub_dismissed` and `setup_phase3_complete` on mount
- If neither is `true`, show: "Your account setup is in progress → [Continue setup]" linking to `/setup`
- Auto-dismiss once flags are set

### Scan Sequence Diagram

```text
Phase 1 (parallel per API):
  Xero:    scan-xero-history ─────────────────→ ✅/⚠️
  Shopify: fetch-payouts → fetch-orders → 
           (if orders>0) scan-channels ────────→ ✅/⚠️
  Amazon:  fetch-amazon-settlements ───────────→ ✅/⚠️

Phase 2 (user-triggered, after any Phase 1):
  provisionAllMarketplaceConnections ──────────→ ✅

Phase 3 (user-triggered, after Phase 2):
  match-bank-deposits → run-validation-sweep ──→ ✅
```

### User Variants
- **Xero only**: 1 Phase 1 row, Phase 2 provisions from Xero contacts, Phase 3 shows upload needed
- **Shopify only**: 1 Phase 1 row with 3 sub-steps, Phase 2 detects sub-channels, Phase 3 shows push ready  
- **Amazon only**: 1 Phase 1 row, Phase 2 shows Amazon AU, Phase 3 shows ready to push
- **All three**: 3 parallel Phase 1 rows, full Phase 2/3
- **CSV only**: Wizard redirects to dashboard, skips Setup Hub entirely

