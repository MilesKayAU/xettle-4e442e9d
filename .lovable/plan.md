

## Add Expandable Xero Payload Preview to Settlement Cards

### Problem
The Action Queue (ReconciliationHub) shows settlement summary data but provides no way to see what will actually be sent to Xero -- the proposed line items, account codes, tax types, and attachments. Users must push to find out.

### Solution
Add an expand/collapse button on each settlement card that loads and displays the proposed Xero invoice payload inline, reusing the existing `buildPostingLineItems` logic from `PushSafetyPreview`.

### Implementation

**Single file change: `src/components/admin/accounting/ReconciliationHub.tsx`**

1. **Add expand state**: Track which settlement card is expanded (`expandedPayload: string | null`)

2. **Add a "Preview Xero payload" button** (eye icon) next to the existing note button on settlement-type cards

3. **On expand, load the proposed payload**:
   - Fetch the full settlement row from `settlements` table
   - Fetch user's `accounting_xero_account_codes` from `app_settings`
   - Call `buildPostingLineItems()` and `toLineItemPreviews()` from `@/utils/xero-posting-line-items` (same logic PushSafetyPreview uses)
   - Cache the result so re-expanding is instant

4. **Render an inline collapsible section** showing:
   - **Contact name** (from `MARKETPLACE_CONTACTS`)
   - **Reference** (`Xettle-{settlement_id}`)
   - **Line items table**: Description | Account Code | Tax Type | Amount
   - **Totals row**: Sum of line items vs bank deposit
   - **Attachments note**: "2 files will be attached: Line-item CSV + Raw source data"
   - **GST summary**: GST on income / GST on expenses

5. **Imports to add**: `buildPostingLineItems`, `toLineItemPreviews`, `createAccountCodeResolver`, `MARKETPLACE_CONTACTS` from existing utils, plus `Eye` icon from lucide-react

No new components, no database changes, no edge function changes. This reuses the exact same payload builder that the actual push uses, so what you see is exactly what Xero will receive.

