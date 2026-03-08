-- Fix Security Definer View issue
-- Drop and recreate the amazon_product_mapping view without SECURITY DEFINER

-- First drop the existing view
DROP VIEW IF EXISTS public.amazon_product_mapping;

-- Recreate the view without SECURITY DEFINER (default is SECURITY INVOKER)
CREATE VIEW public.amazon_product_mapping AS
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

-- Enable RLS on the view (inherits from underlying tables)
ALTER VIEW public.amazon_product_mapping SET (security_barrier = true);

-- Grant appropriate permissions
GRANT SELECT ON public.amazon_product_mapping TO authenticated;
GRANT SELECT ON public.amazon_product_mapping TO anon;