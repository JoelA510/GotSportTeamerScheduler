-- Smoke checks for 20260906000000_field_effective_dating.sql

-- 1. Columns exist with the right types. Expect two rows, both date.
select 'fields effective columns (expect 2 rows, type date)' as check,
       column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'fields'
  and column_name in ('effective_from', 'effective_to')
order by column_name;

-- 2. The ordering constraint exists. Expect true.
select 'fields_effective_window_check present (expect true)' as check,
       count(*) = 1 as present
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = 'fields'
  and c.conname = 'fields_effective_window_check';

-- 3. Both RPCs are SECURITY DEFINER with a pinned search_path, and gate on
--    is_org_admin. Expect true across the board.
select 'retirement RPCs hardened (expect all true)' as check,
       p.proname,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as search_path_pinned,
       pg_get_functiondef(p.oid) like '%is_org_admin%' as gates_on_admin,
       pg_get_functiondef(p.oid) like '%42501%' as raises_42501
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_retire_field', 'admin_unretire_field')
order by p.proname;

-- 4. PUBLIC has no EXECUTE; authenticated does. Expect false then true.
select 'admin_retire_field grants (expect public false, authenticated true)' as check,
       has_function_privilege('public', 'public.admin_retire_field(uuid, uuid, date, boolean)', 'EXECUTE') as public_exec,
       has_function_privilege('authenticated', 'public.admin_retire_field(uuid, uuid, date, boolean)', 'EXECUTE') as authenticated_exec;

-- 5. Both RPCs audit BEFORE and AFTER, diverging from the four RPCs in
--    20260504060000 which audit only the result. Structural proxy: the body
--    mentions both phases. Expect true for both.
select 'retirement RPCs audit both phases (expect all true)' as check,
       p.proname,
       pg_get_functiondef(p.oid) like '%''phase'', ''before''%' as audits_before,
       pg_get_functiondef(p.oid) like '%''phase'', ''after''%' as audits_after
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_retire_field', 'admin_unretire_field')
order by p.proname;

-- 6. The refusal path is in the RPC, not only in the UI: the body returns
--    retired=false with the affected list when p_confirm is false. Expect true.
select 'admin_retire_field refuses in-RPC (expect both true)' as check,
       pg_get_functiondef(p.oid) like '%NOT p_confirm%' as checks_confirm,
       pg_get_functiondef(p.oid) like '%bookings_after_effective_to%' as names_the_reason
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_retire_field';

-- 7. **THE HAZARD CHECK.** fields.active and fields.effective_to must never
--    disagree. A retired field (effective_to in the past) that is still active,
--    or an active-false field with no effective_to, is the two-columns-one-fact
--    hazard this migration deliberately accepted.
--
--    Expect ZERO rows. Any row here is the hazard having materialised.
select 'fields where active disagrees with effective_to (expect 0 rows)' as check,
       id, organization_id, name, active, effective_to
from public.fields
where (effective_to is not null and effective_to < current_date and active is true)
   or (active is false and effective_to is null);

-- 8. Meta-assertion for check 7: it ran against a non-empty table. A check that
--    matches zero records because there are no records is not a pass.
select 'fields table is non-empty, so check 7 examined something (expect true)' as check,
       count(*) > 0 as has_rows
from public.fields;
