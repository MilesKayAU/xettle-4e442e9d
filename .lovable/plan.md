

## Plan: Bulk Push Selection + COA Overwrite Protection

### Problem
1. Users can only push **one row at a time** from the Overview grid — no way to select multiple rows for bulk push.
2. When COA account mappings already exist and are linked to Xero, there's no protection against accidentally overwriting them. If no COA exists yet, the system should be relaxed (new mapping is fine).

### Changes

#### 1. Add Bulk Selection to ValidationSweep (checkbox column)

**File:** `src/components/onboarding/ValidationSweep.tsx`

- Add a checkbox column as the first column in the table header (select all) and each row (select individual).
- Track selected row IDs in a `Set<string>` state.
- Only allow selection of rows with `overall_status === 'ready_to_push'` (rows that can actually be pushed).
- Add a floating action bar that appears when ≥1 row is selected: **"Push N selected to Xero →"** button.
- Clicking the bulk push button opens `PushSafetyPreview` with all selected settlements (it already supports an array of `{ settlementId, marketplace }`).
- Include a "Select all ready" shortcut that selects all `ready_to_push` rows at once.

#### 2. COA Overwrite Protection in PushSafetyPreview

**File:** `src/components/admin/accounting/PushSafetyPreview.tsx`

The `buildValidationChecks` function already validates account codes against the Xero COA. Enhance it:

- **Already-pushed detection** (exists): If `xero_invoice_id` is set on the settlement row OR a match exists in `xero_accounting_matches`, it's already a **red block**. This is the strongest protection — keep as-is.
- **Overwrite warning (new)**: If the settlement has `xero_pushed = true` in its validation row but is being re-pushed (e.g., after a repost), add an **amber** warning: *"This settlement has an existing Xero record. Pushing will create a new invoice — ensure the previous one was voided."*
- **COA conflict alert (new)**: When account codes resolve to mapped codes that differ from codes used in a previous push for the same marketplace+period, show an **amber** alert: *"Account codes differ from previous push — review before confirming."*
- If no COA mapping exists at all (unmapped), the existing `MAPPING_REQUIRED` red block already handles this — no change needed.

#### 3. Overwrite Confirmation for Account Mapper

**File:** `src/components/settings/AccountMapperCard.tsx` (or `DestinationAccountMapper.tsx`)

- When saving account mappings, if a mapping already exists with a different account code, show an inline confirmation: *"⚠️ This will overwrite [Category] from [old code] → [new code]. Confirm?"*
- If no previous mapping exists, save silently (relaxed behavior).

### Technical Details

- `PushSafetyPreview` already accepts `settlements: Array<{ settlementId, marketplace }>` — bulk push requires no API changes.
- The `sync-settlement-to-xero` edge function processes one settlement at a time, so bulk push will iterate through selected settlements sequentially via the existing `onConfirm` callback.
- Checkbox state resets on filter/page change to avoid confusing UX.
- The floating bulk action bar uses a sticky position at the bottom of the card for visibility.

### Files Affected
- `src/components/onboarding/ValidationSweep.tsx` — checkbox column, bulk selection state, floating action bar
- `src/components/admin/accounting/PushSafetyPreview.tsx` — enhanced overwrite warnings in `buildValidationChecks`
- `src/components/settings/DestinationAccountMapper.tsx` — overwrite confirmation when changing existing mapped codes

