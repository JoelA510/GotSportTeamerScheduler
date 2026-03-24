-- Phase 1 Security Remediation: Unified RLS with organization_id on all tables
-- Addresses findings C-1, C-2, M-2, and M-3 from the 2026-03-24 security audit.
--
-- Strategy:
--   1. Add organization_id to every table that lacks it.
--   2. Backfill from the closest parent in the hierarchy.
--   3. Drop all stale admin-only and broken policies.
--   4. Replace with a single pattern: is_org_member(organization_id).
--   5. Preserve existing non-admin policies (coach view, parent RSVP, etc.)
--      but rewrite them to use is_org_member() instead of profiles.organization_id.

begin;

-- ============================================================
-- 1. ADD organization_id COLUMNS WHERE MISSING
-- ============================================================

alter table public.field_subunits
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.practice_slots
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.game_slots
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.team_players
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.practice_assignments
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.games
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.staging_players
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.player_buddies
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.scheduler_runs
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.evaluation_runs
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.evaluation_findings
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.evaluation_metrics
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.evaluation_run_events
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.export_jobs
  add column if not exists organization_id uuid references organizations(id) on delete cascade;

alter table public.email_log
  add column if not exists organization_id uuid references organizations(id) on delete cascade;


-- ============================================================
-- 2. BACKFILL organization_id FROM PARENT HIERARCHY
-- ============================================================

-- field_subunits ← fields
update public.field_subunits fs
set organization_id = f.organization_id
from public.fields f
where fs.field_id = f.id
  and fs.organization_id is null;

-- practice_slots ← fields
update public.practice_slots ps
set organization_id = f.organization_id
from public.fields f
where ps.field_id = f.id
  and ps.organization_id is null;

-- game_slots ← fields (preferred) or divisions
update public.game_slots gs
set organization_id = f.organization_id
from public.fields f
where gs.field_id = f.id
  and gs.organization_id is null;

-- team_players ← teams
update public.team_players tp
set organization_id = t.organization_id
from public.teams t
where tp.team_id = t.id
  and tp.organization_id is null;

-- practice_assignments ← teams
update public.practice_assignments pa
set organization_id = t.organization_id
from public.teams t
where pa.team_id = t.id
  and pa.organization_id is null;

-- games ← teams (via home_team_id)
update public.games g
set organization_id = t.organization_id
from public.teams t
where g.home_team_id = t.id
  and g.organization_id is null;

-- staging_players ← import_jobs
update public.staging_players sp
set organization_id = ij.organization_id
from public.import_jobs ij
where sp.import_job_id = ij.id
  and sp.organization_id is null;

-- player_buddies ← players
update public.player_buddies pb
set organization_id = p.organization_id
from public.players p
where pb.player_id = p.id
  and pb.organization_id is null;

-- scheduler_runs ← season_settings
update public.scheduler_runs sr
set organization_id = ss.organization_id
from public.season_settings ss
where sr.season_settings_id = ss.id
  and sr.organization_id is null;

-- evaluation_runs ← scheduler_runs (now has organization_id from above)
update public.evaluation_runs er
set organization_id = sr.organization_id
from public.scheduler_runs sr
where er.scheduler_run_id = sr.id
  and er.organization_id is null;

-- evaluation_findings ← evaluation_runs
update public.evaluation_findings ef
set organization_id = er.organization_id
from public.evaluation_runs er
where ef.evaluation_run_id = er.id
  and ef.organization_id is null;

-- evaluation_metrics ← evaluation_runs
update public.evaluation_metrics em
set organization_id = er.organization_id
from public.evaluation_runs er
where em.evaluation_run_id = er.id
  and em.organization_id is null;

-- evaluation_run_events ← evaluation_runs
update public.evaluation_run_events ere
set organization_id = er.organization_id
from public.evaluation_runs er
where ere.evaluation_run_id = er.id
  and ere.organization_id is null;

-- export_jobs ← season_settings
update public.export_jobs ej
set organization_id = ss.organization_id
from public.season_settings ss
where ej.season_settings_id = ss.id
  and ej.organization_id is null;

-- email_log ← export_jobs (now has organization_id from above)
update public.email_log el
set organization_id = ej.organization_id
from public.export_jobs ej
where el.export_job_id = ej.id
  and el.organization_id is null;


-- ============================================================
-- 3. DROP ALL STALE / BROKEN POLICIES
-- ============================================================

-- field_subunits
drop policy if exists "Admins can do everything on field_subunits" on field_subunits;
drop policy if exists "Organizations can access their own field subunits" on field_subunits;

-- practice_slots
drop policy if exists "Admins can do everything on practice_slots" on practice_slots;

-- game_slots
drop policy if exists "Admins can do everything on game_slots" on game_slots;

-- team_players
drop policy if exists "Admins can do everything on team_players" on team_players;

-- practice_assignments
drop policy if exists "Admins can do everything on practice_assignments" on practice_assignments;
drop policy if exists "Coaches can view their team practices" on practice_assignments;

-- games
drop policy if exists "Admins can do everything on games" on games;

-- staging_players
drop policy if exists "Admins can do everything on staging_players" on staging_players;

-- player_buddies
drop policy if exists "Admins can do everything on player_buddies" on player_buddies;

-- scheduler_runs
drop policy if exists "Authenticated users can manage scheduler_runs" on scheduler_runs;

-- evaluation tables
drop policy if exists "Admins can do everything on evaluation_runs" on evaluation_runs;
drop policy if exists "Admins can do everything on evaluation_findings" on evaluation_findings;
drop policy if exists "Admins can do everything on evaluation_metrics" on evaluation_metrics;
drop policy if exists "Admins can do everything on evaluation_run_events" on evaluation_run_events;

-- export / email
drop policy if exists "Admins can do everything on export_jobs" on export_jobs;
drop policy if exists "Admins can do everything on email_log" on email_log;

-- fields / locations (from facility migration — references nonexistent user_organizations)
drop policy if exists "Organizations can access their own locations" on locations;
drop policy if exists "Organizations can access their own fields" on fields;


-- ============================================================
-- 4. CREATE UNIFIED is_org_member() POLICIES
-- ============================================================

-- field_subunits
create policy "Unified org access on field_subunits"
  on field_subunits for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- practice_slots
create policy "Unified org access on practice_slots"
  on practice_slots for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- game_slots
create policy "Unified org access on game_slots"
  on game_slots for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- team_players
create policy "Unified org access on team_players"
  on team_players for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- practice_assignments
create policy "Unified org access on practice_assignments"
  on practice_assignments for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- Preserve coach view on practice_assignments, now scoped to org
create policy "Coaches can view their team practices"
  on practice_assignments for select to authenticated
  using (
    is_org_member(organization_id)
    and exists (
      select 1
      from public.coach_team_map ctm
      where ctm.team_id = practice_assignments.team_id
        and ctm.coach_user_id = auth.uid()
    )
  );

-- games
create policy "Unified org access on games"
  on games for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- staging_players
create policy "Unified org access on staging_players"
  on staging_players for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- player_buddies
create policy "Unified org access on player_buddies"
  on player_buddies for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- scheduler_runs (preserves creator access, adds org scope)
create policy "Unified org access on scheduler_runs"
  on scheduler_runs for all to authenticated
  using (
    is_org_member(organization_id)
    and (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or created_by = auth.uid()
    )
  )
  with check (
    is_org_member(organization_id)
    and (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      or created_by = auth.uid()
    )
  );

-- evaluation_runs
create policy "Unified org access on evaluation_runs"
  on evaluation_runs for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- evaluation_findings
create policy "Unified org access on evaluation_findings"
  on evaluation_findings for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- evaluation_metrics
create policy "Unified org access on evaluation_metrics"
  on evaluation_metrics for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- evaluation_run_events
create policy "Unified org access on evaluation_run_events"
  on evaluation_run_events for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- export_jobs
create policy "Unified org access on export_jobs"
  on export_jobs for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));

-- email_log
create policy "Unified org access on email_log"
  on email_log for all to authenticated
  using (is_org_member(organization_id))
  with check (is_org_member(organization_id));


-- ============================================================
-- 5. REWRITE COMMUNICATION SCHEMA POLICIES (M-3)
--    Replace broken profiles.organization_id references
--    with is_org_member(organization_id).
-- ============================================================

-- profile_players
drop policy if exists "Users can view their own player mappings" on profile_players;
create policy "Users can view their own player mappings"
  on profile_players for select to authenticated
  using (
    is_org_member(organization_id)
    and (
      profile_id = auth.uid()
      or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    )
  );

-- event_rsvps
drop policy if exists "Admins can access all rsvps" on event_rsvps;
create policy "Admins can access all rsvps"
  on event_rsvps for all to authenticated
  using (
    is_org_member(organization_id)
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  with check (
    is_org_member(organization_id)
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "Users can access team RSVPs" on event_rsvps;
create policy "Users can access team RSVPs"
  on event_rsvps for select to authenticated
  using (
    is_org_member(organization_id)
    and (
      -- Is coach of this team
      auth.uid() in (
        select c.user_id from public.coaches c
        where c.id in (select t.coach_id from public.teams t where t.id = event_rsvps.team_id)
           or c.id = any(select unnest(t.assistant_coach_ids) from public.teams t where t.id = event_rsvps.team_id)
      )
      or
      -- Is parent of a player on this team
      auth.uid() in (
        select pp.profile_id
        from public.profile_players pp
        join public.team_players tp on pp.player_id = tp.player_id
        where tp.team_id = event_rsvps.team_id
      )
    )
  );

drop policy if exists "Parents can insert/update RSVPs for their children" on event_rsvps;
create policy "Parents can insert/update RSVPs for their children"
  on event_rsvps for all to authenticated
  using (
    is_org_member(organization_id)
    and player_id in (select player_id from public.profile_players where profile_id = auth.uid())
  )
  with check (
    is_org_member(organization_id)
    and player_id in (select player_id from public.profile_players where profile_id = auth.uid())
  );

-- team_messages
drop policy if exists "Admins can access all team messages" on team_messages;
create policy "Admins can access all team messages"
  on team_messages for all to authenticated
  using (
    is_org_member(organization_id)
    and (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists "Users can select team messages" on team_messages;
create policy "Users can select team messages"
  on team_messages for select to authenticated
  using (
    is_org_member(organization_id)
    and (
      auth.uid() in (
        select c.user_id from public.coaches c
        where c.id in (select t.coach_id from public.teams t where t.id = team_messages.team_id)
           or c.id = any(select unnest(t.assistant_coach_ids) from public.teams t where t.id = team_messages.team_id)
      )
      or
      auth.uid() in (
        select pp.profile_id
        from public.profile_players pp
        join public.team_players tp on pp.player_id = tp.player_id
        where tp.team_id = team_messages.team_id
      )
    )
  );

drop policy if exists "Users can insert team messages" on team_messages;
create policy "Users can insert team messages"
  on team_messages for insert to authenticated
  with check (
    is_org_member(organization_id)
    and author_id = auth.uid()
    and (
      auth.uid() in (
        select c.user_id from public.coaches c
        where c.id in (select t.coach_id from public.teams t where t.id = team_messages.team_id)
           or c.id = any(select unnest(t.assistant_coach_ids) from public.teams t where t.id = team_messages.team_id)
      )
      or
      auth.uid() in (
        select pp.profile_id
        from public.profile_players pp
        join public.team_players tp on pp.player_id = tp.player_id
        where tp.team_id = team_messages.team_id
      )
    )
  );


-- ============================================================
-- 6. PROPAGATION TRIGGERS
--    Automatically set organization_id on INSERT for child tables
--    so application code doesn't need to supply it explicitly.
-- ============================================================

-- Generic helper: copy org_id from a parent row
create or replace function public.propagate_org_id_from_field()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.field_id is not null then
    select organization_id into new.organization_id
    from fields where id = new.field_id;
  end if;
  return new;
end;
$$;

create or replace function public.propagate_org_id_from_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.team_id is not null then
    select organization_id into new.organization_id
    from teams where id = new.team_id;
  end if;
  return new;
end;
$$;

create or replace function public.propagate_org_id_from_import_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.import_job_id is not null then
    select organization_id into new.organization_id
    from import_jobs where id = new.import_job_id;
  end if;
  return new;
end;
$$;

create or replace function public.propagate_org_id_from_player()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.player_id is not null then
    select organization_id into new.organization_id
    from players where id = new.player_id;
  end if;
  return new;
end;
$$;

create or replace function public.propagate_org_id_from_season_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.season_settings_id is not null then
    select organization_id into new.organization_id
    from season_settings where id = new.season_settings_id;
  end if;
  return new;
end;
$$;

create or replace function public.propagate_org_id_from_scheduler_run()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.scheduler_run_id is not null then
    select organization_id into new.organization_id
    from scheduler_runs where id = new.scheduler_run_id;
  end if;
  return new;
end;
$$;

create or replace function public.propagate_org_id_from_evaluation_run()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.evaluation_run_id is not null then
    select organization_id into new.organization_id
    from evaluation_runs where id = new.evaluation_run_id;
  end if;
  return new;
end;
$$;

create or replace function public.propagate_org_id_from_export_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.export_job_id is not null then
    select organization_id into new.organization_id
    from export_jobs where id = new.export_job_id;
  end if;
  return new;
end;
$$;

create or replace function public.propagate_org_id_from_home_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.organization_id is null and new.home_team_id is not null then
    select organization_id into new.organization_id
    from teams where id = new.home_team_id;
  end if;
  return new;
end;
$$;

-- Apply triggers
drop trigger if exists set_org_id_field_subunits on field_subunits;
create trigger set_org_id_field_subunits
  before insert on field_subunits
  for each row execute function propagate_org_id_from_field();

drop trigger if exists set_org_id_practice_slots on practice_slots;
create trigger set_org_id_practice_slots
  before insert on practice_slots
  for each row execute function propagate_org_id_from_field();

drop trigger if exists set_org_id_game_slots on game_slots;
create trigger set_org_id_game_slots
  before insert on game_slots
  for each row execute function propagate_org_id_from_field();

drop trigger if exists set_org_id_team_players on team_players;
create trigger set_org_id_team_players
  before insert on team_players
  for each row execute function propagate_org_id_from_team();

drop trigger if exists set_org_id_practice_assignments on practice_assignments;
create trigger set_org_id_practice_assignments
  before insert on practice_assignments
  for each row execute function propagate_org_id_from_team();

drop trigger if exists set_org_id_games on games;
create trigger set_org_id_games
  before insert on games
  for each row execute function propagate_org_id_from_home_team();

drop trigger if exists set_org_id_staging_players on staging_players;
create trigger set_org_id_staging_players
  before insert on staging_players
  for each row execute function propagate_org_id_from_import_job();

drop trigger if exists set_org_id_player_buddies on player_buddies;
create trigger set_org_id_player_buddies
  before insert on player_buddies
  for each row execute function propagate_org_id_from_player();

drop trigger if exists set_org_id_scheduler_runs on scheduler_runs;
create trigger set_org_id_scheduler_runs
  before insert on scheduler_runs
  for each row execute function propagate_org_id_from_season_settings();

drop trigger if exists set_org_id_evaluation_runs on evaluation_runs;
create trigger set_org_id_evaluation_runs
  before insert on evaluation_runs
  for each row execute function propagate_org_id_from_scheduler_run();

drop trigger if exists set_org_id_evaluation_findings on evaluation_findings;
create trigger set_org_id_evaluation_findings
  before insert on evaluation_findings
  for each row execute function propagate_org_id_from_evaluation_run();

drop trigger if exists set_org_id_evaluation_metrics on evaluation_metrics;
create trigger set_org_id_evaluation_metrics
  before insert on evaluation_metrics
  for each row execute function propagate_org_id_from_evaluation_run();

drop trigger if exists set_org_id_evaluation_run_events on evaluation_run_events;
create trigger set_org_id_evaluation_run_events
  before insert on evaluation_run_events
  for each row execute function propagate_org_id_from_evaluation_run();

drop trigger if exists set_org_id_export_jobs on export_jobs;
create trigger set_org_id_export_jobs
  before insert on export_jobs
  for each row execute function propagate_org_id_from_season_settings();

drop trigger if exists set_org_id_email_log on email_log;
create trigger set_org_id_email_log
  before insert on email_log
  for each row execute function propagate_org_id_from_export_job();


commit;
