

# Smart File Ingestion: Build Plan

## Summary

Build a 3-level intelligent file ingestion system: fingerprint detection (instant), heuristic column mapping (fast), and AI fallback (2-3s). Users upload any file, Xettle figures it out, warns on wrong files, and creates settlements automatically.

## Phase 1: Fingerprint Engine + Wrong-File Detection

**New file: `src/utils/file-fingerprint-engine.ts`**

Core detection engine with two capabilities:

**A. Known format fingerprints** — match column headers against known patterns:

| Marketplace | Fingerprint Columns | File Type |
|---|---|---|
| Amazon AU (settlement) | `settlement-id`, `settlement-start-date`, `amount-type` | TSV |
| Amazon AU (WRONG: orders) | `amazon-order-id`, `purchase-date`, `buyer-name` | CSV |
| Shopify Payments (payout) | `Payout ID`, `Payout Date`, `Charges` | CSV |
| Shopify Payments (txn) | `Payout ID`, `Card Brand`, `Fee`, `Net` | CSV |
| Shopify (WRONG: orders) | `Name`, `Email`, `Financial Status`, `Fulfillment Status` | CSV |
| Bunnings | `Mirakl`, `payable orders` | PDF/CSV |
| Kogan | `Kogan Order ID`, `Commission` | CSV |
| BigW | `Mirakl` + `Big W` | CSV |
| Catch | `Catch Order ID` | CSV |

**B. Wrong-file detection** — returns structured guidance:
```typescript
interface FileDetectionResult {
  marketplace: string;           // 'amazon_au', 'shopify_payments', etc.
  confidence: number;            // 0-100
  isSettlementFile: boolean;     // false = wrong file type
  wrongFileMessage?: string;     // "This is a Shopify Orders export..."
  correctReportPath?: string;    // "Shopify Admin → Finances → Payouts → Export"
  columnMapping?: ColumnMapping; // mapped columns if detected
  detectionLevel: 1 | 2 | 3;    // which level detected it
}
```

**Modifies: `src/utils/file-marketplace-detector.ts`** — delegates to fingerprint engine, keeps backward compat.

## Phase 2: Generic CSV Parser

**New file: `src/utils/generic-csv-parser.ts`**

A mapping-driven parser that takes a `ColumnMapping` and produces `StandardSettlement[]`. No marketplace-specific code needed.

```typescript
interface ColumnMapping {
  gross_sales: string;      // column name in CSV
  fees: string;
  refunds?: string;
  net_payout: string;
  settlement_id: string;
  period_start?: string;
  period_end?: string;
  gst?: string;
}
```

- Reads CSV/XLSX using existing xlsx dependency
- Maps columns per the mapping
- Applies GST logic (configurable: `seller` vs `marketplace` collected)
- Outputs `StandardSettlement[]` compatible with existing save/sync pipeline
- Handles grouping if a `settlement_id` column groups multiple rows

## Phase 3: SmartUploadFlow UI

**New file: `src/components/admin/accounting/SmartUploadFlow.tsx`**

Universal upload component that replaces GenericMarketplaceDashboard's "coming soon" upload area. Also usable as a standalone "Smart Upload" entry point.

Flow:
1. Multi-file drop zone (accepts CSV, TSV, XLSX, PDF)
2. For each file, runs fingerprint engine → shows detection results:
   - `✅ Amazon AU Settlement — 25 records (TSV)`
   - `✅ Shopify Payments Payouts — 14 records (CSV)`
   - `⚠️ Shopify Orders Export — wrong file type` + download instructions
   - `❓ Unknown format — analyzing with AI...` (triggers Level 3)
3. User confirms each detected marketplace with [Confirm] / [Change] buttons
4. On confirm: routes to correct parser, creates settlements, applies all standard checks (dedup, gap, reconciliation)
5. If marketplace not in user's connections, shows "New marketplace detected: Kogan. [Confirm and Parse]" — auto-inserts into `marketplace_connections`

**Modifies: `src/components/admin/accounting/GenericMarketplaceDashboard.tsx`** — replaces "coming soon" with SmartUploadFlow.

**Modifies: `src/components/admin/accounting/AccountingDashboard.tsx`** — adds SmartUploadFlow as an option in the upload area or as a new "Smart Upload" tab.

## Phase 4: AI File Interpreter (Edge Function)

**New file: `supabase/functions/ai-file-interpreter/index.ts`**

Only called when Levels 1+2 fail. Uses Lovable AI (`google/gemini-3-flash-preview`) via the gateway.

- Receives: column headers + 3 sample rows (no PII — strip emails/names)
- Uses tool calling for structured output (not raw JSON):
  - `is_settlement_file`, `marketplace_guess`, `confidence`, `column_mapping`, `wrong_file_message`, `download_instructions`
- Returns detection result to SmartUploadFlow
- Handles 429/402 errors gracefully

**Updates: `supabase/config.toml`** — add function config with `verify_jwt = false`.

## Phase 5: Fingerprint Storage + Auto-Learn

**Database migration:**
```sql
CREATE TABLE public.marketplace_file_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  column_signature jsonb NOT NULL DEFAULT '[]',
  file_pattern text,
  column_mapping jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, marketplace_code, column_signature)
);
ALTER TABLE public.marketplace_file_fingerprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own fingerprints"
  ON public.marketplace_file_fingerprints FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

After a successful parse+save, store the sorted column list + mapping. Next upload of same format → Level 1 instant match from user's own fingerprints (queried first before global fingerprints).

## Phase 6: Auto-Create Marketplace on Detection

When a file is detected for a marketplace the user hasn't connected:
1. SmartUploadFlow shows: "New marketplace detected: **Kogan**. Based on: 'Kogan Order ID' column found. [Confirm and Parse] [Change]"
2. On confirm, auto-insert into `marketplace_connections` with `connection_type: 'auto_detected'`
3. Parse proceeds normally through generic parser
4. Dashboard updates marketplace switcher to show the new marketplace

## Build Order

| Phase | What | Dependencies |
|---|---|---|
| 1 | Fingerprint engine + wrong-file detection | None |
| 2 | Generic CSV parser | Phase 1 (needs column mapping) |
| 3 | SmartUploadFlow UI | Phase 1+2 |
| 4 | AI edge function | Phase 1 (fallback path) |
| 5 | Fingerprint storage table | Phase 3 (stores after parse) |
| 6 | Auto-create marketplace | Phase 3 (UI trigger) |

## Files Summary

| File | Action |
|---|---|
| `src/utils/file-fingerprint-engine.ts` | Create |
| `src/utils/generic-csv-parser.ts` | Create |
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Create |
| `supabase/functions/ai-file-interpreter/index.ts` | Create |
| `src/utils/file-marketplace-detector.ts` | Modify (delegate to engine) |
| `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Modify (use SmartUploadFlow) |
| `src/components/admin/accounting/AccountingDashboard.tsx` | Modify (add Smart Upload entry) |
| `.lovable/plan.md` | Update |
| DB migration | `marketplace_file_fingerprints` table |

