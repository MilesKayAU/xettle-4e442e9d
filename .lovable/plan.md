

# SEO Opportunity Scout — Admin Dashboard

## What We're Building

A new admin-only tab called "Growth Scout" that uses AI to find organic marketing opportunities across Reddit, forums, and communities where Xero + marketplace sellers discuss their pain points. The system finds threads daily, generates value-first draft responses, and presents them for human review — it does NOT auto-post.

## Architecture

```text
┌──────────────────────────────────────┐
│  Admin.tsx — new "Growth" tab        │
│  ┌────────────────────────────────┐  │
│  │  GrowthScoutDashboard          │  │
│  │  [Run Scout] button            │  │
│  │  - Shows found opportunities   │  │
│  │  - AI-drafted responses        │  │
│  │  - Copy-to-clipboard action    │  │
│  │  - Mark as posted / dismissed  │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
         │ POST (admin auth)
         ▼
┌──────────────────────────────────────┐
│  Edge fn: growth-scout/index.ts      │
│  Step 1: Perplexity search for       │
│    recent threads matching queries   │
│  Step 2: AI (Lovable Gateway) ranks  │
│    opportunities & drafts responses  │
│  Returns structured JSON             │
└──────────────────────────────────────┘
```

## Why This Approach

- **No auto-posting** — avoids bans, shadowbans, and domain reputation damage. The system is a scout + copywriter, not a bot.
- **Perplexity for search** — finds real forum threads with citations. However, since Perplexity is not yet connected, we can start with the Lovable AI Gateway using web-aware models, or use a simple approach with curated search queries.
- **Human-in-the-loop** — admin reviews, edits, and manually posts. This is the only safe approach for Reddit/forums.

## Implementation

### 1. Database: `growth_opportunities` table

Stores found threads and draft responses for tracking:
- `id`, `user_id`, `platform` (reddit/quora/xero_community/shopify_community), `thread_url`, `thread_title`, `thread_snippet`, `relevance_score`, `draft_response`, `status` (new/dismissed/posted), `created_at`, `posted_at`

### 2. Edge function: `growth-scout/index.ts`

- Admin-only (JWT + role check)
- Uses Lovable AI Gateway to:
  1. Generate search-oriented queries (e.g. "xero amazon integration help site:reddit.com")
  2. Analyze and rank opportunities from a predefined set of search patterns
  3. Draft value-first responses that answer the question genuinely, with a soft mention of Xettle
- Returns array of opportunities with drafted responses
- Predefined search patterns covering:
  - "xero shopify integration" / "xero amazon sync" / "marketplace accounting australia"
  - "best software connect xero marketplace"
  - "reconcile amazon settlements xero"

### 3. UI Component: `GrowthScoutDashboard.tsx`

- Card-based layout showing each opportunity
- Thread title, platform badge, snippet, relevance score
- Expandable AI-drafted response with copy button
- Status actions: "Mark Posted" / "Dismiss" / "Edit Draft"
- Filter by platform, status
- "Run Scout" button to trigger a new scan

### 4. Integration into Admin.tsx

- New tab "Growth" with a target/crosshair icon
- Only visible for admin role (already enforced by the page)

## Search Query Strategy

Hardcoded rotation of ~15 high-value query patterns:
- `"connect xero to amazon" site:reddit.com`
- `"shopify xero integration" site:reddit.com`
- `"marketplace accounting software australia"`
- `"amazon seller fees xero reconciliation"`
- `"best xero add on for ecommerce"`
- `"shopify settlement accounting"`
- Plus Xero Community, Quora, and Australian small business forums

## Files to Create/Edit

| File | Action |
|---|---|
| `supabase/functions/growth-scout/index.ts` | Create — AI search + draft engine |
| `src/components/admin/GrowthScoutDashboard.tsx` | Create — opportunity review UI |
| `src/pages/Admin.tsx` | Edit — add Growth tab |
| DB migration | Create `growth_opportunities` table with RLS |

## Limitations & Notes

- Without Perplexity or Firecrawl connected, the initial version will use the Lovable AI Gateway's knowledge to suggest opportunities based on known forum patterns, rather than live-scraping threads. We can upgrade to Perplexity later for real-time thread discovery.
- All responses are drafted as genuinely helpful answers with Xettle mentioned as one option among others — never spammy.
- The system tracks what's been posted to avoid duplicate outreach.

