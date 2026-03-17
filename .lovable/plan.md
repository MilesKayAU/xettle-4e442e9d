

## Problem

The **CoaBlockerCta** component (the yellow warning panel) has two broken links:

1. **"Open Account Mapper"** navigates to `/admin?tab=settings` — but the Admin page has no "settings" tab. The Account Mapper actually lives on the **Dashboard** under `activeView = 'settings'`. It should navigate to `/dashboard` and trigger the settings view.

2. **"Clone COA"** button uses the PIN gate hook, which relies on a `SettingsPinDialog` rendered in `AuthenticatedLayout`. During the Setup wizard flow, this should work — but the clone dialog itself may fail to open if the PIN gate state is not properly connected.

3. Both buttons use `window.location.href` (full page reload) instead of React Router's `navigate()`, which loses React state.

## Changes

### File: `src/components/shared/CoaBlockerCta.tsx`

**Fix "Open Account Mapper" navigation:**
- Accept an optional `onNavigateToMapper` callback prop so parent components (Setup wizard, Dashboard) can handle navigation contextually.
- Default fallback: use React Router `useNavigate()` to go to `/dashboard` and dispatch the `open-settings-tab` custom event (the Dashboard already listens for this event to switch to the settings view).
- Remove the broken `/admin?tab=settings` path entirely.

**Fix "Clone COA" in setup context:**
- The Clone COA button and dialog already work via the PIN hook — just verify the dialog renders. No change needed here beyond ensuring the PIN dialog is accessible (it is, via `AuthenticatedLayout`).

### Specific code changes

In `CoaBlockerCta.tsx`:
- Add `useNavigate` import from `react-router-dom`
- Add optional prop `onNavigateToMapper?: () => void`
- Replace the "Open Account Mapper" `onClick` handler:
  ```tsx
  onClick={() => {
    if (onNavigateToMapper) {
      onNavigateToMapper();
    } else {
      navigate('/dashboard');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('open-settings-tab'));
      }, 100);
    }
  }}
  ```

### File: `src/components/onboarding/SetupStepConnectStores.tsx`

- Pass `onNavigateToMapper` to `CoaBlockerCta` that switches to the settings view contextually (since during setup, the user may not want to leave the wizard — show a toast explaining they can configure this after setup, or navigate to dashboard settings).

