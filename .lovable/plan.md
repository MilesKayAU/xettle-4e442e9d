

## Fix Amazon OAuth MD1000 Error

Two changes to the `authorize` action in `supabase/functions/amazon-auth/index.ts`:

1. **Add `version: 'beta'`** to the OAuth URL params (required for Draft-state SP-API apps)
2. **Hardcode `redirect_uri`** to `https://xettle.app/amazon/callback` — ignore any dynamically passed value

### Changes (lines 46–56)

```typescript
// Before
const body = await req.json().catch(() => ({}))
const redirectUri = (body as any).redirect_uri || 'https://xettle.app/amazon/callback'

const state = crypto.randomUUID()

const params = new URLSearchParams({
  application_id: 'amzn1.sp.solution.d95a6e1f-2b22-4bb1-a6de-73427cb73bd9',
  redirect_uri: redirectUri,
  state,
})

// After
const redirectUri = 'https://xettle.app/amazon/callback'

const state = crypto.randomUUID()

const params = new URLSearchParams({
  application_id: 'amzn1.sp.solution.d95a6e1f-2b22-4bb1-a6de-73427cb73bd9',
  redirect_uri: redirectUri,
  state,
  version: 'beta',
})
```

Then deploy and test the function.

