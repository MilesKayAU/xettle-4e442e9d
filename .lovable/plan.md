

## Review & Plan: Hardening the AI Assistant Architecture

### Current State (What's Already Done)

Most of what you've listed is **already implemented** from the prior sessions:

1. **Backend is already the source of truth** — `supabase/functions/_shared/ai_tool_registry.ts` defines `AI_TOOL_REGISTRY` with full schemas and route availability. The `ai-assistant/index.ts` imports from it. The client file `src/ai/tools/aiToolRegistry.ts` is explicitly labeled as a "client-side mirror" with a comment to sync manually.

2. **recentActions is already wired** — `AiPageContext` has a `recentActions` field, `useAiActionTracker` hook exists, and it's wired into Dashboard (tab switches) and PushSafetyPreview (open/confirm). The context is sent to the assistant and sanitized.

3. **Policy is centralized** — `_shared/ai_policy.ts` renders hard rules into the system prompt.

### What's Actually Missing

**A. Read-only enforcement in system prompt and tool descriptions**

The SYSTEM_PROMPT has accounting rules but does NOT explicitly say:
- "You cannot perform actions or modify data."
- "Never instruct the user to paste secrets/tokens."
- "If the user asks to push/post/update, respond with steps the user should take in the UI."

Tool descriptions don't emphasize "lookup-only" nature.

**B. `executeTool` should be extracted to a shared module**

Currently `executeTool` is a 300-line function inline in `ai-assistant/index.ts`. The request was to export `executeTool(name, input, ctx)` as a single dispatcher alongside the tool defs.

**C. Client mirror could drift — no validation**

The client mirror is manually synced. No runtime or build-time check ensures parity.

### Plan

#### 1. Add read-only guardrails to SYSTEM_PROMPT (~3 lines in `ai_policy.ts`)

Add to `renderPolicyForPrompt()`:

```
READ-ONLY ASSISTANT RULES:
- You are a read-only assistant. You cannot perform actions or modify any data.
- Never instruct the user to paste secrets, tokens, or API keys into the chat.
- If the user asks to push, post, update, or delete, explain the steps they should take in the UI instead.
- You may only look up and explain data — never execute write operations.
```

#### 2. Update tool descriptions to emphasize "lookup-only"

Prefix each tool's `description` in `ai_tool_registry.ts` with "[Read-only]" or append "This is a lookup-only tool that does not modify any data."

#### 3. Extract `executeTool` to `_shared/ai_tool_registry.ts`

Move the `executeTool` function from `ai-assistant/index.ts` into the shared registry file alongside the tool definitions. This co-locates definitions with execution and makes the registry truly self-contained. The assistant imports `executeTool` the same way it imports `getToolsForRoute`.

#### 4. Add a `READ_ONLY_POLICY` constant to the shared registry

```ts
export const READ_ONLY_POLICY = "All tools are read-only lookups. No tool may write, update, or delete data.";
```

Injected into the system prompt alongside the existing policy.

#### 5. Auto-generate client mirror (lightweight)

Add a comment block at the top of the client mirror with a checksum or tool count assertion. On the server side, export `AI_TOOL_REGISTRY.length` so a simple test can catch drift. This avoids complex build tooling.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/_shared/ai_policy.ts` | Add READ-ONLY ASSISTANT RULES block |
| `supabase/functions/_shared/ai_tool_registry.ts` | Add "[Read-only]" to descriptions, add `READ_ONLY_POLICY`, move `executeTool` here |
| `supabase/functions/ai-assistant/index.ts` | Import `executeTool` from shared, remove inline copy |
| `src/ai/tools/aiToolRegistry.ts` | Sync descriptions, add `EXPECTED_TOOL_COUNT` for drift detection |

