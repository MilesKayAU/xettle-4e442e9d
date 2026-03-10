

# Add `?test_wizard=true` Debug Param

## Change

In `src/pages/Dashboard.tsx`, add a single check at the top of the wizard pre-check logic: if `searchParams.get('test_wizard') === 'true'`, force the wizard open regardless of existing tokens/settlements.

### Implementation (lines 48-97)

Before the existing pre-check queries, add:

```typescript
const isTestMode = searchParams.get('test_wizard') === 'true';
if (isTestMode) {
  setShowWizard(true);
  return;
}
```

This lets you test anytime by visiting:
```
/dashboard?test_wizard=true
```

Add `&connected=amazon` or `&connected=xero` to test specific step entry points.

One file, ~3 lines added.

