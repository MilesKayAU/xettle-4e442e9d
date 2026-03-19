

# Fix: Shopify "Invalid signature" on install

## Diagnosis

The user is correct. The HMAC validation code is fine algorithmically — it follows the standard Shopify HMAC process. The issue is that `SHOPIFY_CLIENT_SECRET` holds the secret for a **development/custom app**, not the **public Xettle app** that Shopify is redirecting from.

The edge function also has a `SHOPIFY_DEV_MODE` toggle (line 55) that switches between `SHOPIFY_DEV_CLIENT_SECRET` and `SHOPIFY_CLIENT_SECRET`. For the public app install flow, `SHOPIFY_DEV_MODE` must NOT be `true`, and `SHOPIFY_CLIENT_SECRET` must contain the public app's client secret.

## Fix

This is a **secrets configuration issue**, not a code change:

1. Go to your Shopify Partner Dashboard → **Xettle** (the public app) → **API credentials**
2. Copy the **Client secret** for that public app
3. Update the `SHOPIFY_CLIENT_SECRET` secret in your project to this value

Similarly, confirm `SHOPIFY_CLIENT_ID` matches the public app's client ID — if it's set to a dev app's ID, the OAuth initiation step (after HMAC passes) will also fail.

## No code changes needed

The edge function logic is correct. The only action is updating the secret values to match the public app credentials.

