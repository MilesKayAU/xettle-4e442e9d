

## Add per-marketplace postage cost input

### Current state
- `FulfilmentMethodsPanel` exists at **Settings → Fulfilment Methods** accordion — renders radio buttons for method selection only
- `profit-engine.ts` accepts `postageCostPerOrder` but nothing supplies a value — always defaults to `0`
- **No dollar input exists anywhere in the UI**

### Plan

#### 1. Add cost input to FulfilmentMethodsPanel (`src/components/settings/FulfilmentMethodsPanel.tsx`)

For each marketplace where method is `self_ship` or `third_party_logistics`, show a dollar input field:
- Label: "Avg. postage cost per order"
- Input type: number, step 0.01, min 0, prefix "$"
- Conditionally visible — hidden when method is `marketplace_fulfilled` or `not_sure`
- Save to `app_settings` with key `postage_cost:{marketplace_code}` on blur/change

#### 2. Add load/save helpers (`src/utils/fulfilment-settings.ts`)

- `loadPostageCosts(userId)` → reads all `postage_cost:*` keys from `app_settings`
- `savePostageCost(userId, code, amount)` → upserts `postage_cost:{code}`

#### 3. Wire into InsightsDashboard (`src/components/admin/accounting/InsightsDashboard.tsx`)

- Fetch postage costs alongside fulfilment methods in `loadStats`
- Pass `postageCostPerOrder` to `calculateMarketplaceProfit()` calls
- Display postage deduction line in the profit breakdown

#### 4. Update dashboard warning (`src/hooks/useDashboardTaskCounts.ts`)

- For marketplaces with `self_ship` or `third_party_logistics` but no postage cost set, include in the setup warning: "Set your average postage cost for [marketplace] in Settings → Fulfilment Methods"

### Files changed
| File | Change |
|------|--------|
| `src/components/settings/FulfilmentMethodsPanel.tsx` | Add conditional `$` input per marketplace |
| `src/utils/fulfilment-settings.ts` | Add `loadPostageCosts` / `savePostageCost` helpers |
| `src/components/admin/accounting/InsightsDashboard.tsx` | Pass postage cost to profit engine |
| `src/hooks/useDashboardTaskCounts.ts` | Warn if cost missing for self-ship/3PL marketplaces |

