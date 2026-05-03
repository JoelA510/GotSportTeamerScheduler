-- Add an explicit deferred-apply lifecycle state for durable imports.
--
-- Coach and field imports already stage rows and apply through dedicated RPCs.
-- This migration lets the UI stop after validation, mark the job ready for
-- operator review, then either apply through the existing finalizer RPCs or
-- cancel without touching domain tables.

BEGIN;

ALTER TABLE public.import_jobs DROP CONSTRAINT IF EXISTS import_jobs_status_check;
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_status_check
    CHECK (status IN (
        'queued',
        'processing',
        'importing',
        'ready_to_apply',
        'completed',
        'completed_with_warnings',
        'needs_fix',
        'failed'
    ));

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
        'import.started',
        'import.validated',
        'import.canceled',
        'import.completed',
        'import.failed',
        'import.rolled_back',
        'team.saved', 'team.deleted',
        'game.saved', 'game.deleted',
        'practice.saved', 'practice.deleted',
        'registration.submitted', 'registration.approved', 'registration.rejected',
        'calendar.token_rotated',
        'member.invited', 'member.removed', 'member.role_changed',
        'settings.updated',
        'feature_flags.updated',
        'export.started', 'export.completed',
        'organization.onboarded',
        'evaluation.run',
        'scheduler.auto_started',
        'scheduler.auto_progress',
        'scheduler.auto_completed',
        'scheduler.auto_failed',
        'coach.status_updated',
        'coach.promoted',
        'team.coach_assigned',
        'team.coach_swapped',
        'team.coach_unassigned'
    ));

CREATE OR REPLACE FUNCTION public.mark_import_job_ready_to_apply(
    p_import_job_id uuid,
    p_import_type text,
    p_validation_errors jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job public.import_jobs%ROWTYPE;
    v_import_type text := lower(NULLIF(btrim(COALESCE(p_import_type, '')), ''));
    v_validation_errors jsonb := COALESCE(p_validation_errors, '[]'::jsonb);
    v_now timestamptz := timezone('utc', now());
    v_staged_rows integer := 0;
    v_result jsonb;
BEGIN
    IF p_import_job_id IS NULL THEN
        RAISE EXCEPTION 'p_import_job_id is required' USING ERRCODE = '22023';
    END IF;

    IF v_import_type NOT IN ('coaches', 'fields') THEN
        RAISE EXCEPTION 'Deferred apply is only available for coach and field imports'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_validation_errors) <> 'array' THEN
        RAISE EXCEPTION 'p_validation_errors must be a jsonb array' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_job
    FROM public.import_jobs
    WHERE id = p_import_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import job % not found', p_import_job_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_admin(v_job.organization_id) THEN
        RAISE EXCEPTION 'Access denied: user is not an admin of organization %', v_job.organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_import_type = 'coaches' AND v_job.job_type <> 'registration' THEN
        RAISE EXCEPTION 'Import job % is %, not registration', p_import_job_id, v_job.job_type
            USING ERRCODE = '22023';
    END IF;

    IF v_import_type = 'fields' AND v_job.job_type <> 'fields' THEN
        RAISE EXCEPTION 'Import job % is %, not fields', p_import_job_id, v_job.job_type
            USING ERRCODE = '22023';
    END IF;

    IF v_job.status = 'failed' THEN
        RAISE EXCEPTION 'Failed import job % cannot be marked ready to apply', p_import_job_id
            USING ERRCODE = '22023';
    END IF;

    IF v_job.status IN ('completed', 'completed_with_warnings') THEN
        RAISE EXCEPTION 'Completed import job % cannot be marked ready to apply', p_import_job_id
            USING ERRCODE = '22023';
    END IF;

    SELECT count(*)
    INTO v_staged_rows
    FROM public.staging_import_rows
    WHERE import_job_id = p_import_job_id
      AND organization_id = v_job.organization_id
      AND import_type = v_import_type;

    v_result := jsonb_build_object(
        'status', 'ready_to_apply',
        'import_type', v_import_type,
        'staged_rows', v_staged_rows,
        'validation_error_rows', jsonb_array_length(v_validation_errors),
        'ready_at', v_now
    );

    UPDATE public.import_jobs
    SET
        status = 'ready_to_apply',
        processed_rows = v_staged_rows,
        progress_percent = 100,
        completed_at = NULL,
        error_summary = jsonb_build_object('rowErrors', v_validation_errors),
        warning_summary = jsonb_set(
            COALESCE(warning_summary, '{}'::jsonb),
            '{deferred_apply}',
            v_result,
            true
        )
    WHERE id = p_import_job_id;

    PERFORM public.record_audit_event(
        v_job.organization_id,
        'import.validated',
        'import_job',
        p_import_job_id,
        v_result
    );

    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_ready_import_job(
    p_import_job_id uuid,
    p_import_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job public.import_jobs%ROWTYPE;
    v_import_type text := lower(NULLIF(btrim(COALESCE(p_import_type, '')), ''));
    v_now timestamptz := timezone('utc', now());
    v_staged_rows integer := 0;
    v_result jsonb;
BEGIN
    IF p_import_job_id IS NULL THEN
        RAISE EXCEPTION 'p_import_job_id is required' USING ERRCODE = '22023';
    END IF;

    IF v_import_type NOT IN ('coaches', 'fields') THEN
        RAISE EXCEPTION 'Deferred apply cancellation is only available for coach and field imports'
            USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_job
    FROM public.import_jobs
    WHERE id = p_import_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import job % not found', p_import_job_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_admin(v_job.organization_id) THEN
        RAISE EXCEPTION 'Access denied: user is not an admin of organization %', v_job.organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_import_type = 'coaches' AND v_job.job_type <> 'registration' THEN
        RAISE EXCEPTION 'Import job % is %, not registration', p_import_job_id, v_job.job_type
            USING ERRCODE = '22023';
    END IF;

    IF v_import_type = 'fields' AND v_job.job_type <> 'fields' THEN
        RAISE EXCEPTION 'Import job % is %, not fields', p_import_job_id, v_job.job_type
            USING ERRCODE = '22023';
    END IF;

    IF v_job.status <> 'ready_to_apply' THEN
        RAISE EXCEPTION 'Import job % is %, not ready_to_apply', p_import_job_id, v_job.status
            USING ERRCODE = '22023';
    END IF;

    SELECT count(*)
    INTO v_staged_rows
    FROM public.staging_import_rows
    WHERE import_job_id = p_import_job_id
      AND organization_id = v_job.organization_id
      AND import_type = v_import_type;

    v_result := jsonb_build_object(
        'status', 'canceled',
        'import_type', v_import_type,
        'staged_rows', v_staged_rows,
        'canceled_at', v_now
    );

    UPDATE public.import_jobs
    SET
        status = 'failed',
        completed_at = v_now,
        error_summary = jsonb_set(
            COALESCE(error_summary, '{}'::jsonb),
            '{deferred_apply}',
            v_result,
            true
        ),
        warning_summary = jsonb_set(
            COALESCE(warning_summary, '{}'::jsonb),
            '{deferred_apply}',
            v_result,
            true
        )
    WHERE id = p_import_job_id;

    PERFORM public.record_audit_event(
        v_job.organization_id,
        'import.canceled',
        'import_job',
        p_import_job_id,
        v_result
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_import_job_ready_to_apply(uuid, text, jsonb)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ready_import_job(uuid, text)
    TO authenticated;

COMMIT;
