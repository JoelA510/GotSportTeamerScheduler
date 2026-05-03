-- Repair team persistence for the current UUID/org-scoped scheduler schema.
-- The original consolidated RPC used bigint season settings, omitted
-- scheduler_runs.organization_id, and could not safely support review/apply
-- semantics for current team and team_player rows.

DROP FUNCTION IF EXISTS public.persist_team_schedule(jsonb, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.persist_team_schedule(
    run_data jsonb,
    teams jsonb,
    team_players jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_run_id uuid;
    v_persisted_run_id uuid;
    v_org_id uuid;
    v_candidate_org_id uuid;
    v_candidate_org_count integer;
    v_season_id uuid;
    v_season_settings_id uuid;
    v_season_org_id uuid;
    v_run_type text;
    v_status text;
    v_created_by uuid;
    v_started_at timestamptz;
    v_completed_at timestamptz;
    v_effective_role text;
    v_missing_team_id_count integer;
    v_missing_team_division_count integer;
    v_missing_team_name_count integer;
    v_team_org_mismatch_count integer;
    v_missing_player_team_count integer;
    v_missing_player_count integer;
    v_invalid_source_count integer;
    v_missing_division_ref uuid;
    v_cross_division_ref uuid;
    v_missing_coach_ref uuid;
    v_cross_coach_ref uuid;
    v_cross_existing_team_ref uuid;
    v_missing_team_ref uuid;
    v_cross_team_ref uuid;
    v_missing_player_ref uuid;
    v_cross_player_ref uuid;
BEGIN
    IF run_data IS NULL OR jsonb_typeof(run_data) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'run_data must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    IF teams IS NULL THEN
        teams := '[]'::jsonb;
    END IF;

    IF team_players IS NULL THEN
        team_players := '[]'::jsonb;
    END IF;

    IF jsonb_typeof(teams) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'teams must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(team_players) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'team_players must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    v_run_type := COALESCE(NULLIF(run_data->>'run_type', ''), 'team');
    IF v_run_type <> 'team' THEN
        RAISE EXCEPTION 'persist_team_schedule only accepts team runs'
            USING ERRCODE = '22023';
    END IF;

    v_status := COALESCE(NULLIF(run_data->>'status', ''), 'completed');
    IF v_status NOT IN (
        'queued',
        'running',
        'completed',
        'completed_with_warnings',
        'needs_manual_review',
        'failed'
    ) THEN
        RAISE EXCEPTION 'invalid scheduler run status: %', v_status
            USING ERRCODE = '22023';
    END IF;

    v_run_id := COALESCE(NULLIF(run_data->>'id', '')::uuid, gen_random_uuid());
    v_org_id := NULLIF(run_data->>'organization_id', '')::uuid;
    v_season_settings_id := NULLIF(run_data->>'season_settings_id', '')::uuid;
    v_season_id := COALESCE(NULLIF(run_data->>'season_id', '')::uuid, v_season_settings_id);
    v_effective_role := COALESCE(auth.role(), current_role, '');

    IF v_season_settings_id IS NOT NULL
       AND v_season_id IS NOT NULL
       AND v_season_settings_id <> v_season_id THEN
        RAISE EXCEPTION 'season_id must match season_settings_id for team persistence'
            USING ERRCODE = '22023';
    END IF;

    IF v_season_id IS NOT NULL THEN
        SELECT ss.organization_id
          INTO v_season_org_id
          FROM public.season_settings ss
         WHERE ss.id = v_season_id;

        IF v_season_org_id IS NULL THEN
            RAISE EXCEPTION 'season_settings_id % does not exist', v_season_id
                USING ERRCODE = '23503';
        END IF;

        IF v_org_id IS NULL THEN
            v_org_id := v_season_org_id;
        ELSIF v_org_id <> v_season_org_id THEN
            RAISE EXCEPTION 'season_settings_id % does not belong to organization %',
                v_season_id, v_org_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_org_id IS NULL THEN
        WITH parsed_teams AS (
            SELECT
                NULLIF(item.value->>'id', '')::uuid AS id,
                NULLIF(item.value->>'organization_id', '')::uuid AS organization_id,
                NULLIF(item.value->>'division_id', '')::uuid AS division_id
              FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
        ),
        parsed_team_players AS (
            SELECT
                NULLIF(item.value->>'team_id', '')::uuid AS team_id,
                NULLIF(item.value->>'player_id', '')::uuid AS player_id
              FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
        ),
        candidate_orgs AS (
            SELECT organization_id
              FROM parsed_teams
             WHERE organization_id IS NOT NULL
            UNION
            SELECT d.organization_id
              FROM parsed_teams pt
              JOIN public.divisions d ON d.id = pt.division_id
            UNION
            SELECT t.organization_id
              FROM parsed_teams pt
              JOIN public.teams t ON t.id = pt.id
            UNION
            SELECT t.organization_id
              FROM parsed_team_players ptp
              JOIN public.teams t ON t.id = ptp.team_id
            UNION
            SELECT p.organization_id
              FROM parsed_team_players ptp
              JOIN public.players p ON p.id = ptp.player_id
        )
        SELECT count(DISTINCT organization_id), min(organization_id)
          INTO v_candidate_org_count, v_candidate_org_id
          FROM candidate_orgs;

        IF v_candidate_org_count > 1 THEN
            RAISE EXCEPTION 'team persistence payload references multiple organizations'
                USING ERRCODE = '42501';
        ELSIF v_candidate_org_count = 1 THEN
            v_org_id := v_candidate_org_id;
        END IF;
    END IF;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'organization_id, season_settings_id, or org-scoped team payload is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_effective_role <> 'service_role'
       AND NOT public.is_org_admin(v_org_id) THEN
        RAISE EXCEPTION 'caller is not an admin of organization %', v_org_id
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM public.scheduler_runs sr
         WHERE sr.id = v_run_id
           AND sr.organization_id <> v_org_id
    ) THEN
        RAISE EXCEPTION 'scheduler run % belongs to another organization', v_run_id
            USING ERRCODE = '42501';
    END IF;

    IF v_effective_role = 'service_role' THEN
        BEGIN
            v_created_by := NULLIF(run_data->>'created_by', '')::uuid;
        EXCEPTION WHEN invalid_text_representation THEN
            v_created_by := NULL;
        END;
    ELSE
        v_created_by := auth.uid();
    END IF;

    v_started_at := COALESCE(NULLIF(run_data->>'started_at', '')::timestamptz, timezone('utc', now()));
    v_completed_at := COALESCE(NULLIF(run_data->>'completed_at', '')::timestamptz, timezone('utc', now()));

    INSERT INTO public.scheduler_runs (
        id,
        organization_id,
        season_id,
        season_settings_id,
        run_type,
        status,
        parameters,
        metrics,
        results,
        created_by,
        started_at,
        completed_at
    )
    VALUES (
        v_run_id,
        v_org_id,
        v_season_id,
        v_season_settings_id,
        'team',
        v_status,
        COALESCE(run_data->'parameters', '{}'::jsonb),
        COALESCE(run_data->'metrics', '{}'::jsonb),
        COALESCE(run_data->'results', '{}'::jsonb),
        v_created_by,
        v_started_at,
        v_completed_at
    )
    ON CONFLICT (id) DO UPDATE SET
        season_id = EXCLUDED.season_id,
        season_settings_id = EXCLUDED.season_settings_id,
        status = EXCLUDED.status,
        parameters = EXCLUDED.parameters,
        metrics = EXCLUDED.metrics,
        results = EXCLUDED.results,
        completed_at = EXCLUDED.completed_at,
        updated_at = timezone('utc', now())
    WHERE public.scheduler_runs.organization_id = EXCLUDED.organization_id
    RETURNING id INTO v_persisted_run_id;

    IF v_persisted_run_id IS NULL THEN
        RAISE EXCEPTION 'scheduler run % could not be persisted for organization %',
            v_run_id, v_org_id
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(teams) AS team_items(value)
         WHERE jsonb_typeof(team_items.value) IS DISTINCT FROM 'object'
    ) THEN
        RAISE EXCEPTION 'each team must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(team_players) AS team_player_items(value)
         WHERE jsonb_typeof(team_player_items.value) IS DISTINCT FROM 'object'
    ) THEN
        RAISE EXCEPTION 'each team_player must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    WITH parsed_teams AS (
        SELECT
            NULLIF(item.value->>'id', '')::uuid AS id,
            NULLIF(item.value->>'organization_id', '')::uuid AS organization_id,
            NULLIF(item.value->>'division_id', '')::uuid AS division_id,
            NULLIF(item.value->>'coach_id', '')::uuid AS coach_id,
            NULLIF(item.value->>'name', '') AS name
          FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT
        count(*) FILTER (WHERE id IS NULL),
        count(*) FILTER (WHERE division_id IS NULL),
        count(*) FILTER (WHERE name IS NULL),
        count(*) FILTER (WHERE organization_id IS NOT NULL AND organization_id <> v_org_id)
      INTO
        v_missing_team_id_count,
        v_missing_team_division_count,
        v_missing_team_name_count,
        v_team_org_mismatch_count
      FROM parsed_teams;

    IF v_missing_team_id_count > 0 THEN
        RAISE EXCEPTION 'team id is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_missing_team_division_count > 0 THEN
        RAISE EXCEPTION 'team division_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_missing_team_name_count > 0 THEN
        RAISE EXCEPTION 'team name is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_team_org_mismatch_count > 0 THEN
        RAISE EXCEPTION 'team organization_id must match the scheduler run organization'
            USING ERRCODE = '42501';
    END IF;

    WITH parsed_team_players AS (
        SELECT
            NULLIF(item.value->>'team_id', '')::uuid AS team_id,
            NULLIF(item.value->>'player_id', '')::uuid AS player_id,
            CASE
                WHEN lower(COALESCE(NULLIF(item.value->>'source', ''), 'auto')) = 'locked'
                    THEN 'manual'
                ELSE lower(COALESCE(NULLIF(item.value->>'source', ''), 'auto'))
            END AS source
          FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT
        count(*) FILTER (WHERE team_id IS NULL),
        count(*) FILTER (WHERE player_id IS NULL),
        count(*) FILTER (WHERE source NOT IN ('auto', 'manual'))
      INTO
        v_missing_player_team_count,
        v_missing_player_count,
        v_invalid_source_count
      FROM parsed_team_players;

    IF v_missing_player_team_count > 0 THEN
        RAISE EXCEPTION 'team_player team_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_missing_player_count > 0 THEN
        RAISE EXCEPTION 'team_player player_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_invalid_source_count > 0 THEN
        RAISE EXCEPTION 'invalid team_player source'
            USING ERRCODE = '22023';
    END IF;

    WITH parsed_teams AS (
        SELECT
            NULLIF(item.value->>'id', '')::uuid AS id,
            NULLIF(item.value->>'division_id', '')::uuid AS division_id,
            NULLIF(item.value->>'coach_id', '')::uuid AS coach_id
          FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_teams.division_id
      INTO v_missing_division_ref
      FROM parsed_teams
      LEFT JOIN public.divisions d ON d.id = parsed_teams.division_id
     WHERE d.id IS NULL
     LIMIT 1;

    IF v_missing_division_ref IS NOT NULL THEN
        RAISE EXCEPTION 'division_id % does not exist', v_missing_division_ref
            USING ERRCODE = '23503';
    END IF;

    WITH parsed_teams AS (
        SELECT NULLIF(item.value->>'division_id', '')::uuid AS division_id
          FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_teams.division_id
      INTO v_cross_division_ref
      FROM parsed_teams
      JOIN public.divisions d ON d.id = parsed_teams.division_id
     WHERE d.organization_id <> v_org_id
     LIMIT 1;

    IF v_cross_division_ref IS NOT NULL THEN
        RAISE EXCEPTION 'division_id % belongs to another organization', v_cross_division_ref
            USING ERRCODE = '42501';
    END IF;

    WITH parsed_teams AS (
        SELECT NULLIF(item.value->>'coach_id', '')::uuid AS coach_id
          FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_teams.coach_id
      INTO v_missing_coach_ref
      FROM parsed_teams
      LEFT JOIN public.coaches c ON c.id = parsed_teams.coach_id
     WHERE parsed_teams.coach_id IS NOT NULL
       AND c.id IS NULL
     LIMIT 1;

    IF v_missing_coach_ref IS NOT NULL THEN
        RAISE EXCEPTION 'coach_id % does not exist', v_missing_coach_ref
            USING ERRCODE = '23503';
    END IF;

    WITH parsed_teams AS (
        SELECT NULLIF(item.value->>'coach_id', '')::uuid AS coach_id
          FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_teams.coach_id
      INTO v_cross_coach_ref
      FROM parsed_teams
      JOIN public.coaches c ON c.id = parsed_teams.coach_id
     WHERE c.organization_id <> v_org_id
     LIMIT 1;

    IF v_cross_coach_ref IS NOT NULL THEN
        RAISE EXCEPTION 'coach_id % belongs to another organization', v_cross_coach_ref
            USING ERRCODE = '42501';
    END IF;

    WITH parsed_teams AS (
        SELECT NULLIF(item.value->>'id', '')::uuid AS id
          FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_teams.id
      INTO v_cross_existing_team_ref
      FROM parsed_teams
      JOIN public.teams t ON t.id = parsed_teams.id
     WHERE t.organization_id <> v_org_id
     LIMIT 1;

    IF v_cross_existing_team_ref IS NOT NULL THEN
        RAISE EXCEPTION 'team id % belongs to another organization', v_cross_existing_team_ref
            USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.teams (
        id,
        organization_id,
        division_id,
        coach_id,
        name,
        notes
    )
    SELECT DISTINCT ON (id)
        id,
        v_org_id,
        division_id,
        coach_id,
        name,
        notes
    FROM (
        SELECT
            item.ordinality,
            NULLIF(item.value->>'id', '')::uuid AS id,
            NULLIF(item.value->>'division_id', '')::uuid AS division_id,
            NULLIF(item.value->>'coach_id', '')::uuid AS coach_id,
            NULLIF(item.value->>'name', '') AS name,
            NULLIF(item.value->>'notes', '') AS notes
          FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
    ) parsed_teams
    ORDER BY id, ordinality DESC
    ON CONFLICT (id) DO UPDATE SET
        division_id = EXCLUDED.division_id,
        coach_id = EXCLUDED.coach_id,
        name = EXCLUDED.name,
        notes = COALESCE(EXCLUDED.notes, public.teams.notes),
        updated_at = timezone('utc', now())
    WHERE public.teams.organization_id = EXCLUDED.organization_id;

    WITH parsed_team_players AS (
        SELECT
            NULLIF(item.value->>'team_id', '')::uuid AS team_id,
            NULLIF(item.value->>'player_id', '')::uuid AS player_id
          FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_team_players.team_id
      INTO v_missing_team_ref
      FROM parsed_team_players
      LEFT JOIN public.teams t ON t.id = parsed_team_players.team_id
     WHERE t.id IS NULL
     LIMIT 1;

    IF v_missing_team_ref IS NOT NULL THEN
        RAISE EXCEPTION 'team_player team_id % does not exist', v_missing_team_ref
            USING ERRCODE = '23503';
    END IF;

    WITH parsed_team_players AS (
        SELECT NULLIF(item.value->>'team_id', '')::uuid AS team_id
          FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_team_players.team_id
      INTO v_cross_team_ref
      FROM parsed_team_players
      JOIN public.teams t ON t.id = parsed_team_players.team_id
     WHERE t.organization_id <> v_org_id
     LIMIT 1;

    IF v_cross_team_ref IS NOT NULL THEN
        RAISE EXCEPTION 'team_player team_id % belongs to another organization', v_cross_team_ref
            USING ERRCODE = '42501';
    END IF;

    WITH parsed_team_players AS (
        SELECT NULLIF(item.value->>'player_id', '')::uuid AS player_id
          FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_team_players.player_id
      INTO v_missing_player_ref
      FROM parsed_team_players
      LEFT JOIN public.players p ON p.id = parsed_team_players.player_id
     WHERE p.id IS NULL
     LIMIT 1;

    IF v_missing_player_ref IS NOT NULL THEN
        RAISE EXCEPTION 'team_player player_id % does not exist', v_missing_player_ref
            USING ERRCODE = '23503';
    END IF;

    WITH parsed_team_players AS (
        SELECT NULLIF(item.value->>'player_id', '')::uuid AS player_id
          FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
    )
    SELECT parsed_team_players.player_id
      INTO v_cross_player_ref
      FROM parsed_team_players
      JOIN public.players p ON p.id = parsed_team_players.player_id
     WHERE p.organization_id <> v_org_id
     LIMIT 1;

    IF v_cross_player_ref IS NOT NULL THEN
        RAISE EXCEPTION 'team_player player_id % belongs to another organization', v_cross_player_ref
            USING ERRCODE = '42501';
    END IF;

    WITH payload_team_ids AS (
        SELECT NULLIF(item.value->>'id', '')::uuid AS team_id
          FROM jsonb_array_elements(teams) WITH ORDINALITY AS item(value, ordinality)
        UNION
        SELECT NULLIF(item.value->>'team_id', '')::uuid AS team_id
          FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
    ),
    incoming_team_players AS (
        SELECT DISTINCT
            NULLIF(item.value->>'team_id', '')::uuid AS team_id,
            NULLIF(item.value->>'player_id', '')::uuid AS player_id
          FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
    )
    DELETE FROM public.team_players tp
      USING payload_team_ids pti
     WHERE pti.team_id IS NOT NULL
       AND tp.organization_id = v_org_id
       AND tp.team_id = pti.team_id
       AND NOT EXISTS (
            SELECT 1
              FROM incoming_team_players itp
             WHERE itp.team_id = tp.team_id
               AND itp.player_id = tp.player_id
       );

    INSERT INTO public.team_players (
        team_id,
        player_id,
        organization_id,
        role,
        source
    )
    SELECT DISTINCT ON (team_id, player_id)
        team_id,
        player_id,
        v_org_id,
        role,
        source::public.source_enum
    FROM (
        SELECT
            item.ordinality,
            NULLIF(item.value->>'team_id', '')::uuid AS team_id,
            NULLIF(item.value->>'player_id', '')::uuid AS player_id,
            COALESCE(NULLIF(item.value->>'role', ''), 'player') AS role,
            CASE
                WHEN lower(COALESCE(NULLIF(item.value->>'source', ''), 'auto')) = 'locked'
                    THEN 'manual'
                ELSE lower(COALESCE(NULLIF(item.value->>'source', ''), 'auto'))
            END AS source
          FROM jsonb_array_elements(team_players) WITH ORDINALITY AS item(value, ordinality)
    ) parsed_team_players
    ORDER BY team_id, player_id, ordinality DESC
    ON CONFLICT (team_id, player_id) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        role = EXCLUDED.role,
        source = EXCLUDED.source;

    RETURN v_persisted_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.persist_team_schedule(jsonb, jsonb, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.persist_team_schedule(jsonb, jsonb, jsonb) IS
  'Persists an org-scoped team scheduler run and authoritative roster snapshot for the submitted teams.';
