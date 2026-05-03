-- Durable coach CSV import apply/rollback.
--
-- Non-player imports previously stopped after validation and import_jobs status
-- updates. This adds the shared staging/ledger foundation needed for durable
-- non-player apply flows, then implements the coach CSV slice.

BEGIN;

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
        'import.started', 'import.completed', 'import.failed', 'import.rolled_back',
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

CREATE TABLE IF NOT EXISTS public.staging_import_rows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    import_job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
    import_type text NOT NULL CHECK (import_type IN ('coaches', 'fields')),
    source_row_number integer,
    raw_payload jsonb NOT NULL,
    normalized_payload jsonb,
    validation_errors jsonb DEFAULT '[]'::jsonb,
    applied_at timestamptz,
    applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (import_job_id, source_row_number)
);

CREATE INDEX IF NOT EXISTS idx_staging_import_rows_org_job
    ON public.staging_import_rows (organization_id, import_job_id, import_type);

ALTER TABLE public.staging_import_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staging Import Rows: members can view"
    ON public.staging_import_rows;

CREATE POLICY "Staging Import Rows: members can view"
    ON public.staging_import_rows FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE TABLE IF NOT EXISTS public.import_application_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    import_job_id uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
    import_type text NOT NULL CHECK (import_type IN ('coaches', 'fields')),
    target_table text NOT NULL CHECK (
        target_table IN ('coaches', 'fields', 'locations', 'practice_slots', 'game_slots')
    ),
    target_id uuid NOT NULL,
    operation text NOT NULL CHECK (operation IN ('inserted', 'updated')),
    previous_payload jsonb,
    applied_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    applied_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    applied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    rolled_back_at timestamptz,
    rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    rollback_payload jsonb,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (import_job_id, target_table, target_id)
);

CREATE INDEX IF NOT EXISTS idx_import_application_records_org_job
    ON public.import_application_records (organization_id, import_job_id, import_type);

ALTER TABLE public.import_application_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Import Application Records: members can view"
    ON public.import_application_records;

CREATE POLICY "Import Application Records: members can view"
    ON public.import_application_records FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.import_text_to_jsonb_array(p_value text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT COALESCE(
        (
            SELECT jsonb_agg(value)
            FROM (
                SELECT NULLIF(btrim(part), '') AS value
                FROM regexp_split_to_table(COALESCE(p_value, ''), ',') AS part
            ) parts
            WHERE value IS NOT NULL
        ),
        '[]'::jsonb
    );
$$;

CREATE OR REPLACE FUNCTION public.finalize_coach_import_job(
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
    v_existing public.coaches%ROWTYPE;
    v_after public.coaches%ROWTYPE;
    v_now timestamptz := timezone('utc', now());
    v_validation_errors jsonb := COALESCE(p_validation_errors, '[]'::jsonb);
    v_email text;
    v_full_name text;
    v_phone text;
    v_status text;
    v_can_multi_text text;
    v_can_multi boolean;
    v_certifications jsonb;
    v_contact_info jsonb;
    v_custom_attributes jsonb;
    v_previous_payload jsonb;
    v_existing_found boolean;
    v_inserted_count integer := 0;
    v_updated_count integer := 0;
    v_invalid_count integer := 0;
    v_cross_org_conflict_count integer := 0;
    v_blocked_assignment_count integer := 0;
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

    IF v_job.job_type <> 'registration' THEN
        RAISE EXCEPTION 'Import job % is %, not registration', p_import_job_id, v_job.job_type
            USING ERRCODE = '22023';
    END IF;

    IF v_job.status = 'failed' THEN
        RAISE EXCEPTION 'Failed import job % cannot be finalized', p_import_job_id
            USING ERRCODE = '22023';
    END IF;

    -- Deliberately row-oriented for the coach slice: each applied row needs an
    -- exact rollback snapshot and independent conflict outcome. The Edge
    -- Function caps imports at 5,000 rows; set-based promotion can replace
    -- this once field-slot promotion shares the same ledger.
    FOR v_row IN
        SELECT *
        FROM public.staging_import_rows
        WHERE import_job_id = p_import_job_id
          AND organization_id = v_job.organization_id
          AND import_type = 'coaches'
          AND applied_at IS NULL
          AND normalized_payload IS NOT NULL
          AND COALESCE(jsonb_array_length(validation_errors), 0) = 0
        ORDER BY source_row_number NULLS LAST, id
    LOOP
        v_email := lower(public.import_payload_text(v_row.normalized_payload, 'email'));
        v_full_name := public.import_payload_text(v_row.normalized_payload, 'full_name');
        v_phone := public.import_payload_text(v_row.normalized_payload, 'phone', 'contact_phone');
        v_status := lower(COALESCE(
            public.import_payload_text(v_row.normalized_payload, 'status', 'coach_status'),
            'active'
        ));
        v_can_multi_text := public.import_payload_text(
            v_row.normalized_payload,
            'can_coach_multiple_teams',
            'multiple_teams',
            'multi_team'
        );
        v_certifications := public.import_text_to_jsonb_array(
            public.import_payload_text(v_row.normalized_payload, 'certifications', 'certification')
        );
        v_contact_info := jsonb_strip_nulls(jsonb_build_object(
            'email', v_email,
            'phone', v_phone
        ));
        v_custom_attributes := v_row.normalized_payload
            - 'full_name' - 'email' - 'phone' - 'contact_phone'
            - 'status' - 'coach_status'
            - 'can_coach_multiple_teams' - 'multiple_teams' - 'multi_team'
            - 'certifications' - 'certification'
            - 'id' - 'organization_id' - 'created_at' - 'updated_at';

        IF v_email IS NULL
           OR v_full_name IS NULL
           OR v_status NOT IN ('active', 'pending-confirmation', 'inactive') THEN
            v_invalid_count := v_invalid_count + 1;
            UPDATE public.staging_import_rows
            SET validation_errors = jsonb_build_array(jsonb_build_object(
                    'message', 'Coach row is missing full_name/email or has an invalid status',
                    'source_row_number', v_row.source_row_number
                ))
            WHERE id = v_row.id;
            CONTINUE;
        END IF;

        SELECT *
        INTO v_existing
        FROM public.coaches c
        WHERE lower(c.email) = v_email
        ORDER BY c.created_at, c.id
        LIMIT 1;
        v_existing_found := FOUND;

        IF v_existing_found AND v_existing.organization_id <> v_job.organization_id THEN
            v_cross_org_conflict_count := v_cross_org_conflict_count + 1;
            UPDATE public.staging_import_rows
            SET validation_errors = jsonb_build_array(jsonb_build_object(
                    'message', 'Coach email already belongs to another organization',
                    'source_row_number', v_row.source_row_number
                ))
            WHERE id = v_row.id;
            CONTINUE;
        END IF;

        IF v_existing_found
           AND v_status = 'inactive'
           AND EXISTS (
                SELECT 1
                FROM public.teams t
                WHERE t.organization_id = v_job.organization_id
                  AND (
                    t.coach_id = v_existing.id
                    OR v_existing.id = ANY(COALESCE(t.assistant_coach_ids, '{}'::uuid[]))
                  )
           ) THEN
            v_blocked_assignment_count := v_blocked_assignment_count + 1;
            UPDATE public.staging_import_rows
            SET validation_errors = jsonb_build_array(jsonb_build_object(
                    'message', 'Assigned coaches cannot be marked inactive by import',
                    'source_row_number', v_row.source_row_number
                ))
            WHERE id = v_row.id;
            CONTINUE;
        END IF;

        IF v_existing_found THEN
            v_previous_payload := to_jsonb(v_existing);
            v_can_multi := CASE
                WHEN v_can_multi_text IS NULL THEN COALESCE(v_existing.can_coach_multiple_teams, false)
                ELSE public.import_text_to_bool(v_can_multi_text)
            END;

            UPDATE public.coaches
            SET
                full_name = v_full_name,
                email = v_email,
                phone = v_phone,
                certifications = v_certifications,
                can_coach_multiple_teams = v_can_multi,
                status = v_status,
                contact_info = v_contact_info,
                last_imported_at = v_now,
                import_source = 'coach_csv',
                custom_attributes = v_custom_attributes,
                updated_at = v_now
            WHERE id = v_existing.id
              AND organization_id = v_job.organization_id
            RETURNING * INTO v_after;

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
                'coaches',
                'coaches',
                v_after.id,
                'updated',
                v_previous_payload,
                to_jsonb(v_after),
                v_now,
                auth.uid()
            )
            ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

            v_updated_count := v_updated_count + 1;
        ELSE
            v_can_multi := COALESCE(public.import_text_to_bool(v_can_multi_text), false);

            INSERT INTO public.coaches (
                organization_id,
                full_name,
                email,
                phone,
                certifications,
                can_coach_multiple_teams,
                status,
                contact_info,
                last_imported_at,
                import_source,
                custom_attributes
            )
            VALUES (
                v_job.organization_id,
                v_full_name,
                v_email,
                v_phone,
                v_certifications,
                v_can_multi,
                v_status,
                v_contact_info,
                v_now,
                'coach_csv',
                v_custom_attributes
            )
            RETURNING * INTO v_after;

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
                'coaches',
                'coaches',
                v_after.id,
                'inserted',
                NULL,
                to_jsonb(v_after),
                v_now,
                auth.uid()
            );

            v_inserted_count := v_inserted_count + 1;
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
      AND import_type = 'coaches';

    v_status_result := CASE
        WHEN jsonb_array_length(v_validation_errors) > 0
          OR v_invalid_count > 0
          OR v_cross_org_conflict_count > 0
          OR v_blocked_assignment_count > 0
        THEN 'completed_with_warnings'
        ELSE 'completed'
    END;

    v_result := jsonb_build_object(
        'status', v_status_result,
        'staged_rows', (
            SELECT count(*)
            FROM public.staging_import_rows
            WHERE import_job_id = p_import_job_id
              AND import_type = 'coaches'
        ),
        'inserted_coaches', v_inserted_count,
        'updated_coaches', v_updated_count,
        'invalid_rows', v_invalid_count,
        'cross_org_conflict_rows', v_cross_org_conflict_count,
        'blocked_assignment_rows', v_blocked_assignment_count,
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
            '{coach_finalize}',
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

GRANT EXECUTE ON FUNCTION public.finalize_coach_import_job(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_coach_import_job(p_import_job_id uuid)
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
    v_deleted_count integer := 0;
    v_restored_count integer := 0;
    v_blocked_count integer := 0;
    v_pending_record_count integer := 0;
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
      AND import_type = 'coaches'
      AND target_table = 'coaches'
      AND rolled_back_at IS NULL;

    IF v_pending_record_count = 0 THEN
        RAISE EXCEPTION 'Import job % has no coach application records to roll back', p_import_job_id
            USING ERRCODE = '22023';
    END IF;

    FOR v_record IN
        SELECT *
        FROM public.import_application_records
        WHERE import_job_id = p_import_job_id
          AND organization_id = v_job.organization_id
          AND import_type = 'coaches'
          AND target_table = 'coaches'
          AND rolled_back_at IS NULL
        ORDER BY applied_at DESC, id DESC
    LOOP
        IF v_record.operation = 'inserted' THEN
            IF EXISTS (
                SELECT 1
                FROM public.teams t
                WHERE t.organization_id = v_job.organization_id
                  AND (
                    t.coach_id = v_record.target_id
                    OR v_record.target_id = ANY(COALESCE(t.assistant_coach_ids, '{}'::uuid[]))
                  )
            ) THEN
                v_blocked_count := v_blocked_count + 1;
                CONTINUE;
            END IF;

            DELETE FROM public.coaches c
            WHERE c.id = v_record.target_id
              AND c.organization_id = v_job.organization_id;

            UPDATE public.import_application_records
            SET
                rolled_back_at = v_now,
                rolled_back_by = auth.uid(),
                rollback_payload = jsonb_build_object('deleted', true)
            WHERE id = v_record.id;

            v_deleted_count := v_deleted_count + 1;
        ELSIF v_record.operation = 'updated' THEN
            v_previous := v_record.previous_payload;

            UPDATE public.coaches
            SET
                full_name = v_previous->>'full_name',
                email = v_previous->>'email',
                phone = v_previous->>'phone',
                certifications = COALESCE(v_previous->'certifications', '[]'::jsonb),
                can_coach_multiple_teams = COALESCE(
                    (v_previous->>'can_coach_multiple_teams')::boolean,
                    false
                ),
                status = v_previous->>'status',
                contact_info = COALESCE(v_previous->'contact_info', '{}'::jsonb),
                last_imported_at = NULLIF(v_previous->>'last_imported_at', '')::timestamptz,
                import_source = v_previous->>'import_source',
                custom_attributes = COALESCE(v_previous->'custom_attributes', '{}'::jsonb),
                updated_at = v_now
            WHERE id = v_record.target_id
              AND organization_id = v_job.organization_id;

            UPDATE public.import_application_records
            SET
                rolled_back_at = v_now,
                rolled_back_by = auth.uid(),
                rollback_payload = v_previous
            WHERE id = v_record.id;

            v_restored_count := v_restored_count + 1;
        END IF;
    END LOOP;

    v_result := jsonb_build_object(
        'status', CASE WHEN v_blocked_count > 0 THEN 'completed_with_warnings' ELSE 'rolled_back' END,
        'deleted_coaches', v_deleted_count,
        'restored_coaches', v_restored_count,
        'blocked_assigned_coaches', v_blocked_count
    );

    UPDATE public.import_jobs
    SET
        status = CASE WHEN v_blocked_count > 0 THEN 'completed_with_warnings' ELSE 'needs_fix' END,
        warning_summary = jsonb_set(
            COALESCE(warning_summary, '{}'::jsonb),
            '{coach_rollback}',
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

GRANT EXECUTE ON FUNCTION public.rollback_coach_import_job(uuid) TO authenticated;

COMMIT;
