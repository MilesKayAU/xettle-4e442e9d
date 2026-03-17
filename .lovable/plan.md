

## Navigation & Information Architecture Audit

### Current Structure

```text
┌─────────────────────────────────────────────────────────┐
│ TOP BAR: Logo | Plans | Admin | Connections | Sign Out  │
├─────────────────────────────────────────────────────────┤
│ PRIMARY NAV (6 tabs):                                   │
│  Dashboard | Outstanding | Upload | Settlements |       │
│                              Insights | Settings        │
├─────────────────────────────────────────────────────────┤
│ SUB-TABS (Settlements):                                 │
│  All Settlements | Overview | Reconciliation Hub        │
│                                                         │
│ SUB-TABS (Insights):                                    │
│  Overview | Reconciliation | Profit Analysis | SKU      │
└─────────────────────────────────────────────────────────┘
```

### Issues Identified

**1. "Settlements" is overloaded — it hides 3 distinct dashboards**
- "All Settlements" = per-marketplace data tables (the real settlement browser)
- "Overview" = `ValidationSweep` — a cross-marketplace summary with status counts (Complete, Ready to Push, Action Needed, Gaps)
- "Reconciliation Hub" = action queue for push failures and unmatched items

The "Overview" sub-tab is actually the most useful high-level view but is buried one click deep. Meanwhile, "All Settlements" (which requires selecting a marketplace first) is the default.

**2. "Dashboard" duplicates content from other tabs**
- `RecentSettlements` on Dashboard duplicates what's in Settlements → All
- `ActionCentre` duplicates what's in Reconciliation Hub
- `DailyTaskStrip` links out to the same sub-tabs
- The Dashboard is trying to be a "command centre" but ends up being a gateway page that users click through rather than work in

**3. "Outstanding" is a specialised Xero view with a generic name**
- It only shows settlements with `xero_status = 'authorised_in_xero'` (awaiting payment)
- Users may not understand what "Outstanding" means without Xero context
- Could be a sub-tab under Settlements rather than a top-level tab

**4. "Reconciliation" appears in two places**
- Settlements → Reconciliation Hub (action-oriented, filtered queue)
- Insights → Reconciliation (read-only health dashboard)
- These serve different purposes but the naming overlap is confusing

**5. Six primary tabs is at the upper limit for cognitive load**
- With badges on Outstanding and Settlements, users see competing attention signals

### Recommended Restructure

```text
┌───────────────────────────────────────────────────────┐
│ PRIMARY NAV (4 tabs):                                 │
│  Home | Settlements | Insights | Settings             │
├───────────────────────────────────────────────────────┤
│ Settlements sub-tabs:                                 │
│  Overview | All | Outstanding | Reconciliation        │
│                                                       │
│ Insights sub-tabs:                                    │
│  Dashboard | Profit | SKU | Reconciliation Health     │
└───────────────────────────────────────────────────────┘
```

**Key changes:**

1. **Rename "Dashboard" → "Home"** — keeps it as the landing page with task strip, action centre, and status cards. Remove the duplicated `RecentSettlements` table (users go to Settlements → All for that).

2. **Move "Outstanding" under Settlements** as a sub-tab — it's a filtered view of settlements by Xero status, not a separate domain. Label it "Awaiting Payment" for clarity.

3. **Move "Upload" into a persistent action button** (e.g. a prominent "Upload" button in the header or a floating action) rather than a full nav tab. Upload is an *action*, not a *destination*. The upload flow can open as a modal or slide-over panel.

4. **Make Settlements → Overview the default sub-tab** — the cross-marketplace summary (status counts, gaps) is what users need first. "All Settlements" becomes the drill-down.

5. **Clarify reconciliation naming:**
   - Settlements → "Action Queue" (was Reconciliation Hub) — action items
   - Insights → "Reconciliation Health" — read-only metrics

### Implementation Details

**Files affected:**
- `src/pages/Dashboard.tsx` — restructure `DashboardView` type, reorder nav tabs, adjust sub-tab defaults
- No new pages or routes needed — everything stays on `/dashboard` with the same view-switching pattern

**Specific code changes:**

1. Update `DashboardView` type:
   ```typescript
   type DashboardView = 'home' | 'settlements' | 'insights' | 'settings';
   ```

2. Update `SettlementsSubTab` to include outstanding:
   ```typescript
   type SettlementsSubTab = 'overview' | 'all' | 'outstanding' | 'reconciliation';
   ```

3. Change default `settlementsSubTab` from `'all'` to `'overview'`

4. Move the Upload flow to a header button that opens a dialog/sheet, or keep it as a sub-view accessible from a CTA on Home rather than a primary tab

5. Rename nav labels and move the Outstanding query logic into the Settlements section

6. Update `localStorage` keys and migration for existing users (map old `'dashboard'` → `'home'`, old `'outstanding'` → settlements with outstanding sub-tab)

7. Update all `switchView()` calls across components that reference the old view names (ActionCentre, DailyTaskStrip, CoaBlockerCta, etc.)

This is a moderate refactor touching ~10-15 files for cross-references, but no new components — just reorganising existing ones.

