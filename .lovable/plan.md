

## Plan: Add Advertising Spend Layer to Insights Dashboard

### 1. Database Migration

Create `marketplace_ad_spend` table with unique constraint and `updated_at`:

```sql
CREATE TABLE public.marketplace_ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  spend_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'AUD',
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, marketplace_code, period_start)
);

ALTER TABLE public.marketplace_ad_spend ENABLE ROW LEVEL SECURITY;

-- RLS: users own their records
CREATE POLICY "Users can select own ad spend" ON public.marketplace_ad_spend FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own ad spend" ON public.marketplace_ad_spend FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ad spend" ON public.marketplace_ad_spend FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own ad spend" ON public.marketplace_ad_spend FOR DELETE USING (auth.uid() = user_id);

-- updated_at trigger
CREATE TRIGGER update_marketplace_ad_spend_updated_at
  BEFORE UPDATE ON public.marketplace_ad_spend
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

### 2. InsightsDashboard.tsx Changes

**Data loading** -- fetch `marketplace_ad_spend` alongside settlements, aggregate ad spend by marketplace using monthly grouping.

**"Return per $1 Sold" section** -- for each marketplace:
- Show current marketplace return bar (unchanged)
- Below it, show "After advertising" line:
  - If ad data exists: muted/lighter bar + value like `$0.67`
  - If no ad data: subtle placeholder -- *"After advertising: — Add ad spend to calculate true return"* with `[Add Ad Spend]` button
- Add stacked `$1 Sale Breakdown` visualization showing Net Kept | Ads | Fees segments

**Insight messages:**
- "Advertising reduced your Amazon return by 18%"
- "Bunnings currently returns $0.21 more per $1 sold than Amazon"

**Ad Spend Input Dialog:**
- Triggered from "Add Ad Spend" button (per marketplace)
- Fields: Month picker, Spend amount, Currency (default AUD), Notes (optional)
- Saves to `marketplace_ad_spend` with `source = 'manual'`
- Upserts on the unique constraint to allow editing

**Fee Intelligence table:**
- Add "Ad Spend" and "After Ads" columns (show `—` when no data)

**Marketplace Overview cards:**
- Add ad spend row if data exists, otherwise show "No ad data" prompt

**Tooltips on formulas:**
- Marketplace return: "Net settlement / Gross sales"
- Return after ads: "(Net settlement - Ad spend) / Gross sales"

**Calculation safeguards:**
- `if (grossSales <= 0) return null` -- prevent divide-by-zero
- Clamp `returnAfterAds` to minimum `-1` to ignore impossible values
- Monthly aggregation: group settlements by `month(period_end)` before matching to ad spend periods

### 3. Period Matching Logic

```text
settlements grouped by: YYYY-MM of period_end
ad_spend grouped by:    YYYY-MM of period_start
join on:                marketplace + month
```

This avoids mismatched ratios from settlements spanning months.

### Files Changed

| File | Change |
|------|--------|
| New migration | Create `marketplace_ad_spend` table + RLS + trigger |
| `InsightsDashboard.tsx` | Ad spend fetch, dual-layer metrics, stacked bars, input dialog, insight messages, tooltips, safeguards |

### What's NOT Changing

- Settlement engine, parser, Xero sync -- all unchanged
- Ad spend is analytics only -- never pushed to Xero

