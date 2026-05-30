-- Smoke checks for 20260530000100_upsert_division_for_import_rpc.sql

-- 1. Function exists, is SECURITY DEFINER, and pins search_path.
select 'upsert_division_for_import defined' as check,
       p.prosecdef as security_definer,
       array_to_string(p.proconfig, ',') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'upsert_division_for_import';

-- 2. Admin guard fires for a non-member caller (run without an authenticated
--    org-admin context). Expect: ERROR "Access denied: admin required ...".
--    (Confirms the function compiles and the permission check is wired.)
select public.upsert_division_for_import(
  gen_random_uuid(), gen_random_uuid(), 'SMOKE — should not insert'
);
