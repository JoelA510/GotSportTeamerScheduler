-- RLS invariant: `audit_log` is readable by org admins but NOT by coaches
-- of the same org. The audit trail often contains security-sensitive
-- metadata (who invited whom, settings changes, export events) and must
-- stay gated to org admins.
--
-- Exercises: `audit_log` SELECT policy — is_org_member AND role = 'admin'
-- sub-check on organization_members.

BEGIN;

\i supabase/tests/_fixtures.sql

SELECT plan(2);

SET LOCAL role = 'authenticated';

-- Alice is admin of Org A → should see at least one audit_log row.
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';
SELECT ok(
    (SELECT COUNT(*) FROM public.audit_log) > 0,
    'Alice (admin of Org A) can read audit_log'
);

-- Charlie is a coach of the same Org A → should see zero audit_log rows
-- even though he's a member of the org.
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';
SELECT is(
    (SELECT COUNT(*) FROM public.audit_log)::int,
    0,
    'Charlie (coach of Org A) cannot read audit_log'
);

SELECT * FROM finish();
ROLLBACK;
