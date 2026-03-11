

## Fix: Onboarding wizard not appearing for new users

### Root cause analysis

The wizard pre-check at lines 94-139 in `Dashboard.tsx` has two issues introduced/exposed by the last change:

1. **Silent failure hides wizard**: The `catch` block at line 137 silently swallows errors. If any of the 4 parallel DB queries fail (e.g. network hiccup, RLS edge case), `showWizard` stays `false` and the wizard never appears.

2. **SessionStorage dismiss count bleeds across accounts**: `xettle_wizard_dismiss_count` is stored in sessionStorage (browser-level), not per-user. After testing multiple accounts and dismissing the wizard 3+ times, ALL users in that browser session get blocked.

### Changes

**`src/pages/Dashboard.tsx`**

1. **Catch block → show wizard as safe fallback**: Change the `catch {}` at line 137 to `catch { setShowWizard(true); }`. A new user should always see the wizard — if we can't verify data exists, default to showing it.

2. **Scope dismiss count per user**: Change the sessionStorage key from `xettle_wizard_dismiss_count` to `xettle_wizard_dismiss_count_${user.id}` in both the `checkWizard` function (line 111) and the `handleWizardClose` function (line 145). This prevents cross-account bleed.

3. **Remove redundant `const connected` re-declaration**: Line 123 re-declares `connected` inside the `if` block when the same variable already exists from line 114. Remove the re-declaration and use the outer one.

These are three small, targeted fixes in a single file.

