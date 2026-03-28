

## Fix Valid Scanner Findings in xettle

Three targeted fixes to improve data integrity and consistency. All are small, low-risk changes.

---

### 1. Add input validation to `setOrgTaxProfile`
**File:** `src/actions/scopeConsent.ts`

Add a guard at the top of `setOrgTaxProfile` that checks `SUPPORTED_TAX_PROFILES.includes(profile)` before the upsert. Return `{ success: false, error: 'Unsupported tax profile' }` if invalid.

### 2. Make `getOrgTaxProfile` return consistent error signal
**File:** `src/actions/scopeConsent.ts`

Change the return type to include an error case (e.g., `{ profile: TaxProfile; authenticated: boolean }`) or throw when unauthenticated, matching the pattern used by other functions in this file. This prevents downstream code from silently using a default `'AU_GST'` for logged-out users.

### 3. Add warning logs for failed JSON parsing in accountMappings
**File:** `src/actions/accountMappings.ts`

In `getMappings()` and `getMappingsRaw()`, add `console.warn('Failed to parse account mappings JSON', e)` inside the catch blocks so corrupt data is visible in logs rather than silently swallowed.

---

### Not included (lower priority)
- **N+1 deletion** in settlements — valid but requires a new RPC function and is a larger refactor. Can be tackled separately.

