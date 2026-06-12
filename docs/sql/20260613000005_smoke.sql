-- Smoke test for 20260613000005_crud_review_fixes.sql

-- Exactly one create-form overload, now with p_waiver_text
SELECT proname, pg_get_function_identity_arguments(oid) AS args
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE nspname = 'public' AND proname = 'admin_create_registration_form';
-- Expected: 1 row, args include "p_waiver_text text"

-- Members read path exists and is SECURITY DEFINER
SELECT proname, prosecdef
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE nspname = 'public' AND proname = 'get_organization_members';
-- Expected: prosecdef = true

-- tenant_admin guard present in member RPCs
SELECT proname
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE nspname = 'public'
  AND proname IN ('admin_remove_member', 'admin_change_member_role')
  AND prosrc LIKE '%tenant_admin%';
-- Expected: 2 rows

-- season org check present in form update RPC
SELECT proname
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE nspname = 'public'
  AND proname = 'admin_update_registration_form'
  AND prosrc LIKE '%Season settings do not belong%';
-- Expected: 1 row
