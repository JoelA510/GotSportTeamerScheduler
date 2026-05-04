-- Smoke checks for 20260504000000_admin_compliance_medical_status_rpc.sql.

-- 1. Function exists, is SECURITY DEFINER, and pins search_path.
SELECT
    p.proname,
    pg_get_function_arguments(p.oid) AS args,
    p.prosecdef,
    p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'admin_update_registration_medical_status';
-- Expected: 1 row; prosecdef = true; proconfig contains search_path=public.

-- 2. New audit action is accepted by the audit_log constraint.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.audit_log'::regclass
  AND conname = 'audit_log_action_check';
-- Expected: definition includes compliance.medical_update.

-- 3. Happy path outline. Replace placeholders with real org/admin/registration
-- UUIDs.
--
-- SET LOCAL role = authenticated;
-- SET LOCAL "request.jwt.claims" = '{"sub":"<ORG_ADMIN_USER_UUID>"}';
-- SELECT public.admin_update_registration_medical_status(
--   '<ORG_UUID>'::uuid,
--   '<REGISTRATION_UUID>'::uuid,
--   true,
--   '{"source":"smoke"}'::jsonb
-- );
-- Expected: JSONB response with changed=true and one matching audit_log row.
