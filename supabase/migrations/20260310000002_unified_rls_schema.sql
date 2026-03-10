-- Remediation Migration: Unified RLS & Schema Consistency
-- Adds missing organization_id columns and fixes broken RLS logic from previous migrations.

begin;

-- 1. Ensure all core entities have a direct organization_id for performance and reliability
alter table public.divisions add column if not exists organization_id uuid references organizations(id);
alter table public.teams add column if not exists organization_id uuid references organizations(id);
alter table public.players add column if not exists organization_id uuid references organizations(id);

-- 2. Backfill organization_id from parent hierarchies
-- Backfill divisions from season_settings
update public.divisions d
set organization_id = ss.organization_id
from public.season_settings ss
where d.season_settings_id = ss.id
and d.organization_id is null;

-- Backfill teams from divisions
update public.teams t
set organization_id = d.organization_id
from public.divisions d
where t.division_id = d.id
and t.organization_id is null;

-- Backfill players from divisions
update public.players p
set organization_id = d.organization_id
from public.divisions d
where p.division_id = d.id
and p.organization_id is null;

-- 3. Make organization_id NOT NULL for future constraints (after backfill)
-- Note: In a real environment, we'd verify the backfill before this.
alter table public.divisions alter column organization_id set not null;
alter table public.teams alter column organization_id set not null;
alter table public.players alter column organization_id set not null;

-- 4. Unify RLS Policies using public.is_org_member()
-- This function was defined in 20251215000000_strict_rls_multi_tenancy.sql

-- Teams
drop policy if exists "Admins can do everything on teams" on teams;
drop policy if exists "Strict org access on teams" on teams;
create policy "Unified org access on teams"
  on teams for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- Players
drop policy if exists "Admins can do everything on players" on players;
drop policy if exists "Strict org access on players" on players;
create policy "Unified org access on players"
  on players for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- Divisions
drop policy if exists "Admins can do everything on divisions" on divisions;
drop policy if exists "Strict org access on divisions" on divisions;
create policy "Unified org access on divisions"
  on divisions for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- Coaches (Previously modified in 20260309)
drop policy if exists "Admins can do everything on coaches" on coaches;
drop policy if exists "Strict org access on coaches" on coaches;
create policy "Unified org access on coaches"
  on coaches for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- Locations (Previously modified in 20260309)
drop policy if exists "Admins can do everything on locations" on locations;
drop policy if exists "Strict org access on locations" on locations;
create policy "Unified org access on locations"
  on locations for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

commit;
