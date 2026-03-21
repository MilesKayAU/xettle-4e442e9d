import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const SYSTEM_PROMPT = `You are an Amazon SP-API compliance specialist for an e-commerce integration platform called Xettle.

## Xettle's Current SP-API Architecture

### Authentication & Authorization
- OAuth/LwA flow implemented in \`amazon-auth\` edge function
- Refresh token auto-rotation on every API call in \`sync-amazon-fbm-orders\`
- Tokens stored in \`amazon_tokens\` table with encryption at rest (Supabase vault)
- Multi-store support via dynamic token lookup by user_id

### Order Sync & Fulfillment Bridge
- \`sync-amazon-fbm-orders\`: Polls Amazon Orders API for unshipped FBM orders
- \`shopify-fbm-fulfillment-webhook\`: Listens for Shopify fulfillment events, calls Amazon Shipping/Feeds API to confirm shipment
- Circuit breaker pattern: After 3 consecutive failures, halts polling and logs \`circuit_open\` event
- Retry queue: Failed orders stored with \`retry_count\`, \`last_retry_at\`, exponential backoff with jitter
- Cancellation detection: Orders with status \`Cancelled\` are marked and skipped

### Rate Limiting & Throttling
- \`auditedFetch\` wrapper captures \`x-amzn-RateLimit-Remaining\` header on every SP-API call
- All API calls logged to \`api_call_log\` table with latency, status code, rate limit remaining
- Circuit breaker activates on repeated 429s or 5xx errors

### Data Protection & PII
- Privacy Policy Section 5b defines 30-day PII retention after shipment
- No buyer email/phone stored in \`amazon_fbm_orders\` — only order IDs and status
- \`raw_amazon_payload\` stores order metadata (no PII fields extracted)
- Australian tax law exception documented for GST compliance data retention

### Security Controls
- Admin access gated by \`is_primary_admin()\` database function
- PIN-protected settings panel
- Role-based access via \`user_roles\` table with RLS
- Service role keys used only in edge functions, never exposed to client

### Monitoring & Audit
- \`api_call_log\` table: Every SP-API request logged with endpoint, method, status, latency, rate limit
- \`system_events\` table: Business events (order created, circuit open, sync complete)
- Health scanner dashboard with API policy audit
- CSV export of audit logs for Amazon review

### Idempotency
- \`amazon_order_id\` used as deduplication key
- Status checks prevent re-processing already-fulfilled orders
- Settlement fingerprint system prevents duplicate financial records

### Files & Functions Reference
- \`supabase/functions/sync-amazon-fbm-orders/index.ts\` — Order polling + circuit breaker
- \`supabase/functions/shopify-fbm-fulfillment-webhook/index.ts\` — Fulfillment confirmation
- \`supabase/functions/amazon-auth/index.ts\` — OAuth flow
- \`supabase/functions/_shared/api-audit.ts\` — Audit logging helper
- \`supabase/functions/_shared/amazon-sp-api-policy.ts\` — API policy rules
- \`src/components/admin/FulfillmentBridge.tsx\` — Admin monitoring UI
- \`src/components/admin/AmazonComplianceDashboard.tsx\` — Compliance dashboard

## Your Task
When given an email from Amazon's developer support team:
1. Extract each specific requirement or question they are asking about
2. For each requirement, determine if Xettle already implements it (reference specific files/features above)
3. If not implemented, clearly state what needs to be built
4. Draft a professional reply email addressing each point with evidence

Format your response as JSON with this structure:
{
  "requirements": [
    {
      "requirement": "Brief description of what Amazon is asking",
      "status": "compliant" | "partial" | "not_implemented",
      "evidence": "Specific files, features, or architecture that satisfy this",
      "action_needed": "What needs to be done if not fully compliant, or null"
    }
  ],
  "draft_reply": "A professional email reply addressing all points"
}`

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { emailText } = await req.json()
    if (!emailText || typeof emailText !== 'string') {
      return new Response(JSON.stringify({ error: 'emailText is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze this email from Amazon's developer support team and provide a compliance assessment:\n\n${emailText}` },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'compliance_analysis',
              description: 'Return structured compliance analysis of Amazon email requirements',
              parameters: {
                type: 'object',
                properties: {
                  requirements: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        requirement: { type: 'string' },
                        status: { type: 'string', enum: ['compliant', 'partial', 'not_implemented'] },
                        evidence: { type: 'string' },
                        action_needed: { type: 'string' },
                      },
                      required: ['requirement', 'status', 'evidence'],
                      additionalProperties: false,
                    },
                  },
                  draft_reply: { type: 'string' },
                },
                required: ['requirements', 'draft_reply'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'compliance_analysis' } },
      }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded, please try again shortly.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const errText = await response.text()
      console.error('AI gateway error:', response.status, errText)
      throw new Error('AI analysis failed')
    }

    const data = await response.json()
    
    // Extract tool call result
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0]
    if (toolCall?.function?.arguments) {
      const result = JSON.parse(toolCall.function.arguments)
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fallback: try to parse content as JSON
    const content = data.choices?.[0]?.message?.content || ''
    try {
      const parsed = JSON.parse(content)
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch {
      return new Response(JSON.stringify({ draft_reply: content, requirements: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  } catch (err) {
    console.error('ai-amazon-compliance error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
