

## Universal Settlement API Verification

### Architecture

The `verify-settlement` edge function is a universal API verification router that supports all marketplace types:

- **Mirakl** (Bunnings, Catch, MyDeal): Fetches transaction logs from Mirakl API
- **eBay**: Fetches payouts from eBay Sell Finances API  
- **Amazon**: Placeholder — SP-API settlement reports require async report generation (coming soon)
- **Unknown marketplaces**: Returns `no_api_connection` verdict with diagnostic info

### Source-Aware Filtering (Mirakl)

The Mirakl verification path uses source-aware filtering to prevent false "No Data" results:

- **csv_upload / manual**: Filters by date range only (1-day buffer). CSV-uploaded settlements have no Mirakl-native reference, so document number matching is impossible.
- **mirakl_api**: Extracts the actual payout reference from `raw_payload` or settlement ID pattern (`mirakl-{marketplace}-{ref}`) and matches by that reference.

### Standardized Response Shape

All marketplace paths return the same response shape:
```
{
  settlement_id, marketplace, source,
  verdict: "match" | "discrepancy" | "no_data" | "api_error" | "no_api_connection",
  filter_method: "date_range_only" | "payout_reference" | "none",
  transaction_count,
  api_totals: { sales, shipping, fees, refunds, payment, sales_tax },
  stored_settlement: { ... },
  discrepancies: [{ field, stored_value, api_value, difference }],
  missing_transaction_types: [...]
}
```

### UI

The "Verify via API" button now appears for ALL settlements (admin only), not just Mirakl marketplaces. The function automatically detects the marketplace and routes to the correct verification path. If no API connection exists, it returns a clear message.

### Files
- `supabase/functions/verify-settlement/index.ts` — universal router
- `supabase/functions/verify-mirakl-settlement/index.ts` — legacy, still functional independently
- `src/components/shared/SettlementDetailDrawer.tsx` — marketplace-agnostic UI
- `src/components/shared/SettlementCorrectionPanel.tsx` — uses universal function
