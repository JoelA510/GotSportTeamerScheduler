-- Repair practice persistence for the current UUID/org-scoped scheduler schema.
-- The original consolidated RPC used a bigint season_settings_id and omitted
-- scheduler_runs.organization_id, which is incompatible with the definitive schema.

CREATE UNIQUE INDEX IF NOT EXISTS practice_assignments_team_practice_slot_range_unique
    ON public.practice_assignments (team_id, practice_slot_id, effective_date_range)
    WHERE practice_slot_id IS NOT NULL
      AND effective_date_range IS NOT NULL;

DROP FUNCTION IF EXISTS public.persist_practice_schedule(jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.persist_practice_schedule(
    run_data jsonb,
    assignments jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_run_id uuid;
    v_persisted_run_id uuid;
    v_org_id uuid;
    v_season_id uuid;
    v_season_settings_id uuid;
    v_season_org_id uuid;
    v_run_type text;
    v_status text;
    v_created_by uuid;
    v_started_at timestamptz;
    v_completed_at timestamptz;
    v_assignment jsonb;
    v_team_id uuid;
    v_slot_id uuid;
    v_team_org_id uuid;
    v_slot_org_id uuid;
    v_slot_day text;
    v_slot_start text;
    v_slot_end text;
    v_slot_field_id uuid;
    v_effective_date_range daterange;
    v_source text;
    v_effective_role text;
BEGIN
    IF run_data IS NULL OR jsonb_typeof(run_data) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'run_data must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    IF assignments IS NULL THEN
        assignments := '[]'::jsonb;
    END IF;

    IF jsonb_typeof(assignments) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'assignments must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    v_run_type := COALESCE(NULLIF(run_data->>'run_type', ''), 'practice');
    IF v_run_type <> 'practice' THEN
        RAISE EXCEPTION 'persist_practice_schedule only accepts practice runs'
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

    IF v_org_id IS NOT NULL
       AND v_effective_role <> 'service_role'
       AND NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'caller is not a member of organization %', v_org_id
            USING ERRCODE = '42501';
    END IF;

    IF v_season_settings_id IS NOT NULL
       AND v_season_id IS NOT NULL
       AND v_season_settings_id <> v_season_id THEN
        RAISE EXCEPTION 'season_id must match season_settings_id for practice persistence'
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
        RAISE EXCEPTION 'organization_id or season_settings_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_effective_role <> 'service_role'
       AND NOT public.is_org_member(v_org_id) THEN
        RAISE EXCEPTION 'caller is not a member of organization %', v_org_id
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
        'practice',
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

    FOR v_assignment IN
        SELECT value FROM jsonb_array_elements(assignments) AS assignment_items(value)
    LOOP
        IF v_assignment IS NULL OR jsonb_typeof(v_assignment) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'each assignment must be a JSON object'
                USING ERRCODE = '22023';
        END IF;

        v_team_id := NULLIF(v_assignment->>'team_id', '')::uuid;
        v_slot_id := COALESCE(
            NULLIF(v_assignment->>'practice_slot_id', '')::uuid,
            NULLIF(v_assignment->>'slot_id', '')::uuid
        );
        v_effective_date_range := NULLIF(v_assignment->>'effective_date_range', '')::daterange;

        IF v_team_id IS NULL THEN
            RAISE EXCEPTION 'assignment team_id is required'
                USING ERRCODE = '23502';
        END IF;

        IF v_slot_id IS NULL THEN
            RAISE EXCEPTION 'assignment practice_slot_id or slot_id is required'
                USING ERRCODE = '23502';
        END IF;

        IF v_effective_date_range IS NULL THEN
            RAISE EXCEPTION 'assignment effective_date_range is required'
                USING ERRCODE = '23502';
        END IF;

        SELECT t.organization_id
          INTO v_team_org_id
          FROM public.teams t
         WHERE t.id = v_team_id;

        IF v_team_org_id IS NULL THEN
            RAISE EXCEPTION 'team_id % does not exist', v_team_id
                USING ERRCODE = '23503';
        END IF;

        IF v_team_org_id <> v_org_id THEN
            RAISE EXCEPTION 'team_id % belongs to another organization', v_team_id
                USING ERRCODE = '42501';
        END IF;

        SELECT ps.organization_id,
               ps.day_of_week::text,
               ps.start_time::text,
               ps.end_time::text,
               ps.field_id
          INTO v_slot_org_id,
               v_slot_day,
               v_slot_start,
               v_slot_end,
               v_slot_field_id
          FROM public.practice_slots ps
         WHERE ps.id = v_slot_id;

        IF v_slot_org_id IS NULL THEN
            RAISE EXCEPTION 'practice_slot_id % does not exist', v_slot_id
                USING ERRCODE = '23503';
        END IF;

        IF v_slot_org_id <> v_org_id THEN
            RAISE EXCEPTION 'practice_slot_id % belongs to another organization', v_slot_id
                USING ERRCODE = '42501';
        END IF;

        v_source := lower(COALESCE(NULLIF(v_assignment->>'source', ''), 'auto'));
        IF v_source = 'locked' THEN
            v_source := 'manual';
        END IF;

        IF v_source NOT IN ('auto', 'manual') THEN
            RAISE EXCEPTION 'invalid practice assignment source: %', v_source
                USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.practice_assignments (
            organization_id,
            team_id,
            slot_id,
            practice_slot_id,
            day_of_week,
            start_time,
            end_time,
            field_id,
            effective_date_range,
            source
        )
        VALUES (
            v_org_id,
            v_team_id,
            v_slot_id,
            v_slot_id,
            v_slot_day,
            v_slot_start,
            v_slot_end,
            v_slot_field_id,
            v_effective_date_range,
            v_source::source_enum
        )
        ON CONFLICT (team_id, practice_slot_id, effective_date_range)
            WHERE practice_slot_id IS NOT NULL
              AND effective_date_range IS NOT NULL
        DO UPDATE SET
            organization_id = EXCLUDED.organization_id,
            slot_id = EXCLUDED.slot_id,
            day_of_week = EXCLUDED.day_of_week,
            start_time = EXCLUDED.start_time,
            end_time = EXCLUDED.end_time,
            field_id = EXCLUDED.field_id,
            source = EXCLUDED.source,
            updated_at = timezone('utc', now());
    END LOOP;

    RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_practice_schedule(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_practice_schedule(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_practice_schedule(jsonb, jsonb) TO service_role;
