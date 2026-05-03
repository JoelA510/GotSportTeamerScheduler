-- Add heartbeat-backed cleanup for stale import jobs.
--
-- Browser-driven chunked imports can be interrupted by refreshes, tab closes, or
-- network failures. Without a heartbeat, the UI can rehydrate an import job that
-- no client worker can resume. This RPC lets org admins fail stale active jobs
-- so operators can retry from a clear state.

BEGIN;

ALTER TABLE public.import_jobs
    ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

UPDATE public.import_jobs
SET last_heartbeat_at = COALESCE(last_heartbeat_at, started_at, created_at)
WHERE last_heartbeat_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_import_jobs_org_status_heartbeat
    ON public.import_jobs (
        organization_id,
        status,
        COALESCE(last_heartbeat_at, started_at, created_at)
    );

CREATE OR REPLACE FUNCTION public.fail_stale_import_jobs(
    p_organization_id uuid,
    p_stale_before timestamptz DEFAULT timezone('utc', now()) - interval '5 minutes'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now timestamptz := timezone('utc', now());
    v_failed_count integer := 0;
    v_failed_job_ids uuid[] := ARRAY[]::uuid[];
    v_result jsonb;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'organization_id is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_stale_before IS NULL THEN
        RAISE EXCEPTION 'stale_before is required'
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Only organization admins can fail stale import jobs'
            USING ERRCODE = '42501';
    END IF;

    WITH stale_jobs AS (
        SELECT
            id,
            status AS previous_status,
            COALESCE(last_heartbeat_at, started_at, created_at) AS heartbeat_at
        FROM public.import_jobs
        WHERE organization_id = p_organization_id
          AND status IN ('queued', 'processing', 'importing')
          AND COALESCE(last_heartbeat_at, started_at, created_at) < p_stale_before
        FOR UPDATE
    ),
    updated_jobs AS (
        UPDATE public.import_jobs job
        SET
            status = 'failed',
            completed_at = v_now,
            error_summary = jsonb_set(
                COALESCE(job.error_summary, '{}'::jsonb),
                '{stale_cleanup}',
                jsonb_build_object(
                    'status', 'failed',
                    'previous_status', stale_jobs.previous_status,
                    'last_heartbeat_at', stale_jobs.heartbeat_at,
                    'stale_before', p_stale_before,
                    'failed_at', v_now,
                    'message', 'Import job stopped sending progress heartbeats and was failed for retry'
                ),
                true
            )
        FROM stale_jobs
        WHERE job.id = stale_jobs.id
        RETURNING job.id
    )
    SELECT
        count(*)::integer,
        COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[])
    INTO v_failed_count, v_failed_job_ids
    FROM updated_jobs;

    v_result := jsonb_build_object(
        'status', 'completed',
        'failed_jobs', v_failed_count,
        'job_ids', to_jsonb(v_failed_job_ids),
        'stale_before', p_stale_before,
        'cleaned_at', v_now
    );

    IF v_failed_count > 0 THEN
        PERFORM public.record_audit_event(
            p_organization_id,
            'import.failed',
            'import_job',
            NULL,
            jsonb_build_object(
                'stage', 'stale_cleanup',
                'failed_jobs', v_failed_count,
                'job_ids', to_jsonb(v_failed_job_ids),
                'stale_before', p_stale_before,
                'cleaned_at', v_now
            )
        );
    END IF;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fail_stale_import_jobs(uuid, timestamptz)
    TO authenticated;

COMMENT ON COLUMN public.import_jobs.last_heartbeat_at IS
    'Last client or worker progress heartbeat for active import jobs. Used to fail stale jobs so operators can retry.';

COMMENT ON FUNCTION public.fail_stale_import_jobs(uuid, timestamptz) IS
    'Admin-only cleanup for active import jobs whose heartbeat is older than the stale cutoff.';

COMMIT;
