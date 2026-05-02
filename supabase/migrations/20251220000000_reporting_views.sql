-- Milestone 3.5: Reporting & Standings Views
-- Creates pre-aggregated views ensuring security_invoker = true so RLS policies are strictly enforced.

begin;

-- 1. Organization Metrics View
-- Aggregates total players, teams, and profiles per organization.
create or replace view public.view_org_metrics
with (security_invoker = true)
as
select 
    o.id as organization_id,
    o.name as organization_name,
    (
        select count(p.id)
        from public.players p
        join public.divisions d on d.id = p.division_id
        join public.season_settings ss on ss.id = d.season_settings_id
        where ss.organization_id = o.id
    ) as total_players,
    (
        select count(t.id)
        from public.teams t
        join public.divisions d on d.id = t.division_id
        join public.season_settings ss on ss.id = d.season_settings_id
        where ss.organization_id = o.id
    ) as total_teams,
    (select count(profile_id) from public.organization_members om where om.organization_id = o.id) as total_users
from public.organizations o;


-- 2. Compliance Stats View
-- Aggregates registrations per form to show total submissions vs cleared.
create or replace view public.view_compliance_stats
with (security_invoker = true)
as
select
    rf.id as form_id,
    rf.organization_id,
    rf.title as form_title,
    count(r.id) as total_registrations,
    count(r.id) filter (where r.waiver_signed = true) as waivers_signed,
    count(r.id) filter (where r.medical_cleared = true) as medical_cleared
from public.registration_forms rf
left join public.registrations r on r.form_id = rf.id
group by rf.id, rf.organization_id, rf.title;


-- 3. Facility Usage View
-- Aggregates total events scheduled per field.
create or replace view public.view_facility_usage
with (security_invoker = true)
as
select
    f.id as field_id,
    f.organization_id,
    f.name as field_name,
    count(pa.id) as practice_count,
    count(g.id) as game_count,
    (count(pa.id) + count(g.id)) as total_events
from public.fields f
left join public.practice_slots ps on ps.field_id = f.id
left join public.practice_assignments pa on pa.practice_slot_id = ps.id
left join public.game_slots gs on gs.field_id = f.id
left join public.games g on g.game_slot_id = gs.id
group by f.id, f.organization_id, f.name;


-- 4. League Standings View
-- Calculates Wins, Losses, Draws, Points, and Goal Differential per team.
create or replace view public.view_league_standings
with (security_invoker = true)
as
with game_results as (
    select 
        id as game_id,
        null::bigint as season_id,
        home_team_id as team_id,
        score_home as goals_for,
        score_away as goals_against,
        case 
            when score_home > score_away then 1 else 0 
        end as win,
        case 
            when score_home < score_away then 1 else 0 
        end as loss,
        case 
            when score_home = score_away then 1 else 0 
        end as draw
    from public.games
    where score_home is not null and score_away is not null
    
    union all
    
    select 
        id as game_id,
        null::bigint as season_id,
        away_team_id as team_id,
        score_away as goals_for,
        score_home as goals_against,
        case 
            when score_away > score_home then 1 else 0 
        end as win,
        case 
            when score_away < score_home then 1 else 0 
        end as loss,
        case 
            when score_away = score_home then 1 else 0 
        end as draw
    from public.games
    where score_home is not null and score_away is not null
)
select 
    t.id as team_id,
    ss.organization_id,
    t.name as team_name,
    t.division_id,
    count(gr.game_id) as games_played,
    coalesce(sum(gr.win), 0) as wins,
    coalesce(sum(gr.loss), 0) as losses,
    coalesce(sum(gr.draw), 0) as draws,
    coalesce(sum(gr.goals_for), 0) as goals_for,
    coalesce(sum(gr.goals_against), 0) as goals_against,
    coalesce(sum(gr.goals_for), 0) - coalesce(sum(gr.goals_against), 0) as goal_differential,
    (coalesce(sum(gr.win), 0) * 3) + coalesce(sum(gr.draw), 0) as points
from public.teams t
join public.divisions d on d.id = t.division_id
join public.season_settings ss on ss.id = d.season_settings_id
left join game_results gr on gr.team_id = t.id
group by t.id, ss.organization_id, t.name, t.division_id;


-- Grant permissions to authenticated users so they can query the views.
-- Standard Supabase practice: grant select on views to authenticated/anon roles.
-- The security_invoker flag will ensure RLS is STILL strictly enforced beneath this layer.
grant select on public.view_org_metrics to authenticated;
grant select on public.view_compliance_stats to authenticated;
grant select on public.view_facility_usage to authenticated;
grant select on public.view_league_standings to authenticated;

commit;
