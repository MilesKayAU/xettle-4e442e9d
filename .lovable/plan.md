

## Make CSV Step Context-Aware

### Current Behavior
Step 3 always shows the full CSV marketplace grid regardless of what Xero/Shopify detected. The selections only live in sessionStorage and are used to show upload file slots — they don't create `marketplace_connections` until a file is actually uploaded via SmartUploadFlow.

### The Real Question
- If user connected **Xero** → `scan-xero-history` will auto-detect marketplaces from invoice contacts and create `marketplace_connections` + validation rows. These will show as "Upload Needed" on the dashboard automatically.
- If user connected **Shopify** → `scan-shopify-channels` will auto-detect sub-channels and create connections.
- Step 3's manual CSV selection is a **guarantee** layer — it ensures the upload step shows file slots even before automation runs.

### Recommendation: Lean on Automation, Simplify Step 3

**Change step 3 behavior based on what was connected in steps 1-2:**

1. **If Xero was connected** (most common): Step 3 becomes a lightweight "Anything else?" prompt rather than a full marketplace grid. The messaging changes to: "We'll automatically detect your marketplaces from Xero. If there's anything new that isn't in Xero yet, add it here." Show the grid but de-emphasize it — collapsed or behind a "Add manually" link.

2. **If neither Xero nor APIs connected**: Step 3 stays as-is — the full grid is essential since there's no automation to fall back on.

3. **If Shopify + Amazon both connected but no Xero**: Similar to #1 — automation will handle most channels, but offer the manual option for CSV-only marketplaces like Bunnings.

### File Changes

**`src/components/onboarding/SetupStepConnectStores.tsx`** — Step 3 card:

- Accept `hasXero` prop (already passed)
- If `hasXero` is true: Show a confident message ("Xero will detect your marketplaces automatically"), collapse the CSV grid behind an expandable "Add a marketplace not in Xero yet" link
- If `hasXero` is false AND (hasShopify OR hasAmazon): Show "We'll detect channels from your connected stores. Need to add CSV-only marketplaces?" with the grid visible but optional
- If nothing connected: Show full grid prominently as the primary way to set up

- Add `Collapsible` wrapper around the CSV grid when Xero is connected
- Change the heading text dynamically based on connection state
- Keep the custom marketplace input always visible (it's useful regardless)

**No other file changes needed** — the `SetupWizard` already handles the `shouldShowUpload` logic correctly, and the dashboard/SmartUploadFlow already deduplicate `marketplace_connections`.

### Why This Works
- Automation creates `marketplace_connections` → validation sweep creates "settlement_needed" rows → dashboard shows "Upload Needed" cards
- Manual selection just pre-creates upload slots for the onboarding upload step
- Both paths converge on the same `marketplace_connections` table with duplicate checking
- Users who connected Xero get a faster, more confident onboarding; users who didn't get the manual safety net

