

## Round 3: Fix Remaining Auth Lock Contention + Minor Improvements

5 files to modify. All changes are small and surgical.

---

### 1. `src/hooks/use-settings-pin.ts` — Eliminate `getUser()` calls

This is the **primary source** of the 46x lock errors. The hook is used by 4+ components, each calling `getUser()` on mount and again on PIN verify.

**Changes:**
- Import `useAuth` from `@/contexts/AuthContext`
- Replace the `useEffect` (lines 46-59) to use `user` from `useAuth()` instead of `supabase.auth.getUser()`. Add `isMounted` guard.
- Replace `getUser()` in `verifyPin` (line 91) with the `user` from context — store it as a ref or use it from the closure.

### 2. `src/components/admin/EbayConnectionStatus.tsx` — Eliminate `getUser()` call

Line 30 calls `supabase.auth.getUser()` on every status check.

**Changes:**
- Import `useAuth` from `@/contexts/AuthContext`
- Get `user` at the component top level
- Replace line 30's `getUser()` call with the context `user`

### 3. `src/components/admin/AccountResetButton.tsx` — Add `signOut()` before redirect

After clearing caches (line 41-46), the in-memory Supabase session remains active.

**Changes:**
- Add `await supabase.auth.signOut()` after `queryClient.removeQueries()` and before the `setTimeout` redirect

### 4. `src/components/MarketplaceAlertsBanner.tsx` — Add try/catch error handling

The `load` function has no error handling — silent failures on network issues.

**Changes:**
- Wrap the fetch in `try/catch`, log errors with `console.warn`

### 5. `src/components/admin/accounting/NextExpectedSettlements.tsx` — Use catalog-based frequency

Hardcoded string matching for settlement frequency is brittle.

**Changes:**
- Add `settlementFrequencyDays` to `MarketplaceDefinition` interface in `MarketplaceSwitcher.tsx`
- Add the field to each catalog entry (shopify: 3, bunnings: 15, woolworths: 14, default 7)
- In `NextExpectedSettlements.tsx`, use `catalog?.settlementFrequencyDays ?? 7` instead of the ternary chain

This means `MarketplaceSwitcher.tsx` also gets a small edit (interface + catalog data).

---

### Summary: 6 files modified

| File | Change |
|------|--------|
| `src/hooks/use-settings-pin.ts` | Use `useAuth()` instead of `getUser()` |
| `src/components/admin/EbayConnectionStatus.tsx` | Use `useAuth()` instead of `getUser()` |
| `src/components/admin/AccountResetButton.tsx` | Add `signOut()` before redirect |
| `src/components/MarketplaceAlertsBanner.tsx` | Add try/catch error handling |
| `src/components/admin/accounting/MarketplaceSwitcher.tsx` | Add `settlementFrequencyDays` to interface + catalog |
| `src/components/admin/accounting/NextExpectedSettlements.tsx` | Use catalog frequency field |

