-- Schedule + Teams: audited cancel / delete RPCs.
--
-- Game assignments, practice assignments, and teams had no delete path from
-- the UI. These three SECURITY DEFINER functions close that gap.
-- 'team.deleted' is already whitelisted; add 'game.cancelled' and
-- 'practice.cancelled'.

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
        'team.rsvp_updated',
        'team.message_created',
        'game.saved', 'game.deleted', 'game.cancelled',
        'competition.score_updated',
        'practice.saved', 'practice.deleted', 'practice.cancelled',
        'registration.form_created',
        'registration.form_updated',
        'registration.form_deleted',
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
        'coach.deleted',
        'team.coach_assigned',
        'team.coach_swapped',
        'team.coach_unassigned',
        'player.updated',
        'player.bulk_updated',
        'player.created',
        'player.deleted',
        'player.compliance_updated',
        'teams.auto_balanced',
        'divisions.coed_merged',
        'divisions.gender_split',
        'settings.flags_updated',
        'settings.gender_model_updated',
        'impersonation.started',
        'impersonation.ended',
        'auth.password_updated',
        'settings.season_format_updated',
        'settings.season_updated',
        'settings.timezone_updated'
    ));

-- ---------------------------------------------------------------------------
-- admin_cancel_game_assignment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_game_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
BEGIN
    SELECT organization_id INTO v_org_id
    FROM public.game_assignments WHERE id = p_assignment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'game assignment % not found', p_assignment_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_org_admin(v_org_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_org_id
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.game_assignments WHERE id = p_assignment_id;

    PERFORM public.record_audit_event(
        v_org_id,
        'game.cancelled',
        'game_assignments',
        p_assignment_id,
        jsonb_build_object('assignment_id', p_assignment_id)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_cancel_practice_assignment
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_practice_assignment(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
BEGIN
    SELECT organization_id INTO v_org_id
    FROM public.practice_assignments WHERE id = p_assignment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'practice assignment % not found', p_assignment_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_org_admin(v_org_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_org_id
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.practice_assignments WHERE id = p_assignment_id;

    PERFORM public.record_audit_event(
        v_org_id,
        'practice.cancelled',
        'practice_assignments',
        p_assignment_id,
        jsonb_build_object('assignment_id', p_assignment_id)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_delete_team
-- Deletes a team and all cascaded records (team_players, games, practices,
-- rsvps, messages). players.team_id is SET NULL by FK.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_team(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_team public.teams%ROWTYPE;
BEGIN
    SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'team % not found', p_team_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_org_admin(v_team.organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_team.organization_id
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.teams WHERE id = p_team_id;

    PERFORM public.record_audit_event(
        v_team.organization_id,
        'team.deleted',
        'teams',
        p_team_id,
        jsonb_build_object('name', v_team.name, 'division_id', v_team.division_id)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_cancel_game_assignment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_cancel_practice_assignment(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_game_assignment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_cancel_practice_assignment(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_team(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_cancel_game_assignment(uuid) IS
  'Audited game assignment cancellation for org admins.';
COMMENT ON FUNCTION public.admin_cancel_practice_assignment(uuid) IS
  'Audited practice assignment cancellation for org admins.';
COMMENT ON FUNCTION public.admin_delete_team(uuid) IS
  'Audited team deletion (cascades to team_players, games, practices, rsvps, messages) for org admins.';

COMMIT;
