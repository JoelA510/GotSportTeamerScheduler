-- Emergency rollback for 20260503010000_repair_practice_persistence_rpc.sql.
--
-- This removes the repaired UUID/org-scoped practice persistence contract.
-- The prior consolidated RPC cannot be safely restored on the current
-- definitive schema because it used bigint season_settings_id and omitted
-- scheduler_runs.organization_id. Pair this rollback with an application
-- rollback or a replacement compatible RPC before re-enabling practice apply.

DROP FUNCTION IF EXISTS public.persist_practice_schedule(jsonb, jsonb);
DROP INDEX IF EXISTS public.practice_assignments_team_practice_slot_range_unique;
