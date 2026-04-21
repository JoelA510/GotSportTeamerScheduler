-- Bug fix: GET /rest/v1/organization_members?... returns 500 after signup.
--
-- Root cause: `20251214000004_core_auth.sql:37` created a SELECT policy on
-- `organization_members` whose USING clause subqueries `organization_members`
-- itself:
--
--   USING (
--     auth.uid() IN (
--       SELECT profile_id FROM organization_members om
--       WHERE om.organization_id = organization_members.organization_id
--     )
--   )
--
-- Postgres detects this cross-row RLS recursion and aborts the query with
-- "infinite recursion detected in policy for relation organization_members".
-- PostgREST surfaces that as HTTP 500.
--
-- `20260331000000_definitive_schema.sql:844–858` added a correct replacement
-- ("Org Members: view members") that uses the SECURITY-DEFINER helper
-- `public.is_org_member(org_id)` (defined in 20251215000000_strict_rls_multi_tenancy.sql).
-- That helper bypasses RLS by design, so its subquery does not recurse.
--
-- However, the original recursive policy was never dropped. When BOTH
-- policies exist on FOR SELECT, Postgres evaluates BOTH — the recursive one
-- throws even though the safe one would permit. The fix is to drop the
-- recursive policy explicitly.
--
-- Defensive: we also re-assert the safe policy using CREATE OR REPLACE-style
-- idempotency (drop-if-exists + create) in case the definitive_schema
-- migration was not applied against this DB.
--
-- Reversal: docs/sql/reverts/20260421025831_revert.sql.
-- Smoke: docs/sql/tests/20260421025831_smoke.sql.

BEGIN;

-- 1. Drop the recursive policy from 20251214000004_core_auth.sql.
DROP POLICY IF EXISTS "Users can view members of their organizations"
  ON public.organization_members;

-- 2. Defensively pin search_path on the SECURITY DEFINER helpers this
--    migration leans on. `20260421002500_lock_search_path_remaining_definers.sql`
--    already covers them in a fully up-to-date DB; ALTER FUNCTION is idempotent
--    so re-asserting here protects us if the migration is applied against a DB
--    that is behind on Wave 2 / Wave 6a corrective migrations. Each overload
--    (distinguished by signature) needs its own ALTER (Gemini PR #177 §1).
ALTER FUNCTION public.is_org_member(uuid) SET search_path = public;
ALTER FUNCTION public.is_org_admin(uuid)  SET search_path = public;

-- 3. Re-assert the safe SELECT policy (no-op if definitive_schema already
--    ran; creates it if the target DB was behind). is_org_member() is
--    SECURITY DEFINER so its internal SELECT does not re-trigger RLS.
DROP POLICY IF EXISTS "Org Members: view members"
  ON public.organization_members;
CREATE POLICY "Org Members: view members"
  ON public.organization_members FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- 4. Re-assert the admin-manage policy. The original uses an EXISTS subquery
--    into organization_members which, while guarded by the early is_org_member
--    call, can still trigger recursion under some planner conditions. Replace
--    the EXISTS with a call to public.is_org_admin(org_id) (defined in
--    20251214000004_core_auth.sql line 47; SECURITY DEFINER like its sibling).
DROP POLICY IF EXISTS "Org Members: admins manage"
  ON public.organization_members;
CREATE POLICY "Org Members: admins manage"
  ON public.organization_members FOR ALL
  TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

COMMIT;
