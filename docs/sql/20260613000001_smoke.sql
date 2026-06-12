-- Smoke test for 20260613000001_form_mutation_rpcs.sql
-- Verify the RPCs are accessible to authenticated role.
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('admin_update_registration_form', 'admin_delete_registration_form');
-- Expected: 2 rows

-- Verify SECURITY DEFINER
SELECT proname, prosecdef
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN ('admin_update_registration_form', 'admin_delete_registration_form');
-- Expected: both prosecdef = true

-- Verify audit actions are present in the constraint
SELECT pg_get_constraintdef(oid) AS constraint_def
FROM pg_constraint
WHERE conname = 'audit_log_action_check';
-- Expected: definition contains 'registration.form_updated', 'registration.form_deleted'
