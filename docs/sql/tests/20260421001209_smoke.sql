-- Smoke test for migration 20260421001209_lock_search_path_on_definer_functions.sql
--
-- Manual operator verification:
--
-- 1. Confirm each function now has a pinned search_path:
SELECT
  n.nspname AS schema,
  p.proname AS function,
  pg_get_function_arguments(p.oid) AS args,
  p.proconfig AS config
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'get_reserved_keys',
    'log_schema_change',
    'validate_custom_attributes',
    'check_password_length_on_auth_users',
    'persist_evaluation_run',
    'prune_old_evaluation_runs'
  )
ORDER BY p.proname, args;

-- Expected: every row's `config` column contains the literal string
-- 'search_path=public' (one entry in the proconfig text[] array).
--
-- 2. Post-deploy: run `mcp__supabase__get_advisors --type=security` and confirm
-- F-2-03 (function_search_path_mutable) is no longer flagged for these 6 names.
