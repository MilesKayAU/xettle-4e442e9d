

# Growth Scout Fixes — Real Links + Fresh Results

## Problems

1. **Fake URLs**: The AI invents thread URLs that don't exist. "Open Thread" goes nowhere useful.
2. **No deduplication**: Each scout run generates ~10-15 new rows even if identical topics were already found/posted/dismissed. No freshness logic.

## Fixes

### 1. Replace fake "Open Thread" with real search links

Since we don't have a live web search API connected, the AI cannot find real thread URLs. Instead of linking to fabricated URLs:

- Change "Open Thread" to "Search for Thread" — constructs a real Google search URL scoped to the platform
- Format: `https://www.google.com/search?q={thread_title}+site:{platform_domain}`
- Platform domains: `reddit.com`, `community.xero.com`, `community.shopify.com`, `quora.com`
- This takes the admin directly to real matching threads they can engage with

### 2. Add deduplication to prevent repeat topics

In the edge function, before inserting new opportunities:

- Fetch existing `thread_title` values (last 30 days, any status) for the user
- Pass existing titles to the AI prompt: "Do NOT suggest threads similar to these already-found topics: [list]"
- This ensures each run produces genuinely new opportunities

### 3. Add "last scouted" timestamp display

Show when the last scout was run so the admin knows when to run again.

## Files to Edit

| File | Change |
|---|---|
| `src/components/admin/GrowthScoutDashboard.tsx` | Replace thread_url link with Google search link; add last-scouted display |
| `supabase/functions/growth-scout/index.ts` | Fetch existing titles, pass to AI prompt for dedup |

## Technical Detail

**Search URL construction** in the dashboard:
```
const platformDomains = {
  reddit: 'reddit.com',
  xero_community: 'community.xero.com',
  shopify_community: 'community.shopify.com',
  quora: 'quora.com',
};
const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(title)}+site:${domain}`;
```

**Dedup prompt addition** in edge function:
- Query `growth_opportunities` for user's existing titles from last 30 days
- Append to user message: "ALREADY COVERED (do not repeat): [titles]"

