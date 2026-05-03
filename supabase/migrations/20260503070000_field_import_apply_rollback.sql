-- Durable field availability import apply/rollback.
--
-- Coach imports introduced the shared non-player staging and application
-- ledger. This migration adds the field-slot slice: field CSV rows promote
-- into locations, fields, field_subunits, practice_slots, and game_slots with
-- org-scoped admin checks and rollback snapshots.

BEGIN;

ALTER TABLE public.import_application_records
    DROP CONSTRAINT IF EXISTS import_application_records_target_table_check;

ALTER TABLE public.import_application_records
    ADD CONSTRAINT import_application_records_target_table_check
    CHECK (
        target_table IN (
            'coaches',
            'fields',
            'field_subunits',
            'locations',
            'practice_slots',
            'game_slots'
        )
    );

ALTER TABLE public.practice_slots
    DROP CONSTRAINT IF EXISTS practice_slots_day_of_week_check;

ALTER TABLE public.practice_slots
    ADD CONSTRAINT practice_slots_day_of_week_check
    CHECK (day_of_week IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'));

CREATE OR REPLACE FUNCTION public.import_text_to_time(p_value text)
RETURNS time
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_value text := NULLIF(btrim(COALESCE(p_value, '')), '');
BEGIN
    IF v_value IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN v_value::time;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_text_to_day_of_week(p_value text)
RETURNS public.day_of_week
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_value text := lower(NULLIF(btrim(COALESCE(p_value, '')), ''));
BEGIN
    IF v_value IS NULL THEN
        RETURN NULL;
    END IF;

    CASE
        WHEN v_value IN ('mon', 'monday') THEN RETURN 'mon'::public.day_of_week;
        WHEN v_value IN ('tue', 'tues', 'tuesday') THEN RETURN 'tue'::public.day_of_week;
        WHEN v_value IN ('wed', 'weds', 'wednesday') THEN RETURN 'wed'::public.day_of_week;
        WHEN v_value IN ('thu', 'thur', 'thurs', 'thursday') THEN RETURN 'thu'::public.day_of_week;
        WHEN v_value IN ('fri', 'friday') THEN RETURN 'fri'::public.day_of_week;
        WHEN v_value IN ('sat', 'saturday') THEN RETURN 'sat'::public.day_of_week;
        WHEN v_value IN ('sun', 'sunday') THEN RETURN 'sun'::public.day_of_week;
        ELSE RETURN NULL;
    END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_text_to_positive_int(
    p_value text,
    p_default integer DEFAULT 1
)
RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_value text := NULLIF(btrim(COALESCE(p_value, '')), '');
    v_result integer;
BEGIN
    IF v_value IS NULL THEN
        RETURN p_default;
    END IF;

    v_result := v_value::integer;
    IF v_result < 1 THEN
        RETURN NULL;
    END IF;

    RETURN v_result;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_field_import_job(
    p_import_job_id uuid,
    p_validation_errors jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job public.import_jobs%ROWTYPE;
    v_row public.staging_import_rows%ROWTYPE;
    v_location public.locations%ROWTYPE;
    v_location_after public.locations%ROWTYPE;
    v_field public.fields%ROWTYPE;
    v_field_after public.fields%ROWTYPE;
    v_subunit public.field_subunits%ROWTYPE;
    v_subunit_after public.field_subunits%ROWTYPE;
    v_practice_slot public.practice_slots%ROWTYPE;
    v_practice_slot_after public.practice_slots%ROWTYPE;
    v_game_slot public.game_slots%ROWTYPE;
    v_game_slot_after public.game_slots%ROWTYPE;
    v_now timestamptz := timezone('utc', now());
    v_validation_errors jsonb := COALESCE(p_validation_errors, '[]'::jsonb);
    v_payload jsonb;
    v_location_name text;
    v_location_address text;
    v_lighting_text text;
    v_lighting boolean;
    v_field_name text;
    v_surface_type text;
    v_size text;
    v_max_age text;
    v_priority integer;
    v_supports_halves_text text;
    v_supports_halves boolean;
    v_active_text text;
    v_active boolean;
    v_subunit_label text;
    v_slot_type text;
    v_day public.day_of_week;
    v_start_time time;
    v_end_time time;
    v_capacity integer;
    v_valid_from date;
    v_valid_until date;
    v_slot_date date;
    v_week_index integer;
    v_division_id uuid;
    v_label text;
    v_previous_payload jsonb;
    v_inserted_locations integer := 0;
    v_updated_locations integer := 0;
    v_inserted_fields integer := 0;
    v_updated_fields integer := 0;
    v_inserted_subunits integer := 0;
    v_inserted_practice_slots integer := 0;
    v_updated_practice_slots integer := 0;
    v_inserted_game_slots integer := 0;
    v_updated_game_slots integer := 0;
    v_invalid_rows integer := 0;
    v_total_applied_count integer := 0;
    v_status_result text;
    v_result jsonb;
BEGIN
    IF p_import_job_id IS NULL THEN
        RAISE EXCEPTION 'p_import_job_id is required' USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_validation_errors) <> 'array' THEN
        RAISE EXCEPTION 'p_validation_errors must be a jsonb array' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_job
    FROM public.import_jobs
    WHERE id = p_import_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import job % not found', p_import_job_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_admin(v_job.organization_id) THEN
        RAISE EXCEPTION 'Access denied: user is not an admin of organization %', v_job.organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_job.job_type <> 'fields' THEN
        RAISE EXCEPTION 'Import job % is %, not fields', p_import_job_id, v_job.job_type
            USING ERRCODE = '22023';
    END IF;

    IF v_job.status = 'failed' THEN
        RAISE EXCEPTION 'Failed import job % cannot be finalized', p_import_job_id
            USING ERRCODE = '22023';
    END IF;

    FOR v_row IN
        SELECT *
        FROM public.staging_import_rows
        WHERE import_job_id = p_import_job_id
          AND organization_id = v_job.organization_id
          AND import_type = 'fields'
          AND applied_at IS NULL
          AND normalized_payload IS NOT NULL
          AND COALESCE(jsonb_array_length(validation_errors), 0) = 0
        ORDER BY source_row_number NULLS LAST, id
    LOOP
        v_payload := v_row.normalized_payload;
        v_location_name := public.import_payload_text(
            v_payload,
            'location',
            'location_name',
            'venue'
        );
        v_location_address := public.import_payload_text(v_payload, 'address', 'location_address');
        v_lighting_text := public.import_payload_text(
            v_payload,
            'lighting_available',
            'lights',
            'lighted'
        );
        v_lighting := CASE
            WHEN v_lighting_text IS NULL THEN NULL
            ELSE public.import_text_to_bool(v_lighting_text)
        END;
        v_field_name := public.import_payload_text(v_payload, 'name', 'field', 'field_name');
        v_surface_type := public.import_payload_text(v_payload, 'surface_type', 'surface');
        v_size := public.import_payload_text(v_payload, 'size', 'field_size');
        v_max_age := public.import_payload_text(v_payload, 'max_age');
        v_priority := public.import_text_to_positive_int(
            public.import_payload_text(v_payload, 'priority_rating', 'priority'),
            1
        );
        v_supports_halves_text := public.import_payload_text(
            v_payload,
            'supports_halves',
            'supports_subunits',
            'split_field'
        );
        v_active_text := public.import_payload_text(v_payload, 'active');
        v_subunit_label := public.import_payload_text(v_payload, 'subunit', 'field_subunit');
        v_slot_type := lower(public.import_payload_text(v_payload, 'type', 'slot_type'));
        v_day := public.import_text_to_day_of_week(
            public.import_payload_text(v_payload, 'day', 'day_of_week')
        );
        v_start_time := public.import_text_to_time(
            public.import_payload_text(v_payload, 'start', 'start_time')
        );
        v_end_time := public.import_text_to_time(
            public.import_payload_text(v_payload, 'end', 'end_time')
        );
        v_capacity := public.import_text_to_positive_int(
            public.import_payload_text(v_payload, 'capacity'),
            1
        );
        v_valid_from := public.import_text_to_date(
            public.import_payload_text(v_payload, 'valid_from', 'valid start', 'start_date')
        );
        v_valid_until := public.import_text_to_date(
            public.import_payload_text(v_payload, 'valid_until', 'valid end', 'end_date')
        );
        v_slot_date := public.import_text_to_date(
            public.import_payload_text(v_payload, 'slot_date', 'date', 'game_date', 'valid_from')
        );
        v_week_index := public.import_text_to_positive_int(
            public.import_payload_text(v_payload, 'week_index', 'week'),
            1
        );
        v_label := public.import_payload_text(v_payload, 'label', 'slot_label');
        v_division_id := NULL;

        IF v_location_name IS NULL
           OR v_field_name IS NULL
           OR v_slot_type NOT IN ('practice', 'game')
           OR v_start_time IS NULL
           OR v_end_time IS NULL
           OR v_capacity IS NULL
           OR v_end_time <= v_start_time
           OR (v_slot_type = 'practice' AND (
                v_day IS NULL OR v_valid_from IS NULL OR v_valid_until IS NULL
                OR v_valid_until < v_valid_from
           ))
           OR (v_slot_type = 'game' AND v_slot_date IS NULL) THEN
            v_invalid_rows := v_invalid_rows + 1;
            UPDATE public.staging_import_rows
            SET validation_errors = jsonb_build_array(jsonb_build_object(
                    'message', 'Field row is missing required location/field/slot data or has an invalid slot window',
                    'source_row_number', v_row.source_row_number
                ))
            WHERE id = v_row.id;
            CONTINUE;
        END IF;

        IF public.import_payload_text(v_payload, 'division_id') IS NOT NULL THEN
            BEGIN
                SELECT d.id
                INTO v_division_id
                FROM public.divisions d
                WHERE d.id = public.import_payload_text(v_payload, 'division_id')::uuid
                  AND d.organization_id = v_job.organization_id;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'division reference is outside organization';
                END IF;
            EXCEPTION
                WHEN others THEN
                    v_invalid_rows := v_invalid_rows + 1;
                    UPDATE public.staging_import_rows
                    SET validation_errors = jsonb_build_array(jsonb_build_object(
                            'message', 'Field row references a division outside the import organization',
                            'source_row_number', v_row.source_row_number
                        ))
                    WHERE id = v_row.id;
                    CONTINUE;
            END;
        ELSIF public.import_payload_text(v_payload, 'division', 'division_name') IS NOT NULL THEN
            SELECT d.id
            INTO v_division_id
            FROM public.divisions d
            WHERE d.organization_id = v_job.organization_id
              AND lower(d.name) = lower(public.import_payload_text(v_payload, 'division', 'division_name'))
            ORDER BY d.created_at, d.id
            LIMIT 1;
        END IF;

        SELECT *
        INTO v_location
        FROM public.locations l
        WHERE l.organization_id = v_job.organization_id
          AND lower(l.name) = lower(v_location_name)
        ORDER BY l.created_at, l.id
        LIMIT 1;

        IF NOT FOUND THEN
            INSERT INTO public.locations (
                organization_id,
                name,
                address,
                lighting_available
            )
            VALUES (
                v_job.organization_id,
                v_location_name,
                v_location_address,
                COALESCE(v_lighting, false)
            )
            RETURNING * INTO v_location_after;

            INSERT INTO public.import_application_records (
                organization_id,
                import_job_id,
                import_type,
                target_table,
                target_id,
                operation,
                previous_payload,
                applied_payload,
                applied_at,
                applied_by
            )
            VALUES (
                v_job.organization_id,
                p_import_job_id,
                'fields',
                'locations',
                v_location_after.id,
                'inserted',
                NULL,
                to_jsonb(v_location_after),
                v_now,
                auth.uid()
            )
            ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

            v_inserted_locations := v_inserted_locations + 1;
            v_location := v_location_after;
        ELSE
            IF v_location_address IS NOT NULL OR v_lighting IS NOT NULL THEN
                v_previous_payload := to_jsonb(v_location);
                UPDATE public.locations
                SET
                    address = COALESCE(v_location_address, address),
                    lighting_available = COALESCE(v_lighting, lighting_available),
                    updated_at = v_now
                WHERE id = v_location.id
                  AND organization_id = v_job.organization_id
                RETURNING * INTO v_location_after;

                INSERT INTO public.import_application_records (
                    organization_id,
                    import_job_id,
                    import_type,
                    target_table,
                    target_id,
                    operation,
                    previous_payload,
                    applied_payload,
                    applied_at,
                    applied_by
                )
                VALUES (
                    v_job.organization_id,
                    p_import_job_id,
                    'fields',
                    'locations',
                    v_location_after.id,
                    'updated',
                    v_previous_payload,
                    to_jsonb(v_location_after),
                    v_now,
                    auth.uid()
                )
                ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

                v_updated_locations := v_updated_locations + 1;
                v_location := v_location_after;
            END IF;
        END IF;

        SELECT *
        INTO v_field
        FROM public.fields f
        WHERE f.organization_id = v_job.organization_id
          AND f.location_id = v_location.id
          AND lower(f.name) = lower(v_field_name)
        ORDER BY f.created_at, f.id
        LIMIT 1;

        IF NOT FOUND THEN
            v_supports_halves := CASE
                WHEN v_subunit_label IS NOT NULL THEN true
                WHEN v_supports_halves_text IS NOT NULL THEN public.import_text_to_bool(v_supports_halves_text)
                ELSE false
            END;
            v_active := CASE
                WHEN v_active_text IS NOT NULL THEN public.import_text_to_bool(v_active_text)
                ELSE true
            END;

            INSERT INTO public.fields (
                organization_id,
                location_id,
                name,
                surface_type,
                size,
                supports_halves,
                max_age,
                priority_rating,
                active
            )
            VALUES (
                v_job.organization_id,
                v_location.id,
                v_field_name,
                v_surface_type,
                v_size,
                v_supports_halves,
                v_max_age,
                COALESCE(v_priority, 1),
                v_active
            )
            RETURNING * INTO v_field_after;

            INSERT INTO public.import_application_records (
                organization_id,
                import_job_id,
                import_type,
                target_table,
                target_id,
                operation,
                previous_payload,
                applied_payload,
                applied_at,
                applied_by
            )
            VALUES (
                v_job.organization_id,
                p_import_job_id,
                'fields',
                'fields',
                v_field_after.id,
                'inserted',
                NULL,
                to_jsonb(v_field_after),
                v_now,
                auth.uid()
            )
            ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

            v_inserted_fields := v_inserted_fields + 1;
            v_field := v_field_after;
        ELSE
            v_previous_payload := to_jsonb(v_field);
            v_supports_halves := CASE
                WHEN v_subunit_label IS NOT NULL THEN true
                WHEN v_supports_halves_text IS NOT NULL THEN public.import_text_to_bool(v_supports_halves_text)
                ELSE COALESCE(v_field.supports_halves, false)
            END;
            v_active := CASE
                WHEN v_active_text IS NOT NULL THEN public.import_text_to_bool(v_active_text)
                ELSE COALESCE(v_field.active, true)
            END;

            UPDATE public.fields
            SET
                location_id = v_location.id,
                name = v_field_name,
                surface_type = COALESCE(v_surface_type, surface_type),
                size = COALESCE(v_size, size),
                supports_halves = v_supports_halves,
                max_age = COALESCE(v_max_age, max_age),
                priority_rating = COALESCE(v_priority, priority_rating, 1),
                active = v_active,
                updated_at = v_now
            WHERE id = v_field.id
              AND organization_id = v_job.organization_id
            RETURNING * INTO v_field_after;

            INSERT INTO public.import_application_records (
                organization_id,
                import_job_id,
                import_type,
                target_table,
                target_id,
                operation,
                previous_payload,
                applied_payload,
                applied_at,
                applied_by
            )
            VALUES (
                v_job.organization_id,
                p_import_job_id,
                'fields',
                'fields',
                v_field_after.id,
                'updated',
                v_previous_payload,
                to_jsonb(v_field_after),
                v_now,
                auth.uid()
            )
            ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

            v_updated_fields := v_updated_fields + 1;
            v_field := v_field_after;
        END IF;

        IF v_subunit_label IS NOT NULL THEN
            SELECT *
            INTO v_subunit
            FROM public.field_subunits fs
            WHERE fs.field_id = v_field.id
              AND fs.organization_id = v_job.organization_id
              AND lower(fs.label) = lower(v_subunit_label)
            ORDER BY fs.created_at, fs.id
            LIMIT 1;

            IF NOT FOUND THEN
                INSERT INTO public.field_subunits (
                    organization_id,
                    field_id,
                    label
                )
                VALUES (
                    v_job.organization_id,
                    v_field.id,
                    v_subunit_label
                )
                RETURNING * INTO v_subunit_after;

                INSERT INTO public.import_application_records (
                    organization_id,
                    import_job_id,
                    import_type,
                    target_table,
                    target_id,
                    operation,
                    previous_payload,
                    applied_payload,
                    applied_at,
                    applied_by
                )
                VALUES (
                    v_job.organization_id,
                    p_import_job_id,
                    'fields',
                    'field_subunits',
                    v_subunit_after.id,
                    'inserted',
                    NULL,
                    to_jsonb(v_subunit_after),
                    v_now,
                    auth.uid()
                )
                ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

                v_inserted_subunits := v_inserted_subunits + 1;
                v_subunit := v_subunit_after;
            END IF;
        ELSE
            v_subunit.id := NULL;
        END IF;

        IF v_slot_type = 'practice' THEN
            SELECT *
            INTO v_practice_slot
            FROM public.practice_slots ps
            WHERE ps.organization_id = v_job.organization_id
              AND ps.field_id = v_field.id
              AND (
                (v_subunit.id IS NULL AND ps.field_subunit_id IS NULL)
                OR ps.field_subunit_id = v_subunit.id
              )
              AND ps.day_of_week = v_day
              AND ps.start_time = v_start_time
              AND ps.valid_from = v_valid_from
            ORDER BY ps.created_at, ps.id
            LIMIT 1;

            IF NOT FOUND THEN
                INSERT INTO public.practice_slots (
                    organization_id,
                    field_id,
                    field_subunit_id,
                    day_of_week,
                    start_time,
                    end_time,
                    capacity,
                    valid_from,
                    valid_until,
                    label
                )
                VALUES (
                    v_job.organization_id,
                    v_field.id,
                    v_subunit.id,
                    v_day,
                    v_start_time,
                    v_end_time,
                    v_capacity::smallint,
                    v_valid_from,
                    v_valid_until,
                    v_label
                )
                RETURNING * INTO v_practice_slot_after;

                INSERT INTO public.import_application_records (
                    organization_id,
                    import_job_id,
                    import_type,
                    target_table,
                    target_id,
                    operation,
                    previous_payload,
                    applied_payload,
                    applied_at,
                    applied_by
                )
                VALUES (
                    v_job.organization_id,
                    p_import_job_id,
                    'fields',
                    'practice_slots',
                    v_practice_slot_after.id,
                    'inserted',
                    NULL,
                    to_jsonb(v_practice_slot_after),
                    v_now,
                    auth.uid()
                )
                ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

                v_inserted_practice_slots := v_inserted_practice_slots + 1;
            ELSE
                v_previous_payload := to_jsonb(v_practice_slot);
                UPDATE public.practice_slots
                SET
                    field_id = v_field.id,
                    field_subunit_id = v_subunit.id,
                    day_of_week = v_day,
                    start_time = v_start_time,
                    end_time = v_end_time,
                    capacity = v_capacity::smallint,
                    valid_from = v_valid_from,
                    valid_until = v_valid_until,
                    label = COALESCE(v_label, label),
                    updated_at = v_now
                WHERE id = v_practice_slot.id
                  AND organization_id = v_job.organization_id
                RETURNING * INTO v_practice_slot_after;

                INSERT INTO public.import_application_records (
                    organization_id,
                    import_job_id,
                    import_type,
                    target_table,
                    target_id,
                    operation,
                    previous_payload,
                    applied_payload,
                    applied_at,
                    applied_by
                )
                VALUES (
                    v_job.organization_id,
                    p_import_job_id,
                    'fields',
                    'practice_slots',
                    v_practice_slot_after.id,
                    'updated',
                    v_previous_payload,
                    to_jsonb(v_practice_slot_after),
                    v_now,
                    auth.uid()
                )
                ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

                v_updated_practice_slots := v_updated_practice_slots + 1;
            END IF;
        ELSE
            SELECT *
            INTO v_game_slot
            FROM public.game_slots gs
            WHERE gs.organization_id = v_job.organization_id
              AND gs.field_id = v_field.id
              AND gs.slot_date = v_slot_date
              AND gs.start_time = v_start_time
            ORDER BY gs.created_at, gs.id
            LIMIT 1;

            IF NOT FOUND THEN
                INSERT INTO public.game_slots (
                    organization_id,
                    field_id,
                    division_id,
                    slot_date,
                    start_time,
                    end_time,
                    week_index,
                    capacity
                )
                VALUES (
                    v_job.organization_id,
                    v_field.id,
                    v_division_id,
                    v_slot_date,
                    v_start_time,
                    v_end_time,
                    v_week_index::smallint,
                    v_capacity::smallint
                )
                RETURNING * INTO v_game_slot_after;

                INSERT INTO public.import_application_records (
                    organization_id,
                    import_job_id,
                    import_type,
                    target_table,
                    target_id,
                    operation,
                    previous_payload,
                    applied_payload,
                    applied_at,
                    applied_by
                )
                VALUES (
                    v_job.organization_id,
                    p_import_job_id,
                    'fields',
                    'game_slots',
                    v_game_slot_after.id,
                    'inserted',
                    NULL,
                    to_jsonb(v_game_slot_after),
                    v_now,
                    auth.uid()
                )
                ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

                v_inserted_game_slots := v_inserted_game_slots + 1;
            ELSE
                v_previous_payload := to_jsonb(v_game_slot);
                UPDATE public.game_slots
                SET
                    field_id = v_field.id,
                    division_id = v_division_id,
                    slot_date = v_slot_date,
                    start_time = v_start_time,
                    end_time = v_end_time,
                    week_index = v_week_index::smallint,
                    capacity = v_capacity::smallint,
                    updated_at = v_now
                WHERE id = v_game_slot.id
                  AND organization_id = v_job.organization_id
                RETURNING * INTO v_game_slot_after;

                INSERT INTO public.import_application_records (
                    organization_id,
                    import_job_id,
                    import_type,
                    target_table,
                    target_id,
                    operation,
                    previous_payload,
                    applied_payload,
                    applied_at,
                    applied_by
                )
                VALUES (
                    v_job.organization_id,
                    p_import_job_id,
                    'fields',
                    'game_slots',
                    v_game_slot_after.id,
                    'updated',
                    v_previous_payload,
                    to_jsonb(v_game_slot_after),
                    v_now,
                    auth.uid()
                )
                ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

                v_updated_game_slots := v_updated_game_slots + 1;
            END IF;
        END IF;

        UPDATE public.staging_import_rows
        SET
            applied_at = v_now,
            applied_by = auth.uid()
        WHERE id = v_row.id;
    END LOOP;

    SELECT count(*)
    INTO v_total_applied_count
    FROM public.import_application_records
    WHERE import_job_id = p_import_job_id
      AND import_type = 'fields';

    v_status_result := CASE
        WHEN jsonb_array_length(v_validation_errors) > 0
          OR v_invalid_rows > 0
        THEN 'completed_with_warnings'
        ELSE 'completed'
    END;

    v_result := jsonb_build_object(
        'status', v_status_result,
        'staged_rows', (
            SELECT count(*)
            FROM public.staging_import_rows
            WHERE import_job_id = p_import_job_id
              AND import_type = 'fields'
        ),
        'inserted_locations', v_inserted_locations,
        'updated_locations', v_updated_locations,
        'inserted_fields', v_inserted_fields,
        'updated_fields', v_updated_fields,
        'inserted_field_subunits', v_inserted_subunits,
        'inserted_practice_slots', v_inserted_practice_slots,
        'updated_practice_slots', v_updated_practice_slots,
        'inserted_game_slots', v_inserted_game_slots,
        'updated_game_slots', v_updated_game_slots,
        'invalid_rows', v_invalid_rows,
        'validation_error_rows', jsonb_array_length(v_validation_errors),
        'total_applied_rows', v_total_applied_count
    );

    UPDATE public.import_jobs
    SET
        status = v_status_result,
        processed_rows = v_total_applied_count,
        progress_percent = 100,
        completed_at = v_now,
        error_summary = jsonb_build_object('rowErrors', v_validation_errors),
        warning_summary = jsonb_set(
            COALESCE(warning_summary, '{}'::jsonb),
            '{field_finalize}',
            v_result,
            true
        )
    WHERE id = p_import_job_id;

    PERFORM public.record_audit_event(
        v_job.organization_id,
        'import.completed',
        'import_job',
        p_import_job_id,
        v_result
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_field_import_job(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_field_import_job(p_import_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job public.import_jobs%ROWTYPE;
    v_record public.import_application_records%ROWTYPE;
    v_previous jsonb;
    v_now timestamptz := timezone('utc', now());
    v_pending_record_count integer := 0;
    v_deleted_locations integer := 0;
    v_deleted_fields integer := 0;
    v_deleted_subunits integer := 0;
    v_deleted_practice_slots integer := 0;
    v_deleted_game_slots integer := 0;
    v_restored_records integer := 0;
    v_blocked_records integer := 0;
    v_result jsonb;
BEGIN
    IF p_import_job_id IS NULL THEN
        RAISE EXCEPTION 'p_import_job_id is required' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_job
    FROM public.import_jobs
    WHERE id = p_import_job_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Import job % not found', p_import_job_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_admin(v_job.organization_id) THEN
        RAISE EXCEPTION 'Access denied: user is not an admin of organization %', v_job.organization_id
            USING ERRCODE = '42501';
    END IF;

    SELECT count(*)
    INTO v_pending_record_count
    FROM public.import_application_records
    WHERE import_job_id = p_import_job_id
      AND organization_id = v_job.organization_id
      AND import_type = 'fields'
      AND rolled_back_at IS NULL;

    IF v_pending_record_count = 0 THEN
        RAISE EXCEPTION 'Import job % has no field application records to roll back', p_import_job_id
            USING ERRCODE = '22023';
    END IF;

    FOR v_record IN
        SELECT *
        FROM public.import_application_records
        WHERE import_job_id = p_import_job_id
          AND organization_id = v_job.organization_id
          AND import_type = 'fields'
          AND rolled_back_at IS NULL
        ORDER BY
          CASE target_table
            WHEN 'game_slots' THEN 1
            WHEN 'practice_slots' THEN 2
            WHEN 'field_subunits' THEN 3
            WHEN 'fields' THEN 4
            WHEN 'locations' THEN 5
            ELSE 99
          END,
          applied_at DESC,
          id DESC
    LOOP
        IF v_record.operation = 'inserted' THEN
            IF v_record.target_table = 'game_slots' THEN
                IF EXISTS (
                    SELECT 1 FROM public.games g
                    WHERE g.organization_id = v_job.organization_id
                      AND g.game_slot_id = v_record.target_id
                ) OR EXISTS (
                    SELECT 1 FROM public.game_assignments ga
                    WHERE ga.organization_id = v_job.organization_id
                      AND ga.game_slot_id = v_record.target_id
                ) THEN
                    v_blocked_records := v_blocked_records + 1;
                    CONTINUE;
                END IF;

                DELETE FROM public.game_slots gs
                WHERE gs.id = v_record.target_id
                  AND gs.organization_id = v_job.organization_id;
                v_deleted_game_slots := v_deleted_game_slots + 1;
            ELSIF v_record.target_table = 'practice_slots' THEN
                IF EXISTS (
                    SELECT 1 FROM public.practice_assignments pa
                    WHERE pa.organization_id = v_job.organization_id
                      AND (
                        pa.slot_id = v_record.target_id
                        OR pa.practice_slot_id = v_record.target_id
                      )
                ) THEN
                    v_blocked_records := v_blocked_records + 1;
                    CONTINUE;
                END IF;

                DELETE FROM public.practice_slots ps
                WHERE ps.id = v_record.target_id
                  AND ps.organization_id = v_job.organization_id;
                v_deleted_practice_slots := v_deleted_practice_slots + 1;
            ELSIF v_record.target_table = 'field_subunits' THEN
                IF EXISTS (
                    SELECT 1 FROM public.practice_slots ps
                    WHERE ps.organization_id = v_job.organization_id
                      AND ps.field_subunit_id = v_record.target_id
                ) THEN
                    v_blocked_records := v_blocked_records + 1;
                    CONTINUE;
                END IF;

                DELETE FROM public.field_subunits fs
                WHERE fs.id = v_record.target_id
                  AND fs.organization_id = v_job.organization_id;
                v_deleted_subunits := v_deleted_subunits + 1;
            ELSIF v_record.target_table = 'fields' THEN
                IF EXISTS (
                    SELECT 1 FROM public.practice_slots ps
                    WHERE ps.organization_id = v_job.organization_id
                      AND ps.field_id = v_record.target_id
                ) OR EXISTS (
                    SELECT 1 FROM public.game_slots gs
                    WHERE gs.organization_id = v_job.organization_id
                      AND gs.field_id = v_record.target_id
                ) THEN
                    v_blocked_records := v_blocked_records + 1;
                    CONTINUE;
                END IF;

                DELETE FROM public.fields f
                WHERE f.id = v_record.target_id
                  AND f.organization_id = v_job.organization_id;
                v_deleted_fields := v_deleted_fields + 1;
            ELSIF v_record.target_table = 'locations' THEN
                IF EXISTS (
                    SELECT 1 FROM public.fields f
                    WHERE f.organization_id = v_job.organization_id
                      AND f.location_id = v_record.target_id
                ) THEN
                    v_blocked_records := v_blocked_records + 1;
                    CONTINUE;
                END IF;

                DELETE FROM public.locations l
                WHERE l.id = v_record.target_id
                  AND l.organization_id = v_job.organization_id;
                v_deleted_locations := v_deleted_locations + 1;
            END IF;

            UPDATE public.import_application_records
            SET
                rolled_back_at = v_now,
                rolled_back_by = auth.uid(),
                rollback_payload = jsonb_build_object('deleted', true)
            WHERE id = v_record.id;
        ELSIF v_record.operation = 'updated' THEN
            v_previous := v_record.previous_payload;

            IF v_record.target_table = 'locations' THEN
                UPDATE public.locations
                SET
                    name = v_previous->>'name',
                    address = v_previous->>'address',
                    lighting_available = COALESCE((v_previous->>'lighting_available')::boolean, false),
                    updated_at = v_now
                WHERE id = v_record.target_id
                  AND organization_id = v_job.organization_id;
            ELSIF v_record.target_table = 'fields' THEN
                UPDATE public.fields
                SET
                    location_id = (v_previous->>'location_id')::uuid,
                    name = v_previous->>'name',
                    surface_type = v_previous->>'surface_type',
                    size = v_previous->>'size',
                    supports_halves = COALESCE((v_previous->>'supports_halves')::boolean, false),
                    max_age = v_previous->>'max_age',
                    priority_rating = COALESCE((v_previous->>'priority_rating')::integer, 1),
                    active = COALESCE((v_previous->>'active')::boolean, true),
                    updated_at = v_now
                WHERE id = v_record.target_id
                  AND organization_id = v_job.organization_id;
            ELSIF v_record.target_table = 'practice_slots' THEN
                UPDATE public.practice_slots
                SET
                    field_id = (v_previous->>'field_id')::uuid,
                    field_subunit_id = NULLIF(v_previous->>'field_subunit_id', '')::uuid,
                    day_of_week = (v_previous->>'day_of_week')::public.day_of_week,
                    start_time = (v_previous->>'start_time')::time,
                    end_time = (v_previous->>'end_time')::time,
                    capacity = COALESCE((v_previous->>'capacity')::smallint, 1),
                    valid_from = NULLIF(v_previous->>'valid_from', '')::date,
                    valid_until = NULLIF(v_previous->>'valid_until', '')::date,
                    label = v_previous->>'label',
                    updated_at = v_now
                WHERE id = v_record.target_id
                  AND organization_id = v_job.organization_id;
            ELSIF v_record.target_table = 'game_slots' THEN
                UPDATE public.game_slots
                SET
                    field_id = (v_previous->>'field_id')::uuid,
                    division_id = NULLIF(v_previous->>'division_id', '')::uuid,
                    slot_date = NULLIF(v_previous->>'slot_date', '')::date,
                    start_time = NULLIF(v_previous->>'start_time', '')::time,
                    end_time = NULLIF(v_previous->>'end_time', '')::time,
                    week_index = NULLIF(v_previous->>'week_index', '')::smallint,
                    capacity = COALESCE((v_previous->>'capacity')::smallint, 1),
                    updated_at = v_now
                WHERE id = v_record.target_id
                  AND organization_id = v_job.organization_id;
            END IF;

            UPDATE public.import_application_records
            SET
                rolled_back_at = v_now,
                rolled_back_by = auth.uid(),
                rollback_payload = v_previous
            WHERE id = v_record.id;

            v_restored_records := v_restored_records + 1;
        END IF;
    END LOOP;

    v_result := jsonb_build_object(
        'status', CASE WHEN v_blocked_records > 0 THEN 'completed_with_warnings' ELSE 'rolled_back' END,
        'deleted_locations', v_deleted_locations,
        'deleted_fields', v_deleted_fields,
        'deleted_field_subunits', v_deleted_subunits,
        'deleted_practice_slots', v_deleted_practice_slots,
        'deleted_game_slots', v_deleted_game_slots,
        'restored_records', v_restored_records,
        'blocked_records', v_blocked_records
    );

    UPDATE public.import_jobs
    SET
        status = CASE WHEN v_blocked_records > 0 THEN 'completed_with_warnings' ELSE 'needs_fix' END,
        warning_summary = jsonb_set(
            COALESCE(warning_summary, '{}'::jsonb),
            '{field_rollback}',
            v_result,
            true
        )
    WHERE id = p_import_job_id;

    PERFORM public.record_audit_event(
        v_job.organization_id,
        'import.rolled_back',
        'import_job',
        p_import_job_id,
        v_result
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_field_import_job(uuid) TO authenticated;

COMMIT;
