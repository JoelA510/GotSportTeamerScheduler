-- Smoke test for migration 20260421025831_drop_recursive_org_members_policy.sql

-- 1. Confirm the recursive policy is gone and the safe ones are in place.
SELECT polname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'organization_members'
ORDER BY polname;
-- Expected rows:
--   Org Members: admins manage
--   Org Members: view members
-- Expected NOT to contain:
--   Users can view members of their organizations
--
-- If the recursive name still appears, the migration did not apply.

-- 2. Confirm SECURITY DEFINER helpers exist and have pinned search_path.
SELECT proname, proconfig, prosecdef
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('is_org_member', 'is_org_admin');
-- Expected: 2 rows; prosecdef = true for both; proconfig contains
-- 'search_path=public' (post Wave 2 + Wave 6a corrective migrations).

-- 3. End-to-end SELECT smoke — impersonate an authenticated user and confirm
--    the same query that was returning 500 now returns rows. Replace
--    <USER_UUID> with a real user that is a member of at least one org.
--
--    Supabase's auth.uid() reads from the plural `request.jwt.claims` JSON
--    GUC (not the older singular `request.jwt.claim.sub` — that form still
--    works on some Supabase versions but is the second branch of the
--    auth.uid() coalesce and is not the documented path).
--
--    SET LOCAL ROLE authenticated;
--    SET LOCAL "request.jwt.claims" = '{"sub": "<USER_UUID>"}';
--    SELECT om.*, o.*
--    FROM public.organization_members om
--    JOIN public.organizations o ON o.id = om.organization_id
--    WHERE om.profile_id = '<USER_UUID>';
--
--    Expected: returns at least one row. If ERROR "infinite recursion
--    detected in policy for relation organization_members", the migration
--    did not apply.
