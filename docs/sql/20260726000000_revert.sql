-- Revert for 20260726000000_drop_stale_broad_write_policies.sql
--
-- Restores the broad org-member ALL policies on teams, coaches, and
-- locations. Run only to roll the hardening back -- this reopens the
-- privilege-escalation path the migration closes.

BEGIN;

CREATE POLICY "Unified org access on teams"
  ON public.teams FOR ALL TO authenticated
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY "Unified org access on coaches"
  ON public.coaches FOR ALL TO authenticated
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

CREATE POLICY "Unified org access on locations"
  ON public.locations FOR ALL TO authenticated
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

COMMIT;
