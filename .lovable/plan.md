

# Revert Shopify Redirect URI

## Change
In `supabase/functions/shopify-auth/index.ts`, revert the redirect URI back to:
```
https://xettle.app/shopify/callback
```

This was incorrectly changed to `xettle.lovable.app` — the app runs at `xettle.app`.

Single line change, redeploy the edge function.

