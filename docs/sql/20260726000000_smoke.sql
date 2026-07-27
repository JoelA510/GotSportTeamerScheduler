-- Smoke checks for 20260726000000_drop_stale_broad_write_policies.sql

-- 1. The three stale broad ALL policies are gone. Expect zero rows.
select 'stale broad write policies (expect zero rows)' as check,
       schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('teams', 'coaches', 'locations')
  and policyname in (
    'Unified org access on teams',
    'Unified org access on coaches',
    'Unified org access on locations'
  );

-- 2. The narrow SELECT-only replacement policies are still present on each
--    table (they predate this migration and are untouched by it). Expect
--    exactly one row per table.
select 'narrow SELECT policy present per table (expect 1 row per table)' as check,
       tablename, count(*) as select_policy_count
from pg_policies
where schemaname = 'public'
  and tablename in ('teams', 'coaches', 'locations')
  and cmd = 'SELECT'
group by tablename
order by tablename;

-- 3. No table in this set has a residual FOR ALL / write-capable policy for
--    the `authenticated` role. Expect zero rows.
select 'residual write-capable policy for authenticated (expect zero rows)' as check,
       tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('teams', 'coaches', 'locations')
  and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  and 'authenticated' = any(roles);

-- Behavioral (non-admin org member denied a direct write) verification lives
-- in the pgTAP suite: supabase/tests/rls_stale_broad_write_policies_removed.sql
-- (run via `npm run test:db`), since it needs a real authenticated-role
-- session to exercise RLS, which this static-catalog smoke script cannot do.
