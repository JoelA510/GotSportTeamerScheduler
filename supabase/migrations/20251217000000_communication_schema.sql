-- Milestone 3.2: Communication Schema
-- Creates profile_players, event_rsvps, team_messages, and relevant RLS
-- Refined for strict organization_id enforcement

begin;

-- ==========================================
-- 1. PARENT-TO-PLAYER AUTH MAPPING
-- ==========================================

create table if not exists public.profile_players (
    profile_id uuid references public.profiles(id) on delete cascade not null,
    player_id uuid references public.players(id) on delete cascade not null,
    organization_id uuid references public.organizations(id) on delete cascade not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    primary key (profile_id, player_id)
);

-- RLS: Users can only see their own mappings within their organization
alter table public.profile_players enable row level security;

create policy "Users can view their own player mappings"
    on public.profile_players for select
    to authenticated
    using (
        (profile_id = auth.uid() or ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'))
        and exists (
            select 1
            from public.organization_members om
            where om.organization_id = profile_players.organization_id
              and om.profile_id = auth.uid()
        )
    );

-- ==========================================
-- 2. EVENT RSVPS
-- ==========================================

create table if not exists public.event_rsvps (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid references public.organizations(id) on delete cascade not null,
    team_id uuid references public.teams(id) on delete cascade not null,
    player_id uuid references public.players(id) on delete cascade not null,
    reference_id uuid not null, -- games.id or practice_assignments.id
    event_type text not null check (event_type in ('game', 'practice')),
    occurrence_date date not null,
    status text not null check (status in ('attending', 'declined', 'maybe')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    unique(player_id, reference_id, occurrence_date)
);

alter table public.event_rsvps enable row level security;

-- Admin can do everything within their organization
create policy "Admins can access all rsvps" on public.event_rsvps
    for all to authenticated
    using (
        ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
        and exists (
            select 1
            from public.organization_members om
            where om.organization_id = event_rsvps.organization_id
              and om.profile_id = auth.uid()
        )
    )
    with check (
        ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
        and exists (
            select 1
            from public.organization_members om
            where om.organization_id = event_rsvps.organization_id
              and om.profile_id = auth.uid()
        )
    );

-- Users can access RSVPs for their org, but must be linked to the team_id via coach or profile_players
create policy "Users can access team RSVPs" on public.event_rsvps
    for select to authenticated
    using (
        exists (
            select 1
            from public.organization_members om
            where om.organization_id = event_rsvps.organization_id
              and om.profile_id = auth.uid()
        )
        and (
            -- Is coach of this team
            auth.uid() in (
                select user_id from public.coaches
                where id in (select coach_id from public.teams where id = event_rsvps.team_id)
                or id = any(select unnest(assistant_coach_ids) from public.teams where id = event_rsvps.team_id)
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

create policy "Parents can insert/update RSVPs for their children" on public.event_rsvps
    for all to authenticated
    using (
        exists (
            select 1
            from public.organization_members om
            where om.organization_id = event_rsvps.organization_id
              and om.profile_id = auth.uid()
        )
        and player_id in (select player_id from public.profile_players where profile_id = auth.uid())
    )
    with check (
        exists (
            select 1
            from public.organization_members om
            where om.organization_id = event_rsvps.organization_id
              and om.profile_id = auth.uid()
        )
        and player_id in (select player_id from public.profile_players where profile_id = auth.uid())
    );

-- Trigger to update updated_at
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
    if not exists (select 1 from pg_trigger where tgname = 'trigger_event_rsvps_updated_at') then
        create trigger trigger_event_rsvps_updated_at
          before update on public.event_rsvps
          for each row execute procedure public.set_updated_at();
    end if;
end$$;

-- ==========================================
-- 3. TEAM MESSAGES (CHAT)
-- ==========================================

create table if not exists public.team_messages (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid references public.organizations(id) on delete cascade not null,
    team_id uuid references public.teams(id) on delete cascade not null,
    author_id uuid references public.profiles(id) on delete set null,
    content text not null,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.team_messages enable row level security;

create policy "Admins can access all team messages" on public.team_messages
    for all to authenticated
    using (
        ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
        and exists (
            select 1
            from public.organization_members om
            where om.organization_id = team_messages.organization_id
              and om.profile_id = auth.uid()
        )
    );

create policy "Users can select team messages" on public.team_messages
    for select to authenticated
    using (
        exists (
            select 1
            from public.organization_members om
            where om.organization_id = team_messages.organization_id
              and om.profile_id = auth.uid()
        )
        and (
            -- Is coach of this team
            auth.uid() in (
                select user_id from public.coaches
                where id in (select coach_id from public.teams where id = team_messages.team_id)
                or id = any(select unnest(assistant_coach_ids) from public.teams where id = team_messages.team_id)
            )
            or
            -- Is member of the team
            auth.uid() in (
                select pp.profile_id 
                from public.profile_players pp 
                join public.team_players tp on pp.player_id = tp.player_id
                where tp.team_id = team_messages.team_id
            )
        )
    );

create policy "Users can insert team messages" on public.team_messages
    for insert to authenticated
    with check (
        exists (
            select 1
            from public.organization_members om
            where om.organization_id = team_messages.organization_id
              and om.profile_id = auth.uid()
        )
        and author_id = auth.uid()
        and (
            -- Is coach of this team
            auth.uid() in (
                select user_id from public.coaches
                where id in (select coach_id from public.teams where id = team_messages.team_id)
                or id = any(select unnest(assistant_coach_ids) from public.teams where id = team_messages.team_id)
            )
            or
            -- Is member of the team
            auth.uid() in (
                select pp.profile_id 
                from public.profile_players pp 
                join public.team_players tp on pp.player_id = tp.player_id
                where tp.team_id = team_messages.team_id
            )
        )
    );

-- Add to realtime publication
-- We check if the table is already in the publication to avoid errors
do $$
begin
    if not exists (
        select 1 
        from pg_publication_tables 
        where pubname = 'supabase_realtime' 
        and schemaname = 'public' 
        and tablename = 'team_messages'
    ) then
        alter publication supabase_realtime add table team_messages;
    end if;
end$$;

commit;
