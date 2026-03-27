
-- Lock down system_config: enable RLS, allow only service role to write
-- Authenticated users get read-only (needed by is_primary_admin() SECURITY DEFINER function,
-- but the function runs as definer so even this SELECT policy is belt-and-suspenders)

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for anon/authenticated — the is_primary_admin() function
-- is SECURITY DEFINER so it bypasses RLS. No client code reads this table directly.
-- This means NO authenticated user can read, insert, update, or delete from client side.

-- If we ever need client reads, add a restrictive SELECT policy.
-- For now, complete lockdown: only service role and SECURITY DEFINER functions can access.
