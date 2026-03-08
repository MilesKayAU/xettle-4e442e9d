import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { from = 'USD', to = 'AUD' } = await req.json();
    
    console.log(`Fetching exchange rate: ${from} to ${to}`);
    
    // Use Frankfurter API (free, powered by European Central Bank data)
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${from}&to=${to}`
    );
    
    if (!response.ok) {
      throw new Error(`Frankfurter API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Frankfurter returns: { amount: 1, base: "USD", date: "2024-01-25", rates: { AUD: 1.5234 } }
    const rate = data.rates[to];
    
    if (!rate) {
      throw new Error(`No rate found for ${to}`);
    }
    
    console.log(`Exchange rate ${from}/${to}: ${rate} (as of ${data.date})`);
    
    return new Response(
      JSON.stringify({
        success: true,
        from,
        to,
        rate,
        date: data.date,
        source: 'European Central Bank (via Frankfurter API)'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
    
  } catch (error) {
    console.error('Exchange rate error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
