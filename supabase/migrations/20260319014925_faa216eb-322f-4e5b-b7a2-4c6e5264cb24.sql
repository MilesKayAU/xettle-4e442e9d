CREATE OR REPLACE FUNCTION public.get_rls_inventory()
RETURNS TABLE(table_name text, rls_enabled boolean, policy_count bigint, policy_names text[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT
    c.relname::text AS table_name,
    c.relrowsecurity AS rls_enabled,
    COALESCE(p.cnt, 0) AS policy_count,
    COALESCE(p.names, ARRAY[]::text[]) AS policy_names
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN (
    SELECT
      pol.polrelid,
      COUNT(*) AS cnt,
      ARRAY_AGG(pol.polname::text ORDER BY pol.polname) AS names
    FROM pg_policy pol
    GROUP BY pol.polrelid
  ) p ON p.polrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
  ORDER BY c.relname;
$$;