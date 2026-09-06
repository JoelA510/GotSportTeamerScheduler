-- Smoke checks for 20260906000000_field_effective_dating.sql

-- 1. The column exists with the right type. Expect one row, type date.
--    (Only effective_to: an effective_from with no writer and no reader was
--    dropped from the migration rather than shipped as decoration.)
select 'fields.effective_to column (expect 1 row, type date)' as check,
       column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'fields'
  and column_name in ('effective_from', 'effective_to')  -- effective_from must NOT appear
order by column_name;

-- 2. The partial index on effective_to exists. Expect true.
select 'idx_fields_effective_to present (expect true)' as check,
       count(*) = 1 as present
from pg_indexes
where schemaname = 'public' and tablename = 'fields'
  and indexname = 'idx_fields_effective_to';

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

-- 7. **THE HAZARD CHECK, and it is ONE-DIRECTIONAL.**
--
--    A field retired on a past date must not be active. The converse is NOT
--    asserted: `active = false` with a NULL effective_to is ordinary
--    deactivation through admin_update_field, it predates this migration, and
--    it is a healthy state. The first draft of this check asserted the
--    biconditional and would have reported every pre-existing deactivated
--    field as a defect on a healthy database.
--
--    Expect ZERO rows. Any row here is the invariant having been broken --
--    which should be impossible, since the trigger enforces it on every write
--    rather than trusting the four RPCs that write `active`.
select 'retired fields that are still active (expect 0 rows)' as check,
       id, organization_id, name, active, effective_to
from public.fields
where effective_to is not null
  and effective_to < current_date
  and active is true;

-- 7b. The trigger that makes check 7 impossible to fail exists. Expect true.
select 'fields_retirement_deactivates trigger present (expect true)' as check,
       count(*) = 1 as present
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'fields'
  and t.tgname = 'fields_retirement_deactivates';

-- 7c. Ordinary deactivation is untouched -- reported, not asserted, so a reader
--     can see the state check 7 deliberately does NOT call a defect.
select 'fields deactivated without a retirement date (reported, not asserted)' as check,
       count(*) as deactivated_without_date
from public.fields
where active is false and effective_to is null;

-- 8. **Meta-assertion for check 7, and it measures the RIGHT set.**
--
--    The first draft counted the whole `fields` table, which is non-empty on
--    any real database -- so it reported "check 7 examined something" while
--    check 7's actual subject (fields with a PAST retirement date) was empty.
--    On a freshly migrated database, which is exactly where this runs first,
--    check 7 passed over zero rows and check 8 said that was fine.
--
--    `retired_fields_examined` is the size of check 7's subject. **If it is 0,
--    check 7 was VACUOUS** -- it has not yet been exercised, and that is a fact
--    to report, not a pass. Reported rather than asserted, because a database
--    with no past retirements is a legitimate state on day one.
select 'the subset check 7 actually examined (0 means check 7 was vacuous)' as check,
       count(*) filter (where effective_to is not null and effective_to < current_date)
         as retired_fields_examined,
       count(*) filter (where effective_to is not null) as dated_fields,
       count(*) as all_fields
from public.fields;

-- 8b. Behavioural exercise of the invariant lives in the suite, where a
--     retirement can be created and read back:
--     tests/fieldLifecycleRpcs.test.js. That is what makes check 7 meaningful
--     before any real database has a retirement in it.
