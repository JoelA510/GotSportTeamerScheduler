-- Link persisted practice assignments to their scheduler run so the routed
-- practice dashboard can refresh by latest completed run.

ALTER TABLE public.practice_assignments
    ADD COLUMN IF NOT EXISTS run_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.practice_assignments'::regclass
           AND conname = 'practice_assignments_run_id_fkey'
    ) THEN
        ALTER TABLE public.practice_assignments
            ADD CONSTRAINT practice_assignments_run_id_fkey
            FOREIGN KEY (run_id)
            REFERENCES public.scheduler_runs(id)
            ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_practice_assignments_org_run_id
    ON public.practice_assignments (organization_id, run_id)
    WHERE run_id IS NOT NULL;

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
    v_effective_role text;
    v_missing_team_count integer;
    v_missing_slot_count integer;
    v_missing_range_count integer;
    v_invalid_source_count integer;
    v_missing_team_ref uuid;
    v_cross_team_ref uuid;
    v_missing_slot_ref uuid;
    v_cross_slot_ref uuid;
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

    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(assignments) AS assignment_items(value)
         WHERE jsonb_typeof(assignment_items.value) IS DISTINCT FROM 'object'
    ) THEN
        RAISE EXCEPTION 'each assignment must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    WITH parsed_assignments AS MATERIALIZED (
        SELECT
            NULLIF(raw_assignments.team_id, '')::uuid AS team_id,
            COALESCE(
                NULLIF(raw_assignments.practice_slot_id, '')::uuid,
                NULLIF(raw_assignments.slot_id, '')::uuid
            ) AS practice_slot_id,
            NULLIF(raw_assignments.effective_date_range, '')::daterange AS effective_date_range,
            CASE
                WHEN lower(COALESCE(NULLIF(raw_assignments.source, ''), 'auto')) = 'locked'
                    THEN 'manual'
                ELSE lower(COALESCE(NULLIF(raw_assignments.source, ''), 'auto'))
            END AS source
        FROM jsonb_to_recordset(assignments) AS raw_assignments(
            team_id text,
            practice_slot_id text,
            slot_id text,
            effective_date_range text,
            source text
        )
    ),
    validated_assignments AS (
        SELECT
            parsed_assignments.team_id,
            parsed_assignments.practice_slot_id,
            parsed_assignments.effective_date_range,
            parsed_assignments.source,
            t.id AS existing_team_id,
            t.organization_id AS team_org_id,
            ps.id AS existing_slot_id,
            ps.organization_id AS slot_org_id
        FROM parsed_assignments
        LEFT JOIN public.teams t
          ON t.id = parsed_assignments.team_id
        LEFT JOIN public.practice_slots ps
          ON ps.id = parsed_assignments.practice_slot_id
    ),
    validation_summary AS (
        SELECT
            count(*) FILTER (WHERE team_id IS NULL) AS missing_team_count,
            count(*) FILTER (WHERE practice_slot_id IS NULL) AS missing_slot_count,
            count(*) FILTER (WHERE effective_date_range IS NULL) AS missing_range_count,
            count(*) FILTER (WHERE source NOT IN ('auto', 'manual')) AS invalid_source_count,
            (
                array_agg(team_id)
                    FILTER (WHERE team_id IS NOT NULL AND existing_team_id IS NULL)
            )[1] AS missing_team_ref,
            (
                array_agg(team_id)
                    FILTER (
                        WHERE existing_team_id IS NOT NULL
                          AND team_org_id <> v_org_id
                    )
            )[1] AS cross_team_ref,
            (
                array_agg(practice_slot_id)
                    FILTER (
                        WHERE practice_slot_id IS NOT NULL
                          AND existing_slot_id IS NULL
                    )
            )[1] AS missing_slot_ref,
            (
                array_agg(practice_slot_id)
                    FILTER (
                        WHERE existing_slot_id IS NOT NULL
                          AND slot_org_id <> v_org_id
                    )
            )[1] AS cross_slot_ref
        FROM validated_assignments
    )
    SELECT
        missing_team_count,
        missing_slot_count,
        missing_range_count,
        invalid_source_count,
        missing_team_ref,
        cross_team_ref,
        missing_slot_ref,
        cross_slot_ref
      INTO
        v_missing_team_count,
        v_missing_slot_count,
        v_missing_range_count,
        v_invalid_source_count,
        v_missing_team_ref,
        v_cross_team_ref,
        v_missing_slot_ref,
        v_cross_slot_ref
      FROM validation_summary;

    IF v_missing_team_count > 0 THEN
        RAISE EXCEPTION 'assignment team_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_missing_slot_count > 0 THEN
        RAISE EXCEPTION 'assignment practice_slot_id or slot_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_missing_range_count > 0 THEN
        RAISE EXCEPTION 'assignment effective_date_range is required'
            USING ERRCODE = '23502';
    END IF;

    IF v_invalid_source_count > 0 THEN
        RAISE EXCEPTION 'invalid practice assignment source'
            USING ERRCODE = '22023';
    END IF;

    IF v_missing_team_ref IS NOT NULL THEN
        RAISE EXCEPTION 'team_id % does not exist', v_missing_team_ref
            USING ERRCODE = '23503';
    END IF;

    IF v_cross_team_ref IS NOT NULL THEN
        RAISE EXCEPTION 'team_id % belongs to another organization', v_cross_team_ref
            USING ERRCODE = '42501';
    END IF;

    IF v_missing_slot_ref IS NOT NULL THEN
        RAISE EXCEPTION 'practice_slot_id % does not exist', v_missing_slot_ref
            USING ERRCODE = '23503';
    END IF;

    IF v_cross_slot_ref IS NOT NULL THEN
        RAISE EXCEPTION 'practice_slot_id % belongs to another organization', v_cross_slot_ref
            USING ERRCODE = '42501';
    END IF;

    WITH parsed_assignments AS (
        SELECT
            NULLIF(raw_assignments.team_id, '')::uuid AS team_id,
            COALESCE(
                NULLIF(raw_assignments.practice_slot_id, '')::uuid,
                NULLIF(raw_assignments.slot_id, '')::uuid
            ) AS practice_slot_id,
            NULLIF(raw_assignments.effective_date_range, '')::daterange AS effective_date_range,
            CASE
                WHEN lower(COALESCE(NULLIF(raw_assignments.source, ''), 'auto')) = 'locked'
                    THEN 'manual'
                ELSE lower(COALESCE(NULLIF(raw_assignments.source, ''), 'auto'))
            END AS source
        FROM jsonb_to_recordset(assignments) AS raw_assignments(
            team_id text,
            practice_slot_id text,
            slot_id text,
            effective_date_range text,
            source text
        )
    ),
    org_scoped_assignments AS (
        SELECT DISTINCT ON (
            parsed_assignments.team_id,
            parsed_assignments.practice_slot_id,
            parsed_assignments.effective_date_range
        )
            parsed_assignments.team_id,
            parsed_assignments.practice_slot_id,
            parsed_assignments.effective_date_range,
            parsed_assignments.source,
            ps.day_of_week::text AS day_of_week,
            ps.start_time::text AS start_time,
            ps.end_time::text AS end_time,
            ps.field_id
        FROM parsed_assignments
        JOIN public.teams t
          ON t.id = parsed_assignments.team_id
         AND t.organization_id = v_org_id
        JOIN public.practice_slots ps
          ON ps.id = parsed_assignments.practice_slot_id
         AND ps.organization_id = v_org_id
        ORDER BY
            parsed_assignments.team_id,
            parsed_assignments.practice_slot_id,
            parsed_assignments.effective_date_range,
            parsed_assignments.source DESC
    )
    INSERT INTO public.practice_assignments (
        organization_id,
        run_id,
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
    SELECT
        v_org_id,
        v_run_id,
        team_id,
        practice_slot_id,
        practice_slot_id,
        day_of_week,
        start_time,
        end_time,
        field_id,
        effective_date_range,
        source::source_enum
    FROM org_scoped_assignments
    ON CONFLICT (team_id, practice_slot_id, effective_date_range)
        WHERE practice_slot_id IS NOT NULL
          AND effective_date_range IS NOT NULL
    DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        run_id = EXCLUDED.run_id,
        slot_id = EXCLUDED.slot_id,
        day_of_week = EXCLUDED.day_of_week,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        field_id = EXCLUDED.field_id,
        source = EXCLUDED.source,
        updated_at = timezone('utc', now());

    RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_practice_schedule(jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_practice_schedule(jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_practice_schedule(jsonb, jsonb) TO service_role;
