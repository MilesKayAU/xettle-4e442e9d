import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * extract-order-customer
 * 
 * Accepts a base64-encoded screenshot of an Amazon order detail page,
 * uses vision AI to extract customer name/address/phone/email,
 * then saves the extracted data to our amazon_fbm_orders table.
 * 
 * The actual Shopify update is handled by sync-amazon-fbm-orders (push_single action).
 * No SP-API PII calls — the screenshot is a manual human action.
 */

const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions'

const EXTRACTION_PROMPT = `You are an order data extractor. Analyse this screenshot of an Amazon order detail page and extract the customer shipping information.

Extract ALL of the following fields. If a field is not visible, set it to null.

Return ONLY valid JSON in this exact format:
{
  "customer_name": "Full Name",
  "first_name": "First",
  "last_name": "Last",
  "address1": "Street address line 1",
  "address2": "Unit/apartment/suite (or null)",
  "city": "City/suburb",
  "province": "State/province",
  "zip": "Postcode/ZIP",
  "country_code": "2-letter ISO country code (e.g. AU, US, GB)",
  "phone": "Phone number with country code (or null)",
  "email": "Email address (or null)",
  "amazon_order_id": "The Amazon order ID visible on screen (e.g. 123-1234567-1234567)"
}

Important:
- For Australian addresses, province should be the state abbreviation (NSW, VIC, QLD, etc.)
- Include country calling code for phone if visible (e.g. +61)
- The amazon_order_id is critical for matching — look for it in the order header
- Do NOT invent or guess data that isn't visible on the screenshot`

serve(async (req: Request) => {
  const origin = req.headers.get('Origin') ?? ''
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const body = await req.json()
    const { image_base64, fbm_order_id, action } = body
    console.log('[extract-order-customer] POST received', { action: action ?? 'save', hasImage: !!image_base64, imageLen: image_base64?.length ?? 0, fbm_order_id: fbm_order_id ?? null })

    // Action: extract only (no DB save)
    if (action === 'extract') {
      if (!image_base64) {
        return new Response(JSON.stringify({ error: 'image_base64 is required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const extracted = await extractCustomerFromScreenshot(image_base64, LOVABLE_API_KEY)
      return new Response(JSON.stringify({ status: 'extracted', data: extracted }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Action: save — extract + save PII to amazon_fbm_orders
    if (!image_base64 || !fbm_order_id) {
      return new Response(JSON.stringify({ error: 'image_base64 and fbm_order_id are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Extract customer data from screenshot
    const customerData = await extractCustomerFromScreenshot(image_base64, LOVABLE_API_KEY)

    if (!customerData.customer_name || !customerData.address1) {
      return new Response(JSON.stringify({
        status: 'extraction_incomplete',
        data: customerData,
        error: 'Could not extract customer name and address from screenshot',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Look up the FBM order
    const { data: fbmOrder, error: fbmErr } = await supabase
      .from('amazon_fbm_orders')
      .select('*')
      .eq('id', fbm_order_id)
      .single()

    if (fbmErr || !fbmOrder) {
      return new Response(JSON.stringify({ error: 'FBM order not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Merge extracted PII into raw_amazon_payload in the format extractPiiFromOrder() reads
    const existingPayload = fbmOrder.raw_amazon_payload || {}
    const enrichedPayload = {
      ...existingPayload,
      // Store in v2026-01-01 shape that sync-amazon-fbm-orders extractPiiFromOrder() reads
      recipient: {
        ...(existingPayload as any)?.recipient,
        name: customerData.customer_name,
        shippingAddress: {
          name: customerData.customer_name,
          addressLine1: customerData.address1,
          addressLine2: customerData.address2 || null,
          city: customerData.city || null,
          stateOrRegion: customerData.province || null,
          postalCode: customerData.zip || null,
          countryCode: customerData.country_code || 'AU',
          phone: customerData.phone || null,
        },
      },
      buyer: {
        ...(existingPayload as any)?.buyer,
        buyerName: customerData.customer_name,
        ...(customerData.email ? { buyerEmail: customerData.email } : {}),
      },
      // Store the raw extraction for audit
      _screenshot_extraction: {
        extracted_at: new Date().toISOString(),
        ...customerData,
      },
    }

    // 4. Update the order — save enriched payload and mark as ready for push
    const { error: updateErr } = await supabase
      .from('amazon_fbm_orders')
      .update({
        raw_amazon_payload: enrichedPayload,
        error_detail: `Customer data extracted from screenshot: ${customerData.customer_name}`,
      } as any)
      .eq('id', fbm_order_id)

    if (updateErr) {
      console.error('[extract-order-customer] DB update failed', updateErr.message)
      return new Response(JSON.stringify({
        status: 'save_failed',
        data: customerData,
        error: `Failed to save: ${updateErr.message}`,
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Log system event
    await supabase.from('system_events').insert({
      user_id: fbmOrder.user_id,
      event_type: 'fbm_customer_extracted',
      severity: 'info',
      marketplace_code: 'AMAZON_AU',
      settlement_id: fbmOrder.amazon_order_id,
      details: {
        shopify_order_id: fbmOrder.shopify_order_id,
        customer_name: customerData.customer_name,
        city: customerData.city,
        source: 'screenshot_extraction',
      },
    } as any)

    return new Response(JSON.stringify({
      status: 'saved',
      data: customerData,
      shopify_order_id: fbmOrder.shopify_order_id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = (err as Error).message || 'Unknown error'
    console.error('[extract-order-customer] unhandled', msg)
    return new Response(JSON.stringify({ error: msg, stage: 'server' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

async function extractCustomerFromScreenshot(
  base64Image: string,
  apiKey: string,
): Promise<Record<string, string | null>> {
  // Strip data URI prefix if present
  const cleanBase64 = base64Image.replace(/^data:image\/[a-z]+;base64,/, '')

  const response = await fetch(AI_GATEWAY, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${cleanBase64}`,
              },
            },
            {
              type: 'text',
              text: 'Extract the customer shipping details from this Amazon order screenshot.',
            },
          ],
        },
      ],
      max_tokens: 1000,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`AI extraction failed (${response.status}): ${errText.substring(0, 200)}`)
  }

  const result = await response.json()
  const content = result.choices?.[0]?.message?.content || ''

  // Parse JSON from the response (handle markdown code blocks)
  const jsonMatch = content.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('AI did not return valid JSON')
  }

  try {
    return JSON.parse(jsonMatch[0])
  } catch {
    throw new Error('Failed to parse AI extraction result')
  }
}

function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(handler)
}
