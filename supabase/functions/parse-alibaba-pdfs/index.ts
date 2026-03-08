import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  cost_type: 'Product' | 'Freight' | 'Service Fee';
  account_code: string;
  aud_amount?: number;
}

interface ParsedPDFData {
  order_number: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  order_date: string | null;
  internal_seller_name: string | null;
  supplier_name: string;
  line_items: LineItem[];
  total_usd: number | null;
  total_aud: number | null;
  service_fee_aud: number | null;
  currency: string;
  gst_registration: string | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { receiptImageBase64, serviceFeeImageBase64 } = await req.json();

    if (!receiptImageBase64 || !serviceFeeImageBase64) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Both Receipt PDF and Service Fee Invoice PDF images are required' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    console.log('Processing dual PDF extraction...');

    // Call Gemini Vision API with both images for structured extraction
    const extractionPrompt = `You are an expert at extracting structured invoice data from Alibaba order documents.

You are given TWO documents:
1. IMAGE 1: USD Receipt PDF - Contains the original order details, product lines, shipping, and AUD payment total
2. IMAGE 2: Service Fee Invoice PDF - Contains the exact service fee in AUD and the official supplier entity details

EXTRACT the following information and return as valid JSON:

{
  "order_number": "The full order number (e.g., 285318799001025780)",
  "invoice_number": "Full invoice number from Service Fee Invoice including any suffix (e.g., 285318799001025780_1009659)",
  "invoice_date": "Date from Service Fee Invoice in YYYY-MM-DD format (prioritize this over order date)",
  "order_date": "Order creation date in YYYY-MM-DD format",
  "internal_seller_name": "The actual seller/vendor name from the Receipt (e.g., 'calvin sui', 'Shenzhen XYZ Co.')",
  "gst_registration": "GST/Tax registration number from Service Fee Invoice (e.g., 'M90371710Y')",
  "total_usd": The total USD amount from the Receipt (just the number),
  "total_aud": The total AUD paid from the Receipt (just the number),
  "service_fee_aud": The EXACT service fee amount in AUD from the Service Fee Invoice (just the number, e.g., 15.45),
  "product_items": [
    {
      "description": "Product description",
      "quantity": quantity as number,
      "unit_price_usd": unit price in USD as number
    }
  ],
  "freight_usd": Shipping/freight cost in USD if present (number or null),
  "processing_fee_usd": Processing/transaction fee in USD if shown (number, for reference only)
}

CRITICAL RULES:
1. The service_fee_aud MUST be the EXACT amount from the Service Fee Invoice - never estimate it
2. Extract ALL product line items from the Receipt
3. If freight/shipping is listed, extract it separately from products
4. The Xero supplier is ALWAYS "Alibaba.com Singapore E-Commerce Private Ltd." - do NOT use the internal seller name for this
5. Use the Invoice Date from Service Fee Invoice, not the order date
6. Include any invoice number suffixes (e.g., _1009659)

Return ONLY valid JSON, no markdown or explanations.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: extractionPrompt },
              { 
                type: 'image_url', 
                image_url: { url: receiptImageBase64 }
              },
              { 
                type: 'image_url', 
                image_url: { url: serviceFeeImageBase64 }
              }
            ]
          }
        ],
        max_tokens: 4000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: 'API credits exhausted. Please add funds to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('No content in AI response');
    }

    console.log('Raw AI extraction result:', content);

    // Parse the JSON response
    let extractedData;
    try {
      // Handle potential markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
      const jsonStr = jsonMatch[1]?.trim() || content.trim();
      extractedData = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr);
      throw new Error('Failed to parse AI response as JSON');
    }

    console.log('Parsed extraction data:', extractedData);

    // Build line items with cost types and calculate AUD amounts
    const lineItems: LineItem[] = [];
    
    // Calculate totals for proportional AUD split
    const totalAud = extractedData.total_aud || 0;
    const serviceFeeAud = extractedData.service_fee_aud || 0;
    const remainingAud = totalAud - serviceFeeAud;
    
    // Calculate total USD for product + freight (excluding service fee)
    let productUsdTotal = 0;
    let freightUsd = extractedData.freight_usd || 0;
    
    // Add product items
    if (extractedData.product_items && Array.isArray(extractedData.product_items)) {
      for (const item of extractedData.product_items) {
        const qty = item.quantity || 1;
        const unitPrice = item.unit_price_usd || 0;
        const total = qty * unitPrice;
        productUsdTotal += total;
        
        lineItems.push({
          description: item.description || 'Product',
          quantity: qty,
          unit_price: unitPrice,
          total: total,
          cost_type: 'Product',
          account_code: '310', // Product/Inventory account
        });
      }
    }
    
    // Add freight if present
    if (freightUsd > 0) {
      lineItems.push({
        description: 'Shipping/Freight',
        quantity: 1,
        unit_price: freightUsd,
        total: freightUsd,
        cost_type: 'Freight',
        account_code: '425', // Freight account
      });
    }
    
    // Add service fee with EXACT AUD amount
    if (serviceFeeAud > 0) {
      // Estimate USD based on effective rate for reference
      const productFreightUsd = productUsdTotal + freightUsd;
      const effectiveRate = productFreightUsd > 0 && remainingAud > 0 
        ? remainingAud / productFreightUsd 
        : 1.50; // fallback rate
      
      const serviceFeeUsdEstimate = serviceFeeAud / effectiveRate;
      
      lineItems.push({
        description: 'Alibaba Transaction Fee',
        quantity: 1,
        unit_price: Math.round(serviceFeeUsdEstimate * 100) / 100,
        total: Math.round(serviceFeeUsdEstimate * 100) / 100,
        cost_type: 'Service Fee',
        account_code: '411', // Service Fee account
        aud_amount: serviceFeeAud, // EXACT AUD from invoice
      });
    }
    
    // Calculate AUD amounts for product and freight items proportionally
    const productFreightUsd = productUsdTotal + freightUsd;
    
    for (const item of lineItems) {
      if (item.cost_type === 'Service Fee') {
        // Already set exact AUD
        continue;
      }
      
      if (productFreightUsd > 0 && remainingAud > 0) {
        // Proportional split of remaining AUD
        const itemUsdTotal = item.quantity * item.unit_price;
        item.aud_amount = (itemUsdTotal / productFreightUsd) * remainingAud;
        item.aud_amount = Math.round(item.aud_amount * 100) / 100;
      }
    }
    
    // Verify totals match
    const calculatedAudTotal = lineItems.reduce((sum, item) => sum + (item.aud_amount || 0), 0);
    const audDifference = Math.abs(calculatedAudTotal - totalAud);
    
    console.log(`AUD verification: Calculated ${calculatedAudTotal.toFixed(2)}, Expected ${totalAud.toFixed(2)}, Diff: ${audDifference.toFixed(2)}`);
    
    // If there's a small rounding difference, adjust the largest product item
    if (audDifference > 0.01 && audDifference < 1.00) {
      const productItems = lineItems.filter(i => i.cost_type === 'Product');
      if (productItems.length > 0) {
        // Sort by AUD amount descending
        productItems.sort((a, b) => (b.aud_amount || 0) - (a.aud_amount || 0));
        const adjustment = totalAud - calculatedAudTotal;
        productItems[0].aud_amount = (productItems[0].aud_amount || 0) + adjustment;
        productItems[0].aud_amount = Math.round(productItems[0].aud_amount * 100) / 100;
        console.log(`Applied rounding adjustment of ${adjustment.toFixed(2)} AUD to first product item`);
      }
    }
    
    // Calculate effective exchange rate
    const effectiveRate = productFreightUsd > 0 && remainingAud > 0
      ? remainingAud / productFreightUsd
      : null;

    // Extract base order number without suffixes (e.g., 285318799001025780 from 285318799001025780_1009659)
    const baseOrderNumber = extractedData.order_number 
      ? extractedData.order_number.split('_')[0]
      : null;
    
    const result: ParsedPDFData = {
      order_number: baseOrderNumber,
      invoice_number: extractedData.invoice_number || baseOrderNumber || null,
      invoice_date: extractedData.invoice_date || extractedData.order_date || null,
      order_date: extractedData.order_date || null,
      internal_seller_name: extractedData.internal_seller_name || null,
      supplier_name: 'Alibaba.com Singapore E-Commerce Private Ltd.',
      gst_registration: extractedData.gst_registration || 'M90371710Y',
      line_items: lineItems,
      total_usd: extractedData.total_usd || productFreightUsd,
      total_aud: totalAud,
      service_fee_aud: serviceFeeAud,
      currency: 'USD',
    };

    console.log('Final parsed result:', JSON.stringify(result, null, 2));

    return new Response(
      JSON.stringify({ 
        success: true, 
        data: result,
        effective_rate: effectiveRate,
        verification: {
          calculated_aud_total: calculatedAudTotal,
          expected_aud_total: totalAud,
          is_valid: audDifference < 0.02
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('PDF parsing error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message || 'Failed to parse PDFs' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
