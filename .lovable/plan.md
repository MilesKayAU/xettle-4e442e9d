

## Plan: AI Confidence Reasoning + Bank Deposit Verification

### 1. Database Migration

Add 4 columns to `settlements` table:

```sql
ALTER TABLE public.settlements
  ADD COLUMN bank_verified boolean DEFAULT false,
  ADD COLUMN bank_verified_amount numeric,
  ADD COLUMN bank_verified_at timestamptz,
  ADD COLUMN bank_verified_by uuid;
```

### 2. AI Edge Function — Add `confidence_reason`

**File:** `supabase/functions/ai-file-interpreter/index.ts`

Add `confidence_reason` string property to both `analyse_file` and `detect_marketplace` tool schemas with description: "Human-readable explanation referencing specific column names or values that justify the confidence score." Add to `required` arrays.

### 3. Fingerprint Engine — Surface `confidenceReason`

**File:** `src/utils/file-fingerprint-engine.ts`

- Add `confidenceReason?: string` to `FileDetectionResult` interface (line 24)
- For Level 1 fingerprint matches, auto-generate a reason like "Matched known column signature: [requiredColumns]"
- For Level 2 heuristic matches, generate "Matched heuristic fields: [matchedFields]"

### 4. SmartUploadFlow — Display confidence reason

**File:** `src/components/admin/accounting/SmartUploadFlow.tsx`

- Capture `confidence_reason` from AI response and store on detection result
- Display below confidence badge: italic text "Why we think this: [reason]"

### 5. GenericMarketplaceDashboard — Bank Verification Flow

**File:** `src/components/admin/accounting/GenericMarketplaceDashboard.tsx`

Major changes to settlement cards:

- Add `bank_verified`, `bank_verified_amount`, `bank_verified_at`, `bank_verified_by` to `SettlementRow` interface
- Add state: `verifyingId`, `bankAmountInput`, `bankVerifyConfirmed`
- When user clicks "Push to Xero" on a syncable settlement, instead of pushing immediately, show inline verification panel:
  - Bank reference + date display
  - AUD input field for actual bank deposit amount
  - Xettle calculated amount shown beside it
  - Match within $0.05 → green checkmark, enable push
  - Mismatch → warning with diff, require checkbox confirmation
  - "Skip verification" link that shows warning tooltip on Push button but still allows push
- On push: save `bank_verified`, `bank_verified_amount`, `bank_verified_at`, `bank_verified_by` to settlements table
- Show verification badge on each card: "✅ Bank verified $X — date" or "⚠️ Bank not verified"
- Load these fields in `loadSettlements` select query

### Files Changed

1. **DB migration** — 4 new columns on `settlements`
2. `supabase/functions/ai-file-interpreter/index.ts` — `confidence_reason` in both tool schemas
3. `src/utils/file-fingerprint-engine.ts` — `confidenceReason` on `FileDetectionResult`, auto-generate for L1/L2
4. `src/components/admin/accounting/SmartUploadFlow.tsx` — Display confidence reason in review UI
5. `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` — Full bank verification flow + audit trail display

