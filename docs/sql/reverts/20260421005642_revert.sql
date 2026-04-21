-- Revert script for migration 20260421005642_add_free_tier_indexes.sql
--
-- USE WITH CAUTION: dropping these indexes restores the O(n) RLS + dashboard
-- query performance documented in audit findings SP-01 through SP-09. Only
-- run if a specific index is demonstrably harming write throughput (which
-- is extremely unlikely at free-tier row counts).

drop index if exists public.idx_scheduler_runs_org_type_status_created;
drop index if exists public.idx_scheduler_runs_org_status;

drop index if exists public.idx_event_rsvps_team_id;

drop index if exists public.idx_divisions_organization_id;
drop index if exists public.idx_teams_organization_id;
drop index if exists public.idx_players_organization_id;
drop index if exists public.idx_coaches_organization_id;
drop index if exists public.idx_locations_organization_id;
drop index if exists public.idx_fields_organization_id;
drop index if exists public.idx_field_subunits_organization_id;
drop index if exists public.idx_practice_slots_organization_id;

drop index if exists public.idx_team_players_team_org;

drop index if exists public.idx_import_jobs_org_status;

drop index if exists public.idx_games_home_team_id;
drop index if exists public.idx_games_away_team_id;
