

## Rebrand Mirakl Panel as "Bunnings Marketplace Sync"

### Problem
Australian users don't know what "Mirakl" is — they know Bunnings. The current UX exposes Mirakl terminology everywhere. Catch, MyDeal, Kogan etc. don't actually use Mirakl API sync in practice, so the dropdown is misleading.

### Changes

**1. Rename `MiraklConnectionPanel` → Bunnings-first UX**
- Title: "Bunnings Marketplace Sync" (not "Mirakl API Connection")
- Description: "Auto-import settlement data from Bunnings Marketplace."
- Remove the marketplace dropdown (Catch, MyDeal, Kogan, Decathlon, Other) — hardcode to Bunnings with its base URL
- Keep `selectedMarketplace = 'Bunnings'` and `baseUrl = 'https://marketplace.bunnings.com.au'` as fixed values
- Remove "Mirakl" from all user-facing strings: toasts, confirmations, helper text
- Replace "Mirakl Connect" / "Classic Mirakl" labels with "OAuth (recommended)" / "API Key"
- Info box: reword to mention "Bunnings Marketplace" instead of "Mirakl Connect apps"
- Loading text: "Checking Bunnings connection..." instead of "Checking Mirakl connection..."
- Disconnect confirm: "Disconnect Bunnings Marketplace?"
- Keep the component filename as `MiraklConnectionPanel.tsx` internally (no need to rename imports everywhere)

**2. Settings page (`ApiConnectionsPanel.tsx`)**
- Change section label from "Mirakl" to "Bunnings Marketplace"
- The generic MiraklConnectionPanel there should also show Bunnings-branded UX (it already defaults to Bunnings)

**3. BunningsDashboard.tsx**
- No changes needed — it already passes `marketplaceFilter="bunnings"` and will inherit the new branding

**4. Landing page / marketing content**
- Out of scope for this change, but noted: website should list "Bunnings Marketplace" as a supported API sync channel

### No changes to
- Backend edge functions (mirakl-auth, fetch-mirakl-settlements) — internal naming stays as-is
- Database table name (mirakl_tokens) — internal only
- Auth header logic
- Settlement processing

