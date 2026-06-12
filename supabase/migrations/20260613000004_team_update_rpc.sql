-- Team edit RPC: rename a team / update its notes from the UI.
--
-- Teams could only be roster-edited or deleted; there was no way to rename
-- one. admin_update_team accepts a whitelist-validated jsonb patch
-- (name, notes) and writes a 'team.updated' audit event. Coach assignment
-- stays on the dedicated admin_assign_team_coach RPC.

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
        'team.saved', 'team.deleted', 'team.updated',
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
-- admin_update_team
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_team(p_team_id uuid, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_team public.teams%ROWTYPE;
    v_key text;
    v_name text;
    v_allowed text[] := ARRAY['name', 'notes'];
BEGIN
    SELECT * INTO v_team FROM public.teams WHERE id = p_team_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'team % not found', p_team_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_org_admin(v_team.organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_team.organization_id
            USING ERRCODE = '42501';
    END IF;

    IF p_patch IS NULL OR p_patch = '{}'::jsonb THEN
        RAISE EXCEPTION 'p_patch must contain at least one field' USING ERRCODE = '22023';
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        IF NOT v_key = ANY (v_allowed) THEN
            RAISE EXCEPTION 'Disallowed patch key: %', v_key USING ERRCODE = '22023';
        END IF;
    END LOOP;

    IF p_patch ? 'name' THEN
        v_name := trim(p_patch->>'name');
        IF v_name IS NULL OR v_name = '' THEN
            RAISE EXCEPTION 'team name must not be empty' USING ERRCODE = '22023';
        END IF;
        IF EXISTS (
            SELECT 1 FROM public.teams
            WHERE division_id = v_team.division_id
              AND name = v_name
              AND id <> p_team_id
        ) THEN
            RAISE EXCEPTION 'a team named "%" already exists in this division', v_name
                USING ERRCODE = '23505';
        END IF;
    END IF;

    UPDATE public.teams
    SET name = CASE WHEN p_patch ? 'name' THEN v_name ELSE name END,
        notes = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE notes END,
        updated_at = now()
    WHERE id = p_team_id;

    PERFORM public.record_audit_event(
        v_team.organization_id,
        'team.updated',
        'teams',
        p_team_id,
        jsonb_build_object('previous_name', v_team.name, 'patch', p_patch)
    );

    RETURN jsonb_build_object('id', p_team_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_team(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_team(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_update_team(uuid, jsonb) IS
  'Audited team rename / notes update for org admins. Whitelisted patch keys: name, notes.';

COMMIT;
