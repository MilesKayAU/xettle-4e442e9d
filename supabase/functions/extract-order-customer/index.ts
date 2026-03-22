import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

/**
 * extract-order-customer
 * 
 * Accepts a base64-encoded screenshot of an Amazon order detail page,
 * uses vision AI to extract customer name/address/phone/email,
 * then PATCHes the matching Shopify draft order with the real customer data.
 * 
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

    const { image_base64, fbm_order_id, action } = await req.json()

    // Action: extract only (no Shopify patch)
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

    // Action: patch — extract + update Shopify draft
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

    if (!fbmOrder.shopify_order_id) {
      return new Response(JSON.stringify({ error: 'No Shopify order linked yet' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Get Shopify token
    const { data: shopifyToken } = await supabase
      .from('shopify_tokens')
      .select('access_token, shop_domain')
      .eq('user_id', fbmOrder.user_id)
      .limit(1)
      .single()

    if (!shopifyToken?.access_token || !shopifyToken?.shop_domain) {
      return new Response(JSON.stringify({ error: 'Shopify not connected' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. PATCH the Shopify draft order with customer data
    const shopifyUrl = `https://${shopifyToken.shop_domain}/admin/api/2024-01/orders/${fbmOrder.shopify_order_id}.json`

    const shopifyPayload = {
      order: {
        id: fbmOrder.shopify_order_id,
        note: `Amazon Order: ${fbmOrder.amazon_order_id} — Customer data extracted from screenshot`,
        shipping_address: {
          first_name: customerData.first_name || customerData.customer_name?.split(' ')[0] || '',
          last_name: customerData.last_name || customerData.customer_name?.split(' ').slice(1).join(' ') || '',
          address1: customerData.address1,
          address2: customerData.address2 || '',
          city: customerData.city || '',
          province: customerData.province || '',
          zip: customerData.zip || '',
          country_code: customerData.country_code || 'AU',
          phone: customerData.phone || '',
        },
        ...(customerData.email ? {
          customer: {
            first_name: customerData.first_name || customerData.customer_name?.split(' ')[0] || '',
            last_name: customerData.last_name || customerData.customer_name?.split(' ').slice(1).join(' ') || '',
            email: customerData.email,
          },
        } : {}),
      },
    }

    const patchRes = await fetch(shopifyUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': shopifyToken.access_token,
      },
      body: JSON.stringify(shopifyPayload),
    })

    if (!patchRes.ok) {
      const errText = await patchRes.text()
      console.error('shopify_patch_failed', patchRes.status, errText)
      return new Response(JSON.stringify({
        status: 'patch_failed',
        data: customerData,
        error: `Shopify returned ${patchRes.status}: ${errText.substring(0, 200)}`,
      }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Log system event
    await supabase.from('system_events').insert({
      user_id: fbmOrder.user_id,
      event_type: 'fbm_customer_patched',
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
      status: 'patched',
      data: customerData,
      shopify_order_id: fbmOrder.shopify_order_id,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('extract_order_customer_error', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
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
