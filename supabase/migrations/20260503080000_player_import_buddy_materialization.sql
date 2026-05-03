-- 20260503080000_player_import_buddy_materialization.sql
-- Materialize reciprocal player-import buddy requests after durable player promotion.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_player_buddies_org_source_import
    ON public.player_buddies (organization_id, source_import_job);

CREATE OR REPLACE FUNCTION public.materialize_import_buddy_pairs(
    p_import_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_job public.import_jobs%ROWTYPE;
    v_now timestamptz := timezone('utc', now());
    v_result jsonb;
    v_warning_count integer;
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

    IF v_job.job_type <> 'registration' THEN
        RAISE EXCEPTION 'Import job % is %, not registration', p_import_job_id, v_job.job_type
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_org_admin(v_job.organization_id) THEN
        RAISE EXCEPTION 'Access denied: user is not an admin of organization %', v_job.organization_id
            USING ERRCODE = '42501';
    END IF;

    WITH promoted_payloads AS MATERIALIZED (
        SELECT
            sp.id AS staging_id,
            sp.source_row_number,
            sp.organization_id,
            sp.normalized_payload,
            NULLIF(lower(public.import_payload_text(
                sp.normalized_payload,
                'external_registration_id', 'gotsport_id', 'registration_id', 'player_id'
            )), '') AS external_key,
            NULLIF(lower(public.import_payload_text(
                sp.normalized_payload,
                'buddy_request', 'buddy_id', 'buddy_external_registration_id',
                'buddy_registration_id', 'friend_request'
            )), '') AS buddy_request_key,
            NULLIF(lower(public.import_payload_text(
                sp.normalized_payload,
                'mutual_buddy_code', 'buddy_code', 'friend_code'
            )), '') AS mutual_code_key
        FROM public.staging_players sp
        WHERE sp.import_job_id = p_import_job_id
          AND sp.organization_id = v_job.organization_id
          AND sp.promoted_at IS NOT NULL
          AND sp.normalized_payload IS NOT NULL
    ),
    matched_sources AS MATERIALIZED (
        SELECT DISTINCT ON (p.id)
            pp.staging_id,
            pp.source_row_number,
            pp.external_key,
            pp.buddy_request_key,
            pp.mutual_code_key,
            p.id AS player_id,
            p.division_id
        FROM promoted_payloads pp
        JOIN public.players p
          ON p.organization_id = pp.organization_id
         AND lower(p.external_registration_id) = pp.external_key
        WHERE pp.external_key IS NOT NULL
          AND (pp.buddy_request_key IS NOT NULL OR pp.mutual_code_key IS NOT NULL)
        ORDER BY p.id, pp.source_row_number NULLS LAST, pp.staging_id
    ),
    request_matches AS MATERIALIZED (
        SELECT
            source.player_id,
            source.division_id,
            source.external_key,
            source.buddy_request_key,
            buddy.player_id AS buddy_player_id,
            buddy.division_id AS buddy_division_id,
            buddy.buddy_request_key AS reciprocal_request_key
        FROM matched_sources source
        LEFT JOIN matched_sources buddy
          ON buddy.external_key = source.buddy_request_key
        WHERE source.buddy_request_key IS NOT NULL
    ),
    request_candidate_pairs AS MATERIALIZED (
        SELECT DISTINCT
            LEAST(player_id, buddy_player_id) AS player_a_id,
            GREATEST(player_id, buddy_player_id) AS player_b_id
        FROM request_matches
        WHERE buddy_player_id IS NOT NULL
          AND player_id <> buddy_player_id
          AND reciprocal_request_key = external_key
          AND division_id IS NOT DISTINCT FROM buddy_division_id
    ),
    code_group_players AS MATERIALIZED (
        SELECT
            mutual_code_key,
            player_id,
            division_id,
            min(source_row_number) AS source_row_number
        FROM matched_sources
        WHERE mutual_code_key IS NOT NULL
        GROUP BY mutual_code_key, player_id, division_id
    ),
    code_groups AS MATERIALIZED (
        SELECT
            mutual_code_key,
            array_agg(player_id ORDER BY source_row_number NULLS LAST, player_id) AS player_ids,
            count(*) AS player_count,
            count(DISTINCT division_id) FILTER (WHERE division_id IS NOT NULL) AS division_count,
            count(*) FILTER (WHERE division_id IS NULL) AS null_division_count
        FROM code_group_players
        GROUP BY mutual_code_key
    ),
    code_candidate_pairs AS MATERIALIZED (
        SELECT DISTINCT
            LEAST(player_ids[1], player_ids[2]) AS player_a_id,
            GREATEST(player_ids[1], player_ids[2]) AS player_b_id
        FROM code_groups
        WHERE player_count = 2
          AND (
              (division_count = 1 AND null_division_count = 0)
              OR (division_count = 0 AND null_division_count = 2)
          )
    ),
    candidate_pairs AS MATERIALIZED (
        SELECT player_a_id, player_b_id FROM request_candidate_pairs
        UNION
        SELECT player_a_id, player_b_id FROM code_candidate_pairs
    ),
    directional_pairs AS MATERIALIZED (
        SELECT player_a_id AS player_id, player_b_id AS buddy_player_id
        FROM candidate_pairs
        UNION ALL
        SELECT player_b_id AS player_id, player_a_id AS buddy_player_id
        FROM candidate_pairs
    ),
    inserted AS (
        INSERT INTO public.player_buddies (
            player_id,
            buddy_player_id,
            organization_id,
            source_import_job,
            is_mutual
        )
        SELECT
            dp.player_id,
            dp.buddy_player_id,
            v_job.organization_id,
            p_import_job_id,
            true
        FROM directional_pairs dp
        ON CONFLICT (player_id, buddy_player_id) DO NOTHING
        RETURNING player_id, buddy_player_id
    ),
    counts_base AS (
        SELECT
            (SELECT count(*) FROM promoted_payloads) AS promoted_rows,
            (SELECT count(*) FROM matched_sources) AS requested_rows,
            (SELECT count(*) FROM promoted_payloads
              WHERE (buddy_request_key IS NOT NULL OR mutual_code_key IS NOT NULL)
                AND external_key IS NULL) AS missing_external_id_rows,
            (SELECT count(*) FROM promoted_payloads pp
              WHERE pp.external_key IS NOT NULL
                AND (pp.buddy_request_key IS NOT NULL OR pp.mutual_code_key IS NOT NULL)
                AND NOT EXISTS (
                    SELECT 1
                    FROM matched_sources ms
                    WHERE ms.external_key = pp.external_key
                )) AS unmatched_promoted_rows,
            (SELECT count(*) FROM request_matches
              WHERE buddy_player_id IS NULL) AS unmatched_request_rows,
            (SELECT count(*) FROM request_matches
              WHERE buddy_player_id = player_id) AS self_request_rows,
            (SELECT count(*) FROM request_matches
              WHERE buddy_player_id IS NOT NULL
                AND buddy_player_id <> player_id
                AND reciprocal_request_key IS DISTINCT FROM external_key) AS nonreciprocal_request_rows,
            (SELECT count(*) FROM request_matches
              WHERE buddy_player_id IS NOT NULL
                AND buddy_player_id <> player_id
                AND reciprocal_request_key = external_key
                AND division_id IS DISTINCT FROM buddy_division_id) AS cross_division_request_rows,
            (SELECT count(*) FROM code_groups
              WHERE NOT (
                  player_count = 2
                  AND (
                      (division_count = 1 AND null_division_count = 0)
                      OR (division_count = 0 AND null_division_count = 2)
                  )
              )) AS invalid_code_groups,
            (SELECT count(*) FROM candidate_pairs) AS materialized_pairs,
            (SELECT count(*) FROM directional_pairs) AS candidate_relationships,
            (SELECT count(*) FROM inserted) AS inserted_relationships
    ),
    counts AS (
        SELECT
            counts_base.*,
            (
                missing_external_id_rows
                + unmatched_promoted_rows
                + unmatched_request_rows
                + self_request_rows
                + nonreciprocal_request_rows
                + cross_division_request_rows
                + invalid_code_groups
            ) AS total_warnings
        FROM counts_base
    )
    SELECT jsonb_build_object(
        'status',
            CASE WHEN total_warnings > 0 THEN 'completed_with_warnings' ELSE 'completed' END,
        'promoted_rows', promoted_rows,
        'requested_rows', requested_rows,
        'materialized_pairs', materialized_pairs,
        'candidate_relationships', candidate_relationships,
        'inserted_relationships', inserted_relationships,
        'existing_relationships', candidate_relationships - inserted_relationships,
        'missing_external_id_rows', missing_external_id_rows,
        'unmatched_promoted_rows', unmatched_promoted_rows,
        'unmatched_request_rows', unmatched_request_rows,
        'self_request_rows', self_request_rows,
        'nonreciprocal_request_rows', nonreciprocal_request_rows,
        'cross_division_request_rows', cross_division_request_rows,
        'invalid_code_groups', invalid_code_groups
    ),
    total_warnings
    INTO v_result, v_warning_count
    FROM counts;

    UPDATE public.import_jobs
    SET
        status = CASE
            WHEN v_warning_count > 0 THEN 'completed_with_warnings'
            ELSE status
        END,
        warning_summary = jsonb_set(
            COALESCE(warning_summary, '{}'::jsonb),
            '{buddy_pairs}',
            v_result,
            true
        )
    WHERE id = p_import_job_id;

    PERFORM public.record_audit_event(
        v_job.organization_id,
        'import.completed',
        'import_job',
        p_import_job_id,
        v_result || jsonb_build_object('stage', 'buddy_pairs', 'processed_at', v_now)
    );

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.materialize_import_buddy_pairs(uuid) TO authenticated;

COMMENT ON FUNCTION public.materialize_import_buddy_pairs(uuid) IS
    'Materializes reciprocal player-import buddy requests into player_buddies for an org-admin import job.';

COMMIT;
