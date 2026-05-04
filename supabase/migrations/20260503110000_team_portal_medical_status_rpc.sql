-- Provide a narrow read-side RPC for team-portal medical clearance badges.
-- Direct client reads from registrations remain restricted by RLS; this
-- function derives team org/season context and only returns rows the caller is
-- authorized to see.

DROP FUNCTION IF EXISTS public.get_team_portal_medical_status(uuid);

CREATE OR REPLACE FUNCTION public.get_team_portal_medical_status(p_team_id uuid)
RETURNS TABLE (
    player_id uuid,
    medical_cleared boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_season_id uuid;
    v_uid uuid;
    v_effective_role text;
    v_can_view_full_roster boolean;
BEGIN
    IF p_team_id IS NULL THEN
        RAISE EXCEPTION 'team id is required'
            USING ERRCODE = '23502';
    END IF;

    SELECT t.organization_id, d.season_settings_id
      INTO v_org_id, v_season_id
      FROM public.teams t
      JOIN public.divisions d
        ON d.id = t.division_id
       AND d.organization_id = t.organization_id
     WHERE t.id = p_team_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'team % does not exist', p_team_id
            USING ERRCODE = '23503';
    END IF;

    v_uid := auth.uid();
    v_effective_role := COALESCE(auth.role(), current_role, '');

    IF v_effective_role <> 'service_role' THEN
        IF v_uid IS NULL THEN
            RAISE EXCEPTION 'authenticated user is required'
                USING ERRCODE = '42501';
        END IF;

        IF NOT public.is_org_member(v_org_id) THEN
            RAISE EXCEPTION 'caller is not a member of team organization'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    v_can_view_full_roster :=
        v_effective_role = 'service_role'
        OR public.is_org_admin(v_org_id)
        OR EXISTS (
            SELECT 1
              FROM public.teams t
              JOIN public.coaches c
                ON c.organization_id = t.organization_id
               AND (
                    c.id = t.coach_id
                    OR c.id = ANY(COALESCE(t.assistant_coach_ids, '{}'::uuid[]))
               )
             WHERE t.id = p_team_id
               AND t.organization_id = v_org_id
               AND (
                    c.user_id = v_uid
                    OR c.profile_id = v_uid
               )
        );

    RETURN QUERY
    WITH roster AS (
        SELECT tp.player_id
          FROM public.team_players tp
         WHERE tp.team_id = p_team_id
           AND tp.organization_id = v_org_id
    ),
    current_season_registrations AS (
        SELECT DISTINCT ON (r.player_id)
               r.player_id,
               r.medical_cleared
          FROM public.registrations r
          JOIN public.registration_forms rf
            ON rf.id = r.form_id
           AND rf.organization_id = r.organization_id
         WHERE r.organization_id = v_org_id
           AND rf.season_id = v_season_id
           AND r.player_id IN (SELECT roster.player_id FROM roster)
         ORDER BY r.player_id, r.updated_at DESC, r.created_at DESC, r.id DESC
    )
    SELECT roster.player_id,
           COALESCE(csr.medical_cleared, false) AS medical_cleared
      FROM roster
      LEFT JOIN current_season_registrations csr
        ON csr.player_id = roster.player_id
     WHERE v_can_view_full_roster
        OR EXISTS (
            SELECT 1
              FROM public.profile_players pp
             WHERE pp.organization_id = v_org_id
               AND pp.profile_id = v_uid
               AND pp.player_id = roster.player_id
        );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_team_portal_medical_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_team_portal_medical_status(uuid) TO service_role;

COMMENT ON FUNCTION public.get_team_portal_medical_status(uuid) IS
  'Returns team-portal medical clearance rows scoped to the team season and caller authorization.';
