

## Clone COA Structure for New Marketplaces

When a marketplace is detected (e.g., BigW) but has no matching accounts in the user's Xero COA, the system should offer to **clone the account structure from an existing marketplace** — creating all the same category accounts (Sales, Shipping, Fees, etc.) with the new marketplace's name and auto-generated codes.

### How It Works

1. **Gap Detection**: When the AI mapper runs or when the user views the Account Mapper with split-by-marketplace enabled, compare active marketplaces against COA accounts. If a marketplace has no matching accounts for any category, flag it as "uncovered."

2. **Clone Wizard Dialog**: Show a prompt like:
   > "BigW has no accounts in your Chart of Accounts. Clone structure from an existing marketplace?"
   
   User picks a **template marketplace** (e.g., Amazon AU) from a dropdown. The system previews all accounts that would be created:
   
   ```text
   Template: Amazon AU           →  New: BigW
   ─────────────────────────────────────────────
   200  Amazon Sales AU          →  2XX  BigW Sales AU
   206  Amazon Shipping AU       →  2XX  BigW Shipping AU  
   205  Amazon Refunds AU        →  2XX  BigW Refunds AU
   407  Amazon Seller Fees AU    →  4XX  BigW Seller Fees AU
   408  Amazon FBA Fees AU       →  (skip — not applicable)
   ...
   ```

3. **Code Generation**: Auto-suggest the next available code in the same range (e.g., if 200-215 are used, suggest 216+). User can edit codes/names before confirming.

4. **Category Relevance Filter**: Let users uncheck categories that don't apply (e.g., BigW won't have FBA Fees). Pre-check/uncheck based on marketplace type.

5. **Batch Create**: Use the existing `create-xero-accounts` edge function (already supports batch creation up to 10 accounts) to push all new accounts to Xero in one go, then refresh the COA cache and auto-map them.

### Implementation

**Frontend (`AccountMapperCard.tsx`):**
- Add `CloneCoaDialog` component with:
  - Template marketplace selector (filtered to marketplaces that have COA accounts)
  - Preview table of accounts to create with editable code/name fields
  - Category checkboxes to skip irrelevant ones
  - Tax type inheritance from template accounts
- Trigger: Show a banner/button when an uncovered marketplace is detected in split mode
- After successful creation, auto-populate the mapping for the new marketplace

**Edge function**: No changes needed — `create-xero-accounts` already handles batch creation, duplicate checking, COA refresh, and system event logging.

**Detection logic** (in `AccountMapperCard`):
- After COA loads + active marketplaces load, scan for marketplaces with zero keyword matches across all categories
- Store "covered" vs "uncovered" status per marketplace
- Show the clone prompt only for uncovered ones

### Key Details

- The `create-xero-accounts` function already validates against existing codes, refreshes the COA cache post-creation, and logs system events — no backend changes required
- Tax types are inherited from the template account (e.g., if Amazon Sales AU uses "GST on Income", BigW Sales AU will too)
- Max 10 accounts per batch — if a full clone exceeds this, batch into multiple calls
- Only available to admin users (matching existing `CreateAccountDialog` gate)

