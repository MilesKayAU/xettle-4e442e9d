import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-action, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

// SP-API endpoints by region
const SP_API_ENDPOINTS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
    const userId = claimsData.claims.sub as string

    const action = req.headers.get('x-action') || 'list'

    // First, get a fresh access token via the amazon-auth function
    const { data: authData, error: authError } = await supabase.functions.invoke('amazon-auth', {
      headers: { 'x-action': 'refresh' },
    })

    if (authError || !authData?.access_token) {
      return new Response(JSON.stringify({
        error: 'Failed to get Amazon access token. Please reconnect your Amazon account.',
        details: authData?.error || authError?.message,
      }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { access_token, selling_partner_id, marketplace_id, region } = authData
    const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe

    // ─── LIST: Get available settlement reports ──────────────────
    if (action === 'list') {
      const body = await req.json().catch(() => ({}))
      const { startDate, endDate } = body as { startDate?: string; endDate?: string }

      const params = new URLSearchParams({
        reportTypes: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
        processingStatuses: 'DONE',
        pageSize: '50',
      })

      if (startDate) params.set('createdSince', new Date(startDate).toISOString())
      if (endDate) params.set('createdUntil', new Date(endDate).toISOString())

      const reportsUrl = `${baseUrl}/reports/2021-06-30/reports?${params.toString()}`
      const reportsResponse = await fetch(reportsUrl, {
        headers: {
          'x-amz-access-token': access_token,
          'Content-Type': 'application/json',
        },
      })

      if (!reportsResponse.ok) {
        const errBody = await reportsResponse.text()
        console.error('SP-API reports list failed:', reportsResponse.status, errBody)
        return new Response(JSON.stringify({
          error: `SP-API error: ${reportsResponse.status}`,
          details: errBody,
        }), { status: reportsResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      const reportsData = await reportsResponse.json()

      return new Response(JSON.stringify({
        reports: reportsData.reports || [],
        nextToken: reportsData.nextToken || null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── DOWNLOAD: Fetch a specific settlement report ────────────
    if (action === 'download') {
      const body = await req.json()
      const { reportDocumentId } = body

      if (!reportDocumentId) {
        return new Response(JSON.stringify({ error: 'Missing reportDocumentId' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Step 1: Get the report document URL (with retry for rate limiting)
      const docUrl = `${baseUrl}/reports/2021-06-30/documents/${reportDocumentId}`
      let docResponse: Response | null = null
      let lastErrBody = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          const delay = Math.min(2000 * Math.pow(2, attempt), 10000)
          console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1})`)
          await new Promise(r => setTimeout(r, delay))
        }
        docResponse = await fetch(docUrl, {
          headers: { 'x-amz-access-token': access_token },
        })
        if (docResponse.status !== 429) break
        lastErrBody = await docResponse.text()
        console.warn('SP-API 429 rate limited:', lastErrBody)
      }

      if (!docResponse || !docResponse.ok) {
        const errBody = lastErrBody || (docResponse ? await docResponse.text() : 'No response')
        console.error('SP-API document fetch failed:', docResponse?.status, errBody)
        return new Response(JSON.stringify({ error: `Failed to get report document: ${docResponse?.status}` }), {
          status: docResponse?.status || 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const docData = await docResponse.json()
      const downloadUrl = docData.url

      if (!downloadUrl) {
        return new Response(JSON.stringify({ error: 'No download URL in report document' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Step 2: Download the actual report content
      const reportResponse = await fetch(downloadUrl)
      if (!reportResponse.ok) {
        return new Response(JSON.stringify({ error: `Failed to download report: ${reportResponse.status}` }), {
          status: reportResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      // Handle potential gzip compression
      let reportText: string
      const compressionAlgo = docData.compressionAlgorithm
      if (compressionAlgo === 'GZIP') {
        const buffer = await reportResponse.arrayBuffer()
        const ds = new DecompressionStream('gzip')
        const decompressed = new Response(new Blob([buffer]).stream().pipeThrough(ds))
        reportText = await decompressed.text()
      } else {
        reportText = await reportResponse.text()
      }

      return new Response(JSON.stringify({
        content: reportText,
        reportDocumentId,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('fetch-amazon-settlements error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})