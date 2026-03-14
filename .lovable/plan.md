

# Plan: Per-Rail Tax Model Configuration for Basis-Correct Anchors

## Problem

The current `isAuRail()` function uses a broad negative check (`!NON_AU_RAILS`) -- anything not explicitly listed as non-AU gets the gross anchor (`bank_deposit + gst_on_income`). This is too broad. Some AU rails may have `bank_deposit` already gross, or may not generate GST-inclusive invoices. The copilot recommends explicit per-rail configuration with two axes: `invoice_basis` and `deposit_basis`.

## Change: Single file edit in `fetch-outstanding/index.ts`

### Replace `isAuRail` + `NON_AU_RAILS` with a rail tax model config

```typescript
interface RailTaxModel {
  invoice_basis: 'gst_inclusive' | 'net';
  deposit_basis: 'ex_gst' | 'gross';
}

const RAIL_TAX_MODELS: Record<string, RailTaxModel> = {
  amazon_au:         { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  shopify_payments:  { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  ebay:              { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  bunnings:          { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  catch:             { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  kogan:             { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  mydeal:            { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  everyday_market:   { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  paypal:            { invoice_basis: 'gst_inclusive', deposit_basis: 'ex_gst' },
  // Non-AU or unknown rails default to net
};

const DEFAULT_TAX_MODEL: RailTaxModel = { invoice_basis: 'net', deposit_basis: 'gross' };
```

### Update `getInvoiceBasisNet` anchor logic

```typescript
function getInvoiceBasisNet(s: any) {
  const bankDep = Math.abs(s.bank_deposit ?? s.net_ex_gst ?? 0);
  const gstOnIncome = Math.abs(s.gst_on_income ?? 0);
  const marketplace = (s.marketplace || '').toLowerCase();
  const model = RAIL_TAX_MODELS[marketplace] || DEFAULT_TAX_MODEL;

  // Only add GST when invoices are GST-inclusive AND deposit is stored ex-GST
  if (model.invoice_basis === 'gst_inclusive' 
      && model.deposit_basis === 'ex_gst' 
      && gstOnIncome > 0) {
    return {
      anchor: bankDep + gstOnIncome,
      method: 'gross_bank_deposit_plus_gst',
      basis: 'gross' as const,
      components: ['bank_deposit', 'gst_on_income'],
    };
  }

  // Net anchor (deposit already gross, or no GST adjustment needed)
  return {
    anchor: bankDep,
    method: s.bank_deposit != null ? 'bank_deposit' : 'fallback_net_ex_gst',
    basis: 'net' as const,
    components: [s.bank_deposit != null ? 'bank_deposit' : 'net_ex_gst'],
  };
}
```

### Add `rail_tax_model` to diagnostics

In the `anchor_basis_summary` diagnostic block, add the resolved model per mismatch sample so accountants can see which model was applied:

```typescript
mismatches.push({
  settlement_id: ...,
  basis: ...,
  rail_tax_model: RAIL_TAX_MODELS[result.marketplace] || DEFAULT_TAX_MODEL,
  ...
});
```

## What this achieves

- **Explicit opt-in**: Each rail declares its tax model. Unknown rails default to `net/gross` (safe -- no GST added).
- **Two-axis correctness**: If a future rail has `deposit_basis: 'gross'` (deposit already includes GST), the anchor stays at `bank_deposit` even for GST-inclusive invoices -- preventing the double-count the copilot warned about.
- **Easy to extend**: Adding a new rail or changing a rail's behavior is a single config line, not logic surgery.
- **Auditable**: The diagnostics show which model was applied per settlement.

## Files

1. `supabase/functions/fetch-outstanding/index.ts` -- replace `NON_AU_RAILS`/`isAuRail` with `RAIL_TAX_MODELS` config, update `getInvoiceBasisNet`, update diagnostics

