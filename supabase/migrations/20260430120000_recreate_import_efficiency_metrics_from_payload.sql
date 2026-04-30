-- Recreate import_efficiency_metrics to derive import_job_id from telemetry payload.
-- Uses payload->>'import_job_id' with UUID format validation before casting.

DROP VIEW IF EXISTS public.import_efficiency_metrics;

CREATE VIEW public.import_efficiency_metrics AS
WITH import_events AS (
  SELECT
    CASE
      WHEN tl.payload->>'import_job_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (tl.payload->>'import_job_id')::uuid
    END AS import_job_id,
    tl.event_type
  FROM public.telemetry_log AS tl
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
WHERE import_job_id IS NOT NULL
GROUP BY import_job_id;

ALTER VIEW public.import_efficiency_metrics
  SET (security_invoker = on);
