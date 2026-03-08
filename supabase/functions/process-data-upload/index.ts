
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    const { uploadId, fileData, fileName, fileType, selectedSheets } = await req.json()

    console.log(`Processing upload: ${fileName} (${fileType})`)
    console.log(`Selected sheets: ${selectedSheets ? selectedSheets.join(', ') : 'all'}`)

    // Parse the data based on file type
    let processedSheets: any = {}
    let allParsedData: any[] = []
    let allHeaders: string[] = []

    if (fileType === 'csv') {
      const lines = fileData.split('\n')
      const headers = lines[0].split(',').map((h: string) => h.trim().replace(/"/g, ''))
      allHeaders = headers
      
      const parsedData: any[] = []
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
          const values = lines[i].split(',').map((v: string) => v.trim().replace(/"/g, ''))
          const row: any = {}
          headers.forEach((header, index) => {
            row[header] = values[index] || ''
          })
          parsedData.push(row)
        }
      }
      processedSheets['Sheet1'] = { data: parsedData, headers }
      allParsedData = parsedData
    } else {
      // Excel file - fileData is already parsed JSON with multiple sheets
      const sheetsData = JSON.parse(fileData)
      
      // If specific sheets were selected, only process those
      const sheetsToProcess = selectedSheets || Object.keys(sheetsData)
      
      for (const sheetName of sheetsToProcess) {
        if (sheetsData[sheetName] && sheetsData[sheetName].length > 0) {
          const sheetHeaders = Object.keys(sheetsData[sheetName][0])
          processedSheets[sheetName] = { 
            data: sheetsData[sheetName], 
            headers: sheetHeaders 
          }
          allParsedData = allParsedData.concat(sheetsData[sheetName])
          allHeaders = [...new Set([...allHeaders, ...sheetHeaders])]
        }
      }
    }

    // Generate AI analysis using OpenAI
    console.log('Generating AI analysis with OpenAI...')
    const aiAnalysis = {
      columnTypes: await analyzeColumnsWithAI(allHeaders, allParsedData),
      insights: await generateInsightsWithAI(allParsedData, allHeaders, processedSheets),
      suggestions: await generateSuggestionsWithAI(allHeaders, allParsedData, processedSheets),
      dataQuality: await assessDataQualityWithAI(allParsedData, allHeaders),
      sheetAnalysis: await analyzeMultipleSheetsWithAI(processedSheets)
    }

    // Update the upload record with processed data
    const { error } = await supabaseClient
      .from('data_uploads')
      .update({
        upload_status: 'completed',
        raw_data: processedSheets,
        ai_analysis: aiAnalysis,
        updated_at: new Date().toISOString()
      })
      .eq('id', uploadId)
      .eq('user_id', user.id)

    if (error) {
      throw error
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Data processed successfully',
        recordCount: allParsedData.length,
        columnCount: allHeaders.length,
        sheetsProcessed: Object.keys(processedSheets)
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    console.error('Error processing upload:', error)
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

async function callOpenAI(prompt: string): Promise<string> {
  const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openAIApiKey) {
    throw new Error('OpenAI API key not configured');
  }

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
            content: 'You are an expert data analyst specializing in inventory management, business intelligence, and spreadsheet analysis. Always respond with valid JSON only, no markdown formatting or code blocks.'
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
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error('OpenAI API call failed:', error);
    return 'AI analysis temporarily unavailable';
  }
}

function cleanJsonResponse(response: string): string {
  // Remove markdown code blocks if present
  let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  
  // Try to extract JSON from the response if it's wrapped in other text
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  
  return cleaned.trim();
}

async function analyzeColumnsWithAI(headers: string[], data: any[]): Promise<any> {
  const sampleData = data.slice(0, 5).map(row => 
    headers.reduce((obj, header) => {
      obj[header] = row[header];
      return obj;
    }, {} as any)
  );

  const prompt = `Analyze these spreadsheet columns and classify each one. 
  
Headers: ${headers.join(', ')}

Sample data (first 5 rows):
${JSON.stringify(sampleData, null, 2)}

For each column, determine:
1. Data type (text, number, date, currency, identifier, etc.)
2. Business purpose (product_sku, inventory_level, financial, descriptive, temporal, etc.)

Respond with valid JSON only:
{
  "column_name": {
    "type": "detected_type",
    "purpose": "business_purpose",
    "confidence": "high/medium/low"
  }
}`;

  const aiResponse = await callOpenAI(prompt);
  
  try {
    const cleanedResponse = cleanJsonResponse(aiResponse);
    return JSON.parse(cleanedResponse);
  } catch (error) {
    console.error('Failed to parse AI column analysis:', error);
    return headers.reduce((acc, header) => {
      acc[header] = { type: 'text', purpose: 'general', confidence: 'low' };
      return acc;
    }, {} as any);
  }
}

async function generateInsightsWithAI(data: any[], headers: string[], processedSheets: any): Promise<string[]> {
  const sheetsInfo = Object.keys(processedSheets).map(sheetName => ({
    name: sheetName,
    recordCount: processedSheets[sheetName].data.length,
    columns: processedSheets[sheetName].headers.length
  }));

  const prompt = `Analyze this business dataset and provide 5-7 key insights:

Dataset Summary:
- ${data.length} total records across ${Object.keys(processedSheets).length} sheet(s)
- Sheets: ${JSON.stringify(sheetsInfo)}
- All columns: ${headers.join(', ')}

Sample data:
${JSON.stringify(data.slice(0, 3), null, 2)}

Focus on:
- Data patterns and trends
- Business implications
- Multi-sheet relationships if applicable
- Inventory/stock insights if applicable
- Data quality observations
- Actionable findings

Return valid JSON array only: ["insight1", "insight2", ...]`;

  const aiResponse = await callOpenAI(prompt);
  
  try {
    const cleanedResponse = cleanJsonResponse(aiResponse);
    const insights = JSON.parse(cleanedResponse);
    return Array.isArray(insights) ? insights : [aiResponse];
  } catch (error) {
    console.error('Failed to parse AI insights:', error);
    return [
      `Dataset contains ${data.length} records across ${Object.keys(processedSheets).length} sheet(s)`,
      'AI analysis temporarily unavailable - please try again later'
    ];
  }
}

async function generateSuggestionsWithAI(headers: string[], data: any[], processedSheets: any): Promise<string[]> {
  const prompt = `Based on this multi-sheet spreadsheet structure, provide 4-6 actionable suggestions:

Sheets: ${Object.keys(processedSheets).join(', ')}
All column headers: ${headers.join(', ')}
Total records: ${data.length}

Sample data structure:
${JSON.stringify(data[0] || {}, null, 2)}

Consider:
- Multi-sheet data consolidation opportunities
- Missing but important columns for business analysis
- Data standardization improvements
- Inventory management optimizations
- Business intelligence opportunities
- Sheet relationship optimization

Return valid JSON array only: ["suggestion1", "suggestion2", ...]`;

  const aiResponse = await callOpenAI(prompt);
  
  try {
    const cleanedResponse = cleanJsonResponse(aiResponse);
    const suggestions = JSON.parse(cleanedResponse);
    return Array.isArray(suggestions) ? suggestions : [aiResponse];
  } catch (error) {
    console.error('Failed to parse AI suggestions:', error);
    return [
      'Consider consolidating related data across sheets',
      'Use consistent naming conventions for better data processing',
      'Ensure numeric columns contain only numeric values',
      'AI suggestions temporarily unavailable'
    ];
  }
}

async function assessDataQualityWithAI(data: any[], headers: string[]): Promise<any> {
  const totalCells = data.length * headers.length;
  let emptyCells = 0;

  data.forEach(row => {
    headers.forEach(header => {
      const value = row[header];
      if (!value || value.toString().trim() === '') {
        emptyCells++;
      }
    });
  });

  const completeness = ((totalCells - emptyCells) / totalCells * 100).toFixed(1);

  const prompt = `Assess the data quality of this dataset:

- Total records: ${data.length}
- Total columns: ${headers.length}
- Data completeness: ${completeness}%
- Empty cells: ${emptyCells}/${totalCells}

Sample data:
${JSON.stringify(data.slice(0, 3), null, 2)}

Identify data quality issues and provide recommendations. Return valid JSON only:
{
  "completeness": "${completeness}%",
  "totalRecords": ${data.length},
  "issues": ["array of quality issues found"],
  "recommendations": ["array of improvement recommendations"]
}`;

  const aiResponse = await callOpenAI(prompt);
  
  try {
    const cleanedResponse = cleanJsonResponse(aiResponse);
    const assessment = JSON.parse(cleanedResponse);
    return {
      ...assessment,
      emptyCells,
      totalCells
    };
  } catch (error) {
    console.error('Failed to parse AI quality assessment:', error);
    return {
      completeness: `${completeness}%`,
      totalRecords: data.length,
      emptyCells,
      totalCells,
      issues: emptyCells > totalCells * 0.1 ? ['High number of empty cells detected'] : [],
      recommendations: ['AI assessment temporarily unavailable']
    };
  }
}

async function analyzeMultipleSheetsWithAI(processedSheets: any): Promise<any> {
  const sheetsOverview = Object.keys(processedSheets).map(sheetName => ({
    name: sheetName,
    recordCount: processedSheets[sheetName].data.length,
    columns: processedSheets[sheetName].headers,
    sampleData: processedSheets[sheetName].data.slice(0, 2)
  }));

  const prompt = `Analyze these Excel sheets and their relationships:

${JSON.stringify(sheetsOverview, null, 2)}

Provide analysis covering:
1. Which sheet contains the most valuable business data
2. Potential relationships between sheets
3. Data consolidation opportunities
4. Recommended primary sheet for analysis

Return valid JSON only:
{
  "primarySheet": "recommended_sheet_name",
  "sheetPurposes": {"sheet_name": "purpose_description"},
  "relationships": ["relationship descriptions"],
  "consolidationOpportunities": ["consolidation suggestions"]
}`;

  const aiResponse = await callOpenAI(prompt);
  
  try {
    const cleanedResponse = cleanJsonResponse(aiResponse);
    return JSON.parse(cleanedResponse);
  } catch (error) {
    console.error('Failed to parse multi-sheet analysis:', error);
    return {
      primarySheet: Object.keys(processedSheets)[0] || 'Unknown',
      sheetPurposes: Object.keys(processedSheets).reduce((acc, sheet) => {
        acc[sheet] = 'Business data sheet';
        return acc;
      }, {} as any),
      relationships: ['AI analysis temporarily unavailable'],
      consolidationOpportunities: ['AI analysis temporarily unavailable']
    };
  }
}
