

# Audit Results: 6 Checks on Support Policy + Tier Gating

## Summary: 4 PASS, 2 ISSUES FOUND

---

## Check 1: ScopeBanner on every authenticated route

**PASS — with caveat.**

`ScopeBanner` is rendered inside `AuthenticatedLayout` (line 25), which wraps:
- `/dashboard`
- `/setup`
- `/admin`
- `/audit/xero-posting`

All authenticated routes go through this layout. No authenticated routes exist outside it in `App.tsx`.

**No issue for current routing.** If future routes are added outside `AuthenticatedLayout`, the banner would be missed — but the current structure is clean.

---

## Check 2: Scope consent stored org-level, not session

**PASS.**

`acknowledgeScopeConsent()` in `src/actions/scopeConsent.ts` writes to `app_settings` table (lines 39-48):
- `scope_acknowledged_at` → persisted in DB, scoped by `user_id`
- `scope_version` → `'scope-v1-au-validated'`

Not localStorage. Not session-only. Survives logouts, device switches.

Currently `user_id` acts as org proxy (single-user orgs). When multi-user orgs are added, this needs migration to `org_id` — but that's documented in `RailPostingSettings.tsx` header comments already.

---

## Check 3: AUTHORISED blocked everywhere

**PASS — with one minor gap.**

**sync-settlement-to-xero (lines 1223-1241):** AUTHORISED is blocked when `pushTier !== 'SUPPORTED'`, forced to DRAFT, and logs `authorised_blocked_by_tier`. Correct.

**auto-post-settlement (lines 257-288):** EXPERIMENTAL rails force `invoice_status = 'DRAFT'` (line 273). Non-SUPPORTED AUTHORISED is caught at line 283-284. Correct.

**RailPostingSettings UI (line 407):** AUTHORISED option is `disabled={!eligibility.authorisedAllowed}`. Correct.

**sync-amazon-journal:** Invoice creation is hard-blocked (throws error on line 391-394). Only rollback allowed. Correct — no bypass path.

**Minor gap in `computeTierServer` (sync-settlement-to-xero line 1216-1218):**
```
const pushTier = (AU_VALIDATED_RAILS.has(railNormalised) && orgTaxProfile === 'AU_GST')
  ? 'SUPPORTED'
  : AU_VALIDATED_RAILS.has(railNormalised) ? 'EXPERIMENTAL' : 'EXPERIMENTAL';
```
Unknown rails default to `'EXPERIMENTAL'` instead of `'UNSUPPORTED'`. This is **safe** (EXPERIMENTAL still blocks AUTHORISED and forces DRAFT), but it's inconsistent with `computeSupportTier()` in `supportPolicy.ts` which returns `'UNSUPPORTED'` for unknown + `knownRail === false`. The same issue exists in `auto-post-settlement` line 177.

**Recommendation:** Fix the server-side `computeTierServer` to return `'UNSUPPORTED'` for unknown rails. Currently safe because EXPERIMENTAL already blocks AUTHORISED, but it's a drift risk.

---

## Check 4: EXPERIMENTAL draft-forced logging

**ISSUE FOUND — missing `experimental_draft_forced` event.**

In `auto-post-settlement` (line 273), when an EXPERIMENTAL rail has its invoice_status forced to DRAFT, it just silently reassigns:
```javascript
r.invoice_status = 'DRAFT';
```
No `system_events` log is written. If a user asks "why wasn't my invoice authorised?", there's no audit trail for this specific scenario in auto-post.

In `sync-settlement-to-xero` (lines 1226-1234), the `authorised_blocked_by_tier` event IS logged — but only when the client explicitly requested AUTHORISED. If auto-post sends DRAFT because it was forced earlier, the sync function never sees the original intent.

**Recommendation:** Add a `system_events` insert in `auto-post-settlement` when forcing DRAFT for EXPERIMENTAL rails:
```javascript
// After line 273 in auto-post-settlement:
await supabase.from('system_events').insert({
  user_id: userId,
  event_type: 'experimental_draft_forced',
  severity: 'info',
  marketplace_code: r.rail,
  details: { tier: 'EXPERIMENTAL', original_status: r.invoice_status, enforced: 'DRAFT' },
});
```

---

## Check 5: REVIEW_EACH_SETTLEMENT behaviour

**PASS.**

- `auto-post-settlement` (lines 277-279): Blocks autopost when `tax_mode === 'REVIEW_EACH_SETTLEMENT'`. Logs skip reason.
- `supportPolicy.ts` `getAutomationEligibility()` (lines 174-177): Blocks autopost for ALL tiers when this mode is set.
- Manual push is NOT blocked by this mode — only autopost is. The `sync-settlement-to-xero` function doesn't check `tax_mode` for manual pushes, which is correct.
- UI in `RailPostingSettings.tsx` (line 427): "Review each" option is available in the tax mode selector.

**One detail to verify in implementation:** The UI copy doesn't explicitly say "this disables auto-post" next to the "Review each" option. Consider adding a tooltip or helper text.

---

## Check 6: Migration defaults safety

**PASS — safe given existing gating.**

The migration defaults `tax_mode` to `'AU_GST_STANDARD'`. For unknown/unsupported rails:
- `auto-post-settlement` blocks autopost for UNSUPPORTED (currently EXPERIMENTAL due to the gap in check 3, but still blocks AUTHORISED)
- `sync-settlement-to-xero` forces DRAFT
- UI disables AUTHORISED via `eligibility.authorisedAllowed`

The default is safe because automation gating exists at multiple layers regardless of `tax_mode`.

---

## Action Items (2 patches needed before signoff)

### Patch A: Fix server-side tier for unknown rails (low risk, high clarity)

In both `auto-post-settlement/index.ts` (line 177) and `sync-settlement-to-xero/index.ts` (line 1218), change the final fallback from `'EXPERIMENTAL'` to `'UNSUPPORTED'`:

```typescript
// Current (both files):
return 'EXPERIMENTAL'; // Unknown rails default to EXPERIMENTAL

// Should be:
return 'UNSUPPORTED';
```

This aligns server behavior with `computeSupportTier()` in `supportPolicy.ts` and makes UNSUPPORTED rails actually blocked from autopost (currently they're treated as EXPERIMENTAL, which allows acknowledged DRAFT autopost).

### Patch B: Add `experimental_draft_forced` logging in auto-post-settlement

After line 273, log when DRAFT is forced for an EXPERIMENTAL rail. This closes the audit trail gap.

### Optional: Rename `AU_VALIDATED_RAILS` to `AU_VALIDATED_SCOPE` per your suggestion

Low effort, improves semantics. Would need to update both edge functions + the test file.

