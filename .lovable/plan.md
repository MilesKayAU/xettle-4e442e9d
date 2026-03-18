

# AI Assistant Architecture — Remediation Plan

## Issues Found

1. **Anthropic direct call instead of Lovable AI Gateway** — The edge function calls `api.anthropic.com` directly with `ANTHROPIC_API_KEY`. This should use the Lovable AI Gateway (`ai.gateway.lovable.dev`) with `LOVABLE_API_KEY`, which is auto-provisioned.

2. **No real streaming** — Despite the SSE client, the edge function buffers the entire response across tool rounds and emits it as a single `data:` chunk. The user sees nothing until the full answer is ready.

3. **`useAiPageContext` runs every render** — The second `useEffect` has no dependency array, causing unnecessary sanitize+stringify work on every render cycle.

4. **Tool registry duplication** — `toolRegistry.ts` (client) and `TOOL_DEFINITIONS` (edge function) define the same 3 tools independently. The client-side file is unused — tools are hardcoded in the edge function.

5. **Conversation lost on navigation** — Messages are React state only; closing the panel or navigating destroys history.

---

## Plan

### 1. Migrate edge function to Lovable AI Gateway

- Replace `api.anthropic.com` call with `ai.gateway.lovable.dev/v1/chat/completions`
- Use `LOVABLE_API_KEY` (already provisioned) instead of `ANTHROPIC_API_KEY`
- Switch message format from Anthropic to OpenAI-compatible (the gateway expects this)
- Use `google/gemini-3-flash-preview` as default model
- Convert tool definitions from Anthropic format to OpenAI function-calling format
- Adapt tool-result handling to OpenAI's `tool_calls` response shape
- Handle 429/402 from the gateway and pass through to client

### 2. Enable true streaming on final round

- After tool-calling rounds complete, make the final gateway call with `stream: true`
- Pipe the gateway's SSE stream directly to the client response (no buffering)
- Keep the existing client SSE parser unchanged — it already handles this format

### 3. Fix `useAiPageContext` dependency array

- Add a serialized dependency (e.g., `JSON.stringify(builder())`) to the second `useEffect` so it only fires when context data actually changes, not every render

### 4. Remove dead client-side tool registry

- Delete `src/ai/tools/toolRegistry.ts` — it's unused; tools are defined and executed server-side only
- Remove any imports referencing it

### 5. Persist conversation in sessionStorage

- On each message update, write `messages` to `sessionStorage` keyed by user ID
- On panel open, hydrate from `sessionStorage` if available
- Clear on explicit "clear" action or logout
- This survives navigation without needing a database table

---

## Technical Details

**Gateway payload shape (replaces Anthropic format):**
```typescript
{
  model: "google/gemini-3-flash-preview",
  messages: [
    { role: "system", content: systemPrompt },
    ...conversationMessages
  ],
  tools: [{ type: "function", function: { name, description, parameters } }],
  stream: true  // on final round
}
```

**Tool call response parsing changes:**
- Anthropic: `content[].type === "tool_use"` with `content[].input`
- OpenAI-compatible: `choices[0].message.tool_calls[]` with `function.arguments` (JSON string)

**Streaming final round:**
```typescript
// After tool rounds resolve, final call with stream: true
const finalResp = await fetch(GATEWAY_URL, { ...opts, body: JSON.stringify({ ...payload, stream: true }) });
return new Response(finalResp.body, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
```

**Files changed:**
- `supabase/functions/ai-assistant/index.ts` — gateway migration + streaming + tool format
- `src/ai/context/useAiPageContext.ts` — fix dependency array
- `src/hooks/use-ai-assistant.ts` — add sessionStorage persistence
- `src/ai/tools/toolRegistry.ts` — delete

