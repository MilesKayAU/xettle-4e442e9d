

## Improve AI Assistant: Page-Aware, Concise, No-Code-Disclosure

### Problem
1. **GenericMarketplaceDashboard has no AI context** — when the user opens the Bunnings tab and asks the AI, it only gets the generic Dashboard context (`routeId: 'dashboard'`). It has no idea the user is looking at File Reconciliation, what marketplace is selected, or what the settlements show.
2. **The AI gives long, generic answers** instead of short, strategic responses about what's visible on screen.
3. **No explicit rule against disclosing code** — the AI could reference internal implementation details to customers.

### Changes

#### 1. Add `useAiPageContext` to `GenericMarketplaceDashboard` (File: `src/components/admin/accounting/GenericMarketplaceDashboard.tsx`)

Register rich page context including:
- `routeId: 'settlements'`
- `pageTitle` with marketplace name (e.g. "Bunnings Settlements")
- `primaryEntities.marketplace_codes` with the current code
- `pageStateSummary` with: settlement count, how many reconciled vs flagged, how many pushed to Xero, CSV-only status, any active filters
- `suggestedPrompts` tailored to what's on screen (e.g. "What does 'check required' mean?", "Why is this settlement negative?", "What do these columns mean?")
- `visibleTables` with column names and a sample of settlement rows (settlement_id, sales, fees, refunds, net, reconciliation_status)

Import `useAiPageContext` and `useAiActionTracker`, add the hook call after the existing hooks.

#### 2. Enhance system prompt with page-specific guidance (File: `supabase/functions/ai-assistant/index.ts`)

Add to `SYSTEM_PROMPT`:

**Conciseness rules:**
- Lead with a 1-2 sentence answer about what the user is looking at RIGHT NOW
- Never exceed 150 words unless the user explicitly asks for detail
- Use bullet points, not paragraphs
- Reference specific numbers from the context (settlement IDs, amounts, counts)

**Page-specific explainers** (injected when routeId matches):
- For marketplace settlement pages: explain what File Reconciliation means (internal maths check — Sales - Fees + Refunds ≈ Net Payout), what "check required" vs green tick means, what each column represents
- For outstanding: explain awaiting payment workflow
- For dashboard home: explain the three sections

**No-code disclosure rule:**
- "NEVER reference code, file names, function names, variable names, database tables, or internal implementation details. Only explain what the feature does from the user's perspective. If asked 'how does this work technically', explain the concept, never the code."

#### 3. Add a page-explainer knowledge block to the policy (File: `supabase/functions/_shared/ai_policy.ts`)

Add a new exported function `renderPageExplainers(routeId: string)` that returns targeted guidance for each page:

```
settlements / marketplace dashboard:
  - File Reconciliation = internal consistency check. Green tick = the file's numbers add up correctly. Orange warning = internal figures don't balance (Sales - Fees ≈ Net Payout).
  - "check required" = the settlement failed this maths check and needs review before pushing to Xero.
  - Settlement ID format: BUN-2301-YYYY-MM-DD = Bunnings PDF upload. shopify_auto_X = auto-generated from Shopify orders.
  - Columns: Sales (gross revenue), Fees (marketplace commission), Refunds (returned orders), Net (what hits your bank).
  - Negative Net = fees/refunds exceeded sales for that period.

outstanding:
  - Shows Xero invoices awaiting bank payment confirmation.
  
dashboard:
  - Three sections: Sync Status, Manual Uploads Needed, Ready for Xero.
```

#### 4. Use `renderPageExplainers` in the assistant (File: `supabase/functions/ai-assistant/index.ts`)

After building the system prompt with context, append the page-specific explainer:
```typescript
const pageGuide = renderPageExplainers(context?.routeId);
const systemPrompt = context
  ? `${basePrompt}\n\nCurrent page context:\n${JSON.stringify(context, null, 2)}\n\n${pageGuide}`
  : basePrompt;
```

### Files Modified
1. `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` — add `useAiPageContext` with rich settlement data
2. `supabase/functions/_shared/ai_policy.ts` — add `renderPageExplainers()` function
3. `supabase/functions/ai-assistant/index.ts` — add conciseness rules, no-code-disclosure rule, integrate page explainers

### Result
- AI will know exactly which marketplace the user is viewing and what settlements are shown
- Answers will be short, specific, and reference actual data on screen
- "What does this table mean?" will get a 3-bullet answer about File Reconciliation, not a 500-word essay about the settlement workflow
- No internal code or implementation details will ever be disclosed

