

## Add Bookkeeper Daily Workflow Guide

### Problem
The dashboard has all the right tools, but a bookkeeper can't tell at a glance what needs doing today. Critical actions (push to Xero, reconciliation gaps, missing files) are spread across tabs with no unified priority view.

### Changes

**1. Add a "Today's Tasks" summary strip to the Dashboard tab**

Create `src/components/dashboard/DailyTaskStrip.tsx` — a compact, always-visible strip at the top of the Dashboard view (above SystemStatusStrip) that shows:

- **Files to review** — count of settlements in `ingested` status → links to Upload tab
- **Ready to push** — count of `ready_to_push` settlements → links to Action Centre (scroll down)
- **Awaiting reconciliation** — count of `pushed_to_xero` not yet `reconciled_in_xero` → links to Outstanding tab
- **Reconciliation alerts** — count of active reconciliation hub items → links to Settlements > Reconciliation

Each item is a clickable card that navigates to the right place. Items with count=0 show a green check. The strip answers: "What do I need to do right now?"

Data source: single query to `settlements` table grouped by status + count from `reconciliation_hub` active items.

**2. Add badge counts to the Settlements tab**

The Outstanding tab already has a badge. Add a similar badge to the **Settlements** tab showing the count of `ready_to_push` settlements (the most urgent action). This makes the tab bar itself a status indicator.

**3. Add a Settings tab to the main nav bar**

Move Settings from the hidden gear icon to a visible tab in the primary nav bar (after Insights). Keep the gear icon as well for discoverability. This ensures bookkeepers can find account mapping and boundary settings without hunting.

### Files Changed

| File | Change |
|------|--------|
| `src/components/dashboard/DailyTaskStrip.tsx` | New — today's priority task cards |
| `src/pages/Dashboard.tsx` | Add DailyTaskStrip to dashboard view, add badge to Settlements tab, add Settings to tab bar |

No database changes. No edge function changes.

