-- Smoke checks for 20260613000000_coach_delete_rpc.sql

-- 1. RPC exists as SECURITY DEFINER with pinned search_path, and anon
--    cannot execute it.
select p.proname,
       p.prosecdef as security_definer,
       array_to_string(p.proconfig, ',') as config,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute_expect_false,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'admin_delete_coaches';

-- 2. 'coach.deleted' is whitelisted in audit_log_action_check.
select pg_get_constraintdef(oid) ilike '%coach.deleted%' as coach_deleted_whitelisted
from pg_constraint
where conname = 'audit_log_action_check';

-- 3. Empty input rejected (expect ERROR 22023).
-- select public.admin_delete_coaches('{}'::uuid[]);
