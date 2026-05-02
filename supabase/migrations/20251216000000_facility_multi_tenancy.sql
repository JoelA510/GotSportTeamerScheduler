-- Facility Management Multi-Tenancy & Subunit Triggers setup
-- Add organization_id to locations and fields, configure RLS, and add DB trigger for field_subunits

begin;

-- ==========================================
-- 1. ADD COLUMNS AND FOREIGN KEYS
-- ==========================================

-- A. Locations
alter table locations 
add column if not exists organization_id uuid references organizations(id) on delete cascade;

-- If there's existing data, we might need to set a default org, but assuming safe to leave null/manual assignment for now or backfill
-- B. Fields
alter table fields 
add column if not exists organization_id uuid references organizations(id) on delete cascade;


-- ==========================================
-- 2. RLS POLICIES FOR MULTI-TENANCY
-- ==========================================

-- Drop any previous wide-open policies (if they exist beyond the admin ones from 20251208)
drop policy if exists "Admins can do everything on locations" on locations;
drop policy if exists "Organizations can access their own locations" on locations;

create policy "Organizations can access their own locations"
  on locations
  for all
  to authenticated
  using (
    organization_id is null -- Shared/Global facilities
    or organization_id in (
      select organization_id from public.organization_members where profile_id = auth.uid()
    )
    or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  )
  with check (
    organization_id in (
      select organization_id from public.organization_members where profile_id = auth.uid()
    )
    or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  );

drop policy if exists "Admins can do everything on fields" on fields;
drop policy if exists "Organizations can access their own fields" on fields;

create policy "Organizations can access their own fields"
  on fields
  for all
  to authenticated
  using (
    organization_id is null 
    or organization_id in (
      select organization_id from public.organization_members where profile_id = auth.uid()
    )
    or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  )
  with check (
    organization_id in (
      select organization_id from public.organization_members where profile_id = auth.uid()
    )
    or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  );

-- RLS for field_subunits via JOIN
drop policy if exists "Admins can do everything on field_subunits" on field_subunits;
drop policy if exists "Organizations can access their own field subunits" on field_subunits;

create policy "Organizations can access their own field subunits"
  on field_subunits
  for all
  to authenticated
  using (
    field_id in (
      select id from fields 
      where organization_id is null 
         or organization_id in (
           select organization_id from public.organization_members where profile_id = auth.uid()
         )
    )
    or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  )
  with check (
    field_id in (
      select id from fields 
      where organization_id in (
        select organization_id from public.organization_members where profile_id = auth.uid()
      )
    )
    or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  );


-- ==========================================
-- 3. DB TRIGGER FOR FIELD SUBUNITS
-- ==========================================

create or replace function public.handle_field_subunits()
returns trigger
language plpgsql
security definer
as $$
begin
    -- If supports_halves is turned ON
    if new.supports_halves = true then
        -- Ensure 'A' and 'B' subunits exist for this field
        insert into field_subunits (field_id, label)
        values (new.id, 'A'), (new.id, 'B')
        on conflict (field_id, label) do nothing;
    
    -- If supports_halves is turned OFF
    elsif new.supports_halves = false then
        -- Clean up existing subunits for this field
        delete from field_subunits where field_id = new.id;
    end if;

    return new;
end;
$$;

drop trigger if exists trigger_manage_field_subunits on fields;
create trigger trigger_manage_field_subunits
    after insert or update of supports_halves on fields
    for each row
    execute function public.handle_field_subunits();

commit;
