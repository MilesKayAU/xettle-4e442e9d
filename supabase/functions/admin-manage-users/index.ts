import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? ""
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verify admin role
    const { data: isAdmin } = await supabase.rpc('has_role', { _role: 'admin' })
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { action, userId, email } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    switch (action) {
      case 'delete_user': {
        if (!userId) throw new Error('userId required')
        
        // Delete user data first (cascade won't cover all tables)
        await supabaseAdmin.from('settlement_lines').delete().eq('user_id', userId)
        await supabaseAdmin.from('settlement_unmapped').delete().eq('user_id', userId)
        await supabaseAdmin.from('settlements').delete().eq('user_id', userId)
        await supabaseAdmin.from('xero_tokens').delete().eq('user_id', userId)
        await supabaseAdmin.from('app_settings').delete().eq('user_id', userId)
        await supabaseAdmin.from('user_roles').delete().eq('user_id', userId)
        
        // Delete auth user
        const { error } = await supabaseAdmin.auth.admin.deleteUser(userId)
        if (error) throw error
        
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      case 'send_password_reset': {
        if (!email) throw new Error('email required')
        
        // Generate a password reset link using the admin API
        const { data, error } = await supabaseAdmin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: {
            redirectTo: 'https://xettle.lovable.app/reset-password',
          }
        })
        if (error) throw error
        
        return new Response(JSON.stringify({ success: true, message: 'Password reset email sent' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      case 'invite_user': {
        if (!email) throw new Error('email required')
        
        const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          redirectTo: 'https://xettle.lovable.app/reset-password',
        })
        if (error) throw error
        
        return new Response(JSON.stringify({ success: true, userId: data.user.id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }

  } catch (error) {
    logger.error('Admin manage users error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
