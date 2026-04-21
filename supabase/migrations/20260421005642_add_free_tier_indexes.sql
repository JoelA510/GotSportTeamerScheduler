-- Wave 6b Task 2 (Audit findings SP-01, SP-02, SP-04, SP-05, SP-06, SP-07,
-- SP-08, SP-09): add the hot-path indexes that RLS policies + dashboard
-- queries scan today. Closes free-tier performance risk on multi-tenant
-- growth: each index bounds table scans that otherwise grow O(org_count).
--
-- Coverage:
--   SP-01  scheduler_runs(organization_id, run_type, status, created_at DESC)
--          — dashboard polls every 2s for the latest run; composite prefix
--          (org, type, status) filters + created_at DESC sort.
--   SP-02  scheduler_runs(organization_id, status)
--          — complements SP-01 for queries that filter by status without
--          specifying run_type. A 4-column composite `(org, run_type, status,
--          created_at)` cannot serve `(org, status)` as a prefix because
--          Postgres B-tree prefix matching is left-to-right with no skips
--          (per Gemini review on PR #174); SP-02 is a legitimate separate
--          index, not a subset of SP-01.
--   SP-04  event_rsvps(team_id)
--          — RLS policy joins event_rsvps on team_id; without the index each
--          RSVP check does a seq scan.
--   SP-05  organization_id on 8 tables: divisions, teams, players, coaches,
--          locations, fields, field_subunits, practice_slots (added to each
--          via migration 20260324000000_phase1_rls_unification.sql).
--   SP-06  team_players(team_id, organization_id)
--          — composite match for the canonical "team players in my org" query.
--   SP-07  import_jobs(organization_id, status)
--          — ingest dashboard filters by (org, status) on every paint.
--   SP-08  games(home_team_id) + games(away_team_id)
--          — game schedule + team-schedule-view both filter by either side;
--          Postgres cannot use a single 2-column index for OR, so split.
--   SP-09  practice_slots(organization_id) — covered in SP-05 but called out
--          separately for join-selectivity on facility management.
--
-- Skipped: SP-03 (run_id FK on practice_assignments / game_assignments /
-- schedule_evaluations) requires the 3-step add-nullable → backfill →
-- promote-to-NOT-NULL pattern documented in docs/audits/wave-1a/
-- supabase-performance.md (Gemini review notes). Backfill logic depends on
-- prod data; defer to a separate migration that ships with operator-gated
-- step-2 backfill SQL.
--
-- All indexes use `IF NOT EXISTS` for idempotency. They are NOT created
-- `CONCURRENTLY` because Supabase CLI wraps migrations in a transaction
-- (CONCURRENTLY is incompatible with transactions). Apply during a
-- low-traffic window — table scans during CREATE INDEX lock writes. On a
-- free-tier single-tenant DB the lock window is sub-second per table.
--
-- Revert: docs/sql/reverts/20260421005642_revert.sql.
-- Smoke: docs/sql/tests/20260421005642_smoke.sql.

-- ─────────────────────────────────────────────────────────────
-- SP-01 + SP-02: scheduler_runs
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_scheduler_runs_org_type_status_created
  on public.scheduler_runs (organization_id, run_type, status, created_at desc);

create index if not exists idx_scheduler_runs_org_status
  on public.scheduler_runs (organization_id, status);

-- ─────────────────────────────────────────────────────────────
-- SP-04: event_rsvps(organization_id, team_id)
-- ─────────────────────────────────────────────────────────────
-- Per Gemini PR #174 review: RLS on event_rsvps filters by organization_id.
-- Lead with organization_id so the index serves both the RLS predicate AND
-- the team_id join; a `(team_id)` solo index would force the planner to re-
-- check organization_id post-fetch.

create index if not exists idx_event_rsvps_org_team
  on public.event_rsvps (organization_id, team_id);

-- ─────────────────────────────────────────────────────────────
-- SP-05 + SP-09: organization_id on 8 multi-tenancy tables
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_divisions_organization_id
  on public.divisions (organization_id);

create index if not exists idx_teams_organization_id
  on public.teams (organization_id);

create index if not exists idx_players_organization_id
  on public.players (organization_id);

create index if not exists idx_coaches_organization_id
  on public.coaches (organization_id);

create index if not exists idx_locations_organization_id
  on public.locations (organization_id);

create index if not exists idx_fields_organization_id
  on public.fields (organization_id);

create index if not exists idx_field_subunits_organization_id
  on public.field_subunits (organization_id);

create index if not exists idx_practice_slots_organization_id
  on public.practice_slots (organization_id);

-- ─────────────────────────────────────────────────────────────
-- SP-06: team_players(organization_id, team_id)
-- ─────────────────────────────────────────────────────────────
-- Per Gemini PR #174 review: RLS filters by organization_id first. Ordering
-- the columns as (org, team) lets the index serve BOTH the RLS predicate
-- AND team-scoped lookups via prefix match. The reverse order would only
-- satisfy team lookups but not org-wide summaries.

create index if not exists idx_team_players_org_team
  on public.team_players (organization_id, team_id);

-- ─────────────────────────────────────────────────────────────
-- SP-07: import_jobs(organization_id, status)
-- ─────────────────────────────────────────────────────────────

create index if not exists idx_import_jobs_org_status
  on public.import_jobs (organization_id, status);

-- ─────────────────────────────────────────────────────────────
-- SP-08: games(organization_id, home_team_id) + games(organization_id, away_team_id)
-- ─────────────────────────────────────────────────────────────
-- Per Gemini PR #174 review: RLS filters by organization_id. With org_id
-- leading, the OR query `WHERE home_team_id = X OR away_team_id = X` can
-- still use a BitmapOr across both indices, AND each index separately
-- satisfies the RLS predicate efficiently. Solo (home_team_id) / (away_team_id)
-- indices would force the planner to re-check organization_id per row.

create index if not exists idx_games_org_home_team
  on public.games (organization_id, home_team_id);

create index if not exists idx_games_org_away_team
  on public.games (organization_id, away_team_id);
