-- Fix Security Definer View issue by enabling SECURITY INVOKER
-- Drop and recreate the view with explicit security_invoker=on

-- Drop the existing view
DROP VIEW IF EXISTS public.amazon_product_mapping;

-- Recreate the view with explicit SECURITY INVOKER
CREATE VIEW public.amazon_product_mapping 
WITH (security_invoker=on) AS
SELECT 
  ap.id AS amazon_id,
  ap.asin,
  ap.title AS amazon_title,
  ap.image_urls AS amazon_images,
  p.id AS local_id,
  p.name AS local_title,
  p.description AS local_description
FROM amazon_products ap
LEFT JOIN product_submissions p ON (ap.local_product_id = p.id);

-- Grant appropriate permissions
GRANT SELECT ON public.amazon_product_mapping TO authenticated;
GRANT SELECT ON public.amazon_product_mapping TO anon;