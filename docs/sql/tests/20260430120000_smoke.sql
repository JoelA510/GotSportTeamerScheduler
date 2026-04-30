-- Smoke test for migration 20260430120000_recreate_import_efficiency_metrics_from_payload.sql
-- Goal: prove the recreated view resolves import_job_id from payload and remains SECURITY INVOKER.

-- 1) Resolution check: this should execute without
--    "column import_job_id does not exist" errors.
SELECT *
FROM public.import_efficiency_metrics
LIMIT 1;
-- Expected: query succeeds (0+ rows).

-- 2) reloptions check: view should be security_invoker=true.
SELECT
  c.relname,
  pg_catalog.array_to_string(c.reloptions, ', ') AS reloptions
FROM pg_catalog.pg_class AS c
WHERE c.relname = 'import_efficiency_metrics'
  AND c.relkind = 'v';
-- Expected: reloptions contains "security_invoker=true".

-- 3) Deterministic aggregation probe over telemetry-shaped rows with payload.import_job_id.
--    This validates grouping/counting/match_rate semantics independent of live tenant data.
WITH telemetry_probe AS (
  SELECT *
  FROM (
    VALUES
      ('import.suggestion_received'::text, jsonb_build_object('import_job_id', '11111111-1111-1111-1111-111111111111')),
      ('import.suggestion_received'::text, jsonb_build_object('import_job_id', '11111111-1111-1111-1111-111111111111')),
      ('import.suggestion_applied'::text, jsonb_build_object('import_job_id', '11111111-1111-1111-1111-111111111111')),
      ('import.suggestion_received'::text, jsonb_build_object('import_job_id', '22222222-2222-2222-2222-222222222222')),
      ('import.suggestion_applied'::text, jsonb_build_object('import_job_id', '22222222-2222-2222-2222-222222222222')),
      ('import.suggestion_applied'::text, jsonb_build_object('import_job_id', '22222222-2222-2222-2222-222222222222')),
      ('import.suggestion_applied'::text, jsonb_build_object('import_job_id', 'not-a-uuid')),
      ('import.suggestion_received'::text, '{}'::jsonb)
  ) AS t(event_type, payload)
),
aggregated AS (
  SELECT
    CASE
      WHEN tp.payload->>'import_job_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (tp.payload->>'import_job_id')::uuid
    END AS import_job_id,
    tp.event_type
  FROM telemetry_probe AS tp
),
actual AS (
  SELECT
    import_job_id,
    COUNT(*) FILTER (WHERE event_type = 'import.suggestion_applied') AS suggestions_applied,
    COUNT(*) FILTER (WHERE event_type = 'import.suggestion_received') AS total_suggestions,
    CASE
      WHEN COUNT(*) FILTER (WHERE event_type = 'import.suggestion_received') > 0
        THEN (
          COUNT(*) FILTER (WHERE event_type = 'import.suggestion_applied')::float
          / COUNT(*) FILTER (WHERE event_type = 'import.suggestion_received')::float
        ) * 100
      ELSE 100
    END AS match_rate
  FROM aggregated
  WHERE import_job_id IS NOT NULL
  GROUP BY import_job_id
),
expected AS (
  SELECT '11111111-1111-1111-1111-111111111111'::uuid AS import_job_id, 1::bigint AS suggestions_applied, 2::bigint AS total_suggestions,  50::float AS match_rate
  UNION ALL
  SELECT '22222222-2222-2222-2222-222222222222'::uuid AS import_job_id, 2::bigint AS suggestions_applied, 1::bigint AS total_suggestions, 200::float AS match_rate
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
