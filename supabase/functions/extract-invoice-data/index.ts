import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractedData {
  supplier_name: string;
  invoice_type: 'Product' | 'Freight' | 'Service Fee';
  order_id: string;
  invoice_date: string;
  due_date: string;
  currency_code: string;
  total_amount: number;
  line_items: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
  }>;
  confidence: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }

    const { filePath } = await req.json();
    
    if (!filePath) {
      throw new Error('File path is required');
    }

    console.log('Processing file:', filePath);

    // Download the file from Supabase storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('alibaba-attachments')
      .download(filePath);

    if (downloadError) {
      console.error('Download error:', downloadError);
      throw new Error(`Failed to download file: ${downloadError.message}`);
    }

    // Get file info and validate type
    const buffer = await fileData.arrayBuffer();
    const mimeType = fileData.type || 'application/pdf';
    
    console.log('File type:', mimeType, 'File size:', buffer.byteLength);
    
    // Check if file is an image (OpenAI Vision API only supports images)
    const supportedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!supportedImageTypes.includes(mimeType)) {
      throw new Error(`Unsupported file type: ${mimeType}. Please upload an image (JPG, PNG, GIF, or WebP) instead of a PDF. You can convert your PDF to an image first.`);
    }

    // Convert image to base64 using a more memory-efficient approach
    const uint8Array = new Uint8Array(imageBuffer);
    let base64 = '';
    const chunkSize = 0x8000; // 32KB chunks
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      base64 += String.fromCharCode.apply(null, Array.from(chunk));
    }
    base64 = btoa(base64);

    console.log('Image converted to base64, size:', base64.length);

    // Call OpenAI Vision API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an expert at extracting structured data from Alibaba invoices and purchase orders. 
            Extract the following information and return it as JSON:
            - supplier_name: The seller/supplier company name
            - invoice_type: Determine if this is "Product", "Freight", or "Service Fee" based on the content
            - order_id: Any order number, invoice number, or reference number
            - invoice_date: The invoice/order date in YYYY-MM-DD format
            - due_date: Payment due date in YYYY-MM-DD format (if not found, use invoice_date + 14 days)
            - currency_code: The currency (USD, AUD, etc.)
            - total_amount: The total amount as a number
            - line_items: Array of items with description, quantity, and unitAmount
            - confidence: Your confidence level (0-1) in the extraction accuracy

            If any field is unclear or missing, make reasonable assumptions and note lower confidence.
            Always return valid JSON format.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Please extract the invoice data from this document:'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64}`
                }
              }
            ]
          }
        ],
        max_tokens: 1500
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status} ${errorData}`);
    }

    const aiResponse = await response.json();
    console.log('OpenAI response received');

    const extractedText = aiResponse.choices[0].message.content;
    console.log('Extracted text:', extractedText);

    // Parse the JSON response
    let extractedData: ExtractedData;
    try {
      // Remove any markdown formatting if present
      const jsonText = extractedText.replace(/```json\n?|\n?```/g, '').trim();
      extractedData = JSON.parse(jsonText);
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError);
      throw new Error('Failed to parse extracted data as JSON');
    }

    // Validate and set defaults
    const processedData: ExtractedData = {
      supplier_name: extractedData.supplier_name || 'Unknown Supplier',
      invoice_type: extractedData.invoice_type || 'Product',
      order_id: extractedData.order_id || `ALI-${Date.now()}`,
      invoice_date: extractedData.invoice_date || new Date().toISOString().split('T')[0],
      due_date: extractedData.due_date || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      currency_code: extractedData.currency_code || 'USD',
      total_amount: extractedData.total_amount || 0,
      line_items: extractedData.line_items || [{
        description: 'Extracted item',
        quantity: 1,
        unitAmount: extractedData.total_amount || 0
      }],
      confidence: extractedData.confidence || 0.5
    };

    console.log('Processed data:', processedData);

    return new Response(JSON.stringify(processedData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in extract-invoice-data function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});