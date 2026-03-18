

# COA Audit Agent — Best Practice Advisor

## What We're Building

A small, self-contained "COA Health Check" panel inside the Account Mapper card. When the user clicks "Analyse COA", it sends their full Xero COA and active marketplace connections to a dedicated edge function. The AI (via Lovable AI Gateway) acts as a Xero best-practice specialist and returns structured audit advice: what's good, what's missing, what should be renamed or restructured.

## Architecture

```text
┌─────────────────────────────────────┐
│  AccountMapperCard.tsx              │
│  ┌───────────────────────────────┐  │
│  │  CoaAuditPanel (new component)│  │
│  │  [Analyse COA] button         │  │
│  │  → streams markdown response  │  │
│  │  rendered with ReactMarkdown  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
         │ POST (auth'd)
         ▼
┌─────────────────────────────────────┐
│  Edge fn: ai-coa-audit/index.ts     │
│  - Reads xero_chart_of_accounts     │
│  - Reads marketplace_connections    │
│  - Builds specialist system prompt  │
│  - Calls Lovable AI Gateway (stream)│
│  - Returns SSE stream               │
└─────────────────────────────────────┘
```

## Implementation

### 1. New edge function: `supabase/functions/ai-coa-audit/index.ts`

- Auth via Bearer JWT (same pattern as `ai-assistant`)
- Fetches user's `xero_chart_of_accounts` (all active accounts: code, name, type, tax_type)
- Fetches user's `marketplace_connections` (active/connected)
- Builds a specialist system prompt focused exclusively on Xero COA best practices for Australian marketplace sellers:
  - Naming conventions (e.g., `{Code} {Marketplace} {Category}`)
  - Account type correctness (Revenue vs Expense vs Current Asset)
  - Tax type correctness (GST on Income vs GST Free for international)
  - Missing categories per marketplace (Sales, Fees, Shipping, Refunds, Clearing)
  - Clearing account structure
  - Numbering consistency and gaps
  - Common anti-patterns (e.g., mixing marketplace names in one account)
- Sends COA + marketplace list as user message context
- Streams response via Lovable AI Gateway (`google/gemini-3-flash-preview`)
- Handles 429/402 errors

### 2. New UI component: `src/components/settings/CoaAuditPanel.tsx`

- Small collapsible panel within the Account Mapper card
- "Analyse My COA" button with sparkles icon
- Streams AI response token-by-token, rendered with `ReactMarkdown`
- Shows loading state while streaming
- Collapsible result so it doesn't dominate the mapper
- No conversation — single-shot audit analysis (user can re-run to get fresh analysis)

### 3. Integration into `AccountMapperCard.tsx`

- Render `CoaAuditPanel` near the top of the card, after the COA sync strip but before the mapping rows
- Pass `coaAccounts` and `activeMarketplaces` as props (already loaded)
- Only visible for admin users with an active Xero connection

### Files to Create/Edit

| File | Action |
|---|---|
| `supabase/functions/ai-coa-audit/index.ts` | Create — edge function with specialist COA prompt |
| `src/components/settings/CoaAuditPanel.tsx` | Create — streaming audit UI panel |
| `src/components/settings/AccountMapperCard.tsx` | Edit — mount `CoaAuditPanel` in the card |
| `supabase/config.toml` | Auto-updated on deploy |

