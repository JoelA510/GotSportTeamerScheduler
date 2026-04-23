-- RLS invariant: the `import_efficiency_metrics` view — Wave 2 flipped to
-- `security_invoker = on` — should enforce org scope for the querying role.
-- An Org A admin should see only the import rows scoped to Org A, because
-- the view now runs with the CALLER'S privileges (RLS on telemetry_log
-- kicks in rather than being bypassed by the view-owner postgres role).
--
-- Exercises: `import_efficiency_metrics` view + telemetry_log RLS policy.
--
-- ────────────────────────────────────────────────────────────────────
-- Known caveat (flagged for fix-in-follow-up — see PR body):
-- the view's DDL groups by `import_job_id`, but telemetry_log has no
-- such column (only a `payload` JSONB that may embed it). If this test
-- fails with "column import_job_id does not exist", that is the
-- pre-existing schema bug, NOT an RLS regression. File a separate PR
-- to rewrite the view as `payload->>'import_job_id'` before weakening
-- the assertion here.
-- ────────────────────────────────────────────────────────────────────

BEGIN;

\i supabase/tests/_fixtures.sql

SELECT plan(1);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (SELECT COUNT(*) FROM public.import_efficiency_metrics)::int,
    (SELECT COUNT(*) FROM public.imports
       WHERE organization_id = 'a1111111-1111-1111-1111-111111111111')::int,
    'view is org-scoped for the authenticated caller (Alice sees Org A imports only)'
);

SELECT * FROM finish();
ROLLBACK;
