
Root cause confirmed: the screenshot extraction is working now. The failure happens one step later when the backend tries to update Shopify and Shopify returns:

`403 [API] This action requires merchant approval for write_orders scope.`

What I’d implement:

1. Fix Shopify token selection in the patch function
- Update `supabase/functions/extract-order-customer/index.ts` to stop using an arbitrary Shopify token:
  - currently it fetches the first token for the user with no `is_active`, no ordering, and no `token_type` preference
- Replace that with deterministic FBM-safe selection:
  - active tokens only
  - prefer `token_type = internal`
  - newest token first
  - validate the token scope contains `write_orders` before attempting the patch
- This aligns the screenshot patch flow with the FBM bridge’s write-capable Shopify setup.

2. Return structured permission errors instead of a generic edge-function failure
- In `extract-order-customer`, classify known Shopify write failures like:
  - missing/old token
  - no active internal token
  - merchant approval required for `write_orders`
- Return a structured response such as:
  - `status: "reauth_required"`
  - `reason: "missing_write_scope"` or `reason: "merchant_approval_required"`
  - keep `data: customerData` so the extracted address remains visible
- Avoid turning expected permission issues into a generic 500 whenever possible.

3. Improve admin UX in the screenshot modal
- Update `src/components/admin/FulfillmentBridge.tsx` so patch failures show a clear message like:
  - “Customer data was extracted, but Shopify write access is missing.”
  - “Reconnect XettleInternal to approve write_orders, then retry.”
- Preserve the extracted fields after failure so the admin does not lose the scrape result.
- Add a direct CTA from the modal to start the existing internal Shopify reconnect flow.
- Change copy from “update the Shopify draft order” to “update the Shopify order” so the UI matches what the backend actually does.

4. Add proactive connection warning in the FBM admin surface
- In the Fulfillment Bridge header/order tools, show a warning when the current Shopify connection is not write-capable for FBM.
- This lets the admin fix permissions before scraping a screenshot.

5. End-to-end validation
- Verify extract still succeeds.
- Verify patch now uses the preferred active internal token.
- Verify missing-scope cases show a clear reconnect message instead of “Edge Function returned a non-2xx status code”.
- Verify reconnecting XettleInternal and retrying patch succeeds.

Files to update:
- `supabase/functions/extract-order-customer/index.ts`
- `src/components/admin/FulfillmentBridge.tsx`
- optionally a shared Shopify token resolver if I factor the selection logic out for reuse

Technical notes:
- This is no longer an AI/image issue.
- The backend is receiving the request, extracting the customer correctly, and failing only on the Shopify write call.
- The main code issue is weak token selection plus poor error translation.
- There may also be a real store-permission issue on the current token, so the UX should guide the admin to reconnect/approve write access instead of hiding that behind a generic backend error.

No database changes are needed for this fix.
