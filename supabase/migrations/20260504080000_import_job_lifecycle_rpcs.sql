-- Route browser-driven import job lifecycle writes through admin-only RPCs.
--
-- The import UI still performs CSV parsing/chunk orchestration in the browser,
-- but import_jobs is now mutated through narrow, org-scoped RPCs instead of a
-- broad member-write RLS policy.

BEGIN;

DROP POLICY IF EXISTS "Strict org access on import_jobs" ON public.import_jobs;

CREATE OR REPLACE FUNCTION public.create_import_job(
    p_organization_id uuid,
    p_import_type text,
    p_file_name text
)
RETURNS public.import_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_import_type text := lower(NULLIF(btrim(COALESCE(p_import_type, '')), ''));
    v_file_name text := btrim(COALESCE(p_file_name, ''));
    v_job_type text;
    v_now timestamptz := timezone('utc', now());
    v_job public.import_jobs%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required to create an import job'
            USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'organization_id is required'
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Only organization admins can create import jobs'
            USING ERRCODE = '42501';
    END IF;

    IF v_import_type NOT IN ('players', 'coaches', 'fields') THEN
        RAISE EXCEPTION 'invalid import type: %', p_import_type
            USING ERRCODE = '22023';
    END IF;

    v_file_name := regexp_replace(v_file_name, '[/\\:]+', '_', 'g');
    IF v_file_name = '' THEN
        RAISE EXCEPTION 'file_name is required'
            USING ERRCODE = '22023';
    END IF;

    IF length(v_file_name) > 512 THEN
        RAISE EXCEPTION 'file_name exceeds 512 characters'
            USING ERRCODE = '22023';
    END IF;

    v_job_type := CASE WHEN v_import_type = 'fields' THEN 'fields' ELSE 'registration' END;

    INSERT INTO public.import_jobs (
        organization_id,
        job_type,
        storage_path,
        status,
        total_rows,
        processed_rows,
        progress_percent,
        last_heartbeat_at,
        created_by,
        started_at
    )
    VALUES (
        p_organization_id,
        v_job_type,
        format('imports/%s/%s', auth.uid(), v_file_name),
        'importing',
        0,
        0,
        0,
        v_now,
        auth.uid(),
        v_now
    )
    RETURNING *
    INTO v_job;

    PERFORM public.record_audit_event(
        p_organization_id,
        'import.started',
        'import_job',
        v_job.id,
        jsonb_build_object(
            'import_type', v_import_type,
            'job_type', v_job_type,
            'file_name', v_file_name,
            'status', 'importing'
        )
    );

    RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_import_job_progress(
    p_import_job_id uuid,
    p_progress_percent integer DEFAULT NULL,
    p_processed_rows integer DEFAULT NULL,
    p_total_rows integer DEFAULT NULL,
    p_efficiency_metadata jsonb DEFAULT NULL
)
RETURNS public.import_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job public.import_jobs%ROWTYPE;
    v_now timestamptz := timezone('utc', now());
BEGIN
    IF p_import_job_id IS NULL THEN
        RAISE EXCEPTION 'p_import_job_id is required'
            USING ERRCODE = '22023';
    END IF;

    IF p_progress_percent IS NOT NULL AND (p_progress_percent < 0 OR p_progress_percent > 100) THEN
        RAISE EXCEPTION 'progress_percent must be between 0 and 100'
            USING ERRCODE = '22023';
    END IF;

    IF p_processed_rows IS NOT NULL AND p_processed_rows < 0 THEN
        RAISE EXCEPTION 'processed_rows cannot be negative'
            USING ERRCODE = '22023';
    END IF;

    IF p_total_rows IS NOT NULL AND p_total_rows < 0 THEN
        RAISE EXCEPTION 'total_rows cannot be negative'
            USING ERRCODE = '22023';
    END IF;

    IF p_efficiency_metadata IS NOT NULL AND jsonb_typeof(p_efficiency_metadata) <> 'object' THEN
        RAISE EXCEPTION 'efficiency_metadata must be a jsonb object'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_job
    FROM public.import_jobs
    WHERE id = p_import_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import job % not found', p_import_job_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_admin(v_job.organization_id) THEN
        RAISE EXCEPTION 'Only organization admins can update import job progress'
            USING ERRCODE = '42501';
    END IF;

    IF v_job.status NOT IN ('queued', 'processing', 'importing') THEN
        RAISE EXCEPTION 'Import job % is %, not active', p_import_job_id, v_job.status
            USING ERRCODE = '22023';
    END IF;

    IF COALESCE(p_processed_rows, v_job.processed_rows, 0) > COALESCE(p_total_rows, v_job.total_rows, 0)
       AND COALESCE(p_total_rows, v_job.total_rows, 0) > 0 THEN
        RAISE EXCEPTION 'processed_rows cannot exceed total_rows'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.import_jobs
    SET
        progress_percent = COALESCE(p_progress_percent, progress_percent),
        processed_rows = COALESCE(p_processed_rows, processed_rows),
        total_rows = COALESCE(p_total_rows, total_rows),
        efficiency_metadata = COALESCE(p_efficiency_metadata, efficiency_metadata),
        last_heartbeat_at = v_now,
        started_at = COALESCE(started_at, v_now)
    WHERE id = p_import_job_id
    RETURNING *
    INTO v_job;

    RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_import_job(
    p_import_job_id uuid,
    p_message text,
    p_error_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS public.import_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job public.import_jobs%ROWTYPE;
    v_previous_status text;
    v_message text := NULLIF(btrim(COALESCE(p_message, '')), '');
    v_error_summary jsonb := COALESCE(p_error_summary, '{}'::jsonb);
    v_now timestamptz := timezone('utc', now());
BEGIN
    IF p_import_job_id IS NULL THEN
        RAISE EXCEPTION 'p_import_job_id is required'
            USING ERRCODE = '22023';
    END IF;

    IF v_message IS NULL THEN
        RAISE EXCEPTION 'failure message is required'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_error_summary) <> 'object' THEN
        RAISE EXCEPTION 'p_error_summary must be a jsonb object'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_job
    FROM public.import_jobs
    WHERE id = p_import_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import job % not found', p_import_job_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_admin(v_job.organization_id) THEN
        RAISE EXCEPTION 'Only organization admins can fail import jobs'
            USING ERRCODE = '42501';
    END IF;

    IF v_job.status IN ('completed', 'completed_with_warnings') THEN
        RAISE EXCEPTION 'Completed import job % cannot be failed', p_import_job_id
            USING ERRCODE = '22023';
    END IF;

    v_previous_status := v_job.status;

    UPDATE public.import_jobs
    SET
        status = 'failed',
        completed_at = v_now,
        last_heartbeat_at = v_now,
        error_summary = jsonb_strip_nulls(
            COALESCE(error_summary, '{}'::jsonb)
            || v_error_summary
            || jsonb_build_object('message', v_message)
        )
    WHERE id = p_import_job_id
    RETURNING *
    INTO v_job;

    PERFORM public.record_audit_event(
        v_job.organization_id,
        'import.failed',
        'import_job',
        p_import_job_id,
        jsonb_build_object(
            'stage', COALESCE(v_error_summary->>'stage', 'client_lifecycle'),
            'previous_status', v_previous_status,
            'message', v_message,
            'failed_at', v_now
        )
    );

    RETURN v_job;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_import_job(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_import_job_progress(uuid, integer, integer, integer, jsonb)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_import_job(uuid, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.create_import_job(uuid, text, text) IS
    'Admin-only import job creation RPC for browser-driven CSV workflows.';
COMMENT ON FUNCTION public.update_import_job_progress(uuid, integer, integer, integer, jsonb) IS
    'Admin-only heartbeat/progress/metadata update RPC for active import jobs.';
COMMENT ON FUNCTION public.fail_import_job(uuid, text, jsonb) IS
    'Admin-only failure transition RPC for active import jobs with import.failed audit metadata.';

COMMIT;
