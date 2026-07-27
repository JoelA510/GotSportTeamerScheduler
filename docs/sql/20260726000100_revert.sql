-- Revert for 20260726000100_fix_organizations_write_policy.sql
--
-- Restores the original JWT-claim-trusting write policy. Run only to roll
-- the hardening back -- this reopens the tenant-root privilege-escalation
-- path the migration closes.

BEGIN;

DROP POLICY IF EXISTS "Organizations: admins manage" ON public.organizations;

CREATE POLICY "Admins can manage organizations"
    ON public.organizations
    FOR ALL
    TO authenticated
    USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

COMMIT;
