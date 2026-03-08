-- Fix security issue: Restrict alibaba_orders access to user's own orders only
-- Current policy allows all authenticated users to access any order data

-- Drop the overly permissive existing policy
DROP POLICY IF EXISTS "Authenticated users can manage alibaba orders" ON public.alibaba_orders;

-- Create secure user-specific policies
-- Users can only view their own orders
CREATE POLICY "Users can view their own alibaba orders"
  ON public.alibaba_orders
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can only insert orders for themselves
CREATE POLICY "Users can insert their own alibaba orders"
  ON public.alibaba_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can only update their own orders
CREATE POLICY "Users can update their own alibaba orders"
  ON public.alibaba_orders
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can only delete their own orders
CREATE POLICY "Users can delete their own alibaba orders"
  ON public.alibaba_orders
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);