

# Add SP-API Fee Status Banner to Amazon Compliance Dashboard

## What Gets Built

An informational banner at the top of the Amazon Compliance Dashboard showing the current SP-API fee status — delayed indefinitely as of March 2026. This keeps the compliance team informed about cost implications and preparation timelines without cluttering the checklist.

## Details

### `src/components/admin/AmazonComplianceDashboard.tsx`

Add a collapsible info card between the header and the Tabs, containing:

- **Status badge**: "Fees Delayed" in amber
- **Summary**: The $1,400/year annual fee + GET call usage fees are on hold indefinitely. New timelines expected fall 2026.
- **Key facts** (collapsed by default):
  - Basic tier: 2.5M GET calls/month included
  - Overage: $0.40 per 1,000 calls
  - Does not apply to private sellers/vendors using SP-API for own business
  - Recommendation: Use Notifications API instead of polling to optimise future costs
- **Source attribution**: "Source: novadata.io, March 2026"

Uses existing `Collapsible` + `Card` components. No database changes needed — this is static advisory content rendered inline.

| File | Change |
|------|------|
| `src/components/admin/AmazonComplianceDashboard.tsx` | Add fee status banner between header and tabs |

