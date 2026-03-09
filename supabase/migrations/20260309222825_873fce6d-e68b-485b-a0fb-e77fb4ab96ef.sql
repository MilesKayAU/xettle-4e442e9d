-- Fix marketplace_ad_spend: drop public policies, replace with authenticated
DROP POLICY IF EXISTS "Users can select own ad spend" ON marketplace_ad_spend;
DROP POLICY IF EXISTS "Users can insert own ad spend" ON marketplace_ad_spend;
DROP POLICY IF EXISTS "Users can update own ad spend" ON marketplace_ad_spend;
DROP POLICY IF EXISTS "Users can delete own ad spend" ON marketplace_ad_spend;

CREATE POLICY "Users can select own ad spend" ON marketplace_ad_spend FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own ad spend" ON marketplace_ad_spend FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ad spend" ON marketplace_ad_spend FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own ad spend" ON marketplace_ad_spend FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Fix marketplace_shipping_costs: drop public policies, replace with authenticated
DROP POLICY IF EXISTS "Users can view their own shipping costs" ON marketplace_shipping_costs;
DROP POLICY IF EXISTS "Users can insert their own shipping costs" ON marketplace_shipping_costs;
DROP POLICY IF EXISTS "Users can update their own shipping costs" ON marketplace_shipping_costs;
DROP POLICY IF EXISTS "Users can delete their own shipping costs" ON marketplace_shipping_costs;

CREATE POLICY "Users can view their own shipping costs" ON marketplace_shipping_costs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own shipping costs" ON marketplace_shipping_costs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own shipping costs" ON marketplace_shipping_costs FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own shipping costs" ON marketplace_shipping_costs FOR DELETE TO authenticated USING (auth.uid() = user_id);
