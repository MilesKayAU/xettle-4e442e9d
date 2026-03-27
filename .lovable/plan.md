## AI-Powered Gap Auto-Investigation

### Status: Deployed ✅

### What it does
When gaps appear in the GapTriageTable, users can now:
1. **Auto-Scan All** — batch-scans all active gaps via Claude Sonnet, suggesting acknowledgement reasons
2. **One-click Accept** — for high-confidence suggestions, a green "Accept: {reason}" button acknowledges in one click
3. **Pre-filled Modal** — for medium/low confidence, the acknowledge modal opens pre-filled so the user reviews before accepting

### Architecture
- **Edge function**: `supabase/functions/ai-gap-suggest-reason/index.ts`
  - Uses Anthropic Claude Sonnet directly (matches ai-account-mapper pattern)
  - `verify_jwt = true` in config.toml (financial data protection)
  - Queries settlements, marketplace_validation, bank_transactions, settlement_lines via service role
  - Returns structured JSON: `{ suggested_reason, confidence, explanation }`
  - Validates against 9 allowed reason values

- **UI**: `src/components/dashboard/GapTriageTable.tsx`
  - New state: `aiSuggestions` record
  - Auto-Scan All button with 1s rate limiting and progress indicator
  - Confidence-gated UI: high → one-click, medium/low → modal
  - AI suggestion badge inline in "Likely Cause" column
  - Audit trail: `ai_gap_suggestion_accepted` event logged to system_events

### Guardrails
All 6 guardrails return 0 violations (guardrail 5 excludes `already_recorded` pre-boundary rows by design).
