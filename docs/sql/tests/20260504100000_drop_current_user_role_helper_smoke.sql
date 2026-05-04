-- Smoke checks for 20260504100000_drop_current_user_role_helper.sql.

-- 1. Legacy helper is absent.
SELECT to_regprocedure('public.current_user_role()') AS legacy_helper;
-- Expected: NULL.

-- 2. Replacement helpers remain installed.
SELECT to_regprocedure('public.is_org_member(uuid)') AS member_helper;
SELECT to_regprocedure('public.is_org_admin(uuid)') AS admin_helper;
-- Expected: both values are non-NULL.

-- 3. Helper behavior outline. Replace placeholders with a real org member.
--
-- SET LOCAL role = authenticated;
-- SET LOCAL "request.jwt.claims" = '{"sub":"<ORG_MEMBER_USER_UUID>"}';
-- SELECT public.is_org_member('<ORG_UUID>'::uuid);
-- Expected: true for an org member.
