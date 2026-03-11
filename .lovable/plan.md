

## Fix: Stop Force-Creating Amazon AU for New Users

### Problem
Two issues found:

1. **`src/pages/Dashboard.tsx` lines 185-207**: When no marketplace connections exist, the code **auto-creates an Amazon AU connection** for every new user. This is why your demo account shows Amazon even though you never selected it.

2. **Validation sweep + Reconciliation Hub**: Because Amazon AU exists as a connection, the validation sweep generates "Missing settlement" alerts for it, creating confusing negative alerts for users who never intended to use Amazon.

### Fix

**1. Remove the auto-create Amazon AU fallback** (`src/pages/Dashboard.tsx`)
- Delete the `else` block (lines 185-208) that inserts `amazon_au` into `marketplace_connections` when no connections exist
- When no marketplaces exist, set `userMarketplaces` to an empty array and let the WelcomeGuide handle onboarding

**2. Handle empty marketplace state gracefully** (`src/pages/Dashboard.tsx`)
- When `userMarketplaces` is empty, show the Dashboard tab with WelcomeGuide instead of trying to render a marketplace dashboard
- The marketplace switcher should handle zero marketplaces without breaking

**3. Update hardcoded `amazon_au` defaults**
- `selectedMarketplace` default of `'amazon_au'` (line 149) → change to empty string or first available
- Connection status bar click handler (lines 379-381) → navigate to settings without assuming amazon_au
- Settings button (lines 362-365) → same fix

### Files to Change
- **Edit**: `src/pages/Dashboard.tsx` — remove auto-create, handle empty state, fix hardcoded defaults

