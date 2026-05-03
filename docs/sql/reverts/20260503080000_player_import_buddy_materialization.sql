-- Emergency rollback for 20260503080000_player_import_buddy_materialization.sql.
--
-- This removes the buddy materialization RPC/index. If an app rollback must
-- also undo buddy rows created by a specific import job, run the targeted
-- DELETE below with that job id before dropping the function.

BEGIN;

-- Optional per-job data rollback:
-- DELETE FROM public.player_buddies
-- WHERE source_import_job = '<import-job-id>'::uuid;

DROP FUNCTION IF EXISTS public.materialize_import_buddy_pairs(uuid);

DROP INDEX IF EXISTS public.idx_player_buddies_org_source_import;

COMMIT;
