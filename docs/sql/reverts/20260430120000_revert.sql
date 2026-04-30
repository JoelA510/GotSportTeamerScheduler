-- Revert script for migration 20260430120000_recreate_import_efficiency_metrics_from_payload.sql
-- Restores the previous view definition that grouped directly by telemetry_log.import_job_id.

DROP VIEW IF EXISTS public.import_efficiency_metrics;

CREATE VIEW public.import_efficiency_metrics AS
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
FROM public.telemetry_log
GROUP BY import_job_id;

ALTER VIEW public.import_efficiency_metrics
  SET (security_invoker = on);
