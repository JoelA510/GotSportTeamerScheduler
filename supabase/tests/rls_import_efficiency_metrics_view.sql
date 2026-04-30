-- RLS invariant: the `import_efficiency_metrics` view — with
-- `security_invoker = on` and payload-derived import_job_id — should enforce
-- org scope for the querying role and return deterministic metric values.
--
-- Exercises: `import_efficiency_metrics` view + telemetry_log RLS policy.

BEGIN;

\i supabase/tests/_fixtures.sql

SELECT plan(6);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (SELECT COUNT(*) FROM public.import_efficiency_metrics)::int,
    1,
    'Org A caller sees exactly one import metrics row'
);

SELECT is(
    (SELECT COUNT(*) FROM public.import_efficiency_metrics
      WHERE import_job_id = 'aaaabbbb-2222-2222-2222-222222222222')::int,
    0,
    'Org A caller cannot see Org B import metrics row'
);

SELECT is(
    (SELECT COUNT(*) FROM public.import_efficiency_metrics
      WHERE import_job_id = 'aaaabbbb-1111-1111-1111-111111111111')::int,
    1,
    'Org A caller can see Org A import metrics row'
);

SELECT is(
    (SELECT suggestions_applied::int FROM public.import_efficiency_metrics
      WHERE import_job_id = 'aaaabbbb-1111-1111-1111-111111111111'),
    1,
    'Org A seeded metric has expected suggestions_applied count'
);

SELECT is(
    (SELECT total_suggestions::int FROM public.import_efficiency_metrics
      WHERE import_job_id = 'aaaabbbb-1111-1111-1111-111111111111'),
    2,
    'Org A seeded metric has expected total_suggestions count'
);

SELECT ok(
    ABS((SELECT match_rate FROM public.import_efficiency_metrics
      WHERE import_job_id = 'aaaabbbb-1111-1111-1111-111111111111') - 50.0) < 0.00001,
    'Org A seeded metric has expected match_rate (50%)'
);

SELECT * FROM finish();
ROLLBACK;
