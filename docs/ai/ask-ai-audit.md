# Ask AI — Pre-Upgrade Audit

> Captured: 2026-03-16 | Pre-V1 page-aware upgrade

## 1. Where is it mounted?

- **`AskAiButton`** rendered in `src/pages/Dashboard.tsx:1007` only
- Not available on: `/admin`, `/setup`, `/pricing`, `/auth`, `XeroPostingAudit`, or any standalone page
- Floated `fixed bottom-16 right-4 z-50`

## 2. Current context shape

Built in `Dashboard.tsx:491` via `useMemo`:

```json
{ "page": "dashboard|settlements|insights", "month": "March 2026", "marketplaces": ["amazon_au", "shopify_payments"] }
```

- No entity IDs (settlement_id, xero_invoice_id)
- No counts (outstanding, ready_to_push, gaps)
- No readiness/tier/blocker information
- No user selections or visible table data

## 3. Backend edge function

- **File:** `supabase/functions/ai-assistant/index.ts`
- **Auth:** Bearer JWT → `supabase.auth.getUser(token)` (server-validated)
- **Model:** Anthropic Claude Sonnet (`claude-sonnet-4-20250514`) via direct API
- **Streaming:** Anthropic SSE → re-emitted as OpenAI-compatible SSE
- **Context injection:** `SYSTEM_PROMPT + "\n\nCurrent page context:\n" + JSON.stringify(context)`

## 4. Tool/function calling

**None.** No tool definitions, no tool-calling loop. The model can only answer from its training data + the tiny context blob.

## 5. Rate limits / quotas

- **Monthly limit:** 50 questions (constant in both client + server)
- **Table:** `ai_usage` — keyed on `(user_id, month)` — question_count incremented per call
- **Admin bypass:** admins skip the limit check
- **Client display:** `AiChatPanel.tsx:17` shows remaining count

## 6. Role gating

- Allowed: `pro`, `admin`, `starter` roles (checked via `has_role` RPC)
- Blocked: `trial` users get 402 response

## 7. Security model

- JWT verified server-side
- All data access would be user-scoped (but no data access currently happens)
- No PII sent in context (only marketplace codes + page name)
- No DOM scraping

## 8. Key files

| File | Role |
|---|---|
| `src/components/ai-assistant/AskAiButton.tsx` | FAB button + role check |
| `src/components/ai-assistant/AiChatPanel.tsx` | Sheet UI, message rendering (ReactMarkdown) |
| `src/hooks/use-ai-assistant.ts` | Client hook: message state, SSE parsing, usage tracking |
| `supabase/functions/ai-assistant/index.ts` | Edge fn: auth, rate limit, Anthropic streaming |
| `src/pages/Dashboard.tsx:491-507` | Context builder + suggested prompts |

## 9. Gaps identified

1. **Dashboard-only** — not available sitewide
2. **No entity context** — can't answer "is this invoice pushed?" because it doesn't know which invoice
3. **No tool calling** — can't fetch data; must guess from training
4. **Minimal context** — page name + marketplace codes only
5. **No sanitizer** — context goes raw (currently safe because it's tiny, but unguarded)
6. **No suggested prompts on other pages** — only dashboard has them
