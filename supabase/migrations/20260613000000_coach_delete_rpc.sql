-- Coaches grid: audited bulk delete RPC, mirroring admin_delete_players.
--
-- The /coaches page gains the same row/bulk delete affordance as the
-- Players grid. Per the RPC-enforcement rule the grid never deletes from
-- the coaches table directly; this SECURITY DEFINER function (a)
-- authorizes against org admin membership, (b) scopes to a single
-- organization, (c) cleans up references FKs don't cover, and (d)
-- records an audit event.

BEGIN;

-- 'coach.deleted' must be whitelisted or record_audit_event aborts the
-- delete transaction with a CHECK violation (see 20260611000300).
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

CREATE OR REPLACE FUNCTION public.admin_delete_coaches(p_coach_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_org_count integer;
    v_count integer;
BEGIN
    IF p_coach_ids IS NULL OR array_length(p_coach_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'p_coach_ids must be a non-empty array' USING ERRCODE = '22023';
    END IF;

    SELECT count(DISTINCT organization_id), min(organization_id)
    INTO v_org_count, v_org_id
    FROM public.coaches
    WHERE id = ANY(p_coach_ids);

    IF v_org_count <> 1 THEN
        RAISE EXCEPTION 'coaches must belong to exactly one organization' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(v_org_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_org_id
            USING ERRCODE = '42501';
    END IF;

    -- Head-coach (SET NULL FK) is touched explicitly so updated_at reflects
    -- the unassignment; assistant_coach_ids is a bare uuid[] with no FK and
    -- must be scrubbed by hand or rosters keep pointing at deleted coaches.
    UPDATE public.teams t
       SET coach_id = NULL,
           updated_at = timezone('utc', now())
     WHERE t.coach_id = ANY(p_coach_ids);

    UPDATE public.teams t
       SET assistant_coach_ids = (
               SELECT COALESCE(array_agg(x), '{}'::uuid[])
               FROM unnest(t.assistant_coach_ids) AS x
               WHERE NOT (x = ANY(p_coach_ids))
           ),
           updated_at = timezone('utc', now())
     WHERE t.assistant_coach_ids && p_coach_ids;

    -- coach_interested_programs / coach_team_requests cascade via FK;
    -- preferred_co_coach_id references are SET NULL via FK.
    DELETE FROM public.coaches WHERE id = ANY(p_coach_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;

    PERFORM public.record_audit_event(
        v_org_id,
        'coach.deleted',
        'coach',
        NULL,
        jsonb_build_object('coach_count', v_count, 'coach_ids', to_jsonb(p_coach_ids))
    );

    RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_coaches(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_coaches(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_delete_coaches(uuid[]) IS
  'Audited coach deletion (single org) incl. team head/assistant unassignment; the Coaches grid''s row/bulk delete path.';

COMMIT;
