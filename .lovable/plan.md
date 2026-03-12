

# Xero-First Onboarding Flow

## Overview

Replace the 4-step setup wizard with a Xero-only connection step, then use a lightweight 90-day discovery scan to detect marketplaces. Show a "Discovery in progress" banner on the Dashboard, followed by a `ConnectChannelsPrompt` once discovery completes. Channels are connected one at a time, each triggering only its own sync.

## Flow

```text
Sign up → Wizard (Connect Xero only) → Dashboard
                                          │
                              Light discovery scan (90-day invoices)
                              ├─ "Analysing your Xero account…" banner
                              └─ Detect marketplace patterns
                                          │
                              Discovery complete → ConnectChannelsPrompt
                              "We detected Amazon & Shopify in Xero"
                              [Connect Amazon]  [Connect Shopify]
                                          │
                              User connects one channel → sync that channel only
```

## Changes

### 1. Simplify SetupWizard (2 steps only)
**File: `src/components/onboarding/SetupWizard.tsx`**
- Remove steps 2 (Marketplaces), 3 (Upload), 4 (Results)
- Step 1: Connect Xero (existing `SetupStepConnectXero`)
- Step 2: "You're in!" confirmation with a single "Go to Dashboard" button
- On complete: mark `onboarding_wizard_complete`, redirect to `/dashboard`
- Do NOT fire `scan-xero-history` here — the dashboard handles discovery

### 2. Light discovery scan on Dashboard load
**File: `src/pages/Dashboard.tsx`**
- After wizard completes and Xero is connected, check `app_settings` for `xero_discovery_status`
- If not set: fire a lightweight edge function call to `scan-xero-history` with a new header `x-action: light-discovery` (90-day window, invoices + contacts only, no full settlement import)
- Set `xero_discovery_status = 'running'` in `app_settings`
- Show `DiscoveryBanner` while running

### 3. Update scan-xero-history for light mode
**File: `supabase/functions/scan-xero-history/index.ts`**
- Add support for `x-action: light-discovery` header
- In light mode: fetch only last 90 days of invoices + contacts, run CoA detection, populate `marketplace_connections` as `suggested`, then set `xero_discovery_status = 'complete'` in `app_settings`
- Skip full settlement import, bank transactions, and deep scanning
- This keeps onboarding under 5-10 seconds even for large Xero orgs

### 4. Discovery Banner component
**New file: `src/components/dashboard/DiscoveryBanner.tsx`**
- Polls `app_settings` for `xero_discovery_status` every 3 seconds
- While `running`: show "We're analysing your Xero account…" with spinner
- When `complete`: hide banner, trigger parent to show `ConnectChannelsPrompt`
- Shows detected channels as they appear (queries `marketplace_connections` where `connection_status = 'suggested'`)

### 5. ConnectChannelsPrompt component
**New file: `src/components/dashboard/ConnectChannelsPrompt.tsx`**
- Appears after discovery completes
- Shows detected marketplaces from `marketplace_connections` (suggested) with contextual messages like "We detected Amazon settlements in Xero"
- Buttons: "Connect Amazon" (OAuth), "Connect Shopify" (OAuth), "Upload CSV" (for manual channels)
- "Activate manually" for channels without API connections
- Dismissible — stores `channels_prompt_dismissed` in `app_settings`
- Reuses existing `CoaDetectedPanel` patterns for confirm/dismiss

### 6. Simplify Dashboard wizard trigger
**File: `src/pages/Dashboard.tsx`**
- Remove complex `checkWizard` logic for OAuth callback step detection
- Wizard shows only for brand-new users (no `onboarding_wizard_complete` flag, no settlements)
- OAuth callbacks (`?connected=amazon|shopify`) land on Dashboard with a success toast instead of reopening wizard
- After OAuth callback, trigger that channel's sync only (e.g., `fetch-amazon-settlements` for Amazon)

### 7. Channel-specific sync on connect
**File: `src/pages/Dashboard.tsx`**
- When `?connected=amazon`: fire `fetch-amazon-settlements` with `x-action: smart-sync`, show toast "Amazon connected — syncing settlements…"
- When `?connected=shopify`: fire `fetch-shopify-payouts`, show toast "Shopify connected — syncing payouts…"
- No parallel sync storm — only the newly connected channel syncs

## Files summary
| File | Action |
|------|--------|
| `src/components/onboarding/SetupWizard.tsx` | Simplify to 2 steps |
| `src/pages/Dashboard.tsx` | New discovery trigger, simplified wizard logic, per-channel sync |
| `src/components/dashboard/DiscoveryBanner.tsx` | New — animated discovery status |
| `src/components/dashboard/ConnectChannelsPrompt.tsx` | New — post-discovery channel connection UI |
| `supabase/functions/scan-xero-history/index.ts` | Add `light-discovery` mode |

