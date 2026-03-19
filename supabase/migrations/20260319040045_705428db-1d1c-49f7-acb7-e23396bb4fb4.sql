
-- Add is_active column to shopify_tokens (default true for existing rows)
ALTER TABLE public.shopify_tokens ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Set xettle.myshopify.com as inactive for the user who has both stores
UPDATE public.shopify_tokens 
SET is_active = false 
WHERE shop_domain = 'xettle.myshopify.com';

-- Ensure mileskayaustralia.myshopify.com is active
UPDATE public.shopify_tokens 
SET is_active = true 
WHERE shop_domain = 'mileskayaustralia.myshopify.com';
