

## Problem

1. **PostSetupBanner is invisible on first landing** — It requires `onboarding_wizard_complete` to be set AND a 5-minute window check. After connecting Xero and landing on the dashboard, neither condition is reliably met immediately.

2. **No prompt to connect remaining channels** — After Xero is connected, the dashboard doesn't show prominent cards to connect Amazon/Shopify. This is the highest-momentum moment.

3. **Messaging is wrong** — Current copy implies we're pushing data to Xero/marketplaces. We need to clarify: we're only *reading* from their accounts to auto-build marketplace folders and settlements *inside Xettle*. Nothing is pushed or changed externally.

---

## Plan

### 1. Rewrite PostSetupBanner visibility logic

Remove the 5-minute timing check. Instead, show the banner whenever:
- Any connection exists (`hasXero || hasAmazon || hasShopify`) AND user has few/no marketplace connections yet, OR
- Wizard was completed and `sessionStorage` dismiss flag is not set

Use `sessionStorage('xettle_post_setup_dismissed')` for dismiss persistence (resets on new session).

### 2. Rewrite PostSetupBanner as a full post-setup command center

Replace the current small card with a two-section layout:

**Section A — Active scanning status** (shown when any connection exists):
- Animated spinner + "Xettle is scanning your Xero to auto-detect your marketplaces and build them in your account"
- Reassurance copy: "We're only reading your data — nothing is changed in Xero, Amazon, or Shopify"
- Poll `marketplace_connections` every 10s; when new auto-detected ones appear, show a celebratory count

**Section B — Connect more channels cards** (shown for each missing connection):
- Large, visually distinct cards for each unconnected platform (Amazon, Shopify, Xero)
- Benefit-driven copy emphasizing AI-powered automation:
  - **Amazon**: "Connect Amazon and our AI will auto-import your settlements, detect fee patterns, and build your marketplace — no manual setup"
  - **Shopify**: "Connect Shopify and we'll auto-detect your sales channels, sync payouts, and combine everything with your other data"
  - **Xero**: "Connect Xero and we'll scan your history to find existing marketplace records and pre-build your account"
- Each card has a single prominent "Connect" button
- Gamification: Show a progress indicator — "1 of 3 connected" with filled dots, encouraging completion

### 3. Pass OAuth trigger callbacks from Dashboard

Update `Dashboard.tsx` to pass `onConnectXero`, `onConnectAmazon`, `onConnectShopify` callbacks to PostSetupBanner. These will trigger the existing OAuth flows (redirect to `/xero-auth`, etc.) or open the wizard at the connect stores step.

### 4. Update messaging throughout

All copy must emphasize:
- "We scan and read — we never push or change anything in your accounts"
- "Our AI builds your marketplaces, detects your channels, and organises your settlements automatically"
- "The more you connect, the less you do manually"

---

### Files to modify

- **`src/components/dashboard/PostSetupBanner.tsx`** — Full rewrite with scanning status + connect channel cards + progress gamification
- **`src/pages/Dashboard.tsx`** — Pass OAuth callbacks, ensure banner shows immediately when `hasXero` is true

