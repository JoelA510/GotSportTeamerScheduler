-- Drop stale broad org-member write policies on teams, coaches, locations.
--
-- 20260310000002_unified_rls_schema.sql created "Unified org access on
-- teams/coaches/locations" (FOR ALL ... USING (is_org_member(organization_id))),
-- letting any authenticated org member (player/parent/coach role, not just
-- admin) INSERT/UPDATE/DELETE these tables directly. Later migrations moved
-- writes to narrow, audited admin RPCs (20260503050000_coach_admin_mutations,
-- 20260504060000_admin_facility_mutation_rpcs, 20260613000000_coach_delete_rpc,
-- 20260613000003_schedule_team_delete_rpcs, 20260613000004_team_update_rpc) but
-- never dropped the broad policy underneath them. 20260504060000 dropped
-- "Strict org access on locations" -- a name already renamed away by
-- 20260310000002 -- so that drop was a no-op and "Unified org access on
-- locations" survived untouched. `fields` went through a different rename
-- lineage and its equivalent broad policy was already dropped correctly; only
-- teams, coaches, and locations are affected.
--
-- The narrow SELECT-only replacement policies already exist and are
-- unaffected by this migration: "Teams: members access", "Coaches: members
-- access" (both from 20260331000000_definitive_schema.sql), and "Locations:
-- members select" (from 20260504060000_admin_facility_mutation_rpcs.sql).
-- The SECURITY DEFINER admin RPCs do their own is_org_admin() check and do
-- not depend on a row-level write policy, so no replacement write policy is
-- needed here -- removing the broad grant is the entire fix.
--
-- The frontend never writes these three tables directly (confirmed: no
-- `.from('teams'|'coaches'|'locations').(update|insert|delete|upsert)` call
-- site in frontend/src), so this is a pure authorization-surface reduction
-- with no application-code changes required.
--
-- Reversible: see docs/sql/20260726000000_revert.sql.
-- Smoke checks: see docs/sql/20260726000000_smoke.sql.

BEGIN;

DROP POLICY IF EXISTS "Unified org access on teams" ON public.teams;
DROP POLICY IF EXISTS "Unified org access on coaches" ON public.coaches;
DROP POLICY IF EXISTS "Unified org access on locations" ON public.locations;

COMMIT;
