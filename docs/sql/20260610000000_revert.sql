-- Revert for 20260610000000_teaming_rerun_followups.sql
--
-- Order matters: the column drop must come AFTER the function body is restored
-- to the pre-migration version, because the 20260610 body references
-- teams.assistant_coach_ids and would break for in-flight callers the moment
-- the column disappears.
--
-- Step 1 — restore the prior persist_team_schedule body by re-applying the
-- previous migration in full (kept verbatim in the repo; do NOT hand-edit):
--
--   supabase/migrations/20260503040000_repair_team_persistence_rpc.sql
--
-- (psql: \i supabase/migrations/20260503040000_repair_team_persistence_rpc.sql)

-- Step 2 — drop the per-division latest-run helper.
DROP FUNCTION IF EXISTS public.get_latest_team_runs_per_division(uuid, uuid);

-- Step 3 — drop the assistant ids column (destroys any persisted assistant
-- lists; they remain recoverable from scheduler_runs.results JSON snapshots).
ALTER TABLE public.teams DROP COLUMN IF EXISTS assistant_coach_ids;
