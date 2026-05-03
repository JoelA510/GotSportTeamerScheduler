-- Add admin-only coach operational mutation RPCs.
--
-- The /coaches page was intentionally read-only when player-import coach
-- leads shipped. Production operators now need a narrow, auditable surface for
-- promoting/statusing coaches and assigning/replacing team head coaches without
-- direct client table writes.

BEGIN;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
        'import.started', 'import.completed', 'import.failed',
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

CREATE OR REPLACE FUNCTION public.admin_update_coach_status(
    p_organization_id uuid,
    p_coach_id uuid,
    p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status text;
    v_assigned_team_count integer;
    v_action text;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF p_coach_id IS NULL THEN
        RAISE EXCEPTION 'p_coach_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF p_status IS NULL OR p_status NOT IN ('active', 'pending-confirmation', 'inactive', 'interested') THEN
        RAISE EXCEPTION 'invalid coach status: %', p_status
            USING ERRCODE = '23514';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    SELECT c.status
      INTO v_old_status
      FROM public.coaches c
     WHERE c.id = p_coach_id
       AND c.organization_id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Coach not found in organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    SELECT count(*)
      INTO v_assigned_team_count
      FROM public.teams t
     WHERE t.organization_id = p_organization_id
       AND t.coach_id = p_coach_id;

    IF p_status IN ('inactive', 'interested') AND v_assigned_team_count > 0 THEN
        RAISE EXCEPTION 'Cannot set an assigned coach to status %', p_status
            USING ERRCODE = '23514';
    END IF;

    IF v_old_status IS DISTINCT FROM p_status THEN
        UPDATE public.coaches
           SET status = p_status,
               updated_at = timezone('utc', now())
         WHERE id = p_coach_id
           AND organization_id = p_organization_id;

        v_action := CASE
            WHEN v_old_status = 'interested' AND p_status = 'active' THEN 'coach.promoted'
            ELSE 'coach.status_updated'
        END;

        PERFORM public.record_audit_event(
            p_organization_id,
            v_action,
            'coach',
            p_coach_id,
            jsonb_build_object(
                'coach_id', p_coach_id,
                'previous_status', v_old_status,
                'status', p_status,
                'assigned_team_count', v_assigned_team_count
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'coach_id', p_coach_id,
        'organization_id', p_organization_id,
        'previous_status', v_old_status,
        'status', p_status,
        'changed', v_old_status IS DISTINCT FROM p_status
    );
END;
$$;

COMMENT ON FUNCTION public.admin_update_coach_status(uuid, uuid, text) IS
    'Admin-only coach lifecycle update RPC with org scoping and audit logging.';

GRANT EXECUTE ON FUNCTION public.admin_update_coach_status(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_assign_team_coach(
    p_organization_id uuid,
    p_team_id uuid,
    p_coach_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_previous_coach_id uuid;
    v_coach_status text;
    v_can_coach_multiple_teams boolean;
    v_existing_assignment_count integer;
    v_action text;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF p_team_id IS NULL THEN
        RAISE EXCEPTION 'p_team_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    SELECT t.coach_id
      INTO v_previous_coach_id
      FROM public.teams t
     WHERE t.id = p_team_id
       AND t.organization_id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Team not found in organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF p_coach_id IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(
            hashtextextended(p_organization_id::text || ':' || p_coach_id::text, 0)
        );

        SELECT c.status, c.can_coach_multiple_teams
          INTO v_coach_status, v_can_coach_multiple_teams
          FROM public.coaches c
         WHERE c.id = p_coach_id
           AND c.organization_id = p_organization_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Coach not found in organization %', p_organization_id
                USING ERRCODE = '42501';
        END IF;

        IF COALESCE(v_coach_status, '') NOT IN ('active', 'pending-confirmation') THEN
            RAISE EXCEPTION 'Coach % must be active or pending-confirmation before assignment', p_coach_id
                USING ERRCODE = '23514';
        END IF;

        SELECT count(*)
          INTO v_existing_assignment_count
          FROM public.teams t
         WHERE t.organization_id = p_organization_id
           AND t.coach_id = p_coach_id
           AND t.id <> p_team_id;

        IF NOT COALESCE(v_can_coach_multiple_teams, false)
           AND v_existing_assignment_count > 0 THEN
            RAISE EXCEPTION 'Coach % is already assigned to another team', p_coach_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF v_previous_coach_id IS NOT DISTINCT FROM p_coach_id THEN
        RETURN jsonb_build_object(
            'team_id', p_team_id,
            'organization_id', p_organization_id,
            'previous_coach_id', v_previous_coach_id,
            'coach_id', p_coach_id,
            'changed', false
        );
    END IF;

    UPDATE public.teams
       SET coach_id = p_coach_id,
           updated_at = timezone('utc', now())
     WHERE id = p_team_id
       AND organization_id = p_organization_id;

    v_action := CASE
        WHEN p_coach_id IS NULL THEN 'team.coach_unassigned'
        WHEN v_previous_coach_id IS NULL THEN 'team.coach_assigned'
        ELSE 'team.coach_swapped'
    END;

    PERFORM public.record_audit_event(
        p_organization_id,
        v_action,
        'team',
        p_team_id,
        jsonb_build_object(
            'team_id', p_team_id,
            'previous_coach_id', v_previous_coach_id,
            'coach_id', p_coach_id
        )
    );

    RETURN jsonb_build_object(
        'team_id', p_team_id,
        'organization_id', p_organization_id,
        'previous_coach_id', v_previous_coach_id,
        'coach_id', p_coach_id,
        'changed', true
    );
END;
$$;

COMMENT ON FUNCTION public.admin_assign_team_coach(uuid, uuid, uuid) IS
    'Admin-only team head coach assignment RPC with org scoping, serialized single-team capacity checks, and audit logging.';

GRANT EXECUTE ON FUNCTION public.admin_assign_team_coach(uuid, uuid, uuid) TO authenticated;

COMMIT;
