-- Smoke checks for 20260726000200_record_audit_event_authz.sql

-- 1. Function body now references is_org_member and is_org_admin (structural
--    proxy for the authz checks being present). Expect true for both.
select 'record_audit_event body references authz helpers (expect both true)' as check,
       pg_get_functiondef(p.oid) like '%is_org_member%' as references_is_org_member,
       pg_get_functiondef(p.oid) like '%is_org_admin%' as references_is_org_admin
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'record_audit_event';

-- 2. Function body exempts service_role (so Edge-Function fire-and-forget
--    audit writes via _shared/auth.ts's recordAudit() keep working). Expect
--    true.
select 'record_audit_event exempts service_role (expect true)' as check,
       pg_get_functiondef(p.oid) like '%service_role%' as exempts_service_role
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'record_audit_event';

-- 3. authenticated retains EXECUTE (unchanged by this migration). Expect true.
select 'authenticated retains EXECUTE on record_audit_event (expect true)' as check,
       has_function_privilege(
         'authenticated',
         'public.record_audit_event(uuid, text, text, uuid, jsonb, inet)',
         'EXECUTE'
       ) as authenticated_exec;

-- Behavioral (cross-org fabrication denied, non-admin impersonation-audit
-- denied, service-role fire-and-forget still succeeds, in-org member still
-- succeeds) verification lives in the pgTAP suite:
-- supabase/tests/rls_record_audit_event_authz.sql (run via `npm run test:db`),
-- since it needs a real authenticated-role/service-role session.
