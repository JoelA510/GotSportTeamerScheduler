-- Smoke test for migration 20260421000833_fix_import_efficiency_metrics_invoker.sql
--
-- Run as a non-superuser session bound to organization_id = $ORG_A.
-- Expectation: queries to import_efficiency_metrics return ONLY rows whose
-- underlying telemetry_log.organization_id = $ORG_A. Cross-org rows are filtered
-- by the underlying table's RLS now that the view runs as SECURITY INVOKER.
--
-- Manual verification (operator):
--   1. SET LOCAL ROLE authenticated;
--   2. SET LOCAL request.jwt.claim.sub = '<user-uuid-in-ORG_A>';
--   3. SELECT count(*) FROM public.import_efficiency_metrics;
--      -- Should return only rows from ORG_A's import_jobs.
--   4. SET LOCAL request.jwt.claim.sub = '<user-uuid-in-ORG_B>';
--   5. SELECT count(*) FROM public.import_efficiency_metrics;
--      -- Should return only rows from ORG_B's import_jobs.
--   6. The two counts should NOT be equal unless the orgs share the exact same
--      telemetry_log row count by coincidence.
--
-- Post-deploy: run `mcp__supabase__get_advisors --type=security` and confirm
-- F-2-01 (security_definer_view) no longer flags this view.

SELECT
  c.relname,
  pg_catalog.array_to_string(c.reloptions, ', ') AS reloptions
FROM pg_catalog.pg_class c
WHERE c.relname = 'import_efficiency_metrics'
  AND c.relkind = 'v';

-- Expected output: reloptions column contains 'security_invoker=true'.
