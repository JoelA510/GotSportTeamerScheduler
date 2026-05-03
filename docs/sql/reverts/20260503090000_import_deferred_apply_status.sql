-- Emergency rollback for 20260503090000_import_deferred_apply_status.sql.
--
-- This removes the deferred-apply helper RPCs and restores the prior import
-- job/audit action constraints. Any job still waiting in ready_to_apply is
-- moved to needs_fix so the old status constraint can be restored safely.
-- Validation/cancel audit rows are remapped to import.failed with metadata so
-- the previous audit action constraint can be restored without data loss.

BEGIN;

UPDATE public.import_jobs
SET
    status = 'needs_fix',
    completed_at = COALESCE(completed_at, timezone('utc', now())),
    warning_summary = jsonb_set(
        COALESCE(warning_summary, '{}'::jsonb),
        '{deferred_apply_rollback}',
        jsonb_build_object(
            'status', 'reverted',
            'message', 'ready_to_apply was removed by emergency rollback'
        ),
        true
    )
WHERE status = 'ready_to_apply';

DROP FUNCTION IF EXISTS public.cancel_ready_import_job(uuid, text);
DROP FUNCTION IF EXISTS public.mark_import_job_ready_to_apply(uuid, text, jsonb);

UPDATE public.audit_log
SET
    metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{deferred_apply_rollback}',
        jsonb_build_object('previous_action', action),
        true
    ),
    action = 'import.failed'
WHERE action IN ('import.validated', 'import.canceled');

ALTER TABLE public.import_jobs DROP CONSTRAINT IF EXISTS import_jobs_status_check;
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_status_check
    CHECK (status IN (
        'queued',
        'processing',
        'importing',
        'completed',
        'completed_with_warnings',
        'needs_fix',
        'failed'
    ));

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
        'import.started', 'import.completed', 'import.failed', 'import.rolled_back',
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

COMMIT;
