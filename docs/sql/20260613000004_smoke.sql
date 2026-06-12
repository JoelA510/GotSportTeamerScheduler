-- Smoke test for 20260613000004_team_update_rpc.sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'admin_update_team';
-- Expected: 1 row

SELECT proname, prosecdef
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname = 'admin_update_team';
-- Expected: prosecdef = true

-- Verify audit action present in the constraint
SELECT pg_get_constraintdef(oid) AS constraint_def
FROM pg_constraint
WHERE conname = 'audit_log_action_check';
-- Expected: definition contains 'team.updated'
