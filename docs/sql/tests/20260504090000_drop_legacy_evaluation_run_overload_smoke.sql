-- Smoke checks for 20260504090000_drop_legacy_evaluation_run_overload.sql.

-- 1. Legacy overload is absent.
SELECT to_regprocedure('public.persist_evaluation_run(uuid,text,jsonb,integer)') AS legacy_overload;
-- Expected: NULL.

-- 2. Current JSONB overload remains, is SECURITY DEFINER, and pins search_path.
SELECT
    p.proname,
    pg_get_function_arguments(p.oid) AS args,
    p.prosecdef,
    p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'persist_evaluation_run'
  AND pg_get_function_identity_arguments(p.oid) = 'p_run_data jsonb, p_findings jsonb, p_metrics jsonb';
-- Expected: 1 row; prosecdef = true; proconfig contains search_path=public.

-- 3. Current JSONB overload call outline. Replace placeholders with a real
-- org-member authenticated user and org/season UUIDs.
--
-- SET LOCAL role = authenticated;
-- SET LOCAL "request.jwt.claims" = '{"sub":"<ORG_MEMBER_USER_UUID>"}';
-- SELECT public.persist_evaluation_run(
--   jsonb_build_object(
--     'organization_id', '<ORG_UUID>',
--     'scheduler_run_type', 'practice',
--     'season_settings_id', '<SEASON_SETTINGS_UUID>',
--     'status', 'completed',
--     'findings_severity', 'none',
--     'metrics_summary', '{}'::jsonb,
--     'input_snapshot', '{}'::jsonb,
--     'execution_time_ms', 1,
--     'created_by', '<ORG_MEMBER_USER_UUID>',
--     'started_at', now(),
--     'completed_at', now()
--   ),
--   '[]'::jsonb,
--   '[]'::jsonb
-- );
-- Expected: UUID of a new public.evaluation_runs row.
