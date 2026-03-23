

## Make Seller Company ID Optional & Relabel for Bunnings

### Problem
"Seller Company ID" is Mirakl jargon. Bunnings sellers who received their API key from Bunnings support won't know this value. They'd know their Bunnings Vendor Number (if anything), but most likely their API key is scoped to their single shop already.

### Changes

**1. MiraklConnectionPanel.tsx — Relabel & make optional**
- Rename label from "Seller Company ID" to **"Shop ID (optional)"**
- Add helper text: *"Leave blank if you only have one store. You can find this in your seller portal under My Settings → Mirakl seller account."*
- Update placeholder to: `e.g. your Bunnings vendor number or Mirakl shop ID`
- Allow empty value — generate a fallback for DB uniqueness (e.g. `default-{userId-prefix}`)

**2. mirakl-auth edge function — Accept empty seller_company_id**
- Remove the required validation for `seller_company_id`
- If blank, default to `"default"` for the DB unique constraint
- This preserves multi-shop support for users who do have multiple shops

**3. fetch-mirakl-settlements — Skip shop param when empty/default**
- Only append `&shop=` if `seller_company_id` exists and is not `"default"`
- This lets the API return all settlements for the authenticated key

### No changes to
- Database schema (seller_company_id column stays, just allows "default" value)
- OAuth flow
- Any other marketplace logic

