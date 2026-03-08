
-- Fix overly permissive RLS policies on multiple tables
-- These tables currently allow ANY authenticated user to write/delete

-- ============ suppliers ============
DROP POLICY IF EXISTS "Authenticated users can manage suppliers" ON public.suppliers;

CREATE POLICY "Admins can manage suppliers"
ON public.suppliers FOR ALL
TO authenticated
USING (has_role('admin'))
WITH CHECK (has_role('admin'));

-- Keep public read for suppliers (used in PO forms)
CREATE POLICY "Authenticated users can read suppliers"
ON public.suppliers FOR SELECT
TO authenticated
USING (true);

-- ============ invoice_suppliers ============
DROP POLICY IF EXISTS "Authenticated users can manage suppliers" ON public.invoice_suppliers;
DROP POLICY IF EXISTS "Authenticated users can read suppliers" ON public.invoice_suppliers;

CREATE POLICY "Admins can manage invoice suppliers"
ON public.invoice_suppliers FOR ALL
TO authenticated
USING (has_role('admin'))
WITH CHECK (has_role('admin'));

CREATE POLICY "Authenticated users can read invoice suppliers"
ON public.invoice_suppliers FOR SELECT
TO authenticated
USING (true);

-- ============ where_to_buy_options ============
DROP POLICY IF EXISTS "Allow authenticated users to manage where to buy options" ON public.where_to_buy_options;

CREATE POLICY "Admins can manage where to buy options"
ON public.where_to_buy_options FOR ALL
TO authenticated
USING (has_role('admin'))
WITH CHECK (has_role('admin'));

-- ============ products ============
DROP POLICY IF EXISTS "Allow authenticated users to manage products" ON public.products;

CREATE POLICY "Admins can manage products"
ON public.products FOR ALL
TO authenticated
USING (has_role('admin'))
WITH CHECK (has_role('admin'));

-- ============ research_links ============
DROP POLICY IF EXISTS "Allow authenticated users to delete research links" ON public.research_links;
DROP POLICY IF EXISTS "Allow authenticated users to insert research links" ON public.research_links;
DROP POLICY IF EXISTS "Allow authenticated users to update research links" ON public.research_links;

CREATE POLICY "Admins can manage research links"
ON public.research_links FOR ALL
TO authenticated
USING (has_role('admin'))
WITH CHECK (has_role('admin'));

-- ============ contact_messages ============
-- Fix: SELECT and UPDATE should be admin-only, not all authenticated users
DROP POLICY IF EXISTS "Allow authenticated users to read contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Allow authenticated users to update contact messages" ON public.contact_messages;
DROP POLICY IF EXISTS "Allow authenticated users to view contact messages" ON public.contact_messages;

CREATE POLICY "Admins can read contact messages"
ON public.contact_messages FOR SELECT
TO authenticated
USING (has_role('admin'));

CREATE POLICY "Admins can update contact messages"
ON public.contact_messages FOR UPDATE
TO authenticated
USING (has_role('admin'));

CREATE POLICY "Admins can delete contact messages"
ON public.contact_messages FOR DELETE
TO authenticated
USING (has_role('admin'));

-- ============ product_submissions ============
-- Fix: UPDATE should be admin-only
DROP POLICY IF EXISTS "Allow authenticated users to update product submissions" ON public.product_submissions;
DROP POLICY IF EXISTS "Allow authenticated users to update their own product_submissio" ON public.product_submissions;

CREATE POLICY "Admins can update product submissions"
ON public.product_submissions FOR UPDATE
TO authenticated
USING (has_role('admin'));

CREATE POLICY "Admins can delete product submissions"
ON public.product_submissions FOR DELETE
TO authenticated
USING (has_role('admin'));

-- ============ brand_profiles ============
-- Fix: broken auth.jwt() ->> 'role' checks → use has_role('admin')
DROP POLICY IF EXISTS "Only admins can insert brand profiles" ON public.brand_profiles;
DROP POLICY IF EXISTS "Only admins can update brand profiles" ON public.brand_profiles;

CREATE POLICY "Admins can insert brand profiles"
ON public.brand_profiles FOR INSERT
TO authenticated
WITH CHECK (has_role('admin'));

CREATE POLICY "Admins can update brand profiles"
ON public.brand_profiles FOR UPDATE
TO authenticated
USING (has_role('admin'));

CREATE POLICY "Admins can delete brand profiles"
ON public.brand_profiles FOR DELETE
TO authenticated
USING (has_role('admin'));

-- ============ brand_messages ============
-- Fix: broken auth.jwt() ->> 'role' checks → use has_role('admin')
DROP POLICY IF EXISTS "Only admins can update brand messages" ON public.brand_messages;
DROP POLICY IF EXISTS "Only admins can view brand messages" ON public.brand_messages;

CREATE POLICY "Admins can view brand messages"
ON public.brand_messages FOR SELECT
TO authenticated
USING (has_role('admin'));

CREATE POLICY "Admins can update brand messages"
ON public.brand_messages FOR UPDATE
TO authenticated
USING (has_role('admin'));

CREATE POLICY "Admins can delete brand messages"
ON public.brand_messages FOR DELETE
TO authenticated
USING (has_role('admin'));

-- ============ product_images ============
-- Fix: broken auth.jwt() ->> 'role' checks → use has_role('admin')
DROP POLICY IF EXISTS "Only admins can update product images" ON public.product_images;
DROP POLICY IF EXISTS "Product images are viewable by everyone" ON public.product_images;

CREATE POLICY "Admins can update product images"
ON public.product_images FOR UPDATE
TO authenticated
USING (has_role('admin'));

CREATE POLICY "Admins can delete product images"
ON public.product_images FOR DELETE
TO authenticated
USING (has_role('admin'));

CREATE POLICY "Product images viewable by everyone"
ON public.product_images FOR SELECT
USING ((status = 'approved') OR has_role('admin'));
