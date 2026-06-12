-- Smoke test for 20260613000002_member_mutation_rpcs.sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('admin_remove_member', 'admin_change_member_role');
-- Expected: 2 rows

SELECT proname, prosecdef
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN ('admin_remove_member', 'admin_change_member_role');
-- Expected: both prosecdef = true
