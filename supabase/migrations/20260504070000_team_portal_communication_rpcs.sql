-- Route team portal RSVP and message writes through scoped RPCs.
--
-- TeamPortal previously upserted event_rsvps and inserted team_messages
-- directly from the browser. Keep participant checks server-side, preserve
-- existing read access, and record metadata-only audit rows for mutations.

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

DROP POLICY IF EXISTS "Event RSVPs: parents manage own" ON public.event_rsvps;
DROP POLICY IF EXISTS "Admins can access all rsvps" ON public.event_rsvps;
DROP POLICY IF EXISTS "Parents can insert/update RSVPs for their children" ON public.event_rsvps;

DROP POLICY IF EXISTS "Team Messages: members access" ON public.team_messages;
DROP POLICY IF EXISTS "Admins can access all team messages" ON public.team_messages;
DROP POLICY IF EXISTS "Users can insert team messages" ON public.team_messages;

CREATE POLICY "Team Messages: members access"
    ON public.team_messages FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.upsert_team_event_rsvp(
    p_team_id uuid,
    p_player_id uuid,
    p_reference_id uuid,
    p_event_type text,
    p_occurrence_date date,
    p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_org_id uuid;
    v_reference_allowed boolean := false;
    v_existing public.event_rsvps%ROWTYPE;
    v_rsvp public.event_rsvps%ROWTYPE;
    v_changed boolean := false;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT organization_id
      INTO v_org_id
      FROM public.teams
     WHERE id = p_team_id;

    IF v_org_id IS NULL OR NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Team is outside the caller organization'
            USING ERRCODE = '42501';
    END IF;

    IF p_event_type NOT IN ('game', 'practice') THEN
        RAISE EXCEPTION 'event_type must be game or practice'
            USING ERRCODE = '22023';
    END IF;

    IF p_status NOT IN ('attending', 'declined', 'maybe') THEN
        RAISE EXCEPTION 'status must be attending, declined, or maybe'
            USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
          FROM public.players p
          JOIN public.team_players tp
            ON tp.player_id = p.id
           AND tp.team_id = p_team_id
         WHERE p.id = p_player_id
           AND p.organization_id = v_org_id
           AND tp.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Player is outside the requested team'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_org_admin(v_org_id)
       AND NOT EXISTS (
           SELECT 1
             FROM public.profile_players pp
            WHERE pp.profile_id = v_user_id
              AND pp.player_id = p_player_id
              AND pp.organization_id = v_org_id
       ) THEN
        RAISE EXCEPTION 'Caller cannot manage RSVP for this player'
            USING ERRCODE = '42501';
    END IF;

    IF p_event_type = 'game' THEN
        SELECT EXISTS (
            SELECT 1
              FROM public.games g
             WHERE g.id = p_reference_id
               AND g.organization_id = v_org_id
               AND (g.home_team_id = p_team_id OR g.away_team_id = p_team_id)
        )
          INTO v_reference_allowed;
    ELSE
        SELECT EXISTS (
            SELECT 1
              FROM public.practice_assignments pa
             WHERE pa.id = p_reference_id
               AND pa.organization_id = v_org_id
               AND pa.team_id = p_team_id
               AND p_occurrence_date <@ pa.effective_date_range
        )
          INTO v_reference_allowed;
    END IF;

    IF NOT v_reference_allowed THEN
        RAISE EXCEPTION 'Event reference is outside the requested team'
            USING ERRCODE = '42501';
    END IF;

    SELECT *
      INTO v_existing
      FROM public.event_rsvps
     WHERE player_id = p_player_id
       AND reference_id = p_reference_id
       AND occurrence_date = p_occurrence_date;

    INSERT INTO public.event_rsvps (
        organization_id,
        team_id,
        player_id,
        reference_id,
        event_type,
        occurrence_date,
        status,
        updated_at
    )
    VALUES (
        v_org_id,
        p_team_id,
        p_player_id,
        p_reference_id,
        p_event_type,
        p_occurrence_date,
        p_status,
        timezone('utc', now())
    )
    ON CONFLICT (player_id, reference_id, occurrence_date)
    DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        team_id = EXCLUDED.team_id,
        event_type = EXCLUDED.event_type,
        status = EXCLUDED.status,
        updated_at = timezone('utc', now())
    RETURNING *
      INTO v_rsvp;

    v_changed := v_existing.id IS NULL OR v_existing.status IS DISTINCT FROM v_rsvp.status;

    IF v_changed THEN
        INSERT INTO public.audit_log (
            organization_id,
            user_id,
            action,
            resource_type,
            resource_id,
            metadata
        )
        VALUES (
            v_org_id,
            v_user_id,
            'team.rsvp_updated',
            'event_rsvp',
            v_rsvp.id,
            jsonb_build_object(
                'team_id', p_team_id,
                'player_id', p_player_id,
                'reference_id', p_reference_id,
                'event_type', p_event_type,
                'occurrence_date', p_occurrence_date,
                'previous_status', v_existing.status,
                'status', v_rsvp.status
            )
        );
    END IF;

    RETURN jsonb_build_object(
        'rsvp', to_jsonb(v_rsvp),
        'changed', v_changed
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_team_message(
    p_team_id uuid,
    p_content text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_org_id uuid;
    v_head_coach_id uuid;
    v_assistant_coach_ids uuid[];
    v_content text := btrim(coalesce(p_content, ''));
    v_message public.team_messages%ROWTYPE;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required'
            USING ERRCODE = '42501';
    END IF;

    SELECT organization_id, coach_id, coalesce(assistant_coach_ids, '{}'::uuid[])
      INTO v_org_id, v_head_coach_id, v_assistant_coach_ids
      FROM public.teams
     WHERE id = p_team_id;

    IF v_org_id IS NULL OR NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'Team is outside the caller organization'
            USING ERRCODE = '42501';
    END IF;

    IF v_content = '' THEN
        RAISE EXCEPTION 'Message content is required'
            USING ERRCODE = '22023';
    END IF;

    IF length(v_content) > 4000 THEN
        RAISE EXCEPTION 'Message content exceeds 4000 characters'
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_org_admin(v_org_id)
       AND NOT EXISTS (
           SELECT 1
             FROM public.coaches c
            WHERE c.organization_id = v_org_id
              AND (c.user_id = v_user_id OR c.profile_id = v_user_id)
              AND (c.id = v_head_coach_id OR c.id = ANY(v_assistant_coach_ids))
       )
       AND NOT EXISTS (
           SELECT 1
             FROM public.profile_players pp
             JOIN public.team_players tp
               ON tp.player_id = pp.player_id
              AND tp.team_id = p_team_id
              AND tp.organization_id = v_org_id
            WHERE pp.profile_id = v_user_id
              AND pp.organization_id = v_org_id
       ) THEN
        RAISE EXCEPTION 'Caller cannot post messages for this team'
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.team_messages (
        organization_id,
        team_id,
        author_id,
        content
    )
    VALUES (
        v_org_id,
        p_team_id,
        v_user_id,
        v_content
    )
    RETURNING *
      INTO v_message;

    INSERT INTO public.audit_log (
        organization_id,
        user_id,
        action,
        resource_type,
        resource_id,
        metadata
    )
    VALUES (
        v_org_id,
        v_user_id,
        'team.message_created',
        'team_message',
        v_message.id,
        jsonb_build_object(
            'team_id', p_team_id,
            'content_length', length(v_content)
        )
    );

    RETURN jsonb_build_object('message', to_jsonb(v_message));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_team_event_rsvp(uuid, uuid, uuid, text, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_team_message(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.upsert_team_event_rsvp(uuid, uuid, uuid, text, date, text)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_message(uuid, text)
    TO authenticated;

COMMENT ON FUNCTION public.upsert_team_event_rsvp(uuid, uuid, uuid, text, date, text) IS
    'Org-scoped team portal RSVP mutation. Allows admins or linked parents to RSVP rostered players for validated team games/practices and writes metadata-only audit rows.';
COMMENT ON FUNCTION public.create_team_message(uuid, text) IS
    'Org-scoped team portal message mutation. Allows admins, assigned coaches, assistant coaches, or roster parents to post sanitized team messages and writes metadata-only audit rows.';

COMMIT;
