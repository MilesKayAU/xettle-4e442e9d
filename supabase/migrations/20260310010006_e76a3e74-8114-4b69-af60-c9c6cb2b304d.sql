
-- Fix marketplace_ad_spend RLS: drop any overly permissive policy
DROP POLICY IF EXISTS "Enable all access for all users" ON public.marketplace_ad_spend;

-- Fix marketplace_shipping_costs RLS: drop any overly permissive policy
DROP POLICY IF EXISTS "Enable all access for all users" ON public.marketplace_shipping_costs;
