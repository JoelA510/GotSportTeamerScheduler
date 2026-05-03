-- Emergency rollback for 20260503030000_repair_game_persistence_rpc.sql.
--
-- This removes the repaired game persistence contract and the current-schema
-- columns added to game_assignments. The prior state had no compatible
-- persist_game_schedule RPC, so pair this rollback with an application rollback
-- or a replacement compatible RPC before re-enabling game apply.

\set ON_ERROR_STOP on

BEGIN;

DROP FUNCTION IF EXISTS public.persist_game_schedule(jsonb, jsonb);

DROP INDEX IF EXISTS public.game_assignments_matchup_slot_week_unique;
DROP INDEX IF EXISTS public.idx_game_assignments_org_slot_week;
DROP INDEX IF EXISTS public.idx_game_assignments_org_run_id;

ALTER TABLE public.game_assignments
    DROP CONSTRAINT IF EXISTS game_assignments_slot_alias_match,
    DROP CONSTRAINT IF EXISTS game_assignments_away_team_id_fkey,
    DROP CONSTRAINT IF EXISTS game_assignments_home_team_id_fkey,
    DROP CONSTRAINT IF EXISTS game_assignments_field_id_fkey,
    DROP CONSTRAINT IF EXISTS game_assignments_slot_id_fkey,
    DROP CONSTRAINT IF EXISTS game_assignments_game_slot_id_fkey,
    DROP CONSTRAINT IF EXISTS game_assignments_run_id_fkey,
    DROP COLUMN IF EXISTS assignment_source,
    DROP COLUMN IF EXISTS "end",
    DROP COLUMN IF EXISTS start,
    DROP COLUMN IF EXISTS week_index,
    DROP COLUMN IF EXISTS division,
    DROP COLUMN IF EXISTS away_team_id,
    DROP COLUMN IF EXISTS home_team_id,
    DROP COLUMN IF EXISTS field_id,
    DROP COLUMN IF EXISTS slot_id,
    DROP COLUMN IF EXISTS game_slot_id,
    DROP COLUMN IF EXISTS run_id;

COMMIT;
