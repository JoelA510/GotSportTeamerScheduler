-- Route admin medical-clearance updates through a narrow audited RPC.
--
-- /admin/compliance previously updated registrations.medical_cleared directly
-- from the browser and then attempted a separate audit write. Keep the
-- mutation and audit event atomic, and make the organization boundary explicit.

BEGIN;

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
        'compliance.medical_update',
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

CREATE OR REPLACE FUNCTION public.admin_update_registration_medical_status(
    p_organization_id uuid,
    p_registration_id uuid,
    p_medical_cleared boolean,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_registration record;
    v_effective_role text := COALESCE(auth.role(), current_role, '');
    v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
    v_changed boolean;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF p_registration_id IS NULL THEN
        RAISE EXCEPTION 'p_registration_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF p_medical_cleared IS NULL THEN
        RAISE EXCEPTION 'p_medical_cleared is required'
            USING ERRCODE = '23502';
    END IF;

    IF jsonb_typeof(v_metadata) <> 'object' THEN
        RAISE EXCEPTION 'p_metadata must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    IF v_effective_role <> 'service_role' THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'authenticated user is required'
                USING ERRCODE = '42501';
        END IF;

        IF NOT public.is_org_admin(p_organization_id) THEN
            RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT r.id,
           r.organization_id,
           r.form_id,
           r.player_id,
           r.profile_id,
           r.medical_cleared
      INTO v_registration
      FROM public.registrations r
      JOIN public.registration_forms rf
        ON rf.id = r.form_id
       AND rf.organization_id = r.organization_id
     WHERE r.id = p_registration_id
       AND r.organization_id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Registration not found in organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    v_changed := v_registration.medical_cleared IS DISTINCT FROM p_medical_cleared;

    IF v_changed THEN
        UPDATE public.registrations
           SET medical_cleared = p_medical_cleared,
               updated_at = timezone('utc', now())
         WHERE id = p_registration_id
           AND organization_id = p_organization_id;

        PERFORM public.record_audit_event(
            p_organization_id,
            'compliance.medical_update',
            'registration',
            p_registration_id,
            jsonb_build_object(
                'registration_id', p_registration_id,
                'form_id', v_registration.form_id,
                'player_id', v_registration.player_id,
                'profile_id', v_registration.profile_id,
                'previous_status', v_registration.medical_cleared,
                'medical_cleared', p_medical_cleared
            ) || v_metadata
        );
    END IF;

    RETURN jsonb_build_object(
        'registration_id', p_registration_id,
        'organization_id', p_organization_id,
        'medical_cleared', p_medical_cleared,
        'previous_status', v_registration.medical_cleared,
        'changed', v_changed
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_registration_medical_status(uuid, uuid, boolean, jsonb)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_registration_medical_status(uuid, uuid, boolean, jsonb)
    TO service_role;

COMMENT ON FUNCTION public.admin_update_registration_medical_status(uuid, uuid, boolean, jsonb) IS
  'Admin-only medical clearance mutation for registrations with org scoping and audit logging.';

COMMIT;
