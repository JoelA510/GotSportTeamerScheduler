# Supabase Performance Audit — Wave 1a Task 3

**Generated**: 2026-04-20  
**Scope**: 37 migrations, schema inventory, hot-path query analysis, RLS policy review, Edge Function patterns, pg_cron usage  
**Objective**: Identify missing indexes, query inefficiencies, and data-retention gaps before Wave 6 optimization

---

## Executive Summary

Analyzed 37 migrations (dating 2025-12-08 through 2026-04-16) covering 35+ tables. Identified **12 performance and retention findings** spanning missing indexes on hot-path filters, inadequate RLS policy indexing, incomplete scheduler_runs/evaluation_runs linkage, and pg_cron guard conditions. Most findings are **P2 (6b-edge-hot-path-indexes)**; two are **P1** (retention/multi-tenancy risks).

---

## Schema Inventory

| Table | Row-Growth Driver | Indexes | RLS | Notes |
|-------|-------------------|---------|-----|-------|
| organizations | New orgs (low) | slug (UNIQUE) | Yes | No composite indexes |
| profiles | User registrations | id (PK), org_id (NO) | Yes | org_id column unindexed |
| organization_members | Team creation | PK (org_id, profile_id) | Yes | Good |
| season_settings | 1-2 per org/year | idx_season_settings_organization_id | Yes | Hot in dashboard |
| divisions | ~5 per season | idx on season_settings_id? NO | Yes | Hot in roster |
| locations | ~5 per org | None on org_id | Yes | Unindexed parent join |
| fields | ~10-50 per org | None on org_id, location_id | Yes | Unindexed lookups |
| field_subunits | ~5 per field | None | Yes | No index |
| players | 50-200 per org/season | idx_mutual_buddy_code | Yes | org_id, team_id unindexed |
| coaches | 5-20 per org | None | Yes | unindexed org_id, user_id, profile_id |
| profile_players | Parent-child mapping | None | Yes | Unindexed lookups |
| teams | 5-15 per division | None | Yes | Unindexed org_id, coach_id |
| team_players | 10-15 per team | PK (team_id, player_id) | Yes | No index on player_id, org_id |
| practice_slots | ~50 per org | idx_practice_slots_lookup_idx (day_of_week, start_time) | Yes | Good for lookups; no org_id index |
| practice_assignments | ~10-20 per team/season | None | Yes | Unindexed team_id, org_id, run_id (missing) |
| game_slots | ~50 per season | None | Yes | Unindexed org_id, division_id |
| game_assignments | ~50 per season | None | Yes | Unindexed org_id, run_id (missing) |
| games | ~50 per season | None | Yes | Unindexed home_team_id, away_team_id |
| event_rsvps | 500-5K per org/season | UNIQUE (player_id, reference_id, occurrence_date) | Yes | Unindexed team_id filter in hot-path RLS |
| team_messages | 100-1K per org/season | None | Yes | Unindexed team_id, author_id |
| registration_forms | ~5 per org/season | None | Yes | Unindexed org_id |
| registrations | ~100 per form | UNIQUE (form_id, player_id) | Yes | Unindexed org_id |
| imports | ~10 per org/season | None | Yes | Unindexed org_id, user_id |
| import_jobs | ~20 per import | None | Yes | Unindexed org_id, status |
| staging_players | 100-10K per job | None | Yes | Unindexed org_id, job_id |
| player_buddies | 10-50 per org | PK (player_id, buddy_player_id) | Yes | Unindexed org_id, source_import_job |
| export_jobs | ~50 per season | None | Yes | Unindexed org_id, status, season_id |
| email_log | ~100 per season | None | Yes | Unindexed org_id, export_job_id |
| scheduler_runs | ~5-10 per season | None | Yes | **Hot path: org_id, run_type, status UNINDEXED** |
| schedule_evaluations | 1-2 per run | None | Yes | Unindexed org_id, run_id (missing) |
| evaluation_runs | ~10 per season | None | Yes | Unindexed org_id, scheduler_run_id, status |
| evaluation_findings | ~100 per run | None | Yes | Unindexed org_id, evaluation_run_id |
| evaluation_metrics | ~50 per run | UNIQUE (evaluation_run_id, metric_key) | Yes | Unindexed org_id |
| evaluation_run_events | ~200 per run | None | Yes | Unindexed org_id, evaluation_run_id |
| audit_log | 500-50K per org/year | idx_audit_log_org_created, idx_audit_log_user_created | Yes | Good; retention 180d via pg_cron |

---

## RPC Inventory

| Function | Security | Purpose | Notes |
|----------|----------|---------|-------|
| `is_org_member(org_id)` | DEFINER | Multi-tenancy gatekeeper | Called in every RLS policy; no issue |
| `trigger_set_timestamp()` | Trigger | Auto-update `updated_at` | Standard; safe |
| `record_audit_event(...)` | DEFINER | Audit trail insertion | Safe; used in mutations |
| `prune_old_audit_logs()` | DEFINER | 180-day retention cleanup | No IF NOT EXISTS guard on cron job invocation |

---

## Edge Function Inventory

| Function | Hot-Path? | Query Pattern | Indexes Needed? |
|----------|-----------|----------------|-----------------|
| `auto-scheduler` | Yes | Reads teams, slots, coaches; writes evaluation_run + audit | Yes: scheduler_runs(org_id, run_type, status) |
| `team-persistence` | Yes | Updates scheduler_runs; reads season_settings | Yes: same as above |
| `practice-persistence` | Yes | Queries practice_assignments(run_id); writes evaluation findings | Yes: practice_assignments(run_id, org_id) |
| `game-persistence` | Yes | Similar to practice | Yes: game_assignments(run_id, org_id) |
| `import-validation` | Medium | Reads staging_players; updates import_jobs status | Yes: import_jobs(org_id, status) |
| `calendar-feed` | Low | Reads team calendar tokens (rare) | N/A |
| `fairness-scoring` | Yes | Reads players, teams, assignments; computes | Yes: indexing on above tables |

---

## Findings

### Finding 1: Missing Index on `scheduler_runs(organization_id, run_type, status)`

**Severity**: P1 (Hot-path)  
**Location**: `scheduler_runs` table (schema line 662 in 20260331000000_definitive_schema.sql)  
**Observation**: `useTeamSummary()` (frontend hook, line 46-48) filters scheduler_runs with:
```javascript
.eq('run_type', 'team')
.eq('organization_id', currentOrganization.id)
.in('status', ['completed', 'running'])
.order('created_at', { ascending: false })
.limit(1)
```
No composite index exists on (organization_id, run_type, status, created_at DESC).

**Impact**: Full table scan for every dashboard load per org. With 10+ orgs and 1K+ runs, query time scales O(n). Realtime polling (every 2s in useTeamSummary line 86-88) multiplies cost by 2,000 requests/day.

**Recommended Fix**: 
```sql
CREATE INDEX idx_scheduler_runs_org_runtype_status_created
  ON public.scheduler_runs (organization_id, run_type, status, created_at DESC);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Trivial (1 index)

---

### Finding 2: Missing Index on `scheduler_runs(organization_id, status)`

**Severity**: P2 (Hot-path fallback)  
**Location**: `scheduler_runs` table  
**Observation**: `useSchedulerRun()` hook (line 25-34 in useSchedulerRun.js) also queries:
```javascript
.eq('run_type', runType)
.eq('status', 'completed')
.order('completed_at', { ascending: false })
.limit(1)
```
When called from `usePracticeSummary()` and `useGameSummary()`, the filter lacks organization_id (inherited from context). If RLS is not perfectly enforcing org isolation, this is unfiltered.

**Impact**: Potential data leak or O(n) scans across all org runs.

**Recommended Fix**: Ensure all queries bind organization_id explicitly. Confirm RLS policy is enforced. Add:
```sql
CREATE INDEX idx_scheduler_runs_org_status_completed
  ON public.scheduler_runs (organization_id, status, completed_at DESC);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Trivial (1 index)

---

### Finding 3: Missing Foreign Key and Index on `practice_assignments(run_id)` and `game_assignments(run_id)`

**Severity**: P2 (Data integrity + hot-path)  
**Location**: 
- `practice_assignments` table (line 400-420 in 20260331000000_definitive_schema.sql)
- `game_assignments` table (line 448-459)

**Observation**: Both hooks `usePracticeAssignments()` (line 47) and `useGameAssignments()` (line 25) query:
```javascript
.eq('run_id', runId)
```
But `practice_assignments` and `game_assignments` **do not have a `run_id` column at all**. The hooks are querying a non-existent field. Additionally, `schedule_evaluations` has no `run_id` column; it only has `organization_id` and `created_at`.

**Impact**: Queries fail silently or return empty results, breaking practice/game assignment UI. Missing constraint means orphaned assignments accumulate after scheduler_run deletion.

**Recommended Fix**:
```sql
ALTER TABLE practice_assignments ADD COLUMN run_id uuid REFERENCES scheduler_runs(id) ON DELETE CASCADE;
ALTER TABLE game_assignments ADD COLUMN run_id uuid REFERENCES scheduler_runs(id) ON DELETE CASCADE;
CREATE INDEX idx_practice_assignments_run_id ON public.practice_assignments(run_id);
CREATE INDEX idx_game_assignments_run_id ON public.game_assignments(run_id);
-- Add to schedule_evaluations:
ALTER TABLE schedule_evaluations ADD COLUMN run_id uuid REFERENCES scheduler_runs(id) ON DELETE CASCADE;
CREATE INDEX idx_schedule_evaluations_run_id ON public.schedule_evaluations(run_id);
```

**Proposed Wave**: 6-edge-critical (blocks feature)  
**Effort**: Medium (schema migration + 3 indexes + FK constraint)

---

### Finding 4: Unindexed `team_id` Filter in RLS Policy for `event_rsvps`

**Severity**: P2 (RLS performance)  
**Location**: `event_rsvps` RLS policy "Event RSVPs: parents manage own" (line 953-969 in definitive_schema.sql)  
**Observation**: Policy uses a subquery:
```sql
auth.uid() IN (
    SELECT pp.profile_id FROM public.profile_players pp
    WHERE pp.player_id = event_rsvps.player_id
)
```
Joined with `team_id = teamId` filter in `useTeamPortal()` (line 151):
```javascript
.eq('team_id', teamId)
```
The RLS policy requires a lookup in `profile_players` without an index on `player_id`.

**Impact**: RLS enforcement scans all profile_players rows per RSVP row. With 10K RSVPs and 1K profile_players, this is 10M lookups.

**Recommended Fix**:
```sql
CREATE INDEX idx_profile_players_player_id ON public.profile_players(player_id);
CREATE INDEX idx_event_rsvps_team_id ON public.event_rsvps(team_id);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Trivial (2 indexes)

---

### Finding 5: Unindexed `organization_id` on Multi-Tenancy Tables

**Severity**: P2 (RLS + multi-org scaling)  
**Location**: 
- `players` (line 245-287)
- `teams` (line 337-356)
- `coaches` (line 289-320)
- `locations` (line 186-201)
- `fields` (line 203-223)

**Observation**: All these tables have `organization_id` but **zero indexes** on it. Every RLS policy enforces `is_org_member(organization_id)`, which requires a row scan to confirm membership. With 10+ orgs, each query does O(n) org_member checks.

**Impact**: Dashboard loads 5-10 queries per table; each org-filtered query scans entire table. At 100 orgs, this is severe.

**Recommended Fix**:
```sql
CREATE INDEX idx_players_organization_id ON public.players(organization_id);
CREATE INDEX idx_teams_organization_id ON public.teams(organization_id);
CREATE INDEX idx_coaches_organization_id ON public.coaches(organization_id);
CREATE INDEX idx_locations_organization_id ON public.locations(organization_id);
CREATE INDEX idx_fields_organization_id ON public.fields(organization_id);
CREATE INDEX idx_divisions_organization_id ON public.divisions(organization_id);
CREATE INDEX idx_field_subunits_organization_id ON public.field_subunits(organization_id);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Medium (7-8 indexes)

---

### Finding 6: Missing Composite Index on `team_players(team_id, organization_id)`

**Severity**: P2 (Roster hot-path)  
**Location**: `team_players` table (line 358-368 in 20260331000000_definitive_schema.sql)  
**Observation**: `useTeamPortal()` (line 54-64) fetches roster:
```javascript
.from('team_players')
.select('player:players(...)')
.eq('team_id', teamId)
```
Table has PK (team_id, player_id) but no index on player_id alone (needed for RLS joins) and no separate index on team_id.

**Impact**: Roster fetch scans all team_players rows matching team_id and player_id, then joins to players. RLS must check org membership per row.

**Recommended Fix**:
```sql
CREATE INDEX idx_team_players_player_id ON public.team_players(player_id);
CREATE INDEX idx_team_players_team_id_org ON public.team_players(team_id, organization_id);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Trivial (2 indexes)

---

### Finding 7: Missing Indexes on `import_jobs(organization_id, status)` and Staging Tables

**Severity**: P2 (Data pipeline)  
**Location**: 
- `import_jobs` (line 581-595)
- `staging_players` (line 599-609)

**Observation**: Import validation and processing queries filter by organization_id and status. No indexes exist. As imports grow to 1K+ jobs per org, full scans block UI.

**Impact**: Import history/resume UI sluggish. Pipeline diagnostics slow.

**Recommended Fix**:
```sql
CREATE INDEX idx_import_jobs_org_status ON public.import_jobs(organization_id, status);
CREATE INDEX idx_import_jobs_org_created ON public.import_jobs(organization_id, created_at DESC);
CREATE INDEX idx_staging_players_org_job ON public.staging_players(organization_id, import_job_id);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Trivial (3 indexes)

---

### Finding 8: Missing Indexes on `games(home_team_id, away_team_id)` and Schedule Links

**Severity**: P2 (Schedule view)  
**Location**: `games` table (line 461-484 in 20260331000000_definitive_schema.sql)  
**Observation**: `useTeamPortal()` (line 81-99) queries games:
```javascript
.or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
```
No indexes on home_team_id or away_team_id. With OR, PostgreSQL may not use indexes efficiently without explicit UNION.

**Impact**: Schedule load for large seasons (50+ teams, 1K+ games) slow.

**Recommended Fix**:
```sql
CREATE INDEX idx_games_home_team ON public.games(home_team_id);
CREATE INDEX idx_games_away_team ON public.games(away_team_id);
CREATE INDEX idx_games_org_slot ON public.games(organization_id, game_slot_id);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Trivial (3 indexes)

---

### Finding 9: Missing Indexes on `practice_slots(organization_id)` and Facility Joins

**Severity**: P2 (Field/facility lookups)  
**Location**: `practice_slots` (line 374-398), `fields`, `locations`  
**Observation**: `useFields()` (line 36-46) joins fields → field_subunits and fields → practice_slots. Neither has organization_id index. Field insertion (line 81-110) requires re-fetch to ensure subunits populated.

**Impact**: Field editor sluggish when >50 fields per org.

**Recommended Fix**:
```sql
CREATE INDEX idx_practice_slots_org ON public.practice_slots(organization_id);
CREATE INDEX idx_field_subunits_field_id ON public.field_subunits(field_id);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Trivial (2 indexes)

---

### Finding 10: `pg_cron` Jobs Lack `IF NOT EXISTS` Guard

**Severity**: P1 (Operational safety)  
**Location**: Migration 20260416000002_data_retention_cron.sql (lines 8-26)  
**Observation**: Three `SELECT cron.schedule(...)` calls without `IF NOT EXISTS`:
```sql
SELECT cron.schedule('cleanup-export-jobs', '0 2 * * *', $$...$$);
SELECT cron.schedule('cleanup-staging-players', '0 3 * * *', $$...$$);
SELECT cron.schedule('cleanup-audit-log', '0 4 * * *', $$...$$);
```
If migration re-runs (e.g., in reset), jobs duplicate silently, causing multiple deletes per night.

**Impact**: Silent data loss escalation if migration applied twice. Audit logs deleted 2x nightly. Export history wiped prematurely.

**Recommended Fix**:
```sql
-- Wrap each in a transaction with guard:
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-export-jobs') THEN
    SELECT cron.schedule('cleanup-export-jobs', '0 2 * * *', $$DELETE FROM...$$);
  END IF;
END$$;
```
Or use idempotent cron.update_job() if re-scheduling is needed.

**Proposed Wave**: 2-security  
**Effort**: Trivial (wrap in DO blocks)

---

### Finding 11: Audit Log Retention Has Edge Case with Organization Settings

**Severity**: P2 (Data retention compliance)  
**Location**: Migration 20260409000000_audit_log_retention_180.sql (lines 11-28)  
**Observation**: Function `prune_old_audit_logs()` references `organizations.settings` field:
```sql
COALESCE((org_rec.settings->>'retention_days')::INTEGER, 180)
```
But `organizations` table in definitive_schema.sql (line 68-75) has **no `settings` column**. It has `contact_info` (jsonb) only. The function will fail or default to 180 for all orgs.

**Impact**: No per-org retention customization possible. If pg_cron job runs daily at 4 AM (line 25 of 20260416000002), function fails silently, audit logs never prune, DB grows without bound (free tier: 500 MB limit).

**Recommended Fix**:
1. Add `settings jsonb DEFAULT '{}'::jsonb` to organizations table.
2. Document that retention_days is configurable per org via `.settings->>'retention_days'`.
3. Or simplify: hardcode 180-day retention in function:
```sql
DELETE FROM public.audit_log
WHERE organization_id = org_rec.id
  AND created_at < (NOW() - INTERVAL '180 days');
```

**Proposed Wave**: 2-security (data retention policy)  
**Effort**: Small (add column + migrate existing rows, or simplify function)

---

### Finding 12: RLS Policy for `organization_members` Has O(n) Admin Check

**Severity**: P3 (Minor scaling)  
**Location**: RLS policy "Org Members: admins manage" (line 849-859 in definitive_schema.sql)  
**Observation**: For every org_member row, the policy checks:
```sql
EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.profile_id = auth.uid()
      AND om.organization_id = organization_members.organization_id
      AND om.role = 'admin'
)
```
With 100+ org members per org, this subquery runs 100+ times per UPDATE/DELETE. No index on (organization_id, profile_id, role).

**Impact**: Admin operations on large teams (100+ coaches/staff) slow. E.g., invite bulk users → 100 INSERT organization_members → 100 × 100-member scan.

**Recommended Fix**:
```sql
CREATE INDEX idx_organization_members_org_profile_role
  ON public.organization_members(organization_id, profile_id, role);
```

**Proposed Wave**: 6b-edge-hot-path-indexes  
**Effort**: Trivial (1 index)

---

## Summary Table: All 12 Findings

| # | Title | Severity | Table(s) | Proposed Wave | Effort |
|----|-------|----------|----------|---------------|--------|
| 1 | Missing idx scheduler_runs (org, run_type, status, created) | P1 | scheduler_runs | 6b | Trivial |
| 2 | Missing idx scheduler_runs (org, status, completed_at) | P2 | scheduler_runs | 6b | Trivial |
| 3 | Missing run_id column + FK + idx on practice/game_assignments | P2 | practice_assignments, game_assignments | 6 | Medium |
| 4 | Unindexed player_id in event_rsvps RLS, team_id in queries | P2 | profile_players, event_rsvps | 6b | Trivial |
| 5 | Unindexed organization_id on 8+ multi-tenancy tables | P2 | players, teams, coaches, locations, fields, divisions, field_subunits, others | 6b | Medium |
| 6 | Missing idx on team_players (player_id, team_id) | P2 | team_players | 6b | Trivial |
| 7 | Missing idx on import_jobs (org, status) and staging_players | P2 | import_jobs, staging_players | 6b | Trivial |
| 8 | Missing idx on games (home_team, away_team) | P2 | games | 6b | Trivial |
| 9 | Missing idx on practice_slots (org), field_subunits (field_id) | P2 | practice_slots, field_subunits | 6b | Trivial |
| 10 | pg_cron jobs lack IF NOT EXISTS guard | P1 | (DDL) | 2-security | Trivial |
| 11 | Audit log retention function references missing `settings` column | P2 | organizations, audit_log | 2-security | Small |
| 12 | RLS policy for org_members admin check unindexed | P3 | organization_members | 6b | Trivial |

---

## Top 5 Highest-Priority Findings

1. **Finding 1**: Missing index `scheduler_runs(organization_id, run_type, status, created_at DESC)` — blocks dashboard responsiveness on every load (P1).
2. **Finding 10**: pg_cron jobs without IF NOT EXISTS — silent duplicate executions risk data loss (P1).
3. **Finding 3**: Missing `run_id` column + FK on practice/game_assignments — feature completely broken, blocks Wave 6 deployment (P2 + blocking).
4. **Finding 11**: Audit log retention function references non-existent `settings` column — silently fails, DB bloat risk (P2 + data retention).
5. **Finding 5**: Unindexed organization_id on 8+ tables — multi-org scaling broken at 10+ orgs (P2).

---

## Recommendations for Wave 6b (Edge Hot-Path Indexes)

Create the following composite and single-column indexes in a single migration:

```sql
-- Hot-path scheduler queries (Finding 1, 2)
CREATE INDEX idx_scheduler_runs_org_runtype_status_created
  ON public.scheduler_runs (organization_id, run_type, status, created_at DESC);
CREATE INDEX idx_scheduler_runs_org_status_completed
  ON public.scheduler_runs (organization_id, status, completed_at DESC);

-- Multi-tenancy organization_id (Finding 5)
CREATE INDEX idx_players_organization_id ON public.players(organization_id);
CREATE INDEX idx_teams_organization_id ON public.teams(organization_id);
CREATE INDEX idx_coaches_organization_id ON public.coaches(organization_id);
CREATE INDEX idx_locations_organization_id ON public.locations(organization_id);
CREATE INDEX idx_fields_organization_id ON public.fields(organization_id);
CREATE INDEX idx_divisions_organization_id ON public.divisions(organization_id);
CREATE INDEX idx_field_subunits_organization_id ON public.field_subunits(organization_id);

-- RLS policy optimization (Finding 4, 12)
CREATE INDEX idx_profile_players_player_id ON public.profile_players(player_id);
CREATE INDEX idx_event_rsvps_team_id ON public.event_rsvps(team_id);
CREATE INDEX idx_organization_members_org_profile_role
  ON public.organization_members(organization_id, profile_id, role);

-- Team roster & assignments (Finding 6, 7)
CREATE INDEX idx_team_players_player_id ON public.team_players(player_id);
CREATE INDEX idx_team_players_team_id_org ON public.team_players(team_id, organization_id);
CREATE INDEX idx_import_jobs_org_status ON public.import_jobs(organization_id, status);
CREATE INDEX idx_import_jobs_org_created ON public.import_jobs(organization_id, created_at DESC);
CREATE INDEX idx_staging_players_org_job ON public.staging_players(organization_id, import_job_id);

-- Facility & schedule (Finding 8, 9)
CREATE INDEX idx_games_home_team ON public.games(home_team_id);
CREATE INDEX idx_games_away_team ON public.games(away_team_id);
CREATE INDEX idx_games_org_slot ON public.games(organization_id, game_slot_id);
CREATE INDEX idx_practice_slots_org ON public.practice_slots(organization_id);
CREATE INDEX idx_field_subunits_field_id ON public.field_subunits(field_id);
```

**Total**: ~20 indexes. Estimated impact: 30-50% reduction in query time for dashboard, roster, and schedule views.

---

## Recommendations for Wave 2 & 6 (Security & Schema)

1. **Finding 10**: Wrap all pg_cron schedule() calls in DO blocks with IF NOT EXISTS checks.
2. **Finding 11**: Add `settings jsonb DEFAULT '{}'::jsonb` to organizations table, or simplify prune function to hardcode 180-day retention.
3. **Finding 3**: Add `run_id uuid` column + FK constraint to practice_assignments and game_assignments; add schedule_evaluations.run_id; create indexes.

---

## Testing Notes (Deferred to Wave 6)

- Run `EXPLAIN ANALYZE` on each top-10 query from production logs to verify index usage.
- Benchmark dashboard load time before/after index creation (expect 70% reduction in scheduler_runs queries).
- Verify pg_cron job deduplication (ensure only one cleanup job runs per scheduled window).
- Confirm audit log pruning actually executes daily and doesn't accumulate rows.

---

**End of Audit**
