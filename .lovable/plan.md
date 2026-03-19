

## FBM Postage Cost in Onboarding — Consistency Fix

### Problem
The FulfilmentMethodsPanel (Settings page) already works correctly for Amazon FBM — selecting "Self-fulfilled" shows the postage cost input, identical to Kogan/Mydeal/Shopify. However, the **onboarding wizard** (SetupStepConnectStores) saves the fulfilment choice but doesn't prompt for the postage cost when the user picks Self-fulfilled or Mixed. This means profit calculations run with $0 postage until the user discovers the Settings page.

### What's Already Working
- FulfilmentMethodsPanel: postage input appears for `self_ship`, `third_party_logistics`, and `mixed_fba_fbm` — same UX across all marketplaces (screenshot confirms this)
- Profit engine: `getPostageDeductionForOrder()` correctly deducts postage for MFN/self_ship lines
- Amazon FBM is **not** a separate marketplace — it uses the same Amazon settlement, same Xero invoice, same COA. The only difference is the postage deduction in profit calcs

### Change
**File: `src/components/onboarding/SetupStepConnectStores.tsx`**

Add a postage cost input below the Amazon fulfilment radio group that appears when `amazonFulfilmentChoice` is `self_ship`, `third_party_logistics`, or `mixed_fba_fbm`. On advance, save the value to `app_settings` via `savePostageCost()` alongside the fulfilment method. This mirrors exactly what the Settings panel does, ensuring day-one accuracy.

### Technical Detail
- Import `savePostageCost` from `@/utils/fulfilment-settings`
- Add state: `amazonPostageCost` (string, default `''`)
- Show input when `['self_ship', 'third_party_logistics', 'mixed_fba_fbm'].includes(amazonFulfilmentChoice)`
- In `advanceFromAmazon()`, call `savePostageCost(user.id, 'amazon_au', parseFloat(amazonPostageCost))` after saving the method
- Label: "Avg. postage cost per order" with `$` prefix, matching Settings panel styling

