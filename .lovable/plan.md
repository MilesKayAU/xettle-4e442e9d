

# Fix: Screenshot Extraction "Failed to send request" Error

## Root Cause
The compressed screenshot is still too large for the edge function's request body limit (~2MB). A 1200px-wide JPEG at 0.8 quality can easily produce 500KB-1MB+ of raw data, which becomes ~33% larger when base64-encoded. The edge function logs confirm the request never reaches the handler -- it's rejected before processing.

## Changes

### 1. `src/components/admin/FulfillmentBridge.tsx` -- More aggressive compression
- Reduce max width from 1200px to **800px** (sufficient for AI text extraction)
- Reduce JPEG quality from 0.8 to **0.5**
- **Strip the `data:image/...;base64,` prefix** before sending to the edge function (saves ~30 chars but more importantly, the edge function re-adds it anyway)
- Send only the raw base64 string in the request body

### 2. `supabase/functions/extract-order-customer/index.ts` -- Fix MIME type mismatch
- Line 228: The function always re-wraps with `data:image/png;base64,` but the client sends JPEG. Change to `data:image/jpeg;base64,` to match the compressed format.

## Technical Details

| Setting | Before | After |
|---------|--------|-------|
| Max width | 1200px | 800px |
| JPEG quality | 0.8 | 0.5 |
| Payload sent | Full data URL | Raw base64 only |
| AI MIME type | `image/png` | `image/jpeg` |

Expected result: ~70-80% smaller payload, well within the edge function limit.

