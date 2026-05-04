-- Smoke checks for 20260504030000_admin_create_registration_form_rpc.sql.

-- 1. Function exists, is SECURITY DEFINER, and pins search_path.
SELECT
    p.proname,
    pg_get_function_arguments(p.oid) AS args,
    p.prosecdef,
    p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'admin_create_registration_form';
-- Expected: 1 row; prosecdef = true; proconfig contains search_path=public.

-- 2. Audit action is accepted by the audit_log constraint.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.audit_log'::regclass
  AND conname = 'audit_log_action_check';
-- Expected: definition includes registration.form_created.

-- 3. Happy path outline. Replace placeholders with real org/admin/season UUIDs.
--
-- SET LOCAL role = authenticated;
-- SET LOCAL "request.jwt.claims" = '{"sub":"<ORG_ADMIN_USER_UUID>"}';
-- SELECT public.admin_create_registration_form(
--   '<ORG_UUID>'::uuid,
--   'Fall Registration',
--   'Fall season registration',
--   '<SEASON_SETTINGS_UUID>'::uuid,
--   '[{"label":"Emergency Contact","type":"text","required":true}]'::jsonb,
--   'open',
--   '{"source":"smoke"}'::jsonb
-- );
-- Expected: JSONB form row with status=open and one matching
-- registration.form_created audit_log row.
