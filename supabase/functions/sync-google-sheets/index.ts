import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InventoryRow {
  [key: string]: string | number | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { spreadsheetId, range, selectedColumns } = await req.json();
    
    if (!spreadsheetId || !range) {
      return new Response(
        JSON.stringify({ error: 'Missing spreadsheetId or range' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get Google API key from Supabase secrets
    const googleApiKey = Deno.env.get('GOOGLE_SHEETS_API_KEY');
    if (!googleApiKey) {
      throw new Error('Google Sheets API key not configured');
    }

    // Fetch data from Google Sheets
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?key=${googleApiKey}`;
    
    console.log('Fetching from URL:', sheetsUrl);
    const response = await fetch(sheetsUrl);
    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Google Sheets API error: ${response.status} - ${errorData}`);
      throw new Error(`Google Sheets API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const values = data.values;

    if (!values || values.length < 2) {
      throw new Error('No data found in the specified range');
    }

    // Helper function to convert percentage strings to decimal numbers
    const convertPercentageToDecimal = (value: any): number | null => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      
      const stringValue = String(value).trim();
      
      // Handle percentage format (e.g., "23.94%" -> 0.2394)
      if (stringValue.includes('%')) {
        const numericValue = parseFloat(stringValue.replace('%', '').trim());
        return isNaN(numericValue) ? null : numericValue / 100;
      }
      
      // For numeric values that appear to be percentages (likely between 0-100)
      // Convert them to decimal format for storage
      const numericValue = parseFloat(stringValue.replace(/[,]/g, ''));
      if (isNaN(numericValue)) return null;
      
      // If the value is likely a percentage (between 0-100), convert to decimal
      // This handles cases where "13.65" means 13.65% and should be stored as 0.1365
      if (numericValue >= 0 && numericValue <= 100) {
        return numericValue / 100;
      }
      
      // For values outside typical percentage range, store as-is
      return numericValue;
    };

    // Helper function to convert numeric strings to numbers
    const convertToNumber = (value: any): number | null => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      
      // Handle European decimal format (comma as decimal separator) and remove currency symbols
      const stringValue = String(value).trim().replace(/[$%\s]/g, '').replace(',', '.');
      const numericValue = parseFloat(stringValue);
      return isNaN(numericValue) ? null : numericValue;
    };

    // Improved header processing function
    const processHeaderName = (header: string): string => {
      return header
        .toLowerCase()
        .trim()
        // Remove special characters and replace with underscores
        .replace(/[,\(\)\.%]/g, '')
        // Replace multiple spaces and special chars with single underscore
        .replace(/[\s\-\/]+/g, '_')
        // Remove leading/trailing underscores
        .replace(/^_+|_+$/g, '')
        // Replace multiple underscores with single
        .replace(/_+/g, '_');
    };

    // Create mapping for known problematic headers
    const headerMappings: Record<string, string> = {
      'roi_%': 'roi_percent',
      'roi_percent': 'roi_percent',
      'fba_fbm_stock': 'fba_fbm_stock',
      'days_of_stock_left': 'days_of_stock_left',
      'profit_forecast_30_days': 'profit_forecast_30_days',
      'missed_profit_est': 'missed_profit_est',
      'manuf_time_days': 'manuf_time_days',
      'supplier_sku': 'supplier_sku',
      'margin': 'margin',
      'notes': 'comment'
    };

    // Parse the sheet data with column filtering
    const headers = values[0].map((h: string) => h.trim());
    console.log('Original headers from Google Sheet:', headers);
    
    // Filter headers based on selected columns if provided
    let filteredIndices: number[] = [];
    let filteredHeaders: string[] = [];
    
    if (selectedColumns && selectedColumns.length > 0) {
      console.log('Selected columns:', selectedColumns);
      headers.forEach((header, index) => {
        if (selectedColumns.includes(header)) {
          filteredIndices.push(index);
          const processedHeader = processHeaderName(header);
          const mappedHeader = headerMappings[processedHeader] || processedHeader;
          filteredHeaders.push(mappedHeader);
          console.log(`Header "${header}" -> "${processedHeader}" -> "${mappedHeader}"`);
        }
      });
    } else {
      // Use all columns if no selection provided
      filteredIndices = headers.map((_, index) => index);
      filteredHeaders = headers.map((h: string) => {
        const processedHeader = processHeaderName(h);
        const mappedHeader = headerMappings[processedHeader] || processedHeader;
        console.log(`Header "${h}" -> "${processedHeader}" -> "${mappedHeader}"`);
        return mappedHeader;
      });
    }

    console.log('Final processed headers:', filteredHeaders);

    const rows: InventoryRow[] = values.slice(1).map((row: any[]) => {
      const obj: InventoryRow = {};
      filteredHeaders.forEach((header: string, index: number) => {
        const originalIndex = filteredIndices[index];
        const value = row[originalIndex] || '';
        // Convert numeric fields
        if (typeof value === 'string' && !isNaN(Number(value)) && value !== '') {
          obj[header] = Number(value);
        } else {
          obj[header] = value || null;
        }
      });
      return obj;
    });

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization')?.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Map the sheet data to our database schema
    console.log('Sample row keys:', Object.keys(rows[0] || {}));
    const inventoryData = rows.map((row, rowIndex) => {
      console.log(`Processing row ${rowIndex} for SKU ${row.sku}, available keys:`, Object.keys(row));
      
      // Helper function to get value with logging
      const getValue = (key: string, defaultValue: any = null) => {
        const value = row[key];
        if (value !== null && value !== undefined && value !== '') {
          console.log(`Row ${rowIndex}: ${key} = ${value}`);
          return value;
        }
        return defaultValue;
      };

      return {
        user_id: user.id,
        upload_session_name: `Google Sheets Sync - ${new Date().toISOString()}`,
        
        // Core product information
        sku: getValue('sku', ''),
        title: getValue('title', '') || getValue('product_name', ''),
        asin: getValue('asin', ''),
        
        // Stock and inventory data
        fba_fbm_stock: Number(getValue('fba_fbm_stock', 0) || getValue('stock', 0)),
        stock_value: Number(getValue('stock_value', 0)),
        estimated_sales_velocity: Number(getValue('estimated_sales_velocity', 0) || getValue('sales_velocity', 0)),
        days_of_stock_left: Number(getValue('days_of_stock_left', 0)),
        
        // Financial data - keep raw values from sheet
        margin: (() => {
          const marginValue = getValue('margin', null);
          if (marginValue === null || marginValue === undefined || marginValue === '') {
            return null;
          }
          // Keep the raw value from the sheet without conversion
          return convertToNumber(marginValue);
        })(),
        
        roi_percent: Number(getValue('roi_percent', 0)),
        profit_forecast_30_days: Number(getValue('profit_forecast_30_days', 0)),
        missed_profit_est: Number(getValue('missed_profit_est', 0)),
        
        // Reordering and logistics
        recommended_quantity_for_reordering: Number(getValue('recommended_quantity_for_reordering', 0)),
        running_out_of_stock: getValue('running_out_of_stock', ''),
        time_to_reorder: getValue('time_to_reorder', ''),
        reserved: Number(getValue('reserved', 0)),
        sent_to_fba: Number(getValue('sent_to_fba', 0)),
        ordered: Number(getValue('ordered', 0)),
        
        // Timing and lead times
        manuf_time_days: Number(getValue('manuf_time_days', 0) || getValue('lead_time_days', 0)),
        fba_buffer_days: Number(getValue('fba_buffer_days', 0) || getValue('buffer_days', 0)),
        target_stock_range_after_new_order_days: Number(getValue('target_stock_range_after_new_order_days', 0)),
        shipping_to_prep_center_days: Number(getValue('shipping_to_prep_center_days', 0)),
        shipping_to_fba_days: Number(getValue('shipping_to_fba_days', 0)),
        
        // Prep center stock levels
        fba_prep_stock_gold_coast: Number(getValue('fba_prep_stock_gold_coast', 0)),
        fba_prep_stock_prep_center_2_stock: Number(getValue('fba_prep_stock_prep_center_2_stock', 0)),
        fba_prep_stock_prep_center_3_stock: Number(getValue('fba_prep_stock_prep_center_3_stock', 0)),
        fba_prep_stock_prep_center_4_stock: Number(getValue('fba_prep_stock_prep_center_4_stock', 0)),
        
        // Box parameters and physical attributes
        box_param_length: Number(getValue('box_param_length', 0)),
        box_param_width: Number(getValue('box_param_width', 0)),
        box_param_height: Number(getValue('box_param_height', 0)),
        box_param_units_in_box: Number(getValue('box_param_units_in_box', 0)),
        
        // Product attributes
        color: getValue('color', ''),
        size: getValue('size', ''),
        multipack_size: getValue('multipack_size', ''),
        
        // SKU and identification
        item_number: getValue('item_number', ''),
        fnsku: getValue('fnsku', ''),
        supplier_sku: getValue('supplier_sku', ''),
        supplier_name: getValue('supplier_name', ''),
        supplier_contact: getValue('supplier_contact', ''),
        
        // Operational data
        use_a_prep_center: getValue('use_a_prep_center', ''),
        marketplace: getValue('marketplace', ''),
        comment: getValue('comment', '') || getValue('notes', ''),
      };
    });

    // Clear existing user data and insert new data
    const { error: deleteError } = await supabase
      .from('uploaded_inventory_raw')
      .delete()
      .eq('user_id', user.id);

    if (deleteError) {
      throw new Error(`Error clearing existing data: ${deleteError.message}`);
    }

    // Insert new data
    const { data: insertedData, error: insertError } = await supabase
      .from('uploaded_inventory_raw')
      .insert(inventoryData)
      .select();

    if (insertError) {
      throw new Error(`Error inserting data: ${insertError.message}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Successfully synced ${insertedData.length} items from Google Sheets (${filteredHeaders.length} columns imported)`,
        data: insertedData 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error syncing Google Sheets:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});