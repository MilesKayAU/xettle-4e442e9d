
Goal: fix the screenshot extraction flow so the modal can actually call the backend, then improve the failure handling so admin users can see what is happening instead of getting the generic Edge Function error.

What I found:
- The extraction function is almost certainly failing before the POST is sent.
- In `supabase/functions/extract-order-customer/index.ts`, the function builds CORS headers with `getCorsHeaders(req)`.
- The shared helper expects an origin string, not the full `Request` object. Other backend functions in this project use:
  - `const origin = req.headers.get("Origin") ?? ""`
  - `const corsHeaders = getCorsHeaders(origin)`
- Backend analytics show only an `OPTIONS 200` request for `extract-order-customer` and no POST requests reaching the function.
- That matches the browser error exactly: the browser is stopping the real request at preflight/CORS level, so the earlier image compression and MIME fixes never got a chance to run.

Implementation plan:
1. Fix the real transport bug in `extract-order-customer`
- Change the function to read the origin from `req.headers.get("Origin") ?? ""`
- Pass that origin string into `getCorsHeaders(...)`
- Keep the `OPTIONS` response and all JSON responses using the corrected CORS headers

2. Add minimal diagnostics inside the extraction function
- Log when a POST actually reaches the handler
- Log whether `image_base64`, `action`, and `fbm_order_id` are present
- Log AI response shape / parse failures without exposing private screenshot data
- Return clearer structured errors so the UI can distinguish:
  - request blocked / malformed
  - AI extraction failed
  - extraction incomplete
  - Shopify patch failed

3. Tighten the modal UX in `src/components/admin/FulfillmentBridge.tsx`
- Keep the existing paste/upload flow, but improve feedback:
  - show “Screenshot ready” once compression finishes
  - disable extract until processing is complete
  - show a more specific user-facing message when the function call itself fails
- Preserve the current compact modal layout that already avoids right scrolling

4. Harden extraction parsing now that requests will reach the backend
- Normalize AI response parsing so it tolerates wrapped JSON / code blocks
- If parsing fails, surface a readable message instead of a generic failure
- Keep the current compressed JPEG payload path unless logs prove another payload issue after CORS is fixed

5. Validate end to end
- Confirm the backend now receives a POST, not just OPTIONS
- Test paste/upload → extract preview → patch flow with a real screenshot
- Verify the modal shows extracted customer fields instead of the generic request error

Files to update:
- `supabase/functions/extract-order-customer/index.ts`
- `src/components/admin/FulfillmentBridge.tsx`

No database changes needed:
- No schema, RLS, or auth-table changes are required for this fix

Technical note:
- Root cause is not “AI can’t read the screenshot” yet.
- Root cause is that the browser is blocking the request before the extraction function runs, because the function is returning the preflight response without valid CORS headers.
- Once that is fixed, the previous compression work can finally be evaluated properly.
