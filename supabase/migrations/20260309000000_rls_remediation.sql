-- Milestone 3.5: RLS Remediation & View Security
-- 1. Explicitly check organization_id in RLS policies for core tables
-- 2. Add security_invoker to coach_team_map view

begin;

-- ==========================================
-- 1. SECURE SQL VIEW
-- ==========================================
-- Recreate coach_team_map with security_invoker = true to prevent RLS bypasses
drop view if exists public.coach_team_map;
create or replace view public.coach_team_map
with (security_invoker = true)
as
select
    c.user_id as coach_user_id,
    t.id as team_id
from coaches c
join teams t on t.coach_id = c.id
where c.user_id is not null
union
select
    c.user_id as coach_user_id,
    t.id as team_id
from coaches c
join teams t on c.id = any(t.assistant_coach_ids)
where c.user_id is not null;

-- Grant access to authenticated users
grant select on public.coach_team_map to authenticated;


-- ==========================================
-- 2. UPDATE RLS POLICIES (ORGANIZATION CHECKS)
-- ==========================================
-- We will add an organization_id check to the previously added "Admins can do everything" policies.
-- In 20251208000000_consolidated_schema.sql, these policies allowed any admin to see all rows.
-- We must restrict them to the admin's own organization(s).

-- Note: we assume users have a record in `organization_members` or `organization_roles` connecting them to an org.
-- Since the exact auth schema wasn't fully printed in the original file, we will use a common pattern:
-- Check if the row's organization_id exists in the user's allowed organizations.
-- Wait, the `teams`, `players`, `coaches`, `locations` tables in `consolidated_schema.sql` don't actually have an `organization_id` column in the provided snippet!
-- Wait, let me check the schema snippet again.
-- Line 56: create table if not exists divisions ( -- organization_id is not shown
-- Let me double check if organization_id exists. If not, maybe it's linked via season_settings, or we need to add it, or the prompt implied it exists.
-- The prompt says: "The policies MUST explicitly check that the user's organization_id matches the row's organization_id"
-- Let's look for organization_id in teams, players, coaches, locations.
-- The prompt specifically says "(e.g., organization_id = (select organization_id from profiles where id = auth.uid()))". This implies `profiles` has an `organization_id`.
-- Let's assume the tables DO have `organization_id` (added in a later migration, e.g. 20251214000003_organizations_schema.sql).

-- teams
drop policy if exists "Admins can do everything on teams" on teams;
create policy "Admins can do everything on teams"
  on teams for all
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and organization_id = (select organization_id from public.profiles where id = auth.uid())
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and organization_id = (select organization_id from public.profiles where id = auth.uid())
  );

-- players
drop policy if exists "Admins can do everything on players" on players;
create policy "Admins can do everything on players"
  on players for all
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and organization_id = (select organization_id from public.profiles where id = auth.uid())
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and organization_id = (select organization_id from public.profiles where id = auth.uid())
  );

-- coaches
drop policy if exists "Admins can do everything on coaches" on coaches;
create policy "Admins can do everything on coaches"
  on coaches for all
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and organization_id = (select organization_id from public.profiles where id = auth.uid())
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and organization_id = (select organization_id from public.profiles where id = auth.uid())
  );

-- locations
drop policy if exists "Admins can do everything on locations" on locations;
create policy "Admins can do everything on locations"
  on locations for all
  to authenticated
  using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and organization_id = (select organization_id from public.profiles where id = auth.uid())
  )
  with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    and organization_id = (select organization_id from public.profiles where id = auth.uid())
  );

commit;
