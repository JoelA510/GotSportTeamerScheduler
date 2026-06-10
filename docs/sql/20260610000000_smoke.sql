-- Smoke checks for 20260610000000_teaming_rerun_followups.sql

-- 1. teams.assistant_coach_ids exists as uuid[] (ARRAY) and is nullable (NULL = never set).
select 'teams.assistant_coach_ids column' as check,
       data_type,
       udt_name,
       is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'teams'
  and column_name = 'assistant_coach_ids';

-- 2. persist_team_schedule remains SECURITY DEFINER with a pinned search_path.
select 'persist_team_schedule definer + search_path' as check,
       p.prosecdef as is_security_definer,
       p.proconfig as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'persist_team_schedule';

-- 3. get_latest_team_runs_per_division exists and is SECURITY INVOKER
--    (prosecdef = false) so scheduler_runs RLS applies to the caller.
select 'get_latest_team_runs_per_division invoker' as check,
       p.prosecdef as is_security_definer_expect_false,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'get_latest_team_runs_per_division';

-- 4. The helper runs and returns zero rows for a non-existent org (shape check).
select 'latest-runs callable (expect 0 rows)' as check, *
from public.get_latest_team_runs_per_division('00000000-0000-0000-0000-000000000000'::uuid, null);

-- 5. anon cannot execute either function (the 20260603120000 hardening invariant —
--    recreating a function restores PUBLIC EXECUTE unless explicitly re-revoked).
--    Expect both false.
select 'anon revoked' as check,
       has_function_privilege('anon', 'public.persist_team_schedule(jsonb, jsonb, jsonb)', 'EXECUTE') as persist_anon_expect_false,
       has_function_privilege('anon', 'public.get_latest_team_runs_per_division(uuid, uuid)', 'EXECUTE') as latest_runs_anon_expect_false;
