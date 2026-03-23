-- Add optional API key field for Mirakl connections that use classic API key auth
-- Some Mirakl instances use OAuth (client_id + client_secret → Bearer token)
-- Others use a direct API key in the Authorization header
-- Both modes must be supported per-connection

ALTER TABLE public.mirakl_tokens
ADD COLUMN IF NOT EXISTS api_key text DEFAULT NULL;

COMMENT ON COLUMN public.mirakl_tokens.api_key IS 'Optional direct API key for Mirakl Marketplace APIs. If set, used instead of OAuth Bearer token for TL endpoints. NULL means use OAuth.';

-- Add auth_mode column to explicitly track which mode each connection uses
ALTER TABLE public.mirakl_tokens
ADD COLUMN IF NOT EXISTS auth_mode text NOT NULL DEFAULT 'oauth';

COMMENT ON COLUMN public.mirakl_tokens.auth_mode IS 'Auth mode: oauth (client_credentials via auth.mirakl.net), api_key (direct key in Authorization header), or both';