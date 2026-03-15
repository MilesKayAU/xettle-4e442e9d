

## Problem

Two issues visible in the screenshot:

1. **Kogan settlement files aren't recognised by Level 1 fingerprinting.** The current Kogan fingerprint expects a `kogan order id` column, but Kogan's actual payout CSVs use `APInvoice`, `InvoiceRef`, `Commission (Inc GST)`, `Remitted`, and `SupplierCode` columns. Only the first file got detected (via AI fallback), the other 3 show "Could not identify."

2. **AI detection doesn't propagate to sibling files.** When 4 Kogan files are uploaded together and AI identifies the first one, the other 3 identical-format files still show "unknown." There's no logic to apply AI results to other unrecognised files with matching headers.

---

## Changes

### 1. Add Kogan Payout Report fingerprint (`src/utils/file-fingerprint-engine.ts`)

Add a new Level 1 fingerprint for Kogan's seller portal payout format:

```
requiredColumns: ['apinvoice', 'invoiceref', 'commission (inc gst)', 'remitted']
anyOfColumns: ['suppliercode', 'sku', 'datemanifested']
marketplace: 'kogan'
priority: 100
```

Also add column mappings so the generic parser can extract the right fields:
- `settlement_id` → `APInvoice`
- `fees` → `Commission (Inc GST)`
- `net_payout` → `Remitted`
- `gross_sales` → `Total (AUD)` or `Price (AUD)`

This will ensure all Kogan payout CSVs are instantly recognised without AI.

### 2. Propagate AI detection to sibling unknown files (`src/components/admin/accounting/SmartUploadFlow.tsx`)

After AI successfully identifies a file (`analyzeWithAI` callback), add propagation logic:

- Extract the headers of the AI-identified file
- Scan all other files in the current upload batch that have `status === 'unknown'`
- For each unknown file, compare its headers — if they match the AI-identified file's headers (same columns), automatically apply the same detection result (marketplace, column mapping) with a slightly lower confidence (e.g., 95% vs AI's original)
- Pre-parse settlements for those propagated files
- Update their status from `unknown` → `detected`
- Show a toast: "Applied Kogan detection to 3 similar files"

This means clicking "Analyze with AI" once will cascade to all matching files in the batch.

### 3. Kogan-specific parsing support (`src/utils/generic-csv-parser.ts` or new parser)

Verify the generic CSV parser can handle the Kogan column mapping correctly. The Kogan format groups multiple line items under one `APInvoice` ID — the parser needs to aggregate by `APInvoice` to produce one settlement per payout batch (e.g., settlement_id = `344840`). Key aggregation:
- Sum `Total (AUD)` for gross sales
- Sum `Commission (Inc GST)` for fees  
- Sum `Remitted` for net payout
- Derive period from `InvoiceDate`

