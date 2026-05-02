-- 20260502000000_import_finalize_pipeline.sql
-- Durable player-import promotion for GotSport CSV imports.
--
-- Validation remains in the import-validation Edge Function. Valid player rows
-- are now staged in public.staging_players, then promoted by the admin-only
-- finalize_import_job() RPC into public.players. The RPC is idempotent for an
-- import_job_id because promoted staging rows are never processed again.
--
-- Revert: docs/sql/reverts/20260502000000_revert.sql.
-- Smoke: docs/sql/tests/20260502000000_smoke.sql.

BEGIN;

ALTER TABLE public.staging_players
    ADD COLUMN IF NOT EXISTS source_row_number integer,
    ADD COLUMN IF NOT EXISTS promoted_at timestamptz,
    ADD COLUMN IF NOT EXISTS promoted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_staging_players_org_job_source
    ON public.staging_players (organization_id, import_job_id, source_row_number);

CREATE UNIQUE INDEX IF NOT EXISTS staging_players_import_job_source_row_key
    ON public.staging_players (import_job_id, source_row_number)
    WHERE source_row_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_players_org_external_registration_id
    ON public.players (organization_id, external_registration_id)
    WHERE external_registration_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.import_payload_text(p_payload jsonb, VARIADIC p_keys text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(
        btrim(
            COALESCE(
                (
                    SELECT p_payload ->> keys.key_name
                    FROM unnest(p_keys) AS keys(key_name)
                    WHERE p_payload ? keys.key_name
                      AND NULLIF(btrim(p_payload ->> keys.key_name), '') IS NOT NULL
                    LIMIT 1
                ),
                ''
            )
        ),
        ''
    );
$$;

CREATE OR REPLACE FUNCTION public.import_text_to_date(p_value text)
RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_value text := NULLIF(btrim(COALESCE(p_value, '')), '');
BEGIN
    IF v_value IS NULL THEN
        RETURN NULL;
    END IF;

    IF v_value ~ '^\d{4}-\d{2}-\d{2}$' THEN
        RETURN v_value::date;
    END IF;

    IF v_value ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN
        RETURN to_date(v_value, 'MM/DD/YYYY');
    END IF;

    RETURN v_value::date;
EXCEPTION
    WHEN others THEN
        RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.import_text_to_bool(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT lower(btrim(COALESCE(p_value, ''))) = ANY (ARRAY[
        'true', 't', 'yes', 'y', '1',
        'coach', 'head coach', 'assistant coach', 'volunteer', 'willing'
    ]);
$$;

CREATE OR REPLACE FUNCTION public.finalize_import_job(
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
    v_now timestamptz := timezone('utc', now());
    v_validation_errors jsonb := COALESCE(p_validation_errors, '[]'::jsonb);
    v_error_count integer := 0;
    v_total_promoted_count integer := 0;
    v_status text;
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

    v_error_count := jsonb_array_length(v_validation_errors);
    v_status := CASE WHEN v_error_count > 0 THEN 'completed_with_warnings' ELSE 'completed' END;

    WITH pending AS MATERIALIZED (
        SELECT
            sp.id AS staging_id,
            sp.source_row_number,
            sp.organization_id,
            sp.normalized_payload,
            public.import_payload_text(
                sp.normalized_payload,
                'external_registration_id', 'gotsport_id', 'registration_id', 'player_id'
            ) AS external_registration_id,
            public.import_payload_text(sp.normalized_payload, 'division_id') AS division_id_text,
            public.import_payload_text(
                sp.normalized_payload,
                'division_name', 'division', 'group', 'program'
            ) AS division_name,
            public.import_payload_text(sp.normalized_payload, 'first_name') AS first_name,
            public.import_payload_text(sp.normalized_payload, 'last_name') AS last_name,
            public.import_payload_text(sp.normalized_payload, 'preferred_name', 'nickname') AS preferred_name,
            public.import_text_to_date(
                public.import_payload_text(sp.normalized_payload, 'date_of_birth', 'dob')
            ) AS date_of_birth,
            public.import_payload_text(sp.normalized_payload, 'grade') AS grade,
            public.import_payload_text(sp.normalized_payload, 'gender') AS gender,
            public.import_payload_text(sp.normalized_payload, 'birth_year') AS birth_year_text,
            lower(public.import_payload_text(sp.normalized_payload, 'skill_tier', 'skill_level')) AS skill_tier_text,
            public.import_payload_text(sp.normalized_payload, 'buddy_request') AS buddy_request,
            public.import_payload_text(sp.normalized_payload, 'medical_info', 'medical') AS medical_notes,
            public.import_payload_text(sp.normalized_payload, 'email', 'contact_email') AS contact_email,
            public.import_payload_text(sp.normalized_payload, 'phone', 'contact_phone') AS contact_phone,
            public.import_payload_text(sp.normalized_payload, 'guardian_name', 'parent_name') AS guardian_name,
            public.import_payload_text(sp.normalized_payload, 'guardian_email', 'parent_email') AS guardian_email,
            public.import_payload_text(sp.normalized_payload, 'guardian_phone', 'parent_phone') AS guardian_phone,
            public.import_text_to_bool(
                public.import_payload_text(sp.normalized_payload, 'willing_to_coach', 'coach_volunteer')
            ) AS willing_to_coach,
            sp.normalized_payload
                - 'first_name' - 'last_name' - 'preferred_name' - 'nickname'
                - 'date_of_birth' - 'dob' - 'grade' - 'gender' - 'birth_year'
                - 'skill_tier' - 'skill_level' - 'buddy_request'
                - 'medical_info' - 'medical' - 'email' - 'contact_email'
                - 'phone' - 'contact_phone' - 'guardian_name' - 'parent_name'
                - 'guardian_email' - 'parent_email' - 'guardian_phone' - 'parent_phone'
                - 'willing_to_coach' - 'coach_volunteer'
                - 'external_registration_id' - 'gotsport_id' - 'registration_id' - 'player_id'
                - 'division_id' - 'division_name' - 'division' - 'group' - 'program'
                - 'id' - 'organization_id' - 'team_id' - 'status' - 'created_at' - 'updated_at'
                - 'full_name' - 'profile_id' - 'user_id' AS custom_attributes
        FROM public.staging_players sp
        WHERE sp.import_job_id = p_import_job_id
          AND sp.organization_id = v_job.organization_id
          AND sp.promoted_at IS NULL
          AND sp.normalized_payload IS NOT NULL
          AND COALESCE(jsonb_array_length(sp.validation_errors), 0) = 0
    ),
    valid_candidates AS MATERIALIZED (
        SELECT
            p.*,
            d.id AS division_id,
            CASE
                WHEN p.birth_year_text ~ '^\d{4}$' THEN p.birth_year_text::integer
                WHEN p.date_of_birth IS NOT NULL THEN EXTRACT(YEAR FROM p.date_of_birth)::integer
                ELSE NULL
            END AS birth_year,
            CASE
                WHEN p.skill_tier_text IN ('novice', 'developing', 'advanced') THEN p.skill_tier_text
                ELSE NULL
            END AS skill_tier,
            CASE
                WHEN p.medical_notes IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('notes', p.medical_notes)
            END AS medical_info,
            jsonb_strip_nulls(jsonb_build_object(
                'email', p.contact_email,
                'phone', p.contact_phone
            )) AS contact_info,
            CASE
                WHEN p.guardian_name IS NULL AND p.guardian_email IS NULL AND p.guardian_phone IS NULL THEN '[]'::jsonb
                ELSE jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                    'name', p.guardian_name,
                    'email', p.guardian_email,
                    'phone', p.guardian_phone
                )))
            END AS guardian_contacts
        FROM pending p
        LEFT JOIN LATERAL (
            SELECT divisions.id
            FROM public.divisions
            WHERE divisions.organization_id = p.organization_id
              AND (
                  divisions.id = CASE
                      WHEN p.division_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                          THEN p.division_id_text::uuid
                      ELSE NULL
                  END
                  OR lower(divisions.name) = lower(COALESCE(p.division_name, ''))
              )
            ORDER BY divisions.created_at DESC, divisions.id
            LIMIT 1
        ) d ON true
        WHERE p.first_name IS NOT NULL
          AND p.last_name IS NOT NULL
          AND p.date_of_birth IS NOT NULL
    ),
    deduped_external AS MATERIALIZED (
        SELECT DISTINCT ON (organization_id, external_registration_id) *
        FROM valid_candidates
        WHERE external_registration_id IS NOT NULL
        ORDER BY organization_id, external_registration_id, source_row_number NULLS LAST, staging_id
    ),
    existing_matches AS MATERIALIZED (
        SELECT de.staging_id, matched_players.id AS player_id
        FROM deduped_external de
        JOIN LATERAL (
            SELECT players.id
            FROM public.players
            WHERE players.organization_id = de.organization_id
              AND players.external_registration_id = de.external_registration_id
            ORDER BY players.created_at, players.id
            LIMIT 1
        ) matched_players ON true
    ),
    updated_existing AS (
        UPDATE public.players p
        SET
            division_id = COALESCE(de.division_id, p.division_id),
            first_name = de.first_name,
            last_name = de.last_name,
            preferred_name = de.preferred_name,
            date_of_birth = de.date_of_birth,
            grade = de.grade,
            gender = de.gender,
            birth_year = de.birth_year,
            skill_tier = de.skill_tier,
            willing_to_coach = de.willing_to_coach,
            coach_volunteer = de.willing_to_coach,
            buddy_request = de.buddy_request,
            medical_info = de.medical_info,
            contact_info = de.contact_info,
            guardian_contacts = de.guardian_contacts,
            custom_attributes = de.custom_attributes,
            last_imported_at = v_now,
            import_source = 'gotsport',
            registration_history = COALESCE(p.registration_history, '[]'::jsonb)
                || jsonb_build_array(jsonb_build_object(
                    'import_job_id', p_import_job_id,
                    'imported_at', v_now,
                    'source', 'gotsport',
                    'operation', 'updated'
                ))
        FROM deduped_external de
        JOIN existing_matches em ON em.staging_id = de.staging_id
        WHERE p.id = em.player_id
        RETURNING p.id
    ),
    insert_source AS MATERIALIZED (
        SELECT de.*
        FROM deduped_external de
        LEFT JOIN existing_matches em ON em.staging_id = de.staging_id
        WHERE em.player_id IS NULL

        UNION ALL

        SELECT vc.*
        FROM valid_candidates vc
        WHERE vc.external_registration_id IS NULL
    ),
    inserted_new AS (
        INSERT INTO public.players (
            organization_id,
            division_id,
            first_name,
            last_name,
            preferred_name,
            external_registration_id,
            date_of_birth,
            grade,
            gender,
            birth_year,
            skill_tier,
            status,
            coach_volunteer,
            willing_to_coach,
            buddy_request,
            guardian_contacts,
            medical_info,
            registration_history,
            contact_info,
            last_imported_at,
            import_source,
            custom_attributes
        )
        SELECT
            organization_id,
            division_id,
            first_name,
            last_name,
            preferred_name,
            external_registration_id,
            date_of_birth,
            grade,
            gender,
            birth_year,
            skill_tier,
            'active',
            willing_to_coach,
            willing_to_coach,
            buddy_request,
            guardian_contacts,
            medical_info,
            jsonb_build_array(jsonb_build_object(
                'import_job_id', p_import_job_id,
                'imported_at', v_now,
                'source', 'gotsport',
                'operation', 'inserted'
            )),
            contact_info,
            v_now,
            'gotsport',
            custom_attributes
        FROM insert_source
        RETURNING id
    ),
    promoted AS (
        UPDATE public.staging_players sp
        SET
            promoted_at = v_now,
            promoted_by = auth.uid()
        WHERE sp.id IN (SELECT staging_id FROM valid_candidates)
        RETURNING sp.id
    )
    SELECT jsonb_build_object(
        'staged_rows', (SELECT count(*) FROM pending),
        'valid_staged_rows', (SELECT count(*) FROM valid_candidates),
        'promoted_rows', (SELECT count(*) FROM promoted),
        'updated_players', (SELECT count(*) FROM updated_existing),
        'inserted_players', (SELECT count(*) FROM inserted_new),
        'duplicate_external_rows',
            (SELECT count(*) FROM valid_candidates WHERE external_registration_id IS NOT NULL)
            - (SELECT count(*) FROM deduped_external),
        'without_external_id',
            (SELECT count(*) FROM valid_candidates WHERE external_registration_id IS NULL),
        'unmatched_division_rows',
            (SELECT count(*) FROM valid_candidates WHERE division_name IS NOT NULL AND division_id IS NULL),
        'validation_error_rows', v_error_count,
        'status', v_status
    )
    INTO v_result;

    SELECT count(*)
    INTO v_total_promoted_count
    FROM public.staging_players
    WHERE import_job_id = p_import_job_id
      AND promoted_at IS NOT NULL;

    v_result := v_result || jsonb_build_object('total_promoted_rows', v_total_promoted_count);

    UPDATE public.import_jobs
    SET
        status = v_status,
        processed_rows = v_total_promoted_count,
        progress_percent = 100,
        completed_at = v_now,
        error_summary = jsonb_build_object('rowErrors', v_validation_errors),
        warning_summary = jsonb_set(
            COALESCE(warning_summary, '{}'::jsonb),
            '{finalize}',
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

GRANT EXECUTE ON FUNCTION public.finalize_import_job(uuid, jsonb) TO authenticated;

COMMIT;
