-- Smoke checks for 20260906000100_field_blackouts.sql

-- 1. Table exists with RLS enabled, and the select policy is scoped to members
--    rather than USING (true). Expect true, true, and one policy.
select 'field_blackouts RLS (expect rls true)' as check,
       c.relrowsecurity as rls_enabled
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'field_blackouts';

select 'field_blackouts policies (expect 1 select policy, no USING (true))' as check,
       pol.polname,
       pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
       pg_get_expr(pol.polqual, pol.polrelid) <> 'true' as not_permissive_true
from pg_policy pol
join pg_class c on c.oid = pol.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'field_blackouts';

-- 2. The scope rule is enforced by the database, not only by the RPC.
--    **Expect FIVE rows, not four.** The first draft said four and forgot that
--    the inline `reason IN (...)` CHECK is named field_blackouts_reason_check
--    and matches this pattern too -- so a correct run returned 5 and an
--    operator reading the header would have concluded the migration was wrong.
select 'field_blackouts constraints (expect 5 rows)' as check, c.conname
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public' and t.relname = 'field_blackouts'
  and c.conname like 'field_blackouts_%check'
order by c.conname;

-- 3. The freeze is stated on the old table where a schema reader sees it.
--    Expect true.
select 'field_blackout_windows carries the freeze comment (expect true)' as check,
       obj_description('public.field_blackout_windows'::regclass, 'pg_class') like 'FROZEN as of 20260906000100%' as frozen_comment;

-- 4. **THE SINGLE READER.** field_closures exists, is security_invoker, and
--    unions both tables. Expect true across the board.
select 'field_closures is the single reader (expect all true)' as check,
       count(*) = 1 as view_exists,
       bool_or(c.reloptions::text like '%security_invoker=true%') as security_invoker
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'field_closures';

select 'field_closures unions both tables (expect both true)' as check,
       pg_get_viewdef('public.field_closures'::regclass) like '%field_blackouts%' as reads_new,
       pg_get_viewdef('public.field_closures'::regclass) like '%field_blackout_windows%' as reads_old;

-- 5. **The import path still works end to end.** This is the check the ruling
--    asked for: repointing was rejected, so the existing importer must be
--    provably untouched. The live definition of the finalize RPC still writes
--    field_blackout_windows and does NOT write field_blackouts.
--    Expect true then false.
select 'finalize_field_availability_import_job still writes the old table (expect true, false)' as check,
       pg_get_functiondef(p.oid) like '%INSERT INTO public.field_blackout_windows%' as writes_old,
       pg_get_functiondef(p.oid) like '%INSERT INTO public.field_blackouts%' as writes_new
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_field_availability_import_job';

-- 6. ... and the shipped nested-embed read path is intact: the FK PostgREST
--    needs to embed field_blackout_windows under field_availability_profiles
--    still exists. Expect true. (useFields.js:58 depends on this.)
select 'profile -> blackout FK intact for the nested embed (expect true)' as check,
       count(*) = 1 as fk_present
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_class r on r.oid = c.confrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'field_blackout_windows'
  and r.relname = 'field_availability_profiles'
  and c.contype = 'f';

-- 7. Blackout RPCs hardened the same way as everything else. Expect all true.
select 'blackout RPCs hardened (expect all true)' as check,
       p.proname,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as search_path_pinned,
       pg_get_functiondef(p.oid) like '%is_org_admin%' as gates_on_admin,
       pg_get_functiondef(p.oid) like '%42501%' as raises_42501,
       pg_get_functiondef(p.oid) like '%''phase'', ''before''%' as audits_before,
       pg_get_functiondef(p.oid) like '%''phase'', ''after''%' as audits_after
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_create_field_blackout', 'admin_delete_field_blackout')
order by p.proname;

-- 8. Grants. Expect public false, authenticated true, for both.
select 'blackout RPC grants (expect public false, authenticated true)' as check,
       has_function_privilege('public', 'public.admin_create_field_blackout(uuid, uuid, uuid, date, date, integer, integer, text, text)', 'EXECUTE') as create_public,
       has_function_privilege('authenticated', 'public.admin_create_field_blackout(uuid, uuid, uuid, date, date, integer, integer, text, text)', 'EXECUTE') as create_authenticated,
       has_function_privilege('public', 'public.admin_delete_field_blackout(uuid, uuid)', 'EXECUTE') as delete_public,
       has_function_privilege('authenticated', 'public.admin_delete_field_blackout(uuid, uuid)', 'EXECUTE') as delete_authenticated;

-- 9. **The unattributable-closure count, counting what it claims.**
--
--    The first draft counted every row with a NULL field_id, which swept in
--    every legitimate SITE-WIDE admin blackout -- those have no field by
--    design. The number offered as the evidence for keeping two tables was
--    therefore dominated by correct rows.
--
--    The defect is import-derived windows whose PROFILE resolved to no field:
--    closures that exist, display under the profile in the UI, and are
--    invisible to every field-scoped query. That is the import arm, and only
--    the import arm.
--
--    Reported, not asserted -- it is evidence for a decision, not a gate.
select 'import closures no field-scoped query can attribute (the unification blocker)' as check,
       count(*) filter (
         where source = 'field_blackout_windows' and closes_field_id is null
       ) as unattributable_import_closures,
       count(*) filter (where source = 'field_blackout_windows') as import_closures,
       count(*) filter (
         where source = 'field_blackouts' and closes_location_id is not null
       ) as site_wide_admin_closures,
       count(*) as total
from public.field_closures;

-- 9b. The view's scope columns and its derived column are distinct facts, and
--     the scope rule survives the union: every admin row closes exactly one of
--     a site or a field. Expect 0 rows.
select 'closures whose scope is neither or both (expect 0 rows)' as check,
       id, source, closes_location_id, closes_field_id
from public.field_closures
where source = 'field_blackouts'
  and num_nonnulls(closes_location_id, closes_field_id) <> 1;
