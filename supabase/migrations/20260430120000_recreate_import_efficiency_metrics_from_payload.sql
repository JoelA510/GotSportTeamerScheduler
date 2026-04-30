-- Recreate import_efficiency_metrics to derive import_job_id from telemetry payload.
-- Uses payload->>'import_job_id' cast to uuid and ignores missing/empty values.

CREATE OR REPLACE VIEW public.import_efficiency_metrics AS
SELECT
  (tl.payload->>'import_job_id')::uuid AS import_job_id,
  COUNT(*) FILTER (WHERE tl.event_type = 'import.suggestion_applied') AS suggestions_applied,
  COUNT(*) FILTER (WHERE tl.event_type = 'import.suggestion_received') AS total_suggestions,
  CASE
    WHEN COUNT(*) FILTER (WHERE tl.event_type = 'import.suggestion_received') > 0
      THEN (
        COUNT(*) FILTER (WHERE tl.event_type = 'import.suggestion_applied')::float
        / COUNT(*) FILTER (WHERE tl.event_type = 'import.suggestion_received')::float
      ) * 100
    ELSE 100
  END AS match_rate
FROM public.telemetry_log AS tl
WHERE COALESCE(tl.payload->>'import_job_id', '') <> ''
GROUP BY (tl.payload->>'import_job_id')::uuid;

ALTER VIEW public.import_efficiency_metrics
  SET (security_invoker = on);
