-- Smoke checks for 20260504020000_admin_upsert_division_settings_rpc.sql.

-- 1. Function exists, is SECURITY DEFINER, and pins search_path.
SELECT
    p.proname,
    pg_get_function_arguments(p.oid) AS args,
    p.prosecdef,
    p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'admin_upsert_division_settings';
-- Expected: 1 row; prosecdef = true; proconfig contains search_path=public.

-- 2. Happy path outline. Replace placeholders with real org/admin/season UUIDs.
--
-- SET LOCAL role = authenticated;
-- SET LOCAL "request.jwt.claims" = '{"sub":"<ORG_ADMIN_USER_UUID>"}';
-- SELECT public.admin_upsert_division_settings(
--   '<ORG_UUID>'::uuid,
--   '<SEASON_SETTINGS_UUID>'::uuid,
--   NULL,
--   'U10 Coed',
--   14,
--   10,
--   12,
--   NULL,
--   NULL,
--   NULL
-- );
-- Expected: JSONB division row with changed=true and one matching
-- settings.updated audit_log row for resource_type='division'.
