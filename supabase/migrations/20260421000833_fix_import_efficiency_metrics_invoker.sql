-- Wave 2 Task 1 (Audit F-2-01): switch import_efficiency_metrics view to SECURITY INVOKER.
--
-- Background: in Postgres, views run with the privileges of their CREATOR by default
-- (`security_definer = on` semantically). Our migration runner is the postgres role,
-- which bypasses RLS — meaning ANY authenticated user querying this view can read
-- telemetry_log rows from organizations they don't belong to.
--
-- Fix: Postgres 15+ supports `ALTER VIEW ... SET (security_invoker = on)`, which
-- re-runs the view as the QUERYING role. RLS on telemetry_log (Wave 1a F-2-08
-- backstop verified by the supabase-performance audit) then enforces org isolation.
--
-- Reversal: see docs/sql/reverts/20260421000833_revert.sql.

ALTER VIEW public.import_efficiency_metrics
  SET (security_invoker = on);

-- Smoke test: re-running this migration is idempotent (security_invoker=on is
-- already set after first apply). No row data touched.
