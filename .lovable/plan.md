


# Smart URL Pattern Learning for Amazon Order Links — IMPLEMENTED

## What Was Built

### URL Template Learning
- When an admin edits an Amazon Order link and pastes a corrected URL, the system detects the order ID within the URL and extracts a reusable `{orderId}` template
- A prompt appears: "Apply this URL format to all orders?" — if confirmed, the template is saved to `app_settings` (key: `amazon_seller_central_url_template`)
- All order links immediately use the saved template
- Template persists across sessions — loads from DB on component mount

### UI Elements
- **Pencil icon** next to each Amazon Order ID link — click to edit/paste a custom URL
- **Inline input** with Enter to submit, Escape to cancel
- **"Custom URL pattern active" banner** when a saved template is in use, with a Reset button
- **"Apply to all?" prompt** when a new template is detected from a pasted URL

### No Database Migration Needed
Uses existing `app_settings` table with `user_id + key` uniqueness.

## Files Changed

| File | What |
|------|------|
| `src/components/admin/FulfillmentBridge.tsx` | URL template learning, per-row edit, persistence, apply-to-all prompt, reset |
