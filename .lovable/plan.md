

## Auto-Fill Shopify Domain for Testing

### What
Pre-fill the Shopify domain field with `mileskayaustralia.myshopify.com` so the onboarding flow requires zero typing during testing. Since you're using a custom app locked to this store, we'll set it as the default value.

### Change

**`src/components/onboarding/SetupStepConnectStores.tsx`** — Line 72:
- Change `useState('')` to `useState('mileskayaustralia.myshopify.com')`

That's it — one line. The domain will be pre-filled when users reach the Shopify card. They just hit "Connect Shopify" and go.

