-- Smoke test for migration 20260430120000_recreate_import_efficiency_metrics_from_payload.sql
-- Goal: prove public.import_efficiency_metrics resolves payload import_job_id safely and remains SECURITY INVOKER.
--
-- Operator note:
-- This smoke is intended for operator/service-role execution.
-- RLS invariants are covered in pgTAP tests; this smoke focuses on executable view behavior.
-- org_id is still populated on fixture telemetry rows so data is tenant-shaped and RLS-compatible.

BEGIN;

-- 1) Resolution check: should execute without "column import_job_id does not exist".
SELECT *
FROM public.import_efficiency_metrics
LIMIT 1;
-- Expected: query succeeds (0+ rows).

-- 2) reloptions check: view should include security_invoker=true.
SELECT
  c.relname,
  pg_catalog.array_to_string(c.reloptions, ', ') AS reloptions
FROM pg_catalog.pg_class AS c
WHERE c.relname = 'import_efficiency_metrics'
  AND c.relkind = 'v';
-- Expected: reloptions contains "security_invoker=true".

-- 3) Insert deterministic tenant-shaped fixtures into real tables.
-- Unique smoke IDs avoid collisions in shared databases.
INSERT INTO public.organizations (id, name, slug)
VALUES (
  'deadbeef-3010-4000-8000-0000000000aa'::uuid,
  'Smoke Org 20260430120000',
  'smoke-org-20260430120000'
)
ON CONFLICT (id) DO NOTHING;

-- Job A expected: 2 received, 1 applied => 50%.
-- Job B expected: 1 received, 2 applied => 200%.
-- Malformed and missing import_job_id rows should be ignored and not break the view.
INSERT INTO public.telemetry_log (org_id, session_id, event_type, payload)
VALUES
  ('deadbeef-3010-4000-8000-0000000000aa'::uuid, 'smoke-20260430120000', 'import.suggestion_received', jsonb_build_object('import_job_id', 'deadbeef-3010-4000-8000-000000000001')),
  ('deadbeef-3010-4000-8000-0000000000aa'::uuid, 'smoke-20260430120000', 'import.suggestion_received', jsonb_build_object('import_job_id', 'deadbeef-3010-4000-8000-000000000001')),
  ('deadbeef-3010-4000-8000-0000000000aa'::uuid, 'smoke-20260430120000', 'import.suggestion_applied', jsonb_build_object('import_job_id', 'deadbeef-3010-4000-8000-000000000001')),
  ('deadbeef-3010-4000-8000-0000000000aa'::uuid, 'smoke-20260430120000', 'import.suggestion_received', jsonb_build_object('import_job_id', 'deadbeef-3010-4000-8000-000000000002')),
  ('deadbeef-3010-4000-8000-0000000000aa'::uuid, 'smoke-20260430120000', 'import.suggestion_applied', jsonb_build_object('import_job_id', 'deadbeef-3010-4000-8000-000000000002')),
  ('deadbeef-3010-4000-8000-0000000000aa'::uuid, 'smoke-20260430120000', 'import.suggestion_applied', jsonb_build_object('import_job_id', 'deadbeef-3010-4000-8000-000000000002')),
  ('deadbeef-3010-4000-8000-0000000000aa'::uuid, 'smoke-20260430120000', 'import.suggestion_applied', jsonb_build_object('import_job_id', 'not-a-uuid')),
  ('deadbeef-3010-4000-8000-0000000000aa'::uuid, 'smoke-20260430120000', 'import.suggestion_received', '{}'::jsonb);

-- 4) Malformed UUID resilience check: querying the real view should not error.
SELECT COUNT(*) AS metric_row_count
FROM public.import_efficiency_metrics;
-- Expected: query succeeds; malformed/missing import_job_id rows do not crash execution.

-- 5) Deterministic aggregation probe against the actual view (not a local CTE clone).
WITH expected AS (
  SELECT 'deadbeef-3010-4000-8000-000000000001'::uuid AS import_job_id, 1::bigint AS suggestions_applied, 2::bigint AS total_suggestions,  50::float AS match_rate
  UNION ALL
  SELECT 'deadbeef-3010-4000-8000-000000000002'::uuid AS import_job_id, 2::bigint AS suggestions_applied, 1::bigint AS total_suggestions, 200::float AS match_rate
),
actual AS (
  SELECT
    v.import_job_id,
    v.suggestions_applied,
    v.total_suggestions,
    v.match_rate
  FROM public.import_efficiency_metrics AS v
  WHERE v.import_job_id IN (
    'deadbeef-3010-4000-8000-000000000001'::uuid,
    'deadbeef-3010-4000-8000-000000000002'::uuid
  )
)
SELECT
  e.import_job_id,
  e.suggestions_applied AS expected_suggestions_applied,
  a.suggestions_applied AS actual_suggestions_applied,
  e.total_suggestions AS expected_total_suggestions,
  a.total_suggestions AS actual_total_suggestions,
  e.match_rate AS expected_match_rate,
  a.match_rate AS actual_match_rate,
  (
    e.suggestions_applied = a.suggestions_applied
    AND e.total_suggestions = a.total_suggestions
    AND abs(e.match_rate - a.match_rate) < 0.000001
  ) AS pass
FROM expected AS e
JOIN actual AS a USING (import_job_id)
ORDER BY e.import_job_id;
-- Expected: exactly 2 rows, both with pass = true.

ROLLBACK;
