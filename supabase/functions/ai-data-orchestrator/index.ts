
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Input sanitization functions
const sanitizeString = (input: any): string => {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, 1000);
}

const sanitizeNumber = (input: any): number => {
  const num = parseFloat(input);
  return isNaN(num) ? 0 : num;
}

const validateSheetData = (data: any[]): boolean => {
  if (!Array.isArray(data) || data.length === 0) return false;
  if (data.length > 10000) return false; // Prevent excessive data processing
  return true;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')
    const { data: { user } } = await supabaseClient.auth.getUser(token)

    if (!user) {
      throw new Error('Unauthorized')
    }

    const { uploadId, userPrompt, rawData, aiAnalysis } = await req.json()

    console.log(`AI Orchestrator request: ${userPrompt}`)

    // Generate and execute commands using OpenAI
    const commands = await generateDataCommands(userPrompt, rawData, aiAnalysis)
    
    // Execute the commands and get transformed data
    const transformedData = await executeCommands(commands, rawData)

    return new Response(
      JSON.stringify({ 
        success: true,
        commands,
        transformedData,
        message: `Generated and executed ${commands.length} commands`
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error in AI orchestrator:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message 
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})

async function generateDataCommands(userPrompt: string, rawData: any, aiAnalysis: any): Promise<any[]> {
  const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAIApiKey) {
    throw new Error('OpenAI API key not configured');
  }

  // Get data structure info
  const dataInfo = getDataStructureInfo(rawData);

  const prompt = `You are a data analysis orchestrator. Based on the user's request, generate specific, executable commands for data manipulation.

User Request: "${userPrompt}"

Available Data Structure:
${JSON.stringify(dataInfo, null, 2)}

Current AI Analysis:
${JSON.stringify(aiAnalysis, null, 2)}

Generate a list of executable commands. Each command should be specific and actionable. Available command types:
1. "filter" - Filter data based on conditions
2. "create_calculated_column" - Add new calculated columns
3. "create_summary" - Create summary/aggregation tables
4. "create_pivot" - Create pivot tables
5. "sort_data" - Sort data by columns
6. "create_chart_config" - Generate chart configurations
7. "export_subset" - Export filtered/processed data

For campaign data, common metrics include:
- CTR (Click-Through Rate) = (Clicks / Impressions) * 100
- CPC (Cost Per Click) = Spend / Clicks
- ROAS (Return on Ad Spend) = Revenue / Spend
- Conversion Rate = Conversions / Clicks * 100

Return ONLY a JSON array of commands in this format:
[
  {
    "type": "command_type",
    "command": "Human-readable description of what this command does",
    "parameters": {
      "specific": "parameters",
      "for": "this command"
    }
  }
]

Make the commands specific to the user's request and the available data.`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert data analyst that generates executable data manipulation commands. Always respond with valid JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1500
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();
    
    // Clean and parse JSON response
    const cleanedContent = cleanJsonResponse(content);
    const commands = JSON.parse(cleanedContent);
    
    return Array.isArray(commands) ? commands : [];
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    // Return fallback commands based on common patterns
    return generateFallbackCommands(userPrompt);
  }
}

function getDataStructureInfo(rawData: any): any {
  if (!rawData) return { error: 'No data available' };

  const info: any = {};
  
  if (typeof rawData === 'object' && !Array.isArray(rawData)) {
    // Multi-sheet data
    Object.keys(rawData).forEach(sheetName => {
      const sheetData = rawData[sheetName];
      if (sheetData && sheetData.data && Array.isArray(sheetData.data)) {
        info[sheetName] = {
          rowCount: sheetData.data.length,
          columns: sheetData.headers || (sheetData.data.length > 0 ? Object.keys(sheetData.data[0]) : []),
          sampleRow: sheetData.data[0] || {}
        };
      }
    });
  } else if (Array.isArray(rawData)) {
    // Single dataset
    info.data = {
      rowCount: rawData.length,
      columns: rawData.length > 0 ? Object.keys(rawData[0]) : [],
      sampleRow: rawData[0] || {}
    };
  }

  return info;
}

function cleanJsonResponse(response: string): string {
  // Remove markdown code blocks if present
  let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  
  // Try to extract JSON from the response if it's wrapped in other text
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  
  return cleaned.trim();
}

function generateFallbackCommands(userPrompt: string): any[] {
  const prompt = userPrompt.toLowerCase();
  const commands = [];

  if (prompt.includes('filter') || prompt.includes('show only') || prompt.includes('conversion') || prompt.includes('higher than') || prompt.includes('greater than')) {
    commands.push({
      type: 'filter',
      command: 'Filter data based on user criteria',
      parameters: { 
        column: 'conversion_rate',
        operator: '>',
        value: 0.35,
        conditions: 'conversion rate > 0.35' 
      }
    });
  }

  if (prompt.includes('summary') || prompt.includes('total')) {
    commands.push({
      type: 'create_summary',
      command: 'Create summary table with aggregated metrics',
      parameters: { groupBy: [], aggregations: ['sum', 'count', 'average'] }
    });
  }

  if (prompt.includes('calculate') || prompt.includes('add column')) {
    commands.push({
      type: 'create_calculated_column',
      command: 'Add calculated columns for key metrics',
      parameters: { calculations: ['CTR', 'CPC', 'ROAS'] }
    });
  }

  return commands.length > 0 ? commands : [{
    type: 'create_summary',
    command: 'Create basic data summary',
    parameters: { type: 'overview' }
  }];
}

async function executeCommands(commands: any[], rawData: any): Promise<any> {
  let transformedData = rawData;

  for (const command of commands) {
    console.log(`Executing command: ${command.type} with parameters:`, command.parameters);
    switch (command.type) {
      case 'filter':
      case 'export_subset':
        transformedData = applyFilter(transformedData, command.parameters);
        break;
      case 'create_calculated_column':
        transformedData = addCalculatedColumns(transformedData, command.parameters);
        break;
      case 'create_summary':
        transformedData = createSummary(transformedData, command.parameters);
        break;
      case 'create_pivot':
        transformedData = createPivotTable(transformedData, command.parameters);
        break;
      case 'sort_data':
        transformedData = sortData(transformedData, command.parameters);
        break;
      default:
        console.log(`Unknown command type: ${command.type}`);
    }
  }

  return transformedData;
}

function applyFilter(data: any, parameters: any): any {
  if (Array.isArray(data)) {
    // Single dataset
    const originalCount = data.length;
    console.log(`Filtering ${originalCount} rows with column: ${parameters.column}, operator: ${parameters.operator}, value: ${parameters.value}`);
    
    const filtered = data.filter(row => {
      if (parameters.column && parameters.operator && parameters.value !== undefined) {
        let value = parseFloat(row[parameters.column]);
        let threshold = parameters.value;
        
        // Handle percentage vs decimal conversion
        // If the threshold is > 1 but all values are < 1, assume threshold is percentage and convert
        if (threshold > 1 && value < 1) {
          threshold = threshold / 100; // Convert percentage to decimal
          console.log(`Converting threshold from ${parameters.value} to ${threshold} (percentage to decimal)`);
        }
        
        console.log(`Comparing ${value} ${parameters.operator} ${threshold} for row:`, row[parameters.column]);
        
        switch (parameters.operator) {
          case '>':
            return value > threshold;
          case '<':
            return value < threshold;
          case '>=':
            return value >= threshold;
          case '<=':
            return value <= threshold;
          case '=':
            return value === threshold;
          default:
            return true;
        }
      }
      return true;
    });
    
    console.log(`Filtered from ${originalCount} to ${filtered.length} rows (${originalCount - filtered.length} rows removed)`);
    return filtered;
  } else if (typeof data === 'object') {
    // Multi-sheet data
    const filteredData: any = {};
    let totalOriginal = 0;
    let totalFiltered = 0;
    
    Object.keys(data).forEach(sheetName => {
      const sheetData = data[sheetName];
      if (sheetData && sheetData.data && Array.isArray(sheetData.data)) {
        const originalCount = sheetData.data.length;
        totalOriginal += originalCount;
        console.log(`Filtering sheet "${sheetName}": ${originalCount} rows with column: ${parameters.column}, operator: ${parameters.operator}, value: ${parameters.value}`);
        
        const filtered = sheetData.data.filter((row: any) => {
          if (parameters.column && parameters.operator && parameters.value !== undefined) {
            let value = parseFloat(row[parameters.column]);
            let threshold = parameters.value;
            
            // Handle percentage vs decimal conversion
            if (threshold > 1 && value < 1) {
              threshold = threshold / 100;
              console.log(`Converting threshold from ${parameters.value} to ${threshold} (percentage to decimal)`);
            }
            
            switch (parameters.operator) {
              case '>':
                return value > threshold;
              case '<':
                return value < threshold;
              case '>=':
                return value >= threshold;
              case '<=':
                return value <= threshold;
              case '=':
                return value === threshold;
              default:
                return true;
            }
          }
          return true;
        });
        
        totalFiltered += filtered.length;
        console.log(`Sheet "${sheetName}": Filtered from ${originalCount} to ${filtered.length} rows (${originalCount - filtered.length} rows removed)`);
        
        filteredData[sheetName] = {
          ...sheetData,
          data: filtered
        };
      }
    });
    
    console.log(`Total filtering: ${totalOriginal} → ${totalFiltered} rows (${totalOriginal - totalFiltered} rows removed)`);
    return filteredData;
  }
  
  return data;
}

function addCalculatedColumns(data: any, parameters: any): any {
  console.log('Adding calculated columns with parameters:', parameters);
  
  if (Array.isArray(data)) {
    return addCalculatedColumnsToArray(data, parameters);
  } else if (typeof data === 'object') {
    // Multi-sheet data
    const transformedData: any = {};
    Object.keys(data).forEach(sheetName => {
      const sheetData = data[sheetName];
      if (sheetData && sheetData.data && Array.isArray(sheetData.data)) {
        transformedData[sheetName] = {
          ...sheetData,
          data: addCalculatedColumnsToArray(sheetData.data, parameters)
        };
      }
    });
    return transformedData;
  }
  
  return data;
}

function addCalculatedColumnsToArray(dataArray: any[], parameters: any): any[] {
  if (dataArray.length === 0) return dataArray;
  
  return dataArray.map(row => {
    const newRow = { ...row };
    
    // Handle different parameter formats
    const calculations = parameters.calculations || parameters.formulas || [];
    
    // Common calculations
    if (calculations.includes('CTR') || parameters.formula?.includes('CTR') || parameters.column_name === 'CTR') {
      const clicks = parseFloat(row.Clicks || row.clicks || 0);
      const impressions = parseFloat(row.Impressions || row.impressions || 0);
      newRow.CTR = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0.00';
    }
    
    if (calculations.includes('CPC') || parameters.formula?.includes('CPC') || parameters.column_name === 'CPC') {
      const spend = parseFloat(row.Spend || row.spend || row.Cost || row.cost || 0);
      const clicks = parseFloat(row.Clicks || row.clicks || 0);
      newRow.CPC = clicks > 0 ? (spend / clicks).toFixed(2) : '0.00';
    }
    
    if (calculations.includes('ROAS') || parameters.formula?.includes('ROAS') || parameters.column_name === 'ROAS') {
      const revenue = parseFloat(row.Revenue || row.revenue || row.Sales || row.sales || 0);
      const spend = parseFloat(row.Spend || row.spend || row.Cost || row.cost || 0);
      newRow.ROAS = spend > 0 ? (revenue / spend).toFixed(2) : '0.00';
    }
    
    // Handle specific formula calculations
    if (parameters.formula) {
      const formula = parameters.formula.toLowerCase();
      const columnName = parameters.column_name || parameters.newColumnName || parameters.new_column_name || 'CalculatedValue';
      
      if (formula.includes('clicks') && formula.includes('impressions')) {
        const clicks = parseFloat(row.Clicks || row.clicks || 0);
        const impressions = parseFloat(row.Impressions || row.impressions || 0);
        newRow[columnName] = impressions > 0 ? ((clicks / impressions) * 100).toFixed(2) : '0.00';
      } else if (formula.includes('spend') && formula.includes('clicks')) {
        const spend = parseFloat(row.Spend || row.spend || row.Cost || row.cost || 0);
        const clicks = parseFloat(row.Clicks || row.clicks || 0);
        newRow[columnName] = clicks > 0 ? (spend / clicks).toFixed(2) : '0.00';
      } else if (formula.includes('revenue') && formula.includes('spend')) {
        const revenue = parseFloat(row.Revenue || row.revenue || row.Sales || row.sales || 0);
        const spend = parseFloat(row.Spend || row.spend || row.Cost || row.cost || 0);
        newRow[columnName] = spend > 0 ? (revenue / spend).toFixed(2) : '0.00';
      }
    }
    
    return newRow;
  });
}

function createSummary(data: any, parameters: any): any {
  console.log('Creating summary with parameters:', parameters);
  
  if (Array.isArray(data)) {
    return createSummaryFromArray(data, parameters);
  } else if (typeof data === 'object') {
    // Multi-sheet data - create summary for each sheet
    const summaryData: any = {};
    Object.keys(data).forEach(sheetName => {
      const sheetData = data[sheetName];
      if (sheetData && sheetData.data && Array.isArray(sheetData.data)) {
        summaryData[`${sheetName} - Summary`] = {
          ...sheetData,
          data: createSummaryFromArray(sheetData.data, parameters)
        };
      }
    });
    return summaryData;
  }
  
  return data;
}

function createSummaryFromArray(dataArray: any[], parameters: any): any[] {
  if (dataArray.length === 0) return [];
  
  const { groupBy = [], aggregations = ['sum', 'count', 'average'] } = parameters;
  
  if (groupBy.length === 0) {
    // Create overall summary
    const summary: any = { 'Summary Type': 'Overall Total' };
    
    // Find numeric columns and aggregate them
    const numericColumns = Object.keys(dataArray[0]).filter(col => {
      const value = parseFloat(dataArray[0][col]);
      return !isNaN(value) && isFinite(value);
    });
    
    numericColumns.forEach(col => {
      const values = dataArray.map(row => parseFloat(row[col]) || 0).filter(val => !isNaN(val));
      
      if (values.length > 0) {
        summary[`Total ${col}`] = values.reduce((a, b) => a + b, 0).toFixed(2);
        summary[`Average ${col}`] = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
        summary[`Max ${col}`] = Math.max(...values).toFixed(2);
        summary[`Min ${col}`] = Math.min(...values).toFixed(2);
      }
    });
    
    summary['Total Records'] = dataArray.length;
    
    return [summary];
  } else {
    // Group by specified columns and create summary for each group
    const grouped: any = {};
    
    dataArray.forEach(row => {
      const groupKey = groupBy.map(col => row[col] || 'Unknown').join(' | ');
      if (!grouped[groupKey]) {
        grouped[groupKey] = [];
      }
      grouped[groupKey].push(row);
    });
    
    return Object.keys(grouped).map(groupKey => {
      const groupData = grouped[groupKey];
      const summary: any = {};
      
      // Add grouping columns
      const keyParts = groupKey.split(' | ');
      groupBy.forEach((col, index) => {
        summary[col] = keyParts[index] || 'Unknown';
      });
      
      // Find numeric columns and aggregate them
      const numericColumns = Object.keys(dataArray[0]).filter(col => {
        const value = parseFloat(dataArray[0][col]);
        return !isNaN(value) && isFinite(value) && !groupBy.includes(col);
      });
      
      numericColumns.forEach(col => {
        const values = groupData.map((row: any) => parseFloat(row[col]) || 0).filter((val: number) => !isNaN(val));
        
        if (values.length > 0) {
          summary[`Total ${col}`] = values.reduce((a, b) => a + b, 0).toFixed(2);
          summary[`Average ${col}`] = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
        }
      });
      
      summary['Record Count'] = groupData.length;
      
      return summary;
    });
  }
}

function createPivotTable(data: any, parameters: any): any {
  console.log('Creating pivot table with parameters:', parameters);
  
  if (Array.isArray(data)) {
    return createPivotFromArray(data, parameters);
  } else if (typeof data === 'object') {
    // Multi-sheet data - create pivot for each sheet
    const pivotData: any = {};
    Object.keys(data).forEach(sheetName => {
      const sheetData = data[sheetName];
      if (sheetData && sheetData.data && Array.isArray(sheetData.data)) {
        pivotData[`${sheetName} - Pivot Table`] = {
          ...sheetData,
          data: createPivotFromArray(sheetData.data, parameters)
        };
      }
    });
    return pivotData;
  }
  
  return data;
}

function createPivotFromArray(dataArray: any[], parameters: any): any[] {
  const { rows = [], values = [], aggregations = ['sum'] } = parameters;
  
  if (dataArray.length === 0 || rows.length === 0) {
    console.log('No data or no row groupings specified for pivot');
    return dataArray;
  }
  
  console.log(`Creating pivot with rows: [${rows.join(', ')}], values: [${values.join(', ')}], aggregations: [${aggregations.join(', ')}]`);
  
  // Group data by row columns
  const grouped: any = {};
  
  dataArray.forEach(row => {
    // Create grouping key from row columns
    const groupKey = rows.map(col => row[col] || 'Unknown').join(' | ');
    
    if (!grouped[groupKey]) {
      grouped[groupKey] = [];
    }
    grouped[groupKey].push(row);
  });
  
  // Create pivot table rows
  const pivotRows: any[] = [];
  
  Object.keys(grouped).forEach(groupKey => {
    const groupData = grouped[groupKey];
    const pivotRow: any = {};
    
    // Add row dimension columns
    const keyParts = groupKey.split(' | ');
    rows.forEach((col, index) => {
      pivotRow[col] = keyParts[index] || 'Unknown';
    });
    
    // Add aggregated value columns
    values.forEach(valueCol => {
      aggregations.forEach(agg => {
        const columnName = `${valueCol} (${agg})`;
        const numericValues = groupData
          .map((row: any) => parseFloat(row[valueCol]) || 0)
          .filter((val: number) => !isNaN(val));
        
        if (numericValues.length > 0) {
          switch (agg.toLowerCase()) {
            case 'sum':
              pivotRow[columnName] = numericValues.reduce((a, b) => a + b, 0);
              break;
            case 'average':
            case 'avg':
              pivotRow[columnName] = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
              break;
            case 'count':
              pivotRow[columnName] = numericValues.length;
              break;
            case 'max':
              pivotRow[columnName] = Math.max(...numericValues);
              break;
            case 'min':
              pivotRow[columnName] = Math.min(...numericValues);
              break;
            default:
              pivotRow[columnName] = numericValues.reduce((a, b) => a + b, 0);
          }
        } else {
          pivotRow[columnName] = 0;
        }
      });
    });
    
    // Add record count
    pivotRow['Record Count'] = groupData.length;
    
    pivotRows.push(pivotRow);
  });
  
  console.log(`Pivot table created: ${pivotRows.length} summary rows from ${dataArray.length} original rows`);
  return pivotRows;
}

function sortData(data: any, parameters: any): any {
  // Implementation for sorting data
  return data;
}
