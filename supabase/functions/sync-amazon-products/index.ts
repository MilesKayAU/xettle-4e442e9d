
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing environment variables: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
}

// Create a Supabase client with the service role key
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Define CORS headers for the response
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Function to simulate Amazon API product retrieval
// In a real implementation, you would call the Amazon API here
async function fetchAmazonProducts(asins: string[]) {
  console.log("Fetching Amazon products for ASINs:", asins);
  
  // Simulated product data - in reality you would fetch these from Amazon's API
  const mockProducts = asins.map(asin => ({
    asin,
    title: `Amazon Product ${asin}`,
    description: `This is a detailed description for product with ASIN ${asin}`,
    price: parseFloat((Math.random() * 100).toFixed(2)),
    currency: "USD",
    brand: "Amazon Basics",
    image_urls: [`https://example.com/images/${asin}_1.jpg`, `https://example.com/images/${asin}_2.jpg`],
    category: "Electronics",
    features: ["Feature 1", "Feature 2", "Feature 3"],
    specifications: {
      "Weight": "0.5 kg",
      "Dimensions": "10 x 5 x 2 cm",
      "Material": "Plastic"
    },
    product_url: `https://amazon.com/dp/${asin}`
  }));
  
  return mockProducts;
}

// Handle the sync request
async function syncAmazonProducts(asins: string[], syncLogId: string, userId: string) {
  try {
    // 1. Start sync log
    console.log(`Starting sync for ${asins.length} products, logId: ${syncLogId}, userId: ${userId}`);
    
    // Validate ASINs
    const validAsins = asins.filter(asin => /^[A-Z0-9]{10}$/i.test(asin));
    if (validAsins.length === 0) {
      throw new Error("No valid ASINs provided. ASINs must be 10 characters alphanumeric.");
    }
    
    // 2. Fetch product data from Amazon (simulated)
    const products = await fetchAmazonProducts(validAsins);
    
    // 3. Insert or update products in database
    let successCount = 0;
    let errors = [];
    
    for (const product of products) {
      try {
        // Check if product exists
        const { data: existingProduct } = await supabase
          .from('amazon_products')
          .select('id')
          .eq('asin', product.asin)
          .single();
          
        if (existingProduct) {
          // Update existing product
          await supabase
            .from('amazon_products')
            .update({
              title: product.title,
              description: product.description,
              price: product.price,
              currency: product.currency,
              brand: product.brand,
              image_urls: product.image_urls,
              category: product.category,
              features: product.features,
              specifications: product.specifications,
              product_url: product.product_url,
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              sync_status: 'synced'
            })
            .eq('asin', product.asin);
        } else {
          // Insert new product
          await supabase
            .from('amazon_products')
            .insert({
              asin: product.asin,
              title: product.title,
              description: product.description,
              price: product.price,
              currency: product.currency,
              brand: product.brand,
              image_urls: product.image_urls,
              category: product.category,
              features: product.features,
              specifications: product.specifications,
              product_url: product.product_url,
              sync_status: 'synced'
            });
        }
        
        successCount++;
      } catch (err) {
        console.error(`Error syncing product ${product.asin}:`, err);
        errors.push({
          asin: product.asin,
          message: err.message || 'Unknown error',
          details: err
        });
      }
    }
    
    // 4. Update sync log with results
    await supabase
      .from('amazon_sync_logs')
      .update({
        end_time: new Date().toISOString(),
        status: errors.length > 0 ? 'completed_with_errors' : 'completed',
        products_synced: successCount,
        errors: errors
      })
      .eq('id', syncLogId);
      
    return { 
      success: true, 
      message: `Sync completed. ${successCount} products synchronized.`,
      errors: errors.length > 0 ? errors : null
    };
  } catch (err) {
    console.error("Error during sync:", err);
    
    // Update sync log with error status
    await supabase
      .from('amazon_sync_logs')
      .update({
        end_time: new Date().toISOString(),
        status: 'failed',
        errors: [{ message: err.message || 'Sync process failed' }]
      })
      .eq('id', syncLogId);
      
    return { 
      success: false, 
      message: "Sync failed", 
      error: err.message || 'Unknown error' 
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error("Missing Authorization header");
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Unauthorized: Missing Authorization header" 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401 
        }
      );
    }
    
    // Parse request body
    const { asins, userId } = await req.json();
    
    if (!userId) {
      console.error("Missing userId in request");
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Unauthorized: Missing user ID" 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401 
        }
      );
    }
    
    // Validate request
    if (!asins || !Array.isArray(asins) || asins.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: "Invalid request: asins must be a non-empty array" 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }
    
    // Create a new sync log entry
    const { data: syncLog, error: syncLogError } = await supabase
      .from('amazon_sync_logs')
      .insert({
        created_by: userId,
        details: `Sync requested for ${asins.length} products`,
        status: 'in_progress'
      })
      .select()
      .single();
      
    if (syncLogError) {
      console.error("Error creating sync log:", syncLogError);
      return new Response(
        JSON.stringify({ success: false, message: "Failed to create sync log", error: syncLogError }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }
    
    // Start sync process
    const result = await syncAmazonProducts(asins, syncLog.id, userId);
    
    // Return results
    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error("Error processing request:", error);
    return new Response(
      JSON.stringify({ success: false, message: "Internal server error", error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
