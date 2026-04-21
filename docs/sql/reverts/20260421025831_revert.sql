-- Revert script for migration 20260421025831_drop_recursive_org_members_policy.sql
--
-- USE WITH CAUTION: reintroducing the recursive policy will re-break the
-- onboarding flow with an HTTP 500 on /rest/v1/organization_members queries.
-- Only run this to reproduce the bug for investigation purposes.

DROP POLICY IF EXISTS "Org Members: view members" ON public.organization_members;
DROP POLICY IF EXISTS "Org Members: admins manage" ON public.organization_members;

CREATE POLICY "Users can view members of their organizations"
  ON public.organization_members FOR SELECT
  USING (
    auth.uid() IN (
      SELECT profile_id
      FROM organization_members om
      WHERE om.organization_id = organization_members.organization_id
    )
  );
