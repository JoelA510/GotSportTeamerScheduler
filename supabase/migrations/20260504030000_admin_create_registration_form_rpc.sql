-- Route registration form creation through an org-admin RPC.
--
-- The routed admin forms page previously inserted registration_forms directly
-- and then attempted a separate audit write with an action that was not in the
-- latest audit constraint. Keep the form row and audit evidence atomic.

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
        'competition.score_updated',
        'practice.saved', 'practice.deleted',
        'registration.form_created',
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

CREATE OR REPLACE FUNCTION public.admin_create_registration_form(
    p_organization_id uuid,
    p_title text,
    p_description text DEFAULT NULL,
    p_season_id uuid DEFAULT NULL,
    p_fields jsonb DEFAULT '[]'::jsonb,
    p_status text DEFAULT 'open',
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_title text := btrim(COALESCE(p_title, ''));
    v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
    v_fields jsonb := COALESCE(p_fields, '[]'::jsonb);
    v_status text := lower(btrim(COALESCE(p_status, 'open')));
    v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
    v_season_org_id uuid;
    v_form public.registration_forms%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authenticated user is required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_title = '' THEN
        RAISE EXCEPTION 'p_title is required'
            USING ERRCODE = '23502';
    END IF;

    IF jsonb_typeof(v_fields) <> 'array' THEN
        RAISE EXCEPTION 'p_fields must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_metadata) <> 'object' THEN
        RAISE EXCEPTION 'p_metadata must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    IF v_status = 'active' THEN
        v_status := 'open';
    END IF;

    IF v_status NOT IN ('draft', 'open', 'closed') THEN
        RAISE EXCEPTION 'invalid registration form status: %', v_status
            USING ERRCODE = '23514';
    END IF;

    IF p_season_id IS NOT NULL THEN
        SELECT ss.organization_id
          INTO v_season_org_id
          FROM public.season_settings ss
         WHERE ss.id = p_season_id;

        IF v_season_org_id IS NULL OR v_season_org_id <> p_organization_id THEN
            RAISE EXCEPTION 'Season settings do not belong to organization %', p_organization_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO public.registration_forms (
        organization_id,
        title,
        description,
        season_id,
        fields,
        status
    )
    VALUES (
        p_organization_id,
        v_title,
        v_description,
        p_season_id,
        v_fields,
        v_status
    )
    RETURNING * INTO v_form;

    PERFORM public.record_audit_event(
        p_organization_id,
        'registration.form_created',
        'registration_form',
        v_form.id,
        jsonb_build_object(
            'form_id', v_form.id,
            'title', v_form.title,
            'season_id', v_form.season_id,
            'field_count', jsonb_array_length(v_form.fields),
            'status', v_form.status
        ) || v_metadata
    );

    RETURN to_jsonb(v_form);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_registration_form(
    uuid,
    text,
    text,
    uuid,
    jsonb,
    text,
    jsonb
) TO authenticated;

COMMENT ON FUNCTION public.admin_create_registration_form(uuid, text, text, uuid, jsonb, text, jsonb) IS
    'Admin-only registration form creation RPC with org/season validation and atomic audit logging.';

COMMIT;
