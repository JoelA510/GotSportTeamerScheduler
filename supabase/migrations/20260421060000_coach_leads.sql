-- 20260421060000_coach_leads.sql
-- C1.6: Coach leads — interested-coach tracking derived from player imports.
--
-- Summary of changes:
--   1. Extend coaches.status CHECK to include 'interested'. Existing 'active'
--      rows are the equivalent of "registered coach" — we don't rename them.
--   2. New public.coach_interested_programs junction — one row per
--      (coach lead, division, originating player) so the Leads UI can filter
--      "who's interested in U12B?" and admins can trace leads back to the
--      player registration that flagged them.
--   3. public.upsert_coach_leads(p_leads jsonb) — SECURITY DEFINER RPC that
--      the client calls after a successful player import. Set-based
--      implementation (Gemini review on #186) using jsonb_to_recordset and
--      a CTE pipeline. Never downgrades a registered coach, never links
--      programs across tenants (Codex P1 on #186).
--
-- Note on email uniqueness: coaches.email has a GLOBAL UNIQUE constraint
-- today, not scoped by organization_id. That means two orgs can't have the
-- same coach email. That's a pre-existing single-tenant assumption; C1.6
-- preserves it rather than reshaping it. The RPC guards against cross-org
-- linking by requiring the resolved coach row's organization_id to match
-- the lead's requested organization_id.

BEGIN;

-- ==================================================================================
-- 1. Extend coaches.status enum values
-- ==================================================================================

ALTER TABLE public.coaches
    DROP CONSTRAINT IF EXISTS coaches_status_check;

ALTER TABLE public.coaches
    ADD CONSTRAINT coaches_status_check
    CHECK (status IN ('active', 'pending-confirmation', 'inactive', 'interested'));

COMMENT ON COLUMN public.coaches.status IS
    'Lifecycle state. ''interested'' = lead captured from player-registration '
    '"Head coach" intent flag; promoted to ''active'' automatically when the same '
    'email appears on a coach import.';

-- ==================================================================================
-- 2. coach_interested_programs junction
-- ==================================================================================
-- Tracks which divisions each coach lead has expressed interest in, with a
-- breadcrumb to the originating player row.
--
-- UNIQUE NULLS NOT DISTINCT (PG 15+): `inferred_from_player_id` is nullable
-- (player row may have been deleted later via ON DELETE SET NULL). Without
-- NULLS NOT DISTINCT, Postgres treats each NULL as distinct and re-imports
-- without a player_id create duplicates — the ON CONFLICT clause in the
-- RPC never fires for those rows (Codex P2 on #186).

CREATE TABLE IF NOT EXISTS public.coach_interested_programs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id                uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
    division_id             uuid NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
    inferred_from_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
    organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE NULLS NOT DISTINCT (coach_id, division_id, inferred_from_player_id)
);

CREATE INDEX IF NOT EXISTS idx_coach_interested_programs_coach
    ON public.coach_interested_programs (coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_interested_programs_division
    ON public.coach_interested_programs (division_id);
CREATE INDEX IF NOT EXISTS idx_coach_interested_programs_org
    ON public.coach_interested_programs (organization_id);

ALTER TABLE public.coach_interested_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Coach Interested Programs: members access"
    ON public.coach_interested_programs;

CREATE POLICY "Coach Interested Programs: members access"
    ON public.coach_interested_programs FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

-- ==================================================================================
-- 3. upsert_coach_leads RPC (set-based)
-- ==================================================================================
-- Input payload: [{email, full_name, organization_id, division_id, player_id}, ...]
--   - organization_id is required; caller must be a member of every
--     referenced org (pre-validated in a tiny loop; the subsequent CTE
--     pipeline runs as one statement).
--   - division_id and player_id may be null. A null division_id means we
--     create the lead coach record but skip the program linkage for that
--     row.
--
-- Cross-org safety: if an email already exists under a DIFFERENT org (the
-- global UNIQUE(email) constraint makes this possible), the ON CONFLICT
-- on the coaches INSERT silently no-ops, AND the program-linkage lookup
-- requires the coach's own `organization_id` to match the lead's requested
-- one — so cross-tenant linkage can't be created (Codex P1 on #186).
--
-- Returns: { leads_created: int, programs_linked: int, skipped_existing: int }.

CREATE OR REPLACE FUNCTION public.upsert_coach_leads(p_leads jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_result jsonb;
BEGIN
    IF p_leads IS NULL OR jsonb_typeof(p_leads) <> 'array' THEN
        RAISE EXCEPTION 'p_leads must be a jsonb array';
    END IF;

    -- Up-front org-membership check. Runs once per distinct org in the
    -- batch, so this is cheap even for large payloads — Gemini review on
    -- #186 flagged per-row is_org_member calls as redundant.
    FOR v_org_id IN
        SELECT DISTINCT (elem->>'organization_id')::uuid
        FROM jsonb_array_elements(p_leads) AS elem
        WHERE elem->>'organization_id' IS NOT NULL
          AND elem->>'organization_id' <> ''
    LOOP
        IF NOT public.is_org_member(v_org_id) THEN
            RAISE EXCEPTION 'Access denied: user is not a member of organization %', v_org_id;
        END IF;
    END LOOP;

    WITH input_leads AS (
        SELECT
            lower(trim(coalesce(email, '')))    AS email,
            trim(coalesce(full_name, ''))       AS full_name,
            organization_id,
            division_id,
            player_id
        FROM jsonb_to_recordset(p_leads) AS x(
            email           text,
            full_name       text,
            organization_id uuid,
            division_id     uuid,
            player_id       uuid
        )
        WHERE organization_id IS NOT NULL
    ),
    valid_leads AS (
        SELECT * FROM input_leads
        WHERE email <> '' AND full_name <> ''
    ),
    -- Dedup by email for the coaches INSERT. If the same email appears
    -- under multiple orgs in one batch, pick the lowest org_id
    -- deterministically — the cross-org safety net below still holds.
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
    -- For each valid lead, resolve coach_id via (a) the INSERT RETURNING
    -- from this batch or (b) an existing coach in the SAME org. Cross-
    -- org matches yield NULL coach_id and are dropped from the linkage
    -- step.
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
        'leads_created',    (SELECT count(*) FROM inserted_coaches),
        'programs_linked',  (SELECT count(*) FROM inserted_links),
        'skipped_existing', (SELECT count(*) FROM valid_leads)
                            - (SELECT count(*) FROM inserted_coaches)
    )
    INTO v_result;

    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_coach_leads(jsonb) TO authenticated;

COMMIT;
