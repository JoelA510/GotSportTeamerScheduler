-- Smoke checks for 20260602000000_field_availability_finalize_applied_payload_fix.sql

-- 1. Function still exists, is SECURITY DEFINER, and pins search_path.
select 'finalize_field_availability_import_job defined' as check,
       p.prosecdef as security_definer,
       array_to_string(p.proconfig, ',') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_field_availability_import_job';

-- 2. The fix is present: the body no longer inserts an explicit NULL into
--    applied_payload (the buggy rows ended ',NULL,v_now,auth.uid())'; fixed
--    rows end ',''{}''::jsonb,v_now,auth.uid())'). Expect ok = true.
select 'applied_payload null literal removed' as check,
       (position($needle$,NULL,v_now,auth.uid())$needle$ in p.prosrc) = 0) as ok
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_field_availability_import_job';

-- 3. The constraint the fix satisfies (rather than relaxes) is intact:
--    import_application_records.applied_payload stays NOT NULL DEFAULT '{}'.
select 'applied_payload not null default' as check, a.attnotnull as not_null,
       pg_get_expr(d.adbin, d.adrelid) as default_expr
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public' and c.relname = 'import_application_records' and a.attname = 'applied_payload';
