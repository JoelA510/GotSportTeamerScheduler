-- 20260503000000_secure_coach_lead_scoping.sql
--
-- Harden player-import coach lead capture so SECURITY DEFINER writes cannot
-- attach Org A leads to Org B divisions or players.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_coach_interested_programs_org_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.coaches c
        WHERE c.id = NEW.coach_id
          AND c.organization_id = NEW.organization_id
    ) THEN
        RAISE EXCEPTION 'coach_interested_programs coach organization mismatch'
            USING ERRCODE = '23514';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.divisions d
        WHERE d.id = NEW.division_id
          AND d.organization_id = NEW.organization_id
    ) THEN
        RAISE EXCEPTION 'coach_interested_programs division organization mismatch'
            USING ERRCODE = '23514';
    END IF;

    IF NEW.inferred_from_player_id IS NOT NULL
       AND NOT EXISTS (
           SELECT 1
           FROM public.players p
           WHERE p.id = NEW.inferred_from_player_id
             AND p.organization_id = NEW.organization_id
       ) THEN
        RAISE EXCEPTION 'coach_interested_programs player organization mismatch'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coach_interested_programs_org_scope
    ON public.coach_interested_programs;

CREATE TRIGGER coach_interested_programs_org_scope
    BEFORE INSERT OR UPDATE OF coach_id, division_id, inferred_from_player_id, organization_id
    ON public.coach_interested_programs
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_coach_interested_programs_org_scope();

CREATE OR REPLACE FUNCTION public.upsert_coach_leads(p_leads jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_invalid_scope_count integer;
    v_result jsonb;
BEGIN
    IF p_leads IS NULL OR jsonb_typeof(p_leads) <> 'array' THEN
        RAISE EXCEPTION 'p_leads must be a jsonb array';
    END IF;

    FOR v_org_id IN
        SELECT DISTINCT (elem->>'organization_id')::uuid
        FROM jsonb_array_elements(p_leads) AS elem
        WHERE elem->>'organization_id' IS NOT NULL
          AND elem->>'organization_id' <> ''
    LOOP
        IF NOT public.is_org_member(v_org_id) THEN
            RAISE EXCEPTION 'Access denied: user is not a member of organization %', v_org_id
                USING ERRCODE = '42501';
        END IF;
    END LOOP;

    WITH input_leads AS (
        SELECT
            lower(trim(coalesce(email, ''))) AS email,
            trim(coalesce(full_name, '')) AS full_name,
            organization_id,
            division_id,
            player_id
        FROM jsonb_to_recordset(p_leads) AS x(
            email text,
            full_name text,
            organization_id uuid,
            division_id uuid,
            player_id uuid
        )
        WHERE organization_id IS NOT NULL
    ),
    valid_leads AS (
        SELECT * FROM input_leads
        WHERE email <> '' AND full_name <> ''
    ),
    invalid_scope AS (
        SELECT 1
        FROM valid_leads vl
        WHERE (
            vl.division_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1
                FROM public.divisions d
                WHERE d.id = vl.division_id
                  AND d.organization_id = vl.organization_id
            )
        )
        OR (
            vl.player_id IS NOT NULL
            AND NOT EXISTS (
                SELECT 1
                FROM public.players p
                WHERE p.id = vl.player_id
                  AND p.organization_id = vl.organization_id
            )
        )
    )
    SELECT count(*)
    INTO v_invalid_scope_count
    FROM invalid_scope;

    IF v_invalid_scope_count > 0 THEN
        RAISE EXCEPTION 'Coach lead references a division or player outside its organization'
            USING ERRCODE = '42501';
    END IF;

    WITH input_leads AS (
        SELECT
            lower(trim(coalesce(email, ''))) AS email,
            trim(coalesce(full_name, '')) AS full_name,
            organization_id,
            division_id,
            player_id
        FROM jsonb_to_recordset(p_leads) AS x(
            email text,
            full_name text,
            organization_id uuid,
            division_id uuid,
            player_id uuid
        )
        WHERE organization_id IS NOT NULL
    ),
    valid_leads AS (
        SELECT * FROM input_leads
        WHERE email <> '' AND full_name <> ''
    ),
    coach_candidates AS (
        SELECT DISTINCT ON (email)
            email, full_name, organization_id
        FROM valid_leads
        ORDER BY email, organization_id
    ),
    inserted_coaches AS (
        INSERT INTO public.coaches (
            organization_id, full_name, email, status,
            import_source, last_imported_at
        )
        SELECT
            organization_id, full_name, email, 'interested',
            'player_import_lead', timezone('utc', now())
        FROM coach_candidates
        ON CONFLICT (email) DO NOTHING
        RETURNING id, organization_id, email
    ),
    resolved_leads AS (
        SELECT
            vl.division_id,
            vl.player_id,
            vl.organization_id,
            COALESCE(ic.id, c.id) AS coach_id
        FROM valid_leads vl
        LEFT JOIN inserted_coaches ic
            ON ic.email = vl.email
           AND ic.organization_id = vl.organization_id
        LEFT JOIN public.coaches c
            ON lower(c.email) = vl.email
           AND c.organization_id = vl.organization_id
    ),
    inserted_links AS (
        INSERT INTO public.coach_interested_programs (
            coach_id, division_id, inferred_from_player_id, organization_id
        )
        SELECT coach_id, division_id, player_id, organization_id
        FROM resolved_leads
        WHERE coach_id IS NOT NULL
          AND division_id IS NOT NULL
        ON CONFLICT (coach_id, division_id, inferred_from_player_id) DO NOTHING
        RETURNING 1
    )
    SELECT jsonb_build_object(
        'leads_created', (SELECT count(*) FROM inserted_coaches),
        'programs_linked', (SELECT count(*) FROM inserted_links),
        'skipped_existing', (SELECT count(*) FROM valid_leads)
                            - (SELECT count(*) FROM inserted_coaches)
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_coach_leads(jsonb) TO authenticated;

COMMIT;
