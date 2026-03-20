/**
 * Shared auth guard for Xettle edge functions.
 *
 * Usage:
 *   import { verifyRequest } from "../_shared/auth-guard.ts"
 *
 *   const { userId, isCron } = await verifyRequest(req, { requireAdmin: true })
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

interface VerifyOptions {
  /** If true, additionally checks has_role('admin') */
  requireAdmin?: boolean
  /** Allow cron/service-role calls (validated via FBM_CRON_SECRET header) */
  allowCron?: boolean
}

interface VerifyResult {
  userId: string
  isCron: boolean
}

export async function verifyRequest(
  req: Request,
  opts: VerifyOptions = {}
): Promise<VerifyResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!

  // Check cron/service-role path first
  if (opts.allowCron) {
    const cronSecret = Deno.env.get("FBM_CRON_SECRET")
    const headerSecret = req.headers.get("x-cron-secret")
    if (cronSecret && headerSecret === cronSecret) {
      return { userId: "cron", isCron: true }
    }
  }

  // JWT path
  const authHeader = req.headers.get("Authorization")
  if (!authHeader) {
    throw new Error("Missing Authorization header")
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error,
  } = await userClient.auth.getUser()

  if (error || !user) {
    throw new Error("Invalid or expired token")
  }

  if (opts.requireAdmin) {
    const { data: isAdmin } = await userClient.rpc("has_role", {
      _role: "admin",
    })
    if (!isAdmin) {
      throw new Error("Forbidden: admin role required")
    }
  }

  return { userId: user.id, isCron: false }
}
