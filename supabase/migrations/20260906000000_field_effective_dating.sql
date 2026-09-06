-- M1: effective dating on fields, and the retirement RPC that writes it.
--
-- Phase 8.4 PR 2 of 3. Gives `fields` an inclusive effective window mirroring
-- `packages/core/src/facility/lifecycle.js`, and adds `admin_retire_field`,
-- which refuses to retire ground that still has bookings unless the caller
-- confirms.
--
-- ## Why `active` survives, and is written together with `effective_to`
--
-- `fields.active` is not redundant here and removing it would be a live
-- regression: the shipped MVP scheduler filters on it directly at
-- `frontend/src/pages/GameSchedulingPage.jsx:253`
-- (`.eq('active', true)`), so a field retired by date alone would stay in the
-- scheduler's list of bookable ground. Until that read is repointed -- PR 3's
-- work, not this one -- the two columns must agree.
--
-- Two columns saying one thing is a hazard. It is bounded rather than merely
-- flagged: `admin_retire_field` and `admin_unretire_field` are the only writers
-- of `effective_to`, they always write `active` in the same statement, and
-- `docs/sql/20260906000000_smoke.sql` asserts the two cannot disagree after
-- either RPC. Deprecating `active` is recorded as follow-on work, not done
-- here.
--
-- ## Audit before AND after
--
-- This diverges from the four existing facility RPCs in
-- `20260504060000_admin_facility_mutation_rpcs.sql`, which audit only the
-- resulting state. A retirement is a decision taken against a world the
-- operator believed in, and "what did it look like before" is the half that
-- makes the decision reviewable -- particularly when the RPC refused. Those
-- four are deliberately NOT retrofitted here: changing the audit shape of
-- shipped RPCs under a lifecycle migration is how a rider becomes an incident.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to   date;

-- Inclusive on both ends, matching blackout_from/blackout_until and
-- available_from/available_until on the tables this sits beside -- one
-- convention across the schema rather than three.
ALTER TABLE public.fields
  DROP CONSTRAINT IF EXISTS fields_effective_window_check;
ALTER TABLE public.fields
  ADD CONSTRAINT fields_effective_window_check
  CHECK (
    effective_from IS NULL
    OR effective_to IS NULL
    OR effective_to >= effective_from
  );

COMMENT ON COLUMN public.fields.effective_from IS
  'Inclusive first date this field is part of the estate. NULL means unbounded. See packages/core/src/facility/lifecycle.js for the single reading of this window.';
COMMENT ON COLUMN public.fields.effective_to IS
  'Inclusive last date this field is part of the estate. NULL means unbounded. Written only by admin_retire_field/admin_unretire_field, always together with fields.active.';
COMMENT ON COLUMN public.fields.active IS
  'Kept alongside effective_to because the shipped scheduler filters on it (GameSchedulingPage.jsx). The two are written together and must never disagree; see docs/sql/20260906000000_smoke.sql. Deprecation is follow-on work.';

CREATE INDEX IF NOT EXISTS idx_fields_effective_window
  ON public.fields (organization_id, effective_from, effective_to);

-- ---------------------------------------------------------------------------
-- 2. admin_retire_field
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_retire_field(
    p_organization_id uuid,
    p_field_id uuid,
    p_effective_to date,
    p_confirm boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before public.fields%ROWTYPE;
    v_after  public.fields%ROWTYPE;
    v_affected jsonb;
    v_affected_count integer;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;
    IF p_field_id IS NULL THEN
        RAISE EXCEPTION 'p_field_id is required' USING ERRCODE = '22023';
    END IF;
    IF p_effective_to IS NULL THEN
        RAISE EXCEPTION 'p_effective_to is required; retiring with no end date is a deletion, not a retirement'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_before
    FROM public.fields
    WHERE id = p_field_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Field % not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    -- **Every booking a retirement would strand.** Enumerated from game_slots,
    -- which is the thing the change corrupts -- not from the field row, which a
    -- retirement leaves intact and which would therefore report nothing.
    --
    -- `game_slots.start` is NULLABLE. A slot with no start date cannot be
    -- judged against p_effective_to at all, and dropping it from the count
    -- would silently retire ground out from under an untimed booking. It is
    -- carried instead, flagged as undated, and counted -- so the operator is
    -- asked to confirm rather than told there is nothing there.
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'game_slot_id', gs.id,
            'starts_at', gs.start,
            'week_index', gs.week_index,
            'undated', gs.start IS NULL
          )
          ORDER BY gs.start NULLS FIRST, gs.id
        ),
        '[]'::jsonb
      ),
      COUNT(*)
    INTO v_affected, v_affected_count
    FROM public.game_slots gs
    WHERE gs.organization_id = p_organization_id
      AND gs.field_id = p_field_id
      AND (gs.start IS NULL OR gs.start::date > p_effective_to);

    -- **The refusal lives here, not in the UI.** A confirmation prompt a
    -- caller can skip by calling the RPC directly is not a guard.
    IF v_affected_count > 0 AND NOT p_confirm THEN
        PERFORM public.record_audit_event(
            p_organization_id,
            'settings.updated',
            'field',
            p_field_id,
            jsonb_build_object(
                'operation', 'admin_retire_field',
                'phase', 'refused',
                'reason', 'bookings_after_effective_to',
                'effective_to', p_effective_to,
                'affected_count', v_affected_count,
                'affected', v_affected,
                'before', to_jsonb(v_before)
            )
        );
        RETURN jsonb_build_object(
            'retired', false,
            'reason', 'bookings_after_effective_to',
            'affected_count', v_affected_count,
            'affected', v_affected
        );
    END IF;

    -- Audit BEFORE the write, so the world the operator decided against is on
    -- the record even if the statement below fails.
    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        p_field_id,
        jsonb_build_object(
            'operation', 'admin_retire_field',
            'phase', 'before',
            'effective_to', p_effective_to,
            'confirmed', p_confirm,
            'affected_count', v_affected_count,
            'affected', v_affected,
            'before', to_jsonb(v_before)
        )
    );

    -- **`active` and `effective_to` in one statement.** They cannot disagree
    -- because there is no path that writes one without the other.
    UPDATE public.fields
    SET effective_to = p_effective_to,
        active = false,
        updated_at = timezone('utc', now())
    WHERE id = p_field_id AND organization_id = p_organization_id
    RETURNING * INTO v_after;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        p_field_id,
        jsonb_build_object(
            'operation', 'admin_retire_field',
            'phase', 'after',
            'effective_to', p_effective_to,
            'confirmed', p_confirm,
            'affected_count', v_affected_count,
            'after', to_jsonb(v_after)
        )
    );

    RETURN jsonb_build_object(
        'retired', true,
        'affected_count', v_affected_count,
        'affected', v_affected,
        'field', to_jsonb(v_after)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. admin_unretire_field -- the other writer of the pair
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_unretire_field(
    p_organization_id uuid,
    p_field_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before public.fields%ROWTYPE;
    v_after  public.fields%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;
    IF p_field_id IS NULL THEN
        RAISE EXCEPTION 'p_field_id is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_before
    FROM public.fields
    WHERE id = p_field_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Field % not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM public.record_audit_event(
        p_organization_id, 'settings.updated', 'field', p_field_id,
        jsonb_build_object(
            'operation', 'admin_unretire_field', 'phase', 'before',
            'before', to_jsonb(v_before)
        )
    );

    UPDATE public.fields
    SET effective_to = NULL,
        active = true,
        updated_at = timezone('utc', now())
    WHERE id = p_field_id AND organization_id = p_organization_id
    RETURNING * INTO v_after;

    PERFORM public.record_audit_event(
        p_organization_id, 'settings.updated', 'field', p_field_id,
        jsonb_build_object(
            'operation', 'admin_unretire_field', 'phase', 'after',
            'after', to_jsonb(v_after)
        )
    );

    RETURN jsonb_build_object('retired', false, 'field', to_jsonb(v_after));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retire_field(uuid, uuid, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unretire_field(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_retire_field(uuid, uuid, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unretire_field(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_retire_field(uuid, uuid, date, boolean) IS
  'Org-admin retirement of a field. Refuses with the affected booking list and writes nothing when bookings outlive p_effective_to and p_confirm is false. Writes fields.active and fields.effective_to together. Audits before and after, including the refusal.';
COMMENT ON FUNCTION public.admin_unretire_field(uuid, uuid) IS
  'Org-admin reversal of admin_retire_field. Clears effective_to and restores active in one statement so the two cannot disagree. Audits before and after.';

COMMIT;
