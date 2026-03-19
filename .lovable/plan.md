

## FBM (Merchant-Fulfilled) End-to-End Support Plan

### Current State

The system already has the core plumbing for FBM:
- `fulfilment_channel` column on `settlement_lines` (AFN/MFN/MCF)
- `mixed_fba_fbm` mode in `FulfilmentMethodsPanel` (Amazon-only)
- `getPostageDeductionForOrder()` correctly branches: AFN = $0, MFN = postage cost, MCF = MCF cost
- Backfill infers AFN vs MFN from fee patterns on historical data
- Profit engine (`recalculate-profit`) does line-level splits in mixed mode

### Gaps to Fix

**1. Onboarding doesn't ask about fulfilment method**
- The Setup Wizard (`SetupWizard.tsx`) has 4 steps: Connect Xero, Marketplaces, Add Settlements, Verify
- No step asks "How do you fulfil orders?" — users only discover the setting buried in Settings > Fulfilment Methods
- Fix: After Amazon is connected/selected in Step 2, show a fulfilment method prompt (FBA / FBM / Mixed). Pre-select "FBA" as default. This sets `app_settings` immediately so the first profit calculation is correct.

**2. MCF cost input only visible for Amazon in mixed mode**
- Line 245: `const showMcfInput = isAmazon && effective === 'mixed_fba_fbm'`
- Kogan/BigW sellers using Amazon MCF for fulfilment can't configure their MCF cost
- Fix: Show MCF cost input for ANY marketplace that has at least one MCF-tagged settlement line, or allow a global MCF default in settings

**3. No "add FBM later" flow**
- If a user starts as 100% FBA then begins self-fulfilling, there's no prompt or detection
- Fix: When the backfill or parser detects MFN lines on a marketplace set to `marketplace_fulfilled`, surface a banner: "We detected merchant-fulfilled orders — update your fulfilment setting?"

**4. Xero/COA impact — no changes needed**
- FBM orders post to the same Amazon Xero invoice as FBA orders (same settlement, same marketplace contact)
- The only difference is profit calculation (postage deduction). No separate COA accounts needed.
- MCF similarly stays under its parent marketplace in Xero

### Implementation Steps

| # | Change | File(s) |
|---|--------|---------|
| 1 | Add fulfilment method question to onboarding Step 2 when Amazon is selected | `SetupStepConnectStores.tsx` or new `SetupStepFulfilment.tsx` |
| 2 | Widen MCF cost visibility to any marketplace with MCF lines (query `settlement_lines` for MCF channels) | `FulfilmentMethodsPanel.tsx` |
| 3 | Add detection banner when MFN lines found on a `marketplace_fulfilled` account | `FulfilmentMethodsPanel.tsx` or `ChannelAlertsBanner.tsx` |
| 4 | Run backfill automatically after onboarding completes (if Amazon connected) | `SetupStepResults.tsx` |

### What stays the same
- Settlement parsing, Xero posting, COA mapping — all unchanged
- MCF is NOT a separate marketplace — it's a fulfilment tag on lines within existing marketplaces
- FBM is NOT a separate marketplace — same Amazon settlement, just different postage deduction

### Technical Detail

The `self_ship` fulfilment method already functions identically to "pure FBM" — every order gets postage deducted. The `mixed_fba_fbm` mode enables line-level granularity. So the system already handles pure FBM accounts correctly if the user selects `self_ship`; the gap is purely discoverability (onboarding prompt + detection alerts).

