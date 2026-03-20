

## Plan: Reset FBM order for re-sync

### Steps

1. **Database migration** — Delete the existing `amazon_fbm_orders` row for order `250-3366733-4698245` so the next sync treats it as a brand-new order and re-fetches full PII from Amazon using the RDT token logic.

### Technical detail

A single SQL migration:
```sql
DELETE FROM amazon_fbm_orders WHERE amazon_order_id = '250-3366733-4698245';
```

After this, delete the draft order in Shopify admin manually, then run **Dry Run** from the FBM Bridge to verify customer name and shipping address come through.

