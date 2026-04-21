-- Revert script for migration 20260421000833_fix_import_efficiency_metrics_invoker.sql
--
-- USE WITH CAUTION: this restores the SECURITY DEFINER (default) behavior on the view,
-- which re-introduces the cross-org telemetry leak documented in audit F-2-01.
-- Only run this if a downstream consumer breaks specifically due to the invoker switch.

ALTER VIEW public.import_efficiency_metrics
  SET (security_invoker = off);
