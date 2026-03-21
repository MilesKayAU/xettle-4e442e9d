

# Smart URL Pattern Learning for Amazon Order Links

## Idea
Instead of just letting the admin paste a corrected URL once, the system **learns the URL pattern** from their correction and applies it to all future orders. If the admin fixes one link, every other order link updates automatically — and it persists across sessions.

## How It Works

1. **Admin corrects a URL** — e.g. pastes `https://sellercentral.amazon.com.au/orders-v3/order/112-1234567-1234567`
2. **System extracts the template** — replaces the order ID with a `{orderId}` placeholder: `https://sellercentral.amazon.com.au/orders-v3/order/{orderId}`
3. **Saves the template** to `app_settings` (key: `amazon_seller_central_url_template`, value: the template string)
4. **All order links** now use this template instead of the auto-generated one
5. **Next login** — template loads from DB, all links are correct immediately

## Detection Logic
When the admin pastes a URL, search for any known Amazon order ID within the string. If found, replace it with `{orderId}` to derive the template. If no order ID is found in the URL, just save it as a one-off override for that specific order (current behaviour).

## Changes

### `src/components/admin/FulfillmentBridge.tsx`
- After admin edits a URL and it contains a recognised order ID, extract the template pattern
- Prompt: "Apply this URL format to all orders?" with a Save button
- If confirmed, save to `app_settings` via Supabase
- On mount, check `app_settings` for a saved template; if found, use it instead of the region-based default
- Show a small "Custom URL pattern active" indicator with a reset option

### No database migration needed
`app_settings` table already exists with `user_id + key` uniqueness — just insert a new key.

| File | Change |
|------|--------|
| `src/components/admin/FulfillmentBridge.tsx` | URL template learning, persistence, and apply-to-all logic |

