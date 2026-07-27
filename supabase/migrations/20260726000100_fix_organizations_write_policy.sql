-- Fix the organizations table's write policy: org-membership, not a raw JWT claim.
--
-- 20251214000003_organizations_schema.sql created the only INSERT/UPDATE/DELETE
-- policy ever defined on `organizations` (the tenant root -- everything else
-- cascades from organizations.id): "Admins can manage organizations", gated on
-- `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`, with no organization_id
-- or is_org_admin() check at all. Every sibling JWT-role policy created
-- alongside it was explicitly dropped by a later migration
-- (20251215000000_strict_rls_multi_tenancy.sql,
-- 20251216000000_facility_multi_tenancy.sql,
-- 20260310000002_unified_rls_schema.sql,
-- 20260324000000_phase1_rls_unification.sql) -- this one was missed, and
-- 20260416000000_security_hardening.sql's remediation table array excludes
-- `organizations` too, confirming it was never revisited.
--
-- app_metadata.role is never written anywhere in this codebase today (only
-- read as a fallback), so the policy is currently inert for every real user
-- -- but it is directly settable through Supabase's own Auth Admin API or
-- Studio "Edit user" raw-metadata UI, with no exploit required. Since
-- `organizations` is the tenant root, a single user whose app_metadata ever
-- gains {"role":"admin"} could rename or delete ANY organization in the
-- system. This closes that gap by moving `organizations` onto the same
-- is_org_admin()-gated model every other table already uses, matching
-- docs/architecture/multi_tenancy.md's stated guarantee: "there is no
-- cross-org data access even for admin users."
--
-- is_org_admin(uuid) takes an organization_id; `organizations` has no
-- organization_id column (it IS the organization), so the policy checks
-- is_org_admin(id) against the row's own primary key -- the same pattern
-- the table's existing SELECT policy uses (is_org_member(id), added in
-- 20260331000000_definitive_schema.sql).
--
-- Reversible: see docs/sql/20260726000100_revert.sql.
-- Smoke checks: see docs/sql/20260726000100_smoke.sql.

BEGIN;

DROP POLICY IF EXISTS "Admins can manage organizations" ON public.organizations;

CREATE POLICY "Organizations: admins manage"
  ON public.organizations FOR ALL TO authenticated
  USING (is_org_admin(id))
  WITH CHECK (is_org_admin(id));

COMMIT;
