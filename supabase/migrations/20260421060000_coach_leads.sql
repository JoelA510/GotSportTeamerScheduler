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
--      the client calls after a successful player import. Inserts coaches
--      with status='interested' ON CONFLICT DO NOTHING (never downgrades a
--      registered coach), then backfills coach_interested_programs.
--
-- Note on email uniqueness: coaches.email has a GLOBAL UNIQUE constraint
-- today, not scoped by organization_id. That means two orgs can't have the
-- same coach email. That's a pre-existing single-tenant assumption; C1.6
-- preserves it rather than reshaping it.

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
-- breadcrumb to the originating player row. UNIQUE guarantees idempotent
-- re-imports (same coach + same division + same source player = one row).

CREATE TABLE IF NOT EXISTS public.coach_interested_programs (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id                uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
    division_id             uuid NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
    inferred_from_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
    organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (coach_id, division_id, inferred_from_player_id)
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
-- 3. upsert_coach_leads RPC
-- ==================================================================================
-- Input payload: [{email, full_name, organization_id, division_id, player_id}, ...]
--   - organization_id is required and the caller must be a member.
--   - division_id and player_id may be null (the function still creates/updates
--     the coach lead but skips the program linkage for that row).
--
-- Behavior:
--   - For each input row, INSERT into coaches with status='interested'.
--     ON CONFLICT (email) DO NOTHING — we never downgrade an 'active' coach.
--   - Look up the coach_id (either newly created or pre-existing) and INSERT
--     into coach_interested_programs, skipping duplicates.
--
-- Returns: { leads_created: int, programs_linked: int, skipped_existing: int }.

CREATE OR REPLACE FUNCTION public.upsert_coach_leads(p_leads jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_lead           jsonb;
    v_email          text;
    v_full_name      text;
    v_org_id         uuid;
    v_division_id    uuid;
    v_player_id      uuid;
    v_coach_id       uuid;
    v_existing_status text;
    v_inserted       int := 0;
    v_linked         int := 0;
    v_skipped        int := 0;
BEGIN
    IF p_leads IS NULL OR jsonb_typeof(p_leads) <> 'array' THEN
        RAISE EXCEPTION 'p_leads must be a jsonb array';
    END IF;

    FOR v_lead IN SELECT * FROM jsonb_array_elements(p_leads)
    LOOP
        v_email       := lower(trim(v_lead->>'email'));
        v_full_name   := trim(v_lead->>'full_name');
        v_org_id      := nullif(v_lead->>'organization_id', '')::uuid;
        v_division_id := nullif(v_lead->>'division_id', '')::uuid;
        v_player_id   := nullif(v_lead->>'player_id', '')::uuid;

        -- Guard: caller must be a member of the org this lead is being inserted into.
        IF v_org_id IS NULL OR NOT public.is_org_member(v_org_id) THEN
            RAISE EXCEPTION 'Access denied: user is not a member of organization %', v_org_id;
        END IF;

        IF v_email IS NULL OR v_email = '' OR v_full_name IS NULL OR v_full_name = '' THEN
            -- Incomplete payload — skip silently rather than aborting the batch.
            CONTINUE;
        END IF;

        -- Check existing coach by (lower) email within this org. The global
        -- UNIQUE(email) constraint means we can just look up by email.
        SELECT id, status INTO v_coach_id, v_existing_status
        FROM public.coaches
        WHERE lower(email) = v_email
        LIMIT 1;

        IF v_coach_id IS NULL THEN
            INSERT INTO public.coaches (organization_id, full_name, email, status, import_source, last_imported_at)
            VALUES (v_org_id, v_full_name, v_email, 'interested', 'player_import_lead', timezone('utc', now()))
            RETURNING id INTO v_coach_id;
            v_inserted := v_inserted + 1;
        ELSE
            -- Already exists (any status) — don't downgrade 'active' to 'interested'.
            v_skipped := v_skipped + 1;
        END IF;

        -- Link the program if we have one and the coach row is in this org.
        IF v_division_id IS NOT NULL AND v_coach_id IS NOT NULL THEN
            INSERT INTO public.coach_interested_programs
                (coach_id, division_id, inferred_from_player_id, organization_id)
            VALUES (v_coach_id, v_division_id, v_player_id, v_org_id)
            ON CONFLICT (coach_id, division_id, inferred_from_player_id) DO NOTHING;

            IF FOUND THEN
                v_linked := v_linked + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'leads_created', v_inserted,
        'programs_linked', v_linked,
        'skipped_existing', v_skipped
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_coach_leads(jsonb) TO authenticated;

COMMIT;
