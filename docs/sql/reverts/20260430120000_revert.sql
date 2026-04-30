-- Executable rollback/safety script for migration 20260430120000_recreate_import_efficiency_metrics_from_payload.sql
--
-- NOTE:
-- Exact rollback to the pre-20260430120000 SQL is intentionally not provided because the
-- historical definition is structurally invalid against the current telemetry_log schema
-- (public.telemetry_log has no bare import_job_id column).
--
-- This script restores the executable import_efficiency_metrics view contract using
-- payload-derived import_job_id and keeps security_invoker enabled.

CREATE OR REPLACE VIEW public.import_efficiency_metrics AS
WITH import_events AS (
  SELECT
    (tl.payload->>'import_job_id')::uuid AS import_job_id,
    tl.event_type
  FROM public.telemetry_log AS tl
  WHERE tl.payload->>'import_job_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
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
FROM import_events
GROUP BY import_job_id;

ALTER VIEW public.import_efficiency_metrics
  SET (security_invoker = on);
