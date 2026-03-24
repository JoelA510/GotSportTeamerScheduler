-- Phase 1.3: Fix registration_forms and registrations RLS policies
-- Addresses finding C-3: policies reference non-existent organization_roles table.
-- Corrects to use organization_members (the actual table) and is_org_member().

begin;

-- ============================================================
-- 1. FIX registration_forms POLICIES
-- ============================================================

-- Drop broken admin policy (references organization_roles)
drop policy if exists "Admins manage forms" on registration_forms;

-- Replace with is_org_member + admin role check
create policy "Admins manage forms"
  on registration_forms for all to authenticated
  using (
    is_org_member(organization_id)
    and exists (
      select 1 from public.organization_members
      where organization_members.profile_id = auth.uid()
        and organization_members.organization_id = registration_forms.organization_id
        and organization_members.role = 'admin'
    )
  )
  with check (
    is_org_member(organization_id)
    and exists (
      select 1 from public.organization_members
      where organization_members.profile_id = auth.uid()
        and organization_members.organization_id = registration_forms.organization_id
        and organization_members.role = 'admin'
    )
  );

-- The "Users view open forms" policy is fine (just checks status = 'open')
-- but we should scope it to organization members for defense in depth
drop policy if exists "Users view open forms" on registration_forms;
create policy "Users view open forms"
  on registration_forms for select to authenticated
  using (
    status = 'open'
    and is_org_member(organization_id)
  );


-- ============================================================
-- 2. FIX registrations POLICIES
-- ============================================================

-- Drop all broken admin policies (reference organization_roles)
drop policy if exists "Admins select registrations" on registrations;
drop policy if exists "Admins update registrations" on registrations;
drop policy if exists "Admins delete registrations" on registrations;

-- Unified admin policy using organization_members
create policy "Admins manage registrations"
  on registrations for all to authenticated
  using (
    is_org_member(organization_id)
    and exists (
      select 1 from public.organization_members
      where organization_members.profile_id = auth.uid()
        and organization_members.organization_id = registrations.organization_id
        and organization_members.role = 'admin'
    )
  )
  with check (
    is_org_member(organization_id)
    and exists (
      select 1 from public.organization_members
      where organization_members.profile_id = auth.uid()
        and organization_members.organization_id = registrations.organization_id
        and organization_members.role = 'admin'
    )
  );

-- Parent insert policy: keep profile_id = auth.uid() check, add org scope
drop policy if exists "Parents insert registrations" on registrations;
create policy "Parents insert registrations"
  on registrations for insert to authenticated
  with check (
    profile_id = auth.uid()
    and is_org_member(organization_id)
  );

-- Parent select own: add org scope
drop policy if exists "Parents select own registrations" on registrations;
create policy "Parents select own registrations"
  on registrations for select to authenticated
  using (
    profile_id = auth.uid()
    and is_org_member(organization_id)
  );

-- Parent update own: add org scope
drop policy if exists "Parents update own registrations" on registrations;
create policy "Parents update own registrations"
  on registrations for update to authenticated
  using (
    profile_id = auth.uid()
    and is_org_member(organization_id)
  );


-- ============================================================
-- 3. FIX REPORTING VIEWS (references organization_roles)
-- ============================================================

-- view_org_metrics references organization_roles — fix to organization_members
create or replace view public.view_org_metrics
with (security_invoker = true)
as
select
    o.id as organization_id,
    o.name as organization_name,
    (select count(id) from public.players p where p.organization_id = o.id) as total_players,
    (select count(id) from public.teams t where t.organization_id = o.id) as total_teams,
    (select count(profile_id) from public.organization_members om where om.organization_id = o.id) as total_users
from public.organizations o;


commit;
