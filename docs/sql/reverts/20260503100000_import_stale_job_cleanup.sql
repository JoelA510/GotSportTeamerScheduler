-- Emergency rollback for 20260503100000_import_stale_job_cleanup.sql.
--
-- This removes heartbeat-backed stale import cleanup. Pair with an app rollback
-- that stops calling fail_stale_import_jobs before dropping the RPC/column.

BEGIN;

DROP FUNCTION IF EXISTS public.fail_stale_import_jobs(uuid, timestamptz);

DROP INDEX IF EXISTS public.idx_import_jobs_org_status_heartbeat;

ALTER TABLE public.import_jobs
    DROP COLUMN IF EXISTS last_heartbeat_at;

COMMIT;
