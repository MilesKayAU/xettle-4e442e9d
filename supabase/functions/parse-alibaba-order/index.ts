import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pastedContent, paymentImageBase64 } = await req.json();
    
    if (!pastedContent || pastedContent.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'No content provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the messages array
    const messages: any[] = [];
    
    // System prompt for parsing order content - updated to support multiple cost types per order
    const systemPrompt = `You are an expert at parsing Alibaba order page content, invoices, and payment receipts. Extract structured invoice data from the provided text and optional payment image.

Your task is to extract and return a JSON object with the following fields:
- order_number: The FULL order/invoice number - look for "Invoice No.", "Invoice Number", or "Order Number" fields. For Alibaba Singapore invoices, use the COMPLETE Invoice No. (e.g., "285318799001025780_100965204388")
- order_date: The INVOICE DATE (NOT "Order Create Time") in YYYY-MM-DD format. PRIORITY: "Invoice Date" > "Payment Date" > "Order Date" > "Order Create Time"
- supplier_name: The full supplier/seller company name. For Alibaba Singapore service fee invoices, this is "Alibaba.com Singapore E-Commerce Private Ltd."
- line_items: An array of line items with cost type per item - see CRITICAL rules below
- total_amount: Total amount (as number) - use "Amount Due", "Total Price", or "Total Amount"
- currency: Currency code (USD, AUD, etc.) - extract from the amounts shown
- suggested_invoice_type: The PRIMARY type - one of "Freight", "Product", or "Service Fee"
- shipping_address: The delivery address if present
- payment_date: The payment date in YYYY-MM-DD format if present

SUPPLIER DETAILS (extract as much as possible):
- supplier_details: An object containing:
  - name: Full company name (for Alibaba Singapore: "Alibaba.com Singapore E-Commerce Private Ltd.")
  - company_name: Registered business name
  - contact_person: Contact name if mentioned
  - email: Email address if found
  - phone: Phone number if found
  - mobile: Mobile number if different from phone
  - website: Website URL if found
  - address: Full address (e.g., "8 Shenton Way, #45-01 AXA Tower, Singapore 068811")
  - street: Street address
  - city: City (e.g., "Singapore")
  - province_region_state: Province/Region/State
  - postal_code: Postal/ZIP code
  - country: Country (e.g., "Singapore", "China")
  - gst_reg_no: GST/Tax registration number if present (e.g., "M90371710Y")
  - alibaba_store_url: The supplier's Alibaba store URL if present

CRITICAL DATE EXTRACTION RULES:
1. ALWAYS prefer "Invoice Date" over "Order Create Time"
2. If you see both dates, use the INVOICE DATE for order_date field
3. "Order Create Time" is when the original order was placed, NOT the invoice date
4. For service fee invoices, the Invoice Date is typically later than Order Create Time

CRITICAL ORDER NUMBER RULES:
1. Use the FULL "Invoice No." or "Invoice Number" if present
2. For Alibaba Singapore invoices, the Invoice No. format is like "285318799001025780_100965204388" - include the ENTIRE string
3. Only fall back to "Order Number" if no Invoice No. is found

CRITICAL LINE ITEM RULES - SPLIT COSTS BY TYPE:
Each line item MUST have a "cost_type" field with one of: "Product", "Freight", or "Service Fee"

An order may contain MULTIPLE cost types. You MUST create SEPARATE line items for each type of cost found:

1. For PRODUCT costs (the actual goods/merchandise):
   - cost_type: "Product"
   - account_code: "310"
   - Create individual or consolidated product line items
   - Example: { "description": "Widget x100", "quantity": 100, "unit_price": 5.00, "total": 500.00, "cost_type": "Product", "account_code": "310" }

2. For FREIGHT/SHIPPING costs (shipping, logistics, DDP charges):
   - cost_type: "Freight"
   - account_code: "425"
   - Consolidate ALL freight charges into ONE line item
   - Example: { "description": "Freight/Shipping", "quantity": 1, "unit_price": 389.50, "total": 389.50, "cost_type": "Freight", "account_code": "425" }

3. For SERVICE FEE costs (Alibaba fees, transaction fees, platform fees):
   - cost_type: "Service Fee"
   - account_code: "631"
   - Consolidate ALL service fees into ONE line item
   - Use the "Amount Due" or total including service fees
   - Example: { "description": "Alibaba Transaction Service Fee", "quantity": 1, "unit_price": 531.95, "total": 531.95, "cost_type": "Service Fee", "account_code": "631" }

IMPORTANT SPLITTING RULES:
- If an order has products + shipping, create SEPARATE line items for each
- If an order mentions "Transaction Fee" or "Service Charge", create a SEPARATE Service Fee line item
- The total of all line items should equal the total_amount
- Look for shipping charges, freight costs, DDP fees - these should be split out as Freight type
- Look for service charges, transaction fees, platform fees - these should be split out as Service Fee type

Invoice type detection for suggested_invoice_type (the PRIMARY type):
- "Service Fee" if from Alibaba.com Singapore OR contains "Transaction Service Fee"
- "Freight" if the PRIMARY purpose is shipping/logistics/forwarder
- "Product" for actual merchandise/goods orders (even if they include freight)

FROM PAYMENT IMAGE/RECEIPT (if provided):
- aud_amount_paid: The exact AUD amount charged (as number)
- exchange_rate: The USD to AUD exchange rate used (as number)
- payment_method: The payment method/card type (e.g., "AMEX", "Visa")
- transaction_id: Any transaction reference or ID

Important:
- Extract numbers as pure numbers, not strings with currency symbols
- Parse dates into YYYY-MM-DD format
- If a field cannot be found, use null
- ALWAYS include cost_type and account_code for EACH line item
- For Alibaba Singapore service fees, the supplier IS "Alibaba.com Singapore E-Commerce Private Ltd."

Return ONLY valid JSON, no additional text.`;

    messages.push({ role: 'system', content: systemPrompt });

    // Build user message with optional image
    if (paymentImageBase64) {
      // Multimodal request with image
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Parse this Alibaba order content and extract structured data. SPLIT any product costs, freight/shipping costs, and service fees into SEPARATE line items with appropriate cost_type and account_code. Also analyze the payment receipt image to extract the exact AUD amount paid:\n\n${pastedContent}`
          },
          {
            type: 'image_url',
            image_url: {
              url: paymentImageBase64.startsWith('data:') 
                ? paymentImageBase64 
                : `data:image/png;base64,${paymentImageBase64}`
            }
          }
        ]
      });
      console.log('Processing with payment image');
    } else {
      // Text-only request
      messages.push({
        role: 'user',
        content: `Parse this Alibaba order content and extract structured data. SPLIT any product costs, freight/shipping costs, and service fees into SEPARATE line items with appropriate cost_type and account_code:\n\n${pastedContent}`
      });
      console.log('Processing text only (no payment image)');
    }

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: paymentImageBase64 ? 'google/gemini-2.5-pro' : 'google/gemini-2.5-flash',
        messages,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'AI parsing failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;
    
    if (!content) {
      console.error('No content in AI response');
      return new Response(
        JSON.stringify({ error: 'No response from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the JSON from AI response (handle potential markdown code blocks)
    let parsedData;
    try {
      let jsonString = content.trim();
      // Remove markdown code blocks if present
      if (jsonString.startsWith('```json')) {
        jsonString = jsonString.slice(7);
      } else if (jsonString.startsWith('```')) {
        jsonString = jsonString.slice(3);
      }
      if (jsonString.endsWith('```')) {
        jsonString = jsonString.slice(0, -3);
      }
      parsedData = JSON.parse(jsonString.trim());
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', content);
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI response', raw: content }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Ensure line items have cost_type and account_code (backwards compatibility)
    if (parsedData.line_items && Array.isArray(parsedData.line_items)) {
      parsedData.line_items = parsedData.line_items.map((item: any) => ({
        ...item,
        cost_type: item.cost_type || parsedData.suggested_invoice_type || 'Product',
        account_code: item.account_code || (
          item.cost_type === 'Freight' ? '425' : 
          item.cost_type === 'Service Fee' ? '631' : '310'
        )
      }));
    }

    console.log('Successfully parsed order:', parsedData.order_number, 
      'Line items:', parsedData.line_items?.length,
      paymentImageBase64 ? `with AUD amount: ${parsedData.aud_amount_paid}` : '(no payment image)');
    
    return new Response(
      JSON.stringify({ success: true, data: parsedData }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in parse-alibaba-order:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
