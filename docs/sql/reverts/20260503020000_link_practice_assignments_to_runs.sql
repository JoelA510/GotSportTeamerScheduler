-- Emergency rollback for 20260503020000_link_practice_assignments_to_runs.sql.
--
-- This removes the practice assignment -> scheduler_runs link introduced for
-- refresh-safe practice apply flows, then replays the previous compatible
-- practice persistence RPC from 20260503010000. Pair this database rollback
-- with an application rollback that does not depend on practice_assignments.run_id.

\set ON_ERROR_STOP on

BEGIN;

DROP FUNCTION IF EXISTS public.persist_practice_schedule(jsonb, jsonb);

DROP INDEX IF EXISTS public.idx_practice_assignments_org_run_id;

ALTER TABLE public.practice_assignments
    DROP CONSTRAINT IF EXISTS practice_assignments_run_id_fkey,
    DROP COLUMN IF EXISTS run_id;

COMMIT;

\ir ../../../supabase/migrations/20260503010000_repair_practice_persistence_rpc.sql
