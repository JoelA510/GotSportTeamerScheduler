-- Emergency rollback for 20260504100000_drop_current_user_role_helper.sql.
--
-- Recreates the legacy public.current_user_role() helper. Prefer rolling the
-- application forward because current policies and RPCs use org-scoped helpers:
-- public.is_org_member(uuid) and public.is_org_admin(uuid).

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role() TO anon, authenticated;

COMMENT ON FUNCTION public.current_user_role() IS
  'Legacy JWT role helper restored by rollback. Current code should prefer is_org_member/is_org_admin.';

COMMIT;
